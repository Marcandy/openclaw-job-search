import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { qualifyRole, checkActualLocation, rankRole } from '../lib/role-qualification.mjs';
import { officialApplicationUrl } from '../lib/official-destination.mjs';
import { campaignDeadline, requireTime, batchProgress } from '../lib/run-budget.mjs';
import { EventStore } from '../lib/event-store.mjs';
import { rememberPreflightFailure, rememberedPreflightFailure } from '../lib/preflight-memory.mjs';
import { isConsentQuestion } from '../lib/question-semantics.mjs';
import { checkExperience, checkTitle } from '../lib/role-filter.mjs';
import { mapRoutineQuestions } from '../lib/daily-policy.mjs';
const config = JSON.parse(readFileSync(new URL('../campaign.config.json', import.meta.url)));

test('spacecraft harness duties fail before upload; software at the same employer can qualify', () => {
  const harness = qualifyRole(
    {
      title: 'Harness Engineer I',
      description:
        'Create 3D harness routes and electro-mechanical assemblies. Experience with SolidWorks. Ability to maintain or obtain TS//SCI clearance.',
    },
    config,
  );
  assert.equal(harness.ok, false);
  assert.ok(harness.evidence.some((e) => e.kind === 'duties'));
  assert.equal(
    qualifyRole(
      {
        title: 'Senior Frontend Engineer',
        description: 'Build web applications with React and TypeScript for spacecraft operations.',
      },
      config,
    ).ok,
    true,
  );
});

test('generic platform titles need duties, not just engineer', () => {
  assert.equal(qualifyRole({ title: 'Platform Engineer' }, config).ok, false);
  assert.equal(
    qualifyRole(
      { title: 'Platform Engineer', description: 'Build backend APIs with Java and PostgreSQL.' },
      config,
    ).ok,
    true,
  );
  assert.equal(
    qualifyRole(
      { title: 'Developer Programs Lead', description: 'Organize community events.' },
      config,
    ).ok,
    false,
  );
});

test('mandatory specialty differs from preferred and alternative frameworks', () => {
  for (const text of [
    'Professional production experience with Vue.js.',
    'Must have Salesforce Marketing Cloud expertise.',
  ])
    assert.equal(
      qualifyRole({ title: 'Software Engineer', description: text }, config).ok,
      false,
      text,
    );
  for (const text of [
    'Vue.js preferred.',
    'Experience with Angular or React.',
    'Build software with Python. No Vue experience is required.',
  ])
    assert.equal(
      qualifyRole({ title: 'Software Engineer', description: text }, config).ok,
      true,
      text,
    );
});

test('board city is not sufficient when actual onsite location disagrees', () => {
  const denver = { label: 'Denver, CO', acceptedLocationAliases: ['Denver, CO'] };
  assert.equal(
    checkActualLocation(
      {
        description:
          'Work Location—this role is onsite at our Long Beach, CA or Centennial, CO locations.',
      },
      denver,
    ).ok,
    false,
  );
  assert.equal(
    checkActualLocation({ description: 'Work Location: onsite in Denver, CO.' }, denver).ok,
    true,
  );
});

test('custom employer URLs resolve from the trusted Greenhouse identity; aliases cannot swap IDs', () => {
  const board = { platform: 'greenhouse', slug: 'seatgeek' };
  assert.equal(
    officialApplicationUrl(board, '8332432', 'https://seatgeek.com/jobs/8332432?gh_jid=8332432'),
    'https://job-boards.greenhouse.io/embed/job_app?for=seatgeek&token=8332432',
  );
  assert.throws(
    () => officialApplicationUrl(board, '2', 'https://job-boards.greenhouse.io/other/jobs/2'),
    /mismatch/,
  );
  assert.throws(() => officialApplicationUrl(board, '../2', 'https://seatgeek.com'), /ID/);
  assert.throws(
    () => officialApplicationUrl(board, '2', 'https://user:password@seatgeek.com'),
    /URL/,
  );
});

test('dated authorization ends at New York midnight including DST dates', () => {
  const p = { timezone: 'America/New_York', campaignDate: '2026-10-29' };
  const expiry = campaignDeadline(p, new Date('2026-10-30T03:45:00Z'));
  assert.equal(new Date(expiry).toISOString(), '2026-10-30T04:00:00.000Z');
  assert.throws(() => requireTime(expiry, 0, expiry), /time/);
  assert.equal(
    new Date(
      campaignDeadline({ ...p, campaignDate: '2026-11-01' }, new Date('2026-11-01T04:00:00Z')),
    ).toISOString(),
    '2026-11-02T05:00:00.000Z',
  );
});

test('a batch counts only its own distinct receipts across day boundaries and holds uncertainty', () => {
  const progress = batchProgress(
    [
      { url: 'a', status: 'submitted' },
      { url: 'a', status: 'submitted' },
      { url: 'b', status: 'uncertain' },
      { url: 'c', status: 'skipped' },
    ],
    15,
  );
  assert.deepEqual(progress, {
    requested: 15,
    confirmed: 1,
    held: 1,
    remaining: 14,
    remainingCapacity: 13,
  });
});

test('preflight failures expire and invalidate on facts, adapter or form changes without releasing claims', () => {
  const store = new EventStore(':memory:');
  const role = {
    url: 'https://jobs.ashbyhq.com/example/abc',
    title: 'Software Engineer',
    description: 'Build APIs',
  };
  const identity = { factsHash: 'facts1', sourceDigest: 'adapter1' };
  const at = new Date('2026-10-30T04:00:00Z');
  try {
    rememberPreflightFailure(store, role, identity, 'unfillable control', at);
    assert.ok(rememberedPreflightFailure(store, role, identity, at));
    assert.equal(
      rememberedPreflightFailure(store, role, { ...identity, factsHash: 'facts2' }, at),
      null,
    );
    assert.equal(
      rememberedPreflightFailure(
        store,
        { ...role, description: 'Changed form/posting' },
        identity,
        at,
      ),
      null,
    );
    assert.equal(
      rememberedPreflightFailure(store, role, identity, new Date('2026-11-07T04:00:00Z')),
      null,
    );
    assert.equal(store.status().applications.length, 0);
    const run = store.startRun();
    const id = store.claim(run, role, 'manifest');
    store.transition(id, run, 'filling');
    store.transition(id, run, 'submit_started');
    store.transition(id, run, 'uncertain', { reason: 'Unknown receipt' });
    assert.throws(
      () =>
        store.claim(run, role, 'new-manifest', {
          retryBlocked: true,
          retryReason: 'adapter fixed',
        }),
      /uncertain/,
    );
    assert.equal(store.get(id).state, 'uncertain');
  } finally {
    store.close();
  }
});

test('technical consent discussion is distinct from a permission request', () => {
  assert.equal(
    isConsentQuestion({
      type: 'textarea',
      label: 'Describe how you configured segmentation and consent in a CDP.',
    }),
    false,
  );
  assert.equal(
    isConsentQuestion({
      type: 'textarea',
      label: 'Describe your experience. Do you consent to recording?',
    }),
    true,
  );
  assert.equal(isConsentQuestion({ type: 'checkbox', kind: 'consent', label: 'Agree' }), true);
});

test('state mapping uses a confirmed exact offered option and leaves employer history unknown', () => {
  const facts = { fields: { homeState: { value: 'New York', uses: ['application'] } } };
  const plan = mapRoutineQuestions(
    [
      {
        key: 'state',
        required: true,
        type: 'select',
        label: 'Which U.S. State or Canadian Province do you reside in?',
        options: ['New York', 'California'],
      },
      {
        key: 'history',
        required: true,
        type: 'select',
        label: 'Have you previously been employed at Affirm?',
        options: ['Yes', 'No'],
      },
    ],
    { company: 'Affirm', url: 'https://example.test/job' },
    facts,
    {},
  );
  assert.equal(plan.facts.fields[plan.answers.state].value, 'New York');
  assert.deepEqual(
    plan.blocked.map((x) => x.key),
    ['history'],
  );
});

test('current targeting keeps Staff/Manager/Director bans without the superseded senior/year cutoff', () => {
  for (const title of ['Staff Software Engineer', 'Engineering Manager', 'Director of Engineering'])
    assert.equal(checkTitle(title, config).ok, false);
  for (const title of [
    'Senior Software Engineer',
    'Principal Software Engineer',
    'Lead Software Engineer',
  ])
    assert.equal(checkTitle(title, config).ok, true);
  for (const years of [2, 5, 10, 15, 99])
    assert.equal(checkExperience(`${years}+ years of experience required`, config).ok, true);
  const ranking = rankRole(
    { title: 'Frontend Engineer', description: 'React and TypeScript' },
    config,
  );
  assert.deepEqual(ranking.reasons.matchedSkills, ['react', 'typescript']);
  assert.equal(ranking.kind, 'heuristic_not_probability');
});

test('currently living in the U.S. is answered from confirmed home country', () => {
  const plan = mapRoutineQuestions(
    [
      {
        key: 'resident',
        label: 'Are you currently living in the United States?',
        required: true,
        type: 'select',
        options: ['Yes', 'No'],
      },
    ],
    { company: 'Example', url: 'https://example.test/job' },
    { fields: { homeCountry: { value: 'United States', uses: ['application'] } } },
    {},
  );
  assert.equal(plan.blocked.length, 0);
  assert.equal(plan.facts.fields[plan.answers.resident].value, 'Yes');
});
