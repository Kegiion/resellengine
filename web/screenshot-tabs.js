const { chromium, devices } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const outDir = 'C:/Users/firea/Desktop/Coding/Resell/web/screenshots';
  fs.mkdirSync(outDir, { recursive: true });
  async function screenshot(viewport, name, tab) {
    const page = await browser.newPage({ viewport });
    await page.goto('https://akaidon.market/?nocache=1', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    if (tab) {
      const tabBtn = page.locator('button', { hasText: tab });
      if (await tabBtn.count()) await tabBtn.first().click();
      await page.waitForTimeout(2000);
    }
    await page.screenshot({ path: path.join(outDir, name), fullPage: true });
    const hasText = async (text) => (await page.locator(`text=${text}`).count()) > 0;
    const checks = {
      optimieren: await hasText('Optimieren'),
      alle: await hasText('Alle'),
      optimiert: await hasText('Optimiert'),
      nichtOptimiert: await hasText('Nicht optimiert'),
      status: await page.locator('text=/API online|API offline/i').first().textContent().catch(() => 'no-status'),
    };
    console.log(`${name}:`, JSON.stringify(checks));
    await page.close();
  }
  await screenshot({ width: 1440, height: 900 }, 'desktop-lager.png', 'Lager');
  await screenshot({ width: 375, height: 812 }, 'mobile-lager.png', 'Lager');
  await screenshot({ width: 1440, height: 900 }, 'desktop-roi.png', 'ROI');
  await screenshot({ width: 375, height: 812 }, 'mobile-roi.png', 'ROI');
  await browser.close();
})();
