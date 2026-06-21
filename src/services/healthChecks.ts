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
  const antiBot = {
    minDelayMs: 1000,
    maxDelayMs: 3000,
    rotateUserAgents: true,
  };
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: getRandomUserAgent(),
      viewport: { width: 1440, height: 900 },
      locale: 'de-DE',
    });
    const page = await context.newPage();
    const url = 'https://www.vinted.de/catalog?search_text=ralph+lauren&price_to=50&order=newest_first';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const title = await page.title();
    const body = await page.locator('body').textContent();
    const blocked = /captcha|cloudflare|access denied|blocked|403|429/i.test(body || '');
    if (blocked || title.toLowerCase().includes('captcha')) {
      return { name: 'Vinted Connection', status: 'error', message: 'Vinted blockiert den Scraper (Captcha/Block).' };
    }
    const hasItems = await page.locator('[data-testid="catalog-item"], .feed-grid__item').count();
    if (hasItems === 0) {
      return { name: 'Vinted Connection', status: 'error', message: 'Keine Artikel auf der Vinted-Seite gefunden.' };
    }
    return { name: 'Vinted Connection', status: 'ready', message: 'Scraper kann Vinted blockierungsfrei lesen.' };
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
    const response = await axios.get('https://scraper-api.decodo.com/v2/account', {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 15000,
    });
    const balance = response.data?.balance ?? response.data?.data?.balance ?? response.data?.credits ?? response.data?.requests_left;
    if (balance !== undefined && Number(balance) <= 0) {
      return { name: 'Decodo API', status: 'error', message: 'Decodo API authentifiziert, aber kein Guthaben verfügbar.' };
    }
    return { name: 'Decodo API', status: 'ready', message: 'Authentifiziert und Guthaben verfügbar.' };
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
