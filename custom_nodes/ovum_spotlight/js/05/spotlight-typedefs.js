// JSDoc typedefs for Ovum Spotlight core and plugin API
// This file contains types shared across spotlight.js and spotlight plugins.
// Import in JSDoc via:
// /** @typedef {import("./spotlight-typedefs.js").SpotlightUI} SpotlightUI */
// /** @typedef {import("./spotlight-typedefs.js").SubgraphPathItem} SubgraphPathItem */
// /** @typedef {import("./spotlight-typedefs.js").NodeItem} NodeItem */
// /** @typedef {import("./spotlight-typedefs.js").LinkItem} LinkItem */
// /** @typedef {import("./spotlight-typedefs.js").CommandItem} CommandItem */
// /** @typedef {import("./spotlight-typedefs.js").SpotlightItem} SpotlightItem */
// /** @typedef {import("./spotlight-typedefs.js").SpotlightHandlerContext} SpotlightHandlerContext */
// /** @typedef {import("./spotlight-typedefs.js").KeywordHandler} KeywordHandler */
// /** @typedef {import("./spotlight-typedefs.js").DefaultHandler} DefaultHandler */
// /** @typedef {import("./spotlight-typedefs.js").ISpotlightRegistry} ISpotlightRegistry */
// /** @typedef {import("./spotlight-typedefs.js").WidgetMatch} WidgetMatch */
// /** @typedef {import("./spotlight-typedefs.js").HighlightPositions} HighlightPositions */

/**
 * @typedef {Object} SpotlightUI
 * @property {HTMLDivElement} wrap
 * @property {HTMLInputElement} input
 * @property {HTMLDivElement} list
 * @property {HTMLDivElement} badge
 * @property {HTMLDivElement} bigbox
 */

/**
 * @typedef {Object} SubgraphPathItem
 * @property {any} node The subgraph holder node in the chain.
 * @property {string} title Display title.
 * @property {number|string} displayId Display id for UI (may differ from node.id in subgraphs).
 */

/**
 * @typedef {Object} NodeItem
 * @property {"node"} ["@type"]
 * @property {number|string} id Display id used by spotlight (e.g., "3.7" in subgraphs)
 * @property {string} title
 * @property {string} [itemClass] Node class/type label displayed on the right side
 * @property {any} node The underlying LiteGraph node
 * @property {any[]} [itemSubtitlePath] Chain of parent subgraph-holder nodes for UI breadcrumbs
 * @property {string} [itemDetails]
 * @property {string} [searchText]
 */

/**
 * @typedef {Object} LinkItem
 * @property {"link"} ["@type"]
 * @property {number} id
 * @property {string} title
 * @property {any} link Underlying link object
 * @property {string} [searchText]
 */

/**
 * @typedef {Object} CommandItem
 * @property {"command"} ["@type"]
 * @property {string} id
 * @property {string} title
 * @property {string} [itemClass] Small label rendered on the right side
 * @property {HTMLElement} [bigbox]
 * @property {() => void} [onSelect]
 * @property {string} [searchText]
 */

/** @typedef {(NodeItem|LinkItem|CommandItem)} SpotlightItem */

/**
 * @typedef {Object} SpotlightHandlerContext
 * @property {typeof import("../../../scripts/app.js").app} app ComfyUI app
 * @property {() => any} getGraph Returns current graph
 * @property {() => any[]} allNodes Returns all nodes in the current graph
 * @property {() => Record<string, any>} allLinks Returns all links in the current graph
 * @property {(parentPath?:string, parentChain?:any[]) => {node:any, id:number|string, displayId:string, parentChain:any[]}[]} collectAllNodesRecursive Collect nodes across subgraphs
 * @property {(s:string)=>void} [setPlaceholder] Update the spotlight input placeholder while active
 */

/**
 * @callback KeywordHandler
 * @param {string} text The text after the keyword
 * @param {SpotlightHandlerContext} ctx Context helpers
 * @returns {{items: SpotlightItem[]}|Promise<{items: SpotlightItem[]}>}
 */

/**
 * @callback DefaultHandler
 * @param {{app: SpotlightHandlerContext['app'], getGraph:SpotlightHandlerContext['getGraph'], allNodes:SpotlightHandlerContext['allNodes'], allLinks:SpotlightHandlerContext['allLinks'], collectAllNodesRecursive:SpotlightHandlerContext['collectAllNodesRecursive']}} ctx
 * @returns {{items: SpotlightItem[]}|Promise<{items: SpotlightItem[]}>}
 */

/**
 * Simple plugin registry to allow external nodes to inject spotlight search providers.
 * @typedef {Object} ISpotlightRegistry
 * @property {Map<string, KeywordHandler>} keywordHandlers
 * @property {DefaultHandler[]} defaultHandlers
 * @property {(keyword:string, callback:KeywordHandler)=>void} registerKeywordHandler
 * @property {(callback:DefaultHandler)=>void} registerDefaultHandler
 * @property {(s:string)=>void} [_setPlaceholder]
 */

/**
 * Highlight positions array used for text highlighting utilities.
 * @typedef {number[]} HighlightPositions
 */

/**
 * Match info for a node widget value used by search highlighting.
 * @typedef {Object} WidgetMatch
 * @property {any} widget
 * @property {number} index
 * @property {string} value
 * @property {string} name
 * @property {string} snippet
 * @property {number[]} matchPositions
 * @property {string} prefix
 * @property {string} suffix
 */

// Ensure this file is treated as a module by TypeScript/IDEs so types can be imported.
export {};