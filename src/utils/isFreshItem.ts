import type { ScrapedItem } from "../types/index.js";

const MAX_ITEM_AGE_MS = 120_000;

export function isFreshItem(item: ScrapedItem): boolean {
  const now = Date.now();
  const itemTimestamp = item.listedAt
    ? new Date(item.listedAt).getTime()
    : item.scrapedAt
    ? new Date(item.scrapedAt).getTime()
    : now;
  const ageMs = now - itemTimestamp;
  return ageMs <= MAX_ITEM_AGE_MS && ageMs >= -60_000; // allow small clock skew up to 60s
}
