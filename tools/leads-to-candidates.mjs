import { loadRuntime } from '../lib/runtime.mjs';
/**
 * Turn a discovery sweep into a triage worksheet for the research agent.
 *
 * discovery/discover.py casts a wide net by location and returns AGGREGATOR
 * leads. Those are never valid application destinations. This tool applies the
 * cheap deterministic gates that need no extra research (city match, title
 * tokens, banned levels, staffing intermediaries) so the agent only spends
 * effort verifying companies that can actually reach the pool.
 *
 * What survives here is still only a LEAD. The agent must still:
 *   1. resolve it to the official employer or ATS URL,
 *   2. research headcount, household-name status, and a dated thriving signal,
 *   3. confirm the posting is live today.
 *
 * Usage: node tools/leads-to-candidates.mjs <leads.json> [cityId] [--json out]
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  checkTitle,
  checkRoleRelevance,
  checkLocation,
  normalizeCompany,
  canonicalizeUrl,
  buildBlockerIndex,
  checkKnownBlocker,
} from '../lib/role-filter.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const readText = (p) => readFileSync(p, 'utf8').replace(/^﻿/, '');
const { config } = loadRuntime();

/**
 * Minimal CSV read so triage can consult the ledger's known-blocker companies.
 * These are employers whose FORM asks something unanswerable, so every role at
 * them is a guaranteed waste regardless of how good the posting looks.
 */
function parseCsvRows(text) {
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

let blockerIndex = new Map();
try {
  blockerIndex = buildBlockerIndex(
    parseCsvRows(readText(process.env.CAMPAIGN_LEDGER_PATH ?? config.paths.ledgerCsv)),
    config,
  );
} catch {
  /* ledger unreadable: skip this check rather than fail triage */
}

/**
 * Everything the ledger and prior sweeps already know.
 *
 * WHY THIS EXISTS
 * ---------------
 * Measured on the 2026-08-20..24 sweeps, 53-68% of each day's leads are the
 * SAME leads as the day before. Triage previously read the ledger only to build
 * the known-blocker index, so two costs were paid again every morning:
 *
 *   1. roles already submitted were re-presented as fresh survivors;
 *   2. the single most expensive step in the pipeline - resolving an aggregator
 *      lead to the employer's official ATS URL - was redone for companies whose
 *      URL was already sitting in the ledger or in a prior candidates-*.json.
 *
 * So: index both. `appliedIndex` drops company+title pairs already spent.
 * `resolvedIndex` hands the agent a URL it already earned.
 *
 * Neither index is allowed to invent anything: every URL here was previously
 * verified and written down by a run that saw the live posting.
 */
const normTitle = (t) =>
  (t ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const pairKey = (company, title) => `${normalizeCompany(company)}::${normTitle(title)}`;

const appliedIndex = new Map(); // company+title -> ledger status
const resolvedIndex = new Map(); // company+title -> official URL seen before
let ledgerRows = [];
try {
  ledgerRows = parseCsvRows(readText(process.env.CAMPAIGN_LEDGER_PATH ?? config.paths.ledgerCsv));
} catch {
  /* ledger unreadable: indexes stay empty rather than failing triage */
}

for (const row of ledgerRows) {
  const key = pairKey(row.company, row.title);
  // Match validate-pool: blocked/discovered are not duplicates. Known blockers still filter separately.
  if (['submitted', 'reviewed', 'closed', 'drafted'].includes(row.status)) {
    appliedIndex.set(key, row.status);
  }
  if (row.url && /^https?:/i.test(row.url)) resolvedIndex.set(key, row.url);
}

// Prior candidate pools carry official URLs for roles that never reached the
// ledger, which is exactly the resolution work worth not repeating.
try {
  const dir = join(here, '..');
  for (const f of readdirSync(dir).filter((f) => /^candidates-.*.json$/.test(f))) {
    let doc;
    try {
      doc = JSON.parse(readText(join(dir, f)));
    } catch {
      continue;
    }
    const list = Array.isArray(doc) ? doc : (doc.candidates ?? doc.roles ?? []);
    for (const c of list) {
      const url = c.url ?? c.applyUrl;
      if (!c.company || !url || !/^https?:/i.test(url)) continue;
      const key = pairKey(c.company, c.title);
      if (!resolvedIndex.has(key)) resolvedIndex.set(key, url);
    }
  }
} catch {
  /* prior pools optional */
}

/**
 * Household-name detection, mirroring checkCompanyProfile's two-pass match.
 * A household name can never hold a primary slot, so proposing one wastes a slot.
 */
const denyList = config.companyProfileFilter?.householdNameDenyList ?? [];
function householdNameHit(company) {
  const normalized = normalizeCompany(company);
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  return denyList.find((entry) => {
    const e = normalizeCompany(entry);
    if (!e) return false;
    if (
      normalized === e ||
      normalized.startsWith(`${e} `) ||
      normalized.endsWith(` ${e}`) ||
      normalized.includes(` ${e} `)
    )
      return true;
    const ce = e.replace(/[^a-z0-9]/g, '');
    return ce.length >= 6 && compact.includes(ce);
  });
}

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
/**
 * Positional args are everything that is neither a flag nor a flag's VALUE.
 * Without excluding the --json value, `--json out.json` put the output path in
 * positional slot 1, where it was read as a cityId. Every city then failed the
 * `no city "out.json"` lookup and the written file contained an empty cities
 * object, silently, with exit 0.
 */
const positional = args.filter(
  (a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--json'),
);
const leadsPath = positional[0];
const cityArg = positional[1];

if (!leadsPath) {
  console.error(
    'usage: node tools/leads-to-candidates.mjs <leads.json> [cityId] [--json out.json]',
  );
  process.exit(2);
}

/**
 * IT services firms and consultancies that staff client sites. The campaign
 * excludes intermediaries because the applicant would not be an employee of the
 * company whose work is described.
 */
const INTERMEDIARIES = [
  'robert half',
  'tata consultancy',
  'tcs',
  'infosys',
  'wipro',
  'cognizant',
  'capgemini',
  'accenture',
  'ntt data',
  'hcl',
  'dxc',
  'exl service',
  'orion innovation',
  'insight global',
  'teksystems',
  'randstad',
  'adecco',
  'kforce',
  'apex systems',
  'motion recruitment',
  'jobot',
  'cybercoders',
  'dice',
  'recruiting from scratch',
  'shields group',
  'stott and may',
  'the phoenix group',
  'sapphire partners',
  'thedatajob',
  'sweep360',
  'upskill',
  'staffing',
  'consulting group',
  'talent',
  'search partners',
  'recruiters',
  'staffmark',
  'gac solutions',
  'gacsol',
  'collabera',
  'mastech',
  'synechron',
  'ust global',
  'diverse lynx',
  'photon',
  'ltimindtree',
  'virtusa',
  'zensar',
  'iris software',
];

const report = JSON.parse(readText(leadsPath));
const cityIds = cityArg ? [cityArg] : Object.keys(report.cities ?? {});

const out = { source: leadsPath, generatedAt: new Date().toISOString(), cities: {} };

for (const cityId of cityIds) {
  const bucket = report.cities?.[cityId];
  if (!bucket) {
    console.error(`no city "${cityId}" in ${leadsPath}`);
    continue;
  }
  const city = config.cities.find((c) => c.id === cityId);
  if (!city) {
    console.error(`unknown cityId "${cityId}" in config`);
    continue;
  }

  const kept = [],
    dropped = [];
  for (const lead of bucket.leads ?? []) {
    const reasons = [];

    const loc = checkLocation({ location: lead.location }, city);
    if (!loc.ok) reasons.push(`location: ${loc.reason}`);

    const title = checkTitle(lead.title, config);
    if (!title.ok) reasons.push(`title: ${title.reason}`);

    const rel = checkRoleRelevance({ title: lead.title }, config);
    if (!rel.ok) reasons.push(`roleRelevance: ${rel.reason}`);

    const norm = normalizeCompany(lead.company);
    const inter = INTERMEDIARIES.find((i) => norm.includes(normalizeCompany(i)));
    if (inter) reasons.push(`intermediary: matches "${inter}"`);
    if (!lead.company || lead.company === 'nan') reasons.push('company: missing');

    // Both of these need only the company name, so running them here saves the
    // research agent from investigating leads that cannot reach a primary slot.
    const household = householdNameHit(lead.company);
    if (household) reasons.push(`householdName: matches deny-list entry "${household}"`);

    const blocked = checkKnownBlocker({ company: lead.company }, config, blockerIndex);
    if (!blocked.ok) reasons.push(`knownBlocker: ${blocked.reason}`);

    // Already spent. The pool-level duplicate rule would catch this later, but
    // only after the agent had paid to research it.
    const key = pairKey(lead.company, lead.title);
    const already = appliedIndex.get(key);
    if (already) reasons.push(`alreadyInLedger: ${already}`);

    const knownUrl = resolvedIndex.get(pairKey(lead.company, lead.title)) ?? null;
    (reasons.length ? dropped : kept).push({
      ...lead,
      knownOfficialUrl: knownUrl,
      dropReasons: reasons,
    });
  }

  out.cities[cityId] = {
    label: city.label,
    quota: city.dailyQuota,
    leadsIn: bucket.leads?.length ?? 0,
    survivors: kept.length,
    survivorsWithEmployerUrl: kept.filter((k) => k.employerUrl && k.employerUrl !== 'nan').length,
    survivorsWithPreviouslyResolvedUrl: kept.filter(
      (k) => !(k.employerUrl && k.employerUrl !== 'nan') && k.knownOfficialUrl,
    ).length,
    leads: kept,
  };

  console.log(`\n=== ${city.label} — quota ${city.dailyQuota} ===`);
  console.log(`leads in: ${bucket.leads?.length ?? 0}   survived cheap gates: ${kept.length}`);
  if (kept.length) {
    console.log('\nSURVIVORS — still need employer URL, headcount, and a thriving signal:');
    for (const k of kept) {
      console.log(`  ${k.company}`);
      console.log(`      ${k.title}   [${k.location}]`);
      const direct = k.employerUrl && k.employerUrl !== 'nan' ? k.employerUrl : null;
      if (direct) console.log(`      employer URL: ${direct}`);
      else if (k.knownOfficialUrl)
        console.log(
          `      employer URL: ${k.knownOfficialUrl}   [resolved in a previous run — re-confirm it is still live]`,
        );
      else console.log('      employer URL: NOT EXPOSED — must be found manually');
    }
  } else {
    console.log('\nNo lead survived. This city cannot be filled from this sweep.');
  }

  // Summarize why things were dropped: that is the actionable diagnostic.
  const tally = {};
  for (const d of dropped)
    for (const r of d.dropReasons) {
      const key = r.split(':')[0];
      tally[key] = (tally[key] ?? 0) + 1;
    }
  console.log(
    '\ndrop reasons:',
    Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join('  '),
  );
}

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\nwrote ${jsonOut}`);
}
