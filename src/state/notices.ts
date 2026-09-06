import { newId } from "../util/id";
import type { Notice, NoticeLevel } from "./types";

export const MAX_NOTICES = 30;

export function createNotice(
  level: NoticeLevel,
  text: string,
  extra: { details?: string[] | undefined; datasetId?: string | undefined } = {}
): Notice {
  return {
    id: newId(),
    level,
    text,
    details: extra.details,
    datasetId: extra.datasetId,
    createdAt: Date.now()
  };
}

/** Append notices, keeping only the newest `MAX_NOTICES`. */
export function appendNotices(current: readonly Notice[], added: readonly Notice[]): Notice[] {
  if (added.length === 0) return [...current];
  return [...current, ...added].slice(-MAX_NOTICES);
}
