import { loadRuntime, readJson, atomicJson } from './lib/runtime.mjs';
/**
 * Pool authorization gate.
 *
 * Usage:
 *   node validate-pool.mjs <candidates.json> [--write-state] [--json]
 *
 * Reads a candidates file produced by the research run, applies every
 * deterministic gate in lib/role-filter.mjs, deduplicates against the CSV
 * ledger, assembles the 3/2/2 pool, and prints an authorization request.
 *
 * Exit codes:
 *   0  pool is clean and ready to present for authorization
 *   1  pool contains rejected roles that were placed, or quota shortfall
 *   2  bad input
 *
 * The research prompt is instructed never to present a pool that has not
 * exited 0 here. That is what makes the hard rules executable rather than
 * advisory - the 2026-08-15 defect was an LLM reading prose rules.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildPool,
  buildBlockerIndex,
  canonicalizeUrl,
  normalizeCompany,
} from './lib/role-filter.mjs';
import { atsOf, atsStats, parseCsv as parseLedgerCsv } from './tools/ats-stats.mjs';
import { routeResume } from './lib/resume-routing.mjs';
import { validateData } from './lib/schemas.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Read UTF-8 and strip a byte-order mark. Windows PowerShell 5.1 writes a BOM
 * from Out-File/Set-Content by default, and JSON.parse rejects it.
 */
function readText(path) {
  return readFileSync(path, 'utf8').replace(/^﻿/, '');
}

const { config } = loadRuntime();

// Testability seam: point --write-state at a throwaway file instead of live state.
const statePath = process.env.CAMPAIGN_STATE_PATH ?? config.paths.state;

const args = process.argv.slice(2);
const candidatesPath = args.find((a) => !a.startsWith('--'));
const wantJson = args.includes('--json');
const writeState = args.includes('--write-state');

/**
 * --waive-city "<label>" lets the user accept a short city for today.
 *
 * Research can legitimately fail to fill a city: on 2026-08-16 Newark produced
 * zero eligible engineering roles across five passes. Without this the gate would
 * block the cities that DID fill, which punishes the user for market supply.
 * The waiver is explicit, recorded in state, and never inferred.
 */
const waivedCities = args.reduce((acc, a, i) => {
  if (a === '--waive-city' && args[i + 1]) acc.push(args[i + 1]);
  return acc;
}, []);

if (!candidatesPath) {
  console.error('usage: node validate-pool.mjs <candidates.json> [--write-state] [--json]');
  process.exit(2);
}

/** Minimal RFC4180 CSV parser - the ledger has quoted commas and newlines in notes. */
function parseCsv(text) {
  const rows = [];
  let row = [],
    field = '',
    inQuotes = false;
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

/** Build the duplicate index from the authoritative CSV ledger. */
function loadLedgerIndex(csvPath) {
  let text;
  try {
    text = readText(csvPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // A fresh clone has no ledger yet: start empty rather than refusing to run.
      console.error(`note: no application ledger at ${csvPath} - starting with an empty history`);
      text = '';
    } else {
      console.error(`FATAL: cannot read the application ledger at ${csvPath}: ${err.message}`);
      process.exit(2);
    }
  }
  const rows = text.trim() ? parseCsv(text) : [];
  const knownUrls = new Set();
  const knownCompanyTitles = new Set();

  // WHY THIS IS STATUS-AWARE (changed 2026-09-09)
  // --------------------------------------------
  // This index used to add EVERY row regardless of status, so a role that was
  // BLOCKED - never submitted - was treated as a duplicate forever.
  //
  // That stranded real work. On 2026-09-08 Infleqtion blocked solely on the
  // export-control / U.S.-Person question. The applicant supplied the answer the
  // same day (lawful permanent resident), which resolved the ONLY obstacle.
  // The role still could not re-enter a pool, because its URL sat in the
  // ledger as a blocked row. FourKites and Muon Space are stranded the same
  // way, on the same now-answered question.
  //
  // A duplicate gate exists to stop applying TWICE. A blocked row is not an
  // application - nothing was ever sent. So only rows that actually reached
  // the employer suppress a retry.
  //
  // Statuses that DO suppress: submitted (it went out), drafted and reviewed
  // (in flight - a human is mid-way through one), closed (deliberately ended).
  // Status that does NOT suppress: blocked, and discovered (never attempted).
  const SUPPRESSING = new Set(['submitted', 'drafted', 'reviewed', 'closed']);
  let retryable = 0;
  for (const r of rows) {
    const status = String(r.status ?? '')
      .trim()
      .toLowerCase();
    if (!SUPPRESSING.has(status)) {
      retryable++;
      continue;
    }
    const u = canonicalizeUrl(r.url);
    if (u) knownUrls.add(u);
    if (r.company && r.title)
      knownCompanyTitles.add(`${normalizeCompany(r.company)}::${r.title.toLowerCase().trim()}`);
  }
  if (retryable) {
    console.log(
      `note: ${retryable} ledger row(s) are blocked/discovered and do NOT suppress a retry.`,
    );
  }
  const blockerIndex = buildBlockerIndex(rows, config);
  return { knownUrls, knownCompanyTitles, blockerIndex, rowCount: rows.length };
}

let candidates;
try {
  const parsed = JSON.parse(readText(candidatesPath));
  candidates = Array.isArray(parsed) ? parsed : parsed.candidates;
  if (!Array.isArray(candidates))
    throw new Error('expected an array, or an object with a "candidates" array');
  candidates.forEach((c) => validateData('candidate', c));
} catch (err) {
  console.error(`FATAL: cannot parse ${candidatesPath}: ${err.message}`);
  process.exit(2);
}

const ledger = loadLedgerIndex(config.paths.ledgerCsv);
const blockerMemoryPath = join(dirname(config.paths.state), 'blockers.json');
try {
  ledger.structuredBlockers = readJson(blockerMemoryPath);
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
try {
  ledger.facts = readJson(config.paths.facts);
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const pool = buildPool(candidates, config, ledger);
const blockingShortfalls = pool.quotaShortfalls
  .filter((s) => s.bucket !== 'backup')
  .filter((s) => !waivedCities.includes(s.city));

// MEASURED ATS CONVERSION (added 2026-09-09)
// -----------------------------------------
// campaign.config.json calls atsPreference a "ranking tiebreaker only". The
// ledger says otherwise: across 2026-09-04 and 2026-09-08, destinations on a
// proven ATS converted 6 of 8, and destinations on unmeasured or zero-record
// platforms converted 1 of 11. Selecting on fit alone repeatedly spent slots
// on platforms that have never produced a receipt.
//
// This does NOT gate. It surfaces the number next to every destination so a
// zero-conversion pick is impossible to miss when the pool is reviewed.
let atsConversion = {};
try {
  atsConversion = atsStats(parseLedgerCsv(readText(config.paths.ledgerCsv)));
} catch {
  /* reporting only; never block validation on it */
}

function atsNote(role) {
  const a = atsOf(role.url ?? role.canonicalUrl ?? '');
  const v = atsConversion[a];
  if (!v || !v.decided) return `${a}: no ledger history yet - treat as unproven, not as safe`;
  const pct = Math.round(v.rate * 100);
  const flag = v.rate === 0 ? '  <-- NEVER produced a receipt' : '';
  return `${a}: ${v.submitted}/${v.decided} submitted (${pct}%)${flag}`;
}

if (wantJson) {
  console.log(JSON.stringify(pool, null, 2));
} else {
  const money = (n) => (n == null ? 'not posted' : `$${n.toLocaleString()}`);
  console.log(`\n=== POOL VALIDATION - ${config.campaign} (v${config.version}) ===`);
  console.log(
    `candidates in: ${candidates.length}   ledger rows checked: ${ledger.rowCount}   companies with structural blockers: ${ledger.blockerIndex.size}`,
  );
  console.log(
    `quota: ${config.cities.map((c) => `${c.label} ${c.dailyQuota}`).join('  |  ')}   total ${pool.totalQuota}`,
  );
  console.log(`poolHash: ${pool.poolHash}\n`);

  for (const city of config.cities) {
    const b = pool.byCity[city.id];
    console.log(
      `--- ${b.label} - ${b.primary.length}/${b.quota} primary, ${b.backup.length} backup ---`,
    );
    for (const [bucket, entries] of [
      ['PRIMARY', b.primary],
      ['BACKUP', b.backup],
    ]) {
      for (const e of entries) {
        const cp = e.checks.companyProfile;
        console.log(`  [${bucket}] ${e.company} - ${e.title}`);
        console.log(`      ${e.url}`);
        console.log(
          `      band=${cp.band} household=${cp.isHouseholdName} signals=${cp.validThrivingSignals} ats=${e.ats.platform}(t${e.ats.tier}) score=${e.score}`,
        );
        console.log(`      conversion: ${atsNote(e)}`);
        for (const u of e.uncertainties) console.log(`      ! ${u.check}: ${u.uncertainty}`);
        for (const n of e.notes) console.log(`      ~ ${n}`);
      }
    }
    console.log('');
  }

  if (pool.rejected.length) {
    console.log(`--- REJECTED (${pool.rejected.length}) ---`);
    for (const r of pool.rejected) {
      console.log(`  ${r.company} - ${r.title}`);
      for (const f of r.failures) console.log(`      x ${f.check}: ${f.reason}`);
    }
    console.log('');
  }

  if (pool.quotaShortfalls.length) {
    console.log('--- QUOTA SHORTFALLS ---');
    for (const s of pool.quotaShortfalls) {
      console.log(
        `  ${s.city}: ${s.bucket ?? 'primary'} needs ${s.needed}, found ${s.found} (short ${s.shortfall})`,
      );
    }
    console.log('');
  }
}

if (writeState) {
  const now = new Date();
  const campaignDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  let prior = {};
  try {
    prior = JSON.parse(readText(statePath));
  } catch {
    /* first run */
  }

  const sameDay = prior.campaignDate === campaignDate;

  // Refuse to overwrite a batch that is already approved or in flight. Rewriting
  // the pool would drop the authorization and reset the submission counters, so a
  // later submission run could redo work the user already paid for in blocked
  // attempts. Re-researching an authorized day is a deliberate act, not a default.
  if (sameDay && (prior.status === 'authorized' || prior.status === 'submitting')) {
    console.error(
      `REFUSED to write state: today's pool is already "${prior.status}".\n` +
        `  authorized: ${prior.authorization?.authorizedAt ?? 'n/a'}\n` +
        `  confirmed:  ${JSON.stringify(prior.visibleConfirmedSubmissionsToday ?? {})}\n` +
        `Finish or explicitly reset the current batch before writing a new pool.`,
    );
    process.exit(1);
  }

  // Preserve counters within the same campaign date so a re-validation cannot
  // erase submissions that really happened.
  const priorCounts = sameDay ? (prior.visibleConfirmedSubmissionsToday ?? {}) : {};

  const state = {
    campaign: config.campaign,
    campaignVersion: config.version,
    campaignDate,
    timezone: config.timezone,
    status: blockingShortfalls.length ? 'researching' : 'awaiting_authorization',
    poolHash: pool.poolHash,
    createdAt: sameDay ? (prior.createdAt ?? now.toISOString()) : now.toISOString(),
    updatedAt: now.toISOString(),
    researchOnly: true,
    authorization: null,
    dailyQuota: Object.fromEntries(config.cities.map((c) => [c.label, c.dailyQuota])),
    visibleConfirmedSubmissionsToday: Object.fromEntries(
      config.cities.map((c) => [c.label, priorCounts[c.label] ?? 0]),
    ),
    quotaShortfalls: pool.quotaShortfalls,
    waivedCities: waivedCities.length ? waivedCities : undefined,
    pool: Object.fromEntries(
      config.cities.map((c) => {
        const b = pool.byCity[c.id];
        const strip = (e) => ({
          company: e.company,
          title: e.title,
          location: e.checks.location.ok ? e.city : e.city,
          url: e.url,
          canonicalUrl: e.canonicalUrl,
          source: e.ats.platform,
          headcountBand: e.checks.companyProfile.band,
          isHouseholdName: e.checks.companyProfile.isHouseholdName,
          thrivingSignals: e.checks.companyProfile.validThrivingSignals,
          score: e.score,
          status: 'awaiting_authorization',
          uncertainties: e.uncertainties.map((u) => u.uncertainty),
          ...routeResume(
            candidates.find((r) => canonicalizeUrl(r.url) === e.canonicalUrl) ?? {},
            config,
          ),
          answers: candidates.find((r) => canonicalizeUrl(r.url) === e.canonicalUrl)?.answers ?? {},
          postingId: candidates.find((r) => canonicalizeUrl(r.url) === e.canonicalUrl)?.postingId,
        });
        return [c.label, { primary: b.primary.map(strip), backup: b.backup.map(strip) }];
      }),
    ),
    validatedBy: 'openclaw-campaign/validate-pool.mjs',
    validatedAt: now.toISOString(),
  };
  atomicJson(statePath, state);
  console.log(`state written: ${statePath}`);
}

const placedBanned = Object.values(pool.byCity)
  .flatMap((b) => [...b.primary, ...b.backup])
  .filter((e) => e.verdict === 'rejected');

if (placedBanned.length) {
  console.error(
    `FAIL: ${placedBanned.length} rejected role(s) were placed in a bucket. This is a filter bug.`,
  );
  process.exit(1);
}
if (blockingShortfalls.length) {
  console.error(
    'INCOMPLETE: at least one city has fewer primary roles than its quota. Research more before requesting authorization.',
  );
  for (const s of blockingShortfalls)
    console.error(`  ${s.city}: needs ${s.needed}, found ${s.found}`);
  console.error(
    'If a city genuinely cannot be filled, re-run with --waive-city "<label>" to accept the shortfall.',
  );
  process.exit(1);
}
if (waivedCities.length) {
  console.log(`WAIVED: ${waivedCities.join(', ')} accepted short by explicit instruction.`);
}
console.log(
  'OK: pool is clean and quota is met. Safe to present for exact-destination authorization.',
);
process.exit(0);
