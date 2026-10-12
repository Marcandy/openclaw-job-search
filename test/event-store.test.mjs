import test from 'node:test';
import assert from 'node:assert/strict';
import { EventStore } from '../lib/event-store.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const record = { url: 'https://job-boards.greenhouse.io/acme/jobs/123', company:'Acme',title:'Engineer',location:'Chicago',source:'greenhouse' };
test('two database connections cannot claim a destination twice', () => {
  const dir=mkdtempSync(join(tmpdir(),'claims-')); const path=join(dir,'events.sqlite');
  const a=new EventStore(path), b=new EventStore(path);
  try {
    const run=a.startRun(); assert.throws(()=>b.startRun(),/active/);
    const id=a.claim(run,record,'hash'); assert.throws(()=>b.claim(run,record,'hash'),/already/);
    a.transition(id,run,'filling'); a.transition(id,run,'submit_started');
    assert.throws(()=>a.transition(id,run,'submitted'),/receipt/);
    a.close();
    assert.equal(b.recoverRun(run,'worker crashed after submit'),1);
    assert.equal(b.get(id).state,'uncertain');
    const next=b.startRun(); assert.throws(()=>b.claim(next,record,'hash'),/uncertain/);
    b.transition(id,run,'submitted',{reconciliationReason:'visible employer receipt',receipt:{url:record.url+'/confirmation',text:'Thank you for applying',observedAt:new Date().toISOString()}});
    assert.throws(()=>b.claim(next,record,'hash'),/submitted/);
    b.finishRun(next,'no unconsumed destinations');
  } finally { try {a.close();}catch{} b.close(); rmSync(dir,{recursive:true,force:true}); }
});
test('ledger import is idempotent and preserves duplicate history',()=>{
  const s=new EventStore(':memory:');
  try {
    const rows=[{...record,timestamp:'2026-09-14T12:00:00Z',status:'submitted'},{...record,timestamp:'2026-09-14T12:01:00Z',status:'submitted'}];
    assert.equal(s.importLedger(rows),2);assert.equal(s.importLedger(rows),0);assert.equal(s.ledgerRows().length,2);
    assert.equal(s.status().applications.length,1);
  } finally {s.close();}
});
