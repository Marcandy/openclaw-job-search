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
