// Helper graph-related utilities for Spotlight
/** @typedef {import("./spotlight-typedefs.js").SpotlightHandlerContext} SpotlightHandlerContext */
/** @typedef {import("./spotlight-typedefs.js").WidgetMatch} WidgetMatch */
import {app} from "../../../scripts/app.js";

/** Get the current LiteGraph graph instance from the ComfyUI app.
 * @returns {any}
 */
export function getGraph () {
    return app?.graph;
}

/** Get all nodes from the current graph.
 * @returns {any[]}
 */
export function allNodes () {
    return getGraph()?._nodes ?? [];
}

/** Get all links from the current graph as an id->link map.
 * @returns {Record<string, any>}
 */
export function allLinks () {
    return getGraph()?.links ?? {};
}

/**
 * Navigate the canvas to the item's graph context, select it, and focus via a provided function.
 * Consolidates previously duplicated logic from spotlight.js.
 * @param {{"@type"?:string,node?:any,link?:any,itemSubtitlePath?:any[]}|null|undefined} it
 * @param {(node:any)=>void} focusFn - callback to focus a node (e.g., overlay-aware center)
 * @param {{delay?:number}} [opts]
 */
export function navigateToItemAndFocus (it, focusFn, opts = {}) {
    const delay = opts.delay ?? 75;
    try {
        if (!it || typeof focusFn !== "function") {
            return;
        }
        const kind = it?.["@type"];
        if (kind === 'node' && it.node) {
            // Ensure we are at root graph
            const rootGraph = app.graph;
            if (app.canvas.graph !== rootGraph) {
                if (typeof app.canvas.setGraph === 'function') {
                    app.canvas.setGraph(rootGraph);
                } else {
                    app.canvas.graph = rootGraph;
                }
            }
            const chain = Array.isArray(it.itemSubtitlePath) ? it.itemSubtitlePath : [];
            if (chain.length > 0) {
                for (const parentNode of chain) {
                    if (parentNode?.subgraph) {
                        if (typeof app.canvas.openSubgraph === 'function') {
                            app.canvas.openSubgraph(parentNode.subgraph);
                        } else if (typeof app.canvas.setGraph === 'function') {
                            app.canvas.setGraph(parentNode.subgraph);
                        } else if (app.canvas.graph !== parentNode.subgraph) {
                            app.canvas.graph = parentNode.subgraph;
                        }
                    }
                }
                setTimeout(() => {
                    app.canvas.selectNode(it.node, false);
                    focusFn(it.node);
                }, Math.max(0, delay));
            } else {
                app.canvas.selectNode(it.node, false);
                focusFn(it.node);
            }
        } else if (kind === 'link' && it.link) {
            const origin = app.graph?.getNodeById?.(it.link.origin_id);
            if (origin) {
                app.canvas.selectNode(origin, false);
                focusFn(origin);
            }
        }
    } catch (_) {
        app.canvas.fitViewToSelectionAnimated?.();
    }
}

/**
 * Collect all nodes from the current graph and nested subgraphs.
 * Each entry includes a displayId that encodes the subgraph path (e.g., "2.5").
 * @param {string} [parentPath]
 * @param {any[]} [parentChain]
 * @returns {{node:any, id:number|string, displayId:string, parentChain:any[]}[]}
 */
export function collectAllNodesRecursive (parentPath = "", parentChain = []) {
    const result = [];
    const nodes = allNodes();

    for (const node of nodes) {
        const nodeId = parentPath ? `${parentPath}:${node.id}` : String(node.id);
        result.push({node, id: nodeId, displayId: nodeId, parentChain: [...parentChain]});

        // Check if this node has a subgraph
        if (node.subgraph && node.subgraph._nodes) {
            const subgraph = node.subgraph;
            const newParentChain = [...parentChain, node];
            const collectSubgraphNodes = (sg, path, chain) => {
                for (const subNode of sg._nodes) {
                    const subNodeId = `${path}:${subNode.id}`;
                    result.push({node: subNode, id: subNodeId, displayId: subNodeId, parentChain: [...chain]});

                    // Recursively check for nested subgraphs
                    if (subNode.subgraph && subNode.subgraph._nodes) {
                        const nestedSubgraph = subNode.subgraph;
                        collectSubgraphNodes(nestedSubgraph, subNodeId, [...chain, subNode]);
                    }
                }
            };
            collectSubgraphNodes(subgraph, nodeId, newParentChain);
        }
    }

    return result;
}

/**
 * Returns true if the provided text looks like a numeric id path such as "12" or "2:5:7".
 * @param {string} t
 * @returns {boolean}
 */
export function isNumericLike (t) {
    return /^\d[:\d]*$/.test(t.trim());
}

/**
 * Find a widget whose value best matches the given search text and return snippet + highlight positions.
 * @param {any} node
 * @param {string} searchText
 * @returns {WidgetMatch|null}
 */
export function findWidgetMatch (node, searchText) {
    if (!node || !Array.isArray(node.widgets) || !searchText) {
        return null;
    }
    const hayFull = String(searchText).toLowerCase();
    // Prepare candidate tokens: prefer longer, non-numeric tokens
    const rawTokens = hayFull.split(/\s+/).filter(Boolean);
    const tokens = rawTokens
        .map(t => t.trim())
        .filter(t => t.length >= 2)
        .sort((a, b) => b.length - a.length);

    for (let i = 0; i < node.widgets.length; i++) {
        const widget = node.widgets[i];
        const rawVal = widget?.value;
        const valueStr = String(rawVal ?? "");
        if (!valueStr) continue;
        const lc = valueStr.toLowerCase();

        // First, try full query as contiguous substring
        const idxFull = lc.indexOf(hayFull);
        if (idxFull !== -1) {
            const name = String(widget?.name ?? "Widget");
            const positionsAbs = [];
            for (let p = idxFull; p < idxFull + hayFull.length; p++) positionsAbs.push(p);
            // Build snippet centered around the match
            const context = 12;
            const minIdx = Math.min(...positionsAbs);
            const maxIdx = Math.max(...positionsAbs) + 1;
            const snippetStart = Math.max(0, minIdx - context);
            const snippetEnd = Math.min(valueStr.length, maxIdx + context);
            // Enforce a hard cap of 32 characters for the displayed snippet
            let sStart = snippetStart;
            let sEnd = snippetEnd;
            const maxLen = 32;
            if ((sEnd - sStart) > maxLen) {
                const center = Math.floor((minIdx + maxIdx) / 2);
                sStart = Math.max(0, center - Math.floor(maxLen / 2));
                sEnd = Math.min(valueStr.length, sStart + maxLen);
                // ensure match still fully visible
                if (sStart > minIdx) sStart = Math.max(0, minIdx);
                if (sEnd < maxIdx) sEnd = Math.min(valueStr.length, maxIdx);
            }
            const snippet = valueStr.slice(sStart, sEnd);
            const matchPositions = positionsAbs.map(p => p - sStart);
            const prefix = sStart > 0 ? "…" : "";
            const suffix = sEnd < valueStr.length ? "…" : "";
            return { widget, index: i, value: valueStr, name, snippet, matchPositions, prefix, suffix };
        }

        // Otherwise, accumulate matches for any tokens present in the value
        const positionsAbs = [];
        for (const tok of tokens) {
            const j = lc.indexOf(tok);
            if (j !== -1) {
                for (let p = j; p < j + tok.length; p++) positionsAbs.push(p);
            }
        }
        if (positionsAbs.length) {
            const name = String(widget?.name ?? "Widget");
            // Build snippet around the union of token matches
            positionsAbs.sort((a,b)=>a-b);
            const context = 12;
            const minIdx = positionsAbs[0];
            const maxIdx = positionsAbs[positionsAbs.length - 1] + 1;
            const snippetStart = Math.max(0, minIdx - context);
            const snippetEnd = Math.min(valueStr.length, maxIdx + context);
            const snippet = valueStr.slice(snippetStart, snippetEnd);
            const matchPositions = positionsAbs.map(p => p - snippetStart);
            const prefix = snippetStart > 0 ? "…" : "";
            const suffix = snippetEnd < valueStr.length ? "…" : "";
            return { widget, index: i, value: valueStr, name, snippet, matchPositions, prefix, suffix };
        }
    }
    return null;
}
