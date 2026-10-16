import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { liveAtsDriver } from '../lib/live-ats-driver.mjs';

test('explicit unfinished Greenhouse email verification releases the slot without entering a code', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const directory = mkdtempSync(join(tmpdir(), 'email-gate-'));
  const bytes = Buffer.from('synthetic resume');
  const destination = {
    source: 'greenhouse',
    title: 'Software Engineer',
    url: 'https://job-boards.greenhouse.io/example/jobs/1',
    resumePath: 'Resume.pdf',
    resumeHash: createHash('sha256').update(bytes).digest('hex'),
  };
  await context.route('**/*', (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ body: '{}' });
    return route.fulfill({
      contentType: 'text/html',
      body: `<h1>Software Engineer</h1><form><label for="first_name">First Name</label><input id="first_name"><label for="resume">Resume</label><input id="resume" type="file"><span id="filename"></span><button type="submit">Submit application</button></form><script>
      document.querySelector('#resume').onchange=e=>document.querySelector('#filename').textContent=e.target.files[0].name;
      document.querySelector('form').onsubmit=async e=>{e.preventDefault();await fetch('/verification',{method:'POST'});document.querySelector('button').disabled=true;document.querySelector('form').insertAdjacentHTML('beforeend', '<p>A verification code was sent to example@example.org. To submit your application, enter the 8-character code to confirm you&#39;re a human.</p>'+Array.from({length:8},()=>'<input maxlength="1">').join(''));};
      </script>`,
    });
  });
  const driver = await liveAtsDriver({
    context,
    receiptDir: directory,
    location: {},
    confirmationTimeoutMs: 1000,
  });
  try {
    await driver.preflight(destination);
    await driver.fill(destination, { first_name: 'Example' }, bytes);
    await assert.rejects(driver.submit(destination), (error) => {
      assert.equal(error.rejectedBeforeDelivery, true);
      assert.equal(error.evidence.deliveryGate, 'greenhouse_email_verification_before_submission');
      assert.equal(error.evidence.writeRequestObserved, true);
      return true;
    });
  } finally {
    await driver.closePosting();
    await browser.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
