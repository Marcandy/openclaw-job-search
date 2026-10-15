import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoRoot, readJson } from '../lib/runtime.mjs';
test('fresh runtime completes research, payload approval and diagnostics from a different working directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-campaign-'));
  const env = { ...process.env, CAMPAIGN_RUNTIME_ROOT: dir, CAMPAIGN_PROFILE: 'fullstack' };
  const run = (tool, args = []) =>
    execFileSync(process.execPath, [join(repoRoot, tool), ...args], {
      cwd: tmpdir(),
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  try {
    const config = readJson(join(repoRoot, 'campaign.config.json'));
    mkdirSync(join(dir, 'resumes'));
    for (const file of [
      'Resume_General.pdf',
      'Resume_Java_React.pdf',
      'Resume_Python_React.pdf',
      'Resume_Python_Backend.pdf',
    ])
      writeFileSync(join(dir, 'resumes', file), 'synthetic resume');
    writeFileSync(
      join(dir, 'applicant-facts.json'),
      JSON.stringify({ version: 'test', fields: {} }),
    );
    const candidates = config.cities.flatMap((c) =>
      Array.from({ length: c.dailyQuota }, (_, i) => ({
        cityId: c.id,
        company: `Test ${c.id} ${i}`,
        title: 'Software Engineer',
        description: 'Build React web applications with 2+ years of experience.',
        location: c.acceptedLocationAliases[0],
        url: `https://job-boards.greenhouse.io/example/jobs/${c.id}-${i}`,
        source: 'greenhouse',
        salaryMax: 150000,
        postedDate: new Date().toISOString(),
        companyProfile: {
          headcount: 100,
          isHouseholdName: false,
          thrivingSignals: [
            {
              type: 'recent_funding_round',
              detail: 'Synthetic fixture funding evidence',
              sourceUrl: 'https://example.com/evidence',
              asOf: new Date().toISOString().slice(0, 10),
            },
          ],
        },
      })),
    );
    const input = join(dir, 'candidates.json');
    writeFileSync(input, JSON.stringify(candidates));
    run('tools/prepare-runtime.mjs');
    assert.equal(JSON.parse(run('tools/runtime-doctor.mjs')).ok, true);
    const generatedSkill = readFileSync(join(dir, 'skills', 'job-search', 'SKILL.md'), 'utf8');
    assert.match(generatedSkill, /tools\/inspect-form\.mjs/);
    assert.match(generatedSkill, /never retry uncertain attempts automatically/);
    assert.equal(JSON.parse(run('tools/sync-cron.mjs')).action, 'preview');
    run('validate-pool.mjs', [input, '--write-state']);
    run('tools/prepare-submission.mjs');
    const state = readJson(join(dir, 'openclaw-tri-city-state.json'));
    run('tools/authorize-pool.mjs', ['--confirm-hash', state.manifestHash, '--by', 'Test User']);
    assert.equal(JSON.parse(run('tools/verify-authorization.mjs', ['--json'])).ok, true);
    // A quota failure persists as research, never as an approvable empty pool.
    const empty = join(dir, 'empty.json');
    writeFileSync(empty, '[]');
    const other = join(dir, 'other-state.json');
    let failed = false;
    try {
      execFileSync(
        process.execPath,
        [join(repoRoot, 'validate-pool.mjs'), empty, '--write-state'],
        { cwd: tmpdir(), env: { ...env, CAMPAIGN_STATE_PATH: other }, stdio: 'pipe' },
      );
    } catch (e) {
      failed = true;
      assert.equal(e.status, 1);
    }
    assert.equal(failed, true);
    assert.equal(readJson(other).status, 'researching');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
