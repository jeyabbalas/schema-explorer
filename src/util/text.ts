const COUNT = new Intl.NumberFormat("en-US");

/** "1,234" */
export function formatCount(n: number): string {
  return COUNT.format(n);
}

/** "1 file" / "3 files" (with a formatted count). */
export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(n)} ${n === 1 ? singular : plural}`;
}

/** Message text of an unknown thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Lower-case, dash-separated identifier fragment for file names and DOM ids. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item"
  );
}
