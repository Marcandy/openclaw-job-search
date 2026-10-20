import test from 'node:test';
import assert from 'node:assert/strict';
import { EventStore } from '../lib/event-store.mjs';
import {
  dailyUsage,
  companyUsage,
  belowCompanyCap,
  beginDailySubmit,
  mapRoutineQuestions,
  homeStateListAnswer,
  standingChoiceAnswer,
  permanentResidentAnswer,
} from '../lib/daily-policy.mjs';
import { answerQuestions } from '../lib/facts-and-blockers.mjs';
import {
  postedSalary,
  usRemote,
  verifyResearchedProfile,
  rankResearchTargets,
} from '../lib/daily-discovery.mjs';
const now = new Date('2026-10-15T16:00:00Z'),
  policy = {
    dailyLimit: 12,
    timezone: 'America/New_York',
    hash: 'standing',
    applicationIntro: 'I build React and Python applications.',
  };
const role = (n) => ({
  url: `https://jobs.ashbyhq.com/acme/00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
  company: 'Acme',
  title: 'Software Engineer',
  location: 'US remote',
  source: 'ashby',
});

test('company usage counts today’s occupied slots per employer, not blocks or other days', () => {
  const s = new EventStore(':memory:');
  try {
    const at = (n, company, timestamp, status = 'submitted') => ({
      ...role(n),
      company,
      timestamp,
      status,
    });
    s.importLedger([
      at(0, 'WorkOS', now.toISOString()),
      at(1, 'workos, Inc.', now.toISOString()),
      at(2, 'WorkOS', '2026-10-14T16:00:00Z'),
      at(3, 'WorkOS', now.toISOString(), 'blocked'),
      at(4, 'Baseten', now.toISOString()),
    ]);
    const run = s.startRun();
    const held = s.claim(run, { ...role(5), company: 'Baseten' }, 'manifest-held');
    s.transition(held, run, 'filling');
    beginDailySubmit(s, held, run, policy, now);
    s.transition(held, run, 'uncertain', { reason: 'Timeout' });
    s.db.prepare('UPDATE applications SET updated_at=? WHERE id=?').run(now.toISOString(), held);
    assert.deepEqual(Object.fromEntries(companyUsage(s, policy.timezone, now)), {
      workos: 2,
      baseten: 2,
    });
    assert.equal(dailyUsage(s, policy.timezone, now).occupied, 4);
    const admit = belowCompanyCap(s, policy.timezone, 2, now);
    assert.equal(admit({ company: 'WorkOS' }), false);
    assert.equal(admit({ company: 'Runpod' }), true);
    assert.equal(belowCompanyCap(s, policy.timezone, 3, now)({ company: 'Baseten' }), true);
  } finally {
    s.close();
  }
});

test('verified pre-delivery failure releases capacity for a different successful application', () => {
  const store = new EventStore(':memory:');
  const clock = new Date();
  try {
    for (let i = 0; i < 11; i++) {
      store.importLedger([{ ...role(i), timestamp: clock.toISOString(), status: 'submitted' }]);
    }
    const run = store.startRun();
    const blocked = store.claim(run, role(11), 'blocked-manifest');
    store.transition(blocked, run, 'filling');
    beginDailySubmit(store, blocked, run, policy, clock);
    store.transition(blocked, run, 'uncertain', { reason: 'CAPTCHA appeared' });
    store.transition(blocked, run, 'blocked', {
      reason: 'CAPTCHA prevented delivery',
      reconciliationReason: 'No write observed; visible CAPTCHA; page closed',
    });
    assert.equal(dailyUsage(store, policy.timezone, clock).occupied, 11);
    const replacement = store.claim(run, role(12), 'replacement-manifest');
    store.transition(replacement, run, 'filling');
    beginDailySubmit(store, replacement, run, policy, clock);
    store.transition(replacement, run, 'submitted', {
      receipt: { url: role(12).url, text: 'Application received', observedAt: clock.toISOString() },
    });
    assert.deepEqual(dailyUsage(store, policy.timezone, clock), {
      day: dailyUsage(store, policy.timezone, clock).day,
      confirmed: 12,
      occupied: 12,
      uncertain: 0,
    });
  } finally {
    store.close();
  }
});
test('daily cap includes manual/legacy submissions and uncertain delivery across fresh manifests', () => {
  const s = new EventStore(':memory:');
  try {
    for (let i = 0; i < 10; i++)
      s.importLedger([{ ...role(i), timestamp: now.toISOString(), status: 'submitted' }]);
    s.importLedger([{ ...role(0), timestamp: '2026-10-15T17:00:00Z', status: 'submitted' }]);
    const run = s.startRun();
    const a = s.claim(run, role(10), 'manifest-a');
    s.transition(a, run, 'filling');
    beginDailySubmit(s, a, run, policy, now);
    s.transition(a, run, 'uncertain', { reason: 'Timeout' });
    // Pin synthetic update time: native transitions use the actual clock.
    s.db.prepare('UPDATE applications SET updated_at=? WHERE id=?').run(now.toISOString(), a);
    const b = s.claim(run, role(11), 'manifest-b');
    s.transition(b, run, 'filling');
    beginDailySubmit(s, b, run, policy, now);
    assert.deepEqual(dailyUsage(s, policy.timezone, now), {
      day: '2026-10-15',
      confirmed: 10,
      occupied: 12,
      uncertain: 2,
    });
    const c = s.claim(run, role(12), 'manifest-c');
    s.transition(c, run, 'filling');
    assert.throws(() => beginDailySubmit(s, c, run, policy, now), /limit/);
    assert.equal(s.get(c).state, 'filling');
  } finally {
    s.close();
  }
});
test('daily counter follows New York midnight and DST, not UTC date', () => {
  const s = new EventStore(':memory:');
  try {
    s.importLedger([{ ...role(1), timestamp: '2026-10-15T02:00:00Z', status: 'submitted' }]);
    assert.equal(dailyUsage(s, policy.timezone, now).confirmed, 0);
    assert.equal(dailyUsage(s, policy.timezone, new Date('2026-10-15T02:30:00Z')).confirmed, 1);
    s.importLedger([
      { ...role(2), timestamp: '2026-11-01T05:30:00Z', status: 'submitted' },
      { ...role(3), timestamp: '2026-11-01T06:30:00Z', status: 'submitted' },
    ]);
    assert.equal(dailyUsage(s, policy.timezone, new Date('2026-11-01T08:00:00Z')).confirmed, 2);
  } finally {
    s.close();
  }
});
test('routine mapping uses confirmed facts, leaves optional demographics blank and blocks legal consent/unknown history', () => {
  const field = (value) => ({
    value,
    source: 'confirmed',
    confirmedAt: now.toISOString(),
    uses: ['application'],
  });
  const f = {
    version: 'test',
    fields: {
      fullName: field('Example Applicant'),
      authorizedToWorkText: field('Yes'),
      needsSponsorshipText: field('No'),
      workAuthorization: field('Lawful Permanent Resident (Green Card)'),
    },
  };
  const q = (key, label, extras = {}) => ({
    key,
    label,
    required: true,
    type: 'text',
    kind: 'fact',
    ...extras,
  });
  const plan = mapRoutineQuestions(
    [
      q('name', 'Name'),
      q('auth', 'Are you legally authorized to work in the United States?', {
        type: 'checkbox',
        options: ['Yes', 'No'],
      }),
      q('sponsor', 'Will you now or in the future require sponsorship?', {
        type: 'checkbox',
        options: ['Yes', 'No'],
      }),
      q('prior', 'Have you worked at Acme before?'),
      q('consent', 'I agree to binding arbitration', { kind: 'consent' }),
      q('gender', 'Gender', { required: false, options: ['Woman', 'Man', 'Decline to answer'] }),
      q('essay', 'Why are you interested in this company?', { type: 'textarea' }),
    ],
    role(1),
    f,
    policy,
    now,
  );
  assert.equal(plan.facts.fields[plan.answers.auth].value, 'Yes');
  assert.equal(plan.facts.fields[plan.answers.sponsor].value, 'No');
  assert.equal(plan.answers.gender, undefined);
  assert.deepEqual(
    plan.blocked.map((q) => q.key),
    ['prior', 'consent'],
  );
  assert.match(plan.facts.fields[plan.answers.essay].value, /React and Python/);
});
test('US remote requires actual remote metadata and US eligibility; Hybrid primary location alone is insufficient', () => {
  assert.equal(
    usRemote({
      locations: ['San Francisco', 'New York'],
      remoteMetadata: { isRemote: true, workplaceType: 'Hybrid' },
    }),
    false,
  );
  assert.equal(
    usRemote({ locations: ['Remote, United States'], remoteMetadata: { workplaceType: 'Remote' } }),
    true,
  );
  assert.equal(
    usRemote({
      locations: ['Remote, Germany'],
      remoteMetadata: { isRemote: true, workplaceType: 'Remote' },
    }),
    false,
  );
  assert.equal(
    usRemote({
      locations: ['Remote, United States'],
      description: 'We cannot hire from New York',
      remoteMetadata: { workplaceType: 'Remote' },
    }),
    false,
  );
  assert.equal(
    usRemote({
      locations: ['San Francisco'],
      remoteMetadata: {
        workplaceType: 'Hybrid',
        secondaryLocations: [
          { location: 'Remote', address: { postalAddress: { addressCountry: 'United States' } } },
        ],
      },
    }),
    true,
  );
});
test('US work authorization is never reused for Canada, including sponsorship questions', () => {
  const field = (value) => ({
    value,
    source: 'confirmed',
    confirmedAt: now.toISOString(),
    uses: ['application'],
  });
  const f = {
    version: 'test',
    fields: { authorizedToWorkText: field('Yes'), needsSponsorshipText: field('No') },
  };
  const qs = [
    {
      key: 'ca',
      label: 'Are you authorized to work in Canada?',
      required: true,
      type: 'checkbox',
      kind: 'fact',
      options: ['Yes', 'No'],
    },
    {
      key: 'visa',
      label: 'Will you require visa sponsorship in Canada?',
      required: true,
      type: 'checkbox',
      kind: 'fact',
      options: ['Yes', 'No'],
    },
  ];
  const mapped = mapRoutineQuestions(qs, role(1), f, policy, now);
  assert.deepEqual(mapped.answers, {});
  assert.equal(mapped.blocked.length, 2);
  const either = mapRoutineQuestions(
    [{ ...qs[0], label: 'Are you legally authorized to work in the United States or Canada?' }],
    role(1),
    f,
    policy,
    now,
  );
  assert.equal(either.facts.fields[either.answers.ca].value, 'Yes');
});
test('salary uses annual USD components; descriptive dollar ranges are not invented', () => {
  assert.deepEqual(
    postedSalary({
      compensation: {
        summaryComponents: [
          {
            compensationType: 'Salary',
            currencyCode: 'USD',
            interval: '1 YEAR',
            minValue: 120000,
            maxValue: 160000,
          },
        ],
      },
    }),
    { salaryMin: 120000, salaryMax: 160000 },
  );
  assert.deepEqual(postedSalary({ description: 'Equipment stipend $1,000 - $2,000' }), {
    salaryMin: null,
    salaryMax: null,
  });
  assert.deepEqual(postedSalary({ description: 'Annual US salary $110K – $180K' }), {
    salaryMin: 110000,
    salaryMax: 180000,
  });
  assert.deepEqual(postedSalary({ description: 'Canadian salary $110K – $180K CAD' }), {
    salaryMin: null,
    salaryMax: null,
  });
});
test('company research must corroborate both headcount bounds and a dated signal', async () => {
  const profile = {
    headcountMin: 51,
    headcountMax: 200,
    headcountSourceUrl: 'https://example.org/about',
    headcountExcerpt: 'Our company has 51 to 200 employees.',
    isHouseholdName: false,
    thrivingSignals: [
      {
        type: 'recent_funding_round',
        asOf: '2026-09-01',
        sourceUrl: 'https://example.org/news',
        excerpt: 'We raised a Series B to expand our product.',
      },
    ],
  };
  const fetcher = async () => ({
    ok: true,
    text: async () => profile.headcountExcerpt + ' ' + profile.thrivingSignals[0].excerpt,
  });
  const result = await verifyResearchedProfile({ company: 'Acme', profile }, { fetcher, now });
  assert.equal(result.verifiedAt, now.toISOString());
  await assert.rejects(
    verifyResearchedProfile(
      { company: 'Acme', profile: { ...profile, headcountMax: 100 } },
      { fetcher, now },
    ),
    /interval/,
  );
});
test('routine wording variants map only to confirmed facts and exact offered options', () => {
  const field = (value) => ({
    value,
    source: 'confirmed',
    confirmedAt: now.toISOString(),
    uses: ['application'],
  });
  const f = {
    version: 'test',
    fields: {
      firstName: field('Example'),
      lastName: field('Applicant'),
      homeCountry: field('United States'),
      homeState: field('NY'),
      currentCompany: field('Acme Labs'),
      securityClearance: field('None'),
    },
  };
  const yesNo = { type: 'select', options: ['Yes', 'No'] };
  const q = (key, label, extras = {}) => ({ key, label, required: true, type: 'text', ...extras });
  const plan = mapRoutineQuestions(
    [
      q('first', 'Legal First Name'),
      q('last', 'Legal Last Name'),
      q('company', 'What is your most recent company?'),
      q('hear', 'Where did you first hear about this role?', {
        type: 'select',
        options: ['LinkedIn', 'Careers Page', 'Referral'],
      }),
      q(
        'us',
        'Do you live in the U.S. or plan to live in the U.S. by the time you start working?',
        yesNo,
      ),
      q('americas', 'Are you located in either the Americas or Europe?', yesNo),
      q(
        'states',
        'Do you live in one of the following states? Alabama, Alaska, Delaware, Kansas, Maine, Mississippi, Montana, Nebraska, New Mexico, North Dakota, South Dakota, West Virginia, or Wyoming.',
        yesNo,
      ),
      q('clearanceStatus', 'What is your current U.S. security clearance status?', {
        type: 'select',
        options: ['None', 'Secret', 'Top Secret'],
      }),
      q('clearanceHeld', 'Do you currently hold an active security clearance?', yesNo),
      q('countries', 'Are you currently based in any of these countries?', {
        type: 'select',
        options: ['United States', 'Canada'],
      }),
      // Still blocked: no confirmed title, an unoffered clearance option, and consent.
      q('title', 'What is your most recent job title?'),
      q('clearanceOdd', 'What is your current security clearance status?', {
        type: 'select',
        options: ['No clearance', 'Secret'],
      }),
      q('privacy', 'I acknowledge the Job Applicant Privacy Notice', { type: 'checkbox' }),
    ],
    role(1),
    f,
    policy,
    now,
  );
  const value = (k) => plan.facts.fields[plan.answers[k]]?.value;
  assert.equal(value('first'), 'Example');
  assert.equal(value('last'), 'Applicant');
  assert.equal(value('company'), 'Acme Labs');
  assert.equal(value('hear'), 'Careers Page');
  assert.equal(value('us'), 'Yes');
  assert.equal(value('americas'), 'Yes');
  assert.equal(value('states'), 'No');
  assert.equal(value('clearanceStatus'), 'None');
  assert.equal(value('clearanceHeld'), 'No');
  assert.equal(value('countries'), 'United States');
  assert.deepEqual(
    plan.blocked.map((b) => b.key),
    ['title', 'clearanceOdd', 'privacy'],
  );
});

test('home state list answers need a real state list and a Yes/No choice', () => {
  const label = 'Do you live in one of the following states? New York, New Jersey, Ohio';
  assert.equal(homeStateListAnswer(label, 'NY', ['Yes', 'No']), 'Yes');
  assert.equal(homeStateListAnswer(label, 'PA', ['Yes', 'No']), 'No');
  assert.equal(homeStateListAnswer(label, 'NY', ['New York', 'Other']), null);
  assert.equal(
    homeStateListAnswer('Do you live in one of the following states?', 'NY', ['Yes', 'No']),
    null,
  );
  assert.equal(
    homeStateListAnswer('Do you reside in these states: West Virginia, Ohio, Utah', 'VA', [
      'Yes',
      'No',
    ]),
    'No',
  );
  assert.equal(
    homeStateListAnswer('Do you reside in these states: Virginia, West Virginia, Utah', 'VA', [
      'Yes',
      'No',
    ]),
    'Yes',
  );
  // A U.S.-states question is never answered by the plain US-residence rule.
  const plan = mapRoutineQuestions(
    [
      {
        key: 's',
        label: 'Do you live in one of the following U.S. states?',
        required: true,
        type: 'select',
        options: ['Yes', 'No'],
      },
    ],
    role(1),
    {
      version: 'test',
      fields: {
        homeCountry: {
          value: 'United States',
          source: 'c',
          confirmedAt: now.toISOString(),
          uses: ['application'],
        },
      },
    },
    policy,
    now,
  );
  assert.equal(plan.blocked.length, 1);
});

test('most recent job title maps only to a confirmed title fact', () => {
  const titleQuestion = [
    { key: 't', label: 'What is your most recent job title?', required: true, type: 'text' },
    { key: 'c', label: 'Current Job Title', required: true, type: 'text' },
  ];
  const field = (value) => ({
    value,
    source: 'confirmed',
    confirmedAt: now.toISOString(),
    uses: ['application'],
  });
  const without = mapRoutineQuestions(
    titleQuestion,
    role(1),
    { version: 't', fields: {} },
    policy,
    now,
  );
  assert.equal(without.blocked.length, 2);
  const withTitle = mapRoutineQuestions(
    titleQuestion,
    role(1),
    { version: 't', fields: { currentTitle: field('Software Consultant') } },
    policy,
    now,
  );
  assert.equal(withTitle.blocked.length, 0);
  assert.equal(withTitle.answers.t, 'currentTitle');
  assert.equal(withTitle.answers.c, 'currentTitle');
});

test('standing choices apply only when enabled, with one affirmative option, never to excluded terms', () => {
  const on = {
    standingChoices: {
      privacyNoticeAcknowledgment: true,
      accuracyConfirmation: true,
      interviewRecordingConsent: true,
    },
  };
  const q = (label, options) => ({ key: 'k', label, required: true, type: 'combobox', options });
  const privacy = q(
    'By submitting my application, I acknowledge that I have read and understand Vercel’s Job Applicant Privacy Notice',
    ['Acknowledge/Confirm'],
  );
  const accuracy = q(
    'Please double-check all the information provided above. Ensuring accuracy is crucial.',
    ['I have reviewed and confirmed that all the information provided is accurate and complete.'],
  );
  const recording = q('Interview Recording Consent', ['Yes', 'No']);
  assert.equal(standingChoiceAnswer(privacy, privacy.label, on).option, 'Acknowledge/Confirm');
  assert.match(standingChoiceAnswer(accuracy, accuracy.label, on).option, /reviewed and confirmed/);
  assert.equal(standingChoiceAnswer(recording, recording.label, on).option, 'Yes');
  assert.equal(
    standingChoiceAnswer(
      q('Do you consent to the use of an AI notetaker during your interviews?', ['Yes', 'No']),
      'Do you consent to the use of an AI notetaker during your interviews?',
      on,
    ).option,
    'Yes',
  );
  // Disabled, ambiguous, checkbox-only and excluded terms stay blocked.
  assert.equal(standingChoiceAnswer(privacy, privacy.label, {}), null);
  assert.equal(
    standingChoiceAnswer(q(privacy.label, ['Yes', 'Acknowledge']), privacy.label, on),
    null,
  );
  assert.equal(standingChoiceAnswer(q(privacy.label, []), privacy.label, on), null);
  const arbitration = 'I acknowledge the privacy notice and agree to binding arbitration';
  assert.equal(standingChoiceAnswer(q(arbitration, ['Yes']), arbitration, on), null);
  const marketing = 'I have read the privacy policy and want marketing emails';
  assert.equal(standingChoiceAnswer(q(marketing, ['Yes']), marketing, on), null);
  // A required question reaches the plan; an optional one is left empty.
  const plan = mapRoutineQuestions(
    [privacy, { ...recording, key: 'r' }],
    role(1),
    { version: 't', fields: {} },
    on,
    now,
  );
  assert.equal(plan.blocked.length, 0);
  // The fill step answers a consent-kind control only with a fact naming that consent.
  const filled = answerQuestions(
    [privacy, { ...recording, key: 'r', kind: 'consent' }],
    { ...role(1), answers: plan.answers },
    plan.facts,
  );
  assert.equal(filled.blocked.length, 0);
  assert.equal(filled.answers.r, 'Yes');
});

test('a citizenship-category question uses the confirmed permanent-resident status', () => {
  const pr = 'Lawful Permanent Resident (Green Card)';
  const yesNo = {
    label:
      'Are you a U.S. citizen, U.S. permanent resident (green card holder), or protected individual under 8 U.S.C. 1324b(a)(3)?',
    options: ['Yes', 'No'],
  };
  assert.equal(permanentResidentAnswer(yesNo, yesNo.label, pr), 'Yes');
  const categories = {
    label: 'What is your U.S. citizenship or permanent resident status?',
    options: [
      'U.S. Citizen',
      'U.S. Permanent Resident (Green Card)',
      'Not a citizen or permanent resident',
    ],
  };
  assert.equal(
    permanentResidentAnswer(categories, categories.label, pr),
    'U.S. Permanent Resident (Green Card)',
  );
  assert.equal(permanentResidentAnswer(yesNo, yesNo.label, 'U.S. Citizen'), null);
  assert.equal(permanentResidentAnswer(yesNo, 'Are you a U.S. citizen?', pr), null);
});

test('research targets rank employers by eligible roles, one entry each', () => {
  const roles = [
    { company: 'Hark', url: 'h1' },
    { company: 'Scale AI', url: 's1' },
    { company: 'Scale AI', url: 's2' },
    { company: 'scale ai', url: 's3' },
    { company: 'Etched', url: 'e1' },
    { company: 'Etched', url: 'e2' },
  ];
  assert.deepEqual(rankResearchTargets(roles, 2), [
    { company: 'Scale AI', url: 's1', roles: 3 },
    { company: 'Etched', url: 'e1', roles: 2 },
  ]);
  assert.deepEqual(rankResearchTargets([], 8), []);
});

test('"how you heard about our company" uses the same truthful source answer', () => {
  const plan = mapRoutineQuestions(
    [
      {
        key: 'cards[x][field0]',
        label:
          'We like to know where great talent comes from. Please select the option that best applies to how you heard about our company or this opportunity.',
        required: true,
        type: 'radio',
        options: ['LinkedIn', 'Referral', 'Other'],
      },
    ],
    role(1),
    { version: 't', fields: {} },
    policy,
    now,
  );
  assert.equal(plan.blocked.length, 0);
  assert.equal(plan.facts.fields[plan.answers['cards[x][field0]']].value, 'Other');
});

test('a team stated as "around 70 people" counts as a headcount excerpt', async () => {
  const page = '<p>Over the past several months, our team has grown to around 70 people.</p>';
  const signal =
    '<p>We have raised over $700 million in Series A funding at a $6 billion valuation.</p>';
  const fetcher = async (url) =>
    new Response(url.endsWith('/team') ? page : signal, {
      headers: { 'content-type': 'text/html' },
    });
  const item = {
    company: 'Hark',
    profile: {
      headcountMin: 70,
      headcountMax: 70,
      headcountSourceUrl: 'https://example.org/team',
      headcountExcerpt: 'Over the past several months, our team has grown to around 70 people.',
      isHouseholdName: false,
      thrivingSignals: [
        {
          type: 'recent_funding_round',
          asOf: '2026-05-20',
          sourceUrl: 'https://example.org/funding',
          excerpt: 'We have raised over $700 million in Series A funding',
        },
      ],
    },
  };
  const verified = await verifyResearchedProfile(item, { fetcher, now });
  assert.equal(verified.company, 'Hark');
});
