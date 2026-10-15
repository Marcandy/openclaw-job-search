import test from 'node:test';
import assert from 'node:assert/strict';
import { runReplacementQueue } from '../lib/replacement-queue.mjs';

test('replaces CAPTCHA and unsupported roles, replenishing until ten confirmations', async () => {
  let roles = Array.from({ length: 5 }, (_, i) => ({ url: `role-${i}` }));
  const outcomes = new Map();
  let researchBatches = 0;
  let confirmed = 0;
  const result = await runReplacementQueue({
    candidates: () => roles,
    replenish: async () => {
      researchBatches++;
      roles = [...roles, ...Array.from({ length: 10 }, (_, i) => ({ url: `new-${i}` }))];
      return true;
    },
    attempt: async (role) => {
      assert.equal(outcomes.has(role.url), false, 'never retry a failed destination');
      const outcome =
        role.url === 'role-0' ? 'captcha' : role.url === 'role-1' ? 'unsupported' : 'submitted';
      outcomes.set(role.url, outcome);
      if (outcome === 'submitted') confirmed++;
    },
    shouldStop: () => confirmed >= 10 && 'target_met',
  });
  assert.equal(confirmed, 10);
  assert.equal(researchBatches, 1);
  assert.deepEqual(result, { stopReason: 'target_met', attempted: 12 });
});

test('records exhausted supply and never repeats previously skipped roles', async () => {
  let attempts = 0;
  const result = await runReplacementQueue({
    candidates: () => [{ url: 'blocked' }],
    replenish: async () => false,
    attempt: async () => {
      attempts++;
    },
    shouldStop: () => false,
  });
  assert.equal(attempts, 1);
  assert.equal(result.stopReason, 'eligible_pool_exhausted');
});

test('honors time bounds and holds possible deliveries instead of exceeding the cap', async () => {
  let occupied = 9;
  const result = await runReplacementQueue({
    candidates: () => [{ url: 'ambiguous' }, { url: 'replacement' }],
    replenish: async () => {
      throw Error('unexpected research');
    },
    attempt: async () => {
      occupied++;
    },
    shouldStop: () => occupied >= 10 && 'daily_capacity_reached',
  });
  assert.equal(result.attempted, 1);
  assert.equal(result.stopReason, 'daily_capacity_reached');
  const timed = await runReplacementQueue({
    candidates: () => {
      throw Error('budget exhausted');
    },
    replenish: async () => false,
    attempt: async () => {},
    shouldStop: () => 'run_time_limit',
  });
  assert.equal(timed.attempted, 0);
});
