import { readJson, fileDigest, digest } from './runtime.mjs';
import { campaignToday, normalizeCompany } from './role-filter.mjs';

export function verifyStandingPolicy(runtime, path, { now = new Date() } = {}) {
  const p = readJson(path);
  if (p.campaignDate && p.campaignDate !== campaignToday(runtime.config, now))
    throw Error('One-off application authorization is outside its campaign date');
  if (
    p.enabled !== true ||
    !Number.isSafeInteger(p.dailyLimit) ||
    p.dailyLimit < 1 ||
    !p.approvedBy ||
    !p.instruction ||
    !Number.isFinite(Date.parse(p.approvedAt))
  )
    throw Error('Standing authorization is absent or disabled');
  if (p.timezone !== runtime.config.timezone)
    throw Error('Standing authorization timezone differs from the campaign');
  if (p.configDigest !== runtime.configDigest || p.sourceDigest !== runtime.sourceDigest)
    throw Error('Standing authorization: code/config changed');
  if (fileDigest(runtime.config.paths.facts) !== p.factsHash)
    throw Error('Standing authorization: confirmed facts changed');
  if (
    fileDigest(runtime.config.paths.boards) !== p.boardsHash ||
    fileDigest(p.seedProfilesPath) !== p.seedProfilesHash
  )
    throw Error('Standing authorization: discovery inputs changed');
  for (const [path, hash] of Object.entries(p.resumes ?? {}))
    if (fileDigest(path) !== hash) throw Error('Standing authorization: resume changed');
  if (!Object.keys(p.resumes ?? {}).length || !p.allowedCityIds?.length)
    throw Error('Standing scope is empty');
  return { ...p, hash: digest(p) };
}

// Count distinct destinations, including manual submissions and legacy history.
// An uncertain delivery consumes a slot; a confirmed pre-submit block does not.
export function dailyUsage(store, timezone, now = new Date()) {
  const { day, confirmed, ids } = occupiedToday(store, timezone, now);
  return { day, confirmed, occupied: ids.size, uncertain: ids.size - confirmed };
}

// Count today's occupied slots per employer, using the same rule as dailyUsage.
// Many same-day applications to one employer read as indiscriminate to its recruiters.
export function companyUsage(store, timezone, now = new Date()) {
  const counts = new Map();
  for (const id of occupiedToday(store, timezone, now).ids) {
    const company = normalizeCompany(store.get(id)?.record.company);
    if (company) counts.set(company, (counts.get(company) ?? 0) + 1);
  }
  return counts;
}

// Return a role predicate that admits an employer only below its daily cap.
export function belowCompanyCap(store, timezone, cap, now = new Date()) {
  const counts = companyUsage(store, timezone, now);
  return (role) => (counts.get(normalizeCompany(role.company)) ?? 0) < cap;
}

function occupiedToday(store, timezone, now) {
  const day = campaignToday({ timezone }, now),
    ids = new Set();
  for (const e of store.db
    .prepare("SELECT app_id,kind,at,data_json FROM events WHERE kind IN ('submitted','legacy')")
    .all()) {
    const data = JSON.parse(e.data_json);
    if (e.kind === 'legacy' && String(data.status).toLowerCase() !== 'submitted') continue;
    const at = new Date(e.kind === 'legacy' ? data.timestamp : (data.receipt?.observedAt ?? e.at));
    if (Number.isFinite(at.getTime()) && campaignToday({ timezone }, at) === day) ids.add(e.app_id);
  }
  const confirmed = ids.size;
  for (const a of store.db
    .prepare("SELECT id,updated_at FROM applications WHERE state IN ('submit_started','uncertain')")
    .all()) {
    if (campaignToday({ timezone }, new Date(a.updated_at)) === day) ids.add(a.id);
  }
  return { day, confirmed, ids };
}

export function beginDailySubmit(store, id, runId, policy, now = new Date()) {
  return store.transaction(() => {
    const a = store.get(id);
    if (a?.run_id !== runId || a.state !== 'filling')
      throw Error("Daily submission requires this run's filled destination");
    store.heartbeat(runId);
    const usage = dailyUsage(store, policy.timezone, now);
    if (usage.occupied >= policy.dailyLimit) throw Error('Daily application limit reached');
    const at = now.toISOString();
    store.db
      .prepare("UPDATE applications SET state='submit_started',updated_at=? WHERE id=?")
      .run(at, id);
    store.event(id, 'submit_started', { standingPolicyHash: policy.hash, day: usage.day }, at);
    return usage;
  });
}

// Unicode hyphens and dashes ("non‑compete") become "-" so every rule sees one spelling.
const clean = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .replace(/[‐-―−]/g, '-')
    .replace(/[✱*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const consent =
  /consent|background check|arbitration|recording|agree to|terms and conditions|privacy policy|certify|attest|acknowledge/i;
const US_STATES = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

// Acknowledgments the user approved once as standing choices (2026-10-19).
// Each applies only when the policy enables it, the form offers exactly one
// affirmative option, and the label names nothing on the never list.
const STANDING_CHOICES = [
  {
    id: 'privacyNoticeAcknowledgment',
    label:
      /(?=.*\b(?:acknowledge|have read|read and understand)\b)(?=.*\bprivacy (?:notice|policy)\b)/i,
    option:
      /^(?:acknowledge(?:d)?(?:\s*\/\s*confirm(?:ed)?)?|confirm(?:ed)?|yes|i acknowledge\b.*|i have read\b.*)$/i,
  },
  {
    id: 'accuracyConfirmation',
    label:
      /double-check|information (?:provided|above|submitted)\b.*\b(?:accurate|complete|true)\b|\b(?:accurate|true) and complete\b/i,
    option: /\b(?:reviewed|confirm(?:ed)?|certify|accurate)\b|^yes$/i,
  },
  {
    id: 'interviewRecordingConsent',
    label: /\brecord(?:ing|ed)?\b.*\binterview|\binterview.*\brecord|\bnote.?taker\b/i,
    option: /^(?:yes|i consent|consent|i agree|agree)\b/i,
  },
];
const NEVER_STANDING =
  /arbitration|background check|credit check|drug|non-?compete|non-?solicit|terms (?:and|&) conditions|marketing|sms|text message|newsletter/i;

/** The approved standing choice that answers this question, or null. */
export function standingChoiceAnswer(q, label, policy) {
  if (NEVER_STANDING.test(label)) return null;
  const rule = STANDING_CHOICES.find((r) => r.label.test(label));
  if (!rule || policy?.standingChoices?.[rule.id] !== true) return null;
  const affirmative = (q.options ?? []).filter(
    (o) => rule.option.test(clean(o)) && !/^no\b|\bnot\b|do not|don't|decline/i.test(clean(o)),
  );
  return affirmative.length === 1 ? { id: rule.id, option: affirmative[0] } : null;
}

/**
 * Answer a citizenship-category question from a confirmed permanent-resident
 * work authorization: "Yes" when the label lists permanent residents among the
 * accepted categories, or the single offered permanent-resident option.
 */
export function permanentResidentAnswer(q, label, workAuthorization) {
  if (!/\bcitizen/i.test(label) || !/permanent resident|green card/i.test(label)) return null;
  if (!/permanent resident|green card/i.test(workAuthorization ?? '')) return null;
  const options = (q.options ?? []).map(clean);
  if (/\bor\b/i.test(label) && options.includes('Yes') && options.includes('No'))
    return q.options[options.indexOf('Yes')];
  const matches = q.options?.filter(
    (o) => /permanent resident|green card/i.test(o) && !/\bnot\b|\bnon-|neither|none/i.test(o),
  );
  return matches?.length === 1 ? matches[0] : null;
}

/**
 * Answer "Do you live in one of the following states? A, B, C" from the confirmed
 * home state. Returns null unless the label names at least three states and the
 * form offers a plain Yes/No choice, so an unusual question stays blocked.
 */
export function homeStateListAnswer(label, homeState, options = []) {
  if (!/\b(?:live|reside|located|based)\b.*\b(?:following|these|listed)\b.*\bstates\b/i.test(label))
    return null;
  const home = US_STATES[String(homeState ?? '').toUpperCase()];
  if (!home) return null;
  // Match longer names first and remove them, so "West Virginia" never also
  // counts as "Virginia".
  let list = label.replace(/^[^?:]*[?:]/, '');
  const named = [];
  for (const name of Object.values(US_STATES).sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(`(?<![a-z])${name}(?![a-z])`, 'gi');
    if (pattern.test(list)) {
      named.push(name);
      list = list.replace(pattern, ' ');
    }
  }
  if (named.length < 3) return null;
  const answer = named.includes(home) ? 'Yes' : 'No';
  return options.find((o) => clean(o).toLowerCase() === answer.toLowerCase()) ?? null;
}
/**
 * Answer "Are you bound by any agreement (non-compete, non-solicitation, ...)
 * that may restrict your ability to work here?" from the confirmed facts: "No"
 * only when both noncompete and nonsolicitation are confirmed false, and only
 * as a question about restrictions, never an agreement the applicant signs.
 */
export function restrictiveAgreementAnswer(q, label, fields) {
  if (
    !/^(?:are|do|is) you\b/i.test(label) ||
    !/\b(?:bound by|subject to|party to|signed|have)\b.*\b(?:agreements?|non-compete|non-solicit\w*|restrictions?|obligations?)\b/i.test(
      label,
    ) ||
    !/non-compete|non-solicit|restrict|limit/i.test(label)
  )
    return null;
  if (fields?.noncompete?.value !== false || fields?.nonsolicitation?.value !== false) return null;
  const options = (q.options ?? []).filter(Boolean);
  if (!options.length) return ['text', 'textarea'].includes(q.type) ? 'No' : null;
  return options.find((o) => /^no\b/i.test(clean(o))) ?? null;
}

/**
 * Answer "From where do you intend to work?" from the role itself: the single
 * remote option for a U.S. remote role, or the single option naming the role's
 * city. Returns null unless exactly one offered option fits.
 */
export function workLocationChoice(q, label, destination) {
  if (
    !/\bwhere (?:do|will|would) you (?:intend|plan|expect|want) to work\b|\bwhich (?:office|location)s? (?:do|will|would) you (?:intend|plan|want|prefer) to work\b/i.test(
      label,
    )
  )
    return null;
  const options = (q.options ?? []).filter(Boolean);
  const city = String(destination.location ?? '')
    .split(',')[0]
    .trim();
  const matches =
    destination.cityId === 'us-remote'
      ? options.filter(
          (o) =>
            /^remote$/i.test(clean(o)) ||
            (/\bremote\b/i.test(o) && /\b(?:US|USA|U\.S\.|United States)\b/.test(o)),
        )
      : options.filter(
          (o) =>
            city &&
            !/\bremote\b/i.test(o) &&
            new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(o),
        );
  return matches.length === 1 ? matches[0] : null;
}
export function mapRoutineQuestions(questions, destination, confirmed, policy, now = new Date()) {
  const facts = structuredClone(confirmed),
    answers = {},
    blocked = [];
  const add = (q, value, source) => {
    const key = 'routine_' + digest([destination.url, q.key, value]).slice(0, 24);
    facts.fields[key] = {
      value,
      source,
      confirmedAt: now.toISOString(),
      uses: ['application'],
      employer: destination.company,
    };
    answers[q.key] = key;
  };
  const fact = (q, key) => {
    const f = facts.fields[key];
    if (!f || f.value == null || !f.uses.includes('application')) return false;
    if (f.employer && normalizeCompany(f.employer) !== normalizeCompany(destination.company))
      return false;
    let value = f.value;
    if (q.options?.filter(Boolean).length) {
      const match = q.options.find((o) => clean(o).toLowerCase() === clean(value).toLowerCase());
      if (!match) return false;
      value = match;
    }
    if (value === f.value) answers[q.key] = key;
    else add(q, value, 'Exact offered option matching confirmed fact ' + key);
    return true;
  };
  for (const q of questions) {
    if (q.type === 'file') continue;
    const label = clean(q.label),
      key = q.key;
    let mapped = false,
      stateAnswer,
      choice,
      resident,
      restriction,
      workplace;
    // Pronouns come from the applicant's own confirmed answer: the single
    // offered option that starts with it, e.g. "He/him/his" for "he/him".
    if (/pronoun/i.test(label) && facts.fields.pronouns?.value) {
      const stated = clean(facts.fields.pronouns.value).toLowerCase();
      const matches = (q.options ?? []).filter((o) => clean(o).toLowerCase().startsWith(stated));
      if (matches.length === 1) add(q, matches[0], 'Confirmed fact pronouns');
      else if (!q.options?.length && ['text', 'textarea'].includes(q.type))
        add(q, facts.fields.pronouns.value, 'Confirmed fact pronouns');
      else if (q.required) blocked.push({ key, label, reason: 'unknown_fact_or_control' });
      continue;
    }
    // Optional demographic and consent fields stay empty. Required opt-out is a
    // choice, never an invented demographic characteristic.
    if (/gender|race|ethnic|hispanic|veteran|disab|pronoun/i.test(label)) {
      if (q.required) {
        const option = q.options?.find((o) =>
          /decline|prefer not|do not (?:wish|want)|don't (?:wish|want)/i.test(o),
        );
        if (option) {
          add(q, option, 'User-authorized routine application; demographic disclosure declined');
          mapped = true;
        }
      } else continue;
    } else if (q.required && (choice = standingChoiceAnswer(q, label, policy))) {
      add(q, choice.option, 'Standing user choice: ' + choice.id);
      // Consent controls are filled only from a fact that names this consent.
      facts.fields[answers[q.key]].uses.push('consent:' + q.key);
      mapped = true;
    } else if (
      (restriction = restrictiveAgreementAnswer(q, label, facts.fields)) &&
      q.kind !== 'consent'
    ) {
      add(q, restriction, 'Confirmed facts: no non-compete and no non-solicitation agreement');
      mapped = true;
    } else if (q.kind === 'consent' || consent.test(label)) {
      if (!q.required) continue;
    } else if (
      /\b(?:Canada|Canadian|United Kingdom|UK|Australia|Germany|European Union)\b/i.test(label) &&
      /authoriz|sponsor|eligible to work|work permit/i.test(label) &&
      !/^Are you (?:legally )?authorized to work in (?:the )?(?:United States|U\.?S\.?) or Canada\??$/i.test(
        label,
      )
    ) {
      // US authorization does not establish authorization in another country.
    } else if (/_systemfield_name$/.test(key) || /^(?:full |legal |preferred )?name$/i.test(label))
      mapped = fact(q, 'fullName');
    else if (/^(?:legal )?first name$/i.test(label)) mapped = fact(q, 'firstName');
    else if (/^(?:legal )?last name$/i.test(label)) mapped = fact(q, 'lastName');
    else if (q.type === 'email' || /^email(?: address)?$/i.test(label)) mapped = fact(q, 'email');
    else if (key === 'country' && /country/i.test(label)) mapped = fact(q, 'phoneCountry');
    else if (q.type === 'tel' || /^phone(?: number)?$/i.test(label)) mapped = fact(q, 'phone');
    else if (/linkedin/i.test(label)) mapped = fact(q, 'linkedin');
    else if (/github/i.test(label)) mapped = fact(q, 'github');
    else if (
      /^(?:personal )?(?:website|portfolio)(?:\s*\/\s*(?:website|portfolio))?(?: (?:url|link))?$/i.test(
        label,
      ) ||
      (q.type === 'url' && /^projects$/i.test(label))
    )
      mapped = fact(q, 'portfolio');
    else if (
      key === '_systemfield_location' ||
      key === 'ashby_location_combobox' ||
      /^(?:current )?location(?: \(city\))?$/i.test(label)
    )
      mapped = fact(q, 'homeCity');
    else if (
      /country (?:of residence|where you live)|what country are you based in|(?:based|located|live) in any of (?:these|the following) countries/i.test(
        label,
      )
    )
      mapped = fact(q, 'homeCountry');
    else if (/^state(?: of residence)?$/i.test(label)) mapped = fact(q, 'homeState');
    else if (/^(?:what is your )?(?:current|most recent) (?:company|employer)\b/i.test(label))
      mapped = fact(q, 'currentCompany');
    else if (
      /^(?:what is your )?(?:current|most recent) (?:job )?(?:title|position)\b/i.test(label)
    )
      mapped = fact(q, 'currentTitle');
    else if (/security clearance/i.test(label)) {
      mapped = fact(q, 'securityClearance');
      // A confirmed "None" answers a Yes/No "do you hold a clearance" question.
      const no = q.options?.find((o) => /^no$/i.test(clean(o)));
      if (
        !mapped &&
        no &&
        /^none$/i.test(facts.fields.securityClearance?.value ?? '') &&
        /\bdo you (?:currently )?(?:have|hold)\b/i.test(label)
      ) {
        add(q, no, 'Confirmed security clearance status: None');
        mapped = true;
      }
    } else if (/highest (?:degree|level of education)/i.test(label))
      mapped = fact(q, 'highestDegree');
    else if (/^(?:school|university|college)(?: name)?$/i.test(label)) mapped = fact(q, 'school');
    else if (
      /unrestricted work authorization.*United States/i.test(label) &&
      /permanent resident|green card/i.test(facts.fields.workAuthorization?.value ?? '')
    ) {
      add(q, 'Yes', 'Confirmed Lawful Permanent Resident work authorization');
      mapped = true;
    } else if (
      (resident = permanentResidentAnswer(q, label, facts.fields.workAuthorization?.value))
    ) {
      add(q, resident, 'Confirmed Lawful Permanent Resident work authorization');
      mapped = true;
    } else if (
      /(?:legally |currently )?authorized to work|legally eligible to work|legal right to work/i.test(
        label,
      ) &&
      !/not authorized|outside|other countries/i.test(label)
    )
      mapped = fact(q, 'authorizedToWorkText');
    else if (/work without.*sponsor/i.test(label) && facts.fields.needsSponsorship?.value === false)
      mapped = fact(q, 'authorizedToWorkText');
    else if (
      /(?:require|need).*sponsor|(?:now|future).*sponsor/i.test(label) &&
      !/not require|without/i.test(label)
    )
      mapped = fact(q, 'needsSponsorshipText');
    else if ((stateAnswer = homeStateListAnswer(label, facts.fields.homeState?.value, q.options))) {
      add(q, stateAnswer, 'Derived from confirmed home state');
      mapped = true;
    } else if (
      /\b(?:based|located|reside|live)\b.*\b(?:U\.?S\.?|United States|North America|the Americas)\b/i.test(
        label,
      ) &&
      !/\b(?:not|outside)\b|\bstates?\b.*(?:following|these|listed)|(?:following|these|listed).*\bstates?\b/i.test(
        label,
      ) &&
      facts.fields.homeCountry?.value === 'United States'
    ) {
      add(q, 'Yes', 'Confirmed United States home country and home city');
      mapped = true;
    } else if ((workplace = workLocationChoice(q, label, destination))) {
      add(q, workplace, 'Matches the location of the role being applied to');
      mapped = true;
    } else if (
      /\bif remote\b.*\b(?:city|state|location)\b|\b(?:city|state|location)\b.*\bwork(?:ing)? (?:from|remotely)\b/i.test(
        label,
      ) &&
      ['text', 'textarea'].includes(q.type)
    )
      mapped = fact(q, 'remoteWorkLocation');
    else if (/currently leveled as Senior-level/i.test(label))
      mapped = fact(q, 'hexSeniorLevelText');
    else if (
      /(?:how|where) did you (?:first )?(?:hear|learn|find)|how you (?:first )?(?:heard|learned|found)/i.test(
        label,
      )
    ) {
      const options = q.options?.filter(Boolean) ?? [];
      const option =
        options.find((o) => /^other$/i.test(o)) ??
        options.find((o) =>
          /^(?:external job board|company website|(?:company )?careers? (?:page|site|website))$/i.test(
            o,
          ),
        );
      if (option || (!options.length && ['text', 'textarea'].includes(q.type))) {
        add(
          q,
          option ?? "OpenClaw search of the employer's official careers page",
          'Actual discovery from official employer ATS board',
        );
        mapped = true;
      }
    } else if (/willing to relocate|open to relocat/i.test(label))
      mapped = fact(q, 'relocationText');
    else if (
      destination.cityId !== 'us-remote' &&
      /(?:available|able|willing).*(?:onsite|in.person)/i.test(label)
    )
      mapped = fact(q, 'onsiteText');
    else if (
      /salary|compensation expectation/i.test(label) &&
      !/hourly|previous|current|history/i.test(label)
    )
      mapped = fact(q, q.type === 'number' ? 'salary' : 'salaryText');
    else if (
      /why.*(?:join|interested|work|company|applying)|what excites you about|tell us about yourself|additional information|cover letter|what.*(?:skills|experience).*bring/i.test(
        label,
      ) &&
      ['text', 'textarea'].includes(q.type) &&
      policy.applicationIntro
    ) {
      add(
        q,
        `I am interested in contributing to ${destination.company} as a ${destination.title}. ${policy.applicationIntro}`,
        'User-authorized application draft using the approved resume summary template',
      );
      mapped = true;
    }
    if (q.required && !mapped)
      blocked.push({
        key,
        label,
        reason:
          consent.test(label) || q.kind === 'consent'
            ? 'unapproved_consent'
            : 'unknown_fact_or_control',
      });
  }
  return { answers, facts, blocked };
}
