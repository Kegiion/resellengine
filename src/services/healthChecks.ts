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

async function checkVintedConnection(): Promise<HealthCheckResult> {
  const cookie = process.env.VINTED_SESSION_COOKIE;
  const decodoUsername = process.env.DECODO_API_USERNAME;
  const decodoPassword = process.env.DECODO_API_PASSWORD;
  const userAgent = getRandomUserAgent();
  const testUrl = 'https://www.vinted.de/catalog?search_text=ralph+lauren&price_to=50&order=newest_first';
  const apiUrl = 'https://www.vinted.de/api/v2/catalog/items?search_text=ralph+lauren&price_to=50&order=newest_first&page=1&per_page=20';

  // 1. Try Vinted API with session cookie.
  if (cookie) {
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        'User-Agent': userAgent,
        Referer: testUrl,
        Cookie: cookie,
      };
      const response = await axios.get(apiUrl, { headers, timeout: 20000 });
      const items = response.data?.items || [];
      if (items.length > 0) {
        return { name: 'Vinted Connection', status: 'ready', message: `Vinted API erreichbar (${items.length} Artikel).` };
      }
    } catch (err) {
      log('warn', 'Vinted health check API attempt failed', { error: String(err) });
    }
  }

  // 2. Try Decodo scrape to confirm Vinted is reachable from a proxy.
  if (decodoUsername && decodoPassword) {
    try {
      const auth = Buffer.from(`${decodoUsername}:${decodoPassword}`).toString('base64');
      const response = await axios.post(
        'https://scraper-api.decodo.com/v2/scrape',
        { url: testUrl, method: 'GET' },
        { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, timeout: 60000 }
      );
      const html = response.data?.results?.[0]?.content || '';
      const blocked = /captcha|cloudflare|access denied|blocked|403|429|verify you are human/i.test(html);
      const hasItems = /data-testid="catalog-item"|\/items\/\d+/.test(html);
      if (!blocked && html.length > 0) {
        return { name: 'Vinted Connection', status: 'ready', message: hasItems ? 'Vinted über Decodo erreichbar und Artikel sichtbar.' : 'Vinted über Decodo erreichbar (Feed geladen).' };
      }
    } catch (err) {
      log('warn', 'Vinted health check Decodo attempt failed', { error: String(err) });
    }
  }

  // 3. Fallback: local browser check ( verifies page loads and is not blocked ).
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent,
      viewport: { width: 1440, height: 900 },
      locale: 'de-DE',
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
      return { name: 'Vinted Connection', status: 'error', message: 'Vinted blockiert den Scraper (Captcha/Block).' };
    }
    if (!/vinted/i.test(title)) {
      return { name: 'Vinted Connection', status: 'error', message: 'Vinted-Seite wurde nicht korrekt geladen.' };
    }

    return { name: 'Vinted Connection', status: 'ready', message: 'Vinted-Seite erreichbar und nicht blockiert.' };
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

async function checkDecodoApi(): Promise<HealthCheckResult> {
  const username = process.env.DECODO_API_USERNAME;
  const password = process.env.DECODO_API_PASSWORD;
  if (!username || !password) {
    return { name: 'Decodo API', status: 'error', message: 'DECODO_API_USERNAME oder DECODO_API_PASSWORD nicht gesetzt.' };
  }
  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  try {
    const response = await axios.post(
      'https://scraper-api.decodo.com/v2/scrape',
      {
        url: 'https://www.vinted.de/catalog?search_text=ralph+lauren&price_to=50&order=newest_first',
        method: 'GET',
      },
      {
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        timeout: 60000,
      }
    );
    if (response.status === 200 && Array.isArray(response.data?.results)) {
      return { name: 'Decodo API', status: 'ready', message: 'Decodo API authentifiziert und Scrape-Endpunkt erreichbar.' };
    }
    return { name: 'Decodo API', status: 'error', message: 'Decodo API lieferte eine ungültige Antwort.' };
  } catch (err) {
    return { name: 'Decodo API', status: 'error', message: `Decodo API Test fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}` };
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
    checkDecodoApi(),
    checkDiscordWebhook(),
  ]);
  log('info', 'System health checks completed', { checks });
  return { timestamp: new Date().toISOString(), checks };
}
