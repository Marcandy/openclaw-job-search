#!/usr/bin/env node
import { writeFileSync, readFileSync } from 'node:fs';
import { loadRuntime, readJson } from '../lib/runtime.mjs';
import { EventStore } from '../lib/event-store.mjs';
import { parseCsv } from './ats-stats.mjs';
const [action, ...args] = process.argv.slice(2);
const { config } = loadRuntime();
const store = new EventStore(config.paths.database);
try {
  let result;
  if (action === 'start') result = { runId: store.startRun() };
  else if (action === 'status') result = store.status();
  else if (action === 'heartbeat') result = store.heartbeat(args[0]);
  else if (action === 'recover') result = { uncertain: store.recoverRun(args[0], args.slice(1).join(' ')) };
  else if (action === 'finish') result = store.finishRun(args[0], args.slice(1).join(' '));
  else if (action === 'reconcile') result = store.transition(args[0], args[1], args[2], readJson(args[3]));
  else if (action === 'import-ledger') {
    const [head, ...rows] = parseCsv(readFileSync(args[0] ?? config.paths.ledgerCsv, 'utf8').replace(/^\uFEFF/, ''));
    result = { imported: store.importLedger(rows.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h,i) => [h,r[i]])))) };
  } else if (action === 'export-ledger') {
    const head = ['timestamp','company','title','location','url','source','status','resume_used','notes'];
    const quote = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
    const lines = store.ledgerRows().map(r => head.map(k => quote(r[k])).join(','));
    writeFileSync(args[0] ?? config.paths.ledgerCsv, [head.join(','), ...lines].join('\n')+'\n', { mode: 0o600 });
    result = { rows: lines.length };
  } else throw new Error('Use start, status, heartbeat, recover, finish, reconcile, import-ledger or export-ledger');
  console.log(JSON.stringify(result ?? { ok:true }, null, 2));
} finally { store.close(); }
