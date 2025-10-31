// Spotlight Registry: manages keyword handlers and default handlers, and selection command queue
/** @typedef {import("./spotlight-typedefs.js").ISpotlightRegistry} ISpotlightRegistry */

/**
 * Simple plugin registry to allow external nodes to inject spotlight search providers
 * @type {ISpotlightRegistry}
 */
export const SpotlightRegistry = {
    keywordHandlers: new Map(), // keyword -> (text:string)=>{items, handler}
    defaultHandlers: [],        // list of () => {items, handler:""}
    filters: new Map(),         // name -> (item:any, value:string)=>boolean|Promise<boolean>
    /**
     * Queue for selection commands registered before UI initializes.
     * @private
     */
    __pendingSelectionCommands: [],
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
    },
    /**
     * Register a filter used by key:value query parsing.
     * @param {string} name
     * @param {import('./spotlight-typedefs.js').FilterFn} callback
     */
    registerFilter (name, callback) {
        if (typeof callback !== "function") {
            throw new Error(`Invalid filter callback for "${String(name ?? "")}". Callback must be a function.`);
        }
        const s = String(name ?? "");
        // Validate filter name: must start with a letter or underscore, followed by word characters
        // This mirrors the parsing rule used in spotlight-filters.js
        const isValid = /^[A-Za-z_]\w*$/.test(s);
        if (!isValid) {
            throw new Error(`Invalid filter name "${s}". Filter names must start with a letter or underscore and contain only letters, numbers, or underscores.`);
        }
        this.filters.set(s.toLowerCase(), callback);
    },
    /**
     * Register a command to appear in the Spotlight footer palettes.
     * If the UI has not initialized yet, the command is queued and will be registered later.
     * Third-parties can also call window.OvumSpotlight.registerSelectionCommand.
     * @param {import('./spotlight-typedefs.js').SpotlightCommand} cmd
     */
    registerSelectionCommand (cmd) {
        try {
            // During boot, spotlight.js may not have built the CommandRegistry yet; queue it.
            this.__pendingSelectionCommands.push(cmd);
            // If UI is already initialized and a global API was exposed, forward immediately too.
            // @ts-ignore
            if (window?.OvumSpotlight && typeof window.OvumSpotlight.__registerSelectionCommandNow === 'function') {
                // @ts-ignore
                window.OvumSpotlight.__registerSelectionCommandNow(cmd);
            }
        } catch (_) {}
    }
};

// Merge SpotlightRegistry into any existing OvumSpotlight object to avoid losing previously attached helpers
// @ts-ignore
window.OvumSpotlight = Object.assign(window.OvumSpotlight || {}, SpotlightRegistry);
