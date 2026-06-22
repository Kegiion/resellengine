import { searchVintedStream } from '../scrapers/vintedScraper.js';
import { verifyDeal } from './valueChecker.js';
import { insertDeal } from './database.js';
import { sendDealNotification } from './notificationGateway.js';
import { humanizedDelay } from '../utils/delay.js';
import { log } from '../utils/logger.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig, SearchJob, ScrapedItem } from '../types/index.js';

const MAX_ITEM_AGE_MS = 120_000;
const SNIPER_LOOP_MIN_MS = 12_000;
const SNIPER_LOOP_MAX_MS = 22_000;

const seenItemIds = new Set<string>();
const sniperAbortControllers = new Map<string, AbortController>();

function isFreshItem(item: ScrapedItem): boolean {
  const now = Date.now();
  const itemTimestamp = item.listedAt
    ? new Date(item.listedAt).getTime()
    : item.scrapedAt
    ? new Date(item.scrapedAt).getTime()
    : now;
  const ageMs = now - itemTimestamp;
  return ageMs <= MAX_ITEM_AGE_MS;
}

async function processItem(
  item: ScrapedItem,
  job: SearchJob,
  config: AppConfig,
  client: SupabaseClient
): Promise<void> {
  if (!isFreshItem(item)) {
    const ageMs = Date.now() - new Date(item.listedAt || item.scrapedAt).getTime();
    log('info', 'Sniper discarded item: too old', { itemId: item.id, ageMs });
    return;
  }

  if (seenItemIds.has(item.id)) {
    return;
  }
  seenItemIds.add(item.id);

  const deal = await verifyDeal(item, config);
  if (!deal) {
    return;
  }

  await sendDealNotification(deal);
  await insertDeal(client, deal);
  log('info', 'Sniper streamed master deal', { itemId: item.id, jobId: job.id });
}

async function runSniperLoop(
  job: SearchJob,
  config: AppConfig,
  client: SupabaseClient,
  signal: AbortSignal
): Promise<void> {
  while (!signal.aborted) {
    try {
      log('info', 'Sniper loop tick', { jobId: job.id, keywords: job.keywords });
      const items = await searchVintedStream(job.keywords, job.maxPrice, config.antiBot);

      for (const item of items) {
        if (signal.aborted) break;
        await processItem(item, job, config, client);
      }
    } catch (err) {
      log('error', 'Sniper loop tick failed', { jobId: job.id, error: String(err) });
    }

    if (signal.aborted) break;
    await humanizedDelay(SNIPER_LOOP_MIN_MS, SNIPER_LOOP_MAX_MS);
  }
}

export function startVintedSniper(
  client: SupabaseClient,
  config: AppConfig
): void {
  const enabled = process.env.SNIPER_ENABLED !== 'false';
  if (!enabled) {
    log('info', 'Vinted sniper disabled');
    return;
  }

  const vintedJobs = config.jobs.filter((j) => j.platform === 'vinted');
  if (vintedJobs.length === 0) {
    log('info', 'No Vinted jobs configured; sniper not started');
    return;
  }

  log('info', 'Starting Vinted real-time sniper', { jobs: vintedJobs.length });

  for (const job of vintedJobs) {
    const controller = new AbortController();
    sniperAbortControllers.set(job.id, controller);
    runSniperLoop(job, config, client, controller.signal).catch((err) => {
      log('error', 'Sniper loop crashed', { jobId: job.id, error: String(err) });
    });
  }
}

export function stopVintedSniper(): void {
  for (const [jobId, controller] of sniperAbortControllers) {
    controller.abort();
    log('info', 'Sniper loop aborted', { jobId });
  }
  sniperAbortControllers.clear();
  log('info', 'Vinted sniper stopped');
}
