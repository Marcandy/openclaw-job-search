#!/usr/bin/env node
import { join } from 'node:path';
import { loadRuntime, readJson, atomicJson } from '../lib/runtime.mjs';
import { auditRegistry } from '../lib/board-registry.mjs';

const runtime = loadRuntime();
const original = readJson(runtime.config.paths.boards);
const { registry, results } = await auditRegistry(original);
const reportPath = join(runtime.root, `board-audit-${Date.now()}.json`);
atomicJson(reportPath, { checkedAt: new Date().toISOString(), results });
if (process.argv.includes('--apply')) {
  atomicJson(`${runtime.config.paths.boards}.before-${Date.now()}.json`, original);
  atomicJson(runtime.config.paths.boards, registry);
}
const counts = {};
for (const result of results) counts[result.status] = (counts[result.status] ?? 0) + 1;
console.log(JSON.stringify({ applied: process.argv.includes('--apply'), counts, reportPath }));
