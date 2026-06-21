require('dotenv/config');
const axios = require('axios');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(process.cwd(), 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

function logFile(name, content) {
  const filePath = path.join(LOG_DIR, `${timestamp}-${name}`);
  fs.writeFileSync(filePath, content);
  console.log(`Saved: ${filePath} (${content.length} bytes)`);
}

function parseProxy() {
  const proxyUrl = process.env.VINTED_PROXY_URL;
  if (!proxyUrl) return undefined;
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
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function testApi() {
  const proxy = parseProxy();
  const url =
    'https://www.vinted.de/api/v2/catalog/items?search_text=ralph+lauren&price_to=50&order=newest_first&page=1&per_page=20';
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
    'User-Agent': USER_AGENT,
    Referer: 'https://www.vinted.de/catalog?search_text=ralph+lauren&price_to=50&order=newest_first',
  };
  if (process.env.VINTED_SESSION_COOKIE) {
    headers.Cookie = process.env.VINTED_SESSION_COOKIE;
  }
  try {
    const response = await axios.get(url, { headers, timeout: 30000, proxy });
    logFile('api-response.json', JSON.stringify(response.data, null, 2));
    const items = response.data?.items || [];
    console.log('API items count:', items.length);
  } catch (err) {
    const body = err.response?.data || '';
    logFile('api-error.html', typeof body === 'string' ? body : JSON.stringify(body));
    console.log('API error:', err.message, 'status:', err.response?.status);
  }
}

async function testBrowser() {
  const proxy = parseProxy();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1440, height: 900 },
      locale: 'de-DE',
      proxy: proxy
        ? {
            server: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
            username: proxy.auth?.username,
            password: proxy.auth?.password,
          }
        : undefined,
    });

    if (process.env.VINTED_SESSION_COOKIE) {
      await context.addCookies(
        process.env.VINTED_SESSION_COOKIE.split(';').map((part) => {
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
    const url =
      'https://www.vinted.de/catalog?search_text=ralph+lauren&price_to=50&order=newest_first';
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);

    const html = await page.content();
    logFile('browser-html.html', html);

    const title = await page.title();
    const bodyText = await page.locator('body').textContent();
    console.log('Browser title:', title);
    console.log('Blocked?', /captcha|cloudflare|access denied|blocked|403|429|verify you are human|session refresh/i.test(bodyText || ''));

    const items = await page.evaluate(() => {
      const results = [];
      const seen = new Set();
      const cards = document.querySelectorAll('[data-testid="grid-item"]');
      for (const card of Array.from(cards)) {
        const wrapper = card.querySelector('[data-testid^="product-item-id-"]');
        if (!wrapper) continue;
        const idMatch = wrapper.getAttribute('data-testid')?.match(/product-item-id-(\d+)/);
        if (!idMatch) continue;
        const id = Number(idMatch[1]);
        if (seen.has(id)) continue;
        seen.add(id);
        const titleEl =
          card.querySelector('[data-testid$="--description-title"]') ||
          card.querySelector('[data-testid$="--description"]');
        const priceEl =
          card.querySelector('[data-testid$="--price-text"]') ||
          card.querySelector('[data-testid="total-combined-price"]');
        const imgEl = card.querySelector('[data-testid$="--image--img"]');
        const title = (titleEl?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
        const priceText = (priceEl?.textContent || '').trim();
        const imageUrl = imgEl?.src || imgEl?.dataset?.src || undefined;
        if (title && priceText) results.push({ id, title, priceText, imageUrl });
      }
      return results;
    });

    console.log('HTML items count:', items.length);
    if (items.length > 0) {
      console.log('First item:', JSON.stringify(items[0], null, 2));
    }
  } catch (err) {
    console.log('Browser error:', err.message);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

(async () => {
  console.log('Testing API...');
  await testApi();
  console.log('\nTesting Browser...');
  await testBrowser();
})();
