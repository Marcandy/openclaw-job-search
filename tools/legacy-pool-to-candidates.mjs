#!/usr/bin/env node
/**
 * Convert a legacy newark-san-jose-3x2 state file into the v2 candidates format
 * so the old pool can be replayed through the new gate.
 *
 * This is a diagnostic, not part of the production path. It deliberately does
 * NOT invent companyProfile data: fields the legacy pool never captured are
 * emitted as absent, which is exactly why those roles now fail the gate.
 *
 * Usage: node tools/legacy-pool-to-candidates.mjs <legacy-state.json>
 */

import { readFileSync } from 'node:fs';

const src = process.argv[2];
if (!src) {
  console.error('usage: node tools/legacy-pool-to-candidates.mjs <legacy-state.json>');
  process.exit(2);
}

const state = JSON.parse(readFileSync(src, 'utf8'));
const CITY_IDS = { 'Newark, NJ': 'newark', 'San Jose, CA': 'san-jose', 'Chicago, IL': 'chicago' };

/** Pull a salary range out of the free-text researchNotes the legacy pool used. */
function salaryFromNotes(notes = '') {
  const m = notes.match(
    /\$([\d,]+(?:\.\d+)?)\s*(?:K)?\s*(?:-|to|–)\s*\$?([\d,]+(?:\.\d+)?)\s*(K)?/i,
  );
  if (!m) return { salaryMin: null, salaryMax: null };
  const num = (s, k) => {
    const v = Number(String(s).replace(/,/g, ''));
    return k || v < 1000 ? v * 1000 : v;
  };
  return { salaryMin: num(m[1], m[3]), salaryMax: num(m[2], m[3]) };
}

const candidates = [];
for (const [cityLabel, buckets] of Object.entries(state.pool ?? {})) {
  const cityId = CITY_IDS[cityLabel];
  for (const bucket of ['primary', 'backup']) {
    for (const role of buckets[bucket] ?? []) {
      candidates.push({
        cityId,
        legacyBucket: bucket,
        company: role.company,
        title: role.title,
        location: role.location,
        url: role.url,
        source: role.source,
        // The legacy pool stored prose notes rather than the posted description.
        description: role.researchNotes ?? '',
        ...salaryFromNotes(role.researchNotes),
        fitScore: role.matchScore ?? 0,
        // companyProfile intentionally omitted: the legacy researcher never
        // captured headcount, household-name status, or thriving signals.
      });
    }
  }
}

console.log(JSON.stringify({ source: src, candidates }, null, 2));
