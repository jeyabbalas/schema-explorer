import type { Dataset } from "../state/types";
import type { CatalogSearchResult, Hit } from "./types";

export type AvailabilityStatus = "exact" | "related" | "none";

/** The at-a-glance answer to "which datasets have this concept?" for one dataset. */
export interface DatasetAvailability {
  datasetId: string;
  label: string;
  colorIndex: number;
  status: AvailabilityStatus;
  exactCount: number;
  relatedCount: number;
  /** Fused score of the best hit, if any. */
  bestScore: number | undefined;
  /** The single best hit, if any. */
  top: Hit | undefined;
}

export function availabilitySummary(
  result: CatalogSearchResult,
  datasets: readonly Dataset[]
): DatasetAvailability[] {
  const groups = new Map(result.perDataset.map((group) => [group.datasetId, group]));
  return datasets.map((dataset) => {
    const group = groups.get(dataset.id);
    const exactCount = group?.exact.length ?? 0;
    const relatedCount = group?.related.length ?? 0;
    const top = group?.exact[0] ?? group?.related[0];
    return {
      datasetId: dataset.id,
      label: dataset.label,
      colorIndex: dataset.colorIndex,
      status: exactCount > 0 ? "exact" : relatedCount > 0 ? "related" : "none",
      exactCount,
      relatedCount,
      bestScore: group?.best,
      top
    };
  });
}
