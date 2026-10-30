import test from 'node:test';
import assert from 'node:assert/strict';
import { EventStore } from '../lib/event-store.mjs';
import { fetchBoard, cacheBoard, boardEndpoint } from '../lib/board-discovery.mjs';
const b = { platform: 'greenhouse', slug: 'acme', company: 'Acme' };
test('seven unchanged daily board snapshots do not repeat enrichment; changes and removals are tracked', async () => {
  const s = new EventStore(':memory:');
  try {
    const job = {
      id: 1,
      title: 'Software Engineer',
      location: { name: 'Chicago, IL' },
      absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/1',
      content: '<p>Build React APIs</p>',
    };
    const jobs = await fetchBoard(b, async () => ({
      ok: true,
      json: async () => ({ jobs: [job] }),
    }));
    let enrichments = 0;
    for (let day = 0; day < 7; day++)
      enrichments += cacheBoard(s, b, jobs, `2026-10-${12 + day}T00:00:00Z`).changed.length;
    assert.equal(enrichments, 1);
    assert.equal(
      cacheBoard(s, b, [{ ...jobs[0], description: 'Build Java APIs' }]).changed.length,
      1,
    );
    cacheBoard(s, b, []);
    assert.equal(s.db.prepare('SELECT active FROM postings').get().active, 0);
  } finally {
    s.close();
  }
});
test('malformed board failures and untrusted slugs do not become postings', async () => {
  assert.throws(() => boardEndpoint({ ...b, slug: '../../internal' }), /Invalid/);
  await assert.rejects(
    () => fetchBoard(b, async () => ({ ok: true, json: async () => ({ notJobs: [] }) })),
    /Unexpected/,
  );
});
test('Lever pagination fetches all pages rather than interpreting a partial board as deletions', async () => {
  const calls = [];
  const board = { ...b, platform: 'lever' };
  const jobs = await fetchBoard(board, async (url) => {
    calls.push(url);
    return {
      ok: true,
      json: async () =>
        calls.length === 1
          ? Array.from({ length: 100 }, (_, i) => ({
              id: i + 1,
              text: 'Engineer',
              hostedUrl: `https://jobs.lever.co/acme/${i + 1}`,
              categories: { location: 'Chicago' },
            }))
          : [],
    };
  });
  assert.equal(jobs.length, 100);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /skip=100/);
});

test('a Greenhouse posting is dated by first_published, never by updated_at', async () => {
  const { normalizePosting } = await import('../lib/board-discovery.mjs');
  const posting = normalizePosting(
    { platform: 'greenhouse', slug: 'acme', company: 'Acme' },
    {
      id: 1,
      title: 'Software Engineer',
      absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/1',
      location: { name: 'Chicago, IL' },
      first_published: '2026-08-19T12:29:00-04:00',
      updated_at: '2026-10-16T17:13:47-04:00',
    },
  );
  assert.equal(posting.postedDate, '2026-08-19T12:29:00-04:00');
});

test('Lever creation time is retained without being advertised as publication', async () => {
  const { normalizePosting } = await import('../lib/board-discovery.mjs');
  const job = normalizePosting(
    { platform: 'lever', slug: 'example', company: 'Example' },
    {
      id: '123',
      text: 'Software Engineer',
      hostedUrl: 'https://jobs.lever.co/example/123',
      createdAt: Date.parse('2026-10-20T12:00:00Z'),
      categories: { location: 'Chicago, IL' },
    },
  );
  assert.equal(job.postedDate, null);
  assert.equal(job.createdAt, '2026-10-20T12:00:00.000Z');
  assert.equal(job.dateEvidence, 'undated');
});

test('a custom URL already held cannot reenter through the new hosted application route', async () => {
  const { discoverDaily } = await import('../lib/daily-discovery.mjs');
  const { readJson } = await import('../lib/runtime.mjs');
  const config = readJson(new URL('../campaign.config.json', import.meta.url));
  const store = new EventStore(':memory:');
  const source = 'https://seatgeek.com/jobs/123?gh_jid=123';
  try {
    store.importLedger([
      {
        timestamp: '2026-10-20T12:00:00Z',
        company: 'SeatGeek',
        title: 'Old title',
        location: 'Chicago, IL',
        url: source,
        status: 'submitted',
      },
    ]);
    const result = await discoverDaily(
      store,
      config,
      { boards: [{ platform: 'greenhouse', slug: 'seatgeek', company: 'SeatGeek' }] },
      {
        fetcher: async () => ({
          ok: true,
          json: async () => ({
            jobs: [
              {
                id: 123,
                title: 'Software Engineer II',
                location: { name: 'Chicago, IL' },
                absolute_url: source,
                content: 'Build React software and APIs.',
                first_published: new Date().toISOString(),
              },
            ],
          }),
        }),
      },
    );
    assert.equal(result.candidates.length, 0);
  } finally {
    store.close();
  }
});
