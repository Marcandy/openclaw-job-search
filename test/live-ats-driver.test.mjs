import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { liveAtsDriver } from '../lib/live-ats-driver.mjs';

for (const scenario of [
  { name: 'releases a known non-delivery for replacement', writes: [], held: false },
  {
    name: 'holds a possible cross-origin delivery',
    writes: ['https://submission.example.org/apply'],
    held: true,
  },
  {
    name: 'releases Google CAPTCHA transport without solving it',
    writes: ['https://www.google.com/recaptcha/api2/reload'],
    held: false,
  },
  {
    name: 'releases a delayed CAPTCHA inside an iframe',
    writes: ['https://www.google.com/recaptcha/api2/reload'],
    held: false,
    delayedFrame: true,
  },
  {
    name: 'keeps an unconfirmed delivery held without a visible challenge',
    writes: ['https://www.google.com/recaptcha/api2/reload'],
    held: true,
    showChallenge: false,
    writeObserved: false,
  },
  {
    name: 'holds an application write even alongside CAPTCHA traffic',
    writes: [
      'https://www.google.com/recaptcha/api2/reload',
      'https://submission.example.org/apply',
    ],
    held: true,
  },
  {
    name: 'holds writes to a lookalike CAPTCHA host',
    writes: ['https://www.google.com.example.org/recaptcha/api2/reload'],
    held: true,
  },
  {
    name: 'holds non-CAPTCHA writes to Google',
    writes: ['https://www.google.com/application'],
    held: true,
  },
]) {
  test(`post-click CAPTCHA ${scenario.name}`, async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const dir = mkdtempSync(join(tmpdir(), 'daily-captcha-'));
    const bytes = Buffer.from('synthetic resume');
    const destination = {
      source: 'ashby',
      title: 'Software Engineer',
      url: 'https://jobs.ashbyhq.com/example/00000000-0000-0000-0000-000000000001',
      resumePath: 'Resume.pdf',
      resumeHash: createHash('sha256').update(bytes).digest('hex'),
    };
    await context.route('**/*', (route) => {
      if (route.request().method() === 'POST') return route.fulfill({ body: '{}' });
      return route.fulfill({
        contentType: 'text/html',
        body: `
        <h1>Software Engineer</h1><form>
        <label for="name">Name</label><input id="name" required>
        <label for="_systemfield_resume">Resume</label><input id="_systemfield_resume" type="file">
        <span id="filename"></span><button type="submit">Submit Application</button></form>
        <script>
        document.querySelector('#_systemfield_resume').onchange = e => document.querySelector('#filename').textContent = e.target.files[0].name;
        document.querySelector('form').onsubmit = e => {
          e.preventDefault();
          ${scenario.writes.map((url) => `fetch('${url}', { method: 'POST', mode: 'no-cors', body: 'application' });`).join('\n')}
          ${scenario.showChallenge === false ? '' : scenario.delayedFrame ? `setTimeout(() => { const frame = document.createElement('iframe'); frame.srcdoc = '<p>Select all images with a bus</p>'; document.body.appendChild(frame); }, 100);` : `document.body.insertAdjacentHTML('beforeend', '<p>Verify you are human</p>');`}
        };
        </script>`,
      });
    });
    const driver = await liveAtsDriver({
      context,
      receiptDir: dir,
      location: {},
      confirmationTimeoutMs: 500,
    });
    try {
      await driver.preflight(destination);
      await driver.fill(destination, { name: 'Example Applicant' }, bytes);
      await assert.rejects(driver.submit(destination), (error) => {
        assert.match(
          error.message,
          scenario.showChallenge === false || scenario.delayedFrame
            ? /Timeout/
            : /Visible challenge/,
        );
        assert.equal(Boolean(error.rejectedBeforeDelivery), !scenario.held);
        assert.equal(error.evidence.writeRequestObserved, scenario.writeObserved ?? scenario.held);
        return true;
      });
    } finally {
      await driver.closePosting();
      await browser.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('stalled posting is closed at its time limit so the worker can continue', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const dir = mkdtempSync(join(tmpdir(), 'daily-timeout-'));
  await context.route('**/*', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Unavailable form</h1>' }),
  );
  const driver = await liveAtsDriver({ context, receiptDir: dir, location: {}, maxPostingMs: 200 });
  try {
    await assert.rejects(
      driver.preflight({
        source: 'ashby',
        title: 'Software Engineer',
        url: 'https://jobs.ashbyhq.com/example/00000000-0000-0000-0000-000000000001',
      }),
      /closed/,
    );
    assert.equal(context.pages().length, 0);
  } finally {
    await driver.closePosting();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('additional required attachments block before any applicant upload', async () => {
  const browser = await chromium.launch({ headless: true }),
    context = await browser.newContext(),
    dir = mkdtempSync(join(tmpdir(), 'daily-extra-doc-'));
  await context.route('**/*', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<h1>Software Engineer</h1><label for="email">Email</label><input id="email" required><label for="resume">Resume</label><input id="resume" type="file" required><label for="cover">Cover letter</label><input id="cover" type="file" required>',
    }),
  );
  const driver = await liveAtsDriver({ context, receiptDir: dir, location: {} });
  try {
    await assert.rejects(
      driver.preflight({
        source: 'ashby',
        title: 'Software Engineer',
        url: 'https://jobs.ashbyhq.com/example/00000000-0000-0000-0000-000000000001',
      }),
      /Additional required/,
    );
  } finally {
    await driver.closePosting();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('live adapter retains hidden Yes/No values, declines optional cookies and recognizes custom ATS Success', async () => {
  const browser = await chromium.launch({ headless: true }),
    context = await browser.newContext(),
    dir = mkdtempSync(join(tmpdir(), 'daily-ats-'));
  const id = '00000000-0000-0000-0000-000000000001',
    bytes = Buffer.from('synthetic PDF bytes');
  const d = {
    company: 'Example',
    title: 'Software Engineer',
    source: 'ashby',
    url: 'https://jobs.ashbyhq.com/example/' + id,
    resumePath: 'C:\\private\\Resume.pdf',
    resumeHash: createHash('sha256').update(bytes).digest('hex'),
  };
  const group = (key, label) =>
    `<div data-field-path="${key}"><label class="required">${label}</label><div class="ashby-application-form-input-yesno"><button type="button" data-answer="Yes" aria-pressed="false">Yes</button><button type="button" data-answer="No" aria-pressed="false">No</button><input name="${key}" type="checkbox" style="display:none"></div></div>`;
  await context.route('**/*', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: `<h1>Software Engineer</h1><div role="dialog" aria-label="Cookie consent"><button id="necessary">Necessary Only</button></div><form><div data-field-path="_systemfield_name"><label for="_systemfield_name">Name</label><input id="_systemfield_name" required></div><div data-field-path="_systemfield_email"><label for="_systemfield_email">Email</label><input id="_systemfield_email" type="email" required></div><label for="_systemfield_resume">Resume</label><input type="file" id="_systemfield_resume" required><span id="filename"></span>${group('authorized', 'Are you authorized to work?')}${group('sponsorship', 'Will you require sponsorship?')}<label for="marketing">Marketing</label><input id="marketing" type="checkbox" checked><button type="submit">Submit Application</button></form><script>document.querySelector('#necessary').onclick=()=>document.querySelector('[role=dialog]').remove();document.querySelector('#_systemfield_resume').onchange=e=>document.querySelector('#filename').textContent=e.target.files[0].name;for(const button of document.querySelectorAll('[data-answer]'))button.onclick=()=>{for(const b of button.parentElement.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b===button));button.parentElement.querySelector('input').checked=button.dataset.answer==='Yes';};document.querySelector('form').onsubmit=e=>{e.preventDefault();document.querySelector('form').remove();const success=document.createElement('div');success.className='ashby-application-form-success-container';success.setAttribute('role','status');success.dataset.highlight='positive';success.innerHTML='<h2>Success</h2><p>We appreciate your interest in our team and will be in touch.</p>';document.body.append(success);};</script>`,
    }),
  );
  const driver = await liveAtsDriver({ context, receiptDir: dir, location: {}, headless: true });
  try {
    const pre = await driver.preflight(d);
    assert.equal(pre.questions.find((q) => q.key === 'authorized').required, true);
    await driver.fill(
      d,
      {
        _systemfield_name: 'Example Applicant',
        _systemfield_email: 'example@example.org',
        authorized: 'Yes',
        sponsorship: 'No',
      },
      bytes,
    );
    const page = context.pages()[0];
    assert.equal(await page.locator('#marketing').isChecked(), false);
    assert.equal(await page.getByRole('dialog').count(), 0);
    const final = await driver.inspect(d);
    assert.deepEqual(final.questions, pre.questions);
    const receipt = await driver.submit(d);
    assert.equal(receipt.ashbySuccessPanel, true);
    assert.equal(receipt.formStillVisible, false);
    assert.ok(existsSync(receipt.screenshotPath));
  } finally {
    await driver.closePosting();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Greenhouse dropdown choices are read by opening the menu, without choosing one', async () => {
  const browser = await chromium.launch({ headless: true }),
    context = await browser.newContext(),
    dir = mkdtempSync(join(tmpdir(), 'daily-gh-combobox-'));
  // A menu that renders its options only while open, like Greenhouse's react-select.
  const body = `<h1>Software Engineer</h1>
    <label for="question_1">Where did you first hear about this role?*</label>
    <input id="question_1" role="combobox" aria-required="true" aria-expanded="false">
    <div id="menu"></div>
    <script>
      const input = document.getElementById('question_1'), menu = document.getElementById('menu');
      input.addEventListener('click', () => {
        input.setAttribute('aria-controls', 'menu');
        input.setAttribute('aria-expanded', 'true');
        menu.innerHTML = ['LinkedIn', 'Other job boards', 'Other']
          .map((o) => '<div role="option">' + o + '</div>').join('');
      });
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        menu.innerHTML = '';
        input.setAttribute('aria-expanded', 'false');
      });
    </script>`;
  await context.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body }));
  const driver = await liveAtsDriver({ context, receiptDir: dir, location: {} });
  try {
    const live = await driver.preflight({
      source: 'greenhouse',
      title: 'Software Engineer',
      url: 'https://job-boards.greenhouse.io/example/jobs/123',
    });
    const q = live.questions.find((x) => x.key === 'question_1');
    assert.deepEqual(q.options, ['LinkedIn', 'Other job boards', 'Other']);
    const page = context.pages().at(-1);
    assert.equal(await page.locator('#question_1').inputValue(), '');
    assert.equal(await page.locator('[role=option]').count(), 0, 'menu closed again');
  } finally {
    await driver.closePosting();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a home-city answer matches the approved location query by leading words', async () => {
  const { sameCity } = await import('../lib/live-ats-driver.mjs');
  assert.equal(sameCity('New York, NY', 'New York'), true);
  assert.equal(sameCity('New York City, New York, United States', 'New York'), true);
  assert.equal(sameCity('Newark, NJ', 'New York'), false);
  assert.equal(sameCity('York, PA', 'New York'), false);
  assert.equal(sameCity('New York', ''), false);
});

test('an Ashby multiple-choice question ticks the approved option, not the first one', async () => {
  const browser = await chromium.launch({ headless: true }),
    context = await browser.newContext(),
    dir = mkdtempSync(join(tmpdir(), 'daily-ats-'));
  const bytes = Buffer.from('synthetic PDF bytes');
  const d = {
    company: 'Example',
    title: 'Software Engineer',
    source: 'ashby',
    url: 'https://jobs.ashbyhq.com/example/00000000-0000-0000-0000-000000000002',
    resumePath: 'C:\\private\\Resume.pdf',
    resumeHash: createHash('sha256').update(bytes).digest('hex'),
  };
  const option = (label) =>
    `<label><input type="checkbox" name="${label}"><span>${label}</span></label>`;
  await context.route('**/*', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: `<h1>Software Engineer</h1><form><div data-field-path="_systemfield_name"><label for="_systemfield_name">Name</label><input id="_systemfield_name" required></div><label for="_systemfield_resume">Resume</label><input type="file" id="_systemfield_resume" required><span id="filename"></span><div class="ashby-application-form-field-entry"><label class="required">From where do you intend to work?</label>${['San Francisco (Hybrid)', 'New York City (Hybrid)', 'Remote - US'].map(option).join('')}</div><button type="submit">Submit Application</button></form><script>document.querySelector('#_systemfield_resume').onchange=e=>document.querySelector('#filename').textContent=e.target.files[0].name;</script>`,
    }),
  );
  const driver = await liveAtsDriver({ context, receiptDir: dir, location: {}, headless: true });
  try {
    const pre = await driver.preflight(d);
    const where = pre.questions.find((q) => q.label === 'From where do you intend to work?');
    assert.deepEqual(where.options, [
      'San Francisco (Hybrid)',
      'New York City (Hybrid)',
      'Remote - US',
    ]);
    await driver.fill(
      d,
      { _systemfield_name: 'Example Applicant', [where.key]: 'Remote - US' },
      bytes,
    );
    const page = context.pages()[0];
    assert.equal(await page.locator('input[name="Remote - US"]').isChecked(), true);
    assert.equal(await page.locator('input[name="San Francisco (Hybrid)"]').isChecked(), false);
    const final = await driver.inspect(d);
    assert.deepEqual(final.questions, pre.questions);
    await assert.rejects(
      driver.fill(
        d,
        { _systemfield_name: 'Example Applicant', [where.key]: 'Boston (Hybrid)' },
        bytes,
      ),
      /Checkbox label mismatch/,
    );
  } finally {
    await driver.closePosting();
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
