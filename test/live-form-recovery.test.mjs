import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { officialApplicationUrl, officialJobIdentity } from '../lib/official-destination.mjs';
import { readOfficialPosting } from '../lib/official-posting.mjs';
import { liveAtsDriver } from '../lib/live-ats-driver.mjs';

test('embedded forms retain board/job identity; unsafe IDs remain refused', () => {
  const board = { platform: 'greenhouse', slug: 'example' };
  const url = officialApplicationUrl(board, '123', 'http://example.test/careers?gh_jid=123');
  assert.equal(url, 'https://job-boards.greenhouse.io/embed/job_app?for=example&token=123');
  assert.deepEqual(officialJobIdentity(url), {
    platform: 'greenhouse',
    slug: 'example',
    id: '123',
  });
  assert.throws(
    () =>
      officialApplicationUrl(
        board,
        '123',
        'https://job-boards.greenhouse.io/embed/job_app?for=other&token=123',
      ),
    /mismatch/,
  );
  assert.throws(
    () =>
      officialJobIdentity(
        'https://job-boards.greenhouse.io/embed/job_app?for=../../internal&token=1',
      ),
    /Invalid/,
  );
  assert.doesNotThrow(() =>
    officialApplicationUrl(
      { platform: 'ashby', slug: 'concentrate%20ai' },
      'id',
      'https://jobs.ashbyhq.com/concentrate%20ai/id',
    ),
  );
});

test('the posting reader takes duties from the exact public API requisition, not the application tab', async () => {
  const d = {
    source: 'ashby',
    company: 'Example',
    url: 'https://jobs.ashbyhq.com/example/00000000-0000-0000-0000-000000000001',
  };
  const fetcher = async () => ({
    ok: true,
    json: async () => ({
      jobs: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          title: 'Founding Engineer',
          jobUrl: d.url,
          descriptionPlain: 'Build web applications with Python and React.',
          location: 'Remote - United States',
        },
      ],
    }),
  });
  assert.match((await readOfficialPosting(d, fetcher)).description, /Build web applications/);
  await assert.rejects(
    () => readOfficialPosting({ ...d, url: d.url.replace(/1$/, '2') }, fetcher),
    /unavailable/,
  );
});

test('the nested Render-style combobox can be filled and verified without a positional selector', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const directory = mkdtempSync(join(tmpdir(), 'render-form-fixture-'));
  const bytes = Buffer.from('synthetic');
  const destination = {
    source: 'ashby',
    company: 'Example',
    title: 'Software Engineer',
    url: 'https://jobs.ashbyhq.com/example/00000000-0000-0000-0000-000000000001',
    resumePath: 'Resume.pdf',
    resumeHash: createHash('sha256').update(bytes).digest('hex'),
  };
  await context.route('**/*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<h1>Software Engineer</h1><div class="ashby-application-form-container"><div data-field-path="source"><fieldset><label for="missing" class="required">How did you hear about Render?</label><input role="combobox" aria-expanded="false"><div id="choices"></div></fieldset></div><input type="file" id="_systemfield_resume"><span id="filename"></span><button>Submit Application</button></div><script>const input=document.querySelector('input[role=combobox]'),choices=document.querySelector('#choices');input.onclick=input.oninput=()=>{input.setAttribute('aria-expanded','true');choices.innerHTML='<div role="option">Other</div>';choices.firstChild.onclick=()=>{input.value='Other';input.setAttribute('aria-expanded','false');choices.innerHTML=''}};input.onkeydown=e=>{if(e.key==='Escape'){input.setAttribute('aria-expanded','false');choices.innerHTML=''}};document.querySelector('input[type=file]').onchange=e=>document.querySelector('#filename').textContent=e.target.files[0].name;</script>`,
    }),
  );
  const driver = await liveAtsDriver({ context, receiptDir: directory, location: {} });
  try {
    const form = await driver.preflight(destination);
    assert.deepEqual(form.questions.find((q) => q.key === 'source').options, ['Other']);
    await driver.fill(destination, { source: 'Other' }, bytes);
    assert.equal((await driver.inspect(destination)).title, 'Software Engineer');
  } finally {
    await driver.closePosting();
    await browser.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('ambiguous query identities cannot select a different embedded job', () => {
  assert.throws(
    () =>
      officialJobIdentity(
        'https://job-boards.greenhouse.io/embed/job_app?for=example&for=other&token=1',
      ),
    /Ambiguous/,
  );
  assert.throws(
    () => officialJobIdentity('https://job-boards.greenhouse.io/example/jobs/1?gh_jid=2'),
    /mismatch/,
  );
});

test('an explicit permanent-resident alternative is distinct from citizen-only eligibility', async () => {
  const { qualifyRole } = await import('../lib/role-qualification.mjs');
  const facts = {
    fields: {
      workAuthorization: { value: 'Lawful Permanent Resident (Green Card)', uses: ['application'] },
    },
  };
  assert.equal(
    qualifyRole(
      {
        title: 'Software Engineer',
        description: 'Must be a U.S. citizen or lawful permanent resident.',
      },
      {},
      facts,
    ).ok,
    true,
  );
  assert.equal(
    qualifyRole({ title: 'Software Engineer', description: 'Must be a U.S. citizen.' }, {}, facts)
      .ok,
    false,
  );
});

test('company boilerplate does not establish software duties for a hardware role', async () => {
  const { qualifyRole } = await import('../lib/role-qualification.mjs');
  assert.equal(
    qualifyRole({
      title: 'RF Design Engineer',
      description:
        'We build software for advanced products.\nResponsibilities\nMeasure radio frequency interference and validate antenna performance.\nRequirements\nRF lab experience.',
    }).ok,
    false,
  );
  assert.equal(
    qualifyRole({
      title: 'Software Engineer',
      description:
        'We create 3D harness routes and harness assemblies.\nResponsibilities\nBuild web applications using React and Python.\nRequirements\nSoftware engineering experience.',
    }).ok,
    true,
  );
});

test('a resident alternative cannot override another citizen-only requirement', async () => {
  const { qualifyRole } = await import('../lib/role-qualification.mjs');
  assert.equal(
    qualifyRole(
      {
        title: 'Software Engineer',
        description:
          'Must be a U.S. citizen or lawful permanent resident. This position requires U.S. citizenship.',
      },
      {},
      { fields: { workAuthorization: { value: 'Green Card', uses: ['application'] } } },
    ).ok,
    false,
  );
  assert.throws(
    () =>
      officialJobIdentity(
        'https://job-boards.greenhouse.io/embed/job_app?for=example&token=1&gh_jid=2',
      ),
    /mismatch/,
  );
});

test('a generic clearance-eligibility requirement is not inferred from work authorization', async () => {
  const { qualifyRole } = await import('../lib/role-qualification.mjs');
  assert.equal(
    qualifyRole(
      {
        title: 'Software Engineer',
        description: 'Clearance Requirement:\nEligible to obtain a clearance',
      },
      {},
      { fields: { securityClearance: { value: 'None', uses: ['application'] } } },
    ).ok,
    false,
  );
});

for (const [copy, blocked] of [
  ['We solve the world?s most complex challenges today.', false],
  ['Solve this security challenge', true],
]) {
  test('challenge gate distinguishes employer prose: ' + copy, async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const directory = mkdtempSync(join(tmpdir(), 'challenge-copy-'));
    await context.route('**/*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<h1>Software Engineer</h1><p>${copy}</p><input name="name" required><input type="file">`,
      }),
    );
    const driver = await liveAtsDriver({ context, receiptDir: directory, location: {} });
    try {
      const form = await driver.preflight({
        source: 'ashby',
        title: 'Software Engineer',
        url: 'https://jobs.ashbyhq.com/example/00000000-0000-0000-0000-000000000001',
      });
      assert.equal(Boolean(form.blockedReason), blocked);
    } finally {
      await driver.closePosting();
      await browser.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('direct answers bind to the employer, exact question and explicit consent approval', async () => {
  const { mapRoutineQuestions, explicitQuestionConsentUse } =
    await import('../lib/daily-policy.mjs');
  const label = 'By selecting Yes, I am consenting to the use of AI for evaluating my candidacy.';
  const q = {
    key: 'ai',
    label,
    kind: 'consent',
    required: true,
    type: 'select',
    options: ['Yes', 'No'],
  };
  const f = {
    value: 'Yes',
    source: 'Direct user reply',
    confirmedAt: '2026-10-30T12:00:00Z',
    uses: ['application', explicitQuestionConsentUse(label)],
    employer: 'ClickHouse',
    questionLabel: label,
  };
  const run = (fields, company = 'ClickHouse', question = q) =>
    mapRoutineQuestions([question], { company, url: 'https://example.test/job' }, { fields }, {});
  const plan = run({ ai: f });
  assert.equal(plan.blocked.length, 0);
  assert.equal(plan.facts.fields[plan.answers.ai].value, 'Yes');
  assert.ok(plan.facts.fields[plan.answers.ai].uses.includes('consent:ai'));
  assert.equal(run({ ai: f }, 'Other').blocked.length, 1);
  assert.equal(
    run({ ai: f }, 'ClickHouse', { ...q, label: label + ' Also consent to marketing.' }).blocked
      .length,
    1,
  );
  assert.equal(run({ ai: { ...f, uses: ['application'] } }).blocked.length, 1);
  assert.equal(run({ ai: f, copy: f }).blocked[0].reason, 'ambiguous_explicit_answer');
  const h = {
    ...f,
    value: 'No',
    employer: 'Affirm',
    questionLabel: 'Have you previously been employed at Affirm for any length of time?',
    uses: ['application'],
  };
  const history = {
    key: 'history',
    label: h.questionLabel,
    type: 'select',
    required: true,
    options: ['Yes', 'No'],
  };
  assert.equal(run({ h }, 'Affirm', history).blocked.length, 0);
  assert.equal(run({ h }, 'Other', history).blocked.length, 1);
});

test('the current application title can answer a role-selection question, never employment history', async () => {
  const { mapRoutineQuestions } = await import('../lib/daily-policy.mjs');
  const destination = {
    company: 'Example',
    title: 'Senior Software Engineer',
    url: 'https://example.test/job',
  };
  const q = {
    key: 'role',
    label: 'What full time job(s) are you applying for?',
    required: true,
    type: 'text',
  };
  const run = (question) => mapRoutineQuestions([question], destination, { fields: {} }, {});
  const plan = run(q);
  assert.equal(plan.facts.fields[plan.answers.role].value, destination.title);
  assert.equal(run({ ...q, type: 'select', options: ['Other role'] }).blocked.length, 1);
  assert.equal(
    run({ ...q, type: 'select', options: [destination.title, destination.title] }).blocked.length,
    1,
  );
  assert.equal(run({ ...q, label: 'What full time jobs have you held?' }).blocked.length, 1);
});

test('Lever and Greenhouse preflight read one exact requisition rather than the entire board', async () => {
  for (const platform of ['lever', 'greenhouse']) {
    const id = platform === 'lever' ? '00000000-0000-0000-0000-000000000001' : '123';
    const url =
      platform === 'lever'
        ? `https://jobs.lever.co/example/${id}`
        : `https://job-boards.greenhouse.io/example/jobs/${id}`;
    const raw =
      platform === 'lever'
        ? {
            id,
            text: 'Software Engineer',
            hostedUrl: url,
            description: '<p>Build Python APIs.</p>',
          }
        : {
            id: 123,
            title: 'Software Engineer',
            absolute_url: url,
            content: '&lt;p&gt;Build Python APIs.&lt;/p&gt;',
          };
    const calls = [];
    const fetcher = async (endpoint) => {
      calls.push(endpoint);
      return { ok: true, json: async () => raw };
    };
    const result = await readOfficialPosting(
      { source: platform, company: 'Example', url },
      fetcher,
    );
    assert.match(result.description, /Build Python APIs/);
    const wrongDestination =
      platform === 'lever'
        ? { ...raw, hostedUrl: url.replace('/example/', '/other/') }
        : { ...raw, absolute_url: url.replace('/example/', '/other/') };
    await assert.rejects(
      () =>
        readOfficialPosting({ source: platform, company: 'Example', url }, async () => ({
          ok: true,
          json: async () => wrongDestination,
        })),
      /mismatch/,
    );

    assert.equal(calls.length, 1);
    assert.match(calls[0], new RegExp('/' + id + '(?:\\?|$)'));
    await assert.rejects(
      () =>
        readOfficialPosting({ source: platform, company: 'Example', url }, async () => ({
          ok: true,
          json: async () => ({ ...raw, id: 'wrong' }),
        })),
      /identity mismatch/,
    );
  }
});
