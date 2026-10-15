import test from 'node:test';
import assert from 'node:assert/strict';
import { EventStore } from '../lib/event-store.mjs';
import { dailyUsage, beginDailySubmit, mapRoutineQuestions } from '../lib/daily-policy.mjs';
import { postedSalary, usRemote, verifyResearchedProfile } from '../lib/daily-discovery.mjs';
const now = new Date('2026-10-15T16:00:00Z'),
  policy = {
    dailyLimit: 10,
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
test('daily cap includes manual/legacy submissions and uncertain delivery across fresh manifests', () => {
  const s = new EventStore(':memory:');
  try {
    for (let i = 0; i < 8; i++)
      s.importLedger([{ ...role(i), timestamp: now.toISOString(), status: 'submitted' }]);
    s.importLedger([{ ...role(0), timestamp: '2026-10-15T17:00:00Z', status: 'submitted' }]);
    const run = s.startRun();
    const a = s.claim(run, role(8), 'manifest-a');
    s.transition(a, run, 'filling');
    beginDailySubmit(s, a, run, policy, now);
    s.transition(a, run, 'uncertain', { reason: 'Timeout' });
    // Pin synthetic update time: native transitions use the actual clock.
    s.db.prepare('UPDATE applications SET updated_at=? WHERE id=?').run(now.toISOString(), a);
    const b = s.claim(run, role(9), 'manifest-b');
    s.transition(b, run, 'filling');
    beginDailySubmit(s, b, run, policy, now);
    assert.deepEqual(dailyUsage(s, policy.timezone, now), {
      day: '2026-10-15',
      confirmed: 8,
      occupied: 10,
      uncertain: 2,
    });
    const c = s.claim(run, role(10), 'manifest-c');
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
