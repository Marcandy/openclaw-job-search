import { applicationId } from './event-store.mjs';
import { digest } from './runtime.mjs';
export function blockedRetryEvidence(store, url) {
  const id = applicationId(url),
    prior = store.get(id);
  if (prior?.state !== 'blocked' || !prior.run_id)
    throw Error('Retry requires a native blocked destination');
  const events = store.db
    .prepare('SELECT kind,data_json,at FROM events WHERE app_id=? ORDER BY id')
    .all(id);
  if (
    events.some(
      (e) =>
        ['submit_started', 'uncertain', 'submitted'].includes(e.kind) ||
        (e.kind === 'legacy' &&
          String(JSON.parse(e.data_json).status).toLowerCase() === 'submitted'),
    )
  )
    throw Error('Any prior delivery attempt prevents automatic retry');
  const last = events.at(-1);
  if (last?.kind !== 'blocked') throw Error('Last event is not a pre-submit block');
  return {
    previousRunId: prior.run_id,
    previousUpdatedAt: prior.updated_at,
    blockedEventHash: digest({ kind: last.kind, data: JSON.parse(last.data_json), at: last.at }),
  };
}
export function approvedBlockedRetry(store, role, policy) {
  const matches = (policy?.batch?.reviewedBlockedRetries ?? []).filter(
    (e) => applicationId(e.url) === applicationId(role.url),
  );
  if (matches.length !== 1) return null;
  const entry = matches[0];
  if (
    typeof entry.reason !== 'string' ||
    entry.reason.trim().length < 20 ||
    !Number.isFinite(Date.parse(entry.reviewedAt))
  )
    return null;
  try {
    const proof = blockedRetryEvidence(store, role.url);
    return Object.keys(proof).every((k) => proof[k] === entry[k]) ? entry : null;
  } catch {
    return null;
  }
}
