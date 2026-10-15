import { normalizeCompany, canonicalizeUrl } from './role-filter.mjs';
import { validateData } from './schemas.mjs';
export function answerQuestions(questions, destination, facts) {
  validateData('facts', facts);
  const answers = {},
    blocked = [];
  for (const q of questions) {
    const key = destination.answers[q.key];
    const fact = key ? facts.fields[key] : null;
    const employerQuestion = q.employerSpecific === true;
    const known =
      fact &&
      fact.value != null &&
      fact.uses.includes('application') &&
      Number.isFinite(Date.parse(fact.confirmedAt));
    const scoped =
      !employerQuestion ||
      normalizeCompany(fact?.employer) === normalizeCompany(destination.company);
    const consent = q.kind !== 'consent' || fact?.uses.includes(`consent:${q.key}`);
    if (known && scoped && consent) answers[q.key] = fact.value;
    else if (q.required)
      blocked.push({
        key: q.key,
        reason: !known ? 'unknown_fact' : !scoped ? 'employer_scope' : 'unapproved_consent',
      });
  }
  return { answers, blocked };
}
export function activeBlockers(blockers, role, facts, now = new Date()) {
  return blockers.filter((b) => {
    if (b.resolvedAt || Date.parse(b.expiresAt) <= now.getTime()) return false;
    if (normalizeCompany(b.company) !== normalizeCompany(role.company)) return false;
    if (b.scope === 'role' && canonicalizeUrl(b.url) !== canonicalizeUrl(role.url)) return false;
    if (b.scope === 'form' && b.formVersion !== role.formVersion) return false;
    // A confirmed exact fact resolves only fact gaps, never policy or consent blocks.
    const fact = facts?.fields?.[b.factKey];
    if (
      b.kind === 'fact' &&
      fact?.value != null &&
      fact.uses.includes('application') &&
      (!b.employerSpecific || normalizeCompany(fact.employer) === normalizeCompany(b.company))
    )
      return false;
    return true;
  });
}
