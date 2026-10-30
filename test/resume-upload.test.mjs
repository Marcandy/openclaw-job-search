import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { hasAcceptedResume } from '../lib/resume-upload.mjs';
test('Lever verifies raw filename despite uppercase CSS and waits for visible parsing to finish', async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  try {
    await p.setContent(
      '<div class="application-question"><input type="file" name="resume"><span class="filename" style="text-transform:uppercase">Resume.pdf</span><span id="progress"><b>Analyzing</b> resume...</span></div>',
    );
    await p.locator('input').setInputFiles({
      name: 'Resume.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('synthetic'),
    });
    const arg = { name: 'Resume.pdf', source: 'lever' };
    assert.equal(await p.evaluate(hasAcceptedResume, arg), false);
    await p.locator('#progress').evaluate((e) => (e.style.display = 'none'));
    assert.equal(await p.evaluate(hasAcceptedResume, arg), true);
    assert.equal(await p.evaluate(hasAcceptedResume, { ...arg, name: 'Other.pdf' }), false);
    await p.locator('.filename').evaluate((e) => (e.textContent = 'Wrong.pdf'));
    assert.equal(await p.evaluate(hasAcceptedResume, arg), false);
  } finally {
    await b.close();
  }
});
