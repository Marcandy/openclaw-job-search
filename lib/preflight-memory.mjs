import { digest } from './runtime.mjs';
import { applicationId } from './event-store.mjs';

function table(store) {
  store.db.exec(
    'CREATE TABLE IF NOT EXISTS preflight_failures(key TEXT PRIMARY KEY, app_id TEXT NOT NULL, reason TEXT NOT NULL, kind TEXT NOT NULL, expires_at TEXT NOT NULL)',
  );
}
const fingerprint = (role, identity) =>
  digest({
    id: applicationId(role.url),
    title: role.title,
    description: role.description ?? '',
    facts: identity.factsHash,
    config: identity.configDigest,
    adapter: identity.sourceDigest,
  });

export function rememberedPreflightFailure(store, role, identity, now = new Date()) {
  table(store);
  return (
    store.db
      .prepare('SELECT reason,kind,expires_at FROM preflight_failures WHERE key=? AND expires_at>?')
      .get(fingerprint(role, identity), now.toISOString()) ?? null
  );
}

export function rememberPreflightFailure(store, role, identity, reason, now = new Date()) {
  table(store);
  const transient = /timed? ?out|timeout|429|503|ECONN|network/i.test(reason);
  const kind = transient
    ? 'transient'
    : /unfillable|unmapped|control|field|URL/i.test(reason)
      ? 'form_or_answer'
      : 'preflight';
  const cooldown = transient ? 30 * 60000 : kind === 'form_or_answer' ? 6 * 3600000 : 7 * 86400000;
  const expires = new Date(now.getTime() + cooldown).toISOString();
  store.db
    .prepare(
      'INSERT INTO preflight_failures VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET reason=excluded.reason,kind=excluded.kind,expires_at=excluded.expires_at',
    )
    .run(
      fingerprint(role, identity),
      applicationId(role.url),
      String(reason).slice(0, 12000),
      kind,
      expires,
    );
}
