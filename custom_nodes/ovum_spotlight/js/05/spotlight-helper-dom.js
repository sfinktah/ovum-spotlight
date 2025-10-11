// Helper DOM and text utilities for Spotlight
/** @typedef {import("./spotlight-typedefs.js").SpotlightUI} SpotlightUI */

/** @typedef {import("./spotlight-typedefs.js").HighlightPositions} HighlightPositions */

/** Create and inject Spotlight CSS styles once. */
export function createStyles () {
    if (document.getElementById("ovum-spotlight-style")) {
        return;
    }
    const style = document.createElement("style");
    style.id = "ovum-spotlight-style";
    style.textContent = `
    .ovum-spotlight { position: fixed; left: 50%; top: 12%; transform: translateX(-50%); width: min(800px, 90vw); border-radius: 14px; background: #2b2b2b; box-shadow: 0 20px 60px rgba(0,0,0,.7); z-index: 10000; color: #eee; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
    .ovum-spotlight.hidden { display:none; }
    .ovum-spotlight-header { display: flex; align-items: center; gap: 10px; background: #1f1f1f; border-radius: 14px 14px 0 0; padding: 18px 22px; }
    .ovum-spotlight-badge { background:#3b3b3b; color:#bbb; padding:4px 10px; border-radius:10px; font-size:12px; pointer-events:none; white-space: nowrap; }
    .ovum-spotlight-badge.hidden { display: none; }
    .ovum-spotlight-input { flex: 1; box-sizing: border-box; background: transparent; border: none; padding: 0; font-size: 28px; color: #fff; outline: none; }
    .ovum-spotlight-list { overflow:auto; padding: 10px 0; }
    .ovum-spotlight-item { display:flex; gap:10px; align-items:center; padding: 12px 18px; font-size: 20px; border-top: 1px solid rgba(255,255,255,.04); cursor: pointer; transition: background 0.15s ease; }
    .ovum-spotlight.hover-enabled .ovum-spotlight-item:hover { background: #2f7574; }
    .ovum-spotlight-item .item-main { flex: 1; }
    .ovum-spotlight-item .item-title-row { display:flex; align-items:center; gap:8px; }
    .ovum-spotlight-item .item-title-row .item-title-text { display: inline; }
    .ovum-spotlight-item .state-badges { display:flex; gap:6px; align-items:center; }
    .ovum-spotlight-item .badge { font-size: 11px; padding: 2px 6px; border-radius: 6px; background: rgba(255,255,255,.08); color:#ddd; text-transform: uppercase; letter-spacing: .4px; }
    .ovum-spotlight-item .badge-bypassed { background: #734b4b; color: #ffd9d9; }
    .ovum-spotlight-item .badge-muted { background: #6b6b6b; color: #e6e6e6; }
    .ovum-spotlight-item .item-meta { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
    .ovum-spotlight-item .item-class { opacity:.6; font-size: 14px; }
    .ovum-spotlight-item .item-details { opacity:.7; font-size: 12px; font-family: Inconsolata, monospace; background: rgba(255,255,255,.05); padding: 2px 8px; border-radius: 4px; max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ovum-spotlight-item .item-subtitle { display: flex; gap: 6px; align-items: center; font-size: 12px; opacity: .5; margin-top: 4px; flex-wrap: wrap; }
    .ovum-spotlight-item .item-subtitle-item { background: rgba(255,255,255,.08); padding: 2px 8px; border-radius: 4px; }
    .ovum-spotlight-item.active { background: #2f7574; }
    .ovum-spotlight-highlight { color: #4fd1c5; font-weight: 600; }
    .ovum-spotlight-bigbox { border-top: 1px solid rgba(255,255,255,.08); max-height: 60vh; overflow: auto; width: 100%; box-sizing: border-box; padding: 10px 18px 18px; border-radius: 0 0 14px 14px; }
    .ovum-spotlight-bigbox.hidden { display:none; }
    .ovum-spotlight-bigbox, .ovum-spotlight-bigbox * { max-width: 100%; }
    `;
    document.head.appendChild(style);
}

/**
 * Build the Spotlight UI and attach it to document.body.
 * @returns {SpotlightUI}
 */
export function buildUI () {
    createStyles();
    const wrap = document.createElement("div");
    wrap.className = "ovum-spotlight hidden";
    const header = document.createElement("div");
    header.className = "ovum-spotlight-header";
    const badge = document.createElement("div");
    badge.className = "ovum-spotlight-badge hidden";
    const input = document.createElement("input");
    input.className = "ovum-spotlight-input";
    input.placeholder = "Search nodes, links, ids…";
    const list = document.createElement("div");
    list.className = "ovum-spotlight-list";
    const bigbox = document.createElement("div");
    bigbox.className = "ovum-spotlight-bigbox hidden";
    header.appendChild(badge);
    header.appendChild(input);
    wrap.appendChild(header);
    wrap.appendChild(list);
    wrap.appendChild(bigbox);
    document.body.appendChild(wrap);
    return {wrap, input, list, badge, bigbox};
}

/** Return positions within [start,end) covered by fzf positions array
 * @param {Iterable<number>|number[]|Set<number>} positions
 * @param {number} start
 * @param {number} end
 * @returns {number[]}
 */
export function getPositionsInRange (positions, start, end) {
    if (!positions) return [];
    const posArr = Array.isArray(positions) ? positions : (typeof positions.size === 'number' || typeof positions.values === 'function') ? Array.from(positions) : [];
    if (!posArr.length) return [];
    const inside = [];
    for (const p of posArr) {
        if (p >= start && p < end) inside.push(p - start);
    }
    return inside;
}

/** Wrap matched ranges in <span class="ovum-spotlight-highlight">
 * @param {string} text
 * @param {HighlightPositions|number[]} positions
 * @returns {string}
 */
export function highlightText (text, positions) {
    if (!positions || !positions.length) return text;
    let html = "";
    for (let i = 0; i < text.length; i++) {
        if (positions.includes(i)) {
            // start of a highlight run
            let j = i;
            while (j < text.length && positions.includes(j)) j++;
            html += `<span class="ovum-spotlight-highlight">${text.slice(i, j)}</span>`;
            i = j - 1;
        } else {
            html += text[i];
        }
    }
    return html;
}

/**
 * Updates the active state of items within a list element. The item at the specified index will
 * have the "active" class added, while other items will have the "active" class removed.
 * Additionally, the active item will be scrolled into view.
 *
 * @param {HTMLElement} listEl - The parent HTML element containing child elements to update.
 * @param {number} activeIdx - The index of the child element to set as active.
 * @return {void} This function does not return a value.
 */
export function updateActiveState (listEl, activeIdx) {
    // Update active class on items
    Array.from(listEl.children).forEach((child, idx) => {
        if (idx === activeIdx) {
            child.classList.add("active");
        } else {
            child.classList.remove("active");
        }
    });

    // Scroll active item into view
    const activeItem = listEl.children[activeIdx];
    if (activeItem) {
        activeItem.scrollIntoView({block: "nearest", behavior: "smooth"});
    }
}