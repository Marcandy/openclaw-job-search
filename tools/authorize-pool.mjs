import { loadRuntime } from '../lib/runtime.mjs';
/**
 * Record the user's exact-destination authorization for today's validated pool.
 *
 * This is the ONLY supported way to move the campaign from
 * "awaiting_authorization" to "authorized". It is a deliberate, explicit,
 * human-triggered step: the agent must never run it on its own initiative.
 *
 * Usage:
 *   node tools/authorize-pool.mjs --confirm-hash <poolHash> [--by "<your-name>"]
 *
 * The hash must be typed from the authorization request the research run
 * printed. Requiring it means the person approving is approving the exact
 * destination list they were shown, not whatever the file happens to say now.
 *
 * Exit: 0 authorized | 1 refused | 2 bad input
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { poolHash } from '../lib/role-filter.mjs';
import { manifestHash, validateManifest } from '../lib/submission-manifest.mjs';
import { atomicJson } from '../lib/runtime.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const readText = (p) => readFileSync(p, 'utf8').replace(/^﻿/, '');
const runtime = loadRuntime();
const { config } = runtime;

// Testability seam: lets the smoke test exercise the real code path against a
// throwaway state file instead of the live campaign state.
const statePath = process.env.CAMPAIGN_STATE_PATH ?? config.paths.state;

const args = process.argv.slice(2);
const at = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };
const confirmHash = at('--confirm-hash');
const by = at('--by') ?? 'user';

if (!confirmHash) {
  console.error('usage: node tools/authorize-pool.mjs --confirm-hash <poolHash> [--by "name"]');
  console.error('\nThe poolHash is printed by validate-pool.mjs and shown in the authorization request.');
  process.exit(2);
}

let state;
try { state = JSON.parse(readText(statePath)); }
catch (err) { console.error(`FATAL: cannot read state at ${statePath}: ${err.message}`); process.exit(2); }

if (state.status === 'authorized') {
  console.error(`REFUSED: today's pool is already authorized (${state.authorization?.authorizedAt}).`);
  process.exit(1);
}
if (state.status !== 'awaiting_authorization') {
  console.error(`REFUSED: state status is "${state.status}"; expected "awaiting_authorization".`);
  process.exit(1);
}

const entries = Object.values(state.pool ?? {}).flatMap((c) => [...(c.primary ?? []), ...(c.backup ?? [])]);
const urls = entries.map((r) => r.canonicalUrl ?? r.url);
const actual = poolHash(urls);
let payloadHash;
try {
  if (!state.submissionManifest) throw new Error('Prepare a submission manifest first');
  validateManifest(state.submissionManifest, runtime);
  if (poolHash(state.submissionManifest.destinations.map(d => d.url)) !== actual) throw new Error('Manifest destinations differ from pool');
  payloadHash = manifestHash(state.submissionManifest);
} catch (err) { console.error(`REFUSED: ${err.message}`); process.exit(1); }

if (payloadHash !== confirmHash) {
  console.error('REFUSED: the confirmed hash does not match the current pool.');
  console.error(`  you confirmed: ${confirmHash}`);
  console.error(`  current manifest:  ${payloadHash}`);
  console.error('\nThe pool changed since it was shown to you. Re-read the pool report before authorizing.');
  process.exit(1);
}

const now = new Date().toISOString();
state.status = 'authorized';
state.researchOnly = false;
state.updatedAt = now;
state.authorization = {
  authorizedAt: now,
  authorizedBy: by,
  poolHash: actual,
  manifestHash: payloadHash,
  expiresAt: state.submissionManifest.expiresAt,
  destinationCount: urls.length,
  exactUrls: urls,
  scope: 'Covers every destination listed above for this campaign date. Ordinary supported fields and the final submit action do not require further approval. Does not cover unknown personal facts, legal attestations, or CAPTCHA bypass.',
};

atomicJson(statePath, state);

console.log('AUTHORIZED.');
console.log(`  campaign:     ${state.campaign} (${state.campaignDate})`);
console.log(`  poolHash:     ${actual}`);
console.log(`  destinations: ${urls.length}`);
console.log(`  by:           ${by} at ${now}`);
console.log('\nNext: run the submission agent with openclaw-tri-city-submit.txt');
