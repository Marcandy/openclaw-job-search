import { readEvidenceSource, corroborateExcerpt } from './source-documents.mjs';
import { normalizeCompany } from './role-filter.mjs';
export function evidenceIsCurrent(signal, maxMonths = 24, now = new Date()) {
  const at = Date.parse(signal?.asOf ?? '');
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - maxMonths);
  let url;
  try {
    url = new URL(signal.sourceUrl);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    Number.isFinite(at) &&
    at >= cutoff.getTime() &&
    at <= now.getTime()
  );
}
export async function cacheCompanyEvidence(
  store,
  evidence,
  { fetcher = fetch, now = new Date(), sourceMaxAgeDays = 7 } = {},
) {
  if (
    !evidence.company ||
    !Array.isArray(evidence.thrivingSignals) ||
    !evidence.thrivingSignals.length
  )
    throw new Error('Company and dated evidence required');
  const snapshots = new Map();
  for (const signal of evidence.thrivingSignals) {
    if (!evidenceIsCurrent(signal, 24, now) || !signal.excerpt || signal.excerpt.length < 20)
      throw new Error('Evidence requires a current date, HTTPS source and corroborating excerpt');
    if (!snapshots.has(signal.sourceUrl)) {
      snapshots.set(
        signal.sourceUrl,
        await readEvidenceSource(signal.sourceUrl, {
          store,
          fetcher,
          now,
          maxAgeDays: sourceMaxAgeDays,
        }),
      );
    }
    corroborateExcerpt(snapshots.get(signal.sourceUrl), signal.excerpt);
  }
  store.db.exec(
    'CREATE TABLE IF NOT EXISTS company_evidence(company TEXT PRIMARY KEY,data_json TEXT NOT NULL,checked_at TEXT NOT NULL)',
  );
  store.db
    .prepare(
      'INSERT INTO company_evidence VALUES(?,?,?) ON CONFLICT(company) DO UPDATE SET data_json=excluded.data_json,checked_at=excluded.checked_at',
    )
    .run(normalizeCompany(evidence.company), JSON.stringify(evidence), now.toISOString());
  return {
    company: evidence.company,
    checkedAt: now.toISOString(),
    signals: evidence.thrivingSignals.length,
  };
}
export function cachedCompanyEvidence(store, company, { maxAgeDays = 30, now = new Date() } = {}) {
  if (!store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='company_evidence'").get())
    return null;
  const row = store.db
    .prepare('SELECT * FROM company_evidence WHERE company=?')
    .get(normalizeCompany(company));
  if (!row || now.getTime() - Date.parse(row.checked_at) > maxAgeDays * 86400000) return null;
  const e = JSON.parse(row.data_json);
  return e.thrivingSignals.every((s) => evidenceIsCurrent(s, 24, now)) ? e : null;
}
