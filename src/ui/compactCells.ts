// Compact renderings of a row's valid values and constraints for the cross-dataset results.

import type { ConstraintItem, ValidValue } from "json-schema-data-dictionary";
import { el, highlightInto } from "./dom";

const MAX_VALUES = 6;
const MAX_SENTINELS = 2;
const MAX_CONSTRAINTS = 3;

function displayValue(value: ValidValue["value"]): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function valueItem(value: ValidValue, terms: readonly string[], sentinel: boolean): HTMLLIElement {
  const li = el("li", { class: sentinel ? "se-vals__sentinel" : undefined });
  const code = displayValue(value.value);
  if (code) li.appendChild(el("code", { class: `se-code${sentinel ? " se-code--sentinel" : ""}` }, code));
  if (value.label) {
    if (code) li.appendChild(document.createTextNode(" "));
    highlightInto(li, value.label, terms);
  }
  if (value.condition)
    li.appendChild(el("span", { class: "se-vals__when se-muted" }, ` when ${value.condition}`));
  return li;
}

/** Measurements first, then coded values, then de-emphasised special codes; the rest behind "+N more". */
export function renderValuesCell(
  cell: HTMLElement,
  values: readonly ValidValue[],
  terms: readonly string[]
): void {
  cell.replaceChildren();
  if (values.length === 0) {
    cell.appendChild(el("span", { class: "se-muted" }, "—"));
    return;
  }
  const measurements = values.filter((value) => value.kind === "measurement");
  const coded = values.filter((value) => value.kind !== "measurement" && value.kind !== "sentinel");
  const sentinels = values.filter((value) => value.kind === "sentinel");

  const render = (expanded: boolean): void => {
    const list = el("ul", { class: "se-vals" });
    for (const measurement of measurements) {
      list.appendChild(
        el(
          "li",
          { class: "se-vals__measure" },
          measurement.label ? el("code", { class: "se-code" }, measurement.label) : null,
          el("span", { class: "se-muted" }, measurement.label ? " measured value" : "measured value"),
          measurement.condition
            ? el("span", { class: "se-vals__when se-muted" }, ` when ${measurement.condition}`)
            : null
        )
      );
    }
    const shownCoded = expanded ? coded : coded.slice(0, MAX_VALUES);
    const shownSentinels = expanded ? sentinels : sentinels.slice(0, MAX_SENTINELS);
    for (const value of shownCoded) list.appendChild(valueItem(value, terms, false));
    for (const value of shownSentinels) list.appendChild(valueItem(value, terms, true));
    const hidden = coded.length - shownCoded.length + (sentinels.length - shownSentinels.length);
    if (hidden > 0 || (expanded && coded.length + sentinels.length > MAX_VALUES + MAX_SENTINELS)) {
      list.appendChild(
        el(
          "li",
          null,
          el(
            "button",
            {
              type: "button",
              class: "se-btn se-btn--link se-vals__more",
              "aria-expanded": String(expanded),
              onclick: () => render(!expanded)
            },
            expanded ? "Show fewer" : `+${hidden} more`
          )
        )
      );
    }
    cell.replaceChildren(list);
  };
  render(false);
}

export function renderConstraintsCell(cell: HTMLElement, constraints: readonly ConstraintItem[]): void {
  cell.replaceChildren();
  if (constraints.length === 0) {
    cell.appendChild(el("span", { class: "se-muted" }, "—"));
    return;
  }
  const list = el("ul", { class: "se-cons" });
  for (const constraint of constraints.slice(0, MAX_CONSTRAINTS)) {
    list.appendChild(
      constraint.condition
        ? el("li", { class: "se-cons__cond" }, `when ${constraint.condition}: ${constraint.text}`)
        : el("li", null, constraint.text)
    );
  }
  if (constraints.length > MAX_CONSTRAINTS) {
    list.appendChild(el("li", { class: "se-muted" }, `+${constraints.length - MAX_CONSTRAINTS} more`));
  }
  cell.appendChild(list);
}
