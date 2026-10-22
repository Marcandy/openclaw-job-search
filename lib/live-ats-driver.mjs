import { chromium as defaultChromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { inspectApplicationForm } from './form-inventory.mjs';
import { createHash } from 'node:crypto';
import { leverField, fillLever } from './lever-fields.mjs';

/** True when an answer names the approved home city, e.g. "New York, NY" for "New York". */
export function sameCity(answer, query) {
  const words = (s) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  const a = words(answer),
    q = words(query);
  return q.length > 0 && q.every((w, i) => a[i] === w);
}

export async function liveAtsDriver({
  profilePath,
  receiptDir,
  location,
  headless = false,
  chromium = defaultChromium,
  context: providedContext,
  maxPostingMs = 5 * 60000,
  confirmationTimeoutMs = 30000,
  // Optional human entry of Greenhouse's emailed code:
  // { waitMs(d) -> ms to wait (0 skips), notify(d, ms), waited({ waitedMs, entered }) }.
  codeEntry = null,
  pollMs = 1000,
  codeSettleMs = 1500,
}) {
  const context =
    providedContext ??
    (await chromium.launchPersistentContext(profilePath, {
      channel: 'chrome',
      headless,
      viewport: { width: 1280, height: 1000 },
    }));
  let postingTimer;
  let page,
    current,
    checks = [],
    approvedResume,
    applicationRequest = false,
    codeWait = null;
  mkdirSync(receiptDir, { recursive: true });
  const esc = (s) => String(s).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  const phoneDigits = (v) => {
    const n = String(v).replace(/\D/g, '');
    return n.length === 11 && n.startsWith('1') ? n.slice(1) : n;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function necessaryCookies(p) {
    const d = p.getByRole('dialog', { name: 'Cookie consent', exact: true });
    if (await d.isVisible().catch(() => false)) {
      await d.getByRole('button', { name: 'Necessary Only', exact: true }).click();
      await d.waitFor({ state: 'hidden' });
    }
  }
  async function challenge(page) {
    for (const frame of page.frames()) {
      if (
        await frame
          .locator('body')
          .isVisible()
          .catch(() => false)
      ) {
        const text = await frame
          .locator('body')
          .innerText()
          .catch(() => '');
        if (
          /verify you are human|select all images|solve.*challenge|access denied|security verification|I'm not a robot|I am not a robot|I am human|human verification|complete the captcha/i.test(
            text,
          )
        )
          return 'Visible challenge: ' + text.slice(0, 600);
      }
    }
    return '';
  }
  async function snapshot(p, d) {
    let title;
    if (await p.locator('h1').count()) title = (await p.locator('h1').first().innerText()).trim();
    else if (d.source === 'lever' && (await p.locator('h2').count()) === 1)
      title = (await p.locator('h2').innerText()).trim();
    else if (d.source === 'greenhouse') {
      const u = new URL(d.url),
        parts = u.pathname.split('/').filter(Boolean);
      const response = await p.request.get(
        `https://boards-api.greenhouse.io/v1/boards/${parts[0]}/jobs/${parts[2]}`,
      );
      if (!response.ok()) throw Error('Live official posting title unavailable');
      const live = await response.json();
      if (String(live.id) !== parts[2]) throw Error('Official posting ID mismatch');
      title = live.title;
    } else throw Error('Actual title absent');
    const inventory = await inspectApplicationForm(p);
    if (
      inventory.questions.some(
        (q) =>
          q.type === 'file' && q.required && !['resume', '_systemfield_resume'].includes(q.key),
      )
    )
      throw Error('Additional required application document is unsupported');
    const questions = inventory.questions
      .filter((q) => q.type !== 'file')
      .map((q) => ({
        ...q,
        key: q.key === 'candidate-location' ? 'location' : q.key,
        kind: /consent|background check|recording|arbitration|agree to|terms and conditions/i.test(
          q.label,
        )
          ? 'consent'
          : q.kind,
      }));
    if (inventory.warnings.some((w) => /Ambiguous duplicate/.test(w)))
      throw Error('Ambiguous live field keys');
    if (d.source === 'greenhouse')
      for (const q of questions)
        if (q.type === 'combobox' && !q.options?.length)
          q.options = await comboboxOptions(p, q.key);
    const blockedReason = await challenge(p);
    return { url: p.url(), title, questions, ...(blockedReason ? { blockedReason } : {}) };
  }
  // Greenhouse dropdowns render their choices only while open. Open the menu,
  // read the offered labels and close it with Escape; nothing is typed or chosen.
  async function comboboxOptions(p, key) {
    const loc = p.locator(`[id="${esc(key)}"][role=combobox]`).first();
    if (!(await loc.count())) return [];
    await loc.scrollIntoViewIfNeeded();
    await loc.click();
    const controls = await loc.getAttribute('aria-controls');
    const options = controls
      ? p.locator(`[id="${esc(controls)}"] [role=option]`)
      : p.locator('[role=option]:visible');
    await options
      .first()
      .waitFor({ state: 'visible', timeout: 5000 })
      .catch(() => {});
    const labels = (await options.allInnerTexts()).map((s) => s.trim()).filter(Boolean);
    await loc.press('Escape');
    return labels;
  }
  async function select(p, loc, query, exact) {
    await loc.scrollIntoViewIfNeeded();
    await loc.click();
    await loc.fill(query);
    const controls = await loc.getAttribute('aria-controls');
    let options = controls
      ? p.locator(`[id="${esc(controls)}"] [role=option]`)
      : p.locator('[role=option]:visible');
    await options
      .filter({ hasText: new RegExp('^' + exact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') })
      .first()
      .waitFor({ state: 'visible', timeout: 15000 });
    await options
      .filter({ hasText: new RegExp('^' + exact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') })
      .first()
      .click();
    const chip = await loc.evaluate(
      (e) => e.closest('.select')?.querySelector('.select__single-value')?.textContent || '',
    );
    if (exact === 'United States +1') {
      const us = await loc.evaluate(
        (e) => !!e.closest('.select')?.querySelector('.select__single-value .iti__us'),
      );
      if (chip.trim() !== '+1' || !us)
        throw Error('United States selected flag and dial code verification failed');
    } else if (chip.trim() !== exact)
      throw Error('Selected option verification failed: ' + exact + ' actual ' + chip);
  }
  async function fillGH(p, answers) {
    const checks = [];
    for (const [key, value] of Object.entries(answers)) {
      const loc = p
        .locator(`[id="${esc(key === 'location' ? 'candidate-location' : key)}"]`)
        .first();
      if (!(await loc.count())) throw Error('Approved field missing ' + key);
      if (key === 'country') {
        await select(p, loc, 'United States', 'United States +1');
        checks.push({ key, value: '+1', type: 'country' });
      } else if (key === 'location') {
        await select(p, loc, location.query, location.greenhouse);
        checks.push({ key, value: location.greenhouse, type: 'select' });
      } else if ((await loc.getAttribute('role')) === 'combobox') {
        await select(p, loc, String(value), String(value));
        checks.push({ key, value: String(value), type: 'select' });
      } else {
        await loc.fill('');
        await loc.pressSequentially(String(value));
        await loc.press('Tab');
        if (
          key === 'phone'
            ? phoneDigits(await loc.inputValue()) !== phoneDigits(value)
            : (await loc.inputValue()) !== String(value)
        )
          throw Error('Value mismatch ' + key);
        checks.push({ key, value: String(value), type: 'input' });
      }
    }
    return checks;
  }
  async function ashbyField(p, key) {
    const field = p.locator(
      `[data-field-path="${esc(key)}"] input,[data-field-path="${esc(key)}"] textarea`,
    );
    if (await field.count()) return field.first();
    const direct = p.locator(`[id="${esc(key)}"],input[name="${esc(key)}"]`);
    if (await direct.count()) return direct.first();
    if (/^[a-f0-9-]{36}(?:_|$)/.test(key)) {
      const suffix = key.length === 36 ? key : key.slice(37);
      return p.locator(`[id$="_${esc(suffix)}"],input[name$="_${esc(suffix)}"]`).first();
    }
    return p
      .locator(
        `[id="${esc(key)}"],input[name="${esc(key)}"],[id$="_${esc(key)}"],input[name$="_${esc(key)}"]`,
      )
      .first();
  }
  async function pickAshbyLocation(p, loc) {
    await loc.click();
    await loc.fill(location.query);
    const option = p.getByRole('option', { name: location.ashby, exact: true });
    if (await option.count()) await option.click();
    else await p.getByText(location.ashby, { exact: true }).click({ timeout: 15000 });
    const actual = await loc.inputValue();
    if (actual !== location.ashby) throw Error('Ashby city selection mismatch ' + actual);
    return actual;
  }
  async function fillAshby(p, answers) {
    const checks = [];
    for (const [key, value] of Object.entries(answers)) {
      if (
        key === 'ashby_location_combobox' ||
        (key === '_systemfield_location' &&
          (await (await ashbyField(p, key)).getAttribute('role')) === 'combobox')
      ) {
        const loc = p.locator('input[role=combobox]').first();
        checks.push({ key, value: await pickAshbyLocation(p, loc), type: 'input' });
        continue;
      }
      const loc = await ashbyField(p, key);
      if (!(await loc.count())) throw Error('Approved field missing ' + key);
      // A custom city question can be a type-ahead that replaces typed text with
      // its own suggestion. When the answer is the home city, choose the same
      // approved location option used for Ashby's own location field.
      if (
        (await loc.getAttribute('role')) === 'combobox' &&
        location.query &&
        location.ashby &&
        sameCity(value, location.query)
      ) {
        await pickAshbyLocation(p, loc);
        checks.push({ key, value: location.ashby, type: 'input' });
        continue;
      }
      const type = await loc.getAttribute('type');
      const group = loc.locator('xpath=ancestor::*[@data-field-path][1]');
      if (
        type === 'checkbox' &&
        (await group.locator('.ashby-application-form-input-yesno').count())
      ) {
        checks.push({ key, value: String(value), type: 'yesno' });
      } else if (type === 'radio') {
        const actualName = await loc.getAttribute('name');
        const radios = p.locator(`input[type=radio][name="${esc(actualName)}"]`);
        let found = false;
        for (let i = 0; i < (await radios.count()); i++) {
          const r = radios.nth(i);
          const ancestor = r.locator('xpath=ancestor::label[1]');
          const labelLoc = (await ancestor.count())
            ? ancestor
            : p.locator(`label[for="${esc(await r.getAttribute('id'))}"]`);
          const label = await labelLoc.innerText();
          if (label.trim() === String(value).trim()) {
            const labelLoc = r.locator('xpath=ancestor::label[1]');
            if (await labelLoc.count()) await labelLoc.click();
            else await p.locator(`label[for="${esc(await r.getAttribute('id'))}"]`).click();
            if (!(await r.isChecked())) throw Error('Radio verification failed');
            found = true;
            break;
          }
        }
        if (!found) throw Error('Exact approved radio label unavailable ' + key);
        checks.push({ key, value: String(value), type: 'radio' });
      } else if (type === 'checkbox') {
        let labelLoc = loc.locator('xpath=ancestor::label[1]');
        if (!(await labelLoc.count()))
          labelLoc = p.locator(`label[for="${esc(await loc.getAttribute('id'))}"]`);
        const label = await labelLoc.innerText();
        if (label.trim() !== String(value)) throw Error('Checkbox label mismatch ' + key);
        await labelLoc.click();
        if (!(await loc.isChecked())) throw Error('Checkbox verification failed');
        checks.push({ key, value: String(value), type: 'checkbox' });
      } else {
        await loc.fill('');
        await loc.pressSequentially(String(value));
        await loc.press('Tab');
        if ((await loc.inputValue()) !== String(value)) throw Error('Value mismatch ' + key);
        checks.push({ key, value: String(value), type: 'input' });
      }
    }
    return checks;
  }
  async function verifyFilled(p, d, checks, resume) {
    for (const check of checks) {
      const { key, value, type } = check;
      const loc =
        d.source === 'lever'
          ? leverField(p, key)
          : key === 'ashby_location_combobox'
            ? p.locator('input[role=combobox]').first()
            : d.source === 'ashby'
              ? await ashbyField(p, key)
              : p.locator(`[id="${esc(key === 'location' ? 'candidate-location' : key)}"]`).first();
      if (type === 'input') {
        const actual = await loc.inputValue();
        const matched =
          key === 'phone' ? phoneDigits(actual) === phoneDigits(value) : actual === value;
        if (!matched) throw Error('Final input mismatch ' + key);
      }
      if (
        type === 'select' &&
        (
          await loc.evaluate(
            (e) => e.closest('.select')?.querySelector('.select__single-value')?.textContent || '',
          )
        ).trim() !== value
      )
        throw Error('Final selected option mismatch ' + key);
      if (type === 'country') {
        const country = await loc.evaluate((e) => ({
          dial: e.closest('.select')?.querySelector('.select__single-value')?.textContent?.trim(),
          us: !!e.closest('.select')?.querySelector('.select__single-value .iti__us'),
        }));
        if (country.dial !== '+1' || !country.us) throw Error('Final US phone country mismatch');
      }
      if (type === 'checkbox' && !(await loc.isChecked()))
        throw Error('Final checkbox mismatch ' + key);
      if (
        type === 'nativeSelect' &&
        (await loc.evaluate((el) => el.selectedOptions[0]?.textContent.trim())) !== value
      )
        throw Error('Final native select mismatch ' + key);
      if (
        d.source === 'lever' &&
        key === 'location' &&
        (await p.locator('#selected-location').count()) &&
        !(await p.locator('#selected-location').inputValue())
      )
        throw Error('Final Lever city selection missing');
      if (type === 'yesno') {
        const group = loc.locator('xpath=ancestor::*[@data-field-path][1]');
        if (
          (await group
            .getByRole('button', { name: value, exact: true })
            .getAttribute('aria-pressed')) !== 'true'
        )
          throw Error('Final yes/no mismatch ' + key);
      }
      if (type === 'radio') {
        const actualName = await loc.getAttribute('name');
        const checked = p.locator(`input[type=radio][name="${esc(actualName)}"]:checked`);
        if ((await checked.count()) !== 1) throw Error('Final radio not selected ' + key);
        const ancestor = checked.locator('xpath=ancestor::label[1]');
        const labelLoc = (await ancestor.count())
          ? ancestor
          : p.locator(`label[for="${esc(await checked.getAttribute('id'))}"]`);
        const label = await labelLoc.innerText();
        if (label.trim() !== value.trim()) throw Error('Final radio label mismatch ' + key);
      }
    }
    const basename = resume.replaceAll('\\', '/').split('/').at(-1);
    await p.waitForFunction(
      (name) =>
        document.body.innerText.includes(name) &&
        !/uploading\.\.\.|upload in progress/i.test(document.body.innerText),
      basename,
      { timeout: 30000 },
    );
    const body = await p.locator('body').innerText();
    if (!body.includes(basename)) throw Error('Uploaded filename not visibly accepted ' + basename);
    const invalid = await p.locator('[aria-invalid=true]:visible').count();
    if (invalid) throw Error('Visible invalid fields before submit');
    const blocker = await challenge(p);
    if (blocker) throw Error(blocker);
  }
  const successSelector =
    '.ashby-application-form-success-container[role=status][data-highlight=positive]';
  const positive =
    /thank you for (?:applying|submitting your application|your application)|we\s+(?:have\s+)?received\s+your\s+application|application (?:has been |was |is )?(?:successfully )?(?:received|submitted)/i;
  const apiRead = new Set([
    'ApiJobPosting',
    'ApiOrganizationFromHostedJobsPageName',
    'ApiAutocompleteGeoLocation',
  ]);
  async function receipt() {
    const formStillVisible =
      (await page.locator('form:visible').count()) > 0 ||
      (await page.getByRole('button', { name: /^submit application$/i }).count()) > 0;
    const text = await page.locator('body').innerText(),
      ashbySuccessPanel = await page
        .locator(successSelector)
        .isVisible()
        .catch(() => false);
    if (formStillVisible || (!ashbySuccessPanel && !positive.test(text))) return null;
    const actual = new URL(page.url()),
      expected = new URL(current.url);
    if (actual.origin !== expected.origin || !actual.pathname.startsWith(expected.pathname))
      throw Error('Receipt is outside the original posting');
    const screenshotPath = join(receiptDir, Date.now() + '-confirmation.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return {
      url: page.url(),
      text,
      observedAt: new Date().toISOString(),
      kind: 'ats_confirmation',
      ashbySuccessPanel,
      formStillVisible: false,
      screenshotPath,
      ...(codeWait ? { verificationCode: 'entered_by_applicant' } : {}),
    };
  }
  // Greenhouse's email check: its instruction, eight one-character boxes and a
  // disabled final Submit. The code itself never leaves this function.
  async function emailGate() {
    const text = await page
      .locator('body')
      .innerText()
      .catch(() => '');
    if (
      !/A verification code was sent[\s\S]*To submit your application, enter the 8-character code to confirm you're a human/i.test(
        text,
      )
    )
      return { present: false };
    const boxes = await page
      .locator('input[maxlength="1"]:visible')
      .evaluateAll((inputs) => inputs.map((input) => input.value));
    const submitDisabled = await page
      .getByRole('button', { name: /^submit application$/i })
      .isDisabled()
      .catch(() => false);
    return {
      present: boxes.length === 8,
      empty: boxes.every((v) => v === ''),
      code: boxes.every((v) => v !== '') ? boxes.join('') : null,
      submitDisabled,
    };
  }
  // The code goes to the applicant's mailbox and only the applicant types it.
  // Keep the filled page open, alert them, and press Submit for each complete
  // code they enter until the ATS confirms or the wait ends.
  async function awaitApplicantCode(d, waitMs) {
    const started = Date.now(),
      gatePage = page;
    codeWait = { waitMs, submitClicked: false };
    clearTimeout(postingTimer);
    postingTimer = setTimeout(
      () => gatePage.close().catch(() => {}),
      waitMs + confirmationTimeoutMs + 60000,
    );
    postingTimer.unref();
    applicationRequest = false;
    await page.bringToFront().catch(() => {});
    await Promise.resolve(codeEntry.notify?.(d, waitMs)).catch(() => {});
    let submitted = null,
      submittedAt = 0,
      seen = null,
      seenAt = 0;
    try {
      while (
        Date.now() - started < waitMs ||
        (submittedAt && Date.now() - submittedAt < confirmationTimeoutMs)
      ) {
        const observed = await receipt();
        if (observed) return observed;
        const gate = await emailGate();
        // Retyping over a previous code keeps every box filled, so a complete
        // code must stay unchanged briefly before it counts as entered.
        if (gate.code !== seen) [seen, seenAt] = [gate.code, Date.now()];
        if (
          gate.present &&
          gate.code &&
          gate.code !== submitted &&
          !gate.submitDisabled &&
          Date.now() - seenAt >= codeSettleMs
        ) {
          submitted = gate.code;
          submittedAt = Date.now();
          codeWait.submitClicked = true;
          await page.getByRole('button', { name: /^submit application$/i }).click();
        }
        await sleep(pollMs);
      }
      throw Error(
        codeWait.submitClicked
          ? 'ATS did not confirm the application after the verification code'
          : `Verification code was not entered within ${Math.round(waitMs / 60000)} minutes`,
      );
    } finally {
      codeWait.waitedMs = Date.now() - started;
      codeEntry.waited?.({ waitedMs: codeWait.waitedMs, entered: codeWait.submitClicked });
    }
  }
  return {
    async preflight(d) {
      current = d;
      checks = [];
      applicationRequest = false;
      codeWait = null;
      page = await context.newPage();
      // Closing the page interrupts stalled browser actions. A possible delivery
      // remains uncertain; a stalled pre-submit form is skipped by the controller.
      const postingPage = page;
      postingTimer = setTimeout(() => postingPage.close().catch(() => {}), maxPostingMs);
      postingTimer.unref();
      page.setDefaultTimeout(20000);
      await page.setViewportSize({ width: 1280, height: 1000 });
      page.on('request', (r) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return;
        let body;
        try {
          body = r.postDataJSON();
        } catch {}
        const u = new URL(r.url()),
          operation = body?.operationName ?? u.searchParams.get('op');
        // Google's challenge transport does not deliver an application. Keep
        // every other unknown write conservative, including other Google paths.
        // A visible unfinished challenge is still required before releasing a slot.
        const captchaTransport =
          u.protocol === 'https:' &&
          !u.port &&
          ['www.google.com', 'www.recaptcha.net'].includes(u.hostname) &&
          /^\/recaptcha\/(?:api2|enterprise)\/(?:reload|userverify|clrc|bcn)$/.test(u.pathname);
        if (captchaTransport) return;
        // Count cross-origin writes too: absence of same-origin POST alone does
        // not establish that an application was never transmitted.
        if (new URL(r.url()).origin !== new URL(d.url).origin || !apiRead.has(operation))
          applicationRequest = true;
      });
      if (!['ashby', 'greenhouse', 'lever'].includes(d.source)) throw Error('Unsupported ATS');
      const u = new URL(d.url);
      if (
        u.protocol !== 'https:' ||
        u.username ||
        u.password ||
        u.port ||
        !(d.source === 'ashby'
          ? /^\/[^/]+\/[a-f0-9-]{36}$/i.test(u.pathname) && u.hostname === 'jobs.ashbyhq.com'
          : d.source === 'lever'
            ? /^\/[^/]+\/[a-f0-9-]{36}$/i.test(u.pathname) && u.hostname === 'jobs.lever.co'
            : /^\/[^/]+\/jobs\/\d+$/.test(u.pathname) &&
              ['job-boards.greenhouse.io', 'boards.greenhouse.io'].includes(u.hostname))
      )
        throw Error('Invalid official application URL');
      await page.goto(
        d.url + (d.source === 'ashby' ? '/application' : d.source === 'lever' ? '/apply' : ''),
        {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        },
      );
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll('input,textarea')].some(
            (e) => e.type !== 'hidden' && e.getClientRects().length,
          ),
        undefined,
        { timeout: 20000 },
      );
      await necessaryCookies(page);
      const body = await page.locator('body').innerText();
      if (
        /(?:do not|don't|without|no)\s+(?:use\s+)?(?:AI|artificial intelligence)|AI[- ](?:generated|assisted) (?:answers|responses).*not allowed|create an account to apply|sign in to apply/i.test(
          body,
        )
      )
        throw Error('Account or prohibited AI-assisted answer requirement');
      return snapshot(page, d);
    },
    async fill(d, answers, resumeBytes) {
      if (createHash('sha256').update(resumeBytes).digest('hex') !== d.resumeHash)
        throw Error('Approved resume bytes changed');
      approvedResume = d.resumePath;
      for (const cb of await page.locator('input[type=checkbox]:checked').all()) {
        const raw = (await cb.getAttribute('name')) || (await cb.getAttribute('id')) || '';
        if (Object.keys(answers).some((k) => raw === k || raw.endsWith('_' + k))) continue;
        if (await cb.isVisible()) await cb.uncheck();
        else {
          const label = page.locator(`label[for="${esc(await cb.getAttribute('id'))}"]`);
          if ((await label.count()) !== 1 || !(await label.isVisible()))
            throw Error('Cannot decline an unapproved selected checkbox');
          await label.click();
          if (await cb.isChecked()) throw Error('Unapproved checkbox remains selected');
        }
      }
      if (d.source === 'greenhouse') await sleep(10000); // Greenhouse initializes its upload SDK after rendering inputs.
      await page
        .locator(
          d.source === 'ashby'
            ? '#_systemfield_resume'
            : d.source === 'lever'
              ? 'input[type=file][name=resume]'
              : '#resume',
        )
        .setInputFiles({
          name: basename(d.resumePath.replaceAll('\\', '/')),
          mimeType: 'application/pdf',
          buffer: resumeBytes,
        });
      await sleep(1800);
      checks =
        d.source === 'ashby'
          ? await fillAshby(page, answers)
          : d.source === 'lever'
            ? await fillLever(page, answers, location)
            : await fillGH(page, answers);
      for (const c of checks.filter((c) => c.type === 'yesno')) {
        await necessaryCookies(page);
        const input = await ashbyField(page, c.key),
          group = input.locator('xpath=ancestor::*[@data-field-path][1]');
        await group.getByRole('button', { name: c.value, exact: true }).click();
        await sleep(500);
      }
      await verifyFilled(page, d, checks, approvedResume);
    },
    async inspect(d) {
      await necessaryCookies(page);
      await sleep(500);
      await verifyFilled(page, d, checks, approvedResume);
      return snapshot(page, d);
    },
    async submit(d) {
      applicationRequest = false;
      let clickAttempted = false;
      try {
        await verifyFilled(page, d, checks, approvedResume);
        const button = ['ashby', 'lever'].includes(d.source)
          ? page.getByRole('button', { name: /^submit application$/i })
          : page.locator('button[type=submit]');
        if ((await button.count()) !== 1) throw Error('Ambiguous final Submit button');
        if (!(await button.isVisible()) || !(await button.isEnabled()))
          throw Error('Submit button is unavailable');
        clickAttempted = true;
        await button.click();
        // Interactive challenges can appear only after Submit. Never solve them.
        const blocker = await challenge(page);
        if (blocker) throw Error(blocker);
        await page.waitForFunction(
          () =>
            !!document
              .querySelector(
                '.ashby-application-form-success-container[role=status][data-highlight=positive]',
              )
              ?.getClientRects().length ||
            /thank you for (?:applying|submitting your application|your application)|we\s+(?:have\s+)?received\s+your\s+application|application (?:has been |was |is )?(?:successfully )?(?:received|submitted)|Your form needs corrections|verify you are human|complete the captcha|security verification|A verification code was sent/i.test(
              document.body.innerText,
            ),
          undefined,
          { timeout: confirmationTimeoutMs },
        );
        const observed = await receipt();
        if (observed) return observed;
        if (d.source === 'greenhouse' && codeEntry) {
          const gate = await emailGate();
          const waitMs =
            gate.present && gate.empty && gate.submitDisabled ? codeEntry.waitMs(d) : 0;
          if (waitMs > 0) return await awaitApplicantCode(d, waitMs);
        }
        throw Error('ATS did not confirm the application');
      } catch (e) {
        const text = await page
          .locator('body')
          .innerText()
          .catch(() => '');
        const blocker = await challenge(page).catch(() => '');
        const clientRejected =
          /Your form needs corrections[\s\S]*Missing entry for required field/i.test(text);
        // Greenhouse can send an email challenge before accepting an application.
        // Require both its explicit instruction and the actual unfinished controls.
        const gate = d.source === 'greenhouse' ? await emailGate() : { present: false };
        const unfinishedGate = gate.present && gate.empty && gate.submitDisabled;
        // After a wait for the applicant, a closed page or a partial code sent
        // nothing when Submit was never pressed and no write followed the gate.
        const untouchedWait = !!codeWait && !codeWait.submitClicked && !applicationRequest;
        // Freeze scripts and in-flight requests before releasing a confirmed
        // non-delivery slot. A challenge after any write remains ambiguous.
        const rejectedBeforeDelivery =
          unfinishedGate ||
          untouchedWait ||
          (!applicationRequest && (!clickAttempted || blocker || clientRejected));
        const screenshotPath = join(receiptDir, Date.now() + '-unconfirmed.png');
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
        e.evidence = {
          url: page.url(),
          text,
          writeRequestObserved: applicationRequest,
          ...(unfinishedGate || codeWait
            ? { deliveryGate: 'greenhouse_email_verification_before_submission' }
            : {}),
          ...(codeWait
            ? {
                verificationCodeWait: {
                  waitMs: codeWait.waitMs,
                  waitedMs: codeWait.waitedMs,
                  submitClicked: codeWait.submitClicked,
                },
              }
            : {}),
          observedAt: new Date().toISOString(),
          screenshotPath,
        };
        if (rejectedBeforeDelivery) {
          await page.close().catch(() => {});
          e.rejectedBeforeDelivery = unfinishedGate || untouchedWait || !applicationRequest;
          e.evidence.writeRequestObserved = applicationRequest;
        }
        throw e;
      }
    },
    async closePosting() {
      clearTimeout(postingTimer);
      if (page) {
        await page.close();
        page = null;
      }
    },
    async close() {
      clearTimeout(postingTimer);
      if (!providedContext) await context.close();
    },
  };
}
