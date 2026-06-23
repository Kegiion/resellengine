import axios from 'axios';
import { chromium } from 'playwright';
import { getRandomUserAgent } from '../utils/userAgents.js';
import { log } from '../utils/logger.js';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface HealthCheckResult {
  name: string;
  status: 'ready' | 'error';
  message: string;
}

export interface SystemHealth {
  timestamp: string;
  checks: HealthCheckResult[];
}

function parseVintedProxy() {
  const proxyUrl = process.env.VINTED_PROXY_URL;
  if (!proxyUrl) return undefined;
  try {
    const parsed = new URL(proxyUrl);
    return {
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.hostname,
      port: Number(parsed.port),
      auth: parsed.username
        ? { username: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password || '') }
        : undefined,
    };
  } catch {
    return undefined;
  }
}

async function checkVintedConnection(): Promise<HealthCheckResult> {
  const cookie = process.env.VINTED_SESSION_COOKIE;
  const proxy = parseVintedProxy();
  const userAgent = getRandomUserAgent();
  const testUrl = 'https://www.vinted.de/catalog?search_text=ralph+lauren&price_to=50&order=newest_first';
  const apiUrl = 'https://www.vinted.de/api/v2/catalog/items?search_text=ralph+lauren&price_to=50&order=newest_first&page=1&per_page=20';

  if (!proxy) {
    return { name: 'Vinted Connection', status: 'error', message: 'VINTED_PROXY_URL nicht gesetzt.' };
  }

  // 1. Try Vinted API through the residential proxy.
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
      'User-Agent': userAgent,
      Referer: testUrl,
    };
    if (cookie) {
      headers.Cookie = cookie;
    }
    const response = await axios.get(apiUrl, {
      headers,
      timeout: 30000,
      proxy: {
        protocol: proxy.protocol,
        host: proxy.host,
        port: proxy.port,
        auth: proxy.auth,
      },
    });
    const items = response.data?.items || [];
    if (items.length > 0) {
      return { name: 'Vinted Connection', status: 'ready', message: `Vinted API über Proxy erreichbar (${items.length} Artikel).` };
    }
  } catch (err) {
    log('warn', 'Vinted health check API via proxy failed', { error: String(err) });
  }

  // 2. Fallback: browser through the residential proxy.
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent,
      viewport: { width: 1440, height: 900 },
      locale: 'de-DE',
      proxy: { server: `${proxy.protocol}://${proxy.host}:${proxy.port}`, username: proxy.auth?.username, password: proxy.auth?.password },
    });

    if (cookie) {
      await context.addCookies(
        cookie.split(';').map((part) => {
          const [name, ...valueParts] = part.trim().split('=');
          return {
            name: name || 'session',
            value: valueParts.join('='),
            domain: '.vinted.de',
            path: '/',
          };
        })
      );
    }

    const page = await context.newPage();
    await page.goto(testUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);

    const title = await page.title();
    const body = await page.locator('body').textContent();
    const blocked = /captcha|cloudflare|access denied|blocked|403|429|verify you are human/i.test(body || '');
    if (blocked || title.toLowerCase().includes('captcha')) {
      return { name: 'Vinted Connection', status: 'error', message: 'Vinted blockiert den Scraper trotz Proxy (Captcha/Block).' };
    }
    if (!/vinted/i.test(title)) {
      return { name: 'Vinted Connection', status: 'error', message: 'Vinted-Seite wurde nicht korrekt geladen.' };
    }

    return { name: 'Vinted Connection', status: 'ready', message: 'Vinted-Seite über Proxy erreichbar und nicht blockiert.' };
  } catch (err) {
    return { name: 'Vinted Connection', status: 'error', message: `Verbindung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function checkSupabaseDatabase(client: SupabaseClient): Promise<HealthCheckResult> {
  try {
    const { data, error } = await client.from('deals').select('count').limit(1);
    if (error) throw error;
    return { name: 'Supabase Database', status: 'ready', message: 'Verbindung zur Datenbank steht.' };
  } catch (err) {
    return { name: 'Supabase Database', status: 'error', message: `Datenbankverbindung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkEbayProxy(): Promise<HealthCheckResult> {
  const proxy = parseVintedProxy();
  if (!proxy) {
    return { name: 'eBay Proxy', status: 'error', message: 'VINTED_PROXY_URL nicht gesetzt.' };
  }
  try {
    const response = await axios.get('https://www.ebay.de/sch/i.html?_nkw=iphone+13&_sacat=0&LH_Complete=1&LH_Sold=1', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      proxy: {
        protocol: proxy.protocol,
        host: proxy.host,
        port: proxy.port,
        auth: proxy.auth,
      },
      timeout: 30000,
    });
    if (response.status === 200) {
      return { name: 'eBay Proxy', status: 'ready', message: 'eBay über Proxy-Cheap erreichbar.' };
    }
    return { name: 'eBay Proxy', status: 'error', message: 'eBay lieferte eine ungültige Antwort.' };
  } catch (err) {
    return { name: 'eBay Proxy', status: 'error', message: `eBay Proxy-Check fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkDiscordWebhook(): Promise<HealthCheckResult> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL || '';
  if (!webhookUrl) {
    return { name: 'Discord Webhook', status: 'error', message: 'DISCORD_WEBHOOK_URL nicht gesetzt.' };
  }
  try {
    const response = await axios.get(webhookUrl, { timeout: 10000 });
    if (response.status === 200 && response.data?.token) {
      return { name: 'Discord Webhook', status: 'ready', message: 'Webhook erreichbar und gültig.' };
    }
    return { name: 'Discord Webhook', status: 'error', message: 'Webhook erreichbar, aber ungültige Antwort.' };
  } catch (err) {
    return { name: 'Discord Webhook', status: 'error', message: `Webhook nicht erreichbar: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function runHealthChecks(client: SupabaseClient): Promise<SystemHealth> {
  const checks = await Promise.all([
    checkVintedConnection(),
    checkSupabaseDatabase(client),
    checkEbayProxy(),
    checkDiscordWebhook(),
  ]);
  log('info', 'System health checks completed', { checks });
  return { timestamp: new Date().toISOString(), checks };
}
