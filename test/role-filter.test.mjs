/**
 * Regression tests for the deterministic role filter.
 *
 * The 2026-08-15 pool defect is encoded directly: the three titles that leaked
 * into that pool each get a named test, so the same class of failure cannot
 * return silently.
 *
 * Run: node --test "openclaw-campaign/test/role-filter.test.mjs"
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  checkTitle, checkExperience, extractRequiredYears, checkCompensation,
  checkCompanyProfile, checkLocation, checkSource, checkEligibility,
  checkRoleRelevance, checkSkillMatch, buildBlockerIndex, checkKnownBlocker, campaignToday,
  evaluateRole, buildPool,
  canonicalizeUrl, normalizeCompany, poolHash,
} from '../lib/role-filter.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, '..', 'campaign.config.json'), 'utf8'));
const newark = config.cities.find((c) => c.id === 'newark');
const chicago = config.cities.find((c) => c.id === 'chicago');

/** A role that passes every gate, used as the base for single-factor tests. */
function goodRole(overrides = {}) {
  return {
    cityId: 'newark',
    company: 'Renterra Systems',
    title: 'Software Engineer II, Full Stack',
    location: 'Newark, NJ',
    url: 'https://jobs.ashbyhq.com/example-co/abc-123',
    source: 'Official Ashby ATS',
    description: 'We are looking for an engineer with 2+ years of experience in React and Node.js.',
    salaryMin: 110000,
    salaryMax: 145000,
    postedDate: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    fitScore: 40,
    companyProfile: {
      headcount: 120,
      isHouseholdName: false,
      thrivingSignals: [
        { type: 'recent_funding_round', detail: 'Series B, $28M, 2026-04', asOf: new Date().toISOString().slice(0,10), sourceUrl: 'https://example.com/funding' },
      ],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Title gate: every banned token must be rejected.
// ---------------------------------------------------------------------------

test('every banned title token is rejected', () => {
  const samples = {
    senior: 'Senior Software Engineer',
    sr: 'Sr. Software Engineer II',
    snr: 'Snr Backend Engineer',
    staff: 'Staff Software Engineer',
    principal: 'IT Engineer Principal II - Data & Analytics',
    lead: 'Lead, Software Engineer - Full Stack',
    manager: 'Engineering Manager',
    director: 'Director of Engineering',
    vp: 'VP, Platform Engineering',
    'vice president': 'Vice President of Software',
    chief: 'Chief Technology Officer',
    architect: 'Solutions Architect',
    'head of': 'Head of Backend',
    distinguished: 'Distinguished Engineer',
    fellow: 'Engineering Fellow',
  };
  for (const [token, title] of Object.entries(samples)) {
    const result = checkTitle(title, config);
    assert.equal(result.ok, false, `"${title}" should be rejected for "${token}"`);
    assert.ok(result.bannedTokensFound.includes(token), `"${title}" should report token "${token}", got ${JSON.stringify(result.bannedTokensFound)}`);
  }
});

test('2026-08-15 pool defect: the three leaked titles are now rejected', () => {
  for (const title of [
    'Lead, Software Engineer - Full Stack',      // Prudential
    'Senior Data Engineer',                       // Prudential
    'IT Engineer Principal II - Data & Analytics' // PSEG
  ]) {
    assert.equal(checkTitle(title, config).ok, false, `${title} must be hard-rejected`);
  }
});

test('acceptable titles pass the title gate', () => {
  for (const title of [
    'Software Engineer',
    'Software Engineer I',
    'Software Engineer II',
    'Associate Software Engineer - Automation Tester',
    'Full Stack Engineer',
    'Frontend Engineer',
    'Forward Deployed Software Engineer',
    'QA Automation Engineer',
    'Junior Backend Developer',
  ]) {
    assert.equal(checkTitle(title, config).ok, true, `${title} should pass`);
  }
});

test('banned tokens do not false-positive inside larger words', () => {
  // "lead" must not fire on "leadership", "staff" must not fire on "staffing",
  // "sr" must not fire on "SRE", "vp" must not fire on "VPN".
  for (const title of [
    'Software Engineer, Leadership Tools',
    'Software Engineer, Staffing Platform',
    'SRE Software Engineer',
    'Software Engineer, VPN Infrastructure',
    'Software Engineer, Directory Services',
  ]) {
    const r = checkTitle(title, config);
    assert.equal(r.ok, true, `${title} should pass but reported ${JSON.stringify(r.bannedTokensFound)}`);
  }
});

test('empty title is rejected', () => {
  assert.equal(checkTitle('', config).ok, false);
  assert.equal(checkTitle(null, config).ok, false);
});

// ---------------------------------------------------------------------------
// Experience gate: the ">5 years" family.
// ---------------------------------------------------------------------------

test('descriptions requiring more than five years are rejected', () => {
  const rejects = [
    '6+ years of professional software engineering experience',
    '7+ years of experience building distributed systems',
    '10+ years of experience required',
    'Minimum of 7 years of experience',
    'minimum 8 years of software development experience',
    'At least 6 years of hands-on experience',
    'at least seven years of experience',
    'requires 9 years of relevant experience',
    'must have 12 years of experience',
    'You have 8 or more years of experience',
    'No less than 6 years of experience',
    'We expect 15 years of industry experience',
  ];
  for (const description of rejects) {
    const r = checkExperience(description, config);
    assert.equal(r.ok, false, `"${description}" should be rejected (parsed lowest=${r.lowestMinimum})`);
  }
});

test('descriptions within the 0-5 year band pass', () => {
  const accepts = [
    '0-2 years of experience',
    '1+ years of experience',
    '2+ years of experience with React',
    '3+ years of experience in backend development',
    '5+ years of experience',
    '3-5 years of experience',
    '2 to 4 years of experience',
    'Entry level; no prior professional experience required',
    'New graduates welcome',
  ];
  for (const description of accepts) {
    const r = checkExperience(description, config);
    assert.equal(r.ok, true, `"${description}" should pass (parsed lowest=${r.lowestMinimum})`);
  }
});

test('a range takes its lower bound, so 5-8 years passes but 6-10 does not', () => {
  assert.equal(checkExperience('5-8 years of experience', config).ok, true);
  assert.equal(checkExperience('6-10 years of experience', config).ok, false);
});

test('the lowest stated minimum wins when a posting lists several', () => {
  const r = extractRequiredYears('2+ years of experience required, 8+ years preferred');
  assert.equal(r.lowestMinimum, 2);
  assert.equal(checkExperience('2+ years of experience required, 8+ years preferred', config).ok, true);
});

test('a description with no stated years passes but records an uncertainty', () => {
  const r = checkExperience('You will build web applications with our team.', config);
  assert.equal(r.ok, true);
  assert.ok(r.uncertainty, 'should record an uncertainty');
});

// ---------------------------------------------------------------------------
// Compensation gate.
// ---------------------------------------------------------------------------

test('posted maximum below the $90k floor is rejected', () => {
  const r = checkCompensation({ salaryMin: 60000, salaryMax: 85000 }, config);
  assert.equal(r.ok, false);
});

test('posted maximum at or above the floor passes even when the minimum is below it', () => {
  const r = checkCompensation({ salaryMin: 83800, salaryMax: 115200 }, config);
  assert.equal(r.ok, true);
  assert.ok(r.uncertainty, 'below-floor minimum should be recorded as an uncertainty');
});

test('missing salary is an uncertainty that caps the role at backup, never a rejection', () => {
  const r = checkCompensation({ salaryMin: null, salaryMax: null }, config);
  assert.equal(r.ok, true);
  assert.equal(r.capBucket, 'backup');
  assert.ok(r.uncertainty);
});

// ---------------------------------------------------------------------------
// Role relevance: the posting must actually be a software engineering job.
// ---------------------------------------------------------------------------

test('2026-08-16 regression: the University Hospital applications analyst is rejected', () => {
  // This role reached a Newark PRIMARY slot after the headcount ceiling was raised.
  const r = checkRoleRelevance({ title: 'Hospital Applications Analyst- Anatomic Pathology' }, config);
  assert.equal(r.ok, false);
  assert.match(r.reason, /no software-engineering token/);
});

test('non-engineering titles are rejected', () => {
  for (const title of [
    'Hospital Applications Analyst- Anatomic Pathology',
    'IT Support Specialist',
    'Systems Administrator',
    'Business Analyst',
    'Technical Project Coordinator',
    'Network Technician',
    'Implementation Consultant',
  ]) {
    assert.equal(checkRoleRelevance({ title }, config).ok, false, `"${title}" should be rejected`);
  }
});

test('every targeted engineering title passes role relevance', () => {
  for (const title of [
    'Software Engineer',
    'Software Engineer I',
    'Software Engineer II',
    'Associate Software Engineer - Automation Tester',
    'Full Stack Software Engineer',
    'Full-Stack Engineer',
    'Frontend Engineer',
    'Backend Engineer',
    'Applied AI Engineer, Kernel Performance',
    'Forward Deployed Software Engineer',
    'QA Automation Engineer',
    'Junior Backend Developer',
    'Web Developer',
    'SDET',
  ]) {
    assert.equal(checkRoleRelevance({ title }, config).ok, true, `"${title}" should pass`);
  }
});

test('an irrelevant role cannot reach any bucket', () => {
  const role = goodRole({ title: 'Hospital Applications Analyst- Anatomic Pathology', url: 'https://careers.example.com/jobs/1' });
  const pool = buildPool([role], config);
  assert.equal(pool.byCity.newark.primary.length, 0);
  assert.equal(pool.byCity.newark.backup.length, 0);
  assert.ok(pool.rejected[0].failures.some((f) => f.check === 'roleRelevance'));
});

// ---------------------------------------------------------------------------
// Freshness: an undated posting must not slip past the age rule.
// ---------------------------------------------------------------------------

test('a posting with no date is capped at backup rather than skipping the age check', () => {
  const r = checkSource({ url: 'https://jobs.ashbyhq.com/acme/1', postedDate: null }, config);
  assert.equal(r.ok, true);
  assert.equal(r.capBucket, 'backup');
  assert.match(r.uncertainty, /freshness is unverified/);
});

test('an unparseable date is treated as missing, not as year zero', () => {
  const r = checkSource({ url: 'https://jobs.ashbyhq.com/acme/1', postedDate: 'sometime last month' }, config);
  assert.equal(r.ok, true, 'must not be rejected as impossibly old');
  assert.equal(r.capBucket, 'backup');
});

test('an undated role lands in backup even when its company is primary-eligible', () => {
  const pool = buildPool([goodRole({ postedDate: null })], config);
  assert.equal(pool.byCity.newark.primary.length, 0);
  assert.equal(pool.byCity.newark.backup.length, 1);
});

test('a same-day active confirmation rescues an undated posting', () => {
  // Rippling and many Lever boards never publish a posting date, so demoting them
  // would penalize the ATS rather than the role.
  const today = campaignToday(config);
  const r = checkSource({ url: 'https://ats.rippling.com/acme/jobs/1', postedDate: null, verifiedActiveOn: today }, config);
  assert.equal(r.ok, true);
  assert.equal(r.capBucket, null, 'a confirmed-open posting must not be capped');
  assert.match(r.ageNote, /confirmed active on/);

  const pool = buildPool([goodRole({ postedDate: null, verifiedActiveOn: today })], config);
  assert.equal(pool.byCity.newark.primary.length, 1, 'and it should reach primary');
});

test('a stale active confirmation does not rescue an undated posting', () => {
  const r = checkSource({ url: 'https://ats.rippling.com/acme/1', postedDate: null, verifiedActiveOn: '2026-01-01' }, config);
  assert.equal(r.capBucket, 'backup');
  assert.match(r.uncertainty, /is not today/);
});

test('a same-day confirmation cannot rescue a posting that is provably too old', () => {
  const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const r = checkSource({ url: 'https://jobs.ashbyhq.com/acme/1', postedDate: old, verifiedActiveOn: campaignToday(config) }, config);
  assert.equal(r.ok, false, 'an explicit 60-day-old date still fails the hard maximum');
});

// ---------------------------------------------------------------------------
// Core-skill gate: the required language must be one the applicant has.
// ---------------------------------------------------------------------------

test('2026-08-24 regression: the Stevens C++ roles are rejected', () => {
  // Three Stevens Capital Management roles reached the Newark-corridor pool.
  // Each hard-requires professional-level C++ in Linux; the applicant has none.
  const real = [
    'minimum of three years professional-level C++ programming experience in a Linux environment; shell scripts and Java, Python, or Perl are a plus',
    'Requirements include high proficiency in C++ development in a Linux environment',
    'Requirements include professional-level C++ programming experience in a Linux environment; Perl, Bash/CSH are pluses',
  ];
  for (const description of real) {
    const r = checkSkillMatch({ description }, config);
    assert.equal(r.ok, false, `should reject: ${description.slice(0, 60)}`);
    assert.match(r.reason, /not in the applicant's stack/);
  }
});

test('a softener in a DIFFERENT clause does not cancel the requirement', () => {
  // "Perl, Bash/CSH are pluses" sits after a semicolon. A fixed character window
  // let that "pluses" cancel the C++ requirement in the preceding clause.
  const r = checkSkillMatch({
    description: 'Requirements include professional-level C++ programming experience in a Linux environment; Perl, Bash/CSH are pluses',
  }, config);
  assert.equal(r.ok, false, 'the C++ clause has no softener of its own');
});

test('a foreign language offered as a plus or preference never disqualifies', () => {
  for (const description of [
    'Strong experience with React, TypeScript and Node.js. Go is a plus.',
    'Experience in Java and Spring Boot required. Kotlin preferred.',
    'We use Python and Django. Familiarity with Rust is helpful.',
    'Backend work in Java. Scala exposure is a bonus.',
  ]) {
    assert.equal(checkSkillMatch({ description }, config).ok, true, `should pass: ${description}`);
  }
});

test('a hard requirement in any non-stack language is rejected', () => {
  assert.equal(checkSkillMatch({ description: 'Must have strong experience with C# and .NET development.' }, config).ok, false);
  assert.equal(checkSkillMatch({ description: 'Requires proficiency in Rust for systems work.' }, config).ok, false);
});

test('language names embedded in ordinary prose do not reject a role', () => {
  for (const description of [
    'Strong experience building AI evaluation systems in Python.',
    'Required: scalable backend services in Java and TypeScript.',
    'Experience with trusted production APIs and authentication.',
  ]) {
    assert.equal(checkSkillMatch({ description }, config).ok, true, description);
  }
});

test('whole-token matching still rejects an actual language after ordinary prose', () => {
  for (const description of [
    'Experience building evaluation systems; proficiency in Lua is required.',
    'Strong scalable services background; strong experience in Scala required.',
    'Must have strong C++ experience.',
    'Proficiency in C# required.',
    'Strong experience with ASP.NET required.',
    'Strong experience with .NET required.',
    'Strong experience with VB.NET required.',
  ]) {
    assert.equal(checkSkillMatch({ description }, config).ok, false, description);
  }
});

test('in-stack roles pass the skill gate untouched', () => {
  for (const description of [
    'Build full-stack apps with React, TypeScript, Python and AWS. 3+ years experience.',
    'Strong experience in Java and Spring Boot required.',
    'You will work in Python and Django on REST APIs.',
  ]) {
    assert.equal(checkSkillMatch({ description }, config).ok, true, `should pass: ${description}`);
  }
});

test('a skill-mismatched role cannot reach any bucket', () => {
  const role = goodRole({
    company: 'Stevens Capital Management LP',
    title: 'Execution Developer',
    description: 'Requirements include professional-level C++ programming experience in a Linux environment.',
  });
  const pool = buildPool([role], config);
  assert.equal(pool.byCity.newark.primary.length, 0);
  assert.equal(pool.byCity.newark.backup.length, 0);
  assert.ok(pool.rejected[0].failures.some((f) => f.check === 'skillMatch'));
});

// ---------------------------------------------------------------------------
// Eligibility gate: roles the applicant cannot truthfully hold.
// ---------------------------------------------------------------------------

test('2026-08-16 regression: the Maven Securities graduate programme is rejected', () => {
  // This role reached a PRIMARY slot in the first real tri-city research run.
  const role = {
    title: 'Graduate Developer Programme Chicago 2027',
    description: "Build technology for an automated trading environment. The posting is a graduate programme and lists final-year undergraduate or master's student as a candidate criterion.",
  };
  const r = checkEligibility(role, config);
  assert.equal(r.ok, false);
  assert.match(r.reason, /current student status/);
});

test('2026-08-24 regression: a required higher degree is rejected', () => {
  // Neural Concept reached a Newark-corridor primary slot. Its posting requires a
  // master's in Engineering, Applied Mathematics, or Physics. The applicant holds
  // a completed Bachelor of Science, so the slot was spent on an impossible role.
  const r = checkEligibility({
    title: 'Forward Deployed Engineer - US',
    description: "Requires a master's degree in Engineering, Applied Mathematics, or Physics.",
  }, config);
  assert.equal(r.ok, false);
  assert.match(r.reason, /above the applicant's completed Bachelor of Science/);
});

test('hard higher-degree requirements are rejected', () => {
  for (const description of [
    "Master's degree required.",
    'PhD required for this role.',
    'Ph.D. required.',
    'Advanced degree required.',
    'Graduate degree required.',
    'Doctorate required.',
  ]) {
    assert.equal(checkEligibility({ title: 'Software Engineer', description }, config).ok, false, `"${description}" should be rejected`);
  }
});

test('a merely preferred or alternative advanced degree does NOT disqualify', () => {
  // These offer the degree as an option, not a demand. Rejecting them would throw
  // away a large share of perfectly eligible postings.
  for (const description of [
    "Bachelor's or Master's degree in Computer Science.",
    "Master's degree a plus.",
    "Master's degree preferred, or equivalent experience.",
    "BS required; MS nice to have.",
    'BS in Computer Science or equivalent experience.',
    'We want a strong engineer with 3+ years of experience.',
  ]) {
    assert.equal(checkEligibility({ title: 'Software Engineer', description }, config).ok, true, `"${description}" should pass`);
  }
});

test('a higher-degree role cannot reach any bucket', () => {
  const role = goodRole({
    company: 'Neural Concept',
    title: 'Forward Deployed Engineer',
    description: "Requires a master's degree in Engineering or Applied Mathematics.",
  });
  const pool = buildPool([role], config);
  assert.equal(pool.byCity.newark.primary.length, 0);
  assert.equal(pool.byCity.newark.backup.length, 0);
  assert.ok(pool.rejected[0].failures.some((f) => f.check === 'eligibility'));
});

test('postings requiring current enrollment are rejected', () => {
  for (const description of [
    'You must be currently enrolled in a degree program.',
    'Open to rising seniors only.',
    'Candidates should have an expected graduation of June 2027.',
    "We are hiring master's student candidates.",
    'This role is for the class of 2027.',
    'Applicants must be pursuing a bachelor of science.',
  ]) {
    assert.equal(checkEligibility({ title: 'Software Engineer', description }, config).ok, false, `"${description}" should be rejected`);
  }
});

test('internships and co-ops are rejected', () => {
  assert.equal(checkEligibility({ title: 'Software Engineering Internship', description: 'x' }, config).ok, false);
  assert.equal(checkEligibility({ title: 'Software Engineer', description: 'This is a summer intern role.' }, config).ok, false);
});

test('merely welcoming new graduates does not trigger the eligibility gate', () => {
  for (const description of [
    'New graduates welcome to apply.',
    'Entry level role; recent graduates encouraged.',
    'Great for early-career engineers.',
    'A bachelor of science degree or equivalent experience is required.',
  ]) {
    assert.equal(checkEligibility({ title: 'Software Engineer', description }, config).ok, true, `"${description}" should pass`);
  }
});

test('an ineligible student-only role cannot reach any bucket', () => {
  const role = goodRole({
    cityId: 'chicago',
    location: 'Chicago, IL',
    title: 'Graduate Developer Programme Chicago 2027',
    url: 'https://boards.greenhouse.io/x/jobs/1',
    description: "Final-year undergraduate or master's student required.",
  });
  const pool = buildPool([role], config);
  assert.equal(pool.byCity.chicago.primary.length, 0);
  assert.equal(pool.byCity.chicago.backup.length, 0);
  assert.ok(pool.rejected[0].failures.some((f) => f.check === 'eligibility'));
});

// ---------------------------------------------------------------------------
// Company-profile gate: the 2026-08-16 small/unknown/thriving directive.
// ---------------------------------------------------------------------------

test('a small, unknown, thriving company is primary-eligible', () => {
  const r = checkCompanyProfile(goodRole(), config);
  assert.equal(r.ok, true);
  assert.equal(r.primaryEligible, true);
  assert.equal(r.band, 'small');
});

test('an enterprise employer can never be primary', () => {
  const r = checkCompanyProfile(goodRole({
    company: 'Globex Manufacturing',
    companyProfile: { headcount: 42000, isHouseholdName: false, thrivingSignals: [{ type: 'headcount_growth', detail: 'grew 12% in 2026', asOf: new Date().toISOString().slice(0,10), sourceUrl: 'https://example.com' }] },
  }), config);
  assert.equal(r.primaryEligible, false);
  assert.ok(r.primaryFailures.some((f) => f.includes('not primary-eligible')));
});

test('a large employer needs an explicit overrideReason even for a backup slot', () => {
  const base = {
    company: 'Globex Manufacturing',
    companyProfile: { headcount: 42000, isHouseholdName: false, thrivingSignals: [{ type: 'headcount_growth', detail: 'grew 12%', asOf: new Date().toISOString().slice(0,10), sourceUrl: 'https://example.com' }] },
  };
  assert.equal(checkCompanyProfile(goodRole(base), config).ok, false, 'no overrideReason -> fails both buckets');
  assert.equal(checkCompanyProfile(goodRole({ ...base, overrideReason: 'Exact React/Spring Boot stack match at the posted level.' }), config).ok, true);
});

test('household-name deny list fires even when the researcher forgets the flag', () => {
  for (const company of ['Prudential Financial', 'Western Digital', 'NetApp', 'PSEG', 'Broadridge Financial Solutions', 'Maximus', 'NXP Semiconductors']) {
    const r = checkCompanyProfile(goodRole({ company, companyProfile: { headcount: 150, isHouseholdName: false, thrivingSignals: [{ type: 'headcount_growth', detail: 'x', asOf: new Date().toISOString().slice(0,10), sourceUrl: 'https://e.com' }] } }), config);
    assert.equal(r.isHouseholdName, true, `${company} should be detected as a household name`);
    assert.equal(r.primaryEligible, false, `${company} must not be primary-eligible`);
  }
});

test('2026-08-19 regression: concatenated brand spellings still hit the deny list', () => {
  // "JPMorganChase" normalizes without a space, so boundary matching alone missed
  // the "jpmorgan" entry and a household-name bank reached a Jersey City primary.
  for (const company of ['JPMorganChase', 'JPMorgan Chase & Co.', 'BankofAmerica', 'GoldmanSachs']) {
    const r = checkCompanyProfile(goodRole({
      company,
      companyProfile: { headcount: 500, isHouseholdName: false, thrivingSignals: [{ type: 'headcount_growth', detail: 'x', asOf: new Date().toISOString().slice(0,10), sourceUrl: 'https://e.com' }] },
    }), config, newark);
    assert.equal(r.isHouseholdName, true, `${company} must be detected`);
    assert.equal(r.primaryEligible, false, `${company} must not be primary-eligible`);
  }
});

test('the corridor banks and casinos are all denied', () => {
  for (const company of ['RBC', 'Royal Bank of Canada', 'Caesars Sportsbook & Casino', 'Amazon Web Services', 'Bank of America']) {
    const r = checkCompanyProfile(goodRole({
      company,
      companyProfile: { headcount: 900, isHouseholdName: false, thrivingSignals: [{ type: 'headcount_growth', detail: 'x', asOf: new Date().toISOString().slice(0,10), sourceUrl: 'https://e.com' }] },
    }), config, newark);
    assert.equal(r.primaryEligible, false, `${company} must not reach primary`);
  }
});

test('the compact deny pass has a minimum length so short entries cannot over-match', () => {
  // "ge" and "hp" are deny entries; they must not fire inside unrelated names.
  for (const company of ['Gemini Robotics', 'HPC Systems Group', 'Codaline', 'Boxwood Analytics', 'Ionic Labs']) {
    const r = checkCompanyProfile(goodRole({ company }), config, newark);
    assert.equal(r.isHouseholdName, false, `${company} should not be flagged, hit=${r.householdNameDenyListHit}`);
  }
});

test('deny-list matching does not fire on unrelated substrings', () => {
  // "ge" must not match "Gemini Robotics"; "co" stripping must not match "Coda".
  for (const company of ['Gemini Robotics', 'Coda Systems', 'Boxwood Analytics', 'Ionic Labs']) {
    const r = checkCompanyProfile(goodRole({ company }), config);
    assert.equal(r.isHouseholdName, false, `${company} should not be flagged, hit=${r.householdNameDenyListHit}`);
  }
});

// --- per-city headcount ceiling (user instruction 2026-08-16) ---

test('the Newark corridor raises its primary headcount ceiling to 30000', () => {
  const midsize = { headcount: 14000, isHouseholdName: false, thrivingSignals: [{ type: 'headcount_growth', detail: 'grew 8% in 2026', asOf: new Date().toISOString().slice(0,10), sourceUrl: 'https://e.com' }] };
  const role = goodRole({ company: 'Ironbound Regional Systems', companyProfile: midsize });

  const inNewark = checkCompanyProfile(role, config, newark);
  assert.equal(inNewark.primaryEligible, true, JSON.stringify(inNewark.primaryFailures));
  assert.ok(inNewark.notes.some((n) => n.includes('raises its ceiling')), 'the relaxation should be visible in the report');

  // 14,000 is inside Newark's 30,000 but outside the 5,000 the other two allow.
  const inChicago = checkCompanyProfile(role, config, chicago);
  assert.equal(inChicago.primaryEligible, false, 'Chicago caps at 5000, so 14000 must fail there');
});

// --- San Jose and Chicago ceilings (user instruction 2026-08-17) ---

test('San Jose and Chicago raise their primary headcount ceiling to 5000', () => {
  const sanJose = config.cities.find((c) => c.id === 'san-jose');
  const midsize = { headcount: 4200, isHouseholdName: false, thrivingSignals: [{ type: 'revenue_growth_public_statement', detail: 'up 30% in 2026', asOf: new Date().toISOString().slice(0,10), sourceUrl: 'https://e.com' }] };
  const role = goodRole({ company: 'Midsize Systems', companyProfile: midsize });

  for (const city of [sanJose, chicago]) {
    const r = checkCompanyProfile(role, config, city);
    assert.equal(r.primaryEligible, true, `${city.label}: ${JSON.stringify(r.primaryFailures)}`);
    assert.ok(r.notes.some((n) => n.includes('raises its ceiling')), `${city.label} should record the relaxation`);
  }
});

test('the 5000 ceiling is a hard bound for San Jose and Chicago', () => {
  const sanJose = config.cities.find((c) => c.id === 'san-jose');
  const tooBig = { headcount: 6000, isHouseholdName: false, thrivingSignals: [{ type: 'headcount_growth', detail: 'x', asOf: new Date().toISOString().slice(0,10), sourceUrl: 'https://e.com' }] };
  for (const city of [sanJose, chicago]) {
    const r = checkCompanyProfile(goodRole({ company: 'Just Over Co', companyProfile: tooBig }), config, city);
    assert.equal(r.primaryEligible, false, `${city.label} must reject 6000`);
    assert.ok(r.primaryFailures.some((f) => f.includes('exceeds the')), JSON.stringify(r.primaryFailures));
  }
});

test('the raised ceilings do not admit household names anywhere', () => {
  const sanJose = config.cities.find((c) => c.id === 'san-jose');
  // Well under 5000, but on the deny list.
  const r = checkCompanyProfile(goodRole({
    company: 'NetApp',
    companyProfile: { headcount: 3000, isHouseholdName: false, thrivingSignals: [{ type: 'headcount_growth', detail: 'x', asOf: new Date().toISOString().slice(0,10), sourceUrl: 'https://e.com' }] },
  }), config, sanJose);
  assert.equal(r.isHouseholdName, true, 'deny list still fires inside the raised ceiling');
  assert.equal(r.primaryEligible, false);
});

test('every city ceiling still requires a numeric headcount, never a bare band', () => {
  const sanJose = config.cities.find((c) => c.id === 'san-jose');
  for (const city of [newark, sanJose, chicago]) {
    const r = checkCompanyProfile(goodRole({
      companyProfile: { headcountBand: 'mid', isHouseholdName: false, thrivingSignals: [{ type: 'headcount_growth', detail: 'x', asOf: new Date().toISOString().slice(0,10), sourceUrl: 'https://e.com' }] },
    }), config, city);
    assert.equal(r.primaryEligible, false, `${city.label} must not accept a band label in place of a number`);
    assert.ok(r.primaryFailures.some((f) => f.includes('numeric headcount')), JSON.stringify(r.primaryFailures));
  }
});

test('the Newark ceiling is a hard bound, not an unlimited pass', () => {
  // 30,000 is the corridor ceiling; Prudential (~40k) and Maximus (~35k) sit above it.
  const tooBig = { headcount: 40000, isHouseholdName: false, thrivingSignals: [{ type: 'headcount_growth', detail: 'x', asOf: new Date().toISOString().slice(0,10), sourceUrl: 'https://e.com' }] };
  const r = checkCompanyProfile(goodRole({ company: 'Enormous Co', companyProfile: tooBig }), config, newark);
  assert.equal(r.primaryEligible, false);
  assert.ok(r.primaryFailures.some((f) => f.includes('exceeds the')), JSON.stringify(r.primaryFailures));

  // And 29,999 must still pass, so the bound is exactly where it is documented.
  const justUnder = { ...tooBig, headcount: 29000 };
  assert.equal(checkCompanyProfile(goodRole({ company: 'Big But Allowed Co', companyProfile: justUnder }), config, newark).primaryEligible, true);
});

test('the Newark ceiling raises size only - household names still cannot be primary', () => {
  const r = checkCompanyProfile(goodRole({
    company: 'Prudential',
    companyProfile: { headcount: 15000, isHouseholdName: false, thrivingSignals: [{ type: 'headcount_growth', detail: 'x', asOf: new Date().toISOString().slice(0,10), sourceUrl: 'https://e.com' }] },
  }), config, newark);
  assert.equal(r.isHouseholdName, true, 'deny list still fires');
  assert.equal(r.primaryEligible, false, 'a household name must not reach primary even inside the raised ceiling');
});

test('the Newark ceiling still requires a verified thriving signal', () => {
  const r = checkCompanyProfile(goodRole({
    company: 'Ironbound Regional Systems',
    companyProfile: { headcount: 14000, isHouseholdName: false, thrivingSignals: [] },
  }), config, newark);
  assert.equal(r.primaryEligible, false);
  assert.equal(r.ok, false);
});

test('a company inside the Newark ceiling needs no overrideReason for a backup slot', () => {
  const r = checkCompanyProfile(goodRole({
    company: 'Ironbound Regional Systems',
    companyProfile: { headcount: 14000, isHouseholdName: false, thrivingSignals: [{ type: 'headcount_growth', detail: 'x', asOf: new Date().toISOString().slice(0,10), sourceUrl: 'https://e.com' }] },
  }), config, newark);
  assert.equal(r.ok, true);
  assert.equal(r.backupFailures.length, 0);
});

test('a bare headcountBand cannot satisfy a numeric city ceiling', () => {
  const r = checkCompanyProfile(goodRole({
    company: 'Bandonly Co',
    companyProfile: { headcountBand: 'large', isHouseholdName: false, thrivingSignals: [{ type: 'headcount_growth', detail: 'x', asOf: new Date().toISOString().slice(0,10), sourceUrl: 'https://e.com' }] },
  }), config, newark);
  assert.equal(r.primaryEligible, false);
  assert.ok(r.primaryFailures.some((f) => f.includes('needs a numeric headcount')));
});

test('a company with zero verified thriving signals is rejected', () => {
  const r = checkCompanyProfile(goodRole({ companyProfile: { headcount: 120, isHouseholdName: false, thrivingSignals: [] } }), config);
  assert.equal(r.ok, false);
  assert.equal(r.primaryEligible, false);
});

test('thriving signals without a sourceUrl or detail do not count', () => {
  const r = checkCompanyProfile(goodRole({
    companyProfile: {
      headcount: 120, isHouseholdName: false,
      thrivingSignals: [
        { type: 'recent_funding_round', detail: 'Series A' },                       // no sourceUrl
        { type: 'vibes', detail: 'seems good', asOf: new Date().toISOString().slice(0,10), sourceUrl: 'https://example.com' },  // bad type
        { type: 'headcount_growth', asOf: new Date().toISOString().slice(0,10), sourceUrl: 'https://example.com' },             // no detail
      ],
    },
  }), config);
  assert.equal(r.validThrivingSignals, 0);
  assert.equal(r.ok, false);
});

test('missing headcount is a rejection, not a guess', () => {
  const r = checkCompanyProfile(goodRole({ companyProfile: { isHouseholdName: false, thrivingSignals: [] } }), config);
  assert.equal(r.ok, false);
  assert.match(r.reason, /headcount/);
});

// ---------------------------------------------------------------------------
// Known company-level blockers.
// ---------------------------------------------------------------------------

/** The real Muon Space ledger row that motivated this gate. */
const MUON_ROW = {
  timestamp: '2026-08-09T20:36:09-04:00',
  company: 'Muon Space',
  title: 'Software Engineer, Entry-Level',
  status: 'blocked',
  notes: 'Blocked before resume upload because the required Greenhouse form asks export-control status: A "U.S. Person" is a U.S. citizen, lawful permanent resident (Green Card holder)... Are you a U.S. Person as defined above?',
};

test('2026-08-16 regression: a different role at a structurally blocked company is rejected', () => {
  const index = buildBlockerIndex([MUON_ROW], config);
  assert.equal(index.size, 1);

  // Different title, so role-level dedupe would let this through.
  const r = checkKnownBlocker({ company: 'Muon Space', title: 'Software Engineer, Simulation Infrastructure' }, config, index);
  assert.equal(r.ok, false);
  assert.match(r.reason, /company-level question/);
});

test('company-level blocker matching survives legal-suffix differences', () => {
  const index = buildBlockerIndex([MUON_ROW], config);
  assert.equal(checkKnownBlocker({ company: 'Muon Space, Inc.' }, config, index).ok, false);
});

test('only structural blockers poison a company, not one-off role questions', () => {
  const roleSpecific = {
    company: 'Someco', title: 'Software Engineer', status: 'blocked',
    notes: 'Blocked because the form required a 500-word essay about a favorite product.',
    timestamp: '2026-08-01T00:00:00-04:00',
  };
  const index = buildBlockerIndex([roleSpecific], config);
  assert.equal(index.size, 0, 'a one-off essay prompt must not disqualify the whole company');
  assert.equal(checkKnownBlocker({ company: 'Someco' }, config, index).ok, true);
});

test('submitted and other non-blocked rows never enter the blocker index', () => {
  const index = buildBlockerIndex([
    { ...MUON_ROW, status: 'submitted' },
    { company: 'Other', title: 'x', status: 'discovered', notes: 'export-control mentioned in passing', timestamp: 't' },
  ], config);
  assert.equal(index.size, 0);
});

test('the several real structural blockers from the ledger are all detected', () => {
  const rows = [
    { company: 'WebMD', title: 'a', status: 'blocked', notes: 'Required full street address and ZIP code.', timestamp: 't' },
    { company: 'TENEX.AI', title: 'b', status: 'blocked', notes: 'Required background-check policy attestation.', timestamp: 't' },
    { company: 'Impiricus', title: 'c', status: 'blocked', notes: 'Form requires a known degree major or closely related field.', timestamp: 't' },
    { company: 'Muon Space', title: 'd', status: 'blocked', notes: 'export-control U.S. Person question', timestamp: 't' },
  ];
  const index = buildBlockerIndex(rows, config);
  assert.equal(index.size, 4, `expected all four, got ${[...index.keys()].join(', ')}`);
});

test('retryKnownBlocker deliberately waives the check', () => {
  const index = buildBlockerIndex([MUON_ROW], config);
  const r = checkKnownBlocker({ company: 'Muon Space', retryKnownBlocker: true }, config, index);
  assert.equal(r.ok, true);
  assert.match(r.note, /waived/);
});

test('a blocked company cannot reach any bucket through buildPool', () => {
  const index = buildBlockerIndex([MUON_ROW], config);
  const role = goodRole({ company: 'Muon Space', url: 'https://boards.greenhouse.io/muonspace/jobs/1' });
  const pool = buildPool([role], config, { knownUrls: new Set(), knownCompanyTitles: new Set(), blockerIndex: index });
  assert.equal(pool.byCity.newark.primary.length, 0);
  assert.equal(pool.byCity.newark.backup.length, 0);
  assert.ok(pool.rejected[0].failures.some((f) => f.check === 'knownBlocker'));
});

// ---------------------------------------------------------------------------
// Location, source, duplicate gates.
// ---------------------------------------------------------------------------

test('2026-08-17 regression: same-name cities in other states are rejected', () => {
  // A bare "Newark" alias matches by substring, so before excludedLocationPatterns
  // existed, Newark CA (Silicon Valley), Newark DE, and Newark OH all satisfied
  // the Newark, NJ quota.
  for (const location of ['Newark, CA', 'Newark, California', 'Newark, DE', 'Newark, Delaware', 'Newark, OH']) {
    const r = checkLocation({ location }, newark);
    assert.equal(r.ok, false, `${location} must not satisfy Newark, NJ`);
    assert.match(r.reason, /same-name city/);
  }
  const sanJose = config.cities.find((c) => c.id === 'san-jose');
  assert.equal(checkLocation({ location: 'San Jose, Costa Rica' }, sanJose).ok, false);
  assert.equal(checkLocation({ location: 'East Chicago, IN' }, chicago).ok, false);
});

test('real-world posted-location formats are accepted', () => {
  for (const location of ['Newark, NJ, USA', 'US-NJ-Newark', 'NJ - Newark', 'Newark, NJ 07102', 'East Newark, NJ']) {
    assert.equal(checkLocation({ location }, newark).ok, true, `${location} should be accepted`);
  }
  const sanJose = config.cities.find((c) => c.id === 'san-jose');
  assert.equal(checkLocation({ location: 'San Jose, California' }, sanJose).ok, true, 'the full state name must still work');
  assert.equal(checkLocation({ location: 'US-CA-San Jose' }, sanJose).ok, true);
  assert.equal(checkLocation({ location: 'Chicago, IL 60601' }, chicago).ok, true);
});

test('the Newark corridor accepts Jersey City, Harrison, and Hoboken', () => {
  // Widened 2026-08-17: Newark alone had 1 in-city posting within 15 miles.
  for (const location of ['Newark, NJ', 'East Newark, NJ', 'Jersey City, NJ', 'Jersey City, New Jersey', 'Harrison, NJ', 'Hoboken, NJ']) {
    assert.equal(checkLocation({ location }, newark).ok, true, `${location} is in the corridor`);
  }
});

test('the corridor still stops at New York and other non-corridor towns', () => {
  // A 15-mile sweep from Newark returns 158 Manhattan roles. If NYC satisfied this
  // quota the corridor would be meaningless.
  for (const location of ['New York, NY', 'Brooklyn, NY', 'Elizabeth, NJ', 'Secaucus, NJ', 'Austin, TX']) {
    assert.equal(checkLocation({ location }, newark).ok, false, `${location} must not satisfy the corridor quota`);
  }
});

test('city aliases match for the single-city campaigns', () => {
  assert.equal(checkLocation({ location: 'Newark, New Jersey (Hybrid)' }, newark).ok, true);
  assert.equal(checkLocation({ location: 'Chicago, IL hybrid' }, chicago).ok, true);
  assert.equal(checkLocation({ location: 'Evanston, IL' }, chicago).ok, false, 'Chicago commute widening stays off');
});

test('aggregator application pages are rejected', () => {
  for (const url of ['https://www.indeed.com/viewjob?jk=abc', 'https://www.linkedin.com/jobs/view/12345', 'https://www.ziprecruiter.com/c/x/Job/y']) {
    assert.equal(checkSource({ url, source: 'aggregator' }, config).ok, false, `${url} should be rejected`);
  }
  assert.equal(checkSource({ url: 'https://jobs.ashbyhq.com/acme/1', source: 'Ashby' }, config).ok, true);
});

test('2026-08-19 regression: third-party marketplaces are not valid destinations', () => {
  // Balcony reached a corridor primary slot on a wellfound.com URL. Wellfound
  // hosts the application itself, so it is not the employer's own ATS.
  for (const url of [
    'https://wellfound.com/jobs/4579548-design-technologist-frontend-engineer',
    'https://angel.co/company/acme/jobs/123',
    'https://builtin.com/job/engineer/456',
    'https://www.themuse.com/jobs/acme/engineer',
  ]) {
    assert.equal(checkSource({ url, source: 'marketplace' }, config).ok, false, `${url} should be rejected`);
  }
  // A real ATS is still fine.
  assert.equal(checkSource({ url: 'https://jobs.ashbyhq.com/acme/1' }, config).ok, true);
  assert.equal(checkSource({ url: 'https://careers-berkley.icims.com/jobs/14288/x/job' }, config).ok, true);
});

test('stale postings beyond the maximum age are rejected', () => {
  const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
  assert.equal(checkSource({ url: 'https://jobs.ashbyhq.com/acme/1', postedDate: old }, config).ok, false);
});

test('staffing intermediaries and contract-only listings are rejected', () => {
  assert.equal(checkSource({ url: 'https://jobs.ashbyhq.com/acme/1', isStaffingIntermediary: true }, config).ok, false);
  assert.equal(checkSource({ url: 'https://jobs.ashbyhq.com/acme/1', employmentType: 'Contract' }, config).ok, false);
});

test('URL canonicalization strips tracking, locale, and case differences', () => {
  const a = canonicalizeUrl('https://WWW.Example.com/en-GB/Careers/job/Engineer_JR1?utm_source=x&gh_src=y#top');
  const b = canonicalizeUrl('https://example.com/Careers/job/Engineer_JR1/');
  assert.equal(a, b, `${a} !== ${b}`);
});

test('2026-08-19 regression: a Greenhouse job id is never stripped as tracking', () => {
  // gh_jid identifies the posting. Stripping it collapsed every job on a board to
  // one canonical URL, which produces false duplicates and can point an
  // application at the wrong posting.
  const a = canonicalizeUrl('https://www.zoro.com/careers/jobs?gh_jid=4680031006');
  const b = canonicalizeUrl('https://www.zoro.com/careers/jobs?gh_jid=9999999999');
  assert.notEqual(a, b, 'two different jobs must not share a canonical URL');
  assert.match(a, /gh_jid=4680031006/);

  // gh_src really is tracking and must still go.
  assert.equal(
    canonicalizeUrl('https://boards.greenhouse.io/acme/jobs/1?gh_src=abc&utm_source=x'),
    'https://boards.greenhouse.io/acme/jobs/1',
  );
});

test('identifier params survive while tracking params are stripped', () => {
  for (const key of ['gh_jid', 'jid', 'job_id', 'jobId', 'requisition_id', 'posting_id']) {
    const u = canonicalizeUrl(`https://example.com/careers?${key}=42&utm_medium=email`);
    assert.match(u, new RegExp(`${key}=42`, 'i'), `${key} must be preserved`);
    assert.ok(!u.includes('utm_medium'), 'utm_ must still be stripped');
  }
});

test('query order does not change the canonical URL', () => {
  assert.equal(
    canonicalizeUrl('https://example.com/j?gh_jid=1&other=2'),
    canonicalizeUrl('https://example.com/j?other=2&gh_jid=1'),
  );
});

test('2026-08-19 regression: canonicalization preserves case-sensitive paths', () => {
  // Oracle Cloud 404s on a lowercased path. A canonical URL that does not
  // resolve is a destination an application run could be aimed at.
  const oracle = 'https://fa-ewmy-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/3876/';
  const c = canonicalizeUrl(oracle);
  assert.match(c, /hcmUI\/CandidateExperience/, 'path case must survive');
  assert.match(c, /CX_1/, 'path segment case must survive');

  // Host and scheme are still normalized.
  assert.equal(
    canonicalizeUrl('HTTPS://WWW.Example.COM/MyPath'),
    'https://example.com/MyPath',
  );
});

test('normalizeCompany strips legal suffixes', () => {
  assert.equal(normalizeCompany('Renterra Technologies, Inc.'), normalizeCompany('Renterra'));
});

test('ledger duplicates are rejected by URL and by company+title', () => {
  const knownUrls = new Set([canonicalizeUrl('https://jobs.ashbyhq.com/example-co/abc-123')]);
  const byUrl = evaluateRole(goodRole(), newark, config, { knownUrls, knownCompanyTitles: new Set() });
  assert.equal(byUrl.verdict, 'rejected');
  assert.ok(byUrl.failures.some((f) => f.check === 'duplicate'));

  const knownCompanyTitles = new Set([`${normalizeCompany('Renterra Systems')}::software engineer ii, full stack`]);
  const byName = evaluateRole(goodRole({ url: 'https://jobs.ashbyhq.com/example-co/zzz-999' }), newark, config, { knownUrls: new Set(), knownCompanyTitles });
  assert.equal(byName.verdict, 'rejected');
});

// ---------------------------------------------------------------------------
// End-to-end pool assembly.
// ---------------------------------------------------------------------------

test('a clean role evaluates to primary with a positive score', () => {
  const r = evaluateRole(goodRole(), newark, config);
  assert.equal(r.verdict, 'primary', JSON.stringify(r.failures));
  assert.ok(r.score > 0);
});

test('buildPool honors the 3/2/5/2/1x6 quota and reports shortfalls', () => {
  const roles = [];
  // Newark over-supplied, San Jose short, Chicago exactly at its raised quota,
  // Atlanta and the five 2026-10-09 markets entirely unsupplied.
  for (const [cityId, n] of [['newark', 4], ['san-jose', 1], ['chicago', 5]]) {
    for (let i = 0; i < n; i++) {
      roles.push(goodRole({
        cityId,
        company: `Acme ${cityId} ${i}`,
        url: `https://jobs.ashbyhq.com/acme/${cityId}-${i}`,
        location: config.cities.find((c) => c.id === cityId).label,
        fitScore: 50 - i,
      }));
    }
  }
  const pool = buildPool(roles, config);
  assert.equal(pool.totalQuota, 18, 'campaign quota is 3 + 2 + 5 + 2 + 1x6');
  assert.ok(pool.quotaShortfalls.some(s => s.city === 'St. Louis, MO' && s.shortfall === 1));
  assert.equal(pool.byCity.newark.primary.length, 3, 'the corridor caps at 3 primaries');
  assert.equal(pool.byCity.newark.backup.length, 1, 'the 4th corridor role overflows into backup');
  assert.equal(pool.byCity['san-jose'].primary.length, 1);
  assert.ok(pool.quotaShortfalls.some((s) => s.city === 'San Jose, CA' && s.shortfall === 1), 'San Jose shortfall must be reported, not hidden');
  assert.equal(pool.byCity.chicago.primary.length, 5, 'Chicago now takes 5 primaries');
  assert.equal(pool.byCity.atlanta.primary.length, 0, 'Atlanta got no supply in this scenario');
  assert.ok(pool.quotaShortfalls.some((s) => s.city === 'Atlanta, GA' && s.shortfall === 2), 'Atlanta shortfall must be reported too');
});

test('buildPool never places a banned title anywhere in either bucket', () => {
  const roles = [
    goodRole({ title: 'Lead, Software Engineer - Full Stack', url: 'https://jobs.ashbyhq.com/acme/lead' }),
    goodRole({ title: 'Senior Data Engineer', url: 'https://jobs.ashbyhq.com/acme/senior' }),
    goodRole({ title: 'IT Engineer Principal II', url: 'https://jobs.ashbyhq.com/acme/principal' }),
    goodRole({ title: 'Software Engineer II', url: 'https://jobs.ashbyhq.com/acme/clean' }),
  ];
  const pool = buildPool(roles, config);
  const placed = [...pool.byCity.newark.primary, ...pool.byCity.newark.backup];
  assert.equal(placed.length, 1, 'only the clean title survives');
  assert.equal(placed[0].title, 'Software Engineer II');
  assert.equal(pool.rejected.length, 3);
});

test('large-company backups are ordered after eligible small-company backups', () => {
  const roles = [
    goodRole({ company: 'Globex Manufacturing', url: 'https://jobs.ashbyhq.com/acme/big', overrideReason: 'exact stack match', fitScore: 99,
      companyProfile: { headcount: 42000, isHouseholdName: false, thrivingSignals: [{ type: 'headcount_growth', detail: 'x', asOf: new Date().toISOString().slice(0,10), sourceUrl: 'https://e.com' }] } }),
    goodRole({ company: 'Tiny Co A', url: 'https://jobs.ashbyhq.com/acme/s1', fitScore: 10 }),
    goodRole({ company: 'Tiny Co B', url: 'https://jobs.ashbyhq.com/acme/s2', fitScore: 10 }),
    goodRole({ company: 'Tiny Co C', url: 'https://jobs.ashbyhq.com/acme/s3', fitScore: 10 }),
    goodRole({ company: 'Tiny Co D', url: 'https://jobs.ashbyhq.com/acme/s4', fitScore: 10 }),
  ];
  const pool = buildPool(roles, config);
  const backups = pool.byCity.newark.backup;
  assert.equal(backups.at(-1).company, 'Globex Manufacturing', 'the large employer must sort last despite the highest fit score');
});

test('poolHash is order-independent and changes when a destination changes', () => {
  const a = poolHash(['https://a.com/1', 'https://b.com/2']);
  const b = poolHash(['https://b.com/2', 'https://a.com/1']);
  const c = poolHash(['https://a.com/1', 'https://b.com/3']);
  assert.equal(a, b, 'hash must be stable under reordering');
  assert.notEqual(a, c, 'substituting a destination must change the hash');
});
