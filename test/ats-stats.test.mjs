import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atsOf, atsStats, parseCsv } from '../tools/ats-stats.mjs';

/**
 * 2026-09-01: campaign.config.json calls ATS preference a "ranking tiebreaker
 * only", but the ledger shows it is the strongest predictor of whether a slot
 * converts. Corebridge Financial was authorised onto Workday (0 for 3 at the
 * time) and blocked at account creation, exactly as its record predicted.
 */

test('atsOf classifies the destinations this campaign actually uses', () => {
  assert.equal(atsOf('https://jobs.ashbyhq.com/sourgum/abc'), 'ashby');
  assert.equal(atsOf('https://job-boards.greenhouse.io/prolaio/jobs/1'), 'greenhouse');
  assert.equal(atsOf('https://corebridgefinancial.wd1.myworkdayjobs.com/x/job/y'), 'workday');
  assert.equal(atsOf('https://ats.rippling.com/supernova-technology/jobs/1'), 'rippling');
  assert.equal(atsOf('https://bitdeer.breezy.hr/p/abc'), 'breezy');
  assert.equal(atsOf('https://careers-appliedsystems.icims.com/jobs/7318/job'), 'icims');
  assert.equal(atsOf('https://jobs.lever.co/loadsmart/abc'), 'lever');
  assert.equal(atsOf('https://flotive.ai/careers.html'), 'other/custom');
  assert.equal(atsOf(''), 'unknown');
});

test('parseCsv keeps commas and quotes inside a quoted notes column', () => {
  const csv = 'url,status,notes\nhttps://a,submitted,"Success - one, two ""quoted"""\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], ['https://a', 'submitted', 'Success - one, two "quoted"']);
});

test('atsStats computes a conversion rate over decided rows only', () => {
  const rows = parseCsv([
    'url,status',
    'https://jobs.ashbyhq.com/a/1,submitted',
    'https://jobs.ashbyhq.com/a/2,submitted',
    'https://jobs.ashbyhq.com/a/3,blocked',
    'https://x.wd1.myworkdayjobs.com/j,blocked',
    'https://x.wd1.myworkdayjobs.com/k,blocked',
    'https://job-boards.greenhouse.io/g/jobs/1,discovered',
    '',
  ].join('\n'));
  const s = atsStats(rows);
  assert.equal(s.ashby.submitted, 2);
  assert.equal(s.ashby.blocked, 1);
  assert.equal(s.ashby.decided, 3);
  assert.ok(Math.abs(s.ashby.rate - 2 / 3) < 1e-9);

  assert.equal(s.workday.rate, 0, 'an ATS that never converted must report 0, not null');
  assert.equal(s.workday.decided, 2);

  // "discovered" is not an attempt, so it must not dilute the rate.
  assert.equal(s.greenhouse.decided, 0);
  assert.equal(s.greenhouse.rate, null);
  assert.equal(s.greenhouse.other, 1);
});

test('a zero-conversion ATS is distinguishable from an untried one', () => {
  const rows = parseCsv('url,status\nhttps://x.wd1.myworkdayjobs.com/j,blocked\n');
  const s = atsStats(rows);
  assert.equal(s.workday.rate, 0, 'tried and never converted');
  assert.equal(s.bamboohr, undefined, 'never tried at all');
});
