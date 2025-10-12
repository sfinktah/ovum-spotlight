import {app} from "../../../scripts/app.js";
/** @typedef {import("./spotlight-typedefs.js").SpotlightUI} SpotlightUI */
/** @typedef {import("./spotlight-typedefs.js").SubgraphPathItem} SubgraphPathItem */
/** @typedef {import("./spotlight-typedefs.js").NodeItem} NodeItem */
/** @typedef {import("./spotlight-typedefs.js").LinkItem} LinkItem */
/** @typedef {import("./spotlight-typedefs.js").CommandItem} CommandItem */
/** @typedef {import("./spotlight-typedefs.js").SpotlightItem} SpotlightItem */
/** @typedef {import("./spotlight-typedefs.js").SpotlightHandlerContext} SpotlightHandlerContext */
/** @typedef {import("./spotlight-typedefs.js").KeywordHandler} KeywordHandler */
/** @typedef {import("./spotlight-typedefs.js").DefaultHandler} DefaultHandler */
/** @typedef {import("./spotlight-typedefs.js").ISpotlightRegistry} ISpotlightRegistry */

/**
 * Spotlight result item layout (four quadrants):
 **
 * (stupid AI diagrams **deleted**, let me draw it myself... they're all div elements except when they're not)
 * .ovum-spotlight-item (that's the entire result, i.e., an entire row)
 *      .item-main (the LHS of the row)
 *          .item-title-row > span.item-title-text (top of LHS column, i.e., TOP LEFT)
 *          .item-subtitle > .item-subtitle-item   (bottom of LHS column, i.e., BOTTOM LEFT)
 *      .item-meta (the RHS of the row)
 *          .item-class (top of RHS column, i.e., TOP RIGHT)
 *          .item-details (bottom of RHS column, i.e., BOTTOM RIGHT)
 */

// Plugin to provide the "node" keyword handler for Ovum Spotlight
app.registerExtension({
    name: "ovum.spotlight.keyword.node",
    setup () {
        /** @type {ISpotlightRegistry | undefined} */
        const OvumSpotlight = /** @type {ISpotlightRegistry | undefined} */ (window.OvumSpotlight);

        // Register keyword handler: "node"
        // Usage in Spotlight: "node <text>"
        OvumSpotlight?.registerKeywordHandler("node", (text, /** @type {SpotlightHandlerContext} */ ctx) => {
            ctx?.setPlaceholder?.("Search node titles, node ids, subgraph ids...");
            try {
                const list = ctx?.collectAllNodesRecursive?.() || [];
                const items = list.map(({node, displayId, parentChain}) => {
                    const widgetText = node.widgets && Array.isArray(node.widgets) ? node.widgets.map(w => `${w.name}:${w.value}`).join(" ") : "";
                    return ({
                        "@type": "node",
                        id: displayId,
                        title: `${node.title || node.type}  [${displayId}]`,
                        itemClass: node.type,
                        node,
                        itemSubtitlePath: parentChain,
                        itemDetails: widgetText,
                        searchText: `${node.title || node.type} ${node.type || ''} ${displayId} ${widgetText}`
                    });
                });
                return {items};
            } catch (e) {
                console.warn("OvumSpotlight node keyword handler error", e);
                return {items: []};
            }
        });
    }
});
