import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/**
 * 2026-09-09 regression: the duplicate index used to add EVERY ledger row,
 * so a BLOCKED role - one that was never submitted - was permanently barred
 * from re-entering a pool.
 *
 * Infleqtion blocked on 2026-09-08 solely on the export-control / U.S.-Person
 * question. The applicant supplied their status (lawful permanent resident) the same
 * day, resolving the only obstacle, and the role still could not be retried.
 * FourKites and Muon Space are stranded identically.
 *
 * A duplicate gate stops applying TWICE. A blocked row is not an application.
 */

function runValidator(ledgerRows, candidate) {
  const dir = mkdtempSync(join(tmpdir(), 'retryblocked-'));
  const ledger = join(dir, 'ledger.csv');
  writeFileSync(
    ledger,
    'timestamp,company,title,location,url,source,status,resume_used,notes\n' +
      ledgerRows.join('\n') +
      '\n',
  );

  const cfg = JSON.parse(
    readFileSync(join(root, 'campaign.config.json'), 'utf8').replace(/^\uFEFF/, ''),
  );
  cfg.paths = { ...cfg.paths, ledgerCsv: ledger };
  const cfgPath = join(dir, 'campaign.config.json');
  writeFileSync(cfgPath, JSON.stringify(cfg));

  const candPath = join(dir, 'cand.json');
  writeFileSync(candPath, JSON.stringify({ candidates: [candidate] }));

  const scriptPath = join(root, 'validate-pool.mjs');

  try {
    const out = execFileSync(process.execPath, [scriptPath, candPath, '--json'], {
      cwd: root,
      env: { ...process.env, CAMPAIGN_CONFIG_PATH: cfgPath, CAMPAIGN_RUNTIME_ROOT: dir },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(out.slice(out.indexOf('{')));
  } catch (err) {
    // Parse STDOUT only. The validator writes its shortfall/INCOMPLETE lines to
    // stderr, and concatenating them after the JSON corrupts the parse.
    const out2 = String(err.stdout || '');
    const i = out2.indexOf('{');
    if (i >= 0) {
      try {
        return JSON.parse(out2.slice(i));
      } catch (e) {
        throw new Error('JSON parse failed: ' + e.message + ' :: ' + out2.slice(i, i + 200));
      }
    }
    throw new Error(
      'validator produced no JSON. stdout=' +
        out2.slice(0, 200) +
        ' stderr=' +
        String(err.stderr || '').slice(0, 200),
    );
  } finally {
  }
}

const CANDIDATE = {
  cityId: 'chicago',
  company: 'Infleqtion',
  title: 'Software Engineer, Quantum Systems & Digital Engineering',
  location: 'Chicago, IL',
  url: 'https://apply.workable.com/j/30152401A7',
  source: 'Workable official posting',
  description:
    'Build software for quantum systems using Python and TypeScript. 3+ years of experience.',
  salaryMin: 145000,
  salaryMax: 170000,
  verifiedActiveOn: null,
  companyProfile: {
    headcount: 234,
    isHouseholdName: false,
    thrivingSignals: [
      {
        type: 'recent_funding_round',
        detail: 'Raised a Series B in 2026',
        sourceUrl: 'https://example.com/a',
        asOf: '2026-05-01',
      },
    ],
  },
  retryKnownBlocker: true,
};

function findRole(pool, name) {
  for (const city of Object.values(pool.byCity ?? {})) {
    for (const b of ['primary', 'backup']) {
      const hit = (city[b] ?? []).find((r) => r.company === name);
      if (hit) return { bucket: b, role: hit };
    }
  }
  const rej = (pool.rejected ?? []).find((r) => r.company === name);
  return rej ? { bucket: 'rejected', role: rej } : null;
}

test('2026-09-09 regression: a BLOCKED row does not bar a retry', () => {
  const row = `2026-09-08T10:42:02,Infleqtion,"Software Engineer, Quantum Systems & Digital Engineering","Chicago, IL",https://apply.workable.com/j/30152401A7,workable,blocked,resume.pdf,"Blocked on required unsupported export-control question"`;
  const cand = { ...CANDIDATE, verifiedActiveOn: new Date().toISOString().slice(0, 10) };
  const pool = runValidator([row], cand);
  const found = findRole(pool, 'Infleqtion');
  assert.ok(found, 'Infleqtion should appear somewhere in the pool output');
  assert.notEqual(
    found.bucket,
    'rejected',
    'a blocked row must not suppress a retry once its blocking fact is answered',
  );
});

test('a SUBMITTED row still bars a duplicate application', () => {
  const row = `2026-09-08T10:42:02,Infleqtion,"Software Engineer, Quantum Systems & Digital Engineering","Chicago, IL",https://apply.workable.com/j/30152401A7,workable,submitted,resume.pdf,"Visible confirmation: received"`;
  const cand = { ...CANDIDATE, verifiedActiveOn: new Date().toISOString().slice(0, 10) };
  const pool = runValidator([row], cand);
  const found = findRole(pool, 'Infleqtion');
  assert.ok(found, 'Infleqtion should appear in the validator output');
  assert.equal(found.bucket, 'rejected', 'a submitted row MUST still block a second application');
  assert.match(JSON.stringify(found.role), /duplicate/i);
});

test('a DISCOVERED row never suppresses, since nothing was attempted', () => {
  const row = `2026-09-01T10:00:00,Infleqtion,"Software Engineer, Quantum Systems & Digital Engineering","Chicago, IL",https://apply.workable.com/j/30152401A7,workable,discovered,,"seen in a sweep"`;
  const cand = { ...CANDIDATE, verifiedActiveOn: new Date().toISOString().slice(0, 10) };
  const pool = runValidator([row], cand);
  const found = findRole(pool, 'Infleqtion');
  assert.ok(found && found.bucket !== 'rejected', 'a discovered row is not an application');
});
