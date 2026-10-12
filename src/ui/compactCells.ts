// Compact renderings of a row's description, valid values and constraints for the cross-dataset
// results, from the library's view of the row (see rowView.ts).

import type { ConditionVM, RowVM, ValueVM } from "json-schema-data-dictionary";
import { append, el, highlightInto } from "./dom";

const MAX_VALUES = 6;
const MAX_SENTINELS = 2;
const MAX_CONSTRAINTS = 3;

/** The schema author's `$comment`, set apart from the text it annotates. */
function note(text: string, terms: readonly string[]): HTMLElement {
  const block = el("span", { class: "se-note" }, el("span", { class: "se-note__tag" }, "Note"), " ");
  highlightInto(block, text, terms);
  return block;
}

/** Why a value is set or a rule holds: a rule's or a value's `$comment`. */
function why(text: string | undefined, terms: readonly string[]): HTMLElement | null {
  if (!text) return null;
  const line = el("span", { class: "se-why" });
  highlightInto(line, text, terms);
  return line;
}

/** A skip pattern that sets the value: "if meno_status = 2 (Premenopausal)", then its comment. */
function when(condition: ConditionVM, terms: readonly string[]): HTMLElement[] {
  const line = el(
    "span",
    { class: "se-vals__when" },
    el("span", { class: "se-muted" }, "if "),
    condition.text
  );
  const reason = why(condition.comment, terms);
  return reason ? [line, reason] : [line];
}

/** The description without its notes, then the notes. */
export function renderDescriptionCell(cell: HTMLElement, row: RowVM, terms: readonly string[]): void {
  cell.replaceChildren();
  if (row.description) highlightInto(cell, row.description, terms);
  if (row.comment) cell.appendChild(note(row.comment, terms));
  if (!row.description && !row.comment) cell.appendChild(el("span", { class: "se-muted" }, "—"));
}

function valueItem(value: ValueVM, terms: readonly string[], sentinel: boolean): HTMLLIElement {
  const li = el("li", { class: sentinel ? "se-vals__sentinel" : undefined });
  if (value.display)
    li.appendChild(el("code", { class: `se-code${sentinel ? " se-code--sentinel" : ""}` }, value.display));
  // A label from a branch title or enum description; a description beside a label stays a tooltip.
  const text = value.label ?? value.description;
  if (text) {
    if (value.display) li.appendChild(document.createTextNode(" "));
    const span = el("span", {
      title:
        value.label && value.description && value.description !== value.label ? value.description : undefined
    });
    highlightInto(span, text, terms);
    li.appendChild(span);
  }
  append(
    li,
    why(value.comment, terms),
    value.conditions.map((condition) => when(condition, terms))
  );
  return li;
}

/** Measurements first, then coded values, then de-emphasised special codes; the rest behind "+N more". */
export function renderValuesCell(cell: HTMLElement, row: RowVM, terms: readonly string[]): void {
  cell.replaceChildren();
  const { measurements, values: coded, sentinels } = row;
  if (measurements.length + coded.length + sentinels.length === 0) {
    cell.appendChild(el("span", { class: "se-muted" }, "—"));
    return;
  }

  const render = (expanded: boolean): void => {
    const list = el("ul", { class: "se-vals" });
    for (const measurement of measurements) {
      const ranged = measurement.display !== "measured value";
      list.appendChild(
        el(
          "li",
          { class: "se-vals__measure" },
          ranged ? el("code", { class: "se-code" }, measurement.display) : null,
          el(
            "span",
            { class: "se-muted" },
            `${ranged ? " " : ""}${measurement.description ?? "measured value"}`
          ),
          why(measurement.comment, terms)
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

/**
 * The constraints, minus the skip patterns already shown on the value they set. A conditional
 * constraint's text states its condition ("When parous = 0 (No), value = 777 (…).").
 */
export function renderConstraintsCell(cell: HTMLElement, row: RowVM, terms: readonly string[]): void {
  cell.replaceChildren();
  const constraints = row.constraints.filter((constraint) => !constraint.onValues);
  if (constraints.length === 0) {
    cell.appendChild(el("span", { class: "se-muted" }, "—"));
    return;
  }
  const list = el("ul", { class: "se-cons" });
  for (const constraint of constraints.slice(0, MAX_CONSTRAINTS)) {
    list.appendChild(
      el(
        "li",
        { class: constraint.conditional ? "se-cons__cond" : undefined },
        constraint.text,
        why(constraint.comment, terms)
      )
    );
  }
  if (constraints.length > MAX_CONSTRAINTS) {
    list.appendChild(el("li", { class: "se-muted" }, `+${constraints.length - MAX_CONSTRAINTS} more`));
  }
  cell.appendChild(list);
}
