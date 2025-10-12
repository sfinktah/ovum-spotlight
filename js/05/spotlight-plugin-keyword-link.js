import {app} from "../../../scripts/app.js";
/** @typedef {import("./spotlight-typedefs.js").ISpotlightRegistry} ISpotlightRegistry */
/** @typedef {import("./spotlight-typedefs.js").SpotlightHandlerContext} SpotlightHandlerContext */
/** @typedef {import("./spotlight-typedefs.js").SpotlightItem} SpotlightItem */

// Plugin to provide the "link" keyword handler for Ovum Spotlight
app.registerExtension({
    name: "ovum.spotlight.keyword.link",
    setup () {
        // Register keyword handler: "link"
        // Usage in Spotlight: "link" (optionally followed by text; current implementation lists all links)
        /** @type {ISpotlightRegistry | undefined} */
        const OvumSpotlight = /** @type {ISpotlightRegistry | undefined} */ (window.OvumSpotlight);
        OvumSpotlight?.registerKeywordHandler("link", (text, /** @type {SpotlightHandlerContext} */ ctx) => {
            ctx?.setPlaceholder?.("Search for links by link ids...");
            try {
                const links = ctx?.allLinks?.() || {};
                const items = Object.entries(links).map(([id, l]) => ({
                    "@type": "link",
                    id: Number(id),
                    title: `Link ${id}: ${l.origin_id} -> ${l.target_id}`,
                    link: l
                }));
                return {items};
            } catch (e) {
                console.warn("OvumSpotlight link keyword handler error", e);
                return {items: []};
            }
        });
    }
});
