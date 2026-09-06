import type { AppState, Dataset } from "./types";

/** Number of distinct dataset hues; indices beyond it wrap (with a secondary visual cue). */
export const PALETTE_SIZE = 8;

export function datasetById(state: Pick<AppState, "datasets">, id: string): Dataset | undefined {
  return state.datasets.find((dataset) => dataset.id === id);
}

/** The smallest colour index not in use, so removed datasets free their hue. */
export function nextColorIndex(datasets: readonly Pick<Dataset, "colorIndex">[]): number {
  const used = new Set(datasets.map((dataset) => dataset.colorIndex));
  let index = 0;
  while (used.has(index)) index += 1;
  return index;
}

/** Palette slot (0..PALETTE_SIZE-1) and whether the index has wrapped around. */
export function paletteSlot(colorIndex: number): { slot: number; cycle: number } {
  return { slot: colorIndex % PALETTE_SIZE, cycle: Math.floor(colorIndex / PALETTE_SIZE) };
}

export function totalVariables(datasets: readonly Pick<Dataset, "variableCount">[]): number {
  return datasets.reduce((sum, dataset) => sum + dataset.variableCount, 0);
}

/** Hands out colour indices for datasets added in one operation, never repeating one already in use. */
export function colorAllocator(datasets: readonly Pick<Dataset, "colorIndex">[]): () => number {
  const used = new Set(datasets.map((dataset) => dataset.colorIndex));
  return () => {
    let index = 0;
    while (used.has(index)) index += 1;
    used.add(index);
    return index;
  };
}
