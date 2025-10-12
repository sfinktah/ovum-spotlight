// Helper to render Spotlight search results list
// Accepts a runtime object containing pointer/keyboard timing and constants
import {getPositionsInRange, highlightText, updateActiveState} from "./spotlight-helper-dom.js";
import {findWidgetMatch} from "./spotlight-helper-graph.js";

/**
 * Create a showResult function bound to a runtime object.
 * @param {object} runtime - Object with hover/keyboard state and constants
 * @param {number} runtime.LEFT_MOUSE_BUTTON
 * @param {number} runtime.lastPointerMoveTime
 * @param {number} runtime.lastKeyboardNavigationTime
 * @param {boolean} runtime.ignoreHoverUntilMove
 * @param {number} runtime.HOVER_SUPPRESSION_WINDOW_MS
 * @returns {(listEl:HTMLElement, results:any[], activeIdx:number, searchText:string, onActiveChange:(idx:number)=>void, onSelect:(r:any)=>void)=>void}
 */
export function createShowResult (runtime) {
    /**
     * Render results into listEl and wire interactions.
     */
    return function showResult (listEl, results, activeIdx, searchText, onActiveChange, onSelect) {
        listEl.innerHTML = "";
        results.forEach((r, idx) => {
            const div = document.createElement("div");
            div.className = "ovum-spotlight-item" + (idx === activeIdx ? " active" : "");
            div.dataset.index = String(idx);

            // Highlight using offsets derived from nested searchJson if available
            let highlightedTitle = r.item.title;
            let highlightedSub = r.item.itemClass;

            if (r.positions && (r.item.searchOffsets || r.item.searchText)) {
                const positions = r.positions;
                const offsets = r.item.searchOffsets;
                if (offsets) {
                    // Title
                    const [ts, te] = offsets.title || [0, 0];
                    const titlePositions = getPositionsInRange(positions, ts, te);
                    if (titlePositions.length) {
                        highlightedTitle = highlightText(r.item.title, titlePositions);
                    }
                    // Class
                    const [cs, ce] = offsets.itemClass || [0, 0];
                    const classPositions = getPositionsInRange(positions, cs, ce);
                    if (classPositions.length && r.item.itemClass) {
                        highlightedSub = highlightText(r.item.itemClass, classPositions);
                    }
                } else if (r.item.searchText) {
                    // Fallback: legacy mapping by indexOf
                    const full = r.item.searchText;
                    const typeText = r.item.node?.type || r.item.itemClass || '';
                    const titleText = r.item.node?.title || r.item.node?.type || r.item.title || '';
                    const titleStart = titleText ? full.indexOf(titleText) : -1;
                    if (titleStart >= 0) {
                        const titlePositions = getPositionsInRange(positions, titleStart, titleStart + titleText.length);
                        if (titlePositions.length) highlightedTitle = highlightText(r.item.title, titlePositions);
                    }
                    const typeStart = (typeText && full.indexOf) ? full.indexOf(typeText) : -1;
                    if (typeStart >= 0) {
                        const typePositions = getPositionsInRange(positions, typeStart, typeStart + typeText.length);
                        if (typePositions.length && r.item.itemClass) highlightedSub = highlightText(r.item.itemClass, typePositions);
                    }
                }
            }

            // Determine node state badges (muted/bypassed)
            const n = r.item.node;
            const isMuted = !!(n && (n.mode === 2));
            const isBypassed = !!(n && (n.mode === 4));
            const badgesHtml = (isMuted || isBypassed)
                ? `<span class="state-badges">${isMuted ? '<span class="badge badge-muted">muted</span>' : ''}${isBypassed ? '<span class="badge badge-bypassed">bypassed</span>' : ''}</span>`
                : "";

            let html = `<div class="item-main"><div class="item-title-row"><span class="item-title-text">${highlightedTitle}</span> ${badgesHtml}</div>`;

            // Add parent chain if exists
            if (r.item.itemSubtitlePath && r.item.itemSubtitlePath.length > 0) {
                html += `<div class="item-subtitle">`;
                r.item.itemSubtitlePath.forEach((parent, idx) => {
                    html += `<div class="item-subtitle-item">${parent.title || parent.type}</div>`;
                    if (idx < r.item.itemSubtitlePath.length - 1) {
                        html += `<span>›</span>`;
                    }
                });
                html += `</div>`;
            }

            html += `</div>`;

            // Create flex container for .item-class and .item-details
            let detailsHtml = '';
            if (r.item.itemClass) {
                detailsHtml += `<div class="item-class">${highlightedSub}</div>`;
            }

            // Check if there's a widget match to display
            if (r.item.node && r.item.itemDetails && searchText) {
                const widgetMatch = findWidgetMatch(r.item.node, searchText);
                if (widgetMatch) {
                    const highlightedSnippet = highlightText(widgetMatch.snippet, widgetMatch.matchPositions);
                    const namePart = widgetMatch.prefix ? '' : `<strong>${widgetMatch.name}:</strong> `;
                    detailsHtml += `<div class="item-details">${namePart}${widgetMatch.prefix}${highlightedSnippet}${widgetMatch.suffix}</div>`;
                }
            }

            if (detailsHtml) {
                html += `<div class="item-meta">${detailsHtml}</div>`;
            }

            div.innerHTML = html;

            // Add mouseover handler to update active state (only when the pointer actually moved recently and no recent keyboard navigation)
            div.addEventListener("mouseover", () => {
                // Ignore hover if we're explicitly ignoring until mouse moves
                if (runtime.ignoreHoverUntilMove) {
                    return;
                }

                const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
                const pointerMovedRecently = (now - runtime.lastPointerMoveTime) < runtime.HOVER_SUPPRESSION_WINDOW_MS;
                const keyboardNavigatedRecently = (now - runtime.lastKeyboardNavigationTime) < runtime.HOVER_SUPPRESSION_WINDOW_MS;

                // Only update active state if pointer moved recently and no recent keyboard navigation
                if (pointerMovedRecently && !keyboardNavigatedRecently) {
                    if (onActiveChange) {
                        onActiveChange(idx);
                    }
                }
            });

            // Add mousedown handler to select item (fires before blur)
            div.addEventListener("mousedown", (e) => {
                if (e.button !== runtime.LEFT_MOUSE_BUTTON) {
                    return;
                } // Only react to left mouse button
                e.preventDefault(); // Prevent input from losing focus
                if (onSelect) {
                    onSelect(r);
                }
            });

            listEl.appendChild(div);
        });

        // Scroll active item into view
        updateActiveState(listEl, activeIdx);
    };
}
