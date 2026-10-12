#!/usr/bin/env node
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadRuntime,readJson,atomicJson } from '../lib/runtime.mjs';
import { activeBlockers } from '../lib/facts-and-blockers.mjs';
const r=loadRuntime();const path=join(r.root,'blockers.json');const blockers=existsSync(path)?readJson(path):[];
const [action,input]=process.argv.slice(2);
if(action==='record'){
  const b=readJson(input);
  if(!b.id||!b.company||!b.reason||!['company','role','form'].includes(b.scope)||!['fact','policy','consent','technical'].includes(b.kind)||!Number.isFinite(Date.parse(b.expiresAt)))throw new Error('Blocker requires ID, employer, reason, scope, kind and expiry');
  if(b.scope==='role'&&!b.url||b.scope==='form'&&!b.formVersion)throw new Error('Scoped blocker requires URL or form version');
  atomicJson(path,[...blockers.filter(x=>x.id!==b.id),b]);
}else if(action==='check'){
  const role=readJson(input);const facts=existsSync(r.config.paths.facts)?readJson(r.config.paths.facts):null;
  console.log(JSON.stringify(activeBlockers(blockers,role,facts),null,2));
}else if(action==='list')console.log(JSON.stringify(blockers,null,2));
else throw new Error('Use record <blocker.json>, check <role.json>, or list');
