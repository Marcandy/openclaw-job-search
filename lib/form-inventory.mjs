import { digest } from './runtime.mjs';

export async function inspectPublicApplication(input, { chromium, timeoutMs = 15000 }) {
  const url = new URL(input);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    ![
      'job-boards.greenhouse.io',
      'boards.greenhouse.io',
      'jobs.ashbyhq.com',
      'jobs.lever.co',
    ].includes(url.hostname)
  )
    throw new Error('Use an official Greenhouse, Ashby or Lever HTTPS posting URL');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    let blockedRequests = 0;
    await context.route('**/*', (route) => {
      const request = route.request();
      let metadataRead = false;
      try {
        const b = request.postDataJSON(),
          u = new URL(request.url());
        metadataRead =
          request.method() === 'POST' &&
          u.hostname === 'jobs.ashbyhq.com' &&
          u.pathname === '/api/non-user-graphql' &&
          [
            'ApiJobPosting',
            'ApiOrganizationFromHostedJobsPageName',
            'ApiAutocompleteGeoLocation',
          ].includes(b?.operationName ?? u.searchParams.get('op')) &&
          !/\bmutation\b/i.test(b?.query ?? '');
      } catch {}
      if (
        (!['GET', 'HEAD'].includes(request.method()) && !metadataRead) ||
        (request.isNavigationRequest() && new URL(request.url()).origin !== url.origin)
      ) {
        blockedRequests++;
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page
      .waitForFunction(
        () =>
          [
            ...document.querySelectorAll(
              'input:not([type="hidden"]),textarea,select,[role="combobox"]',
            ),
          ].some((el) => el.getClientRects().length),
        undefined,
        { timeout: timeoutMs },
      )
      .catch(() => {});
    const report = await inspectApplicationForm(page);
    if (blockedRequests)
      report.warnings.push(
        `${blockedRequests} non-read or cross-origin navigation requests blocked; inspect rendering manually`,
      );
    return report;
  } finally {
    await browser.close();
  }
}

// Read public question metadata only. No values, selectors, form mutations,
// applicant facts, or authority to fill/submit are returned by this inventory.
export async function inspectApplicationForm(page) {
  const inventory = await page.evaluate(() => {
    const clean = (text) =>
      String(text ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    const visible = (el) =>
      el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== 'hidden' &&
      !el.closest('[hidden],[aria-hidden="true"]');
    const text = (el) => clean(el?.textContent);
    const labelled = (el) =>
      clean(
        (el.getAttribute('aria-labelledby') ?? '')
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' '),
      );
    const label = (el) =>
      clean(el.getAttribute('aria-label')) ||
      labelled(el) ||
      clean([...(el.labels ?? [])].map(text).join(' '));
    const ashby = location.hostname === 'jobs.ashbyhq.com';
    const stableId = (id) =>
      ashby
        ? id.replace(
            /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}_([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?=_|$)/i,
            '$1',
          )
        : id;
    const roots = [
      ...document.querySelectorAll(
        '.ashby-application-form-container, #application_form, form:has(input[type=file])',
      ),
    ];
    const elements = [
      ...document.querySelectorAll(
        'input,textarea,select,[role="combobox"],[role="radio"],[role="checkbox"]',
      ),
    ].filter(
      (el) =>
        (!roots.length || roots.some((root) => root.contains(el))) &&
        !el.disabled &&
        el.getAttribute('aria-disabled') !== 'true' &&
        !['hidden', 'button', 'submit', 'reset'].includes(el.type) &&
        (visible(el) ||
          el.type === 'file' ||
          (['checkbox', 'radio'].includes(el.type) &&
            visible(
              el.closest(
                '[data-field-path],fieldset,[role="radiogroup"],.application-question,label',
              ) ?? el,
            ))),
    );
    const groups = new Map(),
      warnings = [];
    if (document.querySelector('iframe[src*="captcha"],[data-sitekey],.g-recaptcha,.h-captcha'))
      warnings.push('CAPTCHA requires manual handling; do not bypass it');
    if (/sign in to apply|create an account to apply/i.test(document.body?.innerText ?? ''))
      warnings.push('Account wall requires manual review');
    for (const el of elements) {
      const type =
        el.getAttribute('role') ||
        (el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select' : el.type);
      const group = el.closest(
        '[data-field-path],fieldset,[role="radiogroup"],.ashby-application-form-field-entry,.application-question',
      );
      const choice = ['radio', 'checkbox'].includes(type);
      // A radio name or explicit container represents ONE question, not a
      // required answer for every option. Uncontained checkboxes stay separate.
      const sameGroup =
        choice &&
        group &&
        elements.filter(
          (e) => group.contains(e) && (e.type === type || e.getAttribute('role') === type),
        ).length > 1;
      const token = sameGroup
        ? group
        : type === 'radio' && el.name
          ? `${el.form?.id ?? ''}:radio:${el.name}`
          : el;
      if (!groups.has(token)) groups.set(token, { controls: [], group, type });
      groups.get(token).controls.push(el);
    }
    const questions = [...groups.values()].map(({ controls, group, type }, index) => {
      const first = controls[0];
      const choiceGroup = controls.length > 1 && ['radio', 'checkbox'].includes(type);
      const heading =
        (location.hostname === 'jobs.lever.co'
          ? group?.querySelector('.application-label')
          : null) ??
        group?.querySelector(
          ':scope > legend, :scope > label, :scope > [class*="label"], :scope > [class*="Label"]',
        );
      const groupLabel =
        text(heading) || (group ? labelled(group) || clean(group.getAttribute('aria-label')) : '');
      const questionLabel =
        location.hostname === 'jobs.lever.co'
          ? groupLabel || label(first)
          : choiceGroup || type === 'radio'
            ? groupLabel
            : label(first) || groupLabel;
      const requiredMarker =
        heading &&
        (/\*\s*$/.test(text(heading)) ||
          /required/i.test(heading.className) ||
          heading.querySelector('[class*="required"],[aria-label="required"]'));
      const required =
        controls.some((el) => el.required || el.getAttribute('aria-required') === 'true') ||
        group?.getAttribute('aria-required') === 'true' ||
        group?.getAttribute('data-required') === 'true' ||
        Boolean(requiredMarker);
      const fieldPath =
        group?.getAttribute('data-field-path') ||
        first.closest('[data-field-path]')?.getAttribute('data-field-path');
      const rawKey = choiceGroup
        ? fieldPath || first.name || first.id
        : first.name || first.id || fieldPath;
      const key =
        stableId(rawKey ?? '').replace(
          /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}_(?=question_\d+(?:_|$))/i,
          '',
        ) ||
        (questionLabel
          ? `semantic:${type}:${encodeURIComponent(questionLabel)}`
          : `unmapped_${index}`);
      const yesno = !!first
        .closest('[data-field-path]')
        ?.querySelector('.ashby-application-form-input-yesno');
      const options = yesno
        ? ['Yes', 'No']
        : choiceGroup || ['radio', 'checkbox'].includes(type)
          ? controls.map((el) => label(el))
          : type === 'select'
            ? [...first.options].map(text)
            : [];
      const kind = type === 'checkbox' && !choiceGroup && !yesno ? 'consent' : 'fact';
      if (!rawKey && !questionLabel) warnings.push(`Question ${index + 1} has no stable key`);
      if (!questionLabel) warnings.push(`Question ${key} has no question label`);
      if (['combobox', 'password'].includes(type) || first.getAttribute('role'))
        warnings.push(`Question ${key} uses a control requiring an audited adapter`);
      if (options.some((option) => !option))
        warnings.push(`Question ${key} has an unlabeled option`);
      if (choiceGroup && type === 'checkbox' && controls.some((el) => el.required))
        warnings.push(
          `Question ${key} has individually required checkboxes; inspect each requirement`,
        );
      return {
        key,
        label: questionLabel,
        type,
        kind,
        required: Boolean(required),
        grouped: choiceGroup,
        options,
      };
    });
    const keys = new Set();
    for (const q of questions) {
      if (keys.has(q.key)) warnings.push(`Ambiguous duplicate question key: ${q.key}`);
      keys.add(q.key);
    }
    if (!questions.length)
      warnings.push(
        'No visible application controls; the form may not be loaded or may be embedded',
      );
    if (document.querySelector('iframe'))
      warnings.push('Embedded frames require separate manual inspection');
    return { url: location.href, title: document.title, questions, warnings };
  });
  // DOM order and Ashby page prefixes are not part of the diagnostic schema.
  const schemaHash = digest([...inventory.questions].sort((a, b) => a.key.localeCompare(b.key)));
  return {
    ...inventory,
    schemaHash,
    observedAt: new Date().toISOString(),
    authority: 'inspection_only',
  };
}
