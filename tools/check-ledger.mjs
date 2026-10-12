import { loadRuntime } from '../lib/runtime.mjs';
/**
 * Ledger integrity check.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-09-14 a Gateway disconnect (1006) mid-run triggered an embedded-agent
 * fallback that RE-SUBMITTED to Muon Space and Tradepost (Backend) minutes after
 * the first run had already applied - a real duplicate-application incident.
 * Nothing in the tooling noticed; a human reading the CSV caught it.
 *
 * A duplicate gate stops a role entering a pool twice. Nothing watched the other
 * direction: the same destination being SUBMITTED twice in one day. This tool is
 * that watchdog, plus a row-shape linter, because a ledger row with shifted
 * columns silently breaks dedupe and every statistic derived from the file.
 *
 * Checks, in order:
 *   1. header is exactly the 9 expected columns
 *   2. every row has exactly 9 fields (a shifted column breaks dedupe by URL)
 *   3. timestamp parses as a date
 *   4. url starts with http(s) - catches columns shifted left/right
 *   5. status is one of the known values from the submission spec
 *   6. no canonical URL is marked "submitted" twice on the same calendar day
 *      (cross-day duplicates are deliberate retries and are reported, not failed)
 *
 * Usage:
 *   node tools/check-ledger.mjs            human report
 *   node tools/check-ledger.mjs --json     machine-readable
 *
 * Exit: 0 clean | 1 problems found | 2 bad input.
 * Importing this module must stay silent (see ats-stats.mjs note, 2026-09-09).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCsv } from './ats-stats.mjs';
import { canonicalizeUrl } from '../lib/role-filter.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const readText = (p) => readFileSync(p, 'utf8').replace(/^﻿/, '');
const { config } = loadRuntime();

export const EXPECTED_HEADER = ['timestamp', 'company', 'title', 'location', 'url', 'source', 'status', 'resume_used', 'notes'];
export const KNOWN_STATUSES = new Set(['submitted', 'blocked', 'drafted', 'reviewed', 'approved', 'rejected', 'withdrawn', 'closed', 'discovered']);

/** Audit parsed CSV rows. Returns { problems: [...], duplicateSubmissions: [...] }. */
export function auditLedger(rows) {
  const problems = [];
  const duplicateSubmissions = [];
  const header = rows[0] ?? [];
  if (EXPECTED_HEADER.some((h, i) => header[i] !== h) || header.length !== EXPECTED_HEADER.length) {
    problems.push({ line: 1, kind: 'header', detail: `expected ${EXPECTED_HEADER.join(',')} — got ${header.join(',')}` });
    return { problems, duplicateSubmissions };
  }

  const seen = new Map(); // `${day}|${canonicalUrl}` -> first line number
  const crossDay = new Map(); // canonicalUrl -> {days:Set, lines:[]}

  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    if (!r || r.every((f) => !String(f).trim())) return;
    if (r.length !== EXPECTED_HEADER.length) {
      problems.push({ line, kind: 'field-count', detail: `${r.length} fields, expected 9` });
      return; // columns unreliable past this point
    }
    const [timestamp, company, title, , url, , status] = r;
    if (!/^\d{4}-\d{2}-\d{2}/.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
      problems.push({ line, kind: 'timestamp', detail: `unparseable timestamp: ${timestamp}` });
    }
    if (url && !/^https?:\/\//i.test(url)) {
      problems.push({ line, kind: 'url', detail: `url column is not a URL: ${url.slice(0, 80)}` });
    }
    if (status && !KNOWN_STATUSES.has(status.trim())) {
      problems.push({ line, kind: 'status', detail: `unknown status: ${status}` });
    }
    if (status === 'submitted' && url) {
      const day = timestamp.slice(0, 10);
      const key = `${day}|${canonicalizeUrl(url)}`;
      if (seen.has(key)) {
        duplicateSubmissions.push({
          kind: 'same-day-duplicate',
          company, title, url,
          lines: [seen.get(key), line],
          detail: `submitted twice on ${day} (lines ${seen.get(key)} and ${line})`,
        });
      } else {
        seen.set(key, line);
      }
      const canon = canonicalizeUrl(url);
      const rec = crossDay.get(canon) ?? { days: new Set(), lines: [], company, title, url };
      rec.days.add(day); rec.lines.push(line);
      crossDay.set(canon, rec);
    }
  });

  for (const rec of crossDay.values()) {
    if (rec.days.size > 1) {
      duplicateSubmissions.push({
        kind: 'cross-day-repeat', company: rec.company, title: rec.title, url: rec.url,
        days: [...rec.days], lines: rec.lines,
        detail: `submitted on ${rec.days.size} different days (lines ${rec.lines.join(', ')}) - verify each was deliberate`,
      });
    }
  }
  return { problems, duplicateSubmissions };
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const asJson = process.argv.includes('--json');
  let rows;
  try {
    rows = parseCsv(readText(config.paths.ledgerCsv));
  } catch (err) {
    console.error(`FATAL: cannot read ledger at ${config.paths.ledgerCsv}: ${err.message}`);
    process.exit(2);
  }
  const { problems, duplicateSubmissions } = auditLedger(rows);
  const sameDay = duplicateSubmissions.filter((d) => d.kind === 'same-day-duplicate');
  const crossDay = duplicateSubmissions.filter((d) => d.kind === 'cross-day-repeat');
  const ok = problems.length === 0 && sameDay.length === 0;

  if (asJson) {
    console.log(JSON.stringify({ ok, rowCount: rows.length - 1, problems, duplicateSubmissions }, null, 2));
  } else {
    console.log(`\n=== LEDGER INTEGRITY (${rows.length - 1} rows) ===\n`);
    if (!problems.length) console.log('  Row shape: OK - header, field counts, timestamps, URLs, statuses all valid.');
    for (const p of problems) console.log(`  [PROBLEM] line ${p.line} (${p.kind}): ${p.detail}`);
    if (!sameDay.length) console.log('  Same-day duplicate submissions: none.');
    for (const d of sameDay) console.log(`  [DUPLICATE] ${d.company} — ${d.title}: ${d.detail}`);
    for (const d of crossDay) console.log(`  [note] ${d.company} — ${d.title}: ${d.detail}`);
    console.log(ok ? '\n  CLEAN' : '\n  NOT CLEAN - investigate before the next submission run.');
  }
  process.exit(ok ? 0 : 1);
}
