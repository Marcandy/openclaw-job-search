// Read-only summaries for the daily report. They explain a shortfall; they
// never change which roles are attempted or how a form is answered.

/** Increment `counts[key]`, creating it at zero first. */
export function bump(counts, key, by = 1) {
  counts[key] = (counts[key] ?? 0) + by;
  return counts;
}

const BLOCKED_PREFIX = 'Required fields blocked: ';

/** The blocked required fields of one result, from its structured list or its reason text. */
export function blockedFields(result) {
  if (Array.isArray(result.blocked)) return result.blocked;
  const reason = String(result.reason ?? '');
  if (!reason.startsWith(BLOCKED_PREFIX)) return [];
  try {
    return JSON.parse(reason.slice(BLOCKED_PREFIX.length));
  } catch {
    return [];
  }
}

/**
 * Normalize a question so the same question at different employers groups
 * together: "How did you hear about Temporal?" and "How did you hear about
 * Vercel?" are one missing answer.
 */
export function questionKey(label, company) {
  let text = String(label ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const name = String(company ?? '').trim();
  if (name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`\\b${escaped}(?:'s|’s)?\\b`, 'gi'), '<employer>');
  }
  return text.toLowerCase();
}

/**
 * Rank the questions that blocked roles in this run, most roles first. Each
 * entry is one decision the applicant can make once and reuse.
 */
export function rankFactGaps(results, { limit = 10 } = {}) {
  const gaps = new Map();
  for (const result of results ?? []) {
    const seen = new Set();
    for (const field of blockedFields(result)) {
      const key = questionKey(field.label, result.company);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const gap = gaps.get(key) ?? {
        question: String(field.label ?? '').trim(),
        reason: field.reason,
        roles: 0,
        employers: new Set(),
      };
      gap.roles++;
      gap.employers.add(result.company);
      gaps.set(key, gap);
    }
  }
  return [...gaps.values()]
    .sort((a, b) => b.roles - a.roles || a.question.localeCompare(b.question))
    .slice(0, limit)
    .map((g) => ({ ...g, employers: [...g.employers].sort() }));
}
