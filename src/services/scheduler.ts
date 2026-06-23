import { searchVinted } from '../scrapers/vintedScraper.js';
import { searchKleinanzeigen } from '../scrapers/kleinanzeigenScraper.js';
import { verifyDeals } from './valueChecker.js';
import { insertDeal, getFullConfig } from './database.js';
import { sendDealNotification } from './notificationGateway.js';
import { randomDelay } from '../utils/delay.js';
import { isFreshItem } from '../utils/isFreshItem.js';
import { log } from '../utils/logger.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig, SearchJob } from '../types/index.js';

export interface SchedulerOptions {
  intervalMs: number;
  enabled?: boolean;
}

let schedulerTimer: NodeJS.Timeout | null = null;
let isRunning = false;

export async function runScraperJob(
  job: SearchJob,
  config: AppConfig,
  client: SupabaseClient
): Promise<void> {
  if (!job.enabled) {
    log('info', 'Job skipped (disabled)', { jobId: job.id });
    return;
  }

  if (job.platform === 'vinted') {
    log('info', 'Scheduler skipped Vinted job; real-time sniper handles Vinted', { jobId: job.id });
    return;
  }

  try {
    log('info', 'Running scheduler job', { jobId: job.id, platform: job.platform });

    const items = await searchKleinanzeigen(job.keywords, job.maxPrice, config.antiBot);
    const freshItems = items.filter(isFreshItem);
    if (freshItems.length < items.length) {
      log('info', 'Scheduler discarded old items', { jobId: job.id, total: items.length, fresh: freshItems.length });
    }

    const verifiedDeals = await verifyDeals(freshItems, config);
    log('info', 'Verified deals', { jobId: job.id, count: verifiedDeals.length });

    for (const deal of verifiedDeals) {
      await sendDealNotification(deal);
      await insertDeal(client, deal);
    }
  } catch (err) {
    log('error', 'Scheduler job failed', { jobId: job.id, error: String(err) });
  }
}

export async function runSchedulerCycle(
  client: SupabaseClient
): Promise<void> {
  if (isRunning) {
    log('warn', 'Scheduler cycle already running; skipping this tick');
    return;
  }

  isRunning = true;
  try {
    const config = await getFullConfig(client);
    for (const job of config.jobs) {
      await runScraperJob(job, config, client);
      await randomDelay(config.antiBot.minDelayMs, config.antiBot.maxDelayMs);
    }
  } catch (err) {
    log('error', 'Scheduler cycle failed', { error: String(err) });
  } finally {
    isRunning = false;
  }
}

export function startScheduler(
  client: SupabaseClient,
  options: SchedulerOptions = { intervalMs: 180_000 }
): void {
  if (schedulerTimer) {
    log('warn', 'Scheduler already started');
    return;
  }

  const enabled = options.enabled ?? process.env.SCHEDULER_ENABLED !== 'false';
  if (!enabled) {
    log('info', 'Scheduler disabled');
    return;
  }

  const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS) || options.intervalMs || 180_000;
  log('info', 'Starting scheduler', { intervalMs });

  runSchedulerCycle(client).catch((err) => {
    log('error', 'Initial scheduler cycle failed', { error: String(err) });
  });

  schedulerTimer = setInterval(() => {
    runSchedulerCycle(client).catch((err) => {
      log('error', 'Scheduled cycle failed', { error: String(err) });
    });
  }, intervalMs);

  schedulerTimer.unref?.();
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    log('info', 'Scheduler stopped');
  }
}

export function isSchedulerRunning(): boolean {
  return schedulerTimer !== null;
}
