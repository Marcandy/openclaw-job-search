import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntime, repoRoot, assertLocalDatabase } from '../lib/runtime.mjs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
test('runtime paths and digest do not depend on the working directory', () => {
  const env = { CAMPAIGN_RUNTIME_ROOT: join(tmpdir(), 'campaign') };
  const before = loadRuntime(env);
  const cwd = process.cwd();
  try { process.chdir(tmpdir()); assert.deepEqual(loadRuntime(env), before); } finally { process.chdir(cwd); }
  assert.equal(before.sourceRoot, repoRoot);
  assert.match(before.config.paths.ledgerCsv, /campaign/);
});
test('profiles are explicit and unknown profiles fail', () => {
  assert.throws(() => loadRuntime({ CAMPAIGN_PROFILE: 'silently-widen' }), /Unknown/);
  assert.equal(loadRuntime({ CAMPAIGN_PROFILE: 'apprenticeship' }).config.experienceFilter.maxAcceptedMinimumYears, 2);
});
test('SQLite storage rejects cloud-sync locations', () => {
  assert.throws(() => assertLocalDatabase('C:/Users/test/OneDrive/data.sqlite'), /cloud-sync/);
  assertLocalDatabase(join(tmpdir(), 'test.sqlite'));
});
