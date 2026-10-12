import { loadRuntime } from '../lib/runtime.mjs';
/**
 * List every company the ledger shows as blocked by a company-level question.
 *
 * These are employers whose APPLICATION FORM asks something the applicant cannot
 * truthfully answer (export-control "U.S. Person", residential street address,
 * background-check attestation, exact degree major). The question sits on the
 * employer's form, not on one posting, so every role at that company blocks the
 * same way. Role-level dedupe cannot see this because the titles differ.
 *
 * Feed this list into research prompts so quota slots are not spent on
 * guaranteed blocks.
 *
 * Usage: node tools/list-blockers.mjs [--json]
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildBlockerIndex } from '../lib/role-filter.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const readText = (p) => readFileSync(p, 'utf8').replace(/^﻿/, '');
const { config } = loadRuntime();
const wantJson = process.argv.includes('--json');

/** Minimal RFC4180 parser; the ledger quotes commas and newlines inside notes. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.trim());
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const rows = parseCsv(readText(config.paths.ledgerCsv));
const index = buildBlockerIndex(rows, config);
const entries = [...index.values()].sort((a, b) => a.company.localeCompare(b.company));

if (wantJson) {
  console.log(JSON.stringify(entries, null, 2));
} else if (entries.length === 0) {
  console.log('No companies with structural blockers recorded.');
} else {
  console.log(`${entries.length} compan${entries.length === 1 ? 'y' : 'ies'} blocked by a company-level form question:\n`);
  for (const e of entries) {
    console.log(`  ${e.company}`);
    console.log(`      matched:  "${e.matched}"`);
    console.log(`      first hit: ${e.title} (${e.timestamp})`);
  }
  console.log('\nDo not spend a quota slot on these unless the underlying fact becomes available.');
  console.log('To retry one deliberately, set retryKnownBlocker: true on that candidate.');
}
