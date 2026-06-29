import { searchVintedStream, fetchGuestCookiesOnce } from '../scrapers/vintedScraper.js';
import { verifyDeal } from './valueChecker.js';
import { insertDeal, getFullConfig } from './database.js';
import { sendDealNotification } from './notificationGateway.js';
import { humanizedDelay } from '../utils/delay.js';
import { isFreshItem, isFreshApiTimestamp } from '../utils/isFreshItem.js';
import { log } from '../utils/logger.js';
import { isSniperRunning } from './discordState.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig, SearchJob, ScrapedItem } from '../types/index.js';

const SNIPER_LOOP_MIN_MS = 12_000;
const SNIPER_LOOP_MAX_MS = 22_000;
const MAX_FIRST_SEEN_CACHE = 5000;
const FIRST_SEEN_MAX_AGE_MS = 120_000;
const JOB_SYNC_INTERVAL_MS = 60_000;

const seenItemIds = new Set<string>();
const firstSeenAt = new Map<string, number>();
const sniperAbortControllers = new Map<string, AbortController>();
let sniperClient: SupabaseClient | null = null;
let sniperSyncTimer: NodeJS.Timeout | null = null;

function recordFirstSeen(item: ScrapedItem): void {
  if (!firstSeenAt.has(item.id)) {
    firstSeenAt.set(item.id, Date.now());
    seenItemIds.add(item.id);
  }
  if (firstSeenAt.size > MAX_FIRST_SEEN_CACHE) {
    const oldestKey = firstSeenAt.keys().next().value;
    if (oldestKey) {
      firstSeenAt.delete(oldestKey);
      seenItemIds.delete(oldestKey);
    }
  }
}

function isFreshByFirstSeen(item: ScrapedItem): boolean {
  const seenAt = firstSeenAt.get(item.id);
  if (!seenAt) return true;
  return Date.now() - seenAt <= FIRST_SEEN_MAX_AGE_MS;
}

async function processItem(
  item: ScrapedItem,
  job: SearchJob,
  config: AppConfig,
  client: SupabaseClient
): Promise<void> {
  const isFresh = isFreshApiTimestamp(item) || (isFreshByFirstSeen(item) && isFreshItem(item));
  if (!isFresh) {
    const ageMs = Date.now() - new Date(item.listedAt || item.scrapedAt).getTime();
    log('info', 'Sniper discarded item: too old', { itemId: item.id, ageMs });
    return;
  }

  if (seenItemIds.has(item.id)) {
    return;
  }
  recordFirstSeen(item);

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
  client: SupabaseClient,
  signal: AbortSignal
): Promise<void> {
  while (!signal.aborted) {
    if (!isSniperRunning()) {
      await humanizedDelay(SNIPER_LOOP_MIN_MS, SNIPER_LOOP_MAX_MS);
      continue;
    }

    try {
      const config = await getFullConfig(client);
      const liveJob = config.jobs.find((j) => j.id === job.id && j.platform === 'vinted' && j.enabled);
      if (!liveJob) {
        log('info', 'Sniper loop stopping: job no longer enabled or removed', { jobId: job.id });
        return;
      }

      log('info', 'Sniper loop tick', { jobId: liveJob.id, keywords: liveJob.keywords });
      const items = await searchVintedStream(liveJob.keywords, liveJob.maxPrice, config.antiBot);

      for (const item of items) {
        if (signal.aborted) break;
        await processItem(item, liveJob, config, client);
      }
    } catch (err) {
      log('error', 'Sniper loop tick failed', { jobId: job.id, error: String(err) });
    }

    if (signal.aborted) break;
    await humanizedDelay(SNIPER_LOOP_MIN_MS, SNIPER_LOOP_MAX_MS);
  }
}

function stopJobLoop(jobId: string): void {
  const controller = sniperAbortControllers.get(jobId);
  if (controller) {
    controller.abort();
    sniperAbortControllers.delete(jobId);
    log('info', 'Sniper loop stopped for job', { jobId });
  }
}

function startJobLoop(job: SearchJob, client: SupabaseClient): void {
  if (sniperAbortControllers.has(job.id)) return;
  const controller = new AbortController();
  sniperAbortControllers.set(job.id, controller);
  runSniperLoop(job, client, controller.signal).catch((err) => {
    log('error', 'Sniper loop crashed', { jobId: job.id, error: String(err) });
  });
}

export async function syncSniperJobs(client: SupabaseClient): Promise<void> {
  try {
    const config = await getFullConfig(client);
    const enabledJobs = config.jobs.filter((j) => j.platform === 'vinted' && j.enabled);
    const enabledIds = new Set(enabledJobs.map((j) => j.id));

    for (const jobId of sniperAbortControllers.keys()) {
      if (!enabledIds.has(jobId)) {
        stopJobLoop(jobId);
      }
    }

    for (const job of enabledJobs) {
      if (!sniperAbortControllers.has(job.id)) {
        startJobLoop(job, client);
      }
    }
  } catch (err) {
    log('error', 'Sniper job sync failed', { error: String(err) });
  }
}

export async function startVintedSniper(
  client: SupabaseClient,
  config: AppConfig
): Promise<void> {
  const enabled = process.env.SNIPER_ENABLED !== 'false';
  if (!enabled) {
    log('info', 'Vinted sniper disabled');
    return;
  }

  sniperClient = client;

  try {
    const guest = await fetchGuestCookiesOnce(config.antiBot);
    if (!guest) {
      log('warn', 'Vinted sniper could not warm up guest cookies; aborting start');
      return;
    }
    log('info', 'Vinted sniper guest cookies warmed up');
  } catch (error) {
    log('error', 'Vinted sniper warmup failed', { error: String(error) });
    return;
  }

  await syncSniperJobs(client);

  if (sniperSyncTimer) {
    clearInterval(sniperSyncTimer);
  }
  sniperSyncTimer = setInterval(() => {
    if (sniperClient) syncSniperJobs(sniperClient).catch(() => {});
  }, JOB_SYNC_INTERVAL_MS);
  sniperSyncTimer.unref?.();

  log('info', 'Vinted sniper started with job sync', { jobs: sniperAbortControllers.size });
}

export function stopVintedSniper(): void {
  if (sniperSyncTimer) {
    clearInterval(sniperSyncTimer);
    sniperSyncTimer = null;
  }
  for (const [jobId, controller] of sniperAbortControllers) {
    controller.abort();
    log('info', 'Sniper loop aborted', { jobId });
  }
  sniperAbortControllers.clear();
  log('info', 'Vinted sniper stopped');
}

export function getSniperRunningJobCount(): number {
  return sniperAbortControllers.size;
}
