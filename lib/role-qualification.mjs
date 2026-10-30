import { digest } from './runtime.mjs';

// This is an evidence-bearing screen, not a claim that keyword overlap proves fit.
const softwareTitle =
  /\b(?:software|full[ -]?stack|front[ -]?end|back[ -]?end|programmer|sdet|swe|sde|web developer|qa automation)\b/i;
const softwareDuty =
  /\b(?:build|develop|implement|design|maintain|test|ship|write|deliver)\w*\b[^.!?;,\n]{0,100}\b(?:software|web applications?|apis?|backend|frontend|react|typescript|python|java|automated tests?|data pipelines?|microservices)\b/i;
const wrongTitle =
  /\b(?:instrumentation engineer|gnc engineer|guidance.{0,15}navigation.{0,15}control engineer|propulsion engineer|flight test engineer|rf|emc|antenna|lte validation|field services?|developer programs?|developer relations|developer advocate|customer excellence|sales engineer|technical support engineer|security operations|threat detection|detection (?:and|&) response)\b/i;
const hardwareDuty =
  /\b(?:design|develop|create|build|route|fabricate|install|wire|troubleshoot)\w*\b[^.!?;,\n]{0,100}\b(?:harness assemblies|cable harnesses|wire harnesses|wiring harnesses|wiring diagrams|3d harness|electro-mechanical assemblies|circuit boards|test instrumentation systems|rocket test stands|propulsion test rigs)\b/i;
const specialties = [
  ['Vue', /\bvue(?:\.js|js)?\b/i],
  ['Angular', /\bangular\b/i],
  ['SolidWorks/CAD', /\b(?:solidworks|catia|3d cad)\b/i],
  ['Salesforce Marketing Cloud', /\bsalesforce marketing cloud\b/i],
  ['SailPoint', /\bsailpoint\b/i],
  ['SAP S/4HANA', /\bsap s\/4hana\b/i],
];
const mandatory =
  /require|must|professional|production|hands.on|proficien|experience with|experience (?:developing|building)|expertise/i;

export function qualifyRole(role, config = {}, facts = null) {
  const title = String(role.title ?? '');
  const body = String(role.description ?? '')
    .replace(/[ \t\r]+/g, ' ')
    .trim();
  const evidence = [],
    gaps = [];
  const add = (kind, match, reason) => {
    if (!match) return;
    evidence.push({ kind, excerpt: match[0] });
    gaps.push(reason);
  };
  add('role_family', title.match(wrongTitle), 'Non-development role family');
  const marker =
    /(?:^|\n)\s*(?:responsibilities|what (?:you.ll|you will) (?:get to )?do|your responsibilities)\s*:?/im.exec(
      body,
    ) ?? /(?:^|\n)\s*(?:the role|your mission|about the role)\s*:?/im.exec(body);
  const dutiesText = marker
    ? body
        .slice(marker.index + marker[0].length)
        .split(
          /(?:^|\n)\s*(?:qualifications|requirements|what we.re looking for|what you have|what will set you apart|benefits|compensation)\b/im,
        )[0]
    : body;
  add(
    'duties',
    dutiesText.match(hardwareDuty),
    'Physical hardware duties, not software development',
  );
  const eligibilityText = body.split(/(?<!\b[A-Za-z]\.)(?<=[.!?])\s+|[;\n]/);
  const clearanceText = eligibilityText
    .filter(
      (c) =>
        !/no security clearance|clearance.{0,20}(?:not required|not necessary|preferred)/i.test(c),
    )
    .join('; ');
  const clearance = clearanceText.match(
    /(?:must|require\w*|ability to (?:maintain or )?obtain|eligible (?:for|to obtain))[^.!?]{0,90}(?:TS\/\/SCI|TS\/SCI|top secret|(?:security )?clearance)|(?:TS\/\/SCI|TS\/SCI|top secret|security clearance)[^.!?]{0,50}(?:required|mandatory)/i,
  );
  const clearanceFact = facts?.fields?.securityClearance;
  const held = clearanceFact?.uses?.includes('application') ? clearanceFact.value : null;
  const requiredLevel =
    clearance && /TS\/\/?SCI|top secret/i.test(clearance[0]) ? 'top secret' : 'security clearance';
  const heldMatches =
    held &&
    !/^none$/i.test(held) &&
    (requiredLevel !== 'top secret' || /top secret|TS\/\/?SCI/i.test(held)) &&
    (!/SCI/i.test(clearance?.[0] ?? '') || /SCI/i.test(held));
  if (clearance && !heldMatches)
    add('eligibility', clearance, 'Required clearance eligibility is not established');
  const citizenshipPattern =
    /(?:must|require\w*|only)[^.!?]{0,45}(?:U\.?S\.?|United States) citizen(?:ship)?/i;
  const citizenshipClauses = eligibilityText.filter(
    (c) =>
      !/citizenship.{0,15}not required|citizen.{0,15}not required/i.test(c) &&
      citizenshipPattern.test(c),
  );
  const citizenship = citizenshipClauses[0]?.match(citizenshipPattern);
  const authorization = facts?.fields?.workAuthorization;
  const approvedResidentAlternative =
    authorization?.uses?.includes('application') &&
    /permanent resident|green card/i.test(authorization.value ?? '') &&
    citizenshipClauses.length > 0 &&
    citizenshipClauses.every(
      (clause) =>
        /citizen\s*(?:,|or)\s*(?:a |an )?(?:lawful )?(?:permanent resident|green card holder)/i.test(
          clause,
        ) && !/(?:not|except|excluding)\s+(?:lawful )?permanent resident/i.test(clause),
    );
  if (
    citizenship &&
    !approvedResidentAlternative &&
    !(
      facts?.fields?.citizenship?.uses?.includes('application') &&
      /^(?:US|USA|United States)(?: citizen)?$/i.test(facts.fields.citizenship.value)
    )
  )
    add('eligibility', citizenship, 'Required U.S. citizenship is not established');
  const skills = [
    ...(config.skills ?? []),
    ...(config.skillMismatchFilter?.applicantLanguages ?? []),
  ].join(' ');
  // Preserve qualification boundaries; punctuation inside Vue.js must not split a requirement.
  let optionalSection = false;
  const clauses = body.split(/(?<!\b[A-Za-z]\.)(?<=[.!?])\s+|[;\n]/).map((text) => {
    if (/^\s*(?:nice.to.have|preferred (?:skills|qualifications|experience)|bonus)\b/i.test(text))
      optionalSection = true;
    else if (
      /^\s*(?:requirements|required (?:skills|qualifications|experience)|qualifications|responsibilities|benefits|compensation)\b/i.test(
        text,
      )
    )
      optionalSection = false;
    return { text, optional: optionalSection };
  });
  for (const [name, pattern] of specialties) {
    if (pattern.test(skills)) continue;
    const token = pattern.source;
    const softened = (c, mention) => {
      if (!mention) return false;
      const before = c.slice(0, mention.index);
      const after = c.slice(mention.index + mention[0].length);
      return (
        /(?:nice.to.have|preferred|bonus)\s*[:,-]?\s*$/i.test(before) ||
        (/(?:no|not require)\s*$/i.test(before) &&
          /^.{0,25}(?:experience|knowledge).{0,12}(?:required|needed)/i.test(after)) ||
        /^\s*(?:experience |expertise |knowledge )?(?:is )?(?:preferred|a plus|not required|optional)/i.test(
          after,
        ) ||
        /^\s+or\s+(?:React|JavaScript|TypeScript|Python)\b/i.test(after) ||
        /some or all/i.test(c)
      );
    };
    const clause = clauses.find(
      (c) =>
        (!c.optional || /\bmust\b|\brequired\b/i.test(c.text)) &&
        mandatory.test(c.text) &&
        [...c.text.matchAll(new RegExp(token, 'gi'))].some((mention) => !softened(c.text, mention)),
    );
    if (clause)
      add('mandatory_skill', [clause.text], `Required ${name} experience is not documented`);
  }
  const duties = dutiesText.match(softwareDuty);
  if (duties) evidence.push({ kind: 'software_duties', excerpt: duties[0] });
  if (!softwareTitle.test(title) && !duties)
    gaps.push('Software-building duties need verification');
  if (!body) gaps.push('Posting description is missing');
  const decision = evidence.some((e) => ['role_family', 'duties'].includes(e.kind))
    ? 'rejected'
    : gaps.length
      ? 'review'
      : 'eligible';
  return {
    version: 1,
    decision,
    ok: gaps.length === 0,
    reason: gaps.join('; ') || null,
    evidence,
    gaps,
    postingDigest: digest({ title, description: body }),
  };
}

export function rankRole(role, config) {
  const text = `${role.title ?? ''} ${role.description ?? ''}`.toLowerCase();
  const stack = ['react', 'typescript', 'python', 'django', 'java', 'spring', 'postgresql', 'node'];
  const matchedSkills = stack.filter((s) => new RegExp(`\\b${s}\\b`, 'i').test(text));
  const titleMatch = softwareTitle.test(role.title ?? '');
  return {
    score: matchedSkills.length * 3 + (titleMatch ? 10 : 0),
    reasons: { titleMatch, matchedSkills },
    kind: 'heuristic_not_probability',
  };
}

export function checkActualLocation(role, city) {
  const body = String(role.description ?? '');
  const match = body.match(/work location\s*[-—:]\s*([^.!?]{1,220})/i);
  if (!match || !/onsite|on-site|in.office/i.test(match[1])) return { ok: true, reason: null };
  const actual = match[1].toLowerCase();
  const accepted = (city.acceptedLocationAliases ?? []).some((a) =>
    actual.includes(a.toLowerCase()),
  );
  const negated = /\b(?:not|except|excluding)\b/i.test(actual);
  return {
    ok: Boolean(accepted && !negated),
    reason:
      accepted && !negated ? null : 'Actual onsite work location conflicts with approved city',
    evidence: match[0],
  };
}
