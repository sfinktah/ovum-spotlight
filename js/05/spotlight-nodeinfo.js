// Node info providers and search JSON utilities for Spotlight
import {buildUI} from "./spotlight-helper-dom.js"; // ensure side-effects bundle styles in some builds (safe noop here)
import {getNonConnectedWidgets} from "./spotlight-helper-graph.js";

/** Build flat search text and offsets from nested array [title, itemClass, subtitleNames[], detailPairs[]] */
export function buildSearchFromJson (searchJson) {
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
export const NodeInfoProviders = {
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

// Factory for node SpotlightItem with nested search JSON and offsets for highlighting
export function makeNodeItem ({ node, displayId, parentChain, payload }) {
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
    // Only include non-connected widgets in details and keep case-sensitive names/values
    const widgets = getNonConnectedWidgets(node);
    const detailPairs = Array.isArray(widgets) ? widgets.map(w => `${w.name}:${w.value}`) : [];
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

// Expose API for UI scripts to register providers and node item helper
// @ts-ignore
window.OvumSpotlight = window.OvumSpotlight || {};
// @ts-ignore
window.OvumSpotlight.registerNodeInfoProvider = (nodeType, fn) => NodeInfoProviders.register(nodeType, fn);
// @ts-ignore
window.OvumSpotlight.makeNodeItem = makeNodeItem;
