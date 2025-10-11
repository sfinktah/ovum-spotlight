// Helper functions for focusing and animating the ComfyUI canvas view
// Extracted from spotlight.js to be reusable by other Spotlight helpers

import {app} from "../../../scripts/app.js";

/**
 * Get canvas element
 * @returns {HTMLCanvasElement|undefined}
 */
function getCanvasElement () {
    return app?.canvas?.canvas;
}

/**
 * Get DragAndScale instance
 * @returns {any}
 */
function getDS () {
    return app?.canvas?.ds;
}

/**
 * Mark canvas as dirty (request redraw)
 */
function setDirty () {
    return app?.canvas?.setDirty?.(true, true);
}

/**
 * Compute a node's bounds [x, y, w, h].
 * Falls back to pos/size when getBounding is unavailable.
 * @param {any} node
 * @returns {[number, number, number, number]}
 */
export function getNodeBounds (node) {
    try {
        if (node && typeof node.getBounding === 'function') {
            const out = [0, 0, 0, 0];
            node.getBounding(out, true);
            // Ensure numbers
            return [Number(out[0])||0, Number(out[1])||0, Number(out[2])||0, Number(out[3])||0];
        }
    } catch (_) {
        // ignore
    }
    const x = node?.pos?.[0] ?? 0;
    const y = node?.pos?.[1] ?? 0;
    const w = node?.size?.[0] ?? 200;
    const h = node?.size?.[1] ?? 80;
    return [x, y, w, h];
}

/**
 * Animate the viewport to fit given bounds while keeping a desired center (in canvas pixel space),
 * with optional zoom and easing.
 * @param {[number, number, number, number]} bounds
 * @param {[number, number]|null} centerXY
 * @param {{duration?:number, zoom?:number, easing?:"linear"|"easeInQuad"|"easeOutQuad"|"easeInOutQuad"}} [opts]
 */
export function animateToBoundsWithCenter (bounds, centerXY, { duration = 350, zoom = 0.75, easing = "easeInOutQuad" } = {}) {
    const ds = getDS();
    const canvasEl = getCanvasElement();
    if (!ds || !canvasEl || !bounds) {
        return;
    }
    const easeFunctions = {
        linear: (t) => t,
        easeInQuad: (t) => t * t,
        easeOutQuad: (t) => t * (2 - t),
        easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
    };
    const easeFunction = easeFunctions[easing] ?? easeFunctions.easeInOutQuad;

    const cw = canvasEl.width / window.devicePixelRatio;
    const ch = canvasEl.height / window.devicePixelRatio;

    const startX = ds.offset[0];
    const startY = ds.offset[1];
    const startX2 = startX - (cw / ds.scale);
    const startY2 = startY - (ch / ds.scale);
    const startScale = ds.scale;

    let targetScale = startScale;
    if (zoom > 0) {
        const targetScaleX = (zoom * cw) / Math.max(bounds[2], 300);
        const targetScaleY = (zoom * ch) / Math.max(bounds[3], 300);
        targetScale = Math.min(targetScaleX, targetScaleY, ds.max_scale ?? 10);
    }

    const desiredCenter = centerXY || [cw * 0.5, ch * 0.5];
    const targetX = -bounds[0] - (bounds[2] * 0.5) + (desiredCenter[0] / targetScale);
    const targetY = -bounds[1] - (bounds[3] * 0.5) + (desiredCenter[1] / targetScale);

    const scaledWidth = cw / targetScale;
    const scaledHeight = ch / targetScale;
    const targetX2 = targetX - scaledWidth;
    const targetY2 = targetY - scaledHeight;

    const startTimestamp = performance.now();

    const animate = (timestamp) => {
        const elapsed = timestamp - startTimestamp;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeFunction(progress);

        const currentX = startX + ((targetX - startX) * eased);
        const currentY = startY + ((targetY - startY) * eased);
        ds.offset[0] = currentX;
        ds.offset[1] = currentY;

        if (zoom > 0) {
            const currentX2 = startX2 + ((targetX2 - startX2) * eased);
            const currentY2 = startY2 + ((targetY2 - startY2) * eased);
            const currentWidth = Math.abs(currentX2 - currentX);
            const currentHeight = Math.abs(currentY2 - currentY);
            ds.scale = Math.min(cw / currentWidth, ch / currentHeight);
        }

        setDirty();
        if (progress < 1) {
            animationId = requestAnimationFrame(animate);
        } else {
            cancelAnimationFrame(animationId);
        }
    };
    let animationId = requestAnimationFrame(animate);
}


/**
 * Build a focusing function that uses a provided center calculator.
 * The returned function focuses a node with a consistent animation and zoom.
 * @param {() => [number, number] | null} getCenterXYFn - function returning desired center in canvas pixel space
 * @param {number} [defaultZoom=0.75]
 * @returns {(node:any, opts?:{duration?:number, zoom?:number, easing?:"linear"|"easeInQuad"|"easeOutQuad"|"easeInOutQuad"})=>void}
 */
export function makeFocusWithCenterProvider (getCenterXYFn, defaultZoom = 0.75) {
    return function focusWithCenter (node, opts = {}) {
        const bounds = getNodeBounds(node);
        const centerXY = typeof getCenterXYFn === "function" ? (getCenterXYFn() || null) : null;
        const duration = opts.duration ?? 350;
        const zoom = opts.zoom ?? defaultZoom;
        const easing = opts.easing ?? "easeInOutQuad";
        animateToBoundsWithCenter(bounds, centerXY, { duration, zoom, easing });
    };
}


/**
 * Compute the visible center of the canvas, accounting for an overlay UI element covering the top.
 * Pass the Spotlight UI object so the helper remains decoupled from the UI module.
 * @param {{wrap: HTMLElement}} ui
 * @returns {[number, number]|null}
 */
export function getVisibleCenterCanvasXY (ui) {
    const canvasEl = getCanvasElement();
    if (!canvasEl) return null;
    const cRect = canvasEl.getBoundingClientRect();
    // Compute how much of the top of the canvas is covered by the spotlight overlay
    const overlayRect = ui.wrap.getBoundingClientRect();
    // Height of overlay overlapping canvas from the top
    let overlapTop = Math.max(0, Math.min(overlayRect.bottom, cRect.bottom) - Math.max(overlayRect.top, cRect.top));
    overlapTop = Math.min(overlapTop, cRect.height);
    const centerX = cRect.width * 0.5;
    const effectiveHeight = Math.max(0, cRect.height - overlapTop);
    const centerY = overlapTop + (effectiveHeight * 0.5);
    return [centerX, centerY];
}

/**
 * Focus a node using an overlay-aware center derived from the provided ui object.
 * @param {{wrap: HTMLElement}} ui
 * @param {any} node
 */
export function focusNodeWithOverlayAwareCenter (ui, node) {
    const fn = makeFocusWithCenterProvider(() => getVisibleCenterCanvasXY(ui), 0.75);
    fn(node);
}

/**
 * Focus a node for preview (reduced zoom), using overlay-aware center derived from ui.
 * @param {{wrap: HTMLElement}} ui
 * @param {any} node
 */
export function focusNodeWithOverlayAwareCenterPreview (ui, node) {
    const fn = makeFocusWithCenterProvider(() => getVisibleCenterCanvasXY(ui), 0.375);
    fn(node);
}
