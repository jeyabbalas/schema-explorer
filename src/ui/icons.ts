// Inline SVG icons (24×24 stroke icons), built as DOM nodes so they can be reused freely.

const STROKE = {
  search: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z M20 20l-3.5-3.5",
  close: "M6 6l12 12 M18 6L6 18",
  upload: "M12 16V4 M6 10l6-6 6 6 M4 20h16",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  file: "M6 2h8l6 6v14H6z M14 2v6h6",
  sun: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  "chevron-down": "m6 9 6 6 6-6",
  warning: "M12 3 2 20h20L12 3z M12 10v4 M12 17.5v.5",
  sparkles:
    "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9z",
  "arrow-up-right": "M7 17 17 7 M8 7h9v9",
  plus: "M12 5v14 M5 12h14",
  pencil: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  check: "m5 12 5 5L20 7",
  spinner: "M12 3a9 9 0 1 0 9 9",
  lock: "M6 11V8a6 6 0 0 1 12 0v3 M5 11h14v10H5z",
  "info-circle": "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z M12 11v5 M12 8v.5",
  download: "M12 4v12 M6 10l6 6 6-6 M4 20h16",
  trash: "M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3",
  layers: "M12 3 3 8l9 5 9-5-9-5z M3 13l9 5 9-5 M3 18l9 5 9-5"
} as const;

const FILLED = {
  github:
    "M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.6v-2.2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z"
} as const;

export type IconName = keyof typeof STROKE | keyof typeof FILLED;

const NS = "http://www.w3.org/2000/svg";

export function icon(name: IconName, size = 16, className?: string): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(NS, "path");
  const filled = (FILLED as Record<string, string | undefined>)[name];
  if (filled !== undefined) {
    svg.setAttribute("fill", "currentColor");
    path.setAttribute("d", filled);
  } else {
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.75");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    path.setAttribute("d", (STROKE as Record<string, string | undefined>)[name] ?? "");
  }
  svg.appendChild(path);
  let classes = `se-icon se-icon--${name}`;
  if (name === "spinner") classes += " se-spin";
  if (className) classes += ` ${className}`;
  svg.setAttribute("class", classes);
  return svg;
}
