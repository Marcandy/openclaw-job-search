import { digest } from './runtime.mjs';
import { applicationId } from './event-store.mjs';
import { officialJobIdentity } from './official-destination.mjs';
export const reviewedPostingDigest = (role) =>
  digest({
    title: String(role.title ?? '')
      .normalize('NFKC')
      .trim()
      .toLowerCase(),
    description: String(role.description ?? '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim(),
  });
export function reviewedPostingFor(role, policy) {
  return (
    policy?.batch?.reviewedCandidates?.find(
      (e) => applicationId(e.url) === applicationId(role.url),
    ) ?? null
  );
}
export const reviewedScopeAllows = (role, policy) =>
  policy?.batch?.reviewedCandidates === undefined || Boolean(reviewedPostingFor(role, policy));
export function validateReviewedScope(policy) {
  const list = policy.batch?.reviewedCandidates;
  if (list === undefined) return;
  if (!policy.batch.scopeDigest || !Array.isArray(list) || !list.length)
    throw Error('Reviewed posting scope must be a nonempty sealed batch');
  const ids = new Set();
  for (const e of list) {
    officialJobIdentity(e.url);
    const id = applicationId(e.url);
    if (
      ids.has(id) ||
      !String(e.reason ?? '').trim() ||
      !Number.isFinite(Date.parse(e.reviewedAt)) ||
      !/^[a-f0-9]{64}$/i.test(e.postingDigest ?? '')
    )
      throw Error('Invalid or duplicate reviewed posting');
    ids.add(id);
  }
}
export function requireReviewedPosting(role, policy) {
  if (policy?.batch?.reviewedCandidates === undefined) return;
  const entry = reviewedPostingFor(role, policy);
  if (!entry || entry.postingDigest !== reviewedPostingDigest(role))
    throw Error('Posting is outside the reviewed scope or changed since review');
}
