import {app} from "../../../scripts/app.js";
/** @typedef {import("./spotlight-typedefs.js").ISpotlightRegistry} ISpotlightRegistry */
/** @typedef {import("./spotlight-typedefs.js").SpotlightHandlerContext} SpotlightHandlerContext */
/** @typedef {import("./spotlight-typedefs.js").SpotlightItem} SpotlightItem */

// Sample ComfyUI node extension that registers spotlight search providers
app.registerExtension({
    name: "ovum.spotlight.sample-provider",
    setup () {
        // Register keyword handler: "sample"
        /** @type {ISpotlightRegistry | undefined} */
        const OvumSpotlight = /** @type {ISpotlightRegistry | undefined} */ (window.OvumSpotlight);
        OvumSpotlight?.registerKeywordHandler("sample", (text, /** @type {SpotlightHandlerContext} */ ctx) => {
            const items = [];
            // Build trivial items from nodes whose title contains the text
            const nodes = ctx.collectAllNodesRecursive();
            for (const {node, displayId, parentChain} of nodes) {
                const t = (node.title || node.type || "").toLowerCase();
                if (!text || t.includes(text.toLowerCase())) {
                    items.push({
                        "@type": "node",
                        id: displayId,
                        title: `${node.title || node.type}  [${displayId}]`,
                        itemClass: "sample-match",
                        node,
                        itemSubtitlePath: parentChain,
                        searchText: `${node.title || node.type} ${displayId}`
                    });
                }
            }
            return {items};
        });

        // Debounced fetch helper for Google results (500ms)
        const _googleDebounce = { timer: null, controller: null, resolvers: [], rejecters: [], lastQ: '' };
        function fetchGoogleDebounced(q, delay = 500) {
            return new Promise((resolve, reject) => {
                const d = _googleDebounce;
                d.lastQ = q;
                d.resolvers.push(resolve);
                d.rejecters.push(reject);
                if (d.timer) clearTimeout(d.timer);
                // Abort any in-flight fetch since we'll issue a new one for the latest query
                if (d.controller) {
                    try { d.controller.abort(); } catch (_) { /* ignore */ }
                }
                d.timer = setTimeout(async () => {
                    const currentQ = d.lastQ;
                    d.timer = null;
                    const ctrl = new AbortController();
                    d.controller = ctrl;
                    try {
                        const res = await fetch(`/ovum/spotlight/google?q=${encodeURIComponent(currentQ)}`, { signal: ctrl.signal });
                        const data = await res.json();
                        const resolvers = d.resolvers.slice();
                        d.resolvers = [];
                        d.rejecters = [];
                        d.controller = null;
                        resolvers.forEach(fn => { try { fn(data); } catch (_) {} });
                    } catch (err) {
                        const rejecters = d.rejecters.slice();
                        d.resolvers = [];
                        d.rejecters = [];
                        d.controller = null;
                        rejecters.forEach(fn => { try { fn(err); } catch (_) {} });
                    }
                }, delay);
            });
        }

        // Demo: async keyword handler "google" that calls a PromptServer route and renders results in bigbox (debounced)
        OvumSpotlight?.registerKeywordHandler("google", async (text, /** @type {SpotlightHandlerContext} */ ctx) => {
            const q = (text || '').trim();
            if (!q) {
                const el = document.createElement('div');
                el.innerHTML = '<div style="opacity:.7">Type: google &lt;search terms&gt;</div>';
                return {items: [{
                        "@type": 'command', id: 'google-help', title: "Google: enter a query", itemClass: 'demo',
                        searchText: 'google help', bigbox: el
                    }]};
            }
            try {
                const data = await fetchGoogleDebounced(q, 500);
                const results = Array.isArray(data?.results) ? data.results : [];
                // Build bigbox content
                const box = document.createElement('div');
                box.style.paddingRight = '6px';
                const h = document.createElement('div');
                h.textContent = `Google results for "${q}"`;
                h.style.fontWeight = '600';
                h.style.margin = '4px 0 10px';
                box.appendChild(h);
                const ul = document.createElement('div');
                for (const r of results) {
                    const item = document.createElement('div');
                    item.style.margin = '0 0 12px';
                    const a = document.createElement('a');
                    a.href = r.url;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    a.textContent = r.title || r.url;
                    a.style.color = '#7fd1cf';
                    a.style.textDecoration = 'none';
                    a.addEventListener('mouseover', () => { a.style.textDecoration = 'underline'; });
                    a.addEventListener('mouseout', () => { a.style.textDecoration = 'none'; });
                    const p = document.createElement('div');
                    p.textContent = r.snippet || '';
                    p.style.opacity = '.75';
                    p.style.fontSize = '13px';
                    p.style.marginTop = '3px';
                    item.appendChild(a);
                    item.appendChild(p);
                    ul.appendChild(item);
                }
                box.appendChild(ul);
                // Return a single item that carries the bigbox content
                const item = {
                    "@type": 'command',
                    id: `google-${q}`,
                    title: `Google: ${q}`,
                    itemClass: `${results.length} results`,
                    searchText: `google ${q}`,
                    bigbox: box,
                    onSelect: () => {
                        if (results[0]?.url) window.open(results[0].url, '_blank');
                    }
                };
                return {items: [item]};
            } catch (e) {
                const el = document.createElement('div');
                el.innerHTML = `<div style=\"opacity:.7\">Error fetching results. Click to open Google search for \\\"${q}\\\".</div>`;
                const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
                return {items: [{ "@type": 'command', id: `google-${q}-err`, title: `Google: ${q}`, itemClass: 'error', searchText: `google ${q}`, bigbox: el, onSelect: () => window.open(url, '_blank') } ]};
            }
        });

        // Debounced fetch helper for Age prediction (500ms)
        const _ageDebounce = { timer: null, controller: null, resolvers: [], rejecters: [], lastQ: '' };
        function fetchAgeDebounced(name, delay = 500) {
            return new Promise((resolve, reject) => {
                const d = _ageDebounce;
                d.lastQ = name;
                d.resolvers.push(resolve);
                d.rejecters.push(reject);
                if (d.timer) clearTimeout(d.timer);
                // Abort any in-flight fetch since we'll issue a new one for the latest query
                if (d.controller) {
                    try { d.controller.abort(); } catch (_) { /* ignore */ }
                }
                d.timer = setTimeout(async () => {
                    const currentName = d.lastQ;
                    d.timer = null;
                    const ctrl = new AbortController();
                    d.controller = ctrl;
                    try {
                        const res = await fetch(`/ovum/spotlight/age?name=${encodeURIComponent(currentName)}`, { signal: ctrl.signal });
                        const data = await res.json();
                        const resolvers = d.resolvers.slice();
                        d.resolvers = [];
                        d.rejecters = [];
                        d.controller = null;
                        resolvers.forEach(fn => { try { fn(data); } catch (_) {} });
                    } catch (err) {
                        const rejecters = d.rejecters.slice();
                        d.resolvers = [];
                        d.rejecters = [];
                        d.controller = null;
                        rejecters.forEach(fn => { try { fn(err); } catch (_) {} });
                    }
                }, delay);
            });
        }

        // Demo: async keyword handler "age" that calls a PromptServer route and renders results in bigbox (debounced)
        window.OvumSpotlight?.registerKeywordHandler("age", async (text, ctx) => {
            ctx?.setPlaceholder?.("Predict the age of a person based on their name.");
            const name = (text || '').trim();
            if (!name) {
                const el = document.createElement('div');
                el.innerHTML = '<div style="opacity:.7">Type: age &lt;first name&gt;</div>';
                return {items: [{
                    "@type": 'command', id: 'age-help', title: "Age: enter a first name", itemClass: 'demo',
                    searchText: 'age help', bigbox: el
                }]};
            }
            try {
                const data = await fetchAgeDebounced(name, 500);
                const age = (data && typeof data.age !== 'undefined') ? data.age : null;
                const count = (data && typeof data.count !== 'undefined') ? data.count : null;
                // Build bigbox content
                const box = document.createElement('div');
                box.style.paddingRight = '6px';
                const h = document.createElement('div');
                h.textContent = `Predicted age for "${name}"`;
                h.style.fontWeight = '600';
                h.style.margin = '4px 0 10px';
                box.appendChild(h);
                const body = document.createElement('div');
                body.style.fontSize = '16px';
                body.style.opacity = '.9';
                if (age !== null && age !== undefined) {
                    body.innerHTML = `<div style="font-size:28px; font-weight:700; color:#9fe5e3;">${age}</div>` +
                        `<div style="opacity:.7; margin-top:6px;">Based on ${count ?? 'unknown'} record(s) from agify.io</div>`;
                } else {
                    body.innerHTML = `<div style="opacity:.7">No prediction available for \"${name}\".</div>`;
                }
                box.appendChild(body);
                // Return a single item that carries the bigbox content
                const item = {
                    "@type": 'command',
                    id: `age-${name}`,
                    title: `Age: ${name}`,
                    itemClass: (age !== null && age !== undefined) ? `~${age} years` : 'no data',
                    searchText: `age ${name}`,
                    bigbox: box
                };
                return {items: [item]};
            } catch (e) {
                const el = document.createElement('div');
                el.innerHTML = `<div style=\"opacity:.7\">Error fetching prediction for \\\"${name}\\\".</div>`;
                return {items: [{ "@type": 'command', id: `age-${name}-err`, title: `Age: ${name}`, itemClass: 'error', searchText: `age ${name}`, bigbox: el } ]};
            }
        });

        // Register default handler to:
        // 1) add a help command item
        // 2) contribute node items whose combobox widgets' current value matches the query
        // Note: Spotlight core will run FZF using each item's searchText; since default handlers
        // are not given the query directly, we include combobox values in searchText so they can match.
        window.OvumSpotlight?.registerDefaultHandler((ctx) => {
            const items = [];

            // Help/command item
            items.push({
                "@type": "command",
                id: "sample-help",
                title: "Sample Spotlight Provider: type 'sample <text>'",
                itemClass: "demo",
                searchText: "sample spotlight help",
                onSelect: () => {
                    app.extensionManager.toast.add({
                        severity: 'info',
                        summary: "Sample Spotlight Provider: type 'sample <text>'",
                        life: 5000,
                    });
                }
            });

            // Combobox search contribution: iterate all nodes (including subgraphs)
            // This generates a lot of extra items, but it's a good example of how to do things
            if (false) {
                const nodes = ctx.collectAllNodesRecursive();
                for (const {node, displayId, parentChain} of nodes) {
                    if (!Array.isArray(node.widgets)) {
                        continue;
                    }
                    for (const w of node.widgets) {
                        // Heuristics to detect combobox-like widgets in ComfyUI:
                        // - w.type === 'combo' (common), or
                        // - w.options is an array or object of allowed values.
                        const isCombo = (w && (w.type === 'combo' || Array.isArray(w.options) || (w.options && typeof w.options === 'object')));
                        if (!isCombo) {
                            continue;
                        }
                        const valueStr = String(w.value ?? "");
                        const nameStr = String(w.name ?? "Combo");

                        // Contribute an item per combobox widget so that FZF can match its value.
                        // searchText includes node identity plus the combobox name and current value.
                        items.push({
                            "@type": "node",
                            id: displayId,
                            title: `${node.title || node.type}  #${displayId}`,
                            // itemClass: `${nameStr}: ${valueStr}`,
                            itemClass: "Sample ComboBox Handler",
                            node,
                            itemSubtitlePath: parentChain,
                            searchText: `${node.title || node.type} ${node.type || ''} ${displayId} ${nameStr} ${valueStr}`
                        });
                    }
                }

                return {items};
            }
        });
    }
});
