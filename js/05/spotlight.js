import {app} from "../../../scripts/app.js";
import {Fzf} from "/ovum/node_modules/fzf/dist/fzf.es.js";
import {Logger} from "../common/logger.js";
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


// Expose a global hook so custom nodes can register from their JS
// Usage: window.OvumSpotlight?.registerKeywordHandler("mykey", (text)=>({...}))
//        window.OvumSpotlight?.registerDefaultHandler(()=>({...}))
/** @type {ISpotlightRegistry} */
// @ts-ignore - augmenting window with OvumSpotlight
window.OvumSpotlight = window.OvumSpotlight || SpotlightRegistry;

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
        const widgetText = node.widgets && Array.isArray(node.widgets) ? node.widgets.map(w => `${w.name}:${w.value}`).join(" ") : "";
        const className = node.comfyClass || node.type;
        const title = `${node.title || className}  [${displayId}]`;
        return {
            "@type": "node",
            id: displayId,
            title,
            itemClass: node.type,
            node,
            itemSubtitlePath: parentChain,
            itemDetails: widgetText,
            searchText: `${node.title || node.type} ${node.type} ${className} ${displayId} ${widgetText}`
        };
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
            SpotlightRuntime.lastPointerMoveTime = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();

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

            state.items = items;
            const searchText = parseResult.text;
            const maxMatches = app.ui.settings.getSettingValue("ovum.spotlightMaxMatches") ?? 100;
            const visibleItems = app.ui.settings.getSettingValue("ovum.spotlightVisibleItems") ?? 6;
            const fzf = new Fzf(items, {selector: (it) => it.searchText || (it.title + (it.sub ? " " + it.sub : "") + " " + it.id)});
            const matches = fzf.find(searchText).slice(0, maxMatches);
            state.results = matches;
            state.active = 0;
            if (window.Logger?.log) { Logger.log({ class: 'ovum.spotlight', method: 'refresh', severity: 'trace', tag: 'fzf', nodeName: 'ovum.timer' }, 'fzf matches', matches.slice(0, visibleItems)); }

            // Update list max-height based on visible items setting
            // Each item is approximately 47px (12px padding top + 12px padding bottom + 20px font-size + 1px border + ~2px for spacing)
            const itemHeight = 47;
            ui.list.style.maxHeight = `${itemHeight * visibleItems}px`;

            renderResults(ui.list, matches, state.active, searchText, updateActiveItem, handleSelect);
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

        // Handle backspace on input to deactivate handler
        ui.input.addEventListener("keydown", (e) => {
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
            }
        });

        // Helper to unify ArrowUp/ArrowDown navigation logic to avoid duplicate code
        const handleArrowNavigation = (delta, shiftKey) => {
            // Record keyboard navigation timestamp to suppress hover selection briefly
            SpotlightRuntime.lastKeyboardNavigationTime = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
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
        document.addEventListener("keydown", (e) => {
            const setting = app.ui.settings.getSettingValue("ovum.spotlightHotkey") ?? "/";
            const alternateSetting = app.ui.settings.getSettingValue("ovum.spotlightAlternateHotkey") ?? "Ctrl+Space";
            const matchesPrimary = e.key === setting && !state.open && !e.ctrlKey && !e.metaKey && !e.altKey;
            const matchesAlternate = matchesHotkey(e, alternateSetting) && !state.open;

            // Update lastKeyWasArrow tracking before handling Shift
            const isModifier = (k) => k === "Shift" || k === "Control" || k === "Alt" || k === "Meta";
            if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
                lastKeyWasArrow = true;
            } else if (!isModifier(e.key)) {
                lastKeyWasArrow = false;
            }

            if ((matchesPrimary || matchesAlternate)) {
                if (!isBlockedByActiveUI()) {
                    e.preventDefault();
                    open();
                }
            } else if (state.open) {
                if (e.key === "Shift") {
                    // Only activate preview-focus if the last real key pressed was an Arrow key
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
            defaultValue: "/"
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
        app.ui.settings.addSetting({
            id: "ovum.spotlightBlockSelectors",
            name: "ovum: Spotlight block selectors (comma-separated)",
            type: "text",
            defaultValue: ""
        });

        // Store open function for command access
        this._spotlightOpen = open;
    },
    commands: [
        {
            id: "ovum.spotlight.activate",
            icon: "pi pi-search",
            label: "Activate Spotlight",
            function: () => {
                // Access the open function through the extension instance
                if (app.extensions?.extensions?.["ovum.spotlight"]?._spotlightOpen) {
                    // Respect UI blockers when activating via command as well
                    if (!isBlockedByActiveUI()) {
                        app.extensions.extensions["ovum.spotlight"]._spotlightOpen();
                    }
                }
            }
        }
    ]
});
