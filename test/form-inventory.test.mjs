import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { inspectApplicationForm, inspectPublicApplication } from '../lib/form-inventory.mjs';
const questionId = 'a1234567-1234-1234-1234-123456789abc';
const prefix = 'b1234567-1234-1234-1234-123456789abc';

test('required Ashby hidden Yes/No inputs are facts and cannot disappear from inventory', async () => {
  await withForm(
    `<div data-field-path="work_auth"><label class="required">Are you authorized to work?</label><div class="ashby-application-form-input-yesno"><button>Yes</button><button>No</button><input type="checkbox" name="work_auth" style="display:none"></div></div>`,
    async (page) => {
      const result = await inspectApplicationForm(page);
      assert.equal(result.questions.length, 1);
      const q = result.questions[0];
      assert.equal(q.key, 'work_auth');
      assert.equal(q.required, true);
      assert.equal(q.kind, 'fact');
      assert.deepEqual(q.options, ['Yes', 'No']);
    },
  );
});

async function withForm(html, callback, host = 'jobs.ashbyhq.com') {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto(`https://${host}/synthetic/application`);
    await callback(page);
  } finally {
    await browser.close();
  }
}

test('inventory finds required grouped choices, LinkedIn and hidden resume upload without exposing applicant values', async () => {
  await withForm(
    `<title>Synthetic application</title><form>
    <div data-field-path="linkedin"><label class="_required_x" for="linkedin">LinkedIn</label><input id="linkedin" value="private-applicant-value"></div>
    <div data-field-path="${questionId}"><label class="_required_x">How did you hear about us?</label>
      <input id="${prefix}_${questionId}_other" type="radio" name="${prefix}_${questionId}"><label for="${prefix}_${questionId}_other">Other</label>
      <input id="${prefix}_${questionId}_friend" type="radio" name="${prefix}_${questionId}"><label for="${prefix}_${questionId}_friend">Friend</label></div>
    <fieldset data-field-path="offices"><legend>Available offices *</legend><input type="checkbox" id="mo"><label for="mo">St. Louis</label><input type="checkbox" id="il"><label for="il">Chicago</label></fieldset>
    <fieldset data-field-path="eeo"><legend>Voluntary gender</legend><input type="radio" name="eeo" id="eeo1"><label for="eeo1">Decline to answer</label></fieldset>
    <div data-field-path="resume"><label class="required" for="resume">Resume</label><input id="resume" type="file" hidden></div>
    <input hidden name="token" value="secret-token"><input disabled name="disabled" required>
    <label for="email">Email</label><input id="email" type="email" required>
    <label for="optin">Marketing</label><input type="checkbox" id="optin">
    </form>`,
    async (page) => {
      const before = await page.content();
      const result = await inspectApplicationForm(page);
      assert.deepEqual(result.warnings, []);
      assert.equal(result.questions.length, 7);
      const fields = Object.fromEntries(result.questions.map((q) => [q.key, q]));
      assert.equal(fields.linkedin.required, true);
      assert.equal(fields[questionId].required, true);
      assert.equal(fields[questionId].grouped, true);
      assert.deepEqual(fields[questionId].options, ['Other', 'Friend']);
      assert.equal(fields.offices.required, true);
      assert.equal(fields.offices.grouped, true);
      assert.equal(fields.eeo.required, false);
      assert.equal(fields.resume.required, true);
      assert.equal(fields.optin.kind, 'consent');
      assert.equal(fields.optin.required, false);
      assert.equal(fields.email.required, true);
      assert.doesNotMatch(JSON.stringify(result), /private-applicant-value|secret-token/);
      assert.equal(await page.content(), before, 'inspection must not mutate the form');
    },
  );
});

test('Ashby page prefixes do not change schema identity; actual question changes do', async () => {
  const form = (pagePrefix) =>
    `<fieldset><legend>Sponsorship *</legend><input id="${pagePrefix}_${questionId}" name="${pagePrefix}_${questionId}" type="radio"><label for="${pagePrefix}_${questionId}">No</label></fieldset>`;
  await withForm(form(prefix), async (page) => {
    const first = await inspectApplicationForm(page);
    await page.setContent(form('c1234567-1234-1234-1234-123456789abc'));
    const second = await inspectApplicationForm(page);
    assert.equal(first.questions[0].key, questionId);
    assert.equal(first.schemaHash, second.schemaHash);
    await page.setContent(form(prefix).replace('Sponsorship', 'Relocation'));
    assert.notEqual(first.schemaHash, (await inspectApplicationForm(page)).schemaHash);
  });
});

test('ambiguous keys, custom controls, unlabeled questions and embedded forms require review', async () => {
  await withForm(
    '<input name="duplicate"><input name="duplicate"><div role="combobox" aria-label="Country"></div><iframe srcdoc="<input required>"></iframe>',
    async (page) => {
      const { warnings } = await inspectApplicationForm(page);
      assert.ok(warnings.some((w) => /duplicate question key/.test(w)));
      assert.ok(warnings.some((w) => /no question label/.test(w)));
      assert.ok(warnings.some((w) => /audited adapter/.test(w)));
      assert.ok(warnings.some((w) => /Embedded frames/.test(w)));
    },
  );
  await withForm('<h1>Loading</h1>', async (page) => {
    assert.match(
      (await inspectApplicationForm(page)).warnings[0],
      /No visible application controls/,
    );
  });
});

test('generated-ID normalization is limited to Ashby and does not conflate unrelated checkboxes', async () => {
  await withForm(
    `<label for="${prefix}_${questionId}">Required</label><input id="${prefix}_${questionId}" required>
    <label for="first">First consent</label><input type="checkbox" id="first" required>
    <label for="second">Second consent</label><input type="checkbox" id="second" required>`,
    async (page) => {
      const result = await inspectApplicationForm(page);
      assert.equal(result.questions[0].key, `${prefix}_${questionId}`);
      assert.equal(result.questions.length, 3);
      assert.equal(result.questions[1].kind, 'consent');
      assert.equal(result.questions[2].kind, 'consent');
    },
    'job-boards.greenhouse.io',
  );
});

test('public inspection rejects unsafe destinations before launching a browser', async () => {
  let launches = 0;
  const launcher = {
    launch: async () => {
      launches++;
      throw new Error('should not launch');
    },
  };
  for (const url of [
    'http://jobs.ashbyhq.com/job',
    'https://jobs.ashbyhq.com.evil.example/job',
    'https://user:password@jobs.ashbyhq.com/job',
    'https://jobs.ashbyhq.com:8443/job',
    'file:///tmp/form.html',
  ]) {
    await assert.rejects(inspectPublicApplication(url, { chromium: launcher }), /official/);
  }
  assert.equal(launches, 0);
});

test('fresh-browser public inspection blocks POSTs and external navigation without filling fields', async () => {
  let browser,
    attempts = 0,
    continuations = 0;
  const launcher = {
    launch: async (options) => {
      browser = await chromium.launch(options);
      const create = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        assert.equal(options.serviceWorkers, 'block');
        const context = await create(options),
          install = context.route.bind(context);
        context.route = async (pattern, guard) =>
          install(pattern, (route) =>
            guard({
              request: () => route.request(),
              abort: () => {
                attempts++;
                return route.abort();
              },
              continue: () => {
                continuations++;
                // All allowed traffic is fulfilled locally. No real ATS is contacted.
                return route.fulfill({
                  contentType: 'text/html',
                  body: `<script>
            fetch('/apply', { method:'POST', body:'synthetic' }).catch(() => {}).finally(() => {
              const frame = document.createElement('iframe'); frame.src='https://untrusted.example/form';
              frame.onload = frame.onerror = () => { document.body.insertAdjacentHTML('beforeend', '<label for="name">Name</label><input id="name" required>'); };
              document.body.append(frame);
            });
            </script>`,
                });
              },
            }),
          );
        return context;
      };
      return browser;
    },
  };
  const report = await inspectPublicApplication('https://jobs.ashbyhq.com/synthetic/application', {
    chromium: launcher,
    timeoutMs: 5000,
  });
  assert.equal(attempts, 2);
  assert.equal(continuations, 1);
  assert.equal(report.questions[0].key, 'name');
  assert.ok(report.warnings.some((w) => /2 non-read/.test(w)));
  assert.equal(browser.isConnected(), false);
});
