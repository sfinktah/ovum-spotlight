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
// /** @typedef {import("./spotlight-typedefs.js").FilterFn} FilterFn */
// /** @typedef {import("./spotlight-typedefs.js").ParsedFilter} ParsedFilter */
// /** @typedef {import("./spotlight-typedefs.js").WidgetMatch} WidgetMatch */
// /** @typedef {import("./spotlight-typedefs.js").HighlightPositions} HighlightPositions */

/**
 * @typedef {Object} SpotlightUI
 * @property {HTMLDivElement} wrap
 * @property {HTMLInputElement} input
 * @property {HTMLDivElement} list
 * @property {HTMLDivElement} badge
 * @property {HTMLDivElement} bigbox
 * @property {HTMLDivElement} [footer]
 * @property {HTMLDivElement} [palettePrimary]
 * @property {HTMLDivElement} [paletteSelection]
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
 * @property {(string|String[])[]} [searchJson] Nested JSON-like array used for FZF mapping: [title, itemClass, itemSubtitlePath:string[], itemDetails:string[]]
 * @property {string} [searchFlat] Flat string derived from searchJson used by FZF selector
 * @property {{ title:[number,number], itemClass:[number,number], subtitles:{text:string,start:number,end:number}[], details:{text:string,start:number,end:number}[] }} [searchOffsets] Character offset map for searchFlat to map fzf positions back to fields
 * @property {any} [payload] Arbitrary plugin-defined object passed through to custom actions
 */

/**
 * @typedef {Object} LinkItem
 * @property {"link"} ["@type"]
 * @property {number} id
 * @property {string} title
 * @property {any} link Underlying link object
 * @property {string} [searchText]
 * @property {any} [payload] Arbitrary plugin-defined object passed through to custom actions
 */

/**
 * @typedef {Object} CommandItem
 * @property {"command"} ["@type"]
 * @property {string} id
 * @property {string} title
 * @property {string} [itemClass] Small label rendered on the right side
 * @property {HTMLElement} [bigbox]
 * @property {(item:CommandItem) => void} [onSelect]
 * @property {string} [searchText]
 * @property {any} [payload] Arbitrary plugin-defined object passed through to custom actions
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
 * @property {Map<string, FilterFn>} [filters]
 * @property {(keyword:string, callback:KeywordHandler)=>void} registerKeywordHandler
 * @property {(callback:DefaultHandler)=>void} registerDefaultHandler
 * @property {(cmd:SpotlightCommand)=>void} [registerSelectionCommand]
 * @property {(s:string)=>void} [_setPlaceholder]
 * @property {(nodeType:string, fn: NodeInfoProvider)=>void} [registerNodeInfoProvider]
 * @property {(args:MakeNodeItemArgs) => NodeItem} [makeNodeItem]
 * @property {(name:string, callback:FilterFn)=>void} [registerFilter]
 */

/**
 * Filter function for items.
 * @callback FilterFn
 * @param {SpotlightItem} item
 * @param {string} value
 * @returns {boolean|Promise<boolean>}
 */

/**
 * Parsed filter key/value pair from the user query.
 * @typedef {Object} ParsedFilter
 * @property {string} name
 * @property {string} value
 * @property {string} [raw]
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
/**
 * Command button shown in the Spotlight footer palettes.
 * External modules can register commands that will appear when selection is active.
 * @typedef {Object} SpotlightCommand
 * @property {string} id Unique id
 * @property {string} label Button label
 * @property {boolean} [primary] If true, show in the primary palette (always visible); otherwise in selection palette when items selected
 * @property {(ctx:SpotlightCommandContext)=>void|Promise<void>} run Handler called when command is clicked
 * @property {(items:SpotlightItem[])=>boolean} [isApplicable] Optional filter, when provided the command only shows if it returns true for current selection
 */

/**
 * Context object provided to command handlers.
 * @typedef {Object} SpotlightCommandContext
 * @property {SpotlightItem[]} selected Selected items (usually nodes/links)
 * @property {SpotlightHandlerContext['app']} app ComfyUI app
 * @property {SpotlightHandlerContext['getGraph']} getGraph Get current graph
 * @property {()=>void} close Close Spotlight
 * @property {(builder:(host:HTMLElement, done:(value:any)=>void, cancel:()=>void)=>void|Promise<void>)=>Promise<any>} [interactiveOpen] Open an interactive mini UI and resolve with a value.
 * @property {()=>void} [interactiveClose] Close the interactive mini UI if open.
 */

/**
 * Registry for footer palette commands.
 * @typedef {Object} ISpotlightCommandRegistry
 * @property {(cmd:SpotlightCommand)=>void} registerPaletteCommand Register a new command
 * @property {()=>void} clearPaletteCommands Remove all previously registered commands
 */

export {};
/**
 * Extra Spotlight info that a node can provide via UI JS.
 * @typedef {Object} NodeSpotlightInfo
 * @property {string[]|string} [details] Extra details/tokens to include in search and display (bottom-right area)
 * @property {string} [itemClass] Override right-hand label
 * @property {string} [itemClassSuffix] Suffix to append to the right-hand label
 * @property {string} [titleSuffix] Suffix to append to the title (e.g., state)
 */
/**
 * Extra Spotlight info that a node can provide via UI JS.
 * @typedef {Object} NodeSpotlightInfo
 * @property {string[]|string} [details] Extra details/tokens to include in search and display (bottom-right area)
 * @property {string} [itemClass] Override right-hand label
 * @property {string} [itemClassSuffix] Suffix to append to the right-hand label
 * @property {string} [titleSuffix] Suffix to append to the title (e.g., state)
 */

/**
 * Function signature for node info providers.
 * @callback NodeInfoProvider
 * @param {any} node LiteGraph node instance
 * @returns {NodeSpotlightInfo|void}
 */

/**
 * Arguments for makeNodeItem helper.
 * @typedef {Object} MakeNodeItemArgs
 * @property {any} node LiteGraph node instance
 * @property {string|number} displayId Display id for the node (supports subgraph dotted notation)
 * @property {any[]} parentChain Chain of parent subgraph-holder nodes for UI breadcrumbs
 * @property {any} [payload] Arbitrary plugin-defined object to attach to the created item
 */