/**
 * End-to-end test of the authorization lifecycle, exercising the real CLI tools
 * as child processes against a throwaway state file.
 *
 * The property under test is the one that actually protects the user: after they
 * approve a specific list of employers, nothing can quietly change that list.
 *
 * Run: node --test "openclaw-campaign/test/authorization-flow.test.mjs"
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { poolHash } from '../lib/role-filter.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const config = JSON.parse(readFileSync(join(root, 'campaign.config.json'), 'utf8').replace(/^﻿/, ''));
const authorize = join(root, 'tools', 'authorize-pool.mjs');
const verify = join(root, 'tools', 'verify-authorization.mjs');

const URLS = [
  'https://jobs.ashbyhq.com/acme/newark-1',
  'https://jobs.ashbyhq.com/acme/newark-2',
  'https://boards.greenhouse.io/beta/jobs/chicago-1',
];

function freshState(dir, overrides = {}) {
  const statePath = join(dir, 'state.json');
  const state = {
    campaign: 'newark-sanjose-chicago-3-2-2',
    campaignDate: '2026-08-16',
    status: 'awaiting_authorization',
    authorization: null,
    dailyQuota: { 'Newark, NJ': 3, 'San Jose, CA': 2, 'Chicago, IL': 2 },
    visibleConfirmedSubmissionsToday: { 'Newark, NJ': 0, 'San Jose, CA': 0, 'Chicago, IL': 0 },
    pool: {
      'Newark, NJ': { primary: [{ company: 'Acme', title: 'Software Engineer', canonicalUrl: URLS[0] }, { company: 'Acme', title: 'Frontend Engineer', canonicalUrl: URLS[1] }], backup: [] },
      'San Jose, CA': { primary: [], backup: [] },
      'Chicago, IL': { primary: [{ company: 'Beta', title: 'Software Engineer II', canonicalUrl: URLS[2] }], backup: [] },
    },
    ...overrides,
  };
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  return statePath;
}

/** Run a tool and capture status + output regardless of exit code. */
function run(script, args, statePath) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      env: { ...process.env, CAMPAIGN_STATE_PATH: statePath },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'campaign-auth-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('verify refuses to run while the pool is still awaiting authorization', () => {
  withTempDir((dir) => {
    const statePath = freshState(dir);
    const r = run(verify, [], statePath);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /awaiting_authorization/);
  });
});

test('authorize requires the hash the user was actually shown', () => {
  withTempDir((dir) => {
    const statePath = freshState(dir);
    const r = run(authorize, ['--confirm-hash', 'deadbeef'], statePath);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /does not match/);
    assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).status, 'awaiting_authorization', 'state must be untouched after a refused authorization');
  });
});

test('the happy path authorizes and then verifies clean', () => {
  withTempDir((dir) => {
    const statePath = freshState(dir);
    const hash = poolHash(URLS);

    const a = run(authorize, ['--confirm-hash', hash, '--by', 'Marc-Andy'], statePath);
    assert.equal(a.code, 0, a.stderr);
    assert.match(a.stdout, /AUTHORIZED/);

    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(state.status, 'authorized');
    assert.equal(state.researchOnly, false);
    assert.equal(state.authorization.authorizedBy, 'Marc-Andy');
    assert.equal(state.authorization.destinationCount, 3);
    assert.equal(state.authorization.poolHash, hash);

    const v = run(verify, [], statePath);
    assert.equal(v.code, 0, v.stderr);
    assert.match(v.stdout, /destination list is unchanged/);
  });
});

test('swapping in an employer after authorization is detected and named', () => {
  withTempDir((dir) => {
    const statePath = freshState(dir);
    run(authorize, ['--confirm-hash', poolHash(URLS), '--by', 'Marc-Andy'], statePath);

    // Simulate a later process substituting a destination the user never saw.
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.pool['Chicago, IL'].primary[0].canonicalUrl = 'https://jobs.lever.co/sneaky/never-approved';
    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');

    const v = run(verify, ['--json'], statePath);
    assert.equal(v.code, 1);
    const report = JSON.parse(v.stdout);
    assert.equal(report.ok, false);
    assert.ok(report.added.some((u) => u.includes('sneaky')), 'the unapproved destination must be named');
    assert.ok(report.removed.some((u) => u.includes('chicago-1')), 'the dropped destination must be named');
  });
});

test('adding an extra destination after authorization is detected', () => {
  withTempDir((dir) => {
    const statePath = freshState(dir);
    run(authorize, ['--confirm-hash', poolHash(URLS), '--by', 'Marc-Andy'], statePath);

    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.pool['San Jose, CA'].primary.push({ company: 'Extra', title: 'Software Engineer', canonicalUrl: 'https://jobs.ashbyhq.com/extra/bonus' });
    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');

    const v = run(verify, ['--json'], statePath);
    assert.equal(v.code, 1);
    assert.ok(JSON.parse(v.stdout).added.some((u) => u.includes('bonus')));
  });
});

test('reordering the pool does not trip the integrity check', () => {
  withTempDir((dir) => {
    const statePath = freshState(dir);
    run(authorize, ['--confirm-hash', poolHash(URLS), '--by', 'Marc-Andy'], statePath);

    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.pool['Newark, NJ'].primary.reverse();
    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');

    assert.equal(run(verify, [], statePath).code, 0, 'reordering is not a destination change');
  });
});

test('double authorization is refused', () => {
  withTempDir((dir) => {
    const statePath = freshState(dir);
    const hash = poolHash(URLS);
    assert.equal(run(authorize, ['--confirm-hash', hash], statePath).code, 0);
    const second = run(authorize, ['--confirm-hash', hash], statePath);
    assert.equal(second.code, 1);
    assert.match(second.stderr, /already authorized/);
  });
});

test('authorize refuses when the campaign has not reached awaiting_authorization', () => {
  withTempDir((dir) => {
    const statePath = freshState(dir, { status: 'idle' });
    const r = run(authorize, ['--confirm-hash', poolHash(URLS)], statePath);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /expected "awaiting_authorization"/);
  });
});

test('authorize without a hash exits 2 rather than guessing', () => {
  withTempDir((dir) => {
    const statePath = freshState(dir);
    assert.equal(run(authorize, [], statePath).code, 2);
  });
});

// ---------------------------------------------------------------------------
// validate-pool --write-state must not destroy work that already happened.
// ---------------------------------------------------------------------------

const validate = join(root, 'validate-pool.mjs');

/** Minimal candidate set that clears every gate for all nine cities. */
function smokeCandidates(dir) {
  const mk = (cityId, location, n) => ({
    cityId, location,
    company: `Testco ${cityId} ${n}`,
    title: 'Software Engineer II',
    url: `https://jobs.ashbyhq.com/testco/${cityId}-${n}`,
    source: 'Official Ashby ATS',
    description: '2+ years of experience with React and Node.js.',
    salaryMin: 110000, salaryMax: 150000,
    postedDate: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    fitScore: 50,
    companyProfile: {
      headcount: 120, isHouseholdName: false,
      thrivingSignals: [{ type: 'recent_funding_round', detail: 'Series B 2026', sourceUrl: 'https://example.com/x' }],
    },
  });
  // Must satisfy the full 3 / 2 / 5 / 2 / 1x5 quota or the validator exits 1 on shortfall.
  const candidates = [
    mk('newark', 'Newark, NJ', 1), mk('newark', 'Newark, NJ', 2), mk('newark', 'Jersey City, NJ', 3),
    mk('san-jose', 'San Jose, CA', 1), mk('san-jose', 'San Jose, CA', 2),
    mk('chicago', 'Chicago, IL', 1), mk('chicago', 'Chicago, IL', 2), mk('chicago', 'Chicago, IL', 3),
    mk('chicago', 'Chicago, IL', 4), mk('chicago', 'Chicago, IL', 5),
    mk('atlanta', 'Atlanta, GA', 1), mk('atlanta', 'Atlanta, GA', 2),
    mk('san-diego', 'San Diego, CA', 1),
    mk('sacramento', 'Sacramento, CA', 1),
    mk('washington-dc', 'Washington, DC', 1),
    mk('houston', 'Houston, TX', 1),
    mk('baltimore', 'Baltimore, MD', 1),
  ];
  const p = join(dir, 'candidates.json');
  writeFileSync(p, JSON.stringify({ candidates }, null, 2), 'utf8');
  return p;
}

test('validate --write-state preserves submission counts within the same day', () => {
  withTempDir((dir) => {
    const statePath = join(dir, 'state.json');
    const candidates = smokeCandidates(dir);

    assert.equal(run(validate, [candidates, '--write-state'], statePath).code, 0);

    // Simulate a partially completed day. Labels come from config so that
    // renaming a city (Newark -> Newark / Jersey City) cannot silently break this.
    const newarkLabel = config.cities.find((c) => c.id === 'newark').label;
    const chicagoLabel = config.cities.find((c) => c.id === 'chicago').label;

    const mid = JSON.parse(readFileSync(statePath, 'utf8'));
    mid.visibleConfirmedSubmissionsToday[newarkLabel] = 2;
    mid.visibleConfirmedSubmissionsToday[chicagoLabel] = 1;
    writeFileSync(statePath, JSON.stringify(mid, null, 2), 'utf8');

    assert.equal(run(validate, [candidates, '--write-state'], statePath).code, 0);
    const after = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(after.visibleConfirmedSubmissionsToday[newarkLabel], 2, 'confirmed submissions must survive re-validation');
    assert.equal(after.visibleConfirmedSubmissionsToday[chicagoLabel], 1);
  });
});

test('validate --write-state refuses to clobber an authorized batch', () => {
  withTempDir((dir) => {
    const statePath = join(dir, 'state.json');
    const candidates = smokeCandidates(dir);

    assert.equal(run(validate, [candidates, '--write-state'], statePath).code, 0);
    const hash = JSON.parse(readFileSync(statePath, 'utf8')).poolHash;
    assert.equal(run(authorize, ['--confirm-hash', hash, '--by', 'Marc-Andy'], statePath).code, 0);

    const r = run(validate, [candidates, '--write-state'], statePath);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /REFUSED to write state/);

    const after = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(after.status, 'authorized', 'the authorization must survive');
    assert.equal(after.authorization.poolHash, hash);
  });
});
