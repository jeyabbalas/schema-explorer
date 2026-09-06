import { textKey, toPlainRows, type DataDictionaryTable } from "json-schema-data-dictionary";

/** Content hash of a set of documents; identical folders uploaded twice hash the same. */
export function hashDocs(docs: ReadonlyArray<{ path: string; text: string }>): string {
  const lines = docs.map((doc) => `${doc.path}\0${textKey(doc.text)}`).sort();
  return safeId(textKey(lines.join("\n")));
}

/** Hash of the flattened dictionary: the same table however its files were supplied. */
export function hashTable(table: DataDictionaryTable): string {
  const rows = toPlainRows(table, { includeInternalColumns: true });
  return safeId(textKey(`${table.title ?? ""}\0${JSON.stringify(rows)}`));
}

/** Make a library content key usable in DOM ids and CSS selectors. */
export function safeId(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "-");
}
