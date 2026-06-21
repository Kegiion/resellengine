const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });

  async function screenshot(viewport, name, tab) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto("https://akaidon.market/", { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector("button", { timeout: 30000 });
    if (tab) {
      const tabBtn = page.locator("button", { hasText: tab });
      if (await tabBtn.count()) await tabBtn.first().click();
      await page.waitForTimeout(1500);
    }
    await page.screenshot({ path: `C:/tmp/${name}.png`, fullPage: true });
    await context.close();
  }

  await screenshot({ width: 1440, height: 900 }, "live-desktop-lager", "Lager");
  await screenshot({ width: 375, height: 812 }, "live-mobile-lager", "Lager");
  await screenshot({ width: 1440, height: 900 }, "live-desktop-roi", "ROI");
  await screenshot({ width: 375, height: 812 }, "live-mobile-roi", "ROI");

  await browser.close();
  console.log("done");
})();
