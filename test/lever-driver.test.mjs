import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { liveAtsDriver } from '../lib/live-ats-driver.mjs';

test('Lever inventories nested required questions, fills native controls and accepts only a receipt', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const dir = mkdtempSync(join(tmpdir(), 'lever-driver-'));
  const bytes = Buffer.from('synthetic approved resume');
  const destination = {
    source: 'lever',
    title: 'Software Engineer',
    url: 'https://jobs.lever.co/example/00000000-0000-0000-0000-000000000001',
    resumePath: 'Resume.pdf',
    resumeHash: createHash('sha256').update(bytes).digest('hex'),
  };
  const question = (label, input) =>
    `<li class="application-question"><div><div class="application-label">${label}<span class="required">✱</span></div><div class="application-field">${input}</div></div></li>`;
  await context.route('**/*', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `
    <h2>Software Engineer</h2><form><ul>
    ${question('Full name', '<input name="name" required>')}
    ${question('Email', '<input type="email" name="email" required>')}
    ${question('Resume/CV', '<input type="file" name="resume"><span id="filename"></span>')}
    ${question('Current location', '<input name="location"><input id="selected-location" type="hidden"><div class="dropdown-results"><div>New York, NY, USA</div></div>')}
    ${question('Are you authorized to work in the United States?', '<select name="cards[work][field0]"><option></option><option>Yes</option><option>No</option></select>')}
    ${question('Will you require sponsorship?', '<label><input type="radio" name="cards[sponsor][field0]" value="yes">Yes</label><label><input type="radio" name="cards[sponsor][field0]" value="no">No</label>')}
    ${question('What project did you lead?', '<textarea name="cards[project][field0]"></textarea>')}
    </ul><button type="button" id="btn-submit">Submit application</button></form>
    <script>
      document.querySelector('[name=resume]').onchange = event => document.querySelector('#filename').textContent = event.target.files[0].name;
      document.querySelector('.dropdown-results div').onclick = () => { document.querySelector('[name=location]').value='New York, NY, USA';document.querySelector('#selected-location').value='verified-place'; };
      document.querySelector('#btn-submit').onclick = () => { document.querySelector('form').remove();document.body.insertAdjacentHTML('beforeend','<h2>Application submitted!</h2>'); };
    </script>`,
    }),
  );
  const driver = await liveAtsDriver({
    context,
    receiptDir: dir,
    location: { query: 'New York', lever: 'New York, NY, USA' },
  });
  try {
    const inventory = await driver.preflight(destination);
    const custom = inventory.questions.find((q) => q.key === 'cards[project][field0]');
    assert.equal(custom.label, 'What project did you lead?✱');
    assert.equal(custom.required, true);
    assert.equal(
      inventory.questions.find((q) => q.key === 'cards[sponsor][field0]').options.join(','),
      'Yes,No',
    );
    await driver.fill(
      destination,
      {
        name: 'Example Applicant',
        email: 'example@example.org',
        location: 'New York',
        'cards[work][field0]': 'Yes',
        'cards[sponsor][field0]': 'No',
        'cards[project][field0]': 'Approved project description.',
      },
      bytes,
    );
    assert.deepEqual((await driver.inspect(destination)).questions, inventory.questions);
    const receipt = await driver.submit(destination);
    assert.equal(receipt.kind, 'ats_confirmation');
    assert.match(receipt.text, /Application submitted/);
  } finally {
    await driver.closePosting();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
