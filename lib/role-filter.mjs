/**
 * Deterministic role filter for the OpenClaw tri-city job campaign.
 *
 * Why this exists: on 2026-08-15 the role pool contained "Lead, Software Engineer",
 * "Senior Data Engineer", and "IT Engineer Principal II" even though the campaign
 * spec hard-rejects those titles. The pool was built by a language model reading
 * prose rules, so the rules were advisory in practice. This module makes them
 * executable: a pool that fails here can never be presented for authorization.
 *
 * Nothing in this file reaches the network or reads applicant data. It is pure
 * predicate logic over already-researched public posting metadata.
 */

import { createHash } from 'node:crypto';
import { activeBlockers } from './facts-and-blockers.mjs';
import { evidenceIsCurrent } from './company-evidence.mjs';

/** Spelled-out numerals that appear in experience requirements. */
const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};

/** Normalize a company name for deny-list and duplicate comparison. */
export function normalizeCompany(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|technologies|technology|labs|holdings|group|plc|gmbh|sa|nv|ag)\b\.?/g, ' ')
    .replace(/[^a-z0-9&+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonicalize a posting URL so duplicate detection survives tracking params,
 * locale segments, trailing slashes, and case differences in the host.
 */
export function canonicalizeUrl(rawUrl) {
  const raw = String(rawUrl ?? '').trim();
  if (!raw) return '';
  let u;
  try {
    u = new URL(raw);
  } catch {
    return raw.toLowerCase().replace(/\/+$/, '');
  }
  // Params that IDENTIFY the posting and must never be stripped. gh_jid is the
  // Greenhouse job id: dropping it collapses every job on a board to one URL,
  // which silently produces false duplicates and can point an application at the
  // wrong posting.
  const IDENTIFIERS = /^(gh_jid|jid|job_?id|requisition_?id|posting_?id|reqid|vacancy_?id)$/i;
  const TRACKING = /^(utm_|gh_src|ref|source|src|lever-|trackingid|jobboardid|icid|mc_)/i;
  for (const key of [...u.searchParams.keys()]) {
    if (!IDENTIFIERS.test(key) && TRACKING.test(key)) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  u.hash = '';
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  // Workday and similar ATSes serve the same requisition under many locale prefixes.
  u.pathname = u.pathname.replace(/\/en-[a-z]{2}\//i, '/').replace(/\/+$/, '');
  // Lowercase the SCHEME and HOST only. Paths are case-sensitive on many ATS
  // hosts: Oracle Cloud serves /hcmUI/CandidateExperience/... and a lowercased
  // path 404s. A canonical URL that does not resolve is worse than useless -
  // it is a destination an application run could be pointed at.
  const qs = u.searchParams.toString();
  return `${u.protocol.toLowerCase()}//${u.hostname.toLowerCase()}${u.pathname}${qs ? `?${qs}` : ''}`;
}

/**
 * Build one word-boundary regex per banned token.
 * "sr" must also match "Sr." and "lead" must not match "leadership".
 */
function buildTitleMatchers(bannedTokens) {
  return bannedTokens.map((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Allow an optional trailing period for abbreviations such as "Sr." and "VP."
    return { token, re: new RegExp(`(^|[^a-z0-9])${escaped}\\.?($|[^a-z0-9])`, 'i') };
  });
}

/**
 * Hard title gate. Returns every banned token found, not just the first, so the
 * rejection report explains the full reason.
 */
export function checkTitle(title, config) {
  const bannedTokens = config.titleFilter.bannedTokens;
  const normalized = String(title ?? '').toLowerCase();
  const hits = buildTitleMatchers(bannedTokens)
    .filter(({ re }) => re.test(normalized))
    .map(({ token }) => token);
  return {
    ok: hits.length === 0 && normalized.trim().length > 0,
    bannedTokensFound: hits,
    reason: hits.length
      ? `Title contains hard-rejected token(s): ${hits.join(', ')}`
      : (normalized.trim() ? null : 'Title is empty'),
  };
}

/**
 * Extract every stated years-of-experience requirement from a description.
 * Returns the LOWEST minimum found, because a posting saying "3-5 years" or
 * "2+ years, 6+ preferred" is reachable at its floor.
 */
export function extractRequiredYears(description) {
  const text = String(description ?? '').toLowerCase().replace(/\s+/g, ' ');
  if (!text) return { minimums: [], lowestMinimum: null };

  const numberWordAlt = Object.keys(NUMBER_WORDS).join('|');
  const NUM = `(\\d{1,2}|${numberWordAlt})`;
  const minimums = [];

  const toNumber = (token) => {
    if (token == null) return null;
    const t = token.trim();
    return /^\d+$/.test(t) ? Number(t) : (NUMBER_WORDS[t] ?? null);
  };

  const patterns = [
    // "5-8 years", "5 to 8 years" -> take the lower bound
    new RegExp(`${NUM}\\s*(?:-|–|—|to)\\s*${NUM}\\s*\\+?\\s*(?:years|yrs)`, 'g'),
    // "6+ years", "6 or more years", "6 years or more"
    new RegExp(`${NUM}\\s*(?:\\+|or more|or greater|plus)\\s*(?:years|yrs)`, 'g'),
    new RegExp(`${NUM}\\s*(?:years|yrs)[^.]{0,12}?(?:or more|or greater|\\+)`, 'g'),
    // "minimum of 7 years", "at least seven years", "requires 8 years"
    new RegExp(`(?:minimum(?: of)?|at least|no less than|require[sd]?(?: a minimum of)?|must have)\\s*${NUM}\\s*\\+?\\s*(?:years|yrs)`, 'g'),
    // bare "7 years of experience"
    new RegExp(`${NUM}\\s*\\+?\\s*(?:years|yrs)\\s*(?:of)?\\s*(?:relevant |professional |industry |software |engineering |hands-on )*experience`, 'g'),
  ];

  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      // Group 1 is the floor in every pattern, including ranges: for "5-8 years"
      // the upper bound never raises the minimum the posting actually requires.
      const value = toNumber(match[1]);
      if (value != null) minimums.push(value);
    }
  }

  return {
    minimums,
    lowestMinimum: minimums.length ? Math.min(...minimums) : null,
  };
}

/** Hard experience gate: reject when the lowest stated minimum exceeds the cap. */
export function checkExperience(description, config) {
  const cap = config.experienceFilter.maxAcceptedMinimumYears;
  const { minimums, lowestMinimum } = extractRequiredYears(description);

  if (lowestMinimum == null) {
    return {
      ok: true,
      lowestMinimum: null,
      uncertainty: 'No explicit years-of-experience requirement was parsed from the description.',
      reason: null,
    };
  }
  const ok = lowestMinimum <= cap;
  return {
    ok,
    lowestMinimum,
    allMinimums: minimums,
    uncertainty: null,
    reason: ok ? null : `Description requires a minimum of ${lowestMinimum} years, above the ${cap}-year cap`,
  };
}

/**
 * Role-relevance gate: the posting must actually be a software engineering job.
 *
 * Added after "Hospital Applications Analyst - Anatomic Pathology" reached a Newark
 * primary slot. It cleared every mechanical gate — good size, real thriving signals,
 * salary above the floor, exact city — but the work is clinical systems
 * configuration, not development. Passing every filter is not the same as being the
 * right job, and nothing was checking the difference.
 */
export function checkRoleRelevance(role, config) {
  const cfg = config.roleRelevanceFilter;
  if (!cfg?.enabled || !cfg.requireEngineeringTitleToken) return { ok: true, reason: null };

  const title = String(role.title ?? '').toLowerCase();
  const matched = cfg.engineeringTitleTokens.find((t) => title.includes(t.toLowerCase()));
  if (matched) return { ok: true, matched, reason: null };

  return {
    ok: false,
    matched: null,
    reason: `Title "${role.title}" contains no software-engineering token; this campaign targets developer roles, not analyst, specialist, or support titles`,
  };
}

/**
 * Core-skill gate: reject roles whose REQUIRED primary language the applicant
 * does not have.
 *
 * Added after three Stevens Capital Management roles reached the corridor pool,
 * each demanding professional-level C++ in Linux against a React/TypeScript/
 * Java/Python resume. The title gate cannot see this; only the body can.
 *
 * Narrow by design: a language offered as "a plus" or "preferred" never
 * disqualifies, because postings list extras freely and over-rejecting would
 * throw away good roles.
 */
export function checkSkillMatch(role, config) {
  const cfg = config.skillMismatchFilter;
  if (!cfg?.enabled) return { ok: true, reason: null };

  const text = String(role.description ?? '').toLowerCase().replace(/\s+/g, ' ');
  if (!text) return { ok: true, reason: null, uncertainty: 'No description to check required skills against.' };

  for (const lang of cfg.foreignLanguages) {
    const langRe = new RegExp(lang, 'i');
    let m;
    const scan = new RegExp(lang, 'gi');
    while ((m = scan.exec(text)) !== null) {
      // Requirement cues may sit anywhere in the clause, but a SOFTENER only
      // counts when it hugs the mention. "C++ ... familiarity with
      // multi-threading" is not softening C++ - that "familiarity" belongs to
      // multi-threading, 80 characters away. English attaches these tightly:
      // "Go is a plus", "familiarity with Rust", "Kotlin preferred".
      const prevPeriod = text.lastIndexOf('.', m.index);
      const prevSemi = text.lastIndexOf(';', m.index);
      const clauseStart = Math.max(prevPeriod, prevSemi) + 1;
      const nextPeriod = text.indexOf('.', m.index);
      const nextSemi = text.indexOf(';', m.index);
      const ends = [nextPeriod, nextSemi].filter((x) => x !== -1);
      const clauseEnd = ends.length ? Math.min(...ends) : text.length;
      const window = text.slice(clauseStart, clauseEnd);

      const near = text.slice(
        Math.max(clauseStart, m.index - 30),
        Math.min(clauseEnd, m.index + m[0].length + 45),
      );
      const softened = cfg.softeningCues.some((c) => near.includes(c));
      if (softened) continue;

      const required = cfg.requirementCues.some((c) => window.includes(c));
      if (!required) continue;

      // Confirm the applicant genuinely lacks it before rejecting.
      const has = cfg.applicantLanguages.some((a) => langRe.test(a));
      if (has) continue;

      const pretty = lang.replace(/\\/g, '').replace(/\\b/g, '');
      return {
        ok: false,
        matched: pretty,
        reason: `Posting requires "${pretty}", which is not in the applicant's stack (${cfg.applicantLanguages.slice(0, 6).join(', ')}...)`,
      };
    }
  }
  return { ok: true, reason: null };
}

/**
 * Eligibility gate: reject roles the applicant cannot truthfully hold.
 *
 * Added after a "Graduate Developer Programme Chicago 2027" requiring a
 * "final-year undergraduate or master's student" reached a primary slot. The
 * applicant has a completed B.S. and ten years of experience. Applying would
 * either burn a quota slot on a guaranteed rejection or require misrepresenting
 * his enrollment status, and the campaign never trades truthfulness for volume.
 *
 * A posting that merely *welcomes* new graduates is fine. One that *requires*
 * current enrollment is not.
 */
export function checkEligibility(role, config) {
  const cfg = config.eligibilityFilter;
  if (!cfg?.enabled) return { ok: true, reason: null };

  const haystack = `${role.title ?? ''} ${role.description ?? ''}`.toLowerCase().replace(/\s+/g, ' ');

  if (cfg.rejectCurrentStudentRequirement) {
    const hit = cfg.currentStudentPatterns.find((p) => haystack.includes(p.toLowerCase()));
    if (hit) {
      return {
        ok: false,
        matched: hit,
        reason: `Posting requires current student status ("${hit}"); the applicant holds a completed Bachelor of Science and is not enrolled`,
      };
    }
  }
  if (cfg.rejectHigherDegreeRequirement) {
    // A posting that PREFERS an advanced degree is fine; only a hard requirement
    // disqualifies. "bachelor's or master's" and "master's a plus" offer the
    // degree as an alternative rather than demanding it, so they must not match.
    const softened = /(bachelor[^.]{0,40}or[^.]{0,25}master|master[^.]{0,25}(a plus|preferred|nice to have)|or equivalent (experience|practical))/i.test(haystack);
    if (!softened) {
      const hit = (cfg.higherDegreePatterns ?? []).find((p) => haystack.includes(p.toLowerCase()));
      if (hit) {
        return {
          ok: false,
          matched: hit,
          reason: `Posting requires a degree above the applicant's completed Bachelor of Science ("${hit}")`,
        };
      }
    }
  }

  if (cfg.rejectInternships) {
    const hit = cfg.internshipPatterns.find((p) => haystack.includes(p.toLowerCase()));
    if (hit) {
      return { ok: false, matched: hit, reason: `Posting is an internship or co-op ("${hit}"), not a full-time role` };
    }
  }
  return { ok: true, matched: null, reason: null };
}

/** Compensation gate. A missing salary is an uncertainty, never an invented number. */
export function checkCompensation(role, config) {
  const floor = config.compensationFilter.minimumAcceptableSalary;
  const max = role.salaryMax;

  if (max == null) {
    return {
      ok: true,
      capBucket: 'backup',
      uncertainty: `No posted salary maximum. Floor of $${floor.toLocaleString()} is unverified; role is capped at the backup bucket.`,
      reason: null,
    };
  }
  if (typeof max !== 'number' || Number.isNaN(max)) {
    return { ok: false, capBucket: null, uncertainty: null, reason: `salaryMax must be a number or null, received ${JSON.stringify(max)}` };
  }
  const ok = max >= floor;
  return {
    ok,
    capBucket: null,
    uncertainty: (role.salaryMin != null && role.salaryMin < floor)
      ? `Posted minimum $${role.salaryMin.toLocaleString()} is below the $${floor.toLocaleString()} floor; only the maximum clears it.`
      : null,
    reason: ok ? null : `Posted maximum $${max.toLocaleString()} is below the $${floor.toLocaleString()} floor`,
  };
}

/**
 * Company-profile gate implementing the 2026-08-16 directive:
 * prioritize medium-to-small, not-well-known, thriving companies.
 */
export function checkCompanyProfile(role, config, city = null) {
  const cfg = config.companyProfileFilter;
  if (!cfg.enabled) return { ok: true, band: null, primaryEligible: true, score: 0, reason: null, notes: [] };

  // A city may raise its own primary headcount ceiling. Newark carries one because
  // its exact-city supply of sub-1000-person employers is effectively empty.
  const cityOverride = city?.companyProfileOverride ?? null;

  const profile = role.companyProfile ?? {};
  const notes = [];
  const normalized = normalizeCompany(role.company);

  // --- headcount band ---
  const interval = profile.headcount == null && profile.headcountMin != null;
  const headcount = interval ? profile.headcountMax : profile.headcount;
  if (interval && (!Number.isFinite(profile.headcountMin) || !Number.isFinite(profile.headcountMax) || profile.headcountMin < 0 || profile.headcountMax < profile.headcountMin || !profile.headcountSourceUrl)) {
    return {ok:false,band:null,primaryEligible:false,score:0,reason:'Headcount interval requires sourced, finite ordered bounds',notes};
  }
  if (interval) notes.push(`Headcount is a sourced interval ${profile.headcountMin}-${profile.headcountMax}; upper bound determines size eligibility.`);
  let band = profile.headcountBand ?? null;
  if (band == null && typeof headcount === 'number') {
    for (const [name, spec] of Object.entries(cfg.headcountBands)) {
      if (headcount >= spec.min && (spec.max == null || headcount <= spec.max)) { band = name; break; }
    }
  }
  if (band == null) {
    return {
      ok: false, band: null, primaryEligible: false, score: 0,
      reason: 'companyProfile.headcount or companyProfile.headcountBand is required and was not supplied',
      notes,
    };
  }
  const bandSpec = cfg.headcountBands[band];
  if (!bandSpec) {
    return { ok: false, band, primaryEligible: false, score: 0, reason: `Unknown headcount band "${band}"`, notes };
  }

  // --- household-name detection: deny list OR researcher flag ---
  // Two-pass match. Word-boundary matching alone misses concatenated brand
  // spellings: "JPMorganChase" normalizes to "jpmorganchase", which contains no
  // space, so the "jpmorgan" entry never fired and a household-name bank reached
  // a primary slot. The compact pass closes that, with a minimum entry length so
  // short entries like "ge" or "hp" cannot match inside unrelated names.
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  const MIN_COMPACT_LEN = 6;
  const denyHit = cfg.householdNameDenyList.find((entry) => {
    const e = normalizeCompany(entry);
    if (!e) return false;
    if (normalized === e || normalized.startsWith(`${e} `) || normalized.endsWith(` ${e}`) || normalized.includes(` ${e} `)) return true;
    const ce = e.replace(/[^a-z0-9]/g, '');
    return ce.length >= MIN_COMPACT_LEN && compact.includes(ce);
  });
  const isHouseholdName = profile.isHouseholdName === true || Boolean(denyHit);
  if (denyHit && profile.isHouseholdName !== true) {
    notes.push(`Matched household-name deny list entry "${denyHit}" even though the researcher did not flag it.`);
  }

  // --- thriving signals ---
  const signals = Array.isArray(profile.thrivingSignals) ? profile.thrivingSignals : [];
  const validSignals = signals.filter((s) => {
    if (!s || typeof s !== 'object') return false;
    const typeOk = cfg.thrivingSignalTypes.includes(s.type);
    const urlOk = !cfg.thrivingSignalRequirements.eachSignalNeedsSourceUrl || Boolean(s.sourceUrl);
    const hasDetail = Boolean(s.detail);
    const dated = !cfg.thrivingSignalRequirements.requireDatedSignals || evidenceIsCurrent(s,cfg.thrivingSignalRequirements.maxSignalAgeMonths);
    return typeOk && urlOk && hasDetail && dated;
  });
  if (signals.length !== validSignals.length) {
    notes.push(`${signals.length - validSignals.length} thriving signal(s) discarded for missing type, detail, or sourceUrl.`);
  }

  const primaryReq = cfg.primaryBucketRequires;
  const backupReq = cfg.backupBucketRequires;

  const primaryFailures = [];

  // Size test for a primary slot: a city-specific headcount ceiling wins over the
  // global band list when one is configured.
  const ceiling = cityOverride?.primaryHeadcountMax ?? null;
  if (ceiling != null) {
    if (typeof headcount !== 'number') {
      primaryFailures.push(`city ceiling of ${ceiling.toLocaleString()} needs a numeric headcount, got band "${band}" only`);
    } else if (headcount > ceiling) {
      primaryFailures.push(`headcount ${headcount.toLocaleString()} exceeds the ${city.label} primary ceiling of ${ceiling.toLocaleString()}`);
    } else if (!primaryReq.headcountBandIn.includes(band)) {
      notes.push(`Headcount ${headcount.toLocaleString()} (band "${band}") is primary-eligible only because ${city.label} raises its ceiling to ${ceiling.toLocaleString()}.`);
    }
  } else if (!primaryReq.headcountBandIn.includes(band)) {
    primaryFailures.push(`headcount band "${band}" is not primary-eligible`);
  }

  if (primaryReq.isHouseholdName === false && isHouseholdName) primaryFailures.push('company is a household name');
  if (validSignals.length < primaryReq.minThrivingSignals) {
    primaryFailures.push(`only ${validSignals.length} verified thriving signal(s), needs ${primaryReq.minThrivingSignals}`);
  }

  const primaryEligible = primaryFailures.length === 0;

  // Backup eligibility. Large/enterprise employers need an explicit override reason.
  const backupFailures = [];
  if (validSignals.length < backupReq.minThrivingSignals) {
    backupFailures.push(`only ${validSignals.length} verified thriving signal(s), needs ${backupReq.minThrivingSignals}`);
  }
  // A company inside a city's raised ceiling is not treated as "large" for the
  // backup override rule either — the city has already accepted that size.
  const withinCityCeiling = ceiling != null && typeof headcount === 'number' && headcount <= ceiling;
  const isLarge = !bandSpec.primaryEligible && !withinCityCeiling;
  if (isLarge) {
    const override = cfg.largeCompanyBackupOverride;
    if (!override.allowed) backupFailures.push('large/enterprise employers are not permitted at all');
    else if (override.requiresExplicitReason && !role.overrideReason) {
      backupFailures.push(`large/enterprise employer requires an explicit overrideReason describing an unusually strong match`);
    }
  }

  const ok = primaryEligible || backupFailures.length === 0;

  let score = bandSpec.score;
  if (!isHouseholdName) score += 25;
  score += Math.min(validSignals.length, 3) * 5;

  return {
    ok,
    band,
    isHouseholdName,
    householdNameDenyListHit: denyHit ?? null,
    validThrivingSignals: validSignals.length,
    primaryEligible,
    primaryFailures,
    backupFailures,
    score,
    reason: ok ? null : `Company profile fails both buckets: ${[...new Set([...primaryFailures, ...backupFailures])].join('; ')}`,
    notes,
  };
}

/** Location gate: the posted city must match an accepted alias for the claimed city. */
export function checkLocation(role, city) {
  const posted = String(role.location ?? '').toLowerCase();
  if (!posted) return { ok: false, reason: 'Role has no location' };

  // Same-name cities in other states must be excluded BEFORE alias matching.
  // Aliases match by substring, so a bare "Newark" alias otherwise accepts
  // "Newark, CA" — which is in Silicon Valley, not New Jersey.
  const excluded = city.excludedLocationPatterns?.find((p) => posted.includes(p.toLowerCase()));
  if (excluded) {
    return { ok: false, reason: `Location "${role.location}" matches excluded pattern "${excluded}" — this is a same-name city outside ${city.label}` };
  }

  const accepted = city.acceptedLocationAliases.some((a) => posted.includes(a.toLowerCase()));
  if (accepted) return { ok: true, reason: null, viaCommuteAlias: false };

  const commute = city.commuteAliases?.find((a) => posted.includes(a.toLowerCase()));
  if (commute) {
    return city.commuteAliasesAllowed
      ? { ok: true, reason: null, viaCommuteAlias: true, commuteAlias: commute }
      : { ok: false, reason: `Location "${role.location}" is a commute alias (${commute}), not ${city.label}; widening is disabled for this city` };
  }
  return { ok: false, reason: `Location "${role.location}" does not match any accepted alias for ${city.label}` };
}

/** Today's date in the campaign timezone, as YYYY-MM-DD. */
export function campaignToday(config, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** Source gate: official employer/ATS pages only. */
export function checkSource(role, config) {
  const cfg = config.sourceFilter;
  const url = canonicalizeUrl(role.url);
  if (!url) return { ok: false, reason: 'Role has no URL' };
  if (!/^https:\/\//.test(url)) return { ok: false, reason: `URL is not https: ${role.url}` };

  // Third-party marketplaces that HOST the application. Applying here is not
  // applying on the employer's own ATS, which is what the campaign requires.
  // wellfound (formerly AngelList Talent) was added 2026-08-19 after a candidate
  // reached a primary slot on a wellfound.com URL.
  const AGGREGATORS = [
    'indeed.com', 'linkedin.com/jobs', 'ziprecruiter', 'glassdoor', 'monster.com',
    'simplyhired', 'dice.com', 'talent.com', 'jooble', 'lensa', 'adzuna',
    'wellfound.com', 'angel.co', 'builtin.com', 'otta.com', 'welcometothejungle',
    'themuse.com', 'hired.com', 'snagajob', 'careerbuilder',
  ];
  const hit = AGGREGATORS.find((a) => url.includes(a));
  if (hit && cfg.rejectAggregatorApplicationPages) {
    return { ok: false, reason: `URL points at aggregator "${hit}"; an official employer or ATS URL is required` };
  }

  if (cfg.rejectStaffingIntermediaries && role.isStaffingIntermediary === true) {
    return { ok: false, reason: 'Employer is a staffing or recruiting intermediary' };
  }
  if (cfg.rejectContractOnly && role.employmentType && /contract|c2c|1099|temp\b/i.test(role.employmentType)) {
    return { ok: false, reason: `Employment type "${role.employmentType}" is contract-only` };
  }

  let ageNote = null;
  let uncertainty = null;
  const parsed = role.postedDate ? new Date(role.postedDate).getTime() : NaN;

  if (Number.isFinite(parsed)) {
    const days = Math.floor((Date.now() - parsed) / 86_400_000);
    if (days > cfg.maxPostingAgeDays) return { ok: false, reason: `Posting is ${days} days old, above the ${cfg.maxPostingAgeDays}-day maximum` };
    if (days > cfg.preferredPostingAgeDays) ageNote = `Posting is ${days} days old, beyond the ${cfg.preferredPostingAgeDays}-day preference.`;
  } else if (cfg.undatedPostingRule?.acceptVerifiedActiveOn && role.verifiedActiveOn === campaignToday(config)) {
    // Several ATSes never publish a posting date. "Confirmed open today" is the
    // fact the freshness rule is a proxy for, and the spec already requires the
    // researcher to check it, so an explicit same-day confirmation satisfies it.
    ageNote = `No posted date published by this ATS; confirmed active on ${role.verifiedActiveOn}.`;
  } else {
    // Without a date and without a same-day confirmation, the role would slip past
    // the 30-day maximum unchecked. Treat it like a missing salary: allowed,
    // flagged, and capped at backup.
    uncertainty = role.verifiedActiveOn
      ? `No posted date, and verifiedActiveOn "${role.verifiedActiveOn}" is not today (${campaignToday(config)}); freshness is unverified, so the role is capped at the backup bucket.`
      : 'No posted date could be captured and no same-day active confirmation was supplied, so freshness is unverified; role is capped at the backup bucket.';
  }
  return { ok: true, reason: null, ageNote, uncertainty, capBucket: uncertainty ? 'backup' : null };
}

/** ATS ranking bonus. Tiebreaker only — never a fit substitute. */
export function atsScore(role, config) {
  const source = `${role.source ?? ''} ${role.url ?? ''}`.toLowerCase();
  for (const tier of config.atsPreference.tiers) {
    if (tier.platforms.some((p) => source.includes(p))) return { score: tier.score, tier: tier.tier, platform: tier.platforms.find((p) => source.includes(p)) };
  }
  return { score: 0, tier: null, platform: 'unknown' };
}

/**
 * Build a company -> structural-blocker index from ledger rows.
 *
 * A blocker such as the export-control "U.S. Person" question or a required
 * residential street address lives on the EMPLOYER'S form, not on one posting,
 * so it recurs for every role at that company. Role-level dedupe cannot see this
 * because the titles differ.
 *
 * `rows` are ledger records with at least { company, title, status, notes, timestamp }.
 */
export function buildBlockerIndex(rows, config) {
  const cfg = config.knownBlockerFilter;
  const index = new Map();
  if (!cfg?.enabled) return index;

  for (const row of rows) {
    if (String(row.status ?? '').toLowerCase() !== 'blocked') continue;
    const notes = String(row.notes ?? '').toLowerCase();
    const matched = cfg.structuralBlockerPatterns.find((p) => notes.includes(p.toLowerCase()));
    if (!matched) continue;

    const key = normalizeCompany(row.company);
    if (!key) continue;
    // Keep the earliest record so the report cites when the problem first appeared.
    if (!index.has(key)) {
      index.set(key, { company: row.company, matched, title: row.title, timestamp: row.timestamp });
    }
  }
  return index;
}

/** Reject a company whose application form is known to ask an unanswerable question. */
export function checkKnownBlocker(role, config, blockerIndex) {
  if (!config.knownBlockerFilter?.enabled || !blockerIndex?.size) return { ok: true, reason: null };
  if (role.retryKnownBlocker === true) {
    return { ok: true, reason: null, note: 'Known-blocker check waived by retryKnownBlocker on this candidate.' };
  }
  const hit = blockerIndex.get(normalizeCompany(role.company));
  if (!hit) return { ok: true, reason: null };
  return {
    ok: false,
    reason: `${hit.company} previously blocked on a company-level question ("${hit.matched}") for "${hit.title}" on ${hit.timestamp}. The same form question will recur, so this slot would be wasted.`,
    blocker: hit,
  };
}

/**
 * Run every gate against one role.
 * `verdict` is 'primary' | 'backup' | 'rejected'.
 */
export function evaluateRole(role, city, config, { knownUrls = new Set(), knownCompanyTitles = new Set(), blockerIndex = new Map(), structuredBlockers = [], facts = null } = {}) {
  const checks = {
    structuredBlocker: (() => { const blocks = activeBlockers(structuredBlockers, role, facts); return { ok: blocks.length === 0, reason: blocks.map(b => b.reason).join('; ') || null }; })(),
    title: checkTitle(role.title, config),
    roleRelevance: checkRoleRelevance(role, config),
    skillMatch: checkSkillMatch(role, config),
    experience: checkExperience(role.description, config),
    eligibility: checkEligibility(role, config),
    compensation: checkCompensation(role, config),
    companyProfile: checkCompanyProfile(role, config, city),
    location: checkLocation(role, city),
    source: checkSource(role, config),
    knownBlocker: checkKnownBlocker(role, config, blockerIndex),
  };

  const canonical = canonicalizeUrl(role.url);
  const dupKey = `${normalizeCompany(role.company)}::${String(role.title ?? '').toLowerCase().trim()}`;
  const duplicate =
    (canonical && knownUrls.has(canonical)) ? { ok: false, reason: `Canonical URL already present in the application ledger: ${canonical}` }
    : knownCompanyTitles.has(dupKey) ? { ok: false, reason: `Company + title already present in the application ledger: ${dupKey}` }
    : { ok: true, reason: null };
  checks.duplicate = duplicate;

  const failures = Object.entries(checks)
    .filter(([, r]) => r.ok === false)
    .map(([name, r]) => ({ check: name, reason: r.reason }));

  const uncertainties = Object.entries(checks)
    .filter(([, r]) => r.uncertainty)
    .map(([name, r]) => ({ check: name, uncertainty: r.uncertainty }));

  const notes = [
    ...(checks.companyProfile.notes ?? []),
    ...(checks.source.ageNote ? [checks.source.ageNote] : []),
    ...(checks.knownBlocker.note ? [checks.knownBlocker.note] : []),
  ];

  let verdict = 'rejected';
  if (failures.length === 0) {
    // Any gate may cap a role at backup: unverified salary, unverified freshness.
    const capsToBackup = Object.values(checks).some((c) => c.capBucket === 'backup');
    verdict = (checks.companyProfile.primaryEligible && !capsToBackup) ? 'primary' : 'backup';
  }

  const ats = atsScore(role, config);
  const score = verdict === 'rejected' ? 0 : (role.fitScore ?? 0) + checks.companyProfile.score + ats.score;

  return {
    company: role.company,
    title: role.title,
    url: role.url,
    canonicalUrl: canonical,
    city: city.label,
    verdict,
    score,
    ats,
    checks,
    failures,
    uncertainties,
    notes,
  };
}

/** SHA-256 over the sorted canonical URL list — the immutable authorization fingerprint. */
export function poolHash(urls) {
  const sorted = [...new Set(urls.map(canonicalizeUrl))].filter(Boolean).sort();
  return createHash('sha256').update(sorted.join('\n')).digest('hex');
}

/**
 * Evaluate a whole pool and assemble per-city primary/backup buckets honoring quota.
 * Large/enterprise backups are always ordered last regardless of score.
 */
export function buildPool(roles, config, ledgerIndex = {}) {
  const cityById = new Map(config.cities.map((c) => [c.id, c]));
  const results = { byCity: {}, rejected: [], quotaShortfalls: [] };

  for (const city of config.cities) {
    results.byCity[city.id] = { label: city.label, quota: city.dailyQuota, minBackups: city.minBackups, primary: [], backup: [] };
  }

  for (const role of roles) {
    const city = cityById.get(role.cityId);
    if (!city) {
      results.rejected.push({ company: role.company, title: role.title, verdict: 'rejected', failures: [{ check: 'cityId', reason: `Unknown cityId "${role.cityId}"` }] });
      continue;
    }
    const evaluated = evaluateRole(role, city, config, ledgerIndex);
    if (evaluated.verdict === 'rejected') results.rejected.push(evaluated);
    else results.byCity[city.id][evaluated.verdict].push(evaluated);
  }

  for (const city of config.cities) {
    const bucket = results.byCity[city.id];
    const rankLarge = (e) => (e.checks.companyProfile.primaryEligible ? 0 : 1);
    bucket.primary.sort((a, b) => b.score - a.score);
    bucket.backup.sort((a, b) => rankLarge(a) - rankLarge(b) || b.score - a.score);

    // Overflow primaries beyond quota become the highest-priority backups.
    if (bucket.primary.length > bucket.quota) {
      bucket.backup.unshift(...bucket.primary.splice(bucket.quota));
    }
    if (bucket.primary.length < bucket.quota) {
      results.quotaShortfalls.push({ city: city.label, needed: bucket.quota, found: bucket.primary.length, shortfall: bucket.quota - bucket.primary.length });
    }
    if (bucket.backup.length < bucket.minBackups) {
      results.quotaShortfalls.push({ city: city.label, needed: bucket.minBackups, found: bucket.backup.length, shortfall: bucket.minBackups - bucket.backup.length, bucket: 'backup' });
    }
  }

  const allUrls = Object.values(results.byCity).flatMap((b) => [...b.primary, ...b.backup].map((e) => e.canonicalUrl));
  results.poolHash = poolHash(allUrls);
  results.totalPrimary = Object.values(results.byCity).reduce((n, b) => n + b.primary.length, 0);
  results.totalBackup = Object.values(results.byCity).reduce((n, b) => n + b.backup.length, 0);
  results.totalQuota = config.cities.reduce((n, c) => n + c.dailyQuota, 0);
  return results;
}
