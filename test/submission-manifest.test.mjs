import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRuntime } from '../lib/runtime.mjs';
import {
  buildManifest,
  manifestHash,
  validateManifest,
  verifyManifestAuthorization,
} from '../lib/submission-manifest.mjs';
import { campaignToday } from '../lib/role-filter.mjs';
function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'manifest-'));
  const r = loadRuntime({ CAMPAIGN_RUNTIME_ROOT: dir });
  mkdirSync(join(dir, 'resumes'));
  writeFileSync(r.config.paths.resume, 'test resume');
  writeFileSync(
    r.config.paths.facts,
    JSON.stringify({
      version: 'v1',
      fields: {
        name: {
          value: 'Test Candidate',
          source: 'user',
          confirmedAt: '2026-10-12',
          uses: ['application'],
        },
      },
    }),
  );
  const state = {
    status: 'awaiting_authorization',
    campaignDate: campaignToday(r.config),
    dailyQuota: { Chicago: 1 },
    pool: {
      Chicago: {
        primary: [
          {
            company: 'Acme',
            title: 'Engineer',
            location: 'Chicago',
            source: 'greenhouse',
            url: 'https://job-boards.greenhouse.io/acme/jobs/1',
            answers: { name: 'name' },
          },
        ],
        backup: [],
      },
    },
  };
  try {
    fn(r, state);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test('approval rejects altered resume facts profile limit expiry and legacy authorization', () =>
  fixture((r, s) => {
    const m = buildManifest(s, r);
    s.submissionManifest = m;
    s.status = 'authorized';
    s.authorization = {
      manifestHash: manifestHash(m),
      authorizedBy: 'Test User',
      authorizedAt: new Date().toISOString(),
    };
    assert.equal(verifyManifestAuthorization(s, r), m);
    const altered = structuredClone(s);
    altered.submissionManifest.maxSubmissions = 2;
    assert.throws(() => verifyManifestAuthorization(altered, r), /limit/);
    assert.throws(
      () => verifyManifestAuthorization(s, r, new Date(Date.parse(m.expiresAt) + 1)),
      /expired/,
    );
    assert.throws(
      () => verifyManifestAuthorization({ ...s, authorization: { poolHash: 'old' } }, r),
      /Legacy/,
    );
    assert.throws(() => verifyManifestAuthorization(s, { ...r, profile: 'other' }), /profile/);
    writeFileSync(r.config.paths.resume, 'changed');
    assert.throws(() => validateManifest(m, r), /Resume/);
    writeFileSync(r.config.paths.resume, 'test resume');
    writeFileSync(r.config.paths.facts, '{}');
    assert.throws(() => validateManifest(m, r), /facts changed/);
  }));
test('unknown required answer never enters an approvable manifest', () =>
  fixture((r, s) => {
    s.pool.Chicago.primary[0].answers = { school: 'unconfirmedSchool' };
    assert.throws(() => buildManifest(s, r), /Unknown/);
  }));
