import test from 'node:test';
import assert from 'node:assert/strict';
import { EventStore } from '../lib/event-store.mjs';
import { blockedRetryEvidence, approvedBlockedRetry } from '../lib/reviewed-retry.mjs';
const record = {
  url: 'https://jobs.lever.co/example/00000000-0000-0000-0000-000000000001',
  company: 'Example',
  title: 'Software Engineer',
};
function fixture() {
  const s = new EventStore(':memory:');
  const run = s.startRun();
  const id = s.claim(run, record, 'hash');
  s.transition(id, run, 'filling');
  return { s, run, id };
}
test('a sealed reviewed retry admits only the unchanged pre-submit block once', () => {
  const { s, run, id } = fixture();
  try {
    s.transition(id, run, 'blocked', { reason: 'Lever checkbox label mismatch' });
    s.finishRun(run, 'known pre-submit block');
    const entry = {
      url: record.url,
      ...blockedRetryEvidence(s, record.url),
      reason: 'Exact-label checkbox binding is fixed and verified before retry.',
      reviewedAt: new Date().toISOString(),
    };
    const policy = { batch: { reviewedBlockedRetries: [entry] } };
    assert.equal(approvedBlockedRetry(s, record, {}), null);
    assert.equal(approvedBlockedRetry(s, record, policy), entry);
    assert.equal(
      approvedBlockedRetry(s, record, { batch: { reviewedBlockedRetries: [entry, entry] } }),
      null,
    );
    assert.equal(
      approvedBlockedRetry(s, record, {
        batch: { reviewedBlockedRetries: [{ ...entry, blockedEventHash: 'changed' }] },
      }),
      null,
    );
    assert.equal(
      approvedBlockedRetry(s, record, {
        batch: { reviewedBlockedRetries: [{ ...entry, reason: '' }] },
      }),
      null,
    );
    const next = s.startRun();
    s.claim(next, record, 'newhash', { retryBlocked: true, retryReason: entry.reason });
    assert.equal(approvedBlockedRetry(s, record, policy), null);
  } finally {
    s.close();
  }
});
test('delivery attempts and reconciled uncertainty can never enter the automatic retry path', () => {
  const { s, run, id } = fixture();
  try {
    s.transition(id, run, 'submit_started');
    s.transition(id, run, 'uncertain', { reason: 'No receipt' });
    assert.throws(() => blockedRetryEvidence(s, record.url), /native blocked/);
    s.transition(id, run, 'blocked', {
      reason: 'Manual non-delivery reconciliation',
      reconciliationReason: 'Reviewed external evidence',
    });
    assert.throws(() => blockedRetryEvidence(s, record.url), /prior delivery attempt/);
  } finally {
    s.close();
  }
});

test('discovery preserves the duplicate gate except for the exact sealed pre-submit retry', async () => {
  const { discoverDaily } = await import('../lib/daily-discovery.mjs');
  const { readJson } = await import('../lib/runtime.mjs');
  const config = readJson(new URL('../campaign.config.json', import.meta.url));
  const s = new EventStore(':memory:');
  const run = s.startRun();
  const role = {
    company: 'Example',
    title: 'Software Engineer',
    url: 'https://job-boards.greenhouse.io/example/jobs/123',
  };
  const id = s.claim(run, role, 'h');
  s.transition(id, run, 'filling');
  s.transition(id, run, 'blocked', { reason: 'Verified field binding failure before submit' });
  s.finishRun(run, 'not delivered');
  const policy = {
    batch: {
      reviewedBlockedRetries: [
        {
          url: role.url,
          ...blockedRetryEvidence(s, role.url),
          reason: 'Reviewed exact binding fix; previous attempt never reached final submission.',
          reviewedAt: new Date().toISOString(),
        },
      ],
    },
  };
  const registry = { boards: [{ platform: 'greenhouse', slug: 'example', company: 'Example' }] };
  const fetcher = async () => ({
    ok: true,
    json: async () => ({
      jobs: [
        {
          id: 123,
          title: role.title,
          absolute_url: role.url,
          location: { name: 'Chicago, IL' },
          first_published: new Date().toISOString(),
          content: 'Build React and TypeScript software and Python APIs using PostgreSQL and AWS.',
        },
      ],
    }),
  });
  try {
    assert.equal((await discoverDaily(s, config, registry, { fetcher })).candidates.length, 0);
    assert.equal(
      (await discoverDaily(s, config, registry, { fetcher, reviewedRetryPolicy: policy }))
        .candidates.length,
      1,
    );
  } finally {
    s.close();
  }
});
