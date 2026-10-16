import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyStandingPolicy } from '../lib/daily-policy.mjs';
import { fileDigest, atomicJson } from '../lib/runtime.mjs';

test('one-off fifteen-application grant expires by New York date while the standing twelve remains valid', () => {
  const directory = mkdtempSync(join(tmpdir(), 'batch-policy-'));
  const input = join(directory, 'input.json'),
    path = join(directory, 'policy.json');
  writeFileSync(input, '{}');
  const hash = fileDigest(input);
  const runtime = {
    configDigest: 'config',
    sourceDigest: 'source',
    config: { timezone: 'America/New_York', paths: { facts: input, boards: input } },
  };
  const standing = {
    enabled: true,
    dailyLimit: 12,
    approvedBy: 'user',
    approvedAt: '2026-10-16T12:00:00Z',
    instruction: 'Apply daily',
    timezone: 'America/New_York',
    configDigest: 'config',
    sourceDigest: 'source',
    factsHash: hash,
    boardsHash: hash,
    seedProfilesPath: input,
    seedProfilesHash: hash,
    resumes: { [input]: hash },
    allowedCityIds: ['us-remote'],
  };
  try {
    atomicJson(path, { ...standing, dailyLimit: 15, campaignDate: '2026-10-16' });
    assert.equal(
      verifyStandingPolicy(runtime, path, { now: new Date('2026-10-17T03:00:00Z') }).dailyLimit,
      15,
    );
    assert.throws(
      () => verifyStandingPolicy(runtime, path, { now: new Date('2026-10-17T04:00:00Z') }),
      /campaign date/,
    );
    atomicJson(path, standing);
    assert.equal(
      verifyStandingPolicy(runtime, path, { now: new Date('2026-10-17T04:00:00Z') }).dailyLimit,
      12,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
