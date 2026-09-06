// Tiny DOM helpers. Schema-derived text always goes through text nodes, never innerHTML.

export type Child = Node | string | number | null | undefined | false | Child[];
export type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (typeof value === "function") {
        node.addEventListener(key.startsWith("on") ? key.slice(2) : key, value);
      } else if (key === "class") {
        node.className = String(value);
      } else if (key === "hidden") {
        node.hidden = true;
      } else if (value === true) {
        node.setAttribute(key, "");
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }
  append(node, ...children);
  return node;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, ...child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function replaceChildren(node: Node, ...children: Child[]): void {
  clear(node);
  append(node, ...children);
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Append `text` to `parent` with every occurrence of a term wrapped in `<mark class="se-mark">`.
 * Terms are matched case-insensitively, longest first; an empty term list appends plain text.
 */
export function highlightInto(parent: Node, text: string, terms: readonly string[]): void {
  const usable = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length > 0))].sort(
    (a, b) => b.length - a.length
  );
  if (usable.length === 0 || text.length === 0) {
    if (text) parent.appendChild(document.createTextNode(text));
    return;
  }
  const pattern = new RegExp(usable.map(escapeRegExp).join("|"), "gi");
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start > last) parent.appendChild(document.createTextNode(text.slice(last, start)));
    const mark = document.createElement("mark");
    mark.className = "se-mark";
    mark.textContent = match[0];
    parent.appendChild(mark);
    last = start + match[0].length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

/** True when the keyboard event originates in an editable control. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** The deepest element the event started from, seen through open shadow roots. */
export function eventOrigin(event: Event): EventTarget | null {
  const path = event.composedPath();
  return path.length > 0 ? (path[0] ?? null) : event.target;
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
