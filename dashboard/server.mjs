import { loadRuntime } from '../lib/runtime.mjs';
/**
 * Campaign dashboard for the OpenClaw tri-city job search.
 *
 * WHY THIS EXISTS RATHER THAN AN OFF-THE-SHELF TRACKER
 * ----------------------------------------------------
 * Three existing projects were evaluated on 2026-08-17:
 *
 *   - JobSpy            adopted, and now powers discovery/discover.py
 *   - JobSync           already running on :3737; a good per-job tracker, but it
 *                       has no concept of this campaign's gates, pool hash,
 *                       authorization state, or blocker taxonomy
 *   - JobTrail          same JobSpy idea, but a 4-container Docker/Postgres/
 *                       NestJS stack that duplicates JobSync
 *   - openclaw-dashboard  explicitly READ-ONLY; it cannot trigger a cron job,
 *                       so it cannot provide the "search again" button, and it
 *                       is not extensible for custom panels
 *
 * So this is a deliberately thin layer: zero dependencies, reads the artifacts
 * that already exist, and links out to JobSync for per-job detail rather than
 * duplicating it.
 *
 * Usage:  node dashboard/server.mjs [--port 4545]
 * Then:   http://127.0.0.1:4545
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildBlockerIndex, normalizeCompany } from '../lib/role-filter.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const readText = (p) => readFileSync(p, 'utf8').replace(/^﻿/, '');
const { config } = loadRuntime();

const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf('--port') + 1]) || 4545;
const CRON_ID = 'cad8a8a0-22be-4990-9781-f08eb27365a8';

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

/** RFC4180-ish parser; the ledger quotes commas and newlines inside notes. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.trim());
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/**
 * Classify a blocker so the dashboard can say what the user must actually DO.
 * "blocked" alone is not actionable; "you can finish this one yourself in the
 * open browser tab" is.
 */
function classifyBlocker(notes) {
  const n = (notes || '').toLowerCase();
  if (/captcha|hcaptcha|recaptcha|are you human|drag the shape/.test(n)) {
    return { kind: 'captcha', label: 'CAPTCHA', action: 'Solvable by you in the open browser tab', severity: 'actionable' };
  }
  if (/street address|full address|zip code|postal code/.test(n)) {
    return { kind: 'address', label: 'Home address required', action: 'Blocked by your address-privacy rule', severity: 'policy' };
  }
  if (/u\.s\. person|export.control|citizenship|permanent resident|green card|clearance/.test(n)) {
    return { kind: 'legal-status', label: 'Citizenship / export control', action: 'Needs a fact you have not supplied', severity: 'needs-fact' };
  }
  if (/background check|background-check|fingerprint|arbitration|attestation|e-?signature|legal signature/.test(n)) {
    return { kind: 'legal-consent', label: 'Legal attestation', action: 'Needs your explicit consent decision', severity: 'needs-decision' };
  }
  if (/degree major|closely related field|gpa|graduation date|school/.test(n)) {
    return { kind: 'education', label: 'Education detail', action: 'Needs major / school / graduation date', severity: 'needs-fact' };
  }
  if (/login|sign in|sign-in|account creation|create an account|mfa|verification code/.test(n)) {
    return { kind: 'account', label: 'Account / login required', action: 'Sign in manually, then re-run', severity: 'actionable' };
  }
  // Hyphenation matters: the first real essay blocker (2026-08-20) wrote
  // "short-answer prompt", which a bare /short answer/ pattern missed entirely.
  if (/essay|cover letter|written response|why do you|tell us about|short[- ]answer|personal statement|unsupported personal (work )?story|open[- ]ended (question|prompt)|in your own words/.test(n)) {
    return { kind: 'essay', label: 'Custom essay required', action: 'Needs a written answer from you', severity: 'needs-essay' };
  }
  if (/relationship|previously employed|relative/.test(n)) {
    return { kind: 'relationship', label: 'Employee relationship question', action: 'Needs a fact about this employer', severity: 'needs-fact' };
  }
  return { kind: 'other', label: 'Other blocker', action: 'Read the note', severity: 'review' };
}

function loadState() {
  try { return JSON.parse(readText(config.paths.state)); } catch { return null; }
}

function loadLedger() {
  try { return parseCsv(readText(config.paths.ledgerCsv)); } catch { return []; }
}

function todayInTz() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function latestLeadsFile() {
  try {
    const files = readdirSync(root).filter((f) => /^leads-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    return files.length ? join(root, files[files.length - 1]) : null;
  } catch { return null; }
}

function buildModel() {
  const state = loadState();
  const ledger = loadLedger();
  const today = todayInTz();
  const blockerIndex = buildBlockerIndex(ledger, config);

  const todayRows = ledger.filter((r) => (r.timestamp || '').startsWith(today));

  // Quota progress: count only visibly confirmed submissions, per the campaign rule.
  const quota = config.cities.map((c) => {
    const submitted = todayRows.filter((r) => r.status === 'submitted' && matchesCity(r.location, c)).length;
    return { label: c.label, quota: c.dailyQuota, submitted, remaining: Math.max(0, c.dailyQuota - submitted) };
  });

  // Blocked rows still worth acting on: most recent per company+title.
  const blockedSeen = new Set();
  const blocked = [...ledger].reverse()
    .filter((r) => r.status === 'blocked')
    .filter((r) => {
      const k = `${normalizeCompany(r.company)}::${(r.title || '').toLowerCase()}`;
      if (blockedSeen.has(k)) return false;
      blockedSeen.add(k);
      return true;
    })
    .map((r) => ({ ...r, blocker: classifyBlocker(r.notes) }));

  const needsEssay = blocked.filter((b) => b.blocker.severity === 'needs-essay');
  const actionable = blocked.filter((b) => b.blocker.severity === 'actionable');
  const needsFact = blocked.filter((b) => ['needs-fact', 'needs-decision'].includes(b.blocker.severity));

  const statusCounts = ledger.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {});

  return {
    generatedAt: new Date().toISOString(),
    today,
    campaign: { name: config.campaign, version: config.version, timezone: config.timezone },
    state: state && {
      status: state.status,
      campaignDate: state.campaignDate,
      poolHash: state.poolHash,
      authorization: state.authorization,
      quotaShortfalls: state.quotaShortfalls ?? [],
      waivedCities: state.waivedCities ?? [],
      pool: state.pool ?? {},
    },
    quota,
    todayRows,
    blocked,
    needsEssay,
    actionable,
    needsFact,
    statusCounts,
    ledgerTotal: ledger.length,
    blockedCompanies: [...blockerIndex.values()],
    latestLeads: latestLeadsFile(),
  };
}

function matchesCity(location, city) {
  const l = (location || '').toLowerCase();
  if (city.excludedLocationPatterns?.some((p) => l.includes(p.toLowerCase()))) return false;
  return city.acceptedLocationAliases.some((a) => l.includes(a.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

let runInFlight = null;

/** Trigger the OpenClaw research cron immediately. This is the "Search again" button. */
function triggerSearch() {
  if (runInFlight) return Promise.resolve({ ok: false, error: 'A search is already running.' });
  runInFlight = new Promise((resolve) => {
    const started = Date.now();
    execFile('openclaw', ['cron', 'run', CRON_ID], { shell: true, timeout: 15 * 60_000, maxBuffer: 8 << 20 },
      (err, stdout, stderr) => {
        runInFlight = null;
        resolve(err
          ? { ok: false, error: String(err.message).slice(0, 400), stderr: String(stderr).slice(0, 800), ms: Date.now() - started }
          : { ok: true, stdout: String(stdout).slice(0, 800), ms: Date.now() - started });
      });
  });
  return runInFlight;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render(m) {
  const badge = (t, cls) => `<span class="badge ${cls}">${esc(t)}</span>`;

  const statusBadge = {
    idle: 'muted', researching: 'info', awaiting_authorization: 'warn',
    authorized: 'ok', submitting: 'info', quota_complete: 'ok', exhausted: 'muted',
  }[m.state?.status] ?? 'muted';

  const quotaRows = m.quota.map((q) => {
    const pct = q.quota ? Math.min(100, Math.round((q.submitted / q.quota) * 100)) : 0;
    const done = q.submitted >= q.quota;
    return `<div class="qrow">
      <div class="qlabel">${esc(q.label)}</div>
      <div class="qbar"><div class="qfill ${done ? 'done' : ''}" style="width:${pct}%"></div></div>
      <div class="qnum ${done ? 'ok' : ''}">${q.submitted} / ${q.quota}</div>
    </div>`;
  }).join('');

  const attention = [];

  if (m.state?.status === 'awaiting_authorization') {
    const n = Object.values(m.state.pool ?? {}).reduce((a, c) => a + (c.primary?.length ?? 0) + (c.backup?.length ?? 0), 0);
    attention.push(`<div class="card warn">
      <h3>A batch is waiting for your authorization</h3>
      <p>${n} destination${n === 1 ? '' : 's'} researched and validated. Nothing is sent until you approve.</p>
      <p class="mono small">poolHash ${esc(m.state.poolHash ?? '')}</p>
      <pre class="cmd">cd "${esc(root)}"
node tools/authorize-pool.mjs --confirm-hash ${esc(m.state.poolHash ?? '')} --by "<your-name>"</pre>
    </div>`);
  }

  for (const s of (m.state?.quotaShortfalls ?? []).filter((x) => x.bucket !== 'backup')) {
    const waived = (m.state?.waivedCities ?? []).includes(s.city);
    attention.push(`<div class="card ${waived ? 'muted' : 'warn'}">
      <h3>${esc(s.city)} is short${waived ? ' (waived)' : ''}</h3>
      <p>Found ${s.found} of ${s.needed} required. ${waived ? 'You accepted this shortfall.' : 'Research more before authorizing.'}</p>
    </div>`);
  }

  if (m.actionable.length) {
    attention.push(`<div class="card info">
      <h3>${m.actionable.length} application${m.actionable.length === 1 ? '' : 's'} you can finish yourself</h3>
      <p>These stopped at a CAPTCHA or login. The form is already filled.</p>
      ${m.actionable.map((b) => `<div class="row">
        <a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.company)} — ${esc(b.title)}</a>
        ${badge(b.blocker.label, 'warn')}
      </div>`).join('')}
    </div>`);
  }

  const essayCard = m.needsEssay.length
    ? `${m.needsEssay.map((b) => `<div class="row col">
        <div><a href="${esc(b.url)}" target="_blank" rel="noopener"><strong>${esc(b.company)}</strong> — ${esc(b.title)}</a></div>
        <div class="small muted">${esc(b.location)} · ${esc((b.timestamp || '').slice(0, 10))}</div>
        <div class="note">${esc(b.notes)}</div>
      </div>`).join('')}`
    : `<p class="muted">Nothing is waiting on a written answer right now.</p>`;

  const factCard = m.needsFact.length
    ? m.needsFact.map((b) => `<div class="row col">
        <div><a href="${esc(b.url)}" target="_blank" rel="noopener"><strong>${esc(b.company)}</strong> — ${esc(b.title)}</a> ${badge(b.blocker.label, 'danger')}</div>
        <div class="small">${esc(b.blocker.action)}</div>
      </div>`).join('')
    : `<p class="muted">No outstanding fact or consent decisions.</p>`;

  const todayTable = m.todayRows.length
    ? `<table><thead><tr><th>Time</th><th>Company</th><th>Role</th><th>Location</th><th>Status</th><th>Detail</th></tr></thead><tbody>
      ${m.todayRows.map((r) => `<tr>
        <td class="mono small">${esc((r.timestamp || '').slice(11, 16))}</td>
        <td>${esc(r.company)}</td>
        <td><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a></td>
        <td class="small">${esc(r.location)}</td>
        <td>${badge(r.status, r.status === 'submitted' ? 'ok' : r.status === 'blocked' ? 'danger' : 'muted')}</td>
        <td class="small note">${esc((r.notes || '').slice(0, 160))}</td>
      </tr>`).join('')}
    </tbody></table>`
    : `<p class="muted">No activity recorded today yet.</p>`;

  const poolSections = Object.entries(m.state?.pool ?? {}).map(([city, b]) => {
    const all = [...(b.primary ?? []).map((r) => ({ ...r, bucket: 'primary' })), ...(b.backup ?? []).map((r) => ({ ...r, bucket: 'backup' }))];
    if (!all.length) return `<h4>${esc(city)}</h4><p class="muted">Empty.</p>`;
    return `<h4>${esc(city)}</h4>` + all.map((r) => `<div class="row col">
      <div>${badge(r.bucket, r.bucket === 'primary' ? 'ok' : 'muted')}
        <a href="${esc(r.url)}" target="_blank" rel="noopener"><strong>${esc(r.company)}</strong> — ${esc(r.title)}</a></div>
      <div class="small muted">${esc(r.headcountBand ?? '')} · ${r.isHouseholdName ? 'household name' : 'not a household name'} · ${r.thrivingSignals ?? 0} signal(s) · score ${r.score ?? '-'}</div>
      ${(r.uncertainties ?? []).map((u) => `<div class="small warn-text">! ${esc(u)}</div>`).join('')}
    </div>`).join('');
  }).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Job Campaign Dashboard</title>
<style>
:root{--bg:#0f1115;--panel:#171a21;--panel2:#1e222b;--line:#2a2f3a;--fg:#e6e9ef;--muted:#8b93a7;
--ok:#3fb950;--warn:#d29922;--danger:#f85149;--info:#58a6ff;}
@media (prefers-color-scheme:light){:root{--bg:#f6f7f9;--panel:#fff;--panel2:#f0f2f5;--line:#dfe3ea;--fg:#1c2027;--muted:#5b6377;}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{padding:18px 22px;border-bottom:1px solid var(--line);display:flex;gap:16px;align-items:center;flex-wrap:wrap;background:var(--panel)}
h1{font-size:17px;margin:0;font-weight:650}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:26px 0 10px}
h3{font-size:14px;margin:0 0 6px}h4{font-size:13px;margin:14px 0 6px;color:var(--muted)}
main{padding:0 22px 60px;max-width:1180px;margin:0 auto}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
.card{background:var(--panel);border:1px solid var(--line);border-left-width:3px;border-radius:8px;padding:14px 16px}
.card.warn{border-left-color:var(--warn)}.card.info{border-left-color:var(--info)}
.card.ok{border-left-color:var(--ok)}.card.danger{border-left-color:var(--danger)}
.card.muted{border-left-color:var(--muted);opacity:.75}
.badge{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600;border:1px solid}
.badge.ok{color:var(--ok);border-color:var(--ok)}.badge.warn{color:var(--warn);border-color:var(--warn)}
.badge.danger{color:var(--danger);border-color:var(--danger)}.badge.info{color:var(--info);border-color:var(--info)}
.badge.muted{color:var(--muted);border-color:var(--muted)}
.qrow{display:grid;grid-template-columns:190px 1fr 68px;gap:12px;align-items:center;margin:7px 0}
.qbar{height:8px;background:var(--panel2);border-radius:99px;overflow:hidden}
.qfill{height:100%;background:var(--info)}.qfill.done{background:var(--ok)}
.qnum{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted)}.qnum.ok{color:var(--ok);font-weight:600}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--panel2);font-size:12px;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:none}
a{color:var(--info);text-decoration:none}a:hover{text-decoration:underline}
.row{padding:7px 0;border-bottom:1px solid var(--line)}.row:last-child{border-bottom:none}
.row.col{display:flex;flex-direction:column;gap:2px}
.small{font-size:12px}.muted{color:var(--muted)}.warn-text{color:var(--warn)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.note{color:var(--muted);font-size:12px;white-space:pre-wrap}
pre.cmd{background:var(--panel2);border:1px solid var(--line);border-radius:6px;padding:9px 11px;overflow-x:auto;font-size:12px;margin:8px 0 0}
button{font:inherit;font-weight:600;padding:9px 16px;border-radius:7px;border:1px solid var(--info);background:var(--info);color:#06101f;cursor:pointer}
button:hover{filter:brightness(1.08)}button:disabled{opacity:.55;cursor:not-allowed}
.spacer{flex:1}
#msg{font-size:12px;color:var(--muted)}
.overflow{overflow-x:auto}
</style></head><body>
<header>
  <h1>Job Campaign</h1>
  ${badge(m.state?.status ?? 'unknown', statusBadge)}
  <span class="small muted">${esc(m.campaign.name)} v${m.campaign.version} · ${esc(m.today)} · daily search 12:30 PM ET</span>
  <span class="spacer"></span>
  <span id="msg"></span>
  <button id="again">Search again</button>
</header>
<main>

  <h2>Quota today</h2>
  <div class="card">${quotaRows}</div>

  <h2>Needs your attention</h2>
  ${attention.length ? `<div class="grid">${attention.join('')}</div>` : `<div class="card ok"><h3>Nothing blocking</h3><p class="muted">No pending authorization, shortfall, or finishable application.</p></div>`}

  <h2>Needs a custom essay${m.needsEssay.length ? ` (${m.needsEssay.length})` : ''}</h2>
  <div class="card">${essayCard}</div>

  <h2>Needs a fact or consent decision from you${m.needsFact.length ? ` (${m.needsFact.length})` : ''}</h2>
  <div class="card">${factCard}</div>

  <h2>Today's results</h2>
  <div class="overflow">${todayTable}</div>

  <h2>Current pool</h2>
  <div class="card">${poolSections || '<p class="muted">No pool researched yet.</p>'}</div>

  <h2>Totals</h2>
  <div class="card">
    <p>${Object.entries(m.statusCounts).map(([k, v]) => `${badge(k, k === 'submitted' ? 'ok' : k === 'blocked' ? 'danger' : 'muted')} ${v}`).join(' &nbsp; ')}</p>
    <p class="small muted">${m.ledgerTotal} ledger rows · ${m.blockedCompanies.length} companies permanently blocked by a form question ·
    <a href="http://127.0.0.1:3737" target="_blank" rel="noopener">JobSync</a> ·
    <a href="http://127.0.0.1:18789" target="_blank" rel="noopener">OpenClaw</a></p>
  </div>

</main>
<script>
const btn = document.getElementById('again');
const msg = document.getElementById('msg');
btn.addEventListener('click', async () => {
  btn.disabled = true; msg.textContent = 'Search running, this takes a few minutes...';
  try {
    const res = await fetch('/api/search-again', { method: 'POST' });
    const j = await res.json();
    msg.textContent = j.ok ? 'Search finished. Reloading...' : ('Failed: ' + (j.error || 'unknown'));
    if (j.ok) setTimeout(() => location.reload(), 1200);
    else btn.disabled = false;
  } catch (e) { msg.textContent = 'Failed: ' + e.message; btn.disabled = false; }
});
// Refresh periodically so a finished cron run shows up without a manual reload.
setInterval(() => { if (!btn.disabled) location.reload(); }, 120000);
</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/search-again') {
      const result = await triggerSearch();
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(result));
    }
    if (req.url === '/api/model') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(buildModel(), null, 2));
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(render(buildModel()));
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(`dashboard error: ${err.stack}`);
  }
});

// Loopback only. This page exposes application history and should not be
// reachable from the network.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Campaign dashboard: http://127.0.0.1:${PORT}`);
  console.log(`  JSON model:       http://127.0.0.1:${PORT}/api/model`);
  console.log('  "Search again" runs OpenClaw cron job ' + CRON_ID);
});
