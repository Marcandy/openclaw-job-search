import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { greenhouseDriver } from '../lib/greenhouse-driver.mjs';
const destination = {
  url: 'https://job-boards.greenhouse.io/acme/jobs/1',
  title: 'Engineer',
  resumePath: 'synthetic.pdf',
};
test('ten synthetic Greenhouse forms retain answers, decline opt-ins, attach immutable resume bytes and produce receipts', async () => {
  let current = 0,
    requests = 0,
    lastPage;
  const bytes = Buffer.from('synthetic test PDF');
  const launcher = {
    launch: async (options) => {
      const browser = await chromium.launch(options);
      const original = browser.newPage.bind(browser);
      browser.newPage = async () => {
        const page = await original();
        const route = page.route.bind(page);
        lastPage = page;
        // Intercept every request locally; no real ATS is contacted.
        page.route = async (pattern, _handler) =>
          route(pattern, async (request) => {
            requests++;
            await request.fulfill({
              contentType: 'text/html',
              body: `<h1>Engineer</h1><form onsubmit="event.preventDefault();document.body.innerHTML='<h2>Thank you for applying</h2>'"><input name="name" required><select name="authorized" required><option>No</option><option>Yes</option></select><input type="checkbox" name="marketing" checked><input type="file" name="resume"><button type="submit">Submit application</button></form>`,
            });
          });
        return page;
      };
      return browser;
    },
  };
  const d = await greenhouseDriver({ chromium: launcher, headless: true });
  try {
    for (current = 0; current < 10; current++) {
      const form = await d.preflight(destination);
      assert.equal(form.title, 'Engineer');
      assert.equal(form.blockedReason, undefined);
      await d.fill(destination, { name: `Candidate ${current}`, authorized: 'Yes' }, bytes);
      assert.equal(await lastPage.locator('[name=name]').inputValue(), `Candidate ${current}`);
      assert.equal(await lastPage.locator('[name=authorized]').inputValue(), 'Yes');
      assert.equal(await lastPage.locator('[name=marketing]').isChecked(), false);
      assert.equal(
        await lastPage.locator('[name=resume]').evaluate(async (e) => e.files[0].text()),
        bytes.toString(),
      );
      const after = await d.inspect();
      assert.equal(after.questions.length, 3);
      const receipt = await d.submit(destination);
      assert.match(receipt.text, /Thank you/);
      await d.closePosting();
    }
    assert.equal(requests, 10);
  } finally {
    await d.close();
  }
});
