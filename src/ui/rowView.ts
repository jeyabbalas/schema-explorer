// The library's render-ready view of a dictionary row, as its own table renders it: the
// description apart from the author's `$comment` notes, each skip-pattern condition on the value
// it sets, and the constraints left once those are shown on the values.

import { buildViewModel, type DataDictionaryTable, type RowVM } from "json-schema-data-dictionary";

const views = new WeakMap<DataDictionaryTable, RowVM[]>();

/** The view of `table.rows[index]`; the table's view model is built once, on first use. */
export function rowView(table: DataDictionaryTable, index: number): RowVM | undefined {
  let rows = views.get(table);
  if (!rows) {
    rows = [];
    for (const category of buildViewModel(table).categories) {
      for (const row of category.rows) if (row.index >= 0) rows[row.index] = row;
    }
    views.set(table, rows);
  }
  return rows[index];
}
