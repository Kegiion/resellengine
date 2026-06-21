import { searchVinted } from '../scrapers/vintedScraper.js';
import { verifyDeal } from './valueChecker.js';
import { insertDeal, getFullConfig } from './database.js';
import { sendDealNotification } from './notificationGateway.js';
import { randomDelay } from '../utils/delay.js';
import { log } from '../utils/logger.js';
import { incrementScanned, incrementSpamFiltered, incrementAlarm, getStats, resetStats } from './stats.js';
import type { PipelineStats } from './stats.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig, ScrapedItem, SearchJob, VerifiedDeal } from '../types/index.js';

const RECENT_ID_LIMIT = 100;
const MIN_LOOP_DELAY_MS = 30_000;
const MAX_LOOP_DELAY_MS = 60_000;

const COMPETING_BRANDS = [
  'nike', 'adidas', 'puma', 'asics', 'new balance', 'reebok', 'converse', 'vans',
  'under armour', 'the north face',
  'ralph lauren', 'lacoste', 'tommy hilfiger', 'hugo boss', 'calvin klein',
  'gucci', 'prada', 'burberry', 'versace', 'armani', 'fred perry',
  'lululemon', 'gymshark',
];

let isRunning = false;
let stopRequested = false;

export function requestRealtimeWorkerStop(): void {
  stopRequested = true;
}

export function isRealtimeWorkerRunning(): boolean {
  return isRunning;
}

export function getWorkerStats(): PipelineStats {
  return getStats();
}

function isSpamTagged(item: ScrapedItem): boolean {
  const title = item.title.toLowerCase();
  const found = new Set<string>();
  for (const brand of COMPETING_BRANDS) {
    if (title.includes(brand.toLowerCase())) {
      found.add(brand.toLowerCase());
    }
  }
  const isSpam = found.size > 1;
  if (isSpam) {
    incrementSpamFiltered();
    log('info', 'Spam filter blocked item', { itemId: item.id, title: item.title, brands: Array.from(found) });
  }
  return isSpam;
}

async function getWorkerConfig(client: SupabaseClient): Promise<AppConfig> {
  return getFullConfig(client);
}

function getNewItems(items: ScrapedItem[], seenIds: Set<string>): ScrapedItem[] {
  const newItems: ScrapedItem[] = [];
  for (const item of items) {
    if (!seenIds.has(item.id)) {
      newItems.push(item);
    }
  }
  return newItems;
}

function updateSeenIds(seenIds: Set<string>, ids: string[]): void {
  for (const id of ids) {
    seenIds.add(id);
  }
  while (seenIds.size > RECENT_ID_LIMIT) {
    const first = seenIds.values().next().value;
    if (first !== undefined) {
      seenIds.delete(first);
    }
  }
}

async function handleNewItem(
  item: ScrapedItem,
  config: AppConfig,
  client: SupabaseClient
): Promise<void> {
  const deal = await verifyDeal(item, config);
  if (!deal) return;

  incrementAlarm();
  sendDealNotification(deal).catch((err) => {
    log('error', 'Realtime notification failed', { dealId: deal.id, error: String(err) });
  });

  insertDeal(client, deal).catch((err) => {
    log('error', 'Realtime Supabase insert failed', { dealId: deal.id, error: String(err) });
  });
}

export async function runRealtimeWorker(client: SupabaseClient): Promise<void> {
  if (isRunning) {
    log('warn', 'Realtime worker already running');
    return;
  }
  isRunning = true;
  stopRequested = false;

  const seenIds = new Set<string>();

  try {
    log('info', 'Realtime worker started', { maxDelayMs: MAX_LOOP_DELAY_MS, minDelayMs: MIN_LOOP_DELAY_MS });

    while (!stopRequested) {
      try {
        const config = await getWorkerConfig(client);
        const jobs = config.jobs.filter((j) => j.platform === 'vinted');

        if (jobs.length === 0) {
          log('warn', 'No enabled Vinted jobs found; realtime worker sleeping');
          await randomDelay(MIN_LOOP_DELAY_MS, MAX_LOOP_DELAY_MS);
          continue;
        }

        for (const job of jobs) {
          if (!job.enabled || job.keywords.length === 0) continue;

          const items = await searchVinted(job.keywords, job.maxPrice, config.antiBot);
          for (const _ of items) {
            incrementScanned();
          }
          const newItems = getNewItems(items, seenIds);

          log('info', 'Vinted realtime scan', {
            jobId: job.id,
            keyword: job.keywords[0],
            totalItems: items.length,
            newItems: newItems.length,
            seenCount: seenIds.size,
          });

          if (newItems.length > 0) {
            updateSeenIds(seenIds, items.map((i) => i.id));

            for (const item of newItems) {
              if (isSpamTagged(item)) continue;
              await handleNewItem(item, config, client);
            }
          }

          await randomDelay(MIN_LOOP_DELAY_MS, MAX_LOOP_DELAY_MS);
          if (stopRequested) break;
        }
      } catch (err) {
        log('error', 'Realtime worker loop error', { error: String(err) });
        await randomDelay(MIN_LOOP_DELAY_MS, MAX_LOOP_DELAY_MS);
      }
    }
  } finally {
    isRunning = false;
    log('info', 'Realtime worker stopped');
  }
}

export function startRealtimeWorker(client: SupabaseClient): void {
  const enabled = process.env.REALTIME_WORKER_ENABLED !== 'false';
  if (!enabled) {
    log('info', 'Realtime worker disabled via REALTIME_WORKER_ENABLED=false');
    return;
  }

  runRealtimeWorker(client).catch((err) => {
    log('error', 'Realtime worker crashed', { error: String(err) });
  });
}
