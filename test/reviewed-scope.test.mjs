import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewedPostingDigest,
  reviewedScopeAllows,
  requireReviewedPosting,
  validateReviewedScope,
} from '../lib/reviewed-scope.mjs';
const role = {
  url: 'https://jobs.ashbyhq.com/example/00000000-0000-0000-0000-000000000001',
  title: 'Software Engineer',
  description: 'Build React and Python applications.',
};
const entry = {
  url: role.url,
  postingDigest: reviewedPostingDigest(role),
  reviewedAt: '2026-10-30T14:00:00Z',
  reason: 'Reviewed exact duties and mandatory skills against approved applicant evidence.',
};
const policy = {
  batch: {
    scopeDigest: 'sealed elsewhere by the authorization validator',
    reviewedCandidates: [entry],
  },
};
test('a reviewed batch allows only the selected underlying requisition', () => {
  validateReviewedScope(policy);
  assert.equal(reviewedScopeAllows(role, policy), true);
  assert.equal(reviewedScopeAllows({ ...role, url: role.url.replace(/1$/, '2') }, policy), false);
  assert.equal(reviewedScopeAllows(role, {}), true);
  assert.throws(
    () => requireReviewedPosting({ ...role, url: role.url.replace(/1$/, '2') }, policy),
    /outside the reviewed scope/,
  );
});
test('new requirements cannot reuse the prior review before resume upload', () => {
  requireReviewedPosting(role, policy);
  requireReviewedPosting(
    { ...role, description: 'Build React and Python   applications.' },
    policy,
  );
  assert.throws(
    () =>
      requireReviewedPosting(
        {
          ...role,
          description: role.description + ' Must have React Native production experience.',
        },
        policy,
      ),
    /changed since review/,
  );
  assert.throws(
    () => requireReviewedPosting({ ...role, title: 'Mobile Engineer' }, policy),
    /changed since review/,
  );
});
test('empty, duplicate, unsealed or malformed reviewed scopes refuse authorization', () => {
  for (const list of [
    [],
    [entry, entry],
    [{ ...entry, postingDigest: 'bad' }],
    [{ ...entry, url: 'https://untrusted.example/jobs/1' }],
  ])
    assert.throws(() =>
      validateReviewedScope({ batch: { scopeDigest: 'sealed', reviewedCandidates: list } }),
    );
  assert.throws(
    () => validateReviewedScope({ batch: { reviewedCandidates: [entry] } }),
    /sealed batch/,
  );
});

test('reviewed discovery reads exact jobs without a full-board scan or cache deletion', async () => {
  const { discoverDaily } = await import('../lib/daily-discovery.mjs');
  const { EventStore } = await import('../lib/event-store.mjs');
  const { cacheBoard } = await import('../lib/board-discovery.mjs');
  const { readJson } = await import('../lib/runtime.mjs');
  const config = readJson(new URL('../campaign.config.json', import.meta.url));
  const store = new EventStore(':memory:');
  const board = { platform: 'greenhouse', slug: 'example', company: 'Example' };
  const url = 'https://job-boards.greenhouse.io/example/jobs/123';
  try {
    cacheBoard(store, board, [
      {
        postingId: 'greenhouse:example:999',
        url: 'https://job-boards.greenhouse.io/example/jobs/999',
        title: 'Other role',
      },
    ]);
    const calls = [];
    const fetcher = async (endpoint) => {
      calls.push(endpoint);
      if (!endpoint.includes('/jobs/123?')) throw Error('Unexpected full-board read');
      return {
        ok: true,
        json: async () => ({
          id: 123,
          title: 'Software Engineer',
          absolute_url: url,
          location: { name: 'Chicago, IL' },
          first_published: new Date().toISOString(),
          content: 'Build React TypeScript software and Python APIs using PostgreSQL and AWS.',
        }),
      };
    };
    const result = await discoverDaily(
      store,
      config,
      { boards: [board] },
      { fetcher, reviewedRetryPolicy: { batch: { reviewedCandidates: [{ url }] } } },
    );
    assert.equal(result.candidates.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(
      store.db.prepare('select active from postings where id=?').get('greenhouse:example:999')
        .active,
      1,
    );
  } finally {
    store.close();
  }
});
