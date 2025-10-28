// Copy of ovum/js/common/ovum_helpers.js needed by ovum-spotlight
/**
 * @typedef {import('@comfyorg/comfyui-frontend-types').ISerialisedGraph} ISerialisedGraph
 * @typedef {import('@comfyorg/comfyui-frontend-types').ComfyApiWorkflow} ComfyApiWorkflow
 */

// Module-level cache for node defs (populated asynchronously)
let _nodeDefsCache = null;
let _nodeDefsPending = null;

/**
 * Fetch and cache app.getNodeDefs() once and share across consumers.
 * Returns the defs object or null if unavailable.
 */
export async function getNodeDefsCached() {
    try {
        // app is global in ComfyUI frontend
        // @ts-ignore
        const canFetch = typeof app !== "undefined" && typeof app.getNodeDefs === "function";
        if (_nodeDefsCache) return _nodeDefsCache;
        if (!canFetch) return null;
        if (!_nodeDefsPending) {
            // @ts-ignore
            _nodeDefsPending = app.getNodeDefs()
                .then(defs => {
                    if (defs && typeof defs === "object") {
                        _nodeDefsCache = defs;
                    }
                    return _nodeDefsCache;
                })
                .catch(() => null)
                .finally(() => {
                    _nodeDefsPending = null;
                });
        }
        return await _nodeDefsPending;
    } catch (_e) {
        return null;
    }
}
