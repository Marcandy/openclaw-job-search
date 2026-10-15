import test from 'node:test';
import assert from 'node:assert/strict';
import { EventStore,applicationId } from '../lib/event-store.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseCsv } from '../tools/ats-stats.mjs';
const record = { url: 'https://job-boards.greenhouse.io/acme/jobs/123', company:'Acme',title:'Engineer',location:'Chicago',source:'greenhouse' };
test('Greenhouse legacy modern and embedded URLs share one destination claim',()=>{
  assert.equal(applicationId(record.url),applicationId('https://boards.greenhouse.io/acme/jobs/123'));
  assert.equal(applicationId(record.url),applicationId('https://job-boards.greenhouse.io/embed/job_app?for=acme&token=123'));
  assert.notEqual(applicationId(record.url),applicationId('https://job-boards.greenhouse.io/acme/jobs/124'));
});
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

function csvRoundTrip(rows) {
  const columns = ['timestamp','company','title','location','url','source','status','resume_used','notes'];
  const quote = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return parseCsv(rows.map(r => columns.map(k => quote(r[k])).join(',')).join('\n') + '\n')
    .map(row => Object.fromEntries(columns.map((k, i) => [k, row[i]])));
}

test('exported native and legacy ledger rows do not re-import as new history', () => {
  const s = new EventStore(':memory:');
  try {
    s.importLedger([{ ...record, timestamp:'2026-09-14T12:00:00Z', status:'blocked', notes:'Legacy, "quoted"\nreason' }]);
    const run = s.startRun();
    const id = s.claim(run, { ...record, url:record.url + '4', resumePath:'synthetic.pdf' }, 'hash');
    s.transition(id, run, 'filling');
    s.transition(id, run, 'submit_started');
    s.transition(id, run, 'submitted', { receipt:{url:record.url+'/confirmation',text:'Thank you',observedAt:new Date().toISOString()} });
    s.finishRun(run, 'complete');
    const before = s.db.prepare('SELECT count(*) AS n FROM events').get().n;
    for (let i = 0; i < 3; i++) {
      assert.equal(s.importLedger(csvRoundTrip(s.ledgerRows())), 0);
      assert.equal(s.ledgerRows().length, 2);
      assert.equal(s.db.prepare('SELECT count(*) AS n FROM events').get().n, before);
    }
    assert.equal(s.get(id).state, 'submitted');
    const rows = csvRoundTrip(s.ledgerRows());
    assert.equal(s.importLedger([{...rows[0], notes:'New external detail'}, {...rows[0], timestamp:'2026-09-15T12:00:00Z'}]), 2);
    assert.equal(s.ledgerRows().length, 4);
    assert.equal(s.importLedger(csvRoundTrip(s.ledgerRows())), 0);
  } finally { s.close(); }
});

test('re-imported blocked projections do not reset their claim or retry metadata', () => {
  const s = new EventStore(':memory:');
  try {
    const run = s.startRun(), id = s.claim(run, record, 'hash');
    s.transition(id, run, 'blocked', { reason:'No receipt; verify with employer', retryAllowed:false });
    const before = s.get(id);
    assert.equal(s.importLedger(csvRoundTrip(s.ledgerRows())), 0);
    assert.deepEqual(s.get(id), before);
    assert.equal(s.ledgerRows().length, 1);
  } finally { s.close(); }
});
