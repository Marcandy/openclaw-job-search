import { loadRuntime } from '../lib/runtime.mjs';
/**
 * What actually converts? Per-ATS submitted/blocked rates read from the LEDGER.
 *
 * WHY THIS EXISTS
 * ---------------
 * campaign.config.json carries an `atsPreference` block with hardcoded tiers
 * and this note: "Ranking tiebreaker only."
 *
 * The ledger says it is not a tiebreaker. It is the single strongest predictor
 * of whether a quota slot converts into an application:
 *
 *   ashby      77%      workday     0%  (0 of 4)
 *   rippling   67%      icims       0%  (0 of 1)
 *   greenhouse 59%      jobvite     0%  (0 of 2)
 *   lever      18%
 *
 * The tier evidence baked into the config is also stale - it still reads
 * "Ashby 25 submitted / 4 blocked" when the real figure is 37/11.
 *
 * On 2026-09-01 a Corebridge Financial role was authorised into a batch on
 * Workday and blocked at "Create Account/Sign In", exactly as its 0-for-3
 * record predicted. That slot was spent before it was ever attempted.
 *
 * This tool derives the rates live so the number is never stale, and flags any
 * candidate sitting on an ATS that has never produced a receipt.
 *
 * Usage:
 *   node tools/ats-stats.mjs                       report rates from the ledger
 *   node tools/ats-stats.mjs <candidates.json>     also flag zero-conversion picks
 *   node tools/ats-stats.mjs --json                machine-readable
 *
 * Exit: 0 always. This is a REPORTER - it informs selection, it does not gate.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const readText = (p) => readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const { config } = loadRuntime();

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const candidatesPath = args.find((a) => !a.startsWith('--'));

/** Minimal RFC4180-ish CSV reader; the ledger has quoted, comma-bearing notes. */
export function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/** Classify a destination URL to an ATS name. */
export function atsOf(url) {
  const u = String(url || '').toLowerCase();
  const map = [
    ['ashby', 'ashbyhq'], ['greenhouse', 'greenhouse'], ['lever', 'lever.co'],
    ['workday', 'myworkdayjobs'], ['rippling', 'rippling'], ['breezy', 'breezy'],
    ['icims', 'icims'], ['workable', 'workable'], ['smartrecruiters', 'smartrecruiters'],
    ['jobvite', 'jobvite'], ['taleo', 'taleo'], ['successfactors', 'successfactors'],
    ['bamboohr', 'bamboohr'], ['applytojob', 'applytojob'], ['dayforce', 'dayforcehcm'],
    ['avature', 'avature'], ['oracle', 'oraclecloud'], ['eightfold', 'eightfold'],
  ];
  for (const [name, needle] of map) if (u.includes(needle)) return name;
  return u ? 'other/custom' : 'unknown';
}

/** Build {ats: {submitted, blocked, other, rate}} from ledger rows. */
export function atsStats(rows) {
  const head = rows[0] ?? [];
  const iu = head.indexOf('url'), is = head.indexOf('status');
  const out = {};
  for (const r of rows.slice(1)) {
    if (!r || (!r[iu] && !r[is])) continue;
    const a = atsOf(r[iu]);
    const s = String(r[is] ?? '').trim();
    out[a] ??= { submitted: 0, blocked: 0, other: 0 };
    if (s === 'submitted') out[a].submitted++;
    else if (s === 'blocked') out[a].blocked++;
    else out[a].other++;
  }
  for (const v of Object.values(out)) {
    const decided = v.submitted + v.blocked;
    v.decided = decided;
    v.rate = decided ? v.submitted / decided : null;
  }
  return out;
}

// Run the report only when invoked directly. Importing this module must stay
// silent - validate-pool.mjs imports atsOf/atsStats/parseCsv, and any stray
// stdout here corrupts its --json output. (Found 2026-09-09.)
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const rows = parseCsv(readText(config.paths.ledgerCsv));
  const stats = atsStats(rows);

  const ranked = Object.entries(stats)
    .filter(([, v]) => v.decided > 0)
    .sort((a, b) => (b[1].rate ?? 0) - (a[1].rate ?? 0) || b[1].decided - a[1].decided);

  if (asJson) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), stats }, null, 2));
  } else {
    console.log('\n=== ATS CONVERSION, MEASURED FROM THE LEDGER ===\n');
    console.log('  ATS               submitted  blocked   rate   n');
    for (const [name, v] of ranked) {
      const rate = v.rate === null ? '   -' : `${Math.round(v.rate * 100)}%`.padStart(4);
      const warn = v.rate === 0 ? '   <-- never produced a receipt' : '';
      console.log(
        '  ' + name.padEnd(18) + String(v.submitted).padStart(6) +
        String(v.blocked).padStart(9) + rate.padStart(7) + String(v.decided).padStart(4) + warn
      );
    }

    // Compare against the tiers hardcoded in the config, which drift.
    const tierOf = {};
    for (const t of config.atsPreference?.tiers ?? []) {
      for (const p of t.platforms) tierOf[p] = t.tier;
    }
    const surprises = ranked.filter(([n, v]) =>
      tierOf[n] != null && ((tierOf[n] <= 2 && v.rate < 0.4) || (tierOf[n] >= 3 && v.rate > 0.6))
    );
    if (surprises.length) {
      console.log('\n  CONFIG DISAGREES WITH THE LEDGER:');
      for (const [n, v] of surprises) {
        console.log(`    ${n}: config tier ${tierOf[n]}, measured ${Math.round(v.rate * 100)}% over ${v.decided}`);
      }
    }
  }

  if (candidatesPath) {
    const cand = JSON.parse(readText(candidatesPath));
    const list = cand.candidates ?? [];
    const flagged = [];
    for (const c of list) {
      const a = atsOf(c.url);
      const v = stats[a];
      if (v && v.decided >= 1 && v.rate === 0) {
        flagged.push({ company: c.company, title: c.title, ats: a, record: `0 of ${v.decided}` });
      }
    }
    if (!asJson) {
      console.log(`\n=== CANDIDATE CHECK: ${list.length} destination(s) ===`);
      if (!flagged.length) {
        console.log('  No destination sits on a zero-conversion ATS.');
      } else {
        for (const f of flagged) {
          console.log(`  [ZERO-CONVERSION] ${f.company} — ${f.title}`);
          console.log(`      ${f.ats} has produced ${f.record} receipts in this ledger.`);
        }
        console.log('\n  These may still be worth attempting, but expect them to block.');
        console.log('  Do not count them toward an expected submission total.');
      }
    }
  }

}
