import { canonicalizeUrl, normalizeCompany } from './role-filter.mjs';
import { applicationId } from './event-store.mjs';
const patterns = [
  ['offer', /pleased to offer|offer you (?:the|a) (?:position|role)|employment offer/i],
  [
    'rejected',
    /not moving forward|will not be moving forward|unfortunately.*(?:application|position)|decided to pursue other|position has been filled/i,
  ],
  [
    'interview',
    /invite you to (?:an? )?interview|schedule (?:an?|your) interview|interview availability/i,
  ],
  [
    'acknowledged',
    /application (?:has been )?received|thank you for applying|thanks for applying/i,
  ],
  ['reply', /discuss your (?:application|experience)|interested in speaking with you/i],
];
export function classifyMessage(message, applications) {
  if (!message.id || !Number.isFinite(Date.parse(message.occurredAt)))
    throw new Error('Message ID and occurrence timestamp required');
  const text = `${message.subject ?? ''}\n${message.body ?? ''}`;
  const kind = patterns.find(([, re]) => re.test(text))?.[0] ?? 'unknown';
  const urls = [...text.matchAll(/https:\/\/[^\s<>"']+/g)].map((x) =>
    canonicalizeUrl(x[0].replace(/[),.;]+$/, '')),
  );
  const exact = applications.filter((a) =>
    urls.some((u) => applicationId(u) === applicationId(a.url)),
  );
  const candidates = exact.length
    ? exact
    : applications.filter((a) => {
        const c = normalizeCompany(a.record.company);
        const title = a.record.title.toLowerCase();
        return (
          c.length >= 4 && normalizeCompany(text).includes(c) && text.toLowerCase().includes(title)
        );
      });
  const match = candidates.length === 1 ? candidates[0] : null;
  const confidence = match ? (exact.length ? 1 : 0.95) : 0;
  return {
    id: message.id,
    appId: match?.id ?? null,
    kind,
    occurredAt: message.occurredAt,
    confidence,
    review: !match || kind === 'unknown',
  };
}
export function ingestOutcomes(store, messages) {
  return store.transaction(() => {
    const apps = store.db
      .prepare("SELECT id,url,record_json FROM applications WHERE state='submitted'")
      .all()
      .map((a) => ({ ...a, record: JSON.parse(a.record_json) }));
    const results = [];
    for (const message of messages) {
      if (store.db.prepare('SELECT 1 FROM messages WHERE id=?').get(message.id)) continue;
      const result = classifyMessage(message, apps);
      store.db
        .prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)')
        .run(
          result.id,
          result.appId,
          result.kind,
          result.occurredAt,
          result.confidence,
          result.review ? 1 : 0,
        );
      if (!result.review)
        store.event(
          result.appId,
          `outcome:${result.kind}`,
          { messageId: result.id, confidence: result.confidence },
          result.occurredAt,
          `message:${result.id}`,
        );
      results.push(result);
    }
    // Body text and contact details are deliberately not persisted.
    return results;
  });
}
export function funnel(store, { now = new Date(), minAgeDays = 7 } = {}) {
  const cutoff = now.getTime() - minAgeDays * 86400000;
  const apps = store.db
    .prepare("SELECT * FROM applications WHERE state='submitted'")
    .all()
    .filter((a) => Date.parse(a.updated_at) <= cutoff);
  const groups = {};
  for (const a of apps) {
    const r = JSON.parse(a.record_json);
    const cohort = [
      r.source ?? 'unknown',
      r.profile ?? 'legacy',
      r.ruleId ?? r.resumePath ?? r.resume_used ?? 'unknown',
    ].join(' | ');
    const g = (groups[cohort] ??= {
      applications: 0,
      acknowledged: 0,
      replies: 0,
      interviews: 0,
      offers: 0,
      rejected: 0,
    });
    g.applications++;
    const kinds = new Set(
      store.db
        .prepare('SELECT kind FROM messages WHERE app_id=? AND review=0')
        .all(a.id)
        .map((x) => x.kind),
    );
    for (const k of ['acknowledged', 'rejected', 'offer', 'interview', 'reply'])
      if (kinds.has(k)) g[{ offer: 'offers', interview: 'interviews', reply: 'replies' }[k] ?? k]++;
  }
  return {
    generatedAt: now.toISOString(),
    minAgeDays,
    uniqueApplications: apps.length,
    reviewMessages: store.db.prepare('SELECT count(*) AS n FROM messages WHERE review=1').get().n,
    groups,
  };
}
