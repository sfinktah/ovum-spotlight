// noinspection RegExpSimplifiable

import {app} from "../../../scripts/app.js";
import {Fzf} from "/ovum-spotlight/node_modules/fzf/dist/fzf.es.js";
import {braces} from "../01/braces-compat.js"
import {buildUI, updateActiveState} from "./spotlight-helper-dom.js";
import {allLinks, allNodes, collectAllNodesRecursive, getGraph, navigateToItemAndFocus} from "./spotlight-helper-graph.js";
import {isBlockedByActiveUI, matchesHotkey} from "./spotlight-helper-hotkey.js";
import {
    focusNodeWithOverlayAwareCenter as helperFocusNodeWithOverlayAwareCenter,
    focusNodeWithOverlayAwareCenterPreview as helperFocusNodeWithOverlayAwareCenterPreview
} from "./spotlight-helper-focus.js";
import {createShowResult} from "./spotlight-helper-showresult.js";
import {SpotlightRegistry} from "./spotlight-registry.js";
import {makeNodeItem} from "./spotlight-nodeinfo.js";
import {parseFilters, applyFilters} from "./spotlight-filters.js";

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
    MINIMUM_POINTER_DISTANCE: 5, // pixels
    // Selection integration (wired by spotlight.js at runtime)
    selectMode: false,
    isSelected: /** @type {(item:any)=>boolean} */ (() => false),
    toggleSelect: /** @type {(item:any)=>void} */ (() => {})
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




// Expose a global hook so custom nodes can register from their JS
// Usage: window.OvumSpotlight?.registerKeywordHandler("mykey", (text)=>({...}))
//        window.OvumSpotlight?.registerDefaultHandler(()=>({...}))
/** @type {ISpotlightRegistry} */
// @ts-ignore - augmenting window with OvumSpotlight
// Merge SpotlightRegistry into any existing OvumSpotlight object to avoid losing previously attached helpers
window.OvumSpotlight = Object.assign(window.OvumSpotlight || {}, SpotlightRegistry);

// Discover and load user plugins from the backend route. Each plugin is imported
// individually and errors are logged without aborting the iteration.
async function loadUserPlugins() {
    try {
        const resp = await fetch('/spotlight/user_plugins/');
        if (!resp?.ok) return;
        const data = await resp.json().catch(() => null);
        const files = Array.isArray(data?.files) ? data.files : [];
        for (const f of files) {
            const url = typeof f?.url === 'string' ? f.url : (typeof f?.path === 'string' ? `/spotlight/user_plugins/${f.path}` : null);
            if (!url) continue;
            try {
                await import(url);
            } catch (e) {
                console.warn('OvumSpotlight: failed to load user plugin', f?.path || url, e);
            }
        }
    } catch (e) {
        console.warn('OvumSpotlight: failed to list user plugins', e);
    }
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
        // Attempt to load any user plugins (errors are logged and ignored)
        try { loadUserPlugins()?.catch?.(()=>{}); } catch (_) {}
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

        // Command palette registry and selection state
        /** @type {{primary: any[], selection: any[], registerPaletteCommand:(cmd:any)=>void, clearPaletteCommands:()=>void}} */
        const CommandRegistry = {
            primary: [],
            selection: [],
            registerPaletteCommand (cmd) {
                if (!cmd || typeof cmd.label !== 'string' || typeof cmd.run !== 'function') return;
                if (cmd.primary) this.primary.push(cmd); else this.selection.push(cmd);
                renderPalettes();
            },
            clearPaletteCommands () {
                this.primary = [];
                this.selection = [];
                renderPalettes();
            }
        };
        // Expose API globally
        // @ts-ignore
        window.OvumSpotlight = window.OvumSpotlight || {};
        /** @type {import('./spotlight-typedefs.js').ISpotlightCommandRegistry} */
        // @ts-ignore
        window.OvumSpotlight.registerPaletteCommand = (cmd) => CommandRegistry.registerPaletteCommand(cmd);
        // @ts-ignore
        window.OvumSpotlight.clearPaletteCommands = () => CommandRegistry.clearPaletteCommands();
        // Also expose a stable plugin method for registering selection commands
        // @ts-ignore
        window.OvumSpotlight.__registerSelectionCommandNow = (cmd) => CommandRegistry.registerPaletteCommand(cmd);
        // @ts-ignore
        window.OvumSpotlight.registerSelectionCommand = (cmd) => SpotlightRegistry.registerSelectionCommand(cmd);

        // Selection state
        const selectedMap = new Map();
        const itemKey = (it) => {
            const t = it?.["@type"] ?? it?.type;
            if (t === 'node' && it?.node?.id != null) return `node:${it.node.id}`;
            if (t === 'link' && it?.id != null) return `link:${it.id}`;
            return `item:${it?.id ?? Math.random()}`;
        };
        const isSelected = (it) => selectedMap.has(itemKey(it));
        const clearSelection = () => { selectedMap.clear(); renderPalettes(); rerenderList(); };
        const toggleSelect = (it) => {
            const k = itemKey(it);
            if (selectedMap.has(k)) selectedMap.delete(k); else selectedMap.set(k, it);
            renderPalettes();
            rerenderList();
        };
        SpotlightRuntime.isSelected = isSelected;
        SpotlightRuntime.toggleSelect = toggleSelect;

        // After a command runs, prune selection/results for items that no longer exist in the graph
        const pruneSelectionAndResults = () => {
            try {
                const g = getGraph();
                if (!g) return;
                let changed = false;
                // prune selection map
                selectedMap.forEach((it, k) => {
                    try {
                        const t = it?.["@type"] ?? it?.type;
                        let exists = true;
                        if (t === 'node') {
                            const id = it?.node?.id;
                            exists = (id != null) && !!g.getNodeById?.(id);
                        } else if (t === 'link') {
                            const id = (it?.id != null) ? it.id : (it?.link?.id);
                            exists = (id != null) && !!g.links?.[id];
                        }
                        if (!exists) { selectedMap.delete(k); changed = true; }
                    } catch (_) { /* ignore */ }
                });
                if (changed) {
                    renderPalettes();
                }
                // prune current results list
                if (Array.isArray(state.results) && state.results.length) {
                    const before = state.results.length;
                    state.results = state.results.filter(r => {
                        const it = r && r.item;
                        if (!it) return false;
                        try {
                            const t = it?.["@type"] ?? it?.type;
                            if (t === 'node') {
                                const id = it?.node?.id;
                                return (id != null) && !!g.getNodeById?.(id);
                            } else if (t === 'link') {
                                const id = (it?.id != null) ? it.id : (it?.link?.id);
                                return (id != null) && !!g.links?.[id];
                            }
                        } catch (_) { /* ignore */ }
                        return true;
                    });
                    if (state.results.length !== before) {
                        if (state.active >= state.results.length) state.active = Math.max(0, state.results.length - 1);
                        renderResults(ui.list, state.results, state.active, state.highlightTextQuery || '', updateActiveItem, handleSelect);
                    } else if (changed) {
                        rerenderList();
                    }
                } else if (changed) {
                    rerenderList();
                }
            } catch (e) {
                console.warn('OvumSpotlight: pruneSelectionAndResults failed', e);
            }
        };
        const schedulePostCommandCleanup = () => {
            // run immediately and once more shortly after to give graph time to update
            setTimeout(() => {
                pruneSelectionAndResults();
                setTimeout(pruneSelectionAndResults, 100);
            }, 0);
        };

        // UI: render palettes
        let selectMode = false;
        SpotlightRuntime.selectMode = selectMode;
        const makeBtn = (label, opts) => {
            const b = document.createElement('button');
            b.className = 'no-ovum-spotlight-btn btn btn-xs';
            for (const [key, value] of Object.entries(opts)) {
                if (value === true) {
                    b.className += ` ${key}`;
                }
            }
            b.textContent = label;
            if (opts?.onclick) {
                b.addEventListener('click', opts.onclick);
            }
            return b;
        };
        // Interactive palette helpers: external commands own the UI lifecycle.
        // spotlight.js only exposes an interactive host and defers command completion
        // until the command signals done/cancel via the returned promise.
        let _interactivePending = null; // { resolve, reject }
        const hideInteractive = () => {
            try {
                ui.paletteInteractive.classList.add('hidden');
                ui.paletteInteractive.innerHTML = '';
            } catch (_) {}
        };
        /**
         * Open the interactive host and let the caller render into it.
         * The renderFn receives (hostEl, done, cancel). Call done(value) to resolve
         * the promise, or cancel(reason) to reject (or resolve null).
         * @param {(host:HTMLElement, done:(v?:any)=>void, cancel:(reason?:any)=>void)=>void} renderFn
         * @returns {Promise<any>}
         */
        const interactiveOpen = (renderFn) => {
            // If there is a pending session, cancel it first
            if (_interactivePending) {
                try { _interactivePending.resolve?.(null); } catch (_) {}
                _interactivePending = null;
            }
            hideInteractive();
            ui.paletteInteractive.classList.remove('hidden');
            return new Promise((resolve, reject) => {
                _interactivePending = { resolve, reject };
                const done = (val) => { try { hideInteractive(); } finally { const p = _interactivePending; _interactivePending = null; (p?.resolve||resolve)(val); } };
                const cancel = (reason) => { try { hideInteractive(); } finally { const p = _interactivePending; _interactivePending = null; if (reason === undefined) { (p?.resolve||resolve)(null); } else { (p?.reject||reject)(reason); } } };
                try {
                    renderFn?.(ui.paletteInteractive, done, cancel);
                } catch (e) {
                    cancel(e);
                }
            });
        };
        /** Programmatically close the interactive host if open. */
        const interactiveClose = () => {
            if (_interactivePending) {
                try { _interactivePending.resolve?.(null); } catch (_) {}
                _interactivePending = null;
            }
            hideInteractive();
        };

        const renderPalettes = () => {
            const spotlightSearchCommands = app.ui.settings.getSettingValue("ovum.spotlightSelection") ?? false;
            if (!spotlightSearchCommands) {
                return;
            }
            if (!ui.palettePrimary || !ui.paletteSelection) return;
            ui.palettePrimary.innerHTML = '';
            ui.paletteSelection.innerHTML = '';
            // Primary palette: Select Mode toggle and any primary commands
            const toggleBtn = makeBtn('Select Mode', {
                'btn-primary': true, 'btn-outline': !selectMode, onclick: () => {
                    selectMode = !selectMode;
                    SpotlightRuntime.selectMode = selectMode;
                    if (!selectMode) {
                        clearSelection();
                    }
                    renderPalettes();
                    // Recompute matches fully so adjacency filtering applies immediately on toggle
                    refresh();
                }
            });
            // Double-click: ensure select mode is active and toggle select all/none for current results
            toggleBtn.addEventListener('dblclick', (e) => {
                e.preventDefault();
                // ensure active
                if (!selectMode) {
                    selectMode = true;
                    SpotlightRuntime.selectMode = true;
                }
                const haveAny = selectedMap.size > 0;
                if (haveAny) {
                    clearSelection();
                } else {
                    try {
                        const toSelect = Array.isArray(state.results) ? state.results.map(r => r && r.item).filter(Boolean) : [];
                        for (const it of toSelect) {
                            const k = itemKey(it);
                            if (!selectedMap.has(k)) selectedMap.set(k, it);
                        }
                    } catch (_) { /* ignore */ }
                }
                renderPalettes();
                rerenderList();
            });
            ui.palettePrimary.appendChild(toggleBtn);
            // External primary commands
            CommandRegistry.primary.forEach(cmd => {
                const btn = makeBtn(cmd.label, { 'btn-info': true, onclick: async () => {
                    try {
                        const maybe = cmd.run({ selected: Array.from(selectedMap.values()), app, getGraph, close, interactiveOpen, interactiveClose });
                        if (maybe && typeof maybe.then === 'function') { await maybe; }
                    } catch (e) { console.warn('OvumSpotlight command error', e); }
                    finally { schedulePostCommandCleanup(); }
                }});
                ui.palettePrimary.appendChild(btn);
            });
            // Selection palette: only show if there are selected items
            const sel = Array.from(selectedMap.values());
            if (sel.length > 0) {
                ui.paletteSelection.classList.remove('hidden');
                // Show externally registered selection commands that are applicable
                CommandRegistry.selection.forEach(cmd => {
                    if (typeof cmd.isApplicable === 'function' && !cmd.isApplicable(sel)) return;
                    const btn = makeBtn(cmd.label, { 'btn-secondary' : true, 'btn-outline': true, onclick: async () => {
                        try {
                            const maybe = cmd.run({ selected: sel, app, getGraph, close, interactiveOpen, interactiveClose });
                            if (maybe && typeof maybe.then === 'function') { await maybe; }
                        } catch (e) { console.warn('OvumSpotlight command error', e); }
                        finally { schedulePostCommandCleanup(); }
                    }});
                    ui.paletteSelection.appendChild(btn);
                });
            } else {
                ui.paletteSelection.classList.add('hidden');
            }
        };

        // Drain any selection commands registered before UI initialization
        try {
            if (Array.isArray(SpotlightRegistry.__pendingSelectionCommands) && SpotlightRegistry.__pendingSelectionCommands.length) {
                SpotlightRegistry.__pendingSelectionCommands.forEach((cmd) => {
                    try { CommandRegistry.registerPaletteCommand(cmd); } catch (_) {}
                });
                SpotlightRegistry.__pendingSelectionCommands.length = 0;
            }
        } catch (e) {
            console.warn('OvumSpotlight: failed to process pending selection commands', e);
        }

        // Augment current FZF matches with any selected items (pin them) when select mode is active
        const augmentMatchesWithSelection = (baseMatches) => {
            try {
                if (!SpotlightRuntime.selectMode) return baseMatches;
                const out = Array.isArray(baseMatches) ? baseMatches.slice() : [];
                // Build a set of existing keys to avoid duplicates
                const have = new Set();
                for (const r of out) {
                    const it = r && r.item;
                    if (it) have.add(itemKey(it));
                }
                // Append any selected items that are not already present
                selectedMap.forEach((selItem) => {
                    const k = itemKey(selItem);
                    if (!have.has(k)) {
                        out.push({ item: selItem, score: 0, positions: [] });
                        have.add(k);
                    }
                });
                return out;
            } catch (e) {
                console.warn('OvumSpotlight: augmentMatchesWithSelection failed', e);
                return baseMatches;
            }
        };

        const rerenderList = () => {
            // Re-render current matches to update checkboxes and active highlight
            const fzf = currentFzf; // closure var defined later
            const base = fzf ? fzf.find(state.searchTextForFzf ?? '') : state.results;
            const matches = augmentMatchesWithSelection(base);
            // Clamp active index if necessary
            if (state.active >= matches.length) {
                state.active = Math.max(0, matches.length - 1);
            }
            state.results = matches;
            renderResults(ui.list, matches, state.active, state.highlightTextQuery || '', updateActiveItem, handleSelect);
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
            searchTextForFzf: "",
            highlightTextQuery: "",
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
        /** @type {import('/ovum-spotlight/js/05/spotlight-typedefs.js').SpotlightItem[]|null} */
        let currentFzf = null;
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
            state.searchTextForFzf = searchTextForFzf;
            state.highlightTextQuery = highlightTextQuery;

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
            currentFzf = fzf;

            // Brace expansion support: expand queries like a/{foo,bar}/*.js into multiple alternatives
            let expandedQueries = [];
            try {
                const ex = braces?.expand ? braces.expand(searchTextForFzf, { nodupes: true }) : [];
                if (Array.isArray(ex) && ex.length > 0) {
                    expandedQueries = ex;
                }
            } catch (_) {
                // console.log("Invalid brace expansion pattern", searchTextForFzf);
                // ignore and fallback below
            }
            if (!expandedQueries || expandedQueries.length === 0) {
                expandedQueries = [searchTextForFzf];
            }
            // Deduplicate queries and trim empties (but keep empty if original query was empty to mean 'match all')
            const originalWasEmpty = String(searchTextForFzf ?? '') === '';
            expandedQueries = Array.from(new Set(expandedQueries.map(q => String(q ?? '').trim())));
            if (!originalWasEmpty) {
                expandedQueries = expandedQueries.filter(q => q.length > 0);
            } else if (expandedQueries.length === 0) {
                expandedQueries = [''];
            }

            // If multiple expanded queries, union the results preserving the order of each query block
            let combinedMatches = [];
            if (expandedQueries.length <= 1) {
                combinedMatches = fzf.find(expandedQueries[0]);
            } else {
                const seen = new Set();
                for (const q of expandedQueries) {
                    const arr = fzf.find(q);
                    for (const m of arr) {
                        const key = m.item; // object identity is stable
                        if (!seen.has(key)) {
                            seen.add(key);
                            combinedMatches.push(m);
                        }
                    }
                }
            }

            const baseMatches = combinedMatches
                .filter(match => {
                    const positions = match.positions;
                    if (positions.size <= 1) {
                        return true;
                    }

                    // Convert positions Set to sorted array for checking adjacency
                    const posArray = Array.from(positions).sort((a, b) => a - b);

                    // Check if any positions are adjacent
                    for (let i = 0; i < posArray.length - 1; i++) {
                        if (posArray[i + 1] - posArray[i] === 1) {
                            return true;
                        }
                    }

                    return false;
                })
                .sort((a, b) => (b.score || 0) - (a.score || 0))
                .slice(0, maxMatches);
            const matches = augmentMatchesWithSelection(baseMatches);
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
            // Ensure any interactive UI is closed and promise settled
            try { interactiveClose(); } catch (_) {}
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
                const spotlightSearchCommands = app.ui.settings.getSettingValue("ovum.spotlightSelection") ?? false;
                if (!spotlightSearchCommands) {
                    close();
                }
            }
        }, 150));

        app.ui.settings.addSetting({
            category: ['ovum', 'spotlight', 'hotkey1'],
            id: "ovum.spotlightHotkey",
            name: "ovum: Spotlight hotkey",
            type: "text",
            defaultValue: "Ctrl+k"
        });
        app.ui.settings.addSetting({
            category: ['ovum', 'spotlight', 'hotkey2'],
            id: "ovum.spotlightAlternateHotkey",
            name: "ovum: Spotlight alternate hotkey",
            type: "text",
            defaultValue: "Ctrl+Space"
        });
        // app.ui.settings.addSetting({
        //     category: ['ovum', 'spotlight', 'wtf'],
        //     id: "ovum.spotlightHandlers",
        //     name: "ovum: Spotlight handlers",
        //     type: "text",
        //     defaultValue: "node,link"
        // });
        app.ui.settings.addSetting({
            category: ['ovum', 'spotlight', 'maxMatches'],
            id: "ovum.spotlightMaxMatches",
            name: "Maximum number of matches",
            type: "number",
            defaultValue: 100
        });
        app.ui.settings.addSetting({
            category: ['ovum', 'spotlight', 'visibleItems'],
            id: "ovum.spotlightVisibleItems",
            name: "Maximum number of visible items",
            type: "number",
            defaultValue: 6
        });
        app.ui.settings.addSetting({
            category: ['ovum', 'spotlight', 'visibleItems'],
            id: "ovum.spotlightSelection",
            name: "Spotlight Selection Commands (ALPHA)",
            type: "boolean",
            defaultValue: false
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
