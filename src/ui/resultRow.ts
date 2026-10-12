import { splitVariableName } from "json-schema-data-dictionary";
import type { AppActions } from "../app/actions";
import type { Hit } from "../search/types";
import type { Dataset } from "../state/types";
import { renderConstraintsCell, renderDescriptionCell, renderValuesCell } from "./compactCells";
import { el, highlightInto } from "./dom";
import { icon } from "./icons";
import { rowView } from "./rowView";

function isMixedType(type: string): boolean {
  return /\+| or /.test(type);
}

export function renderResultRow(
  hit: Hit,
  dataset: Dataset,
  terms: readonly string[],
  actions: AppActions
): HTMLTableRowElement {
  const name = hit.row["Variable name"];
  const [prefix, leaf] = splitVariableName(name, hit.row.__parent);
  const code = el("code", null);
  if (prefix) {
    const span = el("span", { class: "se-row__prefix" });
    highlightInto(span, prefix, terms);
    code.appendChild(span);
  }
  highlightInto(code, leaf, terms);
  const nameButton = el(
    "button",
    {
      type: "button",
      class: "se-row__name",
      "data-action": "jump",
      "aria-label": `Open ${name} in the ${dataset.label} dictionary`,
      title: `Open in the ${dataset.label} dictionary`,
      onclick: () => actions.openInDictionary(dataset.id, name)
    },
    code,
    icon("arrow-up-right", 12)
  );
  const variableCell = el("th", { scope: "row", class: "se-row__var" }, nameButton);
  if (hit.categoryTitle) variableCell.appendChild(el("span", { class: "se-row__cat" }, hit.categoryTitle));
  if (!hit.exact) {
    const similarity = hit.semanticScore === undefined ? "" : ` · ${hit.semanticScore.toFixed(2)}`;
    variableCell.appendChild(
      el(
        "span",
        {
          class: "se-badge se-badge--related",
          title: `Found by meaning, not by keyword${similarity ? ` · similarity ${hit.semanticScore?.toFixed(2)}` : ""}`
        },
        `related${similarity}`
      )
    );
  }

  const view = rowView(dataset.table, hit.localRow);
  const marked = hit.exact ? terms : [];
  const description = el("td", { class: "se-row__desc", "data-label": "Description" });
  const values = el("td", { class: "se-row__vals", "data-label": "Valid values" });
  const constraints = el("td", { class: "se-row__cons", "data-label": "Constraints" });
  if (view) {
    renderDescriptionCell(description, view, marked);
    renderValuesCell(values, view, marked);
    renderConstraintsCell(constraints, view, marked);
  } else {
    // Every row has a view; the raw description is a safe floor should one ever be missing.
    description.textContent = hit.row["Description"] || "—";
    values.textContent = "—";
    constraints.textContent = "—";
  }

  const type = el(
    "td",
    { class: "se-row__type", "data-label": "Type" },
    hit.row["Data type"]
      ? el(
          "span",
          { class: "se-type", "data-mixed": String(isMixedType(hit.row["Data type"])) },
          hit.row["Data type"]
        )
      : el("span", { class: "se-muted" }, "—"),
    hit.row["Format"] ? el("span", { class: "se-row__format" }, hit.row["Format"]) : null
  );

  return el(
    "tr",
    {
      class: "se-row",
      "data-match": hit.exact ? "exact" : "related",
      "data-dataset": dataset.id,
      "data-row": String(hit.localRow)
    },
    variableCell,
    description,
    type,
    values,
    constraints
  );
}
