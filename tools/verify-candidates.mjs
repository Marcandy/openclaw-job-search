import { loadRuntime } from '../lib/runtime.mjs';
/**
 * Cross-check every recorded candidate claim against the LIVE posting.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-08-19 two candidates reached primary slots on values that were not
 * true:
 *
 *   Kai Cyber   recorded $140,000-$190,000. The posting states no salary at all.
 *   Super Micro recorded headcount 5,000 - exactly the San Jose ceiling. The
 *               real figure is 6,238, which exceeds it.
 *
 * Both were caught by a human opening the page. The gates could not catch them
 * because a fabricated value that is *plausible* passes every predicate. The
 * research agent supplies a believable number when it cannot verify one, and
 * "believable" is precisely what the filters cannot distinguish from "true".
 *
 * So: verify the claim, not the shape of the claim. This fetches each posting
 * and reports where the recorded data and the page disagree.
 *
 * It is a REPORTER, not a gate. Network failures and bot-walls are common and
 * must not silently drop a good role. Read the output and act on it.
 *
 * Usage:
 *   node tools/verify-candidates.mjs <candidates.json> [--json out.json] [--fix]
 *
 *   --fix  null out salary fields the posting does not corroborate, and clear
 *          verifiedActiveOn on postings that look closed. Never invents values.
 *
 * Exit: 0 no discrepancies · 1 discrepancies found · 2 bad input
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { detectApplyMethod } from '../lib/apply-method.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const readText = (p) => readFileSync(p, 'utf8').replace(/^﻿/, '');
const { config } = loadRuntime();

const args = process.argv.slice(2);
const candidatesPath = args.find((a) => !a.startsWith('--'));
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const doFix = args.includes('--fix');

if (!candidatesPath) {
  console.error(
    'usage: node tools/verify-candidates.mjs <candidates.json> [--json out.json] [--fix]',
  );
  process.exit(2);
}

/** Strip markup so numbers and phrases can be matched against visible text. */
function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Does a salary figure appear on the page in any common rendering?
 * 140000 may be written 140,000 / $140,000 / 140K / 140k / 140.
 */
function salaryAppears(text, amount) {
  if (amount == null) return null;
  const n = Math.round(amount);
  const variants = new Set([String(n), n.toLocaleString('en-US'), `$${n.toLocaleString('en-US')}`]);
  if (n >= 1000 && n % 1000 === 0) {
    const k = n / 1000;
    variants.add(`${k}k`);
    variants.add(`${k}K`);
    variants.add(`$${k}k`);
    variants.add(`$${k}K`);
  }
  const hay = text.toLowerCase();
  return [...variants].some((v) => hay.includes(v.toLowerCase()));
}

const CLOSED_MARKERS = [
  'no longer accepting',
  'no longer available',
  'position has been filled',
  'this job is closed',
  'posting is closed',
  'job is no longer',
  'we are no longer',
  'application deadline has passed',
  'req is closed',
];

/**
 * Ashby renders client-side, so an HTML read returns almost nothing. It also
 * publishes a public job-board API, which is a better source anyway: structured
 * title, location, and compensation straight from the ATS.
 * Ashby posting URLs look like https://jobs.ashbyhq.com/{org}/{uuid}
 */
async function fetchAshbyPosting(url) {
  const m = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i);
  if (!m) return null;
  const [, org, id] = m;
  const api = `https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(api, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return { status: res.status, text: '', viaApi: true };
    const body = await res.json();
    const job = (body.jobs ?? []).find((j) => String(j.id).toLowerCase() === id.toLowerCase());
    if (!job) {
      // The board loaded but this posting is not on it any more.
      return { status: 404, text: '', viaApi: true };
    }
    // Flatten the structured record into text the comparators can search.
    const parts = [
      job.title,
      job.location,
      job.department,
      job.employmentType,
      job.descriptionPlain ?? '',
      JSON.stringify(job.compensation ?? {}),
      JSON.stringify(job.secondaryLocations ?? []),
    ];
    return { status: 200, text: parts.filter(Boolean).join(' | '), viaApi: true };
  } catch (err) {
    return { status: 0, error: `${err.name}: ${err.message}`, text: '', viaApi: true };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPosting(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        // Some ATS hosts refuse an obviously scripted client. This is a plain
        // read of a public page, not an attempt to defeat a bot wall - a 403 is
        // reported as unverifiable rather than worked around.
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    const body = res.ok ? await res.text() : '';
    return { status: res.status, finalUrl: res.url, text: body ? toText(body) : '' };
  } catch (err) {
    return { status: 0, error: `${err.name}: ${err.message}`, text: '' };
  } finally {
    clearTimeout(timer);
  }
}

/** Compare one candidate against its live page. */
function compare(candidate, page) {
  const findings = [];
  const text = page.text;
  const lower = text.toLowerCase();

  if (page.status === 0) {
    findings.push({
      level: 'unverifiable',
      field: 'fetch',
      detail: `could not fetch: ${page.error}`,
    });
    return findings;
  }
  if (page.status === 404 || page.status === 410) {
    findings.push({
      level: 'error',
      field: 'liveness',
      detail: `HTTP ${page.status} — posting is gone`,
    });
    return findings;
  }
  if (page.status === 403 || page.status === 401) {
    findings.push({
      level: 'unverifiable',
      field: 'fetch',
      detail: `HTTP ${page.status} — host refuses scripted reads; verify in the browser`,
    });
    return findings;
  }
  if (page.status >= 400) {
    findings.push({ level: 'warn', field: 'fetch', detail: `HTTP ${page.status}` });
    return findings;
  }
  if (text.length < 400) {
    findings.push({
      level: 'unverifiable',
      field: 'fetch',
      detail: `page rendered only ${text.length} chars (likely JS-only); verify in the browser`,
    });
    return findings;
  }

  const closed = CLOSED_MARKERS.find((m) => lower.includes(m));
  if (closed) findings.push({ level: 'error', field: 'liveness', detail: `page says "${closed}"` });

  // Can this posting actually be applied to? A role with no application form
  // can never produce the visible receipt a submission requires, so it must
  // never occupy a slot. See lib/apply-method.mjs for the Flotive AI case.
  const apply = detectApplyMethod(candidate.url ?? candidate.canonicalUrl ?? '', text);
  if (!apply.ok) {
    findings.push({ level: 'error', field: 'applyMethod', detail: apply.detail });
  } else if (apply.method === 'unknown') {
    findings.push({ level: 'warn', field: 'applyMethod', detail: apply.detail });
  }

  // Title: match on distinctive words rather than the whole string, since
  // boards often reformat punctuation and suffixes.
  const words =
    String(candidate.title ?? '')
      .toLowerCase()
      .match(/[a-z]{4,}/g) ?? [];
  const hits = words.filter((w) => lower.includes(w));
  if (words.length && hits.length / words.length < 0.5) {
    findings.push({
      level: 'warn',
      field: 'title',
      detail: `only ${hits.length}/${words.length} title words found on the page`,
    });
  }

  // Salary: the Kai Cyber failure mode.
  for (const [field, amount] of [
    ['salaryMin', candidate.salaryMin],
    ['salaryMax', candidate.salaryMax],
  ]) {
    if (amount == null) continue;
    if (!salaryAppears(text, amount)) {
      findings.push({
        level: 'error',
        field,
        detail: `recorded ${field}=${amount.toLocaleString('en-US')} does not appear anywhere on the posting`,
      });
    }
  }

  // A page with no currency symbol at all cannot be corroborating a salary.
  if (
    (candidate.salaryMin != null || candidate.salaryMax != null) &&
    !/\$|USD|salary|compensation|pay range/i.test(text)
  ) {
    findings.push({
      level: 'warn',
      field: 'salary',
      detail: 'posting shows no compensation language at all, yet a salary is recorded',
    });
  }

  // Headcount sitting exactly on the city ceiling is the Super Micro pattern.
  const city = config.cities.find((c) => c.id === candidate.cityId);
  const ceiling = city?.companyProfileOverride?.primaryHeadcountMax ?? 1000;
  const hc = candidate.companyProfile?.headcount;
  if (typeof hc === 'number' && hc === ceiling) {
    findings.push({
      level: 'warn',
      field: 'headcount',
      detail: `headcount equals the ${city.label} ceiling exactly (${ceiling.toLocaleString('en-US')}) — verify against a public source`,
    });
  }

  return findings;
}

const data = JSON.parse(readText(candidatesPath));
const candidates = Array.isArray(data) ? data : data.candidates;
if (!Array.isArray(candidates)) {
  console.error('expected a candidates array');
  process.exit(2);
}

console.log(`\n=== VERIFYING ${candidates.length} CANDIDATE(S) AGAINST LIVE POSTINGS ===\n`);

const results = [];
for (const c of candidates) {
  // Prefer a structured ATS API where one exists; fall back to reading HTML.
  const page = (await fetchAshbyPosting(c.url)) ?? (await fetchPosting(c.url));
  const findings = compare(c, page);
  results.push({ company: c.company, title: c.title, url: c.url, status: page.status, findings });

  const errs = findings.filter((f) => f.level === 'error');
  const warns = findings.filter((f) => f.level === 'warn');
  const unv = findings.filter((f) => f.level === 'unverifiable');
  const mark = errs.length ? 'FAIL' : warns.length ? 'WARN' : unv.length ? '????' : ' OK ';
  console.log(`[${mark}] ${c.company} — ${c.title}`);
  for (const f of findings) console.log(`         ${f.level}: ${f.field} — ${f.detail}`);

  if (doFix) {
    for (const f of errs) {
      if (f.field === 'salaryMin') {
        c.salaryMin = null;
        c.salaryCorrection =
          (c.salaryCorrection ?? '') + ' [verifier nulled salaryMin: not present on posting]';
      }
      if (f.field === 'salaryMax') {
        c.salaryMax = null;
        c.salaryCorrection =
          (c.salaryCorrection ?? '') + ' [verifier nulled salaryMax: not present on posting]';
      }
      if (f.field === 'liveness') {
        delete c.verifiedActiveOn;
        c.livenessNote = f.detail;
      }
    }
  }
}

const failed = results.filter((r) => r.findings.some((f) => f.level === 'error'));
const warned = results.filter((r) => r.findings.some((f) => f.level === 'warn'));
const unver = results.filter((r) => r.findings.some((f) => f.level === 'unverifiable'));

console.log(
  `\n--- ${results.length} checked · ${failed.length} failed · ${warned.length} warned · ${unver.length} unverifiable ---`,
);
if (unver.length)
  console.log(
    'Unverifiable means the host blocked a scripted read, not that the role is bad. Check those in the browser.',
  );

if (doFix) {
  writeFileSync(candidatesPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`\napplied --fix to ${candidatesPath} (values only ever nulled, never invented)`);
}
if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2),
    'utf8',
  );
  console.log(`wrote ${jsonOut}`);
}

process.exit(failed.length ? 1 : 0);
