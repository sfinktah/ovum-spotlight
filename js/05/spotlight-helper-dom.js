// Helper DOM and text utilities for Spotlight
/** @typedef {import("./spotlight-typedefs.js").SpotlightUI} SpotlightUI */

/** @typedef {import("./spotlight-typedefs.js").HighlightPositions} HighlightPositions */

/** Create and inject Spotlight CSS styles once. */
export function createStyles () {
    if (document.getElementById("ovum-spotlight-style")) {
        return;
    }
    const link = document.createElement("link");
    link.id = "ovum-spotlight-style";
    link.rel = "stylesheet";
    // The CSS is built to this path by `npm run build:css` (vite --mode css)
    link.href = "/ovum-spotlight/web/css/tailwind.css";
    document.head.appendChild(link);
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
    const footer = document.createElement("div");
    footer.className = "ovum-spotlight-footer";
    const palettePrimary = document.createElement("div");
    palettePrimary.className = "ovum-spotlight-palette ovum-spotlight-palette-primary";
    const paletteSelection = document.createElement("div");
    paletteSelection.className = "ovum-spotlight-palette ovum-spotlight-palette-selection hidden";
    const paletteInteractive = document.createElement("div");
    paletteInteractive.className = "ovum-spotlight-palette ovum-spotlight-palette-interactive hidden";
    footer.appendChild(paletteSelection);
    footer.appendChild(palettePrimary);
    header.appendChild(badge);
    header.appendChild(input);
    wrap.appendChild(header);
    wrap.appendChild(list);
    wrap.appendChild(bigbox);
    wrap.appendChild(footer);
    wrap.appendChild(paletteInteractive);
    document.body.appendChild(wrap);
    return {wrap, input, list, badge, bigbox, footer, palettePrimary, paletteSelection, paletteInteractive};
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