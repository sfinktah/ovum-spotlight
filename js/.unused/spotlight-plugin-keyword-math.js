import {app} from "../../../scripts/app.js";
// Optional: use showAlert helper for toast messages if available
// We import lazily via window to avoid hard dependency across packages.

/** @typedef {import("./spotlight-typedefs.js").ISpotlightRegistry} ISpotlightRegistry */
/** @typedef {import("./spotlight-typedefs.js").SpotlightHandlerContext} SpotlightHandlerContext */

/**
 * Display a toast message with a custom icon and color.
 * @param detail
 * @param {ToastMessageOptions} options - Toast message configuration options
 * @param {'success' | 'info' | 'warn' | 'error' | 'secondary' | 'contrast'} [options.severity='info'] - Severity level of the message.
 * @param {string} [options.summary] - Summary content of the message.
 * @param {*} [options.detail] - Detail content of the message.
 * @param {boolean} [options.closable=true] - Whether the message can be closed manually using the close icon.
 * @param {number} [options.life] - Delay in milliseconds to close the message automatically.
 * @param {string} [options.group] - Key of the Toast to display the message.
 * @param {*} [options.styleClass] - Style class of the message.
 * @param {*} [options.contentStyleClass] - Style class of the content.
 */
export function showAlert(detail, options = {}) {
    return app.extensionManager.toast.add({
        severity: 'warn',
        summary: "Get/SetTwinNodes",
        detail: detail,
        life: 5000,
        ...options
    })
}

function isSafeExpression(expr) {
    if (!expr) return false;
    const s = String(expr);
    // Disallow any letters, quotes, template strings
    if (/[A-Za-z_`'\"]/g.test(s)) return false;
    // Disallow comment tokens
    if (/\/\/|\/\*|\*\//.test(s)) return false;
    // Disallow logical operators
    if (/&&|\|\|/.test(s)) return false;
    // Only allowed characters: digits, whitespace, parentheses, decimal point, and operators
    // + - * / % ** & | ^ ~ << >> >>>
    if (!/^[0-9+\-*/%&|^~().\s<>]*$/.test(s)) return false;
    // Reject any standalone < or > not part of <<, >>, or >>> (shifts)
    let tmp = s;
    tmp = tmp.replace(/>>>/g, "");
    tmp = tmp.replace(/<<|>>/g, "");
    if (/[<>]/.test(tmp)) return false;
    // Allow exponent ** explicitly (already permitted by char whitelist)
    return true;
}

function evalExpression(expr) {
    if (!expr || !isSafeExpression(expr)) {
        throw new Error("Unsafe or empty expression");
    }
    // Evaluate using Function in a confined scope; only arithmetic allowed by validation above
    // Support exponent by allowing ** which is valid JS.
    // Wrap with parentheses to respect full expression.
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return ( ${expr} );`);
    const res = fn();
    if (typeof res !== 'number' || !isFinite(res)) {
        throw new Error("Expression did not evaluate to a finite number");
    }
    return res;
}

async function copyToClipboard(text) {
    try {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(String(text));
            return true;
        }
    } catch (_) { /* ignore and fallback */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = String(text);
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        return true;
    } catch (_) {
        return false;
    }
}

function toastInfo(detail) {
    try {
        if (typeof showAlert === 'function') {
            showAlert(detail, { severity: 'info', summary: 'Spotlight' });
            return;
        }
    } catch (_) { /* ignore */ }
    app?.extensionManager?.toast?.add?.({ severity: 'info', summary: 'Spotlight', detail, life: 4000 });
}

// Plugin to provide the "math" keyword handler for Ovum Spotlight
app.registerExtension({
    name: "ovum.spotlight.keyword.math",
    setup () {
        /** @type {ISpotlightRegistry | undefined} */
        const OvumSpotlight = /** @type {ISpotlightRegistry | undefined} */ (window.OvumSpotlight);
        OvumSpotlight?.registerKeywordHandler("math", (text, /** @type {SpotlightHandlerContext} */ ctx) => {
            ctx?.setPlaceholder?.("Enter a math expression, e.g., 2+2*5, (1+2)/3, 5|3, 8>>1, ~7");
            const q = String(text || "").trim();
            if (!q) return { items: [] };
            try {
                const result = evalExpression(q);
                /** @type {import('./spotlight-typedefs.js').CommandItem} */
                const item = {
                    "@type": "command",
                    id: `math:${q}`,
                    title: `${q} = ${result}`,
                    itemClass: 'math',
                    onSelect: async () => {
                        const ok = await copyToClipboard(result);
                        toastInfo(ok ? `Copied to clipboard: ${result}` : `Result: ${result}`);
                    },
                    searchText: `${q} ${result}`,
                };
                return { items: [item] };
            } catch (e) {
                const msg = (e && e.message) ? e.message : String(e);
                /** @type {import('./spotlight-typedefs.js').CommandItem} */
                const item = {
                    "@type": "command",
                    id: `math-error:${q}`,
                    title: `Invalid expression`,
                    itemClass: 'math',
                    onSelect: () => toastInfo(`Invalid expression: ${q} (${msg})`),
                    searchText: `${q}`,
                };
                return { items: [item] };
            }
        });
    }
});
