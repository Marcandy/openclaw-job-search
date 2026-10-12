import { loadRuntime } from '../lib/runtime.mjs';
/**
 * Append one row to the application ledger CSV. Never overwrites existing rows.
 *
 * Usage:
 *   node tools/append-ledger.mjs --company "Acme" --title "Engineer" \
 *     --location "Chicago, IL" --url "https://..." --source "Ashby" \
 *     --status submitted --resume "Resume_General.pdf" \
 *     --notes "Visible receipt: ..."
 *
 * Columns: timestamp,company,title,location,url,source,status,resume_used,notes
 * Timestamp defaults to now (America/New_York offset ISO). Status must be one of
 * the known ledger values (see check-ledger.mjs).
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const readText = (p) => readFileSync(p, 'utf8').replace(/^﻿/, '');
const { config } = loadRuntime();

const args = process.argv.slice(2);
const get = (k) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const KNOWN = new Set(['submitted', 'blocked', 'drafted', 'reviewed', 'approved', 'rejected', 'withdrawn', 'closed', 'discovered']);
const status = get('status');
if (!status || !KNOWN.has(status)) {
  console.error(`FATAL: --status must be one of ${[...KNOWN].join(', ')}`);
  process.exit(2);
}
if (status === 'submitted') {
  console.error('REFUSED: submitted events require the manifest-bound submission worker and receipt. Export its events into the CSV ledger.');
  process.exit(1);
}
for (const k of ['company', 'title', 'location', 'url', 'source']) {
  if (!get(k)) { console.error(`FATAL: --${k} is required`); process.exit(2); }
}

const ts = get('timestamp') ?? new Date().toISOString();
const fields = [ts, get('company'), get('title'), get('location'), get('url'), get('source'), status, get('resume') ?? '', get('notes') ?? ''];
const csv = fields.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(',');
appendFileSync(config.paths.ledgerCsv, csv + '\n');
console.log(`appended: ${status} — ${get('company')} — ${get('title')}`);
