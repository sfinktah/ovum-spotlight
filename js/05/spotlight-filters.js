// Spotlight filter parsing and application utilities
/** @typedef {import("./spotlight-typedefs.js").FilterFn} FilterFn */
/** @typedef {import("./spotlight-typedefs.js").ParsedFilter} ParsedFilter */
import {SpotlightRegistry} from "./spotlight-registry.js";
import {getNonConnectedWidgets} from "./spotlight-helper-graph.js";

// Ensure global API exposes registerFilter via SpotlightRegistry
// @ts-ignore
window.OvumSpotlight = Object.assign(window.OvumSpotlight || {}, { registerFilter: (...args) => SpotlightRegistry.registerFilter?.(...args) });

/**
 * Parse filters of the form name:value or name:"value with spaces" from the query.
 * Returns remaining text with filters removed and an array of filters.
 * @param {string} q
 * @returns {{ text:string, filters: ParsedFilter[] }}
 */
export function parseFilters (q) {
    if (!q) return { text: "", filters: [] };
    const filters = [];
    // Match filter patterns of form name:value or name:"value with spaces"
    // Important: ignore filters whose name starts with a number (e.g., "521:123" should NOT be treated as a filter)
    const re = /(\b[A-Za-z_]\w*):(?:"([^"]+)"|([^\s]+))/g;
    let m;
    while ((m = re.exec(q)) !== null) {
        const name = m[1];
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
export async function applyFilters (items, filters) {
    if (!Array.isArray(filters) || filters.length === 0) return items;
    const out = [];
    for (const it of items) {
        let ok = true;
        for (const f of filters) {
            const reg = SpotlightRegistry.filters.get(String(f.name).toLowerCase());
            if (reg) {
                try {
                    const maybe = reg(it, f.value);
                    const passed = (typeof maybe?.then === 'function') ? await maybe : !!maybe;
                    if (!passed) { ok = false; break; }
                } catch (_) {
                    ok = false; break;
                }
            } else {
                // Fallback: treat name as widget name and perform case-sensitive substring match on its value.
                // Only consider widgets whose corresponding inputs are not connected.
                const node = it?.node;
                if (!node || !Array.isArray(node.widgets)) { ok = false; break; }
                const targetName = String(f.name);
                const targetVal = String(f.value);
                let matched = false;
                const widgets = getNonConnectedWidgets(node);
                for (const w of widgets) {
                    const wName = String(w?.name ?? "");
                    if (wName === targetName) {
                        const wVal = String(w?.value ?? "");
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
