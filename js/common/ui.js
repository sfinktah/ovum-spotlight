// console.log(comfyAPI.ui.$el + '')
/**
 * $el(tag, propsOrChildren?, children?)
 *
 * Tiny DOM helper to create an element with optional classes, set common
 * properties in one go, and append children. It mirrors ComfyUI’s built-in
 * comfyAPI.ui.$el, with a few conveniences used across this project.
 *
 * Basics
 * - The first argument is a tag name with optional dot-separated classes.
 *   For example: "div", "div.panel", "button.btn.primary".
 * - The second argument may be either:
 *   • an object of properties (see below),
 *   • a string (assigned to textContent),
 *   • a single Element (treated as [element]), or
 *   • an array of nodes to append as children.
 * - The optional third argument is additional child or children. It is used
 *   only when the second argument is an object of properties.
 *
 * Property object special keys
 * - parent: Element — if provided, the created element is appended to it.
 * - $: (el: Element) => void — a small callback invoked with the element.
 * - style: Partial<CSSStyleDeclaration> — merged via Object.assign into el.style.
 * - dataset: DOMStringMap | Record<string,string> — merged into el.dataset.
 * - for: string — assigned as an attribute (label “for” is reserved as a JS keyword).
 * - Any other keys are assigned directly onto the element object via Object.assign
 *   (e.g., id, className, textContent, onclick, value, etc.).
 *
 * Children handling
 * - If the second argument is an array, those nodes are appended.
 * - If it is a string, it becomes { textContent: string }.
 * - If it is an Element, it becomes [Element].
 * - If the second argument is an object, the third argument (children) is appended
 *   if provided. You may pass a single child or an array.
 * - IMPORTANT: because children are only appended when a truthy props object is
 *   provided, pass {} (not null/undefined) when you want to use the third parameter
 *   for children.
 *
 * Examples
 *   // <div class="panel note">Hello</div>
 *   const el1 = $el("div.panel.note", "Hello");
 *
 *   // <label class="row" for="name">Name</label>
 *   const el2 = $el("label.row", { for: "name", textContent: "Name" });
 *
 *   // <div class="wrap"><span>A</span><span>B</span></div>
 *   const a = $el("span", { textContent: "A" });
 *   const b = $el("span", { textContent: "B" });
 *   const el3 = $el("div.wrap", {}, [a, b]); // note the empty {} to enable children
 *
 *   // With callback and parent
 *   const container = document.getElementById("c");
 *   const el4 = $el("button.btn.primary", {
 *     parent: container,
 *     $: (btn) => btn.addEventListener("click", () => console.log("clicked")),
 *     textContent: "Run",
 *   });
 *
 * @param {string} tag2 - Tag name optionally suffixed by dot-separated classes (e.g., "div.panel.info").
 * @param {object|string|Element|Array<Node>} [propsOrChildren] - Either a properties object, a string
 *   for textContent, an Element treated as a single child, or an array of children to append.
 * @param {Node|Array<Node>} [children] - Child or children to append when the second argument is a
 *   properties object. Pass {} as the second argument (not null) if you want to supply children only.
 * @returns {HTMLElement} The created element.
 */
export function $el (tag2, propsOrChildren, children) {
    const split2 = tag2.split(".");
    const element2 = document.createElement(split2.shift());
    if (split2.length > 0) {
        element2.classList.add(...split2);
    }
    if (propsOrChildren) {
        if (typeof propsOrChildren === "string") {
            propsOrChildren = {textContent: propsOrChildren};
        } else if (propsOrChildren instanceof Element) {
            propsOrChildren = [propsOrChildren];
        }
        if (Array.isArray(propsOrChildren)) {
            element2.append(...propsOrChildren);
        } else {
            const {
                parent: parent2,
                $: cb,
                dataset,
                style: style2,
                ...rest2
            } = propsOrChildren;
            if (rest2.for) {
                element2.setAttribute("for", rest2.for);
            }
            if (style2) {
                Object.assign(element2.style, style2);
            }
            if (dataset) {
                Object.assign(element2.dataset, dataset);
            }
            Object.assign(element2, rest2);
            if (children) {
                element2.append(...Array.isArray(children) ? children : [children]);
            }
            if (parent2) {
                parent2.append(element2);
            }
            if (cb) {
                cb(element2);
            }
        }
    }
    return element2;
}