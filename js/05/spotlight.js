// noinspection RegExpSimplifiable

import {app} from "../../../scripts/app.js";
import {Fzf} from "/ovum-spotlight/node_modules/fzf/dist/fzf.es.js";
import {buildUI, getPositionsInRange, highlightText, updateActiveState} from "./spotlight-helper-dom.js";
import {allLinks, allNodes, collectAllNodesRecursive, findWidgetMatch, getGraph, navigateToItemAndFocus} from "./spotlight-helper-graph.js";
import {isBlockedByActiveUI, matchesHotkey} from "./spotlight-helper-hotkey.js";
import {
    focusNodeWithOverlayAwareCenter as helperFocusNodeWithOverlayAwareCenter,
    focusNodeWithOverlayAwareCenterPreview as helperFocusNodeWithOverlayAwareCenterPreview
} from "./spotlight-helper-focus.js";
import {createShowResult} from "./spotlight-helper-showresult.js";

// Minimal Alfred-like spotlight for ComfyUI graph
// Uses fzf from npm

/**
 * Ovum Spotlight module
 *
 * This file implements a lightweight Spotlight-style search UI for ComfyUI, with a small plugin API.
 * External extensions can register keyword handlers ("<keyword> <text>") and default handlers
 * that contribute items to the global results when no keyword is active.
 *
 * Plugin API summary:
 * - window.OvumSpotlight.registerKeywordHandler(keyword, handler)
 * - window.OvumSpotlight.registerDefaultHandler(handler)
 *
 * Handlers receive a context object with helpers to access the graph and set the placeholder.
 *
 * Types are defined in spotlight-typedefs.js and can be imported via JSDoc.
 */

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
/** @typedef {import("./spotlight-typedefs.js").IFilterRegistry} IFilterRegistry */
/** @typedef {import("./spotlight-typedefs.js").FilterFn} FilterFn */
/** @typedef {import("./spotlight-typedefs.js").ParsedFilter} ParsedFilter */

// Encapsulated runtime state and constants for Spotlight interactions
const SpotlightRuntime = {
    LEFT_MOUSE_BUTTON: 0,
    // Track pointer movement and keyboard navigation
    lastPointerMoveTime: 0,
    lastKeyboardNavigationTime: 0,
    ignoreHoverUntilMove: false,
    lastPointerX: 0,
    lastPointerY: 0,
    HOVER_SUPPRESSION_WINDOW_MS: 250,
    MINIMUM_POINTER_DISTANCE: 5 // pixels
};

// Track viewport to restore after spotlight closes
let __ovumSpotlightSavedViewport = null; // { scale:number, offset:[x,y] }
let __ovumSpotlightUserSelectedNode = false;

// Bind showResult renderer to the runtime object
const renderResults = createShowResult(SpotlightRuntime);

// moved to spotlight-helper-dom.js: buildUI
// moved to spotlight-helper-dom.js: createStyles
// moved to spotlight-helper-graph.js: collectAllNodesRecursive
// moved to spotlight-helper-graph.js: findWidgetMatch
// moved to spotlight-helper-graph.js: getGraph, allNodes, allLinks
// moved to spotlight-helper-graph.js: isNumericLike
// moved to spotlight-helper-hotkey.js: matchesHotkey

/**
 * SpotlightRegistry is an object used to manage and register handlers for specific keywords and default behaviors.
 * This registry facilitates mapping keywords to their corresponding handler functions and maintaining a list of default handlers.
 *
 * Properties:
 * - keywordHandlers: A Map that associates keywords with specific handler functions. The key is a string representing a keyword,
 *   and the value is a function that takes a single argument (text of type string) and returns an object with available items and the corresponding handler.
 *
 * - defaultHandlers: An array of functions that represent default handlers. Each function returns an object containing available items
 *   and its associated handler information when invoked.
 *
 * Methods:
 * - registerKeywordHandler(keyword, callback): Registers a handler for a specific keyword. The `keyword` is case-insensitive
 *   and is converted to lowercase before storing. If the keyword is invalid or the given `callback` is not a function, the method terminates
 *   without performing any operations.
 *
 * - registerDefaultHandler(callback): Adds a function to the list of default handlers. If the given `callback` is not a function, it is ignored.
  *
  * @type {ISpotlightRegistry}
 */
// Simple plugin registry to allow external nodes to inject spotlight search providers
const SpotlightRegistry = {
    keywordHandlers: new Map(), // keyword -> (text:string)=>{items, handler}
    defaultHandlers: [],        // list of () => {items, handler:""}
    registerKeywordHandler (keyword, callback) {
        if (!keyword || typeof callback !== "function") {
            return;
        }
        this.keywordHandlers.set(String(keyword).toLowerCase(), callback);
    },
    registerDefaultHandler (callback) {
        if (typeof callback === "function") {
            this.defaultHandlers.push(callback);
        }
    }
};

// Helper to build flat search text and offsets from nested array [title, itemClass, subtitleNames[], detailPairs[]]
function buildSearchFromJson (searchJson) {
    const parts = [];
    const offsets = { title: [0, 0], itemClass: [0, 0], subtitles: [], details: [] };
    let pos = 0;
    const pushPart = (text) => {
        const start = pos;
        const t = String(text || "");
        pos += t.length;
        const end = pos;
        parts.push(t);
        return [start, end];
    };
    const pushSep = () => { parts.push(" "); pos += 1; };

    const title = searchJson?.[0] ?? "";
    const itemClass = searchJson?.[1] ?? "";
    const subtitles = Array.isArray(searchJson?.[2]) ? searchJson[2] : [];
    const details = Array.isArray(searchJson?.[3]) ? searchJson[3] : [];

    // title
    offsets.title = pushPart(title);
    pushSep();
    // class
    offsets.itemClass = pushPart(itemClass);
    pushSep();
    // subtitles
    for (let i = 0; i < subtitles.length; i++) {
        const s = String(subtitles[i] ?? "");
        const [start, end] = pushPart(s);
        offsets.subtitles.push({ text: s, start, end });
        if (i < subtitles.length - 1) { pushSep(); }
    }
    if (subtitles.length) { pushSep(); }
    // details
    for (let i = 0; i < details.length; i++) {
        const d = String(details[i] ?? "");
        const [start, end] = pushPart(d);
        offsets.details.push({ text: d, start, end });
        if (i < details.length - 1) { pushSep(); }
    }

    const flat = parts.join("");
    return { flat, offsets };
}

// Registry for per-node extra info providers, so UI scripts can enrich spotlight search/display
const NodeInfoProviders = {
    // key: node type (comfyClass or type) lowercased -> provider function
    map: new Map(),
    /**
     * Register a provider for a node type.
     * @param {string} nodeType
     * @param {(node:any)=>({details?:string[]|string, itemClass?:string, itemClassSuffix?:string, titleSuffix?:string})} fn
     */
    register (nodeType, fn) {
        if (!nodeType || typeof fn !== 'function') return;
        this.map.set(String(nodeType).toLowerCase(), fn);
    },
    /**
     * Query providers and optional node instance method to get extra info.
     * @param {any} node
     */
    get (node) {
        const out = { details: [], itemClass: undefined, itemClassSuffix: undefined, titleSuffix: undefined };
        try {
            // 1) Instance-level hook (UI can patch node.getSpotlightInfo = () => ({...}))
            const inst = typeof node?.getSpotlightInfo === 'function' ? node.getSpotlightInfo() : null;
            if (inst && typeof inst === 'object') {
                if (Array.isArray(inst.details)) out.details.push(...inst.details.map(String));
                else if (typeof inst.details === 'string') out.details.push(inst.details);
                if (typeof inst.itemClass === 'string') out.itemClass = inst.itemClass;
                if (typeof inst.itemClassSuffix === 'string') out.itemClassSuffix = inst.itemClassSuffix;
                if (typeof inst.titleSuffix === 'string') out.titleSuffix = inst.titleSuffix;
            }
            // 2) Registered provider by node.comfyClass or node.type
            const keyA = String(node?.comfyClass || '').toLowerCase();
            const keyB = String(node?.type || '').toLowerCase();
            const fn = this.map.get(keyA) || this.map.get(keyB);
            if (fn) {
                const info = fn(node) || {};
                if (Array.isArray(info.details)) out.details.push(...info.details.map(String));
                else if (typeof info.details === 'string') out.details.push(info.details);
                if (typeof info.itemClass === 'string') out.itemClass = info.itemClass;
                if (typeof info.itemClassSuffix === 'string') out.itemClassSuffix = info.itemClassSuffix;
                if (typeof info.titleSuffix === 'string') out.titleSuffix = info.titleSuffix;
            }
        } catch (e) {
            console.warn('OvumSpotlight: node info provider error', e);
        }
        return out;
    }
};

// Expose API for UI scripts to register providers
// @ts-ignore
window.OvumSpotlight = window.OvumSpotlight || {};
// @ts-ignore
window.OvumSpotlight.registerNodeInfoProvider = (nodeType, fn) => NodeInfoProviders.register(nodeType, fn);

// Factory for node SpotlightItem with nested search JSON and offsets for highlighting
function makeNodeItem ({ node, displayId, parentChain, payload }) {
    const className = node.comfyClass || node.type;
    const baseTitle = `${node.title || className}`;
    const extra = NodeInfoProviders.get(node);
    const idTag = `#${displayId}`;
    // Include #<id> in the visible title so it can be matched and highlighted
    const title = `${baseTitle}${extra.titleSuffix ? ' ' + extra.titleSuffix : ''} ${idTag}`;
    let itemClass = node.type;
    if (extra.itemClass) itemClass = extra.itemClass;
    else if (extra.itemClassSuffix) itemClass = `${itemClass} ${extra.itemClassSuffix}`;

    const subtitleNames = Array.isArray(parentChain) ? parentChain.map(p => p?.title || p?.type).filter(Boolean) : [];
    const detailPairs = (node.widgets && Array.isArray(node.widgets)) ? node.widgets.map(w => `${w.name}:${w.value}`) : [];
    const extraDetails = Array.isArray(extra.details) ? extra.details : [];
    const allDetails = detailPairs.concat(extraDetails);

    // Use the same display title (including #<id>) as the first element so offsets align for highlighting
    const searchJson = [title || "", itemClass || "", subtitleNames, allDetails];
    const { flat: searchFlat, offsets: searchOffsets } = buildSearchFromJson(searchJson);

    return {
        "@type": "node",
        id: displayId,
        title,
        itemClass,
        node,
        itemSubtitlePath: parentChain,
        itemDetails: allDetails.join(" "),
        searchText: searchFlat, // keep compatibility with existing selector
        searchJson,
        searchFlat,
        searchOffsets,
        payload
    };
}

// Expose helper for external modules
// @ts-ignore
window.OvumSpotlight = window.OvumSpotlight || {};
// @ts-ignore
window.OvumSpotlight.makeNodeItem = makeNodeItem;


// Expose a global hook so custom nodes can register from their JS
// Usage: window.OvumSpotlight?.registerKeywordHandler("mykey", (text)=>({...}))
//        window.OvumSpotlight?.registerDefaultHandler(()=>({...}))
/** @type {ISpotlightRegistry} */
// @ts-ignore - augmenting window with OvumSpotlight
// Merge SpotlightRegistry into any existing OvumSpotlight object to avoid losing previously attached helpers
window.OvumSpotlight = Object.assign(window.OvumSpotlight || {}, SpotlightRegistry);

// Simple filter registry, similar to keyword registry
// External modules can register filters by name. If no filter matches, fallback assumes filterName is a widget name.
/** @type {IFilterRegistry} */
const FilterRegistry = {
    filters: new Map(), // name -> (item, value) => boolean | Promise<boolean>
    registerFilter (name, callback) {
        if (!name || typeof callback !== "function") return;
        this.filters.set(String(name).toLowerCase(), callback);
    }
};

// Expose filter API on the same global
// @ts-ignore - augment window.OvumSpotlight with registerFilter
window.OvumSpotlight = window.OvumSpotlight || {};
/** @type {(name:string, fn: FilterFn)=>void} */
// @ts-ignore
window.OvumSpotlight.registerFilter = (name, fn) => FilterRegistry.registerFilter(name, fn);

/**
 * Parse filters of the form name:value or name:"value with spaces" from the query.
 * Returns remaining text with filters removed and an array of filters.
 * @param {string} q
 * @returns {{ text:string, filters: ParsedFilter[] }}
 */
function parseFilters (q) {
    if (!q) return { text: "", filters: [] };
    const filters = [];
    // Match filter patterns of form name:value or name:"value with spaces"
    // (\b\w+)      - Capture word boundary followed by word chars (filter name)
    // :            - Literal colon separator
    // (?:          - Start non-capturing group for value alternatives:
    //   "([^"]+)"  - 1) Quoted value: quotes containing non-quote chars
    //   |          - OR
    //   ([^\s]+)   - 2) Unquoted value: sequence of non-whitespace chars
    // )            - End non-capturing group
    const re = /(\b\w+):(?:"([^"]+)"|([^\s]+))/g;
    let m;
    while ((m = re.exec(q)) !== null) {
        const name = m[1];

        // Extract filter value from regex groups: m[2] contains quoted value if present ("value"),
        // m[3] contains unquoted value if no quotes (value), fallback to empty string if neither matched
        const value = m[2] != null ? m[2] : (m[3] != null ? m[3] : "");
        filters.push({ name, value, raw: m[0] });
    }
    // Remove all matched filters from the text
    const text = q.replace(re, " ").replace(/\s+/g, " ").trim();
    return { text, filters };
}

/**
 * Apply parsed filters to the items list. If a filter name is registered, use it; otherwise fallback to widget name matching.
 * @param {any[]} items
 * @param {{ name:string, value:string }[]} filters
 * @returns {Promise<any[]>}
 */
async function applyFilters (items, filters) {
    if (!Array.isArray(filters) || filters.length === 0) return items;
    const out = [];
    for (const it of items) {
        let ok = true;
        for (const f of filters) {
            const reg = FilterRegistry.filters.get(String(f.name).toLowerCase());
            if (reg) {
                try {
                    const maybe = reg(it, f.value);
                    const passed = (typeof maybe?.then === 'function') ? await maybe : !!maybe;
                    if (!passed) { ok = false; break; }
                } catch (_) {
                    ok = false; break;
                }
            } else {
                // Fallback: treat name as widget name and perform case-insensitive substring match on its value
                const node = it?.node;
                if (!node || !Array.isArray(node.widgets)) { ok = false; break; }
                const targetName = String(f.name).toLowerCase();
                const targetVal = String(f.value).toLowerCase();
                let matched = false;
                for (const w of node.widgets) {
                    const wName = String(w?.name ?? "").toLowerCase();
                    if (wName === targetName) {
                        const wVal = String(w?.value ?? "").toLowerCase();
                        if (targetVal === "" || wVal.indexOf(targetVal) !== -1) { matched = true; break; }
                    }
                }
                if (!matched) { ok = false; break; }
            }
        }
        if (ok) out.push(it);
    }
    return out;
}

/**
 * Parse the user's query to detect an active keyword registered via registerKeywordHandler.
 * Returns the handler key and the remaining text if a keyword is present.
 * @param {string} q
 * @returns {{handler:string, text:string, matched:boolean}}
 */
function parseHandler (q) {
    // Accept only registered keywords
    const m = q.match(/^\s*(\w+)\s+(.*)$/i);
    if (m) {
        const kw = m[1].toLowerCase();
        if (SpotlightRegistry.keywordHandlers.has(kw)) {
            return {handler: kw, text: m[2], matched: true};
        }
    }
    return {handler: "", text: q, matched: false};
}

/**
 * Build the list of SpotlightItem records for a given query.
 * If a registered keyword handler matches, it will be invoked. Otherwise, core items
 * and contributions from default handlers are returned.
 * @param {string} q
 * @returns {Promise<{items: SpotlightItem[], handler:string}>}
 */
async function searchData (q) {
    const {handler, text} = parseHandler(q);
    const g = getGraph();
    if (!g) {
        return {items: [], handler};
    }


    // Custom keyword handler
    if (handler && SpotlightRegistry.keywordHandlers.has(handler)) {
        try {
            const fn = SpotlightRegistry.keywordHandlers.get(handler);
            const maybe = fn?.(text, {
                app,
                getGraph,
                allNodes,
                allLinks,
                collectAllNodesRecursive,
                setPlaceholder: (s) => SpotlightRegistry._setPlaceholder?.(s)
            });
            const res = (typeof maybe?.then === 'function') ? await maybe : maybe;
            if (res && Array.isArray(res.items)) {
                return {items: res.items, handler};
            }
        } catch (e) {
            console.warn("OvumSpotlight keyword handler error", handler, e);
        }
    }

    // default (no handler): core list + contributions from default handlers
    const allNodesWithSubgraphs = collectAllNodesRecursive();
    let items = allNodesWithSubgraphs.map(({node, id, displayId, parentChain}) => {
        return makeNodeItem({ node, displayId, parentChain });
    });

    // Let default handlers add more items (support async)
    const contributions = await Promise.all(SpotlightRegistry.defaultHandlers.map(async (fn) => {
        try {
            const maybe = fn?.({app, getGraph, allNodes, allLinks, collectAllNodesRecursive});
            return (typeof maybe?.then === 'function') ? await maybe : maybe;
        } catch (e) {
            console.warn("OvumSpotlight default handler error", e);
            return null;
        }
    }));
    for (const res of contributions) {
        if (res && Array.isArray(res.items)) {
            items = items.concat(res.items);
        }
    }

    return {items, handler: ""};
}

// moved to spotlight-helper-dom.js: getPositionsInRange
// moved to spotlight-helper-dom.js: highlightText
// Returns the list of CSS selectors that should block spotlight activation when visible
// moved to spotlight-helper-hotkey.js: getSpotlightBlockSelectors
// moved to spotlight-helper-hotkey.js: getSpotlightBlockSelectors

// Checks if any blocking UI element is currently visible in the DOM
// moved to spotlight-helper-hotkey.js: isBlockedByActiveUI

app.registerExtension({
    name: "ovum.spotlight",
    /**
     * @param {import("@comfyorg/comfyui-frontend-types").ComfyApp} app
     */
    setup: async function (app) {
        // Helper: get canvas element and DragAndScale
        const getCanvasElement = () => app?.canvas?.canvas;
        const getDS = () => app?.canvas?.ds;
        const setDirty = () => app?.canvas?.setDirty?.(true, true);
        const saveViewport = () => {
            const ds = getDS();
            if (!ds) {
                return;
            }
            __ovumSpotlightSavedViewport = {
                scale: ds.scale,
                offset: [ds.offset[0], ds.offset[1]]
            };
        };
        const restoreViewportIfNeeded = () => {
            const ds = getDS();
            if (!ds || !__ovumSpotlightSavedViewport) {
                return;
            }
            if (!__ovumSpotlightUserSelectedNode) {
                ds.scale = __ovumSpotlightSavedViewport.scale;
                ds.offset[0] = __ovumSpotlightSavedViewport.offset[0];
                ds.offset[1] = __ovumSpotlightSavedViewport.offset[1];
                setDirty();
            }
            __ovumSpotlightSavedViewport = null;
        };
        const focusNodeWithOverlayAwareCenter = (node) => helperFocusNodeWithOverlayAwareCenter(ui, node);
        const focusNodeWithOverlayAwareCenterPreview = (node) => helperFocusNodeWithOverlayAwareCenterPreview(ui, node);
        // Preview-focus an item without closing Spotlight. Delegates to helper to navigate/select/focus.
        const previewFocusForItem = (it) => {
            navigateToItemAndFocus(it, focusNodeWithOverlayAwareCenterPreview, { delay: 50 });
        };
        const ui = buildUI();
        const defaultPlaceholder = ui.input.placeholder;
        SpotlightRegistry._setPlaceholder = (s) => {
            ui.input.placeholder = s || defaultPlaceholder;
        };
        // Track actual pointer movement to avoid hover overriding keyboard selection when mouse is stationary
        const updatePointerMoveTime = (e) => {
            const deltaX = Math.abs(e.clientX - SpotlightRuntime.lastPointerX);
            const deltaY = Math.abs(e.clientY - SpotlightRuntime.lastPointerY);
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

            // Only count as real movement if pointer moved a minimum distance
            if (SpotlightRuntime.ignoreHoverUntilMove && distance < SpotlightRuntime.MINIMUM_POINTER_DISTANCE) {
                return;
            }

            SpotlightRuntime.lastPointerX = e.clientX;
            SpotlightRuntime.lastPointerY = e.clientY;
            SpotlightRuntime.lastPointerMoveTime = nowMs();

            // Enable CSS hover once the mouse actually moves
            SpotlightRuntime.ignoreHoverUntilMove = false;
            ui.wrap.classList.add('hover-enabled');
        };

        ui.wrap.addEventListener("pointermove", updatePointerMoveTime);
        ui.wrap.addEventListener("mousemove", updatePointerMoveTime);
        ui.list.addEventListener("pointermove", updatePointerMoveTime);
        ui.list.addEventListener("mousemove", updatePointerMoveTime);
        // Track whether the last non-modifier key pressed was an Arrow key
        let lastKeyWasArrow = false;
        // Track if Shift was pressed and released without any other key in between
        let shiftIsDown = false;
        let shiftSoloCandidate = false;
        // Helpers to keep code DRY
        const nowMs = () => (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        const updateLastKeyWasArrow = (e) => {
            const isModifier = (k) => k === "Shift" || k === "Control" || k === "Alt" || k === "Meta";
            if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
                lastKeyWasArrow = true;
            } else if (!isModifier(e.key)) {
                lastKeyWasArrow = false;
            }
        };
        const tryActivateShiftPreview = () => {
            // Activate preview-focus only if the last real key pressed was an Arrow key
            if (!state.shiftPreviewActive && lastKeyWasArrow) {
                saveShiftPreviewViewport();
                saveShiftPreviewGraphContext();
                saveShiftPreviewSelection();
                state.shiftPreviewActive = true;
                const r = state.results?.[state.active];
                if (r && r.item) {
                    previewFocusForItem(r.item);
                }
            }
        };
        let state = {
            open: false,
            active: 0,
            results: [],
            items: [],
            handler: "",
            handlerActive: false,
            fullQuery: "",
            preventHandlerActivation: false,
            reactivateAwaitingSpaceToggle: false,
            reactivateSpaceRemoved: false,
            restoredHandler: "",
            shiftPreviewActive: false
        };

        // Temporary viewport snapshot used while Shift preview is active
        let shiftPreviewSavedViewport = null;
        const saveShiftPreviewViewport = () => {
            if (shiftPreviewSavedViewport) {
                return;
            } // already saved
            const ds = getDS();
            if (!ds) {
                return;
            }
            shiftPreviewSavedViewport = {scale: ds.scale, offset: [ds.offset[0], ds.offset[1]]};
        };
        const restoreShiftPreviewViewport = () => {
            const ds = getDS();
            if (!ds || !shiftPreviewSavedViewport) {
                return;
            }
            ds.scale = shiftPreviewSavedViewport.scale;
            ds.offset[0] = shiftPreviewSavedViewport.offset[0];
            ds.offset[1] = shiftPreviewSavedViewport.offset[1];
            setDirty();
            shiftPreviewSavedViewport = null;
        };

        // Snapshot and restore graph/subgraph context during Shift preview
        let shiftPreviewSavedGraphContext = null;
        const saveShiftPreviewGraphContext = () => {
            if (shiftPreviewSavedGraphContext) {
                return;
            } // already saved
            const canvas = app?.canvas;
            if (!canvas) {
                return;
            }
            // Save current graph reference; if there is a stack in this build, try to copy it
            const stack = canvas.graph_stack ? [...canvas.graph_stack] : null;
            shiftPreviewSavedGraphContext = {graph: canvas.graph, stack};
        };
        const restoreShiftPreviewGraphContext = () => {
            if (!shiftPreviewSavedGraphContext) {
                return;
            }
            if (__ovumSpotlightUserSelectedNode) { // do not restore if user finalized a selection
                shiftPreviewSavedGraphContext = null;
                return;
            }
            const canvas = app?.canvas;
            if (!canvas) {
                shiftPreviewSavedGraphContext = null;
                return;
            }
            try {
                if (shiftPreviewSavedGraphContext.stack && Array.isArray(canvas.graph_stack)) {
                    // Restore stack then graph
                    canvas.graph_stack.length = 0;
                    for (const g of shiftPreviewSavedGraphContext.stack) canvas.graph_stack.push(g);
                }
                if (typeof canvas.setGraph === 'function') {
                    canvas.setGraph(shiftPreviewSavedGraphContext.graph);
                } else {
                    canvas.graph = shiftPreviewSavedGraphContext.graph;
                }
                setDirty();
            } catch (_) {
                // Best effort; ignore errors
            } finally {
                shiftPreviewSavedGraphContext = null;
            }
        };

        // Snapshot and restore selection during Shift preview
        let shiftPreviewSavedSelection = null;
        const getCurrentSelection = () => {
            const canvas = app?.canvas;
            if (!canvas) {
                return [];
            }
            try {
                if (canvas.selected_nodes) {
                    return Object.values(canvas.selected_nodes);
                }
            } catch (_) { /* ignore */
            }
            // Fallback: try selectedItems if available
            try {
                if (canvas.selectedItems && typeof canvas.selectedItems.forEach === 'function') {
                    const arr = [];
                    canvas.selectedItems.forEach?.(v => {
                        if (v && v.constructor?.name?.includes('LGraphNode')) {
                            arr.push(v);
                        }
                    });
                    return arr;
                }
            } catch (_) { /* ignore */
            }
            return [];
        };
        const saveShiftPreviewSelection = () => {
            if (shiftPreviewSavedSelection) {
                return;
            } // already saved
            shiftPreviewSavedSelection = getCurrentSelection();
        };
        const restoreShiftPreviewSelection = () => {
            if (!shiftPreviewSavedSelection || __ovumSpotlightUserSelectedNode) {
                shiftPreviewSavedSelection = null;
                return;
            }
            const canvas = app?.canvas;
            if (!canvas) {
                shiftPreviewSavedSelection = null;
                return;
            }
            try {
                // Clear any selection introduced by preview
                if (typeof canvas.deselectAllNodes === 'function') {
                    canvas.deselectAllNodes();
                } else if (canvas.selected_nodes) {
                    for (const k in canvas.selected_nodes) {
                        if (canvas.selected_nodes[k]) {
                            canvas.selected_nodes[k].selected = false;
                        }
                    }
                    canvas.selected_nodes = {};
                }
                // Re-select previously selected nodes (best effort)
                for (const node of shiftPreviewSavedSelection) {
                    if (!node) {
                        continue;
                    }
                    try {
                        canvas.selectNode?.(node, true);
                    } catch (_) { /* ignore */
                    }
                }
            } catch (_) { /* ignore */
            } finally {
                shiftPreviewSavedSelection = null;
            }
        };

        const isHTMLElement = (v) => !!(v && typeof v === 'object' && v.nodeType === 1);
        const clearBigbox = () => {
            ui.bigbox.innerHTML = "";
            ui.bigbox.classList.add("hidden");
        };
        const updateBigboxContent = () => {
            const r = state.results[state.active];
            const content = r?.item?.bigbox;
            // Only accept existing HTMLElement, ignore strings or falsey
            if (isHTMLElement(content)) {
                ui.bigbox.innerHTML = "";
                ui.bigbox.appendChild(content);
                ui.bigbox.classList.remove("hidden");
            } else {
                clearBigbox();
            }
        };

        const updateActiveItem = (newActive) => {
            state.active = newActive;
            updateActiveState(ui.list, state.active);
            updateBigboxContent();
        };
        
        const jump = item => {
            const g = getGraph();
            if (!g) {
                return;
            }
            // Use preview-level zoom for final jump to match preview focus
            navigateToItemAndFocus(item, focusNodeWithOverlayAwareCenterPreview, { delay: 100 });
        };


        const handleSelect = (result) => {
            const it = result.item;
            if (it && typeof it.onSelect === "function") {
                try {
                    it.onSelect(it);
                } catch (e) {
                    console.warn("Spotlight item onSelect error", e);
                }
                // Treat custom onSelect as a selection/navigation
                __ovumSpotlightUserSelectedNode = true;
                close();
                return;
            }
            // Support both legacy `type` and refactored `@type`
            const t = it?.["@type"] ?? it?.type;
            if (t === "node" || t === "link") {
                __ovumSpotlightUserSelectedNode = true;
                jump(it);
            }
            close();
        };

        let _searchSeq = 0;
        const refresh = async () => {
            _searchSeq++;
            const seq = _searchSeq;
            const q = ui.input.value;
            const fullQuery = state.handlerActive ? `${state.handler} ${q}` : q;
            state.fullQuery = fullQuery;

            const parseResult = parseHandler(fullQuery);
            const {items, handler} = await searchData(fullQuery);
            if (seq !== _searchSeq) {
                return;
            }

            // Manage reactivation gating: require removal of ALL spaces before reactivation is allowed
            if (state.reactivateAwaitingSpaceToggle) {
                const val = ui.input.value;
                const hasAnySpace = /\s/.test(val);
                if (hasAnySpace) {
                    // As long as there is any whitespace in the input, block reactivation
                    state.preventHandlerActivation = true;
                } else {
                    // No spaces remain: lift prevention and end gating
                    state.preventHandlerActivation = false;
                    state.reactivateAwaitingSpaceToggle = false;
                    state.reactivateSpaceRemoved = false;
                    state.restoredHandler = "";
                }
            } else {
                state.preventHandlerActivation = false;
            }

            // Activate handler if pattern matched and not already active (and not prevented)
            if (parseResult.matched && !state.handlerActive && !state.preventHandlerActivation) {
                state.handler = handler;
                state.handlerActive = true;
                // Remove the handler keyword and space from input
                ui.input.value = parseResult.text;
                ui.badge.classList.remove("hidden");
                ui.badge.textContent = handler;
                return; // Re-call refresh with updated input
            }

            if (state.handlerActive) {
                ui.badge.classList.remove("hidden");
                ui.badge.textContent = state.handler;
            } else {
                ui.badge.classList.add("hidden");
                state.handler = "";
            }

            // Parse and apply filters (key:value or key:"value with spaces")
            const filterParse = parseFilters(parseResult.text);
            const searchTextForFzf = filterParse.text;
            const highlightTextQuery = [filterParse.text, ...filterParse.filters.map(f => f.value)].filter(Boolean).join(" ");

            const filteredItems = await applyFilters(items, filterParse.filters);
            state.items = filteredItems;

            const maxMatches = app.ui.settings.getSettingValue("ovum.spotlightMaxMatches") ?? 100;
            const visibleItems = app.ui.settings.getSettingValue("ovum.spotlightVisibleItems") ?? 6;
            const fzf = new Fzf(filteredItems, {selector: (it) => {
                if (typeof it.searchFlat === 'string') return it.searchFlat;
                if (Array.isArray(it.searchJson)) {
                    try { return it.searchJson.flat(Infinity).filter(Boolean).join(" "); } catch (e) {}
                }
                if (typeof it.searchText === 'string') return it.searchText; // legacy fallback
                const right = (it.sub ? " " + it.sub : "");
                return String(it.title || "") + right + " " + String(it.id ?? "");
            }});
            const matches = fzf.find(searchTextForFzf).slice(0, maxMatches);
            state.results = matches;
            state.active = 0;
            if (window.Logger?.log) { Logger.log({ class: 'ovum.spotlight', method: 'refresh', severity: 'trace', tag: 'fzf', nodeName: 'ovum.timer' }, 'fzf matches', matches.slice(0, visibleItems)); }

            // Update list max-height based on visible items setting
            // Each item is approximately 47px (12px padding top + 12px padding bottom + 20px font-size + 1px border + ~2px for spacing)
            const itemHeight = 47;
            ui.list.style.maxHeight = `${itemHeight * visibleItems}px`;

            // For highlighting in details, pass a string that includes filter values
            renderResults(ui.list, matches, state.active, highlightTextQuery, updateActiveItem, handleSelect);
            updateBigboxContent();
        };


        function open () {
            // Save current viewport to restore on close (unless a node is selected)
            __ovumSpotlightUserSelectedNode = false;
            saveViewport();
            ui.wrap.classList.remove("hidden");
            ui.wrap.classList.remove("hover-enabled");
            // Reset placeholder to default when opening
            ui.input.placeholder = defaultPlaceholder;
            ui.input.focus();
            ui.input.select();
            state.open = true;
            state.handlerActive = false;
            state.handler = "";
            state.fullQuery = "";
            state.preventHandlerActivation = false;
            state.reactivateAwaitingSpaceToggle = false;
            state.reactivateSpaceRemoved = false;
            state.restoredHandler = "";
            state.shiftPreviewActive = false;
            shiftPreviewSavedViewport = null;
            shiftPreviewSavedGraphContext = null;
            shiftPreviewSavedSelection = null;
            // Reset pointer tracking to ignore hover until mouse actually moves
            SpotlightRuntime.lastPointerMoveTime = 0;
            SpotlightRuntime.lastKeyboardNavigationTime = 0;
            SpotlightRuntime.lastPointerX = 0;
            SpotlightRuntime.lastPointerY = 0;
            SpotlightRuntime.ignoreHoverUntilMove = true;
            lastKeyWasArrow = false;
            clearBigbox();
            refresh();
        }

        function close () {
            // If a preview was active and no final selection happened, restore graph, selection, and viewport (in that order)
            if (!__ovumSpotlightUserSelectedNode) {
                if (shiftPreviewSavedGraphContext) {
                    restoreShiftPreviewGraphContext();
                }
                if (shiftPreviewSavedSelection) {
                    restoreShiftPreviewSelection();
                }
                if (shiftPreviewSavedViewport) {
                    restoreShiftPreviewViewport();
                }
            }
            // Restore viewport if no node was selected during this spotlight session
            restoreViewportIfNeeded();
            ui.wrap.classList.add("hidden");
            clearBigbox();
            // Restore default placeholder on close
            ui.input.placeholder = defaultPlaceholder;
            state.open = false;
            state.handlerActive = false;
            state.handler = "";
            state.fullQuery = "";
            state.preventHandlerActivation = false;
            state.reactivateAwaitingSpaceToggle = false;
            state.reactivateSpaceRemoved = false;
            state.restoredHandler = "";
            // Clear any shift preview state
            state.shiftPreviewActive = false;
            shiftPreviewSavedViewport = null;
            shiftPreviewSavedGraphContext = null;
            shiftPreviewSavedSelection = null;
        }

        // Handle input keydown for handler deactivation, navigation, selection, and closing
        ui.input.addEventListener("keydown", (e) => {
            // Backspace when handler is active and input is empty -> deactivate handler but leave keyword + space
            if (e.key === "Backspace" && state.handlerActive && ui.input.value === "") {
                e.preventDefault();
                e.stopPropagation();
                // Deactivate handler and restore the keyword with space
                const restoredText = state.handler + " ";
                state.handlerActive = false;
                const oldHandler = state.handler;
                state.handler = "";
                state.preventHandlerActivation = true; // Prevent immediate reactivation
                // Require user to remove the trailing space and add it again before reactivation
                state.reactivateAwaitingSpaceToggle = true;
                state.reactivateSpaceRemoved = false;
                state.restoredHandler = oldHandler;
                ui.badge.classList.add("hidden");
                // Restore placeholder to default when handler deactivates
                ui.input.placeholder = defaultPlaceholder;
                ui.input.value = restoredText;
                // Move cursor to end
                setTimeout(() => {
                    ui.input.setSelectionRange(restoredText.length, restoredText.length);
                    refresh();
                }, 0);
                return;
            }

            // Only handle navigation/close/select when spotlight is open
            if (!state.open) {
                return;
            }

            // Track if last non-modifier key was an Arrow key (used for Shift preview activation)
            updateLastKeyWasArrow(e);

            // If Shift is currently down and another key is pressed, cancel solo-Shift candidate
            if (shiftIsDown && e.key !== "Shift") {
                shiftSoloCandidate = false;
            }

            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close();
                return;
            }

            if (e.key === "ArrowDown") {
                e.preventDefault(); // prevent caret move in the input
                handleArrowNavigation(+1, e.shiftKey);
                return;
            }

            if (e.key === "ArrowUp") {
                e.preventDefault(); // prevent caret move in the input
                handleArrowNavigation(-1, e.shiftKey);
                return;
            }

            if (e.key === "Enter") {
                const r = state.results[state.active];
                if (r) {
                    e.preventDefault();
                    handleSelect(r);
                }
                return;
            }

            if (e.key === "Shift") {
                // Start tracking a solo-Shift cycle only if lastKeyWasArrow is currently false
                shiftIsDown = true;
                shiftSoloCandidate = !lastKeyWasArrow;
                tryActivateShiftPreview();
                return; // don't interfere with Shift otherwise
            }
        });

        // Helper to unify ArrowUp/ArrowDown navigation logic to avoid duplicate code
        const handleArrowNavigation = (delta, shiftKey) => {
            // Record keyboard navigation timestamp to suppress hover selection briefly
            SpotlightRuntime.lastKeyboardNavigationTime = nowMs();
            // Disable hover-driven active changes while using keyboard
            ui.wrap.classList.remove('hover-enabled');

            const maxIdx = Math.max(0, (state.results?.length || 1) - 1);
            const newIdx = Math.max(0, Math.min(maxIdx, state.active + delta));
            updateActiveItem(newIdx);

            if (shiftKey) {
                if (!state.shiftPreviewActive) {
                    saveShiftPreviewViewport();
                    saveShiftPreviewGraphContext();
                    saveShiftPreviewSelection();
                    state.shiftPreviewActive = true;
                }
                const r = state.results?.[newIdx];
                if (r && r.item) {
                    previewFocusForItem(r.item);
                }
            }
        };
        
        // Keyboard handling for both settings-based hotkeys and internal navigation
        // Capture-phase listener on document to intercept hotkeys before canvas handlers (e.g., Space panning)
        document.addEventListener("keydown", (e) => {
            const setting = app.ui.settings.getSettingValue("ovum.spotlightHotkey") ?? "/";
            const alternateSetting = app.ui.settings.getSettingValue("ovum.spotlightAlternateHotkey") ?? "Ctrl+Space";
            const matchesPrimary = matchesHotkey(e, setting) && !state.open;
            const matchesAlternate = matchesHotkey(e, alternateSetting) && !state.open;

            if ((matchesPrimary || matchesAlternate) && !isBlockedByActiveUI()) {
                // Prevent default and stop propagation to avoid canvas consuming Space/other combos
                e.preventDefault();
                e.stopImmediatePropagation();
                console.debug("Ovum Spotlight (capture): opening via hotkey", { matched: matchesPrimary ? 'primary' : 'alternate', setting, alternateSetting });
                open();
            }
        }, { capture: true });

        // Bubble-phase listener on canvas for navigation and fallback hotkey handling
        getCanvasElement().addEventListener("keydown", (e) => {
            const setting = app.ui.settings.getSettingValue("ovum.spotlightHotkey") ?? "/";
            const alternateSetting = app.ui.settings.getSettingValue("ovum.spotlightAlternateHotkey") ?? "Ctrl+Space";
            // Use matchesHotkey for both primary and alternate hotkeys
            const matchesPrimary = matchesHotkey(e, setting) && !state.open;
            const matchesAlternate = matchesHotkey(e, alternateSetting) && !state.open;

            // Hardcoded debug for Ctrl+Space not activating
            if (matchesHotkey(e, "Ctrl+Space")) {
                // Intentionally log rich details to help diagnose environment-specific behavior
                console.debug("Ovum Spotlight: Ctrl+Space detected", {
                    key: e.key,
                    code: e.code,
                    ctrl: e.ctrlKey,
                    alt: e.altKey,
                    shift: e.shiftKey,
                    meta: e.metaKey,
                    repeat: e.repeat,
                    setting,
                    alternateSetting
                });
            }

            // Update lastKeyWasArrow tracking before handling Shift
            updateLastKeyWasArrow(e)

            // If Shift is currently down and another key is pressed, cancel solo-Shift candidate
            if (shiftIsDown && e.key !== "Shift") {
                shiftSoloCandidate = false;
            }

            if ((matchesPrimary || matchesAlternate)) {
                if (!isBlockedByActiveUI()) {
                    e.preventDefault();
                    console.debug("Ovum Spotlight: opening via hotkey", { matched: matchesPrimary ? 'primary' : 'alternate', setting, alternateSetting });
                    open();
                }
            } else if (state.open) {
                if (e.key === "Shift") {
                    // Start tracking a solo-Shift cycle only if lastKeyWasArrow is currently false
                    shiftIsDown = true;
                    shiftSoloCandidate = !lastKeyWasArrow;
                    tryActivateShiftPreview();
                } else if (e.key === "Escape") {
                    close();
                } else if (e.key === "ArrowDown") {
                    handleArrowNavigation(+1, e.shiftKey);
                    e.preventDefault();
                } else if (e.key === "ArrowUp") {
                    handleArrowNavigation(-1, e.shiftKey);
                    e.preventDefault();
                } else if (e.key === "Enter") {
                    const r = state.results[state.active];
                    if (r) {
                        handleSelect(r);
                    }
                }
            }
        });
        document.addEventListener("keyup", (e) => {
            if (!state.open) {
                return;
            }
            if (e.key === "Shift") {
                if (state.shiftPreviewActive) {
                    // Restore graph level first, then selection, then viewport
                    restoreShiftPreviewGraphContext();
                    restoreShiftPreviewSelection();
                    restoreShiftPreviewViewport();
                    state.shiftPreviewActive = false;
                }
                // If Shift was pressed and released with no other key, and lastKeyWasArrow was false, set it to true
                if (shiftIsDown && shiftSoloCandidate && !lastKeyWasArrow) {
                    lastKeyWasArrow = true;
                }
                // Reset Shift tracking flags on release
                shiftIsDown = false;
                shiftSoloCandidate = false;
            }
        });
        ui.input.addEventListener("input", refresh);
        ui.input.addEventListener("blur", () => setTimeout(() => {
            if (state.open) {
                close();
            }
        }, 150));

        app.ui.settings.addSetting({
            id: "ovum.spotlightHotkey",
            name: "ovum: Spotlight hotkey",
            type: "text",
            defaultValue: "Ctrl+k"
        });
        app.ui.settings.addSetting({
            id: "ovum.spotlightAlternateHotkey",
            name: "ovum: Spotlight alternate hotkey",
            type: "text",
            defaultValue: "Ctrl+Space"
        });
        app.ui.settings.addSetting({
            id: "ovum.spotlightHandlers",
            name: "ovum: Spotlight handlers",
            type: "text",
            defaultValue: "node,link"
        });
        app.ui.settings.addSetting({
            id: "ovum.spotlightMaxMatches",
            name: "ovum: Spotlight max matches",
            type: "number",
            defaultValue: 100
        });
        app.ui.settings.addSetting({
            id: "ovum.spotlightVisibleItems",
            name: "ovum: Spotlight visible items",
            type: "number",
            defaultValue: 6
        });
        // app.ui.settings.addSetting({
        //     id: "ovum.spotlightBlockSelectors",
        //     name: "ovum: Spotlight block selectors (comma-separated)",
        //     type: "text",
        //     defaultValue: ""
        // });

        // Store open function for command access
        this._spotlightOpen = open;
    },
    commands: [
        {
            id: "ovum.spotlight.activate",
            label: "Activate Spotlight",
            function: () => {
                // Access the open function through the extension instance
                const ovum_spotlight = (Array.from(app.extensions || []).find(o => o.name === 'ovum.spotlight')) || null;
                if (ovum_spotlight?._spotlightOpen) {
                    // Respect UI blockers when activating via command as well 
                    if (!isBlockedByActiveUI()) {
                        ovum_spotlight?._spotlightOpen();
                    }
                }
            }
        },
    ],
    // Associate keybindings with commands
    keybindings: [
        {
            commandId: "ovum.spotlight.activate",
            combo: { key: "/" },
        }
    ]
});
