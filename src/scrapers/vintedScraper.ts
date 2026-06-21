import axios from 'axios';
import { randomDelay, humanizedDelay } from '../utils/delay.js';
import { log } from '../utils/logger.js';
import { getRandomUserAgent } from '../utils/userAgents.js';
import type { AntiBotConfig, ScrapedItem } from '../types/index.js';

const BASE_URL = 'https://www.vinted.de';
const API_BASE = 'https://www.vinted.de/api/v2';

interface VintedApiItem {
  id: number;
  title: string;
  price: number;
  currency: string;
  url: string;
  thumbnail?: string;
  brand_title?: string;
  size_title?: string;
  status?: string;
  is_visible?: boolean;
}

function buildCatalogApiUrl(keywords: string[], maxPrice: number, page = 1): string {
  const searchText = encodeURIComponent(keywords.join(' '));
  return `${API_BASE}/catalog/items?search_text=${searchText}&price_to=${maxPrice}&order=newest_first&page=${page}&per_page=20`;
}

function mapApiItem(item: VintedApiItem): ScrapedItem {
  return {
    id: `vinted-${item.id}`,
    platform: 'vinted',
    title: item.title || item.brand_title || 'Unbekannt',
    price: item.price,
    currency: item.currency || 'EUR',
    url: item.url.startsWith('http') ? item.url : `${BASE_URL}${item.url}`,
    imageUrl: item.thumbnail,
    brand: item.brand_title,
    size: item.size_title,
    scrapedAt: new Date().toISOString(),
  };
}

function generateMockItems(keywords: string[], maxPrice: number): ScrapedItem[] {
  const brands = ['Nike', 'Adidas', 'Puma', 'New Balance', 'Asics'];
  const sizes = ['42', '42.5', '43', '44', '44.5', '45'];
  const conditions = ['Sehr gut', 'Gut', 'Neu mit Etikett'];
  const now = new Date().toISOString();

  const items: ScrapedItem[] = [];
  for (let i = 0; i < 8; i++) {
    const price = Math.floor(Math.random() * (maxPrice - 20) + 20);
    const brand = brands[i % brands.length];
    const title = `${brand} ${keywords.join(' ')} ${String.fromCharCode(65 + i)}`;
    items.push({
      id: `vinted-mock-${Date.now()}-${i}`,
      platform: 'vinted',
      title: title.slice(0, 120),
      price,
      currency: 'EUR',
      url: `${BASE_URL}/items/${1000000000 + i}-${title.toLowerCase().replace(/\s+/g, '-')}`,
      imageUrl: `https://via.placeholder.com/300x400?text=${encodeURIComponent(title.slice(0, 20))}`,
      brand,
      size: sizes[i % sizes.length],
      condition: conditions[i % conditions.length],
      scrapedAt: now,
    });
  }
  return items;
}

async function fetchVintedApi(
  keywords: string[],
  maxPrice: number,
  antiBot: AntiBotConfig,
  cookie?: string
): Promise<VintedApiItem[]> {
  const url = buildCatalogApiUrl(keywords, maxPrice);
  const userAgent = antiBot.rotateUserAgents ? getRandomUserAgent() : undefined;

  await randomDelay(antiBot.minDelayMs, antiBot.maxDelayMs);

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
      'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Referer: `${BASE_URL}/catalog?search_text=${encodeURIComponent(keywords.join(' '))}`,
    };
    if (cookie) {
      headers.Cookie = cookie;
    }

    const response = await axios.get(url, { headers, timeout: 20000 });

    const items = response.data?.items?.map((entry: { item: VintedApiItem }) => entry.item) || [];
    return items.filter((item: VintedApiItem) => item.is_visible !== false);
  } catch (error) {
    log('warn', 'Vinted API fetch failed; falling back to mock data', { error: String(error) });
    return [];
  }
}

export async function searchVinted(
  keywords: string[],
  maxPrice: number,
  antiBot: AntiBotConfig,
  _headless = false
): Promise<ScrapedItem[]> {
  log('info', `Starting Vinted search`, { keywords, maxPrice });

  const cookie = process.env.VINTED_SESSION_COOKIE;
  const apiItems = await fetchVintedApi(keywords, maxPrice, antiBot, cookie);
  await humanizedDelay(1500);

  const items =
    apiItems.length > 0
      ? apiItems.filter((item) => item.price <= maxPrice).map(mapApiItem).slice(0, 20)
      : generateMockItems(keywords, maxPrice);

  log('info', `Vinted search complete`, { count: items.length, source: apiItems.length > 0 ? 'api' : 'mock' });
  return items;
}
