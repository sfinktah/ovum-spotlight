// Spotlight filter parsing and application utilities
/** @typedef {import("./spotlight-typedefs.js").FilterFn} FilterFn */
/** @typedef {import("./spotlight-typedefs.js").ParsedFilter} ParsedFilter */
import {SpotlightRegistry} from "./spotlight-registry.js";

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
    const re = /(\b\w+):(?:"([^"]+)"|([^\s]+))/g;
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
