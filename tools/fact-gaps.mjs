import { loadRuntime } from '../lib/runtime.mjs';
/**
 * Rank the missing personal facts by how many applications they have blocked.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-08-19, 9 applications were attempted: 2 submitted, 7 blocked. Exactly
 * ONE block was a CAPTCHA. The other six were questions the applicant could
 * answer in seconds but the system is forbidden to guess.
 *
 * That reframes the whole campaign. More research does not help when the pool
 * already contains valid destinations and the forms stop on "what school did
 * you attend". This report makes the real bottleneck visible and ranked, so the
 * highest-leverage next action is obvious.
 *
 * Nothing here invents an answer. It only counts what has blocked, and names
 * the question verbatim so the applicant can decide once and reuse it.
 *
 * Usage: node tools/fact-gaps.mjs [--days N] [--json out.json]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const readText = (p) => readFileSync(p, 'utf8').replace(/^﻿/, '');
const { config } = loadRuntime();

const args = process.argv.slice(2);
const days = Number(args[args.indexOf('--days') + 1]) || null;
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.trim());
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/**
 * Each gap is one decision the applicant can make once and reuse everywhere.
 * `askable` marks the ones that are a simple answer rather than a policy change.
 */
const GAPS = [
  {
    id: 'education-detail',
    label: 'Education detail: school, degree, discipline, start/end dates',
    askable: true,
    resolution: 'Supply the four fields once. They are reusable on every ATS.',
    patterns: [/\bschool\b/i, /\bdegree\b/i, /\bdiscipline\b/i, /degree major/i, /closely related field/i, /\bgpa\b/i, /graduation date/i, /education history/i],
  },
  {
    id: 'citizenship-status',
    label: 'Citizenship / work-authorization status (the specific value)',
    askable: true,
    resolution: 'Forms want a value like Citizen / Green Card / H-1B / F-1 / STEM OPT, not just "authorized to work".',
    patterns: [/u\.s\. person/i, /export.?control/i, /citizenship/i, /permanent resident/i, /green ?card/i, /stem opt/i, /\bh-?1-?b\b/i, /immigration status/i, /employement status/i, /employment status\?/i],
  },
  {
    id: 'prior-employment',
    label: 'Have you previously worked at this employer?',
    askable: true,
    resolution: 'Almost certainly "No" for employers never worked at. One standing answer covers all of them.',
    patterns: [/previously worked/i, /prior employment/i, /former employee/i, /worked (for|at) (this|the) (organization|company)/i],
  },
  {
    id: 'employee-relationship',
    label: 'Do you have relatives or close friends employed here?',
    askable: true,
    resolution: 'Same shape as prior employment. One standing answer covers all of them.',
    patterns: [/relatives/i, /close personal relation/i, /friends, roommates/i, /family member.*employed/i],
  },
  {
    id: 'residential-address',
    label: 'Residential street address and ZIP',
    askable: false,
    resolution: 'Deliberate privacy rule. Stays blocked unless a mailing address is supplied and authorized.',
    patterns: [/street address/i, /full address/i, /home address/i, /\bzip code\b/i, /postal code/i, /address line 1/i],
  },
  {
    id: 'legal-consent',
    label: 'Background check / arbitration / legal attestation',
    askable: false,
    resolution: 'Needs an explicit consent decision, per employer or as a policy.',
    patterns: [/background.?check/i, /fingerprint/i, /arbitration/i, /attestation/i, /legal signature/i, /e-?signature/i],
  },
  {
    id: 'data-consent',
    label: 'Marketing / data-use / AI-screening consent',
    askable: true,
    resolution: 'Decide once: opt in or out of marketing and AI screening checkboxes.',
    patterns: [/marketing/i, /data-use/i, /privacy policy/i, /ai-powered/i, /ai screening/i, /candidate-data processing/i],
  },
  {
    id: 'captcha',
    label: 'CAPTCHA / human verification',
    askable: false,
    resolution: 'Human-only by design. Finish in the open browser tab.',
    patterns: [/captcha/i, /are you human/i, /drag the shape/i],
  },
  {
    id: 'account-login',
    label: 'Account creation / sign-in / MFA',
    askable: false,
    resolution: 'Sign in manually once per ATS, then re-run.',
    patterns: [/account creation/i, /create an account/i, /sign in/i, /\bmfa\b/i, /verification code/i],
  },
];

const rows = parseCsv(readText(config.paths.ledgerCsv));
const cutoff = days ? Date.now() - days * 86_400_000 : null;
const blocked = rows.filter((r) => {
  if (r.status !== 'blocked') return false;
  if (!cutoff) return true;
  const t = Date.parse(r.timestamp);
  return Number.isFinite(t) && t >= cutoff;
});

const tally = new Map(GAPS.map((g) => [g.id, { ...g, hits: [] }]));
const unmatched = [];

for (const r of blocked) {
  const notes = r.notes ?? '';
  const matched = GAPS.filter((g) => g.patterns.some((p) => p.test(notes)));
  if (!matched.length) { unmatched.push(r); continue; }
  for (const g of matched) {
    tally.get(g.id).hits.push({ company: r.company, title: r.title, date: (r.timestamp || '').slice(0, 10) });
  }
}

const ranked = [...tally.values()].filter((g) => g.hits.length).sort((a, b) => b.hits.length - a.hits.length);
const askable = ranked.filter((g) => g.askable);
const unblockable = askable.reduce((n, g) => n + new Set(g.hits.map((h) => h.company)).size, 0);

console.log(`\n=== FACT GAPS — ${blocked.length} blocked application(s)${days ? ` in the last ${days} days` : ''} ===\n`);

for (const g of ranked) {
  const companies = [...new Set(g.hits.map((h) => h.company))];
  console.log(`${String(g.hits.length).padStart(3)}x  ${g.askable ? '[ASKABLE]' : '[policy] '}  ${g.label}`);
  console.log(`      blocked: ${companies.join(', ')}`);
  console.log(`      ${g.resolution}`);
  console.log('');
}

if (unmatched.length) {
  console.log(`--- ${unmatched.length} blocker(s) not matched by any known gap ---`);
  for (const r of unmatched.slice(0, 8)) console.log(`  ${r.company}: ${(r.notes || '').slice(0, 120)}`);
  console.log('');
}

console.log('=== HIGHEST-LEVERAGE ACTION ===');
if (askable.length) {
  console.log(`Answering ${askable.length} question${askable.length === 1 ? '' : 's'} would unblock roughly ${unblockable} application(s):`);
  for (const g of askable) console.log(`  - ${g.label}`);
  console.log('\nAdd confirmed answers to the approved-applicant-facts list in');
  console.log('OPENCLAW_JOB_APPLICATION_AUTOMATION_SUMMARY.md. Never guess them.');
} else {
  console.log('No askable gaps outstanding.');
}

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({
    generatedAt: new Date().toISOString(), blockedCount: blocked.length,
    gaps: ranked.map((g) => ({ id: g.id, label: g.label, askable: g.askable, count: g.hits.length, companies: [...new Set(g.hits.map((h) => h.company))] })),
    unmatched: unmatched.map((r) => ({ company: r.company, notes: r.notes })),
  }, null, 2), 'utf8');
  console.log(`\nwrote ${jsonOut}`);
}
