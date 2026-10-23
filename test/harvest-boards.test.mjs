import test from 'node:test';
import assert from 'node:assert/strict';
import { boardFromUrl, sweepLeads } from '../tools/harvest-boards.mjs';

test('ATS links name their board; other links name none', () => {
  assert.deepEqual(boardFromUrl('https://job-boards.greenhouse.io/Acme/jobs/123'), {
    platform: 'greenhouse',
    slug: 'acme',
  });
  assert.deepEqual(boardFromUrl('https://boards.greenhouse.io/embed/job_app?token=9&for=acme'), {
    platform: 'greenhouse',
    slug: 'acme',
  });
  assert.deepEqual(boardFromUrl('https://jobs.lever.co/acme.io/0000-1111?lever-source=x'), {
    platform: 'lever',
    slug: 'acme.io',
  });
  assert.deepEqual(boardFromUrl('https://jobs.ashbyhq.com/Acme%20Labs/uuid/application'), {
    platform: 'ashby',
    slug: 'Acme Labs',
  });
  assert.equal(boardFromUrl('https://www.indeed.com/viewjob?jk=1'), null);
  assert.equal(boardFromUrl('http://jobs.lever.co/acme/1'), null);
  assert.equal(boardFromUrl(null), null);
});

test('leads are found however the sweep report nests them', () => {
  const report = {
    cities: { chicago: { leads: [{ company: 'A', employerUrl: 'x' }] } },
    other: [{ company: 'B', jobUrl: 'y' }],
  };
  assert.deepEqual(
    sweepLeads(report).map((l) => l.company),
    ['A', 'B'],
  );
});
