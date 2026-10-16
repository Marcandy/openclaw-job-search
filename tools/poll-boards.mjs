#!/usr/bin/env node
import { loadRuntime, readJson, atomicJson } from '../lib/runtime.mjs';
import { EventStore } from '../lib/event-store.mjs';
import { fetchBoard, cacheBoard, triagePostings } from '../lib/board-discovery.mjs';
const r = loadRuntime();
const registry = readJson(r.config.paths.boards);
if (!Array.isArray(registry.boards) || !registry.boards.length)
  throw new Error('Supply a verified employer-board registry');
const store = new EventStore(r.config.paths.database);
const changed = [],
  errors = [],
  boards = [];
try {
  // Serial board reads avoid bursts and bound memory. No applicant files are read.
  for (const board of registry.boards.filter((b) => b.disabled !== true)) {
    try {
      const result = cacheBoard(store, board, await fetchBoard(board));
      changed.push(...result.changed);
      boards.push({
        platform: board.platform,
        slug: board.slug,
        total: result.total,
        changed: result.changed.length,
      });
    } catch (e) {
      errors.push({ platform: board.platform, slug: board.slug, reason: e.message });
    }
  }
  const report = { ...triagePostings(changed, r.config), boards, errors };
  const i = process.argv.indexOf('--out');
  if (i >= 0) atomicJson(process.argv[i + 1], report);
  else console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  store.close();
}
