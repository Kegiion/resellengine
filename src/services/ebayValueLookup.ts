import axios from 'axios';
import { log } from '../utils/logger.js';
import { getRandomUserAgent } from '../utils/userAgents.js';
import type { AntiBotConfig, ScrapedItem } from '../types/index.js';

const EBAY_DE_URL = 'https://www.ebay.de/sch/i.html';

function buildEbaySoldUrl(query: string): string {
  const encoded = encodeURIComponent(query);
  return `${EBAY_DE_URL}?_nkw=${encoded}&_sacat=0&LH_Complete=1&LH_Sold=1&rt=nc&_ipg=120`;
}

function extractSoldPrices(html: string): number[] {
  const prices: number[] = [];
  const regex = /<span class="s-item__price">([\s\S]*?)<\/span>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, '').trim();
    const normalized = text.replace(/\./g, '').replace(/,/g, '.').replace(/[^\d.]/g, '');
    const price = Number(normalized);
    if (price > 0 && price < 5000) {
      prices.push(price);
    }
  }

  return prices;
}

export async function lookupSoldPrice(
  item: ScrapedItem,
  antiBot: AntiBotConfig
): Promise<{ average: number; median: number; count: number } | null> {
  const query = `${item.brand ?? ''} ${item.title}`.trim().slice(0, 100);
  const url = buildEbaySoldUrl(query);
  const userAgent = antiBot.rotateUserAgents ? getRandomUserAgent() : undefined;

  try {
    const response = await axios.get(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 20000,
    });

    const prices = extractSoldPrices(response.data);
    if (prices.length === 0) {
      return null;
    }

    prices.sort((a, b) => a - b);
    const average = prices.reduce((a, b) => a + b, 0) / prices.length;
    const median = prices.length % 2 === 0
      ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
      : prices[Math.floor(prices.length / 2)];

    return {
      average: Math.round(average * 100) / 100,
      median: Math.round(median * 100) / 100,
      count: prices.length,
    };
  } catch (error) {
    log('warn', 'eBay sold price lookup failed', { itemId: item.id, error: String(error) });
    return null;
  }
}
