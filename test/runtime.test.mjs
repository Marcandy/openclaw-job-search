import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntime, repoRoot, assertLocalDatabase } from '../lib/runtime.mjs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
test('runtime paths and digest do not depend on the working directory', () => {
  const env = { CAMPAIGN_RUNTIME_ROOT: join(tmpdir(), 'campaign') };
  const before = loadRuntime(env);
  const cwd = process.cwd();
  try {
    process.chdir(tmpdir());
    assert.deepEqual(loadRuntime(env), before);
  } finally {
    process.chdir(cwd);
  }
  assert.equal(before.sourceRoot, repoRoot);
  assert.match(before.config.paths.ledgerCsv, /campaign/);
});
test('profiles are explicit and unknown profiles fail', () => {
  assert.throws(() => loadRuntime({ CAMPAIGN_PROFILE: 'silently-widen' }), /Unknown/);
  assert.equal(
    loadRuntime({ CAMPAIGN_PROFILE: 'apprenticeship' }).config.experienceFilter
      .maxAcceptedMinimumYears,
    2,
  );
});
test('SQLite storage rejects cloud-sync locations', () => {
  assert.throws(() => assertLocalDatabase('C:/Users/test/OneDrive/data.sqlite'), /cloud-sync/);
  assertLocalDatabase(join(tmpdir(), 'test.sqlite'));
});

test('atomic JSON writes retry a briefly held Windows target, then give up', async () => {
  const { atomicJson, renameWithRetry, readJson } = await import('../lib/runtime.mjs');
  const { mkdtempSync, renameSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'atomic-'));
  const target = join(dir, 'daily-latest.json');
  let calls = 0;
  const heldTwice = (from, to) => {
    if (++calls <= 2) throw Object.assign(Error('held'), { code: 'EPERM' });
    renameSync(from, to);
  };
  atomicJson(target, { ok: true }, { rename: heldTwice });
  assert.equal(calls, 3);
  assert.deepEqual(readJson(target), { ok: true });
  const alwaysHeld = () => {
    throw Object.assign(Error('held'), { code: 'EBUSY' });
  };
  assert.throws(
    () => renameWithRetry('a', 'b', { rename: alwaysHeld, attempts: 3, delayMs: 1 }),
    /held/,
  );
  let other = 0;
  const missing = () => {
    other++;
    throw Object.assign(Error('missing'), { code: 'ENOENT' });
  };
  assert.throws(() => renameWithRetry('a', 'b', { rename: missing, delayMs: 1 }), /missing/);
  assert.equal(other, 1, 'non-sharing errors are not retried');
});
