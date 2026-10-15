import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  rmSync,
  readdirSync,
  existsSync,
  mkdtempSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const tool = join(root, 'tools', 'leads-to-candidates.mjs');
const readText = (p) => readFileSync(p, 'utf8').replace(/^﻿/, '');
const config = JSON.parse(readText(join(root, 'campaign.config.json')));

const LEADS_RE = /^leads-\d{4}-\d{2}-\d{2}\.json$/;

/** Newest real sweep on disk, so these run against production-shaped data. */
function latestLeadsFile() {
  const files = readdirSync(root)
    .filter((f) => LEADS_RE.test(f))
    .sort();
  return files.length ? join(root, files[files.length - 1]) : null;
}

function runTriage(extraArgs) {
  const out = join(root, 'test', `.tmp-${Math.random().toString(36).slice(2)}.json`);
  const leads = latestLeadsFile();
  if (!leads) return { skipped: true, out: null, doc: null };
  try {
    execFileSync(process.execPath, [tool, leads, ...extraArgs, '--json', out], {
      encoding: 'utf8',
    });
    return { skipped: false, out, doc: JSON.parse(readText(out)), leads };
  } finally {
    try {
      rmSync(out);
    } catch {
      /* best effort */
    }
  }
}

const normCompany = (n) =>
  (n ?? '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|company)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const normTitle = (t) =>
  (t ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Minimal quoted-CSV read, matching the shape leads-to-candidates.mjs uses. */
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

test('2026-08-26 regression: --json does not swallow the output path as a cityId', () => {
  const { skipped, doc, leads } = runTriage([]);
  if (skipped) return;
  const cityIds = Object.keys(doc.cities ?? {}).sort();
  const expected = Object.keys(JSON.parse(readText(leads)).cities ?? {}).sort();
  assert.ok(cityIds.length > 0, 'cities object must not be empty');
  assert.deepEqual(
    cityIds,
    expected,
    'the JSON output must contain every city from the sweep; an empty cities object means the ' +
      'output path was parsed as a cityId again',
  );
});

test('2026-08-26 regression: an explicit cityId still selects exactly that city', () => {
  const { skipped, doc } = runTriage(['chicago']);
  if (skipped) return;
  assert.deepEqual(Object.keys(doc.cities ?? {}), ['chicago']);
});

test('2026-08-26 regression: survivors never include a company+title already spent in the ledger', () => {
  const { skipped, doc } = runTriage([]);
  if (skipped) return;

  const spent = new Set(
    parseCsvRows(readText(config.paths.ledgerCsv))
      .filter((r) => ['submitted', 'reviewed', 'closed', 'drafted'].includes(r.status))
      .map((r) => `${normCompany(r.company)}::${normTitle(r.title)}`),
  );

  const offenders = [];
  for (const city of Object.values(doc.cities ?? {})) {
    for (const lead of city.leads ?? []) {
      if (spent.has(`${normCompany(lead.company)}::${normTitle(lead.title)}`)) {
        offenders.push(`${lead.company} — ${lead.title}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'these roles are already in the ledger and must not be re-presented for research',
  );
});

test('every survivor carries a knownOfficialUrl field, null or otherwise', () => {
  const { skipped, doc } = runTriage([]);
  if (skipped) return;
  for (const city of Object.values(doc.cities ?? {})) {
    assert.equal(typeof city.survivorsWithPreviouslyResolvedUrl, 'number');
    for (const lead of city.leads ?? []) {
      assert.ok('knownOfficialUrl' in lead, 'every survivor needs the knownOfficialUrl field');
    }
  }
});

test('2026-08-26 regression: an employer-URL count never includes the string "nan"', () => {
  // pandas NaN stringifies to "nan", which is TRUTHY. discover.py's summary
  // counted those as real URLs and reported 100% coverage for San Jose and
  // Chicago when the truth was about a third. discover.py's clean() fixes the
  // source; this pins the invariant at the point where the miscount mattered.
  //
  // Sweeps written BEFORE the fix still contain "nan" on disk, so this asserts
  // on what triage reports, not on historical artifacts.
  const { skipped, doc } = runTriage([]);
  if (skipped) return;
  for (const [cityId, city] of Object.entries(doc.cities ?? {})) {
    const realUrls = (city.leads ?? []).filter((l) => {
      if (!l.employerUrl) return false;
      try {
        return /^https?:$/.test(new URL(l.employerUrl).protocol);
      } catch {
        return false;
      }
    }).length;
    assert.equal(
      city.survivorsWithEmployerUrl,
      realUrls,
      `${cityId}: survivorsWithEmployerUrl must count only parseable http(s) URLs`,
    );
  }
});

test('2026-08-26 regression: discover.py clean() maps every missing-value spelling to None', () => {
  // Guards the helper directly, since the JS suite cannot otherwise see it.
  const python = join(root, 'discovery', '.venv', 'Scripts', 'python.exe');
  if (!existsSync(python)) return; // venv absent on this machine
  const script = [
    'import sys, importlib.util',
    `spec = importlib.util.spec_from_file_location("d", r"${join(root, 'discovery', 'discover.py')}")`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'bad = [float("nan"), None, "nan", "NaN", "NaT", "none", "null", "", "   ", "<NA>"]',
    'assert all(m.clean(v) is None for v in bad), [v for v in bad if m.clean(v) is not None]',
    'assert m.clean("https://example.com/x") == "https://example.com/x"',
    'assert m.clean("  padded  ") == "padded"',
    'print("ok")',
  ].join('\n');
  const outText = execFileSync(python, ['-c', script], { encoding: 'utf8' });
  assert.match(outText, /ok/);
});

// A blocked attempt must reach research again, where the exact blocker is checked.
// Actual submissions and unresolved structural blockers must remain suppressed.
test('2026-09-10: triage permits blocked retries while preserving submission and blocker gates', () => {
  const dir = mkdtempSync(join(root, 'test', '.retry-triage-'));
  const ledger = join(dir, 'ledger.csv');
  const leads = join(dir, 'leads.json');
  const out = join(dir, 'out.json');
  const names = [
    'Retry Candidate',
    'Submitted Candidate',
    'Reviewed Candidate',
    'Structural Candidate',
  ];
  writeFileSync(
    ledger,
    'company,title,url,status,notes\n' +
      [
        'Retry Candidate,Software Engineer,https://example.org/retry,blocked,Required spoken language answer missing',
        'Submitted Candidate,Software Engineer,https://example.org/sent,submitted,Application received',
        'Reviewed Candidate,Software Engineer,https://example.org/review,reviewed,Prepared for review',
        'Structural Candidate,Software Engineer,https://example.org/structural,blocked,Required residential street address',
      ].join('\n') +
      '\n',
  );
  writeFileSync(
    leads,
    JSON.stringify({
      cities: {
        chicago: {
          leads: names.map((company) => ({
            company,
            title: 'Software Engineer',
            location: 'Chicago, IL',
          })),
        },
      },
    }),
  );
  try {
    execFileSync(process.execPath, [tool, leads, '--json', out], {
      encoding: 'utf8',
      env: { ...process.env, CAMPAIGN_LEDGER_PATH: ledger },
    });
    const survivors = JSON.parse(readText(out)).cities.chicago.leads;
    assert.deepEqual(
      survivors.map((row) => row.company),
      ['Retry Candidate'],
    );
    assert.equal(survivors[0].knownOfficialUrl, 'https://example.org/retry');
  } finally {
    for (const path of [ledger, leads, out]) if (existsSync(path)) unlinkSync(path);
    rmdirSync(dir);
  }
});
