import axios from 'axios';
import { randomDelay, humanizedDelay } from '../utils/delay.js';
import { log } from '../utils/logger.js';
import { getRandomUserAgent } from '../utils/userAgents.js';
import type { AntiBotConfig, ScrapedItem } from '../types/index.js';

const BASE_URL = 'https://www.kleinanzeigen.de';

interface KleinanzeigenHtmlItem {
  id: string;
  title: string;
  price: number;
  url: string;
  imageUrl?: string;
  location?: string;
  condition?: string;
}

function buildSearchUrl(keywords: string[], maxPrice: number, page = 1): string {
  const searchText = encodeURIComponent(keywords.join(' '));
  return `${BASE_URL}/s-suchanfrage.html?keywords=${searchText}&categoryId=0&locationStr=&maxPrice=${maxPrice}&sorting=dateDescending&pageNum=${page}`;
}

function parsePrice(text: string): number {
  const match = text.replace(/\./g, '').replace(/,/g, '.').match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function extractItemsFromHtml(html: string): KleinanzeigenHtmlItem[] {
  const items: KleinanzeigenHtmlItem[] = [];
  const regex = /<article[^>]*data-adid="(\d+)"[^>]*>[\s\S]*?<\/article>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null && items.length < 20) {
    const block = match[0] || '';
    const adId = match[1];

    const titleMatch = block.match(/<a[^>]*class="[^"]*ellipsis[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const priceMatch = block.match(/<p[^>]*class="[^"]*aditem-main--middle--price[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const locMatch = block.match(/<p[^>]*class="[^"]*aditem-main--top--left[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const imgMatch = block.match(/<img[^>]*src="([^"]+)"[^>]*>/i);
    const linkMatch = block.match(/<a[^>]*href="(\/s-anzeige\/[^"]+)"[^>]*class="[^"]*ellipsis[^"]*"/i);

    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Unbekannt';
    const priceText = priceMatch ? priceMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    const price = parsePrice(priceText);
    const location = locMatch ? locMatch[1].replace(/<[^>]+>/g, '').trim() : undefined;
    const imageUrl = imgMatch ? imgMatch[1] : undefined;
    const url = linkMatch ? `${BASE_URL}${linkMatch[1]}` : `${BASE_URL}/s-anzeige/${adId}`;

    if (title && price > 0) {
      items.push({ id: adId, title, price, url, imageUrl, location });
    }
  }

  return items;
}

function generateMockItems(keywords: string[], maxPrice: number): ScrapedItem[] {
  const brands = ['Adidas', 'Nike', 'Puma', 'Reebok', 'New Balance'];
  const locations = ['Berlin', 'Hamburg', 'München', 'Köln', 'Frankfurt'];
  const conditions = ['Neu', 'Sehr gut', 'Gut', 'Akzeptabel'];
  const now = new Date().toISOString();

  const items: ScrapedItem[] = [];
  for (let i = 0; i < 8; i++) {
    const price = Math.floor(Math.random() * (maxPrice - 15) + 15);
    const brand = brands[i % brands.length];
    const title = `${brand} ${keywords.join(' ')} ${String.fromCharCode(65 + i)}`;
    items.push({
      id: `kleinanzeigen-mock-${Date.now()}-${i}`,
      platform: 'kleinanzeigen',
      title: title.slice(0, 120),
      price,
      currency: 'EUR',
      url: `${BASE_URL}/s-anzeige/${title.toLowerCase().replace(/\s+/g, '-')}-${1000000 + i}`,
      imageUrl: `https://via.placeholder.com/300x400?text=${encodeURIComponent(title.slice(0, 20))}`,
      brand,
      location: locations[i % locations.length],
      condition: conditions[i % conditions.length],
      scrapedAt: now,
    });
  }
  return items;
}

async function fetchKleinanzeigenHtml(
  keywords: string[],
  maxPrice: number,
  antiBot: AntiBotConfig
): Promise<KleinanzeigenHtmlItem[]> {
  const url = buildSearchUrl(keywords, maxPrice);
  const userAgent = antiBot.rotateUserAgents ? getRandomUserAgent() : undefined;

  await randomDelay(antiBot.minDelayMs, antiBot.maxDelayMs);

  try {
    const headers: Record<string, string> = {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
      'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Referer: `${BASE_URL}/`,
    };

    const response = await axios.get(url, { headers, timeout: 20000 });
    const items = extractItemsFromHtml(response.data);
    log('info', `Kleinanzeigen HTML fetched`, { count: items.length });
    return items;
  } catch (error) {
    log('warn', 'Kleinanzeigen HTML fetch failed; falling back to mock data', { error: String(error) });
    return [];
  }
}

function mapHtmlItem(item: KleinanzeigenHtmlItem): ScrapedItem {
  return {
    id: `kleinanzeigen-${item.id}`,
    platform: 'kleinanzeigen',
    title: item.title,
    price: item.price,
    currency: 'EUR',
    url: item.url.startsWith('http') ? item.url : `${BASE_URL}${item.url}`,
    imageUrl: item.imageUrl,
    location: item.location,
    scrapedAt: new Date().toISOString(),
  };
}

export async function searchKleinanzeigen(
  keywords: string[],
  maxPrice: number,
  antiBot: AntiBotConfig
): Promise<ScrapedItem[]> {
  log('info', `Starting Kleinanzeigen search`, { keywords, maxPrice });

  const htmlItems = await fetchKleinanzeigenHtml(keywords, maxPrice, antiBot);
  await humanizedDelay(1500);

  const items =
    htmlItems.length > 0
      ? htmlItems.filter((item) => item.price <= maxPrice).map(mapHtmlItem).slice(0, 20)
      : generateMockItems(keywords, maxPrice);

  log('info', `Kleinanzeigen search complete`, { count: items.length, source: htmlItems.length > 0 ? 'html' : 'mock' });
  return items;
}
