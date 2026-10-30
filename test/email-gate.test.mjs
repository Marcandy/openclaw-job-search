import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { liveAtsDriver } from '../lib/live-ats-driver.mjs';

const bytes = Buffer.from('synthetic resume');
const destination = {
  source: 'greenhouse',
  title: 'Software Engineer',
  url: 'https://job-boards.greenhouse.io/example/jobs/1',
  resumePath: 'Resume.pdf',
  resumeHash: createHash('sha256').update(bytes).digest('hex'),
};

// A Greenhouse-like form: the first Submit sends an emailed code and disables
// Submit; eight filled boxes enable it; a second Submit confirms when the code
// is right. Only CORRECT123 is accepted.
const FORM = `<h1>Software Engineer</h1><form><label for="first_name">First Name</label><input id="first_name"><label for="resume">Resume</label><input id="resume" type="file"><span id="filename"></span><button type="submit">Submit application</button></form><script>
document.querySelector('#resume').onchange=e=>document.querySelector('#filename').textContent=e.target.files[0].name;
const button=document.querySelector('button'),form=document.querySelector('form');
let gated=false;
form.onsubmit=async e=>{e.preventDefault();
  if(!gated){gated=true;await fetch('/verification',{method:'POST'});button.disabled=true;
    form.insertAdjacentHTML('beforeend','<p>A verification code was sent to example@example.org. To submit your application, enter the 8-character code to confirm you&#39;re a human.</p>'+Array.from({length:8},()=>'<input maxlength="1" class="code">').join(''));
    form.querySelectorAll('.code').forEach(i=>i.oninput=()=>{button.disabled=[...form.querySelectorAll('.code')].some(x=>!x.value)});
    return;}
  const code=[...form.querySelectorAll('.code')].map(x=>x.value).join('');
  await fetch('/apply',{method:'POST'});
  if(code==='CORRECT1') document.body.innerHTML='<h1>Software Engineer</h1><p>Thank you for applying.</p>';
  else form.insertAdjacentHTML('beforeend','<p class="wrong">That code is incorrect.</p>');
};
</script>`;

async function withGatedForm(options, run) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const directory = mkdtempSync(join(tmpdir(), 'email-gate-'));
  await context.route('**/*', (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ body: '{}' });
    return route.fulfill({ contentType: 'text/html', body: FORM });
  });
  const driver = await liveAtsDriver({
    context,
    receiptDir: directory,
    location: {},
    confirmationTimeoutMs: 1000,
    pollMs: 50,
    codeSettleMs: 200,
    ...options(context),
  });
  try {
    await driver.preflight(destination);
    await driver.fill(destination, { first_name: 'Example' }, bytes);
    await run(driver, context);
  } finally {
    await driver.closePosting();
    await browser.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

async function typeCode(context, code) {
  const page = context.pages().at(-1);
  for (let i = 0; i < 8; i++) await page.locator('input.code').nth(i).fill(code[i]);
}

test('explicit unfinished Greenhouse email verification releases the slot without entering a code', async () => {
  await withGatedForm(
    () => ({}),
    async (driver) => {
      await assert.rejects(driver.submit(destination), (error) => {
        assert.equal(error.rejectedBeforeDelivery, true);
        assert.equal(
          error.evidence.deliveryGate,
          'greenhouse_email_verification_before_submission',
        );
        assert.equal(error.evidence.writeRequestObserved, true);
        assert.equal(error.evidence.verificationCodeWait, undefined);
        return true;
      });
    },
  );
});

test('a code the applicant types is submitted and confirmed', async () => {
  const calls = [];
  await withGatedForm(
    (context) => ({
      codeEntry: {
        waitMs: () => 10000,
        notify: (d, ms) => {
          calls.push(['notify', d.title, ms]);
          // The applicant types a wrong code first, then the right one.
          typeCode(context, 'WRONG123')
            .then(() =>
              context
                .pages()
                .at(-1)
                .getByText('That code is incorrect.', { exact: true })
                .waitFor({ timeout: 8000 }),
            )
            .then(() => typeCode(context, 'CORRECT1'));
        },
        waited: (w) => calls.push(['waited', w.entered]),
      },
    }),
    async (driver) => {
      const receipt = await driver.submit(destination);
      assert.equal(receipt.kind, 'ats_confirmation');
      assert.equal(receipt.verificationCode, 'entered_by_applicant');
      assert.ok(!JSON.stringify(receipt).includes('CORRECT1'));
    },
  );
  assert.deepEqual(calls, [
    ['notify', 'Software Engineer', 10000],
    ['waited', true],
  ]);
});

test('an unanswered wait releases the slot for manual completion', async () => {
  const waited = [];
  await withGatedForm(
    () => ({ codeEntry: { waitMs: () => 400, waited: (w) => waited.push(w) } }),
    async (driver) => {
      await assert.rejects(driver.submit(destination), (error) => {
        assert.match(error.message, /not entered within/);
        assert.equal(error.rejectedBeforeDelivery, true);
        assert.equal(
          error.evidence.deliveryGate,
          'greenhouse_email_verification_before_submission',
        );
        assert.equal(error.evidence.verificationCodeWait.submitClicked, false);
        return true;
      });
    },
  );
  assert.equal(waited.length, 1);
  assert.equal(waited[0].entered, false);
  assert.ok(waited[0].waitedMs >= 400);
});

test('an applicant who closes the page sent nothing and releases the slot', async () => {
  await withGatedForm(
    (context) => ({
      codeEntry: {
        waitMs: () => 5000,
        notify: () => {
          setTimeout(() => context.pages().at(-1).close(), 200);
        },
      },
    }),
    async (driver) => {
      await assert.rejects(driver.submit(destination), (error) => {
        assert.equal(error.rejectedBeforeDelivery, true);
        assert.equal(
          error.evidence.deliveryGate,
          'greenhouse_email_verification_before_submission',
        );
        return true;
      });
    },
  );
});

test('no wait budget skips the alert and stops at once', async () => {
  let notified = false;
  await withGatedForm(
    () => ({ codeEntry: { waitMs: () => 0, notify: () => (notified = true) } }),
    async (driver) => {
      await assert.rejects(driver.submit(destination), (error) => {
        assert.equal(error.rejectedBeforeDelivery, true);
        assert.equal(error.evidence.verificationCodeWait, undefined);
        return true;
      });
    },
  );
  assert.equal(notified, false);
});

test('final code click revalidates authority and never sends when approval expired', async () => {
  const phases = [];
  await withGatedForm(
    (context) => ({
      beforeSubmit: (d, phase) => {
        phases.push(phase);
        if (phase === 'verification_code') throw Error('Authorization expired');
      },
      codeEntry: { waitMs: () => 3000, notify: () => typeCode(context, 'CORRECT1') },
    }),
    async (driver) => {
      await assert.rejects(driver.submit(destination), (error) => {
        assert.match(error.message, /expired/);
        assert.equal(error.evidence.verificationCodeWait.submitClicked, false);
        assert.equal(error.rejectedBeforeDelivery, true);
        return true;
      });
    },
  );
  assert.deepEqual(phases, ['initial_submit', 'verification_code']);
});
