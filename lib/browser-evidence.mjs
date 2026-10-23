import { chromium as defaultChromium } from 'playwright';
import { assertPublicSource } from './source-documents.mjs';

// Many company sites refuse plain HTTP clients (403/429) or build their text
// with JavaScript. A headless browser reads the page as a visitor sees it. It
// runs in its own throwaway context with no applicant data, visits only public
// HTTPS addresses and never interacts with a challenge.
const CHALLENGE =
  /verify you are human|checking your browser|just a moment\.\.\.|attention required|access denied|enable javascript and cookies to continue/i;

export function browserEvidenceReader({
  chromium = defaultChromium,
  timeoutMs = 30000,
  settleMs = 8000,
} = {}) {
  let browser;
  return {
    async read(input) {
      const url = assertPublicSource(input).href;
      browser ??= await chromium
        .launch({ channel: 'chrome', headless: true })
        .catch(() => chromium.launch({ headless: true }));
      const context = await browser.newContext({ acceptDownloads: false });
      try {
        await context.route('**/*', (route) => {
          const request = route.request();
          if (['image', 'media', 'font'].includes(request.resourceType())) return route.abort();
          try {
            if (request.isNavigationRequest()) assertPublicSource(request.url());
          } catch {
            return route.abort();
          }
          return route.continue();
        });
        const page = await context.newPage();
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: timeoutMs,
        });
        await page.waitForLoadState('networkidle', { timeout: settleMs }).catch(() => {});
        if (!response || response.status() >= 400)
          throw Error(`Evidence HTTP ${response?.status() ?? 'none'} (browser)`);
        const text = await page.evaluate(() => document.body?.innerText ?? '');
        if (CHALLENGE.test(text.slice(0, 2000)) && text.length < 5000)
          throw Error('Evidence page shows a bot challenge (browser)');
        return { url: assertPublicSource(page.url()).href, html: await page.content(), text };
      } finally {
        await context.close();
      }
    },
    async close() {
      await browser?.close();
      browser = null;
    },
  };
}
