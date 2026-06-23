import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";
import { log } from "../utils/logger.js";
import { randomDelay } from "../utils/delay.js";
import type { AntiBotConfig, ScrapedItem } from "../types/index.js";

chromium.use(StealthPlugin());

const EBAY_DE_URL = "https://www.ebay.de/sch/i.html";
const MAX_QUERY_LEN = 80;

let sharedBrowser: import("playwright").Browser | null = null;
let sharedContext: import("playwright").BrowserContext | null = null;
let sharedProxyKey: string | null = null;

function getProxyAgent() {
  const proxyUrl = process.env.VINTED_PROXY_URL;
  if (!proxyUrl) return undefined;
  try {
    const parsed = new URL(proxyUrl);
    return {
      protocol: parsed.protocol.replace(":", ""),
      host: parsed.hostname,
      port: Number(parsed.port),
      auth: parsed.username
        ? {
            username: decodeURIComponent(parsed.username),
            password: decodeURIComponent(parsed.password || ""),
          }
        : undefined,
      key: proxyUrl,
    };
  } catch {
    return undefined;
  }
}

async function ensureSharedBrowser(): Promise<{ browser: import("playwright").Browser; context: import("playwright").BrowserContext }> {
  const proxy = getProxyAgent();
  const proxyKey = proxy ? proxy.key : 'direct';

  if (sharedBrowser && sharedContext && sharedProxyKey === proxyKey) {
    return { browser: sharedBrowser, context: sharedContext };
  }

  if (sharedContext) {
    await sharedContext.close().catch(() => {});
    sharedContext = null;
  }
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  sharedBrowser = browser;

  const contextOptions: any = {
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  };
  if (proxy) {
    contextOptions.proxy = {
      server: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
      username: proxy.auth?.username,
      password: proxy.auth?.password,
    };
  }

  sharedContext = await browser.newContext(contextOptions);

  if (!sharedBrowser || !sharedContext) {
    throw new Error("Failed to launch eBay browser");
  }
  sharedProxyKey = proxyKey;
  return { browser: sharedBrowser, context: sharedContext };
}

function buildEbaySoldUrl(query: string): string {
  const cleaned = query
    .replace(/[^\w\säöüÄÖÜß\-]/gi, "")
    .replace(/\s+/g, " ")
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
    let normalized = text.replace(/\./g, "").replace(/,/g, ".");
    normalized = normalized.replace(/[^\d.]/g, "");
    const parts = normalized.split(".").filter((p) => p);
    let price = 0;
    if (parts.length >= 2) {
      const decimal = parts.pop() ?? "00";
      const integer = parts.join("");
      price = Number(`${integer}.${decimal}`);
    } else if (parts.length === 1) {
      price = Number(parts[0]);
    }
    if (price > 0.5 && price < 5000) prices.push(price);
  };

  const soldIndicators = ['verkauft', 'sold', 'beendet', 'ended', 'abgelaufen'];
  const promoIndicators = ['shop on ebay', 'or best offer', 'brand new'];

  $('.s-card').each((_, el) => {
    const $el = $(el);
    const itemText = $el.text().toLowerCase();
    const isSold = soldIndicators.some((indicator) => itemText.includes(indicator));
    if (!isSold) return;

    const isPromo = promoIndicators.some((indicator) => itemText.includes(indicator));
    if (isPromo) return;

    const priceText = $el.find('.s-card__price').first().text().trim();
    if (priceText) {
      addPrice(priceText);
    }
  });

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
  const proxy = getProxyAgent();
  if (!proxy) {
    log("warn", "VINTED_PROXY_URL not set; skipping eBay sold lookup", { itemId: item.id });
    return null;
  }

  const brand = item.brand ? `${item.brand} ` : "";
  const title = item.title || "";
  const query = `${brand}${title}`.trim();
  const url = buildEbaySoldUrl(query);

  try {
    await randomDelay(800, 1200);
    const { context } = await ensureSharedBrowser();
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1500);
      const html = await page.content();
      const allPrices = extractSoldPrices(html);
      if (allPrices.length === 0) {
        log("warn", "eBay sold scrape returned no prices", { itemId: item.id, query });
        return null;
      }
      const filtered = filterOutliers(allPrices).slice(0, 10);
      if (filtered.length === 0) return null;
      const avg = Math.round(average(filtered) * 100) / 100;
      log("info", "eBay sold lookup completed via Proxy-Cheap", {
        itemId: item.id,
        query,
        rawCount: allPrices.length,
        usedCount: filtered.length,
        average: avg,
      });
      return { average: avg, count: filtered.length };
    } finally {
      await page.close().catch(() => {});
    }
  } catch (error) {
    log("warn", "eBay sold lookup via Proxy-Cheap failed", { itemId: item.id, query, error: String(error) });
    return null;
  }
}

export async function closeEbayBrowser(): Promise<void> {
  if (sharedContext) {
    await sharedContext.close().catch(() => {});
    sharedContext = null;
  }
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
  sharedProxyKey = null;
}
