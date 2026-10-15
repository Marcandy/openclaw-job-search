#!/usr/bin/env node
import { loadRuntime, readJson, atomicJson } from '../lib/runtime.mjs';
import { buildManifest, manifestHash } from '../lib/submission-manifest.mjs';
const r = loadRuntime();
const state = readJson(r.config.paths.state);
state.submissionManifest = buildManifest(state, r);
state.manifestHash = manifestHash(state.submissionManifest);
atomicJson(r.config.paths.state, state);
console.log(
  JSON.stringify({ manifestHash: state.manifestHash, manifest: state.submissionManifest }, null, 2),
);
console.log('Review this exact payload, then authorize-pool --confirm-hash <manifestHash>.');
