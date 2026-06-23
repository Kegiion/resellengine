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
  return ageMs <= MAX_ITEM_AGE_MS && ageMs >= -60_000;
}

export function isFreshApiTimestamp(item: ScrapedItem): boolean {
  if (!item.listedAt || item.listedAt === item.scrapedAt) return false;
  const now = Date.now();
  const ts = new Date(item.listedAt).getTime();
  const ageMs = now - ts;
  return ageMs <= MAX_ITEM_AGE_MS && ageMs >= -60_000;
}
