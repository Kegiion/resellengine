import axios from 'axios';
import * as cheerio from 'cheerio';
import { log } from '../utils/logger.js';
import type { AntiBotConfig, ScrapedItem } from '../types/index.js';

const EBAY_DE_URL = 'https://www.ebay.de/sch/i.html';
const DECODO_API_URL = 'https://scraper-api.decodo.com/v2/scrape';
const MAX_QUERY_LEN = 80;

function buildEbaySoldUrl(query: string): string {
  const cleaned = query
    .replace(/[^\w\säöüÄÖÜß\-]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LEN);
  const encoded = encodeURIComponent(cleaned);
  return `${EBAY_DE_URL}?_nkw=${encoded}&_sacat=0&LH_Complete=1&LH_Sold=1&rt=nc&_ipg=60&_dmd=2`;
}

function extractSoldPrices(html: string): number[] {
  const $ = cheerio.load(html);
  const prices: number[] = [];
  const seen = new Set<string>();

  const addPrice = (text: string) => {
    if (!text || seen.has(text)) return;
    seen.add(text);

    let normalized = text.replace(/\./g, '').replace(/,/g, '.');
    normalized = normalized.replace(/[^\d.]/g, '');
    const parts = normalized.split('.').filter((p) => p);
    let price = 0;
    if (parts.length >= 2) {
      const decimal = parts.pop() ?? '00';
      const integer = parts.join('');
      price = Number(`${integer}.${decimal}`);
    } else if (parts.length === 1) {
      price = Number(parts[0]);
    }

    if (price > 0.5 && price < 5000) {
      prices.push(price);
    }
  };

  const text = $.text();
  const regex = /\b\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\s*[€]|\s*€\s*\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|EUR\s*\d{1,3}(?:[.,]\d{3})*[.,]\d{2}/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    addPrice(match[0]);
  }

  return prices;
}

function filterOutliers(prices: number[]): number[] {
  if (prices.length < 4) return prices;

  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.ceil(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;

  return prices.filter((p) => p >= lower && p <= upper);
}

function average(prices: number[]): number {
  if (prices.length === 0) return 0;
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

export async function lookupSoldPrice(
  item: ScrapedItem,
  _antiBot: AntiBotConfig
): Promise<{ average: number; count: number } | null> {
  const username = process.env.DECODO_API_USERNAME;
  const password = process.env.DECODO_API_PASSWORD;
  if (!username || !password) {
    log('warn', 'DECODO_API_USERNAME or DECODO_API_PASSWORD not set; skipping eBay sold lookup', { itemId: item.id });
    return null;
  }

  const brand = item.brand ? `${item.brand} ` : '';
  const title = item.title || '';
  const query = `${brand}${title}`.trim();
  const url = buildEbaySoldUrl(query);
  const auth = Buffer.from(`${username}:${password}`).toString('base64');

  try {
    await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 1200));

    const response = await axios.post(
      DECODO_API_URL,
      {
        url,
        proxy_pool: 'premium',
        headless: 'html',
      },
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        timeout: 90000,
      }
    );

    const html =
      typeof response.data === 'string'
        ? response.data
        : response.data?.result?.content || response.data?.content || response.data?.html || JSON.stringify(response.data);

    const allPrices = extractSoldPrices(html);
    if (allPrices.length === 0) {
      log('warn', 'Decodo scrape returned no eBay prices', { itemId: item.id, query });
      return null;
    }

    const filtered = filterOutliers(allPrices).slice(0, 10);
    if (filtered.length === 0) {
      return null;
    }

    const avg = Math.round(average(filtered) * 100) / 100;
    log('info', 'eBay sold lookup completed via Decodo', {
      itemId: item.id,
      query,
      rawCount: allPrices.length,
      usedCount: filtered.length,
      average: avg,
    });

    return { average: avg, count: filtered.length };
  } catch (error) {
    log('warn', 'Decodo eBay sold lookup failed', { itemId: item.id, query, error: String(error) });
    return null;
  }
}
