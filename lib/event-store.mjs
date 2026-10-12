import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalizeUrl } from './role-filter.mjs';
import { digest, assertLocalDatabase } from './runtime.mjs';

export function applicationId(url) {
  const canonical=canonicalizeUrl(url);let u;
  try{u=new URL(canonical);}catch{return digest(canonical);}
  if(['boards.greenhouse.io','job-boards.greenhouse.io'].includes(u.hostname)){
    const job=u.pathname.match(/^\/([^/]+)\/jobs\/([^/]+)(?:\/|$)/);
    if(job)return digest(`greenhouse:${job[1]}:${job[2]}`);
    if(u.pathname==='/embed/job_app'&&u.searchParams.get('for')&&u.searchParams.get('token'))return digest(`greenhouse:${u.searchParams.get('for')}:${u.searchParams.get('token')}`);
  }
  return digest(canonical);
}
const transitions = {
  claimed: ['filling', 'blocked'], filling: ['submit_started', 'blocked'],
  submit_started: ['submitted', 'uncertain'], uncertain: ['submitted', 'blocked'],
};
export class EventStore {
  constructor(path) {
    if (path !== ':memory:') { assertLocalDatabase(path); mkdirSync(dirname(path), { recursive: true }); }
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, state TEXT NOT NULL, heartbeat TEXT NOT NULL, reason TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS single_worker ON runs(state) WHERE state='running';
      CREATE TABLE IF NOT EXISTS applications(id TEXT PRIMARY KEY, url TEXT NOT NULL, run_id TEXT, state TEXT NOT NULL, record_json TEXT NOT NULL, manifest_hash TEXT, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, app_id TEXT NOT NULL, kind TEXT NOT NULL, data_json TEXT NOT NULL, at TEXT NOT NULL, event_key TEXT UNIQUE);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, app_id TEXT, kind TEXT NOT NULL, occurred_at TEXT NOT NULL, confidence REAL NOT NULL, review INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS projection(id TEXT PRIMARY KEY, synced_at TEXT NOT NULL);
    `);
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  startRun() {
    const id = randomUUID();
    try { this.db.prepare('INSERT INTO runs VALUES (?, ?, ?, NULL)').run(id, 'running', new Date().toISOString()); }
    catch { throw new Error('A submission run is active or crashed; inspect and explicitly recover it before another run'); }
    return id;
  }
  heartbeat(runId) {
    const r = this.db.prepare("UPDATE runs SET heartbeat=? WHERE id=? AND state='running'").run(new Date().toISOString(), runId);
    if (!r.changes) throw new Error('Run is not active');
  }
  claim(runId, record, manifestHash, { retryBlocked = false, retryReason } = {}) {
    if(retryBlocked&&!retryReason?.trim())throw new Error('Explicit blocked retry requires a reason');
    const id = applicationId(record.url);
    return this.transaction(() => {
      this.heartbeat(runId);
      const prior = this.get(id);
      if (prior && !(retryBlocked && prior.state === 'blocked')) throw new Error(`Destination already ${prior.state}; automatic retry refused`);
      const at = new Date().toISOString();
      this.db.prepare('INSERT INTO applications VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id,state=excluded.state,record_json=excluded.record_json,manifest_hash=excluded.manifest_hash,updated_at=excluded.updated_at')
        .run(id, canonicalizeUrl(record.url), runId, 'claimed', JSON.stringify(record), manifestHash, at);
      this.event(id, 'claimed', { runId, manifestHash, retryReason:retryBlocked?retryReason:null }, at);
      return id;
    });
  }
  get(id) {
    const row = this.db.prepare('SELECT * FROM applications WHERE id=?').get(id);
    return row ? { ...row, record: JSON.parse(row.record_json) } : null;
  }
  event(id, kind, data, at = new Date().toISOString(), key = null) {
    return this.db.prepare('INSERT INTO events(app_id,kind,data_json,at,event_key) VALUES (?,?,?,?,?)').run(id, kind, JSON.stringify(data), at, key);
  }
  transition(id, runId, state, data = {}) {
    return this.transaction(() => {
      const prior = this.get(id);
      if (!prior || prior.run_id !== runId) throw new Error('Destination is not claimed by this run');
      if (!transitions[prior.state]?.includes(state)) throw new Error(`Invalid transition ${prior.state} -> ${state}`);
      if (prior.state === 'uncertain' && !data.reconciliationReason) throw new Error('Uncertain result requires explicit reconciliation evidence');
      if (state === 'submitted' && (!data.receipt?.url || !data.receipt?.text || !data.receipt?.observedAt)) throw new Error('Submitted requires observed receipt URL, text and timestamp');
      if (state === 'blocked' && !data.reason) throw new Error('Blocked requires a reason');
      const at = new Date().toISOString();
      this.db.prepare('UPDATE applications SET state=?,updated_at=? WHERE id=?').run(state, at, id);
      this.event(id, state, data, at);
    });
  }
  finishRun(runId, reason) {
    if (!reason) throw new Error('Terminal reason required');
    const pending = this.db.prepare("SELECT count(*) AS n FROM applications WHERE run_id=? AND state IN ('claimed','filling','submit_started')").get(runId).n;
    if (pending) throw new Error('Run still has pending destinations; recover it explicitly');
    this.db.prepare("UPDATE runs SET state='finished', reason=?, heartbeat=? WHERE id=? AND state='running'").run(reason, new Date().toISOString(), runId);
  }
  recoverRun(runId, reason) {
    if (!reason) throw new Error('Recovery reason required');
    return this.transaction(() => {
      const run = this.db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
      if (run?.state !== 'running') throw new Error('Only an active run can be recovered');
      const pending = this.db.prepare("SELECT id,state FROM applications WHERE run_id=? AND state IN ('claimed','filling','submit_started')").all(runId);
      for (const a of pending) {
        // Even filling may have disclosed data. Do not automatically requeue.
        this.db.prepare("UPDATE applications SET state='uncertain',updated_at=? WHERE id=?").run(new Date().toISOString(), a.id);
        this.event(a.id, 'uncertain', { reason, previousState: a.state });
      }
      this.db.prepare("UPDATE runs SET state='recovered',reason=? WHERE id=?").run(reason, runId);
      return pending.length;
    });
  }
  importLedger(rows) {
    return this.transaction(() => {
      let imported = 0;
      for (const record of rows) {
        if (!record.url || !record.timestamp) continue;
        const key = `legacy:${digest(record)}`;
        if (this.db.prepare('SELECT 1 FROM events WHERE event_key=?').get(key)) continue;
        const id = applicationId(record.url);
        this.event(id, 'legacy', record, record.timestamp, key);
        // Historical submissions suppress duplicates even if later blocked rows exist.
        const prior = this.get(id);
        if (!prior || (record.status === 'submitted' && prior.state !== 'submitted')) {
          this.db.prepare('INSERT INTO applications VALUES (?,?,NULL,?,?,NULL,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,record_json=excluded.record_json,updated_at=excluded.updated_at')
            .run(id, canonicalizeUrl(record.url), record.status === 'submitted' ? 'submitted' : 'blocked', JSON.stringify(record), record.timestamp);
        }
        imported++;
      }
      return imported;
    });
  }
  ledgerRows() {
    return this.db.prepare("SELECT * FROM events WHERE kind IN ('legacy','submitted','blocked') ORDER BY id").all().map(e => {
      const data = JSON.parse(e.data_json);
      if (e.kind === 'legacy') return data;
      const r = this.get(e.app_id).record;
      return { timestamp: e.at, company: r.company, title: r.title, location: r.location, url: r.url, source: r.source, status: e.kind, resume_used: r.resumePath ?? '', notes: JSON.stringify(data) };
    });
  }
  status() { return { runs: this.db.prepare('SELECT * FROM runs ORDER BY heartbeat DESC').all(), applications: this.db.prepare('SELECT id,url,run_id,state,updated_at FROM applications').all() }; }
}
