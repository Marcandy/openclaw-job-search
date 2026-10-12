/**
 * Can this posting actually be APPLIED to by the automation?
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-09-01 "Flotive AI - Founding Software Engineer" reached a Newark
 * PRIMARY slot. verify-candidates reported [ OK ]. The role was real, in
 * Jersey City, and paid $150-180k - but its URL was
 * https://flotive.ai/careers.html, a careers landing page whose application
 * instruction reads:
 *
 *   "Interested candidates should reach out to careers@flotive.ai with the
 *    subject line 'Founding Software Engineer' and attach their resume."
 *
 * There is no form. There is no ATS. There is therefore no visible receipt,
 * and a submission may never be counted without one. The role consumed a
 * primary slot that nothing could ever convert.
 *
 * The existing verifier could not catch this because it only asked "did the
 * page load and do the recorded values appear on it". Both were true. It never
 * asked the question that decides whether a slot can convert: IS THERE A FORM.
 *
 * This is the same shape as the section-4 defects: a gate that reports success
 * while the thing it exists to prevent walks straight through.
 *
 * The check is deliberately asymmetric. A URL on a known ATS host is accepted
 * without reading the page, because those hosts are application forms by
 * definition and many render client-side. Everything else must show positive
 * evidence of a form; email-only instructions are a hard reject.
 */

/** Hosts that ARE application forms. Presence here is sufficient evidence. */
export const KNOWN_ATS_HOSTS = [
  'jobs.ashbyhq.com',
  'greenhouse.io',
  'job-boards.greenhouse.io',
  'boards.greenhouse.io',
  'jobs.lever.co',
  'myworkdayjobs.com',
  'ats.rippling.com',
  'breezy.hr',
  'icims.com',
  'workable.com',
  'smartrecruiters.com',
  'jobvite.com',
  'taleo.net',
  'successfactors.com',
  'bamboohr.com',
  'applytojob.com',
  'dayforcehcm.com',
  'avature.net',
  'oraclecloud.com',
  'eightfold.ai',
  'paylocity.com',
  'ashbyhq.com',
];

/**
 * Phrases that say "send us an email" rather than "fill in this form".
 * Matched only on non-ATS pages - plenty of real ATS postings also print a
 * recruiter's address for questions, which is not an application instruction.
 */
const EMAIL_ONLY_MARKERS = [
  'reach out to',
  'send your resume',
  'send us your resume',
  'email your resume',
  'email us your resume',
  'apply via email',
  'apply by email',
  'submit your resume to',
  'with the subject line',
  'attach their resume',
  'attach your resume',
  'email your cv',
  'send your cv',
];

/** Positive evidence that a real application form exists on the page. */
const FORM_MARKERS = [
  'apply for this job',
  'apply now',
  'submit application',
  'application form',
  'first name',
  'last name',
  'upload resume',
  'upload your resume',
  'attach resume',
  'resume/cv',
  'linkedin profile',
];

export function atsHostOf(rawUrl) {
  let host;
  try {
    host = new URL(String(rawUrl)).hostname.toLowerCase();
  } catch {
    return null;
  }
  return KNOWN_ATS_HOSTS.find((h) => host === h || host.endsWith(`.${h}`)) ?? null;
}

/**
 * Decide how (or whether) a posting can be applied to.
 *
 * @returns {{method:string, ok:boolean, detail:string}}
 *   method: 'ats' | 'email-only' | 'form' | 'unknown'
 *   ok:     may this URL occupy a slot?
 */
export function detectApplyMethod(rawUrl, pageText = '') {
  const ats = atsHostOf(rawUrl);
  if (ats) {
    return { method: 'ats', ok: true, detail: `hosted on ${ats}` };
  }

  const text = String(pageText).toLowerCase();

  // Not enough page to judge. Say so rather than guessing either way -
  // an unread page is not evidence of a form OR of its absence.
  if (text.length < 400) {
    return {
      method: 'unknown',
      ok: true,
      detail: 'not a known ATS host and the page could not be read; confirm an application form exists in the browser',
    };
  }

  const mailto = /mailto:[^\s"'<>]+/i.test(String(pageText));
  const emailPhrase = EMAIL_ONLY_MARKERS.find((m) => text.includes(m));
  const formHit = FORM_MARKERS.find((m) => text.includes(m));

  // An email instruction plus a mailto and no form is the Flotive shape.
  if (emailPhrase && mailto && !formHit) {
    return {
      method: 'email-only',
      ok: false,
      detail: `applications are accepted by email ("${emailPhrase}"), not through a form; no ATS receipt is possible`,
    };
  }

  if (formHit) {
    return { method: 'form', ok: true, detail: `application form detected ("${formHit}")` };
  }

  // A careers page with an email address, no form markers at all, and an
  // email phrase is still email-only even without a literal mailto: link.
  if (emailPhrase && /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(String(pageText))) {
    return {
      method: 'email-only',
      ok: false,
      detail: `applications appear to be by email ("${emailPhrase}") with no form on the page`,
    };
  }

  return {
    method: 'unknown',
    ok: true,
    detail: 'no application form detected on a non-ATS page; confirm in the browser before spending a slot',
  };
}
