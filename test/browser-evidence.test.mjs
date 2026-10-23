import test from 'node:test';
import assert from 'node:assert/strict';
import { EventStore } from '../lib/event-store.mjs';
import { readEvidenceSource, corroborateExcerpt } from '../lib/source-documents.mjs';
import { verifyResearchedProfile } from '../lib/daily-discovery.mjs';

const now = new Date('2026-10-22T16:00:00Z');
const fakeBrowser = (pages) => {
  const reads = [];
  return {
    reads,
    async read(url) {
      reads.push(url);
      if (!(url in pages)) throw Error('Evidence HTTP 404 (browser)');
      return { url, html: `<html><body>${pages[url]}</body></html>`, text: pages[url] };
    },
  };
};

test('a site that refuses plain requests is read through the browser and cached', async () => {
  const store = new EventStore(':memory:');
  const browser = fakeBrowser({ 'https://example.org/about': 'Acme has about 350 employees.' });
  let fetches = 0;
  const fetcher = async () => (fetches++, new Response('Forbidden', { status: 403 }));
  try {
    const first = await readEvidenceSource('https://example.org/about', {
      store,
      fetcher,
      now,
      browser,
    });
    assert.equal(first.renderedBy, 'browser');
    assert.ok(corroborateExcerpt(first, 'Acme has about 350 employees.'));
    const again = await readEvidenceSource('https://example.org/about', {
      store,
      fetcher,
      now,
      browser,
    });
    assert.equal(again.cached, true);
    assert.equal(fetches, 1);
    assert.equal(browser.reads.length, 1);
  } finally {
    store.close();
  }
});

test('without a browser a refusal still fails, and other errors never use the browser', async () => {
  await assert.rejects(
    readEvidenceSource('https://example.org/a', {
      fetcher: async () => new Response('', { status: 403 }),
      now,
    }),
    /Evidence HTTP 403/,
  );
  const browser = fakeBrowser({});
  await assert.rejects(
    readEvidenceSource('https://example.org/a', {
      fetcher: async () => new Response('', { status: 404 }),
      now,
      browser,
    }),
    /Evidence HTTP 404/,
  );
  assert.equal(browser.reads.length, 0);
});

test('an excerpt missing from raw HTML is checked once more against the rendered page', async () => {
  const profile = {
    headcountMin: 350,
    headcountMax: 350,
    headcountSourceUrl: 'https://example.org/about',
    headcountExcerpt: 'Acme has about 350 employees.',
    isHouseholdName: false,
    thrivingSignals: [
      {
        type: 'recent_funding_round',
        asOf: '2026-09-01',
        sourceUrl: 'https://example.org/news',
        excerpt: 'Acme raised a Series C in September 2026.',
      },
    ],
  };
  // The raw HTML is an empty app shell; the browser sees the rendered text.
  const fetcher = async () => new Response('<div id="root"></div>');
  const browser = fakeBrowser({
    'https://example.org/about': profile.headcountExcerpt,
    'https://example.org/news': profile.thrivingSignals[0].excerpt,
  });
  const result = await verifyResearchedProfile(
    { company: 'Acme', profile },
    { fetcher, now, browser },
  );
  assert.equal(result.sourceDocuments.length, 2);
  assert.deepEqual(browser.reads, ['https://example.org/about', 'https://example.org/news']);
  // A quote that is absent from the rendered page too is still rejected.
  await assert.rejects(
    verifyResearchedProfile(
      {
        company: 'Acme',
        profile: { ...profile, headcountExcerpt: 'Acme has about 350 employees worldwide.' },
      },
      { fetcher, now, browser: fakeBrowser({ 'https://example.org/about': 'Acme is hiring.' }) },
    ),
    /does not corroborate/,
  );
});

test('a model-reported size counts when its page cannot be read, if the user allows it', async () => {
  const profile = {
    headcountMin: 598,
    headcountMax: 598,
    headcountSourceUrl: 'https://www.tipranks.com/private-companies/fluidstack',
    headcountExcerpt: 'Fluidstack had 598 employees as of October 12, 2026.',
    isHouseholdName: false,
    thrivingSignals: [
      {
        type: 'recent_funding_round',
        asOf: '2026-09-01',
        sourceUrl: 'https://example.org/news',
        excerpt: 'Fluidstack raised new funding in September 2026.',
      },
    ],
  };
  const fetcher = async (url) =>
    /tipranks/.test(url)
      ? new Response('Forbidden', { status: 403 })
      : new Response(`<p>${profile.thrivingSignals[0].excerpt}</p>`);
  await assert.rejects(
    verifyResearchedProfile({ company: 'Fluidstack', profile }, { fetcher, now }),
    /Evidence HTTP 403/,
  );
  const relaxed = await verifyResearchedProfile(
    { company: 'Fluidstack', profile },
    { fetcher, now, acceptModelReported: true },
  );
  assert.equal(relaxed.verification, 'model_reported');
  assert.deepEqual(
    relaxed.unverifiedSources.map((s) => s.url),
    [profile.headcountSourceUrl],
  );
  assert.equal(relaxed.sourceDocuments.length, 1, 'the readable signal is still confirmed');
  // The excerpt must still state the claimed size, and the source must be public HTTPS.
  await assert.rejects(
    verifyResearchedProfile(
      { company: 'Fluidstack', profile: { ...profile, headcountMax: 900 } },
      { fetcher, now, acceptModelReported: true },
    ),
    /interval/,
  );
  await assert.rejects(
    verifyResearchedProfile(
      { company: 'Fluidstack', profile: { ...profile, headcountSourceUrl: 'http://10.0.0.1/x' } },
      { fetcher, now, acceptModelReported: true },
    ),
    /public HTTPS/,
  );
});
