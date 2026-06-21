import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { searchVinted } from '../src/scrapers/vintedScraper.js';
import { searchKleinanzeigen } from '../src/scrapers/kleinanzeigenScraper.js';
import { verifyDeals } from '../src/services/valueChecker.js';
import { initDatabase, insertDeal } from '../src/services/database.js';
import { sendDealNotification } from '../src/services/notificationGateway.js';
import { log } from '../src/utils/logger.js';
import type { AppConfig, SearchJob } from '../src/types/index.js';

const config: AppConfig = JSON.parse(readFileSync('./config.json', 'utf8'));

async function runJob(job: SearchJob) {
  log('info', 'Running job', { jobId: job.id, platform: job.platform, keywords: job.keywords });

  const items =
    job.platform === 'vinted'
      ? await searchVinted(job.keywords, job.maxPrice, config.antiBot, false)
      : await searchKleinanzeigen(job.keywords, job.maxPrice, config.antiBot);

  const deals = await verifyDeals(items, config);
  log('info', `Job complete`, { jobId: job.id, itemCount: items.length, dealCount: deals.length });
  return deals;
}

async function main() {
  const db = await initDatabase();
  const enabledJobs = config.jobs.filter((j) => j.enabled);

  if (enabledJobs.length === 0) {
    log('warn', 'No enabled jobs found in config.json');
    process.exit(0);
  }

  log('info', `Starting test search run`, { jobCount: enabledJobs.length });

  const allDeals: import('../src/types/index.js').VerifiedDeal[] = [];
  for (const job of enabledJobs) {
    const deals = await runJob(job);
    for (const deal of deals) {
      insertDeal(db, deal);
      log('info', `Deal saved`, { id: deal.id, platform: deal.platform, netProfit: deal.netProfit, roi: deal.roiPercent });
      await sendDealNotification(deal);
    }
    allDeals.push(...deals);
  }

  // eslint-disable-next-line no-console
  console.log('\n=== Verified Deals ===');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(allDeals, null, 2));
  // eslint-disable-next-line no-console
  console.log(`\nTotal deals saved: ${allDeals.length}`);
}

main().catch((error) => {
  log('error', 'Test search failed', { error: String(error) });
  process.exit(1);
});
