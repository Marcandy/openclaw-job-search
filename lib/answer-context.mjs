import { readFileSync } from 'node:fs';

const KINDS = new Set(['experience', 'motivation', 'preference', 'process']);
const normalizeCompany = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();

/** Private, user-approved narrative context, not a source of guessed personal facts. */
export function validateAnswerContext(input) {
  if (input?.version !== 1 || !Array.isArray(input.entries) || input.entries.length > 50)
    throw Error('Answer context must be version 1 with at most 50 entries');
  const seen = new Set();
  const entries = input.entries.map((e) => {
    if (
      !e?.id ||
      typeof e.id !== 'string' ||
      seen.has(e.id) ||
      !KINDS.has(e.kind) ||
      typeof e.text !== 'string' ||
      e.text.trim().length < 20 ||
      e.text.length > 2500 ||
      typeof e.source !== 'string' ||
      !e.source.trim() ||
      !Number.isFinite(Date.parse(e.approvedAt)) ||
      e.approvedBy !== 'user' ||
      !Array.isArray(e.uses) ||
      !e.uses.includes('application') ||
      (e.company != null && (typeof e.company !== 'string' || !e.company.trim()))
    )
      throw Error('Answer context entry lacks user-approved provenance or has invalid scope');
    seen.add(e.id);
    return {
      id: e.id,
      kind: e.kind,
      text: e.text.trim(),
      source: e.source.trim(),
      approvedAt: e.approvedAt,
      approvedBy: 'user',
      uses: ['application'],
      ...(e.company ? { company: e.company.trim() } : {}),
    };
  });
  return { version: 1, entries };
}

export function readAnswerContext(path) {
  const bytes = readFileSync(path);
  if (bytes.length > 150000) throw Error('Answer context exceeds private input size limit');
  return validateAnswerContext(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')));
}

/** Employer-specific answers must never leak into another employer's prompt. */
export function contextForRole(context, role) {
  return (context?.entries ?? [])
    .filter((e) => !e.company || normalizeCompany(e.company) === normalizeCompany(role.company))
    .slice(0, 20);
}
