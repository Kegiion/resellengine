import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { getRandomUserAgent, DESKTOP_VIEWPORT } from '../utils/userAgents.js';
import { randomDelay } from '../utils/delay.js';
import type { AntiBotConfig } from '../types/index.js';

export interface ScraperContext {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export async function launchScraper(antiBot: AntiBotConfig, headless = false): Promise<ScraperContext> {
  const userAgent = antiBot.rotateUserAgents ? getRandomUserAgent() : undefined;

  const browser = await chromium.launch({
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--no-sandbox',
    ],
  });

  const context = await browser.newContext({
    userAgent,
    viewport: DESKTOP_VIEWPORT,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  });

  await context.addInitScript(() => {
    // @ts-ignore — runs inside the browser, not Node.js
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  return { browser, context, page };
}

export async function safeGoto(page: Page, url: string, antiBot: AntiBotConfig): Promise<void> {
  await randomDelay(antiBot.minDelayMs, antiBot.maxDelayMs);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await randomDelay(antiBot.minDelayMs, antiBot.maxDelayMs);
}

export async function closeScraper(ctx: ScraperContext): Promise<void> {
  await ctx.context.close();
  await ctx.browser.close();
}

export function buildSearchUrl(platform: string, keywords: string[]): string {
  const query = encodeURIComponent(keywords.join(' '));
  if (platform === 'vinted') {
    return `https://www.vinted.de/catalog?search_text=${query}&order=newest_first`;
  }
  if (platform === 'kleinanzeigen') {
    return `https://www.kleinanzeigen.de/s-suche/${query}/k0`;
  }
  throw new Error(`Unknown platform: ${platform}`);
}

export abstract class BaseScraper {
  protected abstract platform: string;

  abstract search(keywords: string[], maxPrice: number, antiBot: AntiBotConfig): Promise<unknown[]>;
}
