import { log } from '../utils/logger.js';
import { lookupSoldPrice } from './ebayValueLookup.js';
import { estimateWithLlm } from './llmValueLookup.js';
import type { AppConfig, ScrapedItem, VerifiedDeal } from '../types/index.js';

function heuristicResellValue(item: ScrapedItem): number {
  const markup = 1.4 + (Math.random() * 0.4 - 0.2); // 1.2 - 1.6
  return Math.round(item.price * markup * 100) / 100;
}

export async function estimateResellValue(item: ScrapedItem, config: AppConfig): Promise<number> {
  const llm = await estimateWithLlm(item);
  if (llm && llm.confidence !== 'low') {
    log('info', 'LLM estimate used', {
      itemId: item.id,
      value: llm.estimatedResellValue,
      confidence: llm.confidence,
    });
    return Math.round(llm.estimatedResellValue * 100) / 100;
  }

  const sold = await lookupSoldPrice(item, config.antiBot);
  if (sold && sold.count >= 3) {
    log('info', 'eBay sold price lookup used', {
      itemId: item.id,
      median: sold.median,
      average: sold.average,
      count: sold.count,
    });
    return sold.median;
  }

  log('info', 'Falling back to heuristic resell value', { itemId: item.id });
  return heuristicResellValue(item);
}

function calculateFees(item: ScrapedItem, config: AppConfig): number {
  if (item.platform === 'vinted') {
    const buyerProtection = item.price * config.fees.vintedBuyerProtectionPercent;
    return Math.round(buyerProtection * 100) / 100;
  }
  return 0;
}

export async function verifyDeal(item: ScrapedItem, config: AppConfig): Promise<VerifiedDeal | null> {
  const estimatedResellValue = await estimateResellValue(item, config);
  const fees = calculateFees(item, config);
  const shipping = config.fees.shippingEstimate;
  const netProfit = Math.round((estimatedResellValue - item.price - fees - shipping) * 100) / 100;
  const roiPercent = item.price > 0 ? Math.round((netProfit / item.price) * 1000) / 10 : 0;

  if (netProfit < 0) {
    return null;
  }

  const job = config.jobs.find((j) => j.platform === item.platform);
  if (job && netProfit < job.minDesiredProfit) {
    log('info', 'Deal below profit threshold', {
      itemId: item.id,
      netProfit,
      threshold: job.minDesiredProfit,
    });
    return null;
  }

  return {
    id: item.id,
    platform: item.platform,
    title: item.title,
    price: item.price,
    currency: item.currency,
    estimatedResellValue,
    fees,
    shipping,
    netProfit,
    roiPercent,
    url: item.url,
    imageUrl: item.imageUrl,
    condition: item.condition,
    seller: item.seller,
    createdAt: item.scrapedAt,
  };
}

export async function verifyDeals(items: ScrapedItem[], config: AppConfig): Promise<VerifiedDeal[]> {
  const results = await Promise.all(items.map((item) => verifyDeal(item, config)));
  return results.filter((deal): deal is VerifiedDeal => deal !== null);
}
