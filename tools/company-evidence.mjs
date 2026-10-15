#!/usr/bin/env node
import { loadRuntime, readJson } from '../lib/runtime.mjs';
import { EventStore } from '../lib/event-store.mjs';
import { cacheCompanyEvidence, cachedCompanyEvidence } from '../lib/company-evidence.mjs';
const r = loadRuntime();
const s = new EventStore(r.config.paths.database);
try {
  const [action, input] = process.argv.slice(2);
  if (action === 'record')
    console.log(JSON.stringify(await cacheCompanyEvidence(s, readJson(input)), null, 2));
  else if (action === 'get') console.log(JSON.stringify(cachedCompanyEvidence(s, input), null, 2));
  else throw new Error('Use record <evidence.json> or get <company>');
} finally {
  s.close();
}
