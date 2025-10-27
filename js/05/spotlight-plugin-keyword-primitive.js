import {app} from "../../../scripts/app.js";
/** @typedef {import("./spotlight-typedefs.js").ISpotlightRegistry} ISpotlightRegistry */
/** @typedef {import("./spotlight-typedefs.js").SpotlightHandlerContext} SpotlightHandlerContext */
/** @typedef {import("./spotlight-typedefs.js").CommandItem} CommandItem */

// Plugin to provide primitive quick-create via keywords: "int", "float", "string"
// Usage examples inside Spotlight input:
//   int = 5
//   float = 3.14
//   string = "hello world"
// Selecting the command will create a Primitive* node at the visible center and select it.
app.registerExtension({
    name: "ovum.spotlight.keyword.primitive",
    setup () {
        /** @type {ISpotlightRegistry | undefined} */
        const OvumSpotlight = /** @type {ISpotlightRegistry | undefined} */ (window.OvumSpotlight);

        /**
         * Parse pattern "[name] = value" after a given primitive type.
         * Name is optional and may be quoted. Value parsing depends on kind.
         * Accepts forms like:
         *   = 3
         *   steps = 3
         *   "my name"=3.5
         * @param {"int"|"float"|"string"} kind
         * @param {string} text
         * @returns {{ok:boolean, name:string, displayValue:string, value:any}}
         */
        function parseNameAndValue(kind, text) {
            const s = String(text || "").trim();
            let name = "";
            let rest = "";
            // Try to match: <name> = <value>  where <name> may be quoted or unquoted token
            const mName = s.match(/^((?:"([^"]+)"|'([^']+)'|[^\s=]+))\s*=\s*(.*)$/);
            if (mName) {
                name = (mName[2] ?? mName[3] ?? mName[1]) || "";
                // If name was quoted, mName[1] contains quotes; prefer captured without quotes
                if ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith("'") && name.endsWith("'"))) {
                    name = name.slice(1, -1);
                }
                rest = mName[4] ?? "";
            } else {
                // Fallback: no name, just "= value"
                const mEq = s.match(/^=\s*(.*)$/);
                if (!mEq) return { ok:false, name:"", displayValue:"", value:null };
                rest = mEq[1] ?? "";
            }
            let raw = String(rest).trim();
            if (kind === 'int') {
                const mm = raw.match(/^[+-]?\d+/);
                if (!mm) return { ok:false, name, displayValue:"", value:null };
                const n = parseInt(mm[0], 10);
                return { ok:true, name, displayValue: String(n), value: n };
            }
            if (kind === 'float') {
                const mm = raw.match(/^[+-]?(?:\d*\.\d+|\d+\.\d*|\d+)(?:[eE][+-]?\d+)?/);
                if (!mm) return { ok:false, name, displayValue:"", value:null };
                const n = parseFloat(mm[0]);
                return { ok:true, name, displayValue: String(n), value: n };
            }
            // string: accept quoted or unquoted remainder
            if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
                raw = raw.slice(1, -1);
            }
            return { ok:true, name, displayValue: raw, value: raw };
        }

        /**
         * Create a Primitive* node, set widgets, position at visible center, and select it.
         * @param {"int"|"float"|"string"} kind
         * @param {any} value
         */
        function createPrimitiveNode(kind, value, name, ui) {
            try {
                const canvas = app?.canvas;
                const graph = app?.graph;
                const LiteGraph = window.LiteGraph;
                if (!canvas || !graph || !LiteGraph) return;

                const typeMap = { int: 'PrimitiveInt', float: 'PrimitiveFloat', string: 'PrimitiveString' };
                const nodeType = typeMap[kind];
                const node = LiteGraph.createNode(nodeType);
                if (!node) return;

                // Apply optional title/name
                try {
                    if (name && typeof name === 'string') {
                        node.title = name;
                    }
                } catch (_) { /* ignore */ }

                // Set widget values
                try {
                    if (Array.isArray(node.widgets)) {
                        for (const w of node.widgets) {
                            if (!w) continue;
                            if (String(w.name).toLowerCase() === 'value') {
                                // direct set; many widgets react to .value change
                                w.value = value;
                            }
                            if (kind === 'int' && String(w.name).toLowerCase() === 'control_after_generate') {
                                w.value = 'fixed';
                            }
                        }
                        if (typeof node.onResize === 'function') node.onResize(node.size);
                        if (typeof node.onPropertyChanged === 'function') node.onPropertyChanged('value', value);
                    }
                } catch (_) { /* ignore */ }

                const ds = canvas?.ds;
                if (ds && ds.element) {
                    const el = ds.element;
                    const cw = el.width / (window.devicePixelRatio || 1);
                    const ch = el.height / (window.devicePixelRatio || 1);
                    const startX = ds.offset[0];
                    const startY = ds.offset[1];
                    const startScale = ds.scale;
                    const cx = (cw * 0.5 - startX) * startScale;
                    const cy = (ch * 0.5 - startY) * startScale;
                    node.pos = [cx, cy];
                }
                graph.add(node);

                // Select the node
                try { canvas.selectNode(node, false); } catch (_) { /* ignore */ }
                try { canvas.setDirty?.(true, true); } catch (_) { /* ignore */ }
            } catch (e) {
                console.warn('OvumSpotlight primitive create error', e);
            }
        }

        /**
         * Register a keyword handler for a given primitive kind.
         * @param {"int"|"float"|"string"} kind
         */
        function register(kind) {
            OvumSpotlight?.registerKeywordHandler(kind, (text, /** @type {SpotlightHandlerContext} */ ctx) => {
                ctx?.setPlaceholder?.(`${kind}: node_name = <value>`);
                const { ok, name, displayValue, value } = parseNameAndValue(kind, text || '');
                if (!ok) return { items: [] };
                const prettyName = name ? ` named "${name}"` : "";
                /** @type {CommandItem} */
                const item = {
                    "@type": 'command',
                    id: `${kind}-create-${name || 'anon'}-${displayValue}`,
                    // We want "node" in lowercase
                    title: `Create a primitive ${kind} node${prettyName} with the value \`${displayValue}\``,
                    itemClass: 'create',
                    // Include forms that match the user's current query (e.g., "= 3", "steps = 3") so fzf doesn't hide it
                    searchText: `${kind} create ${displayValue} = ${displayValue} ${name ? name + ' = ' + displayValue : ''}`.trim(),
                    onSelect: () => createPrimitiveNode(kind, value, name)
                };
                return { items: [item] };
            });
        }

        register('int');
        register('float');
        register('string');
    }
});
