import { el } from "./dom";

const LIBRARY_URL = "https://github.com/jeyabbalas/json-schema-to-data-dictionary";
const EXAMPLES_URL = "https://github.com/mgarciaclosas/cd3-schemify-pilot";
const REPO_URL = "https://github.com/jeyabbalas/schema-explorer";

export function mountFooter(container: HTMLElement): () => void {
  const footer = el(
    "footer",
    { class: "se-footer" },
    el(
      "div",
      { class: "se-container se-footer__row" },
      el(
        "p",
        { class: "se-footer__text" },
        "Built with ",
        el(
          "a",
          { class: "se-footer__link", href: LIBRARY_URL, rel: "noopener" },
          "json-schema-data-dictionary"
        ),
        " · Schemas never leave your browser"
      ),
      el(
        "p",
        { class: "se-footer__text" },
        "Example schemas © 2026 mgarciaclosas (MIT) — ",
        el("a", { class: "se-footer__link", href: EXAMPLES_URL, rel: "noopener" }, "cd3-schemify-pilot")
      ),
      el(
        "p",
        { class: "se-footer__text" },
        `v${__APP_VERSION__} · `,
        el(
          "a",
          { class: "se-footer__link", href: `${REPO_URL}/commit/${__COMMIT__}`, rel: "noopener" },
          __COMMIT__
        ),
        ` · ${__BUILD_DATE__}`
      )
    )
  );
  container.appendChild(footer);
  return () => footer.remove();
}
