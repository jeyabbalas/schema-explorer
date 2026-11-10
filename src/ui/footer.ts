import type { ExampleManifest } from "../examples/manifest";
import type { Store } from "../state/store";
import type { AppState } from "../state/types";
import { el, replaceChildren } from "./dom";

const LIBRARY_URL = "https://github.com/jeyabbalas/json-schema-to-data-dictionary";
const REPO_URL = "https://github.com/jeyabbalas/schema-explorer";

export function mountFooter(container: HTMLElement, store: Store<AppState>): () => void {
  const credit = el("p", { class: "se-footer__text", hidden: true });
  const renderCredit = (manifest: ExampleManifest | null | undefined): void => {
    credit.hidden = !manifest;
    if (!manifest) return;
    const { name, url, license, copyright } = manifest.source;
    replaceChildren(
      credit,
      "Example schemas: ",
      el("a", { class: "se-footer__link", href: url, rel: "noopener" }, name),
      ` (${license}, ${copyright})`
    );
  };
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
      credit,
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
  renderCredit(store.get().examples);
  const unsubscribe = store.select((state) => state.examples, renderCredit);
  return () => {
    unsubscribe();
    footer.remove();
  };
}
