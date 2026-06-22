import axios from 'axios';
import { chromium, Browser, BrowserContext } from 'playwright';
import { randomDelay, humanizedDelay } from '../utils/delay.js';
import { log } from '../utils/logger.js';
import { getRandomUserAgent } from '../utils/userAgents.js';
import type { AntiBotConfig, ScrapedItem } from '../types/index.js';

const BASE_URL = 'https://www.vinted.de';
const API_BASE = 'https://www.vinted.de/api/v2';
const COOKIE_REFRESH_MS = 10 * 60 * 1000;

let sharedBrowser: Browser | null = null;
let sharedContext: BrowserContext | null = null;
let sharedCookieHeader: string | null = null;
let sharedCookieTimestamp = 0;
let sharedProxyKey: string | null = null;

function getVintedProxyAgent(): { protocol: string; host: string; port: number; auth?: { username: string; password: string } } | undefined {
  const proxyUrl = process.env.VINTED_PROXY_URL;
  if (!proxyUrl) return undefined;
  try {
    const parsed = new URL(proxyUrl);
    return {
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.hostname,
      port: Number(parsed.port),
      auth: parsed.username
        ? {
            username: decodeURIComponent(parsed.username),
            password: decodeURIComponent(parsed.password || ''),
          }
        : undefined,
    };
  } catch {
    return undefined;
  }
}

function proxyKey(proxy: ReturnType<typeof getVintedProxyAgent>): string {
  if (!proxy) return 'none';
  const auth = proxy.auth ? `${proxy.auth.username}:` : '';
  return `${proxy.protocol}://${proxy.host}:${proxy.port}:${auth}`;
}

function buildContextProxy(
  proxy: ReturnType<typeof getVintedProxyAgent>
): { server: string; username?: string; password?: string } | undefined {
  if (!proxy) return undefined;
  return {
    server: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
    username: proxy.auth?.username,
    password: proxy.auth?.password,
  };
}

async function ensureSharedBrowser(): Promise<Browser> {
  if (sharedBrowser) return sharedBrowser;
  sharedBrowser = await chromium.launch({ headless: true });
  return sharedBrowser;
}

async function ensureSharedContext(
  proxy: ReturnType<typeof getVintedProxyAgent>,
  userAgent?: string
): Promise<BrowserContext> {
  const newKey = proxyKey(proxy);
  if (sharedContext && sharedProxyKey === newKey) return sharedContext;

  if (sharedContext) {
    await sharedContext.close().catch(() => undefined);
    sharedContext = null;
  }

  const browser = await ensureSharedBrowser();
  sharedContext = await browser.newContext({
    userAgent: userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'de-DE',
    proxy: buildContextProxy(proxy),
  });
  sharedProxyKey = newKey;
  return sharedContext;
}

interface GuestCookies {
  cookieHeader: string;
  csrfToken?: string;
  accessToken?: string;
}

async function fetchGuestCookies(antiBot: AntiBotConfig): Promise<GuestCookies | null> {
  const proxy = getVintedProxyAgent();
  const userAgent = antiBot.rotateUserAgents ? getRandomUserAgent() : undefined;
  const now = Date.now();

  if (sharedCookieHeader && now - sharedCookieTimestamp < COOKIE_REFRESH_MS) {
    return { cookieHeader: sharedCookieHeader };
  }

  await randomDelay(1000, 2500);

  try {
    const context = await ensureSharedContext(proxy, userAgent);
    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(4000 + Math.random() * 3000);

    const allCookies = await context.cookies();
    const allNames = allCookies.map((c: { name: string }) => c.name).join(', ');
    const wantedNames = ['_vinted_fr_session', 'anon_id', 'anonymous-locale', 'anonymous-iso-locale', 'cf_clearance', 'datadome', 'access_token_web'];
    const cookiePairs = allCookies
      .filter((c: { name: string }) => wantedNames.includes(c.name))
      .map((c: { name: string; value: string }) => `${c.name}=${c.value}`);

    const cookieHeader = cookiePairs.join('; ');
    if (!cookieHeader.includes('_vinted_fr_session')) {
      log('warn', 'Guest handshake did not return _vinted_fr_session', { allCookies: allNames });
      await page.close().catch(() => undefined);
      return null;
    }

    const accessToken = allCookies.find((c: { name: string; value: string }) => c.name === 'access_token_web')?.value;
    if (!accessToken) {
      log('warn', 'Guest handshake did not return access_token_web', { allCookies: allNames });
      await page.close().catch(() => undefined);
      return null;
    }

    const csrfToken = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="csrf-token"]');
      return meta?.getAttribute('content') || undefined;
    });

    await page.close().catch(() => undefined);

    sharedCookieHeader = cookieHeader;
    sharedCookieTimestamp = now;

    log('info', 'Guest handshake successful', { cookieCount: cookiePairs.length, hasCsrf: !!csrfToken, hasAccessToken: true });
    return { cookieHeader, csrfToken, accessToken };
  } catch (error) {
    log('warn', 'Guest handshake failed', { error: String(error) });
    sharedCookieHeader = null;
    sharedCookieTimestamp = 0;
    return null;
  }
}

export async function closeVintedBrowser(): Promise<void> {
  if (sharedContext) {
    await sharedContext.close().catch(() => undefined);
    sharedContext = null;
  }
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => undefined);
    sharedBrowser = null;
  }
  sharedCookieHeader = null;
  sharedCookieTimestamp = 0;
  sharedProxyKey = null;
}

interface VintedApiItem {
  id: number;
  title: string;
  price: {
    amount: string;
    currency_code: string;
  };
  path: string;
  thumbnail?: string;
  brand_title?: string;
  size_title?: string;
  is_visible?: boolean;
  created_at_ts?: string;
  photo_uploaded_at?: string;
  timestamp?: string;
}

function buildCatalogApiUrl(keywords: string[], maxPrice: number, page = 1): string {
  const searchText = encodeURIComponent(keywords.join(' '));
  return `${API_BASE}/catalog/items?search_text=${searchText}&price_to=${maxPrice}&order=newest_first&page=${page}&per_page=20`;
}

function getItemListedAt(item: VintedApiItem): string {
  const tsSeconds =
    Number(item.created_at_ts) ||
    Number(item.photo_uploaded_at) ||
    Number(item.timestamp) ||
    0;
  if (tsSeconds > 1_000_000_000_000) {
    return new Date(tsSeconds).toISOString();
  }
  if (tsSeconds > 1_000_000_000) {
    return new Date(tsSeconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

function buildSearchPageUrl(keywords: string[], maxPrice: number): string {
  const searchText = encodeURIComponent(keywords.join(' '));
  return `${BASE_URL}/catalog?search_text=${searchText}&price_to=${maxPrice}&order=newest_first`;
}

function buildItemUrl(id: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return `${BASE_URL}/items/${id}-${slug}`;
}

function mapApiItem(item: VintedApiItem): ScrapedItem {
  const price = Number(item.price?.amount) || 0;
  const currency = item.price?.currency_code || 'EUR';
  const path = item.path || '';
  const listedAt = getItemListedAt(item);
  return {
    id: `vinted-${item.id}`,
    platform: 'vinted',
    title: item.title || item.brand_title || 'Unbekannt',
    price,
    currency,
    url: path.startsWith('http') ? path : `${BASE_URL}${path}`,
    imageUrl: item.thumbnail,
    brand: item.brand_title,
    size: item.size_title,
    scrapedAt: new Date().toISOString(),
    listedAt,
  };
}

async function fetchVintedApi(
  keywords: string[],
  maxPrice: number,
  antiBot: AntiBotConfig
): Promise<VintedApiItem[]> {
  const url = buildCatalogApiUrl(keywords, maxPrice);
  const userAgent = antiBot.rotateUserAgents ? getRandomUserAgent() : undefined;

  await randomDelay(antiBot.minDelayMs, antiBot.maxDelayMs);

  const guest = await fetchGuestCookies(antiBot);
  if (!guest) {
    log('warn', 'Cannot fetch Vinted API without guest cookies');
    return [];
  }

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
      'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Referer: `${BASE_URL}/catalog?search_text=${encodeURIComponent(keywords.join(' '))}`,
      Cookie: guest.cookieHeader,
      'X-CSRF-Token': guest.csrfToken || '',
      'X-Requested-With': 'XMLHttpRequest',
      Authorization: `Bearer ${guest.accessToken}`,
    };

    const proxy = getVintedProxyAgent();
    const response = await axios.get(url, { headers, timeout: 20000, proxy });

    const items = response.data?.items || [];
    return items.filter((item: VintedApiItem) => item.is_visible !== false);
  } catch (error) {
    log('warn', 'Vinted API fetch failed', { error: String(error) });
    return [];
  }
}

async function scrapeVintedHtml(
  keywords: string[],
  maxPrice: number
): Promise<ScrapedItem[]> {
  let context: BrowserContext | null = null;
  try {
    const proxy = getVintedProxyAgent();
    context = await ensureSharedContext(proxy, getRandomUserAgent());
    const page = await context.newPage();

    const url = buildSearchPageUrl(keywords, maxPrice);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000 + Math.random() * 2000);

    const items = await page.evaluate(() => {
      const results: Array<{
        id: number;
        title: string;
        priceText: string;
        imageUrl?: string;
      }> = [];
      const seen = new Set<number>();

      const itemCards = document.querySelectorAll(
        '[data-testid="grid-item"]'
      );

      for (const card of Array.from(itemCards)) {
        const itemWrapper = card.querySelector('[data-testid^="product-item-id-"]');
        if (!itemWrapper) continue;

        const idMatch = itemWrapper.getAttribute('data-testid')?.match(/product-item-id-(\d+)/);
        if (!idMatch) continue;
        const id = Number(idMatch[1]);
        if (seen.has(id)) continue;
        seen.add(id);

        const link = card.querySelector('a[href^="/items/"]') as HTMLAnchorElement | null;
        const titleEl =
          card.querySelector('[data-testid$="--description-title"]') ||
          card.querySelector('[data-testid$="--description"]') ||
          link;
        const title = (titleEl?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);

        const priceEl =
          card.querySelector('[data-testid$="--price-text"]') ||
          card.querySelector('[data-testid="total-combined-price"]');
        const priceText = (priceEl?.textContent || '').trim();

        const imgEl = card.querySelector('[data-testid$="--image--img"]') as HTMLImageElement | null;
        const imageUrl = imgEl?.src || imgEl?.dataset?.src || undefined;

        if (title && priceText) {
          results.push({ id, title, priceText, imageUrl });
        }
      }

      return results.slice(0, 20);
    });

    await page.close().catch(() => undefined);

    if (items.length === 0) {
      log('warn', 'Vinted HTML scrape returned no items');
      return [];
    }

    return items.map((item: { id: number; title: string; priceText: string; imageUrl?: string }) => {
      const normalized = item.priceText.replace(/\./g, '').replace(/,/g, '.');
      const price = Number((normalized.match(/\d+(?:\.\d+)?/) || ['0'])[0]);
      return {
        id: `vinted-${item.id}`,
        platform: 'vinted' as const,
        title: item.title,
        price,
        currency: 'EUR',
        url: buildItemUrl(item.id, item.title),
        imageUrl: item.imageUrl,
        scrapedAt: new Date().toISOString(),
      };
    });
  } catch (error) {
    log('warn', 'Vinted HTML scrape failed', { error: String(error) });
    return [];
  }
}

export async function searchVintedStream(
  keywords: string[],
  maxPrice: number,
  antiBot: AntiBotConfig
): Promise<ScrapedItem[]> {
  const apiItems = await fetchVintedApi(keywords, maxPrice, antiBot);

  if (apiItems.length > 0) {
    const items = apiItems
      .filter((item) => Number(item.price?.amount) <= maxPrice)
      .map(mapApiItem)
      .slice(0, 10);
    return items;
  }

  return [];
}

export async function searchVinted(
  keywords: string[],
  maxPrice: number,
  antiBot: AntiBotConfig,
  _headless = false
): Promise<ScrapedItem[]> {
  log('info', `Starting Vinted search`, { keywords, maxPrice });

  const apiItems = await fetchVintedApi(keywords, maxPrice, antiBot);
  await humanizedDelay(1500);

  let items: ScrapedItem[] = [];
  if (apiItems.length > 0) {
    items = apiItems.filter((item) => Number(item.price.amount) <= maxPrice).map(mapApiItem).slice(0, 5);
    log('info', `Vinted search complete via API`, { count: items.length });
    return items;
  }

  log('info', 'Vinted API returned no items; attempting HTML scrape');
  items = await scrapeVintedHtml(keywords, maxPrice);

  if (items.length === 0) {
    log('warn', 'Vinted search returned no real items; waiting for next cycle', { keywords });
    return [];
  }

  log('info', `Vinted search complete via HTML`, { count: items.length });
  return items.filter((item) => item.price <= maxPrice).slice(0, 20);
}
