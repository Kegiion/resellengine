import { log } from '../utils/logger.js';
import { lookupSoldPrice } from './ebayValueLookup.js';
import { analyzeProductImage } from './geminiService.js';
import { sendFilterLogNotification } from './notificationGateway.js';
import { incrementEbayChecked, incrementProfitFiltered, incrementImageAnalysis } from './stats.js';
import type { AppConfig, ScrapedItem, VerifiedDeal } from '../types/index.js';

const MIN_NET_PROFIT = 15;
const IMAGE_ANALYSIS_PROFIT_GATE = 25;

export async function estimateResellValue(item: ScrapedItem, config: AppConfig): Promise<number | null> {
  incrementEbayChecked();
  const ebay = await lookupSoldPrice(item, config.antiBot);
  if (ebay && ebay.count >= 3) {
    log('info', 'eBay sold price lookup used', {
      itemId: item.id,
      average: ebay.average,
      count: ebay.count,
    });
    return ebay.average;
  }

  log('warn', 'No datenbasierte eBay resell value available; rejecting deal', { itemId: item.id });
  return null;
}

function calculateFees(item: ScrapedItem, config: AppConfig): number {
  if (item.platform === 'vinted') {
    const buyerProtection = item.price * config.fees.vintedBuyerProtectionPercent;
    return Math.round(buyerProtection * 100) / 100;
  }
  return 0;
}

export async function verifyDeal(item: ScrapedItem, config: AppConfig): Promise<VerifiedDeal | null> {
  // Stufe 1: Lokale Text- und Spam-Filter sind bereits im Worker (isSpamTagged) gelaufen.
  // Wir landen hier nur, wenn der Artikel die Text-/Spam-Filter passiert hat.

  // Stufe 2: eBay-Lookup (geringe Kosten).
  let estimatedResellValue = await estimateResellValue(item, config);
  if (estimatedResellValue === null) {
    const reason = 'Keine eBay-Verkaufspreise gefunden (weniger als 3 passende Listings).';
    log('info', `Deal verworfen in Stufe 2: ${reason}`, { itemId: item.id });
    await sendFilterLogNotification(item, 2, reason);
    return null;
  }

  // Stufe 3: ROI-Berechnung mit harter 25-Euro-Huerde fuer Bildanalyse.
  const fees = calculateFees(item, config);
  const shipping = config.fees.shippingEstimate;
  const netProfitBeforeImage = Math.round((estimatedResellValue - item.price - fees - shipping) * 100) / 100;

  if (netProfitBeforeImage < IMAGE_ANALYSIS_PROFIT_GATE) {
    incrementProfitFiltered();
    const reason = `Profit zu gering für Bildanalyse. Netto-Profit vor Bildanalyse: ${netProfitBeforeImage.toFixed(2)} €, benötigt: ${IMAGE_ANALYSIS_PROFIT_GATE} €.`;
    log('info', `Deal verworfen in Stufe 3: ${reason}`, { itemId: item.id });
    await sendFilterLogNotification(item, 3, reason);
    return null;
  }

  // Stufe 4: Nur fuer absolute Top-Profit-Deals (> 25 Euro) Bildanalyse via Gemini (teuer).
  if (item.imageUrl) {
    incrementImageAnalysis();
    const analysis = await analyzeProductImage(item.imageUrl);
    if (analysis.success && analysis.result) {
      const { isDamaged, flaws, confidence } = analysis.result;
      if (isDamaged) {
        const reducedValue = Math.round(estimatedResellValue * 0.3 * 100) / 100;
        const reason = `Bildanalyse erkannte Mängel (${flaws || 'nicht spezifiziert'}). Wiederverkaufswert um 70% reduziert auf ${reducedValue.toFixed(2)} €.`;
        log('info', 'Image damage detected; reducing resell value by 70%', {
          itemId: item.id,
          originalValue: estimatedResellValue,
          reducedValue,
          flaws,
          confidence,
        });
        estimatedResellValue = reducedValue;
        await sendFilterLogNotification(item, 4, reason);
      } else {
        log('info', 'Image analysis found no visible damage', { itemId: item.id, confidence });
      }
    } else {
      log('warn', 'Image damage analysis failed; continuing with full value', {
        itemId: item.id,
        error: analysis.error,
      });
    }
  }

  // Finale Profitpruefung gegen das hinterlegte Job-Minimum (mindestens 15 Euro).
  const netProfit = Math.round((estimatedResellValue - item.price - fees - shipping) * 100) / 100;
  const roiPercent = item.price > 0 ? Math.round((netProfit / item.price) * 1000) / 10 : 0;

  const minDesiredProfit = Math.max(
    config.jobs.find((j) => j.platform === item.platform)?.minDesiredProfit ?? 0,
    MIN_NET_PROFIT
  );

  if (netProfit < minDesiredProfit) {
    incrementProfitFiltered();
    const reason = `Netto-Profit ${netProfit.toFixed(2)} € liegt unter dem Mindest-Profit von ${minDesiredProfit.toFixed(2)} €.`;
    log('info', `Deal verworfen in Stufe 5: ${reason}`, { itemId: item.id });
    await sendFilterLogNotification(item, 5, reason);
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
