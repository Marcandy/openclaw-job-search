import test from 'node:test';
import assert from 'node:assert/strict';
import { blockedFields, bump, questionKey, rankFactGaps } from '../lib/run-insights.mjs';

const blocked = (company, ...labels) => ({
  company,
  status: 'skipped',
  reason:
    'Required fields blocked: ' +
    JSON.stringify(
      labels.map((label) => ({ key: label, label, reason: 'unknown_fact_or_control' })),
    ),
});

test('blocked fields come from the structured list or the saved reason text', () => {
  assert.deepEqual(blockedFields({ blocked: [{ label: 'A' }] }), [{ label: 'A' }]);
  assert.equal(blockedFields(blocked('Acme', 'Title')).length, 1);
  assert.deepEqual(blockedFields({ reason: 'Ambiguous live field keys' }), []);
  assert.deepEqual(blockedFields({ reason: 'Required fields blocked: not json' }), []);
});

test('the same question at different employers is one gap', () => {
  assert.equal(
    questionKey('How did you hear about Temporal?', 'Temporal'),
    questionKey('How did you hear about Vercel?', 'Vercel'),
  );
  assert.equal(questionKey("Why Vercel's platform?", 'Vercel'), 'why <employer> platform?');
});

test('fact gaps rank by the number of roles each question blocked', () => {
  const gaps = rankFactGaps([
    blocked('Vercel', 'Where did you first hear about this role?', 'Most recent title'),
    blocked('Vercel', 'Where did you first hear about this role?'),
    blocked('Temporal', 'Most recent title', 'Most recent title'),
    { company: 'PermitFlow', status: 'skipped', reason: 'Ambiguous live field keys' },
    { company: 'Runpod', status: 'submitted' },
  ]);
  assert.deepEqual(
    gaps.map((g) => [g.question, g.roles, g.employers]),
    [
      ['Most recent title', 2, ['Temporal', 'Vercel']],
      ['Where did you first hear about this role?', 2, ['Vercel']],
    ],
  );
  assert.equal(rankFactGaps([], { limit: 3 }).length, 0);
});

test('bump counts keys from zero', () => {
  assert.deepEqual(bump(bump({}, 'a'), 'a', 2), { a: 3 });
});
