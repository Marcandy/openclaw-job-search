import { readFileSync } from 'node:fs';
import { extractPdf } from './source-documents.mjs';

// The title typed into a form must match the title on the attached resume.
// The applicant presents the same role differently by level ("Software
// Consultant" for mid-level, "Software Consultant / Technical Lead" for
// senior), so a mismatched pair would contradict itself on one application.

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The title on the first experience entry at `company`, or null. */
export function experienceTitle(text, company) {
  const flat = String(text ?? '').replace(/\s+/g, ' ');
  const at = `\\s*[—–-]\\s*${escape(String(company ?? '').trim())}\\b`;
  const afterHeading = flat.match(new RegExp(`EXPERIENCE\\s+([^•|]{2,80}?)${at}`, 'i'));
  if (afterHeading) return afterHeading[1].trim();
  const anywhere = flat.match(new RegExp(`(?:^|[•|]\\s*)([A-Z][^•|]{2,80}?)${at}`));
  return anywhere ? anywhere[1].trim() : null;
}

/**
 * Compare every pinned resume with the confirmed current title. Returns the
 * mismatches; an empty list means the pair agrees or no title is confirmed.
 */
export async function resumeTitleMismatches(resumePaths, facts, { read = readFileSync } = {}) {
  const expected = facts?.fields?.currentTitle?.value;
  const company = facts?.fields?.currentCompany?.value;
  if (!expected || !company) return [];
  const mismatches = [];
  for (const path of resumePaths) {
    const { pages } = await extractPdf(read(path));
    const found = experienceTitle(pages.map((p) => p.text).join(' '), company);
    if (found?.toLowerCase() !== String(expected).trim().toLowerCase())
      mismatches.push({ path, expected, found });
  }
  return mismatches;
}
