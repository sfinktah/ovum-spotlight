import {app} from "../../../scripts/app.js";
/** @typedef {import("./spotlight-typedefs.js").ISpotlightRegistry} ISpotlightRegistry */
/** @typedef {import("./spotlight-typedefs.js").SpotlightHandlerContext} SpotlightHandlerContext */
/** @typedef {import("./spotlight-typedefs.js").CommandItem} CommandItem */

// Plugin to provide primitive quick-create via keywords: "int", "float", "string"
// Usage examples inside Spotlight input:
//   int = 5
//   float = 3.14
//   string = "hello world"
// Selecting the command will create a Primitive* node at the visible center and select it.
app.registerExtension({
    name: "ovum.spotlight.keyword.primitive",
    setup () {
        /** @type {ISpotlightRegistry | undefined} */
        const OvumSpotlight = /** @type {ISpotlightRegistry | undefined} */ (window.OvumSpotlight);

        /**
         * Parse pattern "= value" after a given primitive type.
         * Supports quoted strings and unquoted.
         * @param {"int"|"float"|"string"} kind
         * @param {string} text
         * @returns {{ok:boolean, displayValue:string, value:any}}
         */
        function parseValue(kind, text) {
            const m = String(text || "").match(/^\s*=\s*(.*)$/);
            if (!m) return { ok:false, displayValue:"", value:null };
            let raw = m[1].trim();
            if (kind === 'int') {
                // allow trailing non-digits to be ignored gracefully
                const mm = raw.match(/^[+-]?\d+/);
                if (!mm) return { ok:false, displayValue:"", value:null };
                const n = parseInt(mm[0], 10);
                return { ok:true, displayValue: String(n), value: n };
            }
            if (kind === 'float') {
                // match common float forms
                const mm = raw.match(/^[+-]?(?:\d*\.\d+|\d+\.\d*|\d+)(?:[eE][+-]?\d+)?/);
                if (!mm) return { ok:false, displayValue:"", value:null };
                const n = parseFloat(mm[0]);
                return { ok:true, displayValue: String(n), value: n };
            }
            // string: accept quoted or unquoted remainder
            if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
                raw = raw.slice(1, -1);
            }
            return { ok:true, displayValue: raw, value: raw };
        }

        /**
         * Create a Primitive* node, set widgets, position at visible center, and select it.
         * @param {"int"|"float"|"string"} kind
         * @param {any} value
         */
        function createPrimitiveNode(kind, value) {
            try {
                const canvas = app?.canvas;
                const graph = app?.graph;
                const LiteGraph = window.LiteGraph;
                if (!canvas || !graph || !LiteGraph) return;

                const typeMap = { int: 'PrimitiveInt', float: 'PrimitiveFloat', string: 'PrimitiveString' };
                const nodeType = typeMap[kind];
                const node = LiteGraph.createNode(nodeType);
                if (!node) return;
                graph.add(node);

                // Set widget values
                try {
                    if (Array.isArray(node.widgets)) {
                        for (const w of node.widgets) {
                            if (!w) continue;
                            if (String(w.name).toLowerCase() === 'value') {
                                // direct set; many widgets react to .value change
                                w.value = value;
                            }
                            if (kind === 'int' && String(w.name).toLowerCase() === 'control after generate') {
                                w.value = 'fixed';
                            }
                        }
                        if (typeof node.onResize === 'function') node.onResize(node.size);
                        if (typeof node.onPropertyChanged === 'function') node.onPropertyChanged('value', value);
                    }
                } catch (_) { /* ignore */ }

                // Compute visible center relative to canvas element and convert to canvas coords
                try {
                    const el = canvas.canvas;
                    const rect = el?.getBoundingClientRect?.();
                    if (rect && canvas?.convertOffsetToCanvas) {
                        const centerOffset = [rect.width * 0.5, rect.height * 0.5];
                        const [cx, cy] = canvas.convertOffsetToCanvas(centerOffset, []);
                        // place node centered on that point
                        const w = node.size?.[0] ?? 200;
                        const h = node.size?.[1] ?? 80;
                        node.pos = [cx - w * 0.5, cy - h * 0.5];
                    }
                } catch (_) { /* ignore positioning errors */ }

                // Select the node
                try { canvas.selectNode(node, false); } catch (_) { /* ignore */ }
                try { canvas.setDirty?.(true, true); } catch (_) { /* ignore */ }
            } catch (e) {
                console.warn('OvumSpotlight primitive create error', e);
            }
        }

        /**
         * Register a keyword handler for a given primitive kind.
         * @param {"int"|"float"|"string"} kind
         */
        function register(kind) {
            OvumSpotlight?.registerKeywordHandler(kind, (text, /** @type {SpotlightHandlerContext} */ ctx) => {
                ctx?.setPlaceholder?.(`Type: ${kind} = <value>`);
                const { ok, displayValue, value } = parseValue(kind, text || '');
                if (!ok) return { items: [] };
                /** @type {CommandItem} */
                const item = {
                    "@type": 'command',
                    id: `${kind}-create-${displayValue}`,
                    title: `Create a primitive ${kind} Node with the value \`${displayValue}\``,
                    itemClass: 'create',
                    searchText: `${kind} create ${displayValue}`,
                    onSelect: () => createPrimitiveNode(kind, value)
                };
                return { items: [item] };
            });
        }

        register('int');
        register('float');
        register('string');
    }
});
