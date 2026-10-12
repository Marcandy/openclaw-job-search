#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadRuntime, readJson, digest } from '../lib/runtime.mjs';
const runtime = loadRuntime();
const deploymentPath = join(runtime.root, 'deployment.json');
const saved = existsSync(deploymentPath) ? readJson(deploymentPath) : null;
const current = { sourceRoot: runtime.sourceRoot, configPath: runtime.configPath, configDigest: runtime.configDigest, profile: runtime.profile, sourceDigest: runtime.sourceDigest };
const ok = saved != null && digest(saved.identity) === digest(current);
console.log(JSON.stringify({ ok, ...current, runtimeRoot: runtime.root, paths: runtime.config.paths, reason: ok ? null : 'Run prepare-runtime after deliberately selecting config/profile; deployment identity is absent or mismatched' }, null, 2));
process.exitCode = ok ? 0 : 1;
