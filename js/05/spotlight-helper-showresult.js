// Helper to render Spotlight search results list
// Accepts a runtime object containing pointer/keyboard timing and constants
import {getPositionsInRange, highlightText, updateActiveState} from "./spotlight-helper-dom.js";
import {findWidgetMatch} from "./spotlight-helper-graph.js";
import {$el} from "../../../scripts/ui.js";

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
            // Prepare highlighted pieces as HTML strings (already sanitized by our highlighter)
            let highlightedTitle = r.item.title;
            let highlightedSub = r.item.itemClass;

            if (r.positions && (r.item.searchOffsets || r.item.searchJson || r.item.searchText)) {
                const positions = r.positions;
                const offsets = r.item.searchOffsets;
                if (offsets) {
                    // Title
                    const [ts, te] = offsets.title || [0, 0];
                    const titlePositions = getPositionsInRange(positions, ts, te);
                    if (titlePositions.length) highlightedTitle = highlightText(r.item.title, titlePositions);
                    // Class
                    const [cs, ce] = offsets.itemClass || [0, 0];
                    const classPositions = getPositionsInRange(positions, cs, ce);
                    if (classPositions.length && r.item.itemClass) highlightedSub = highlightText(r.item.itemClass, classPositions);
                } else if (r.item.searchJson || r.item.searchText) {
                    // Fallback: derive flat text from searchJson (preferred) or legacy searchText
                    let full = '';
                    if (Array.isArray(r.item.searchJson)) {
                        try { full = r.item.searchJson.flat(Infinity).filter(Boolean).join(' '); } catch (e) { full = String(r.item.searchText || ''); }
                    } else {
                        full = String(r.item.searchText || '');
                    }
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

            const n = r.item.node;
            const isMuted = !!(n && (n.mode === 2));
            const isBypassed = !!(n && (n.mode === 4));

            // Build main item container
            const div = $el("div.ovum-spotlight-item", {
                className: idx === activeIdx ? "ovum-spotlight-item active" : "ovum-spotlight-item",
                dataset: { index: String(idx) },
                onmouseover: () => {
                    if (runtime.ignoreHoverUntilMove) return;
                    const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
                    const pointerMovedRecently = (now - runtime.lastPointerMoveTime) < runtime.HOVER_SUPPRESSION_WINDOW_MS;
                    const keyboardNavigatedRecently = (now - runtime.lastKeyboardNavigationTime) < runtime.HOVER_SUPPRESSION_WINDOW_MS;
                    if (pointerMovedRecently && !keyboardNavigatedRecently) {
                        if (onActiveChange) onActiveChange(idx);
                    }
                },
                onmousedown: (e) => {
                    if (e.button !== runtime.LEFT_MOUSE_BUTTON) return;
                    e.preventDefault();
                    if (onSelect) onSelect(r);
                }
            });

            // Item main section with title row (use $el children arrays for brevity)
            // Ensure the node id token appears inside a span.item-node-id within .item-title-text
            const displayId = r.item.id != null ? String(r.item.id) : "";
            const idTag = displayId ? `#${displayId}` : "";
            let titleHtml = highlightedTitle;
            if (idTag) {
                // Case 1: the entire idTag is inside a highlight span (common when searching by id)
                const highlightedIdPattern = `<span class="ovum-spotlight-highlight">${idTag.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}<\\/span>`;
                const highlightedIdRegex = new RegExp(highlightedIdPattern, "g");
                titleHtml = titleHtml.replace(highlightedIdRegex, `<span class="item-node-id">$&</span>`);
                // Case 2: plain text occurrence
                if (titleHtml.indexOf("item-node-id") === -1) {
                    const plainIdRegex = new RegExp(idTag.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "g");
                    titleHtml = titleHtml.replace(plainIdRegex, `<span class="item-node-id">${idTag}</span>`);
                }
            }
            const titleSpan = $el("span.item-title-text", { innerHTML: titleHtml });
            // Additional robust wrapping to handle partial highlights within the id token
            if (idTag && titleSpan.textContent && titleSpan.textContent.indexOf(idTag) !== -1 && !titleSpan.querySelector(".item-node-id")) {
                const startIndex = titleSpan.textContent.indexOf(idTag);
                const endIndex = startIndex + idTag.length;
                try {
                    const range = document.createRange();
                    const locate = (root, charIndex) => {
                        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                        let remaining = charIndex;
                        let node;
                        while ((node = walker.nextNode())) {
                            const len = node.nodeValue ? node.nodeValue.length : 0;
                            if (remaining <= len) {
                                return { node, offset: Math.max(0, remaining) };
                            }
                            remaining -= len;
                        }
                        return { node: root, offset: root.childNodes.length };
                    };
                    const startPos = locate(titleSpan, startIndex);
                    const endPos = locate(titleSpan, endIndex);
                    if (startPos.node && endPos.node) {
                        range.setStart(startPos.node, startPos.offset);
                        range.setEnd(endPos.node, endPos.offset);
                        const wrapper = document.createElement("span");
                        wrapper.className = "item-node-id";
                        const contents = range.extractContents();
                        wrapper.appendChild(contents);
                        range.insertNode(wrapper);
                    }
                } catch (e) {
                    // swallow
                }
            }
            const badgeEl = (() => {
                if (!(isMuted || isBypassed)) return null;
                const badges = $el("span.state-badges");
                if (isMuted) badges.appendChild($el("span.badge.badge-muted", { textContent: "muted" }));
                if (isBypassed) badges.appendChild($el("span.badge.badge-bypassed", { textContent: "bypassed" }));
                return badges;
            })();
            const titleRow = $el("div.item-title-row", {}, badgeEl ? [titleSpan, badgeEl] : [titleSpan]);

            // Parent chain subtitle
            let subtitle = null;
            if (r.item.itemSubtitlePath && r.item.itemSubtitlePath.length > 0) {
                const subtitleChildren = [];
                r.item.itemSubtitlePath.forEach((parent, pIdx) => {
                    subtitleChildren.push($el("div.item-subtitle-item", { textContent: parent.title || parent.type }));
                    if (pIdx < r.item.itemSubtitlePath.length - 1) subtitleChildren.push($el("span", { textContent: "›" }));
                });
                subtitle = $el("div.item-subtitle", {}, subtitleChildren);
            }

            const itemMain = $el("div.item-main", {}, subtitle ? [titleRow, subtitle] : [titleRow]);
            div.appendChild(itemMain);

            // Meta section: class and widget details
            const metaChildren = [];
            if (r.item.itemClass) {
                metaChildren.push($el("div.item-class", { innerHTML: highlightedSub }));
            }

            if (r.item.node && r.item.itemDetails && searchText) {
                const widgetMatch = findWidgetMatch(r.item.node, searchText);
                if (widgetMatch) {
                    const highlightedSnippet = highlightText(widgetMatch.snippet, widgetMatch.matchPositions);
                    const detailsEl = $el("div.item-details");
                    if (!widgetMatch.prefix) {
                        detailsEl.appendChild($el("strong", { textContent: `${widgetMatch.name}:` }));
                        detailsEl.appendChild(document.createTextNode(" "));
                    }
                    if (widgetMatch.prefix) detailsEl.appendChild(document.createTextNode(widgetMatch.prefix));
                    detailsEl.appendChild($el("span", { innerHTML: highlightedSnippet }));
                    if (widgetMatch.suffix) detailsEl.appendChild(document.createTextNode(widgetMatch.suffix));
                    metaChildren.push(detailsEl);
                }
            }

            if (metaChildren.length) {
                const meta = $el("div.item-meta", {}, metaChildren);
                div.appendChild(meta);
            }

            listEl.appendChild(div);
        });

        // Scroll active item into view
        updateActiveState(listEl, activeIdx);
    };
}
