import {app} from "../../../scripts/app.js";

/** @typedef {import('./spotlight-typedefs.js').SpotlightItem} SpotlightItem */

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

        /** @param {SpotlightItem[]} selected */
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
            const links = toLinks(selected);
            // Remove links first, then nodes
            for (const lk of links) {
                try { graph.removeLink?.(lk.id ?? lk); } catch (_) {}
            }
            for (const n of nodes) {
                try { graph.removeNode?.(n); } catch (_) {}
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
                        try { graph.removeNode?.(n); } catch (_) {}
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
                    try { graph.removeNode?.(n); } catch (_) {}
                } catch (_) {}
            }
            requestDraw();
        };

        // color: set a simple preset color on nodes. Supports keywords in node title: red, green, blue, yellow, purple, cyan, orange, teal, none
        const colorMap = {
            red:    "#533",
            green:  "#353",
            blue:   "#335",
            yellow: "#653",
            purple: "#535",
            cyan:   "#355",
            orange: "#743",
            teal:   "#366",
            none:   null
        };
        api.__builtinHandlers.color = ({ selected }) => {
            const nodes = toNodes(selected);
            if (!nodes.length) return;
            // Guess color from the first selected node title token if matches a preset; default to teal
            let picked = "#366";
            try {
                const title = String(nodes[0]?.title || "").toLowerCase();
                for (const k of Object.keys(colorMap)) {
                    if (title.includes(k)) { picked = colorMap[k] || null; break; }
                }
            } catch (_) {}
            for (const n of nodes) {
                try {
                    if (picked == null) {
                        delete n.bgcolor;
                    } else {
                        n.bgcolor = picked;
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

        // replace: minimal implementation – recreate nodes of the same type and swap
        api.__builtinHandlers.replace = ({ selected }) => {
            const graph = getGraph();
            const nodes = toNodes(selected);
            if (!graph || !nodes.length) return;
            for (const oldNode of nodes) {
                try {
                    const type = oldNode.type || oldNode.comfyClass || oldNode.title;
                    if (!type) continue;
                    const fresh = LiteGraph.createNode?.(type);
                    if (!fresh) continue;
                    graph.add(fresh);
                    // Position new node at the old position
                    fresh.pos = [oldNode.pos?.[0] ?? 0, (oldNode.pos?.[1] ?? 0) + 10];
                    // Attempt to rewire: connect inputs/outputs 1:1 by slot index
                    try {
                        // Inputs: for each input slot, if old had a link, connect it to fresh
                        const inCount = (oldNode.inputs || []).length;
                        for (let i = 0; i < inCount; i++) {
                            const linkId = oldNode.inputs?.[i]?.link;
                            if (linkId != null) {
                                const l = graph.getLink?.(linkId);
                                if (l) {
                                    try { graph.connect(l.origin_id, l.origin_slot ?? 0, fresh.id, i); } catch (_) {}
                                }
                            }
                        }
                        // Outputs: connect fresh outputs to the same targets
                        const outCount = (oldNode.outputs || []).length;
                        for (let o = 0; o < outCount; o++) {
                            const outLinks = oldNode.outputs?.[o]?.links || [];
                            for (const lid of outLinks) {
                                const l = graph.getLink?.(lid);
                                if (l) {
                                    try { graph.connect(fresh.id, o, l.target_id, l.target_slot ?? 0); } catch (_) {}
                                }
                            }
                        }
                    } catch (_) {}
                    // Remove old
                    try { graph.removeNode?.(oldNode); } catch (_) {}
                } catch (_) {}
            }
            requestDraw();
        };
    }
});
