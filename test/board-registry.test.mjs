import test from 'node:test';
import assert from 'node:assert/strict';
import { auditRegistry } from '../lib/board-registry.mjs';
import { boardEndpoint, fetchBoard } from '../lib/board-discovery.mjs';

test('real Ashby slug punctuation and encoded spaces pass without allowing path traversal', () => {
  const board = { platform: 'ashby', company: 'Example' };
  assert.match(boardEndpoint({ ...board, slug: 'happyrobot.ai' }), /happyrobot\.ai/);
  assert.match(boardEndpoint({ ...board, slug: 'flock%20safety' }), /flock%20safety/);
  for (const slug of ['../private', '%2e%2e%2fprivate', 'x?query=y', 'https://elsewhere.test']) {
    assert.throws(() => boardEndpoint({ ...board, slug }), /Invalid/);
  }
});

test('registry audit quarantines missing boards, preserves temporary failures, and reactivates healthy boards', async () => {
  const registry = {
    boards: ['missing', 'overloaded', 'active'].map((slug) => ({
      platform: 'ashby',
      slug,
      company: slug,
      disabled: slug === 'active',
    })),
  };
  const result = await auditRegistry(registry, {
    fetcher: async (url) => ({
      ok: url.includes('/active?'),
      status: url.includes('/missing?') ? 404 : 503,
      json: async () => ({ jobs: [] }),
    }),
  });
  assert.equal(result.registry.boards[0].disabled, true);
  assert.equal(result.registry.boards[1].disabled, false);
  assert.equal(result.registry.boards[2].disabled, false);
  assert.equal(registry.boards[2].disabled, true, 'input is never mutated');
});

test('Lever includes requirement lists, annual salary and remote metadata', async () => {
  const jobs = await fetchBoard(
    { platform: 'lever', slug: 'example', company: 'Example' },
    async () => ({
      ok: true,
      json: async () => [
        {
          id: 'job',
          text: 'Engineer',
          hostedUrl: 'https://jobs.lever.co/example/job',
          categories: { location: 'United States' },
          workplaceType: 'remote',
          descriptionPlain: 'Build software.',
          lists: [{ text: 'Requirements', content: '<li>Five years of C++ required</li>' }],
          salaryRange: { currency: 'USD', interval: 'per-year-salary', min: 120000, max: 160000 },
        },
      ],
    }),
  );
  assert.match(jobs[0].description, /C\+\+ required/);
  assert.equal(jobs[0].remoteMetadata.workplaceType, 'Remote');
  assert.equal(jobs[0].compensation.summaryComponents[0].minValue, 120000);
});
