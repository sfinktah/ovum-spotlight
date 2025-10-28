/** @typedef {import("@comfyorg/comfyui-frontend-types").LGraphNode} LGraphNode */
/** @typedef {import("@comfyorg/comfyui-frontend-types").LLink} LLink */
/** @typedef {import("@comfyorg/comfyui-frontend-types").INodeInputSlot} INodeInputSlot */
/** @typedef {import("@comfyorg/comfyui-frontend-types").INodeOutputSlot} INodeOutputSlot */
/** @typedef {import("@comfyorg/comfyui-frontend-types").ISlotType} ISlotType */
/** @typedef {import("@comfyorg/comfyui-frontend-types").LiteGraph} LiteGraph */
/** @typedef {import("@comfyorg/comfyui-frontend-types").SubgraphIO} SubgraphIO */
/** @typedef {import('@comfyorg/comfyui-frontend-types').ComfyApp} ComfyApp */
/** @typedef {import('@comfyorg/comfyui-frontend-types').ToastMessageOptions} ToastMessageOptions */
/** @typedef {import("@comfyorg/comfyui-frontend-types").LGraphCanvas} LGraphCanvas */
/** @typedef {import("@comfyorg/comfyui-frontend-types").LGraph} LGraph */
/** @typedef {import("@comfyorg/comfyui-frontend-types").LLink} LLink */
/** @typedef {import("@comfyorg/comfyui-frontend-types").NodeInputSlot} NodeInputSlot */
/** @typedef {import("@comfyorg/comfyui-frontend-types").NodeOutputSlot} NodeOutputSlot */
/** @typedef {import("@comfyorg/comfyui-frontend-types").Subgraph} Subgraph */
/** @typedef {import("../typings/ComfyNode").ComfyNode} ComfyNode */
/** @typedef {import("../typings/app-import-types.js")} */
/** @typedef {import("../common/graphHelpersForTwinNodes.js").GraphHelpers} GraphHelpers */
/** @typedef {import("@comfyorg/comfyui-frontend-types").IWidget} IWidget */

/** @typedef {import('./spotlight-typedefs.js').SpotlightItem} SpotlightItem */

import {app} from "../../../scripts/app.js";
import {Fzf} from "/ovum-spotlight/node_modules/fzf/dist/fzf.es.js";
import filter from "/ovum-spotlight/node_modules/lodash-es/filter.js";
import first from "/ovum-spotlight/node_modules/lodash-es/first.js";
import {getNodeDefsCached} from "../common/ovum_helpers.js";
/** @type {ComfyApp} */
try { // noinspection SillyAssignmentJS
    app = app; } catch (_) {}


// Selection command implementations for Spotlight: remove, replace, bypass, color, align
// This plugin supplies handlers for the built-in labels so the palette buttons do real work.
app.registerExtension({
    name: "ovum.spotlight.selection-commands",
    setup () {
        // Wait for Spotlight API
        // @ts-ignore
        const api = (window.OvumSpotlight = window.OvumSpotlight || {});
        // Install handler bag consumed by spotlight.js built-in buttons
        // @ts-ignore
        api.__builtinHandlers = api.__builtinHandlers || {};

        function getGraph() { return app?.graph; }
        function requestDraw() { try { app?.canvas?.draw(true, true); } catch (_) {} }
        function closeSpotlightSafe() { try { api.close?.(); } catch (_) {} }

        /**
         * @param {SpotlightItem[]} selected
         * @returns {ComfyNode[]}
         */
        function toNodes(selected) {
            return (selected || []).map(it => it && it["@type"] === 'node' ? it.node : null).filter(Boolean);
        }
        /** @param {SpotlightItem[]} selected */
        function toLinks(selected) {
            return (selected || []).map(it => it && it["@type"] === 'link' ? it.link : null).filter(Boolean);
        }

        // remove: delete selected nodes and links
        api.__builtinHandlers.remove = ({ selected }) => {
            const graph = getGraph();
            if (!graph) return;
            const nodes = toNodes(selected);
            // const links = toLinks(selected);
            // // Remove links first, then nodes
            // for (const lk of links) {
            //     try { graph.removeLink?.(lk.id ?? lk); } catch (_) {}
            // }
            for (const n of nodes) {
                try { graph.remove(n); } catch (_) {}
            }
            requestDraw();
        };

        // bypass: rewire simple single-in single-out nodes and remove them
        api.__builtinHandlers.bypass = ({ selected }) => {
            const graph = getGraph();
            if (!graph) return;
            const nodes = toNodes(selected);
            for (const n of nodes) {
                try {
                    const inSlot = (n.inputs && n.inputs[0]) ? 0 : null;
                    const outSlot = (n.outputs && n.outputs[0]) ? 0 : null;
                    const hasSingleIn = inSlot === 0 && (!n.inputs || n.inputs.length === 1);
                    const hasSingleOut = outSlot === 0 && (!n.outputs || n.outputs.length === 1);
                    if (!(hasSingleIn && hasSingleOut)) {
                        // Try best-effort: connect all upstreams of slot 0 to all downstreams of slot 0
                        // Collect upstream
                        const upstreamLinks = (n.inputs?.[0]?.link != null) ? [graph.getLink?.(n.inputs[0].link)] : [];
                        const downstreamLinkIds = (n.outputs?.[0]?.links || []).slice();
                        for (const up of upstreamLinks) {
                            if (!up) continue;
                            for (const dId of downstreamLinkIds) {
                                const d = graph.getLink?.(dId);
                                if (!d) continue;
                                try {
                                    graph.connect(up.origin_id, up.origin_slot ?? 0, d.target_id, d.target_slot ?? 0);
                                } catch (_) {}
                            }
                        }
                        try { graph.remove?.(n); } catch (_) {}
                        continue;
                    }
                    // Simple case: one input link and N output links on slot 0
                    const inLinkId = n.inputs?.[0]?.link;
                    const outLinkIds = (n.outputs?.[0]?.links || []).slice();
                    if (inLinkId != null && outLinkIds.length) {
                        const inLink = graph.getLink?.(inLinkId);
                        if (inLink) {
                            for (const lid of outLinkIds) {
                                const outLink = graph.getLink?.(lid);
                                if (!outLink) continue;
                                try { graph.connect(inLink.origin_id, inLink.origin_slot ?? 0, outLink.target_id, outLink.target_slot ?? 0); } catch (_) {}
                            }
                        }
                    }
                    try { graph.remove?.(n); } catch (_) {}
                } catch (_) {}
            }
            requestDraw();
        };

        // color: set a simple preset color on nodes. Supports keywords in node title: red, green, blue, yellow, purple, cyan, orange, teal, none
        const colorMap = {
            // litegraph colors
            red:       { color: "#322",    bgcolor: "#533",    groupcolor: "#a88"    },
            brown:     { color: "#332922", bgcolor: "#593930", groupcolor: "#b06634" },
            green:     { color: "#232",    bgcolor: "#353",    groupcolor: "#8a8"    },
            blue:      { color: "#223",    bgcolor: "#335",    groupcolor: "#88a"    },
            pale_blue: { color: "#2a363b", bgcolor: "#3f5159", groupcolor: "#3f789e" },
            cyan:      { color: "#233",    bgcolor: "#355",    groupcolor: "#8aa"    },
            purple:    { color: "#323",    bgcolor: "#535",    groupcolor: "#a1309b" },
            yellow:    { color: "#432",    bgcolor: "#653",    groupcolor: "#b58b2a" },
            black:     { color: "#222",    bgcolor: "#000",    groupcolor: "#444"    },
            // extra colors
            indigo1:   { color: '#334',    bgcolor: '#446',    groupcolor: '#88a'    },
            indigo2:   { color: '#434',    bgcolor: '#646',    groupcolor: '#a8a'    },
            magenta1:  { color: '#424',    bgcolor: '#636',    groupcolor: '#a8a'    },
            magenta2:  { color: '#524',    bgcolor: '#735',    groupcolor: '#a88'    },
            olive:     { color: '#332',    bgcolor: '#553',    groupcolor: '#aa8'    },
            orange:    { color: '#532',    bgcolor: '#743',    groupcolor: '#a88'    },
            teal:      { color: '#244',    bgcolor: '#366',    groupcolor: '#8aa'    },

        }
        api.__builtinHandlers.color = ({ selected }) => {
            const nodes = toNodes(selected);
            if (!nodes.length) return;
            // Guess color from the first selected node title token if matches a preset; default to teal
            let picked = filter(colorMap, c => nodes[0].color === c.color || nodes[0].bgcolor === c.bgcolor);
            if (picked.length) {
                picked = first(picked);
                // Find next color in colorMap
                const colorKeys = Object.keys(colorMap);
                const currentIndex = colorKeys.findIndex(key => colorMap[key] === picked);
                const nextIndex = (currentIndex + 1) % colorKeys.length;
                picked = colorMap[colorKeys[nextIndex]];
            }
            else {
                picked = colorMap.teal;
            }
            
            for (const n of nodes) {
                try {
                    if (picked == null) {
                        delete n.bgcolor;
                    } else {
                        n.bgcolor = picked.bgcolor;
                        n.color = picked.color;
                    }
                } catch (_) {}
            }
            requestDraw();
        };

        // align: align selected nodes left and top with small vertical spacing
        api.__builtinHandlers.align = ({ selected }) => {
            const nodes = toNodes(selected);
            if (nodes.length < 2) return;
            const minX = Math.min(...nodes.map(n => n?.pos?.[0] ?? 0));
            let y = Math.min(...nodes.map(n => n?.pos?.[1] ?? 0));
            const gap = 20;
            for (const n of nodes.sort((a,b)=> (a.pos?.[1]??0) - (b.pos?.[1]??0))) {
                try {
                    n.pos = [minX, y];
                    y += (n.size?.[1] ?? 40) + gap;
                } catch (_) {}
            }
            requestDraw();
        };

        // select: select given nodes and fit view to selection
        api.__builtinHandlers.select = ({ selected }) => {
            try {
                const nodes = toNodes(selected);
                if (!nodes?.length) return;
                try { app?.canvas?.selectNodes?.(nodes, false); } catch (_) {}
                try { app?.canvas?.fitViewToSelectionAnimated?.(); } catch (_) {}
            } catch (_) {}
        };

        // replace: recreate nodes, optionally letting the user choose a target class via interactiveOpen
        api.__builtinHandlers.replace = async ({selected, args, interactiveOpen}) => {
            const graph = getGraph();
            const nodes = toNodes(selected);
            if (!nodes?.length) return;

            // Determine target type: from args or via interactive picker
            let targetType = args?.targetType;
            if (!targetType && typeof interactiveOpen === 'function') {
                try {
                    // Kick off async loading of node definitions in the background
                    const defsPromise = getNodeDefsCached().catch(e => { console.warn('getNodeDefsCached failed', e); return null; });
                    // Seed the query from the first selected node type to make autocomplete smarter
                    const defaultQuery = String((nodes?.[0]?.comfyClass || nodes?.[0]?.type || '') ?? '').trim();

                    // Open the interactive UI immediately with a minimal placeholder, then upgrade when defs arrive
                    targetType = await interactiveOpen((host, done, cancel) => {
                        host.innerHTML = '';

                        // Wrap done/cancel so we can stop background updates when dialog closes
                        let closed = false;
                        const doneWrap = (v) => { closed = true; try { done(v); } catch (_) {} };
                        const cancelWrap = () => { closed = true; try { cancel(); } catch (_) {} };

                        // Minimal layout while we wait
                        const box = document.createElement('div');
                        box.className = 'ovum-spotlight-interactive box box-compact';
                        const label = document.createElement('div');
                        label.textContent = 'Replace with node type…';
                        label.className = 'text-xs opacity-70 mb-1';
                        const waiting = document.createElement('div');
                        waiting.className = 'text-sm opacity-70 flex items-center gap-2';
                        const spinner = document.createElement('span');
                        spinner.className = 'loading loading-spinner loading-xs';
                        const waitText = document.createElement('span');
                        waitText.textContent = 'Loading node definitions, please wait…';
                        waiting.appendChild(spinner);
                        waiting.appendChild(waitText);
                        const controls = document.createElement('div');
                        controls.className = 'mt-2 flex gap-2';
                        const btnCancel = document.createElement('button');
                        btnCancel.className = 'btn btn-xs';
                        btnCancel.textContent = 'Cancel';
                        btnCancel.addEventListener('click', () => cancelWrap());
                        controls.appendChild(btnCancel);
                        box.appendChild(label);
                        box.appendChild(waiting);
                        box.appendChild(controls);
                        host.appendChild(box);

                        // When defs are ready, replace the placeholder with the full FZF-powered UI
                        defsPromise.then(defs => {
                            if (closed) return;
                            const classNames = defs ? Object.keys(defs).sort((a,b)=> a.localeCompare(b)) : [];

                            // Build enhanced FZF-backed list UI with better autocomplete
                            host.innerHTML = '';
                            const box = document.createElement('div');
                            box.className = 'ovum-spotlight-interactive box box-compact';
                            const label = document.createElement('div');
                            label.textContent = 'Replace with node type…';
                            label.className = 'text-xs opacity-70 mb-1';
                            const input = document.createElement('input');
                            input.className = 'input input-bordered input-xs w-full ovum-spotlight-ac-input';
                            input.placeholder = 'Type a node class (fuzzy, Tab to autocomplete)…';
                            const list = document.createElement('div');
                            list.className = 'ovum-spotlight-ac-list';
                            const controls = document.createElement('div');
                            controls.className = 'mt-2 flex gap-2';
                            const btnCancel = document.createElement('button');
                            btnCancel.className = 'btn btn-xs';
                            btnCancel.textContent = 'Cancel';
                            controls.appendChild(btnCancel);
                            box.appendChild(label);
                            box.appendChild(input);
                            box.appendChild(list);
                            box.appendChild(controls);
                            host.appendChild(box);

                            // Configure FZF (case-insensitive, normalize) for nicer matching
                            const fzf = new Fzf(classNames, { selector: (s)=> s, casing: 'case-insensitive', normalize: true });
                            let matches = classNames.map(s => ({ item: s }));
                            let activeIdx = 0;

                            const highlightMatch = (text, positions) => {
                                if (!positions || !positions.length) return text;
                                // positions are indices of matched chars; wrap them
                                let out = '';
                                const posSet = new Set(positions);
                                for (let i = 0; i < text.length; i++) {
                                    const ch = text[i];
                                    if (posSet.has(i)) out += '<mark class="px-0 py-0 bg-warning/30">' + ch.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</mark>';
                                    else out += ch.replace(/</g,'&lt;').replace(/>/g,'&gt;');
                                }
                                return out;
                            };

                            const renderList = () => {
                                list.innerHTML = '';
                                const slice = matches.slice(0, 200);
                                slice.forEach((m, idx) => {
                                    const div = document.createElement('div');
                                    div.className = 'ovum-spotlight-ac-item' + (idx===activeIdx ? ' active' : '');
                                    // try to highlight the matched characters if provided by fzf
                                    try {
                                        if (m.positions) {
                                            div.innerHTML = highlightMatch(m.item, m.positions);
                                        } else {
                                            div.textContent = m.item;
                                        }
                                    } catch(_) { div.textContent = m.item; }
                                    div.addEventListener('click', () => doneWrap(m.item));
                                    div.addEventListener('mousemove', () => { if (activeIdx !== idx) { activeIdx = idx; renderList(); } });
                                    list.appendChild(div);
                                });
                                const activeEl = list.children[activeIdx];
                                if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
                            };

                            const doSearch = () => {
                                const q = input.value || '';
                                matches = q ? fzf.find(q) : classNames.map(s=>({item:s}));
                                // Keep activeIdx within bounds and prefer exact match if present
                                const exactIdx = matches.findIndex(m => m.item === q && q.length > 0);
                                activeIdx = exactIdx >= 0 ? exactIdx : 0;
                                renderList();
                            };

                            const move = (d) => {
                                if (!matches.length) return;
                                activeIdx = Math.max(0, Math.min(matches.length - 1, activeIdx + d));
                                renderList();
                            };

                            const page = (d) => {
                                if (!matches.length) return;
                                activeIdx = Math.max(0, Math.min(matches.length - 1, activeIdx + d * 10));
                                renderList();
                            };

                            const accept = () => {
                                const m = matches?.[activeIdx];
                                if (m) doneWrap(m.item);
                            };

                            const autocomplete = () => {
                                const m = matches?.[activeIdx];
                                if (m) {
                                    input.value = m.item;
                                    doSearch();
                                    // place caret at end
                                    try { input.setSelectionRange(input.value.length, input.value.length); } catch(_) {}
                                }
                            };

                            input.addEventListener('keydown', (e) => {
                                if (e.key === 'Escape') { e.preventDefault(); cancelWrap(); }
                                else if (e.key === 'Enter') { e.preventDefault(); accept(); }
                                else if (e.key === 'Tab' || e.key === 'ArrowRight') { e.preventDefault(); autocomplete(); }
                                else if (e.key === 'ArrowDown') { e.preventDefault(); move(+1); }
                                else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
                                else if (e.key === 'PageDown') { e.preventDefault(); page(+1); }
                                else if (e.key === 'PageUp') { e.preventDefault(); page(-1); }
                                else if (e.key === 'Home') { e.preventDefault(); activeIdx = 0; renderList(); }
                                else if (e.key === 'End') { e.preventDefault(); activeIdx = Math.max(0, matches.length - 1); renderList(); }
                                e.stopPropagation();
                            });
                            input.addEventListener('input', doSearch);
                            btnCancel.addEventListener('click', () => cancelWrap());

                            // Seed with the defaultQuery (current node type) to improve autocomplete context
                            if (defaultQuery) {
                                input.value = defaultQuery;
                                doSearch();
                                // If the exact type exists, preselect it so Enter accepts it quickly
                                const exactIdx = matches.findIndex(m => m.item === defaultQuery);
                                if (exactIdx >= 0) { activeIdx = exactIdx; renderList(); }
                            } else {
                                renderList();
                            }
                            setTimeout(()=> input.focus(), 0);
                        }).catch(e => {
                            if (closed) return;
                            // Show failure state if defs could not be loaded
                            waiting.textContent = 'Failed to load node definitions.';
                            console.warn('replace interactive picker failed to load defs', e);
                        });
                    });
                } catch (e) {
                    console.warn('replace interactive picker failed', e);
                }
            }

            const LiteGraph = window.LiteGraph;
            for (const node of nodes) {
                if (node.comfyClass || node.type) {
                    const originalType = node.comfyClass || node.type;
                    const type = targetType || originalType;
                    const newNode = LiteGraph.createNode?.(type);
                    if (!newNode) {
                        continue;
                    }
                    newNode.title = node.title;
                    // Port the position, size, and properties from the old node.
                    try { newNode.pos = [...node.pos]; } catch(_) { newNode.pos = node.pos ? [node.pos[0], node.pos[1]] : [0,0]; }
                    try { newNode.size = [...node.size]; } catch(_) { if (node.size) newNode.size = [node.size[0], node.size[1]]; }
                    try { newNode.properties = {...node.properties}; } catch(_) {}
                    // Collect links data before removal
                    const links = [];
                    const g = (node.graph || app.graph);
                    for (const [index, output] of (node.outputs||[]).entries()) {
                        for (const linkId of output.links || []) {
                            const link = g.links?.[linkId];
                            if (!link) continue;
                            const targetNode = g.getNodeById?.(link.target_id);
                            if (targetNode) links.push({node: newNode, slot: index, targetNode, targetSlot: link.target_slot});
                        }
                    }
                    for (const [index, input] of (node.inputs||[]).entries()) {
                        const linkId = input?.link;
                        if (linkId != null) {
                            const link = g.links?.[linkId];
                            if (!link) continue;
                            const originNode = g.getNodeById?.(link.origin_id);
                            if (originNode) links.push({ node: originNode, slot: link.origin_slot, targetNode: newNode, targetSlot: index });
                        }
                    }
                    try { graph.add?.(newNode); } catch(_) {}
                    for (const link of links) {
                        try { link.node.connect?.(link.slot, link.targetNode, link.targetSlot); } catch(_) {}
                    }
                    try { graph.remove?.(node); } catch(_) {}
                }
            }
            requestDraw();
        };
    }
});
