import { loadRuntime } from '../lib/runtime.mjs';
/**
 * Destination-integrity check.
 *
 * Recomputes the SHA-256 fingerprint over the pool's canonical URLs and compares
 * it to the hash captured at authorization time. A submission run must call this
 * before touching a form.
 *
 * This closes the gap the handoff describes as engineering priority 6: without
 * it, any later process could edit the state file and slip an employer the user
 * never saw into an already-approved batch.
 *
 * Usage: node tools/verify-authorization.mjs [--json]
 * Exit:  0 authorized and intact | 1 mismatch or not authorized | 2 bad input
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { poolHash, canonicalizeUrl } from '../lib/role-filter.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const readText = (p) => readFileSync(p, 'utf8').replace(/^﻿/, '');
const { config } = loadRuntime();
const wantJson = process.argv.includes('--json');

// Testability seam: see the matching note in authorize-pool.mjs.
const statePath = process.env.CAMPAIGN_STATE_PATH ?? config.paths.state;

let state;
try {
  state = JSON.parse(readText(statePath));
} catch (err) {
  console.error(`FATAL: cannot read state at ${statePath}: ${err.message}`);
  process.exit(2);
}

const fail = (msg, extra = {}) => {
  if (wantJson) console.log(JSON.stringify({ ok: false, error: msg, ...extra }, null, 2));
  else console.error(`INTEGRITY FAIL: ${msg}`);
  process.exit(1);
};

if (state.status !== 'authorized') {
  fail(`state status is "${state.status}", expected "authorized". Submission must not run.`, { status: state.status });
}
const auth = state.authorization;
if (!auth) fail('state.authorization is missing');

for (const field of config.stateMachine.authorizationRecord.requiredFields) {
  if (auth[field] == null) fail(`state.authorization.${field} is missing`);
}

// Recompute from the pool actually present in the state file right now.
const livePoolUrls = Object.values(state.pool ?? {})
  .flatMap((city) => [...(city.primary ?? []), ...(city.backup ?? [])])
  .map((r) => r.canonicalUrl ?? r.url);

const liveHash = poolHash(livePoolUrls);
const authorizedHash = auth.poolHash;

if (liveHash !== authorizedHash) {
  const authorizedSet = new Set(auth.exactUrls.map(canonicalizeUrl));
  const liveSet = new Set(livePoolUrls.map(canonicalizeUrl));
  const added = [...liveSet].filter((u) => !authorizedSet.has(u));
  const removed = [...authorizedSet].filter((u) => !liveSet.has(u));
  fail(
    `pool hash mismatch. The pool changed after authorization.\n` +
    `  authorized: ${authorizedHash}\n  current:    ${liveHash}\n` +
    (added.length ? `  ADDED (never authorized):\n${added.map((u) => `    + ${u}`).join('\n')}\n` : '') +
    (removed.length ? `  REMOVED:\n${removed.map((u) => `    - ${u}`).join('\n')}\n` : ''),
    { authorizedHash, liveHash, added, removed },
  );
}

const result = {
  ok: true,
  campaign: state.campaign,
  campaignDate: state.campaignDate,
  poolHash: liveHash,
  authorizedAt: auth.authorizedAt,
  authorizedBy: auth.authorizedBy,
  destinationCount: livePoolUrls.length,
  quota: state.dailyQuota,
  confirmedToday: state.visibleConfirmedSubmissionsToday,
};

if (wantJson) console.log(JSON.stringify(result, null, 2));
else {
  console.log('OK: authorization is present and the destination list is unchanged.');
  console.log(`  campaign:     ${result.campaign} (${result.campaignDate})`);
  console.log(`  poolHash:     ${result.poolHash}`);
  console.log(`  authorized:   ${result.authorizedAt} by ${result.authorizedBy}`);
  console.log(`  destinations: ${result.destinationCount}`);
  console.log(`  quota:        ${JSON.stringify(result.quota)}`);
  console.log(`  confirmed:    ${JSON.stringify(result.confirmedToday)}`);
}
process.exit(0);
