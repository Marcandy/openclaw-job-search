import { readJson, fileDigest, digest } from './runtime.mjs';
import { campaignToday,normalizeCompany } from './role-filter.mjs';

export function verifyStandingPolicy(runtime, path) {
  const p = readJson(path);
  if (p.enabled !== true || p.dailyLimit !== 10 || !p.approvedBy || !p.instruction || !Number.isFinite(Date.parse(p.approvedAt))) throw Error('Standing authorization is absent or disabled');
  if (p.timezone !== runtime.config.timezone) throw Error('Standing authorization timezone differs from the campaign');
  if (p.configDigest !== runtime.configDigest || p.sourceDigest !== runtime.sourceDigest) throw Error('Standing authorization: code/config changed');
  if (fileDigest(runtime.config.paths.facts) !== p.factsHash) throw Error('Standing authorization: confirmed facts changed');
  if (fileDigest(runtime.config.paths.boards) !== p.boardsHash || fileDigest(p.seedProfilesPath) !== p.seedProfilesHash) throw Error('Standing authorization: discovery inputs changed');
  for (const [path, hash] of Object.entries(p.resumes ?? {})) if (fileDigest(path) !== hash) throw Error('Standing authorization: resume changed');
  if (!Object.keys(p.resumes ?? {}).length || !p.allowedCityIds?.length) throw Error('Standing scope is empty');
  return { ...p, hash:digest(p) };
}

// Count distinct destinations, including manual submissions and legacy history.
// An uncertain delivery consumes a slot; a confirmed pre-submit block does not.
export function dailyUsage(store, timezone, now = new Date()) {
  const day = campaignToday({ timezone }, now), ids = new Set();
  for (const e of store.db.prepare("SELECT app_id,kind,at,data_json FROM events WHERE kind IN ('submitted','legacy')").all()) {
    const data = JSON.parse(e.data_json);
    if (e.kind === 'legacy' && String(data.status).toLowerCase() !== 'submitted') continue;
    const at = new Date(e.kind === 'legacy' ? data.timestamp : data.receipt?.observedAt ?? e.at);
    if (Number.isFinite(at.getTime()) && campaignToday({timezone}, at) === day) ids.add(e.app_id);
  }
  const confirmed = ids.size;
  for (const a of store.db.prepare("SELECT id,updated_at FROM applications WHERE state IN ('submit_started','uncertain')").all()) {
    if (campaignToday({timezone}, new Date(a.updated_at)) === day) ids.add(a.id);
  }
  return { day, confirmed, occupied:ids.size, uncertain:ids.size-confirmed };
}

export function beginDailySubmit(store, id, runId, policy, now = new Date()) {
  return store.transaction(() => {
    const a = store.get(id);
    if (a?.run_id !== runId || a.state !== 'filling') throw Error('Daily submission requires this run\'s filled destination');
    store.heartbeat(runId);
    const usage = dailyUsage(store, policy.timezone, now);
    if (usage.occupied >= policy.dailyLimit) throw Error('Daily application limit reached');
    const at = now.toISOString();
    store.db.prepare("UPDATE applications SET state='submit_started',updated_at=? WHERE id=?").run(at,id);
    store.event(id,'submit_started',{ standingPolicyHash:policy.hash, day:usage.day },at);
    return usage;
  });
}

const clean = s => String(s ?? '').replace(/\*/g,'').replace(/\s+/g,' ').trim();
const consent = /consent|background check|arbitration|recording|agree to|terms and conditions|privacy policy|certify|attest|acknowledge/i;
export function mapRoutineQuestions(questions, destination, confirmed, policy, now = new Date()) {
  const facts = structuredClone(confirmed), answers = {}, blocked = [];
  const add = (q,value,source) => {
    const key = 'routine_'+digest([destination.url,q.key,value]).slice(0,24);
    facts.fields[key] = { value, source, confirmedAt:now.toISOString(), uses:['application'], employer:destination.company };
    answers[q.key] = key;
  };
  const fact = (q,key) => {
    const f = facts.fields[key];
    if (!f || f.value == null || !f.uses.includes('application')) return false;
    if (f.employer && normalizeCompany(f.employer)!==normalizeCompany(destination.company)) return false;
    let value = f.value;
    if (q.options?.filter(Boolean).length) {
      const match = q.options.find(o=>clean(o).toLowerCase()===clean(value).toLowerCase());
      if (!match) return false;
      value = match;
    }
    if (value === f.value) answers[q.key] = key;
    else add(q,value,'Exact offered option matching confirmed fact '+key);
    return true;
  };
  for (const q of questions) {
    if (q.type === 'file') continue;
    const label = clean(q.label), key = q.key;
    let mapped = false;
    // Optional demographic and consent fields stay empty. Required opt-out is a
    // choice, never an invented demographic characteristic.
    if (/gender|race|ethnic|hispanic|veteran|disab/i.test(label)) {
      if (q.required) {
        const option = q.options?.find(o=>/decline|prefer not|do not (?:wish|want)|don't (?:wish|want)/i.test(o));
        if (option) { add(q,option,'User-authorized routine application; demographic disclosure declined'); mapped=true; }
      } else continue;
    } else if (q.kind === 'consent' || consent.test(label)) {
      if (!q.required) continue;
    } else if (/\b(?:Canada|Canadian|United Kingdom|UK|Australia|Germany|European Union)\b/i.test(label) && /authoriz|sponsor|eligible to work|work permit/i.test(label) && !/^Are you (?:legally )?authorized to work in (?:the )?(?:United States|U\.?S\.?) or Canada\??$/i.test(label)) {
      // US authorization does not establish authorization in another country.
    } else if (/_systemfield_name$/.test(key) || /^(?:full |legal |preferred )?name$/i.test(label)) mapped=fact(q,'fullName');
    else if (/^first name$/i.test(label)) mapped=fact(q,'firstName');
    else if (/^last name$/i.test(label)) mapped=fact(q,'lastName');
    else if (q.type==='email' || /^email(?: address)?$/i.test(label)) mapped=fact(q,'email');
    else if (key==='country' && /country/i.test(label)) mapped=fact(q,'phoneCountry');
    else if (q.type==='tel' || /^phone(?: number)?$/i.test(label)) mapped=fact(q,'phone');
    else if (/linkedin/i.test(label)) mapped=fact(q,'linkedin');
    else if (/github/i.test(label)) mapped=fact(q,'github');
    else if (/^(?:personal )?(?:website|portfolio)(?:\s*\/\s*(?:website|portfolio))?(?: (?:url|link))?$/i.test(label) || q.type==='url'&&/^projects$/i.test(label)) mapped=fact(q,'portfolio');
    else if (key==='_systemfield_location' || key==='ashby_location_combobox' || /^(?:current )?location(?: \(city\))?$/i.test(label)) mapped=fact(q,'homeCity');
    else if (/country (?:of residence|where you live)|what country are you based in/i.test(label)) mapped=fact(q,'homeCountry');
    else if (/^state(?: of residence)?$/i.test(label)) mapped=fact(q,'homeState');
    else if (/^current (?:company|employer)/i.test(label)) mapped=fact(q,'currentCompany');
    else if (/highest (?:degree|level of education)/i.test(label)) mapped=fact(q,'highestDegree');
    else if (/^(?:school|university|college)(?: name)?$/i.test(label)) mapped=fact(q,'school');
    else if (/unrestricted work authorization.*United States/i.test(label) && /permanent resident|green card/i.test(facts.fields.workAuthorization?.value??'')) { add(q,'Yes','Confirmed Lawful Permanent Resident work authorization'); mapped=true; }
    else if (/(?:legally |currently )?authorized to work|legally eligible to work|legal right to work/i.test(label) && !/not authorized|outside|other countries/i.test(label)) mapped=fact(q,'authorizedToWorkText');
    else if (/work without.*sponsor/i.test(label) && facts.fields.needsSponsorship?.value===false) mapped=fact(q,'authorizedToWorkText');
    else if (/(?:require|need).*sponsor|(?:now|future).*sponsor/i.test(label) && !/not require|without/i.test(label)) mapped=fact(q,'needsSponsorshipText');
    else if (/(?:based|located|reside).*\b(?:U\.?S\.?|United States)\b/i.test(label) && facts.fields.homeCountry?.value==='United States') { add(q,'Yes','Confirmed United States home country and home city'); mapped=true; }
    else if (/currently leveled as Senior-level/i.test(label)) mapped=fact(q,'hexSeniorLevelText');
    else if (/how did you (?:hear|learn|find)|where did you (?:hear|learn|find)/i.test(label)) {
      const options=q.options?.filter(Boolean)??[];
      const option=options.find(o=>/^other$/i.test(o))??options.find(o=>/^(?:external job board|company website|company careers page|careers (?:page|website))$/i.test(o));
      if (option || !options.length && ['text','textarea'].includes(q.type)) { add(q,option??'OpenClaw search of the employer\'s official careers page','Actual discovery from official employer ATS board'); mapped=true; }
    } else if (/willing to relocate|open to relocat/i.test(label)) mapped=fact(q,'relocationText');
    else if (destination.cityId!=='us-remote'&&/(?:available|able|willing).*(?:onsite|in.person)/i.test(label)) mapped=fact(q,'onsiteText');
    else if (/salary|compensation expectation/i.test(label) && !/hourly|previous|current|history/i.test(label)) mapped=fact(q,q.type==='number'?'salary':'salaryText');
    else if (/why.*(?:join|interested|work|company|applying)|what excites you about|tell us about yourself|additional information|cover letter|what.*(?:skills|experience).*bring/i.test(label) && ['text','textarea'].includes(q.type) && policy.applicationIntro) {
      add(q,`I am interested in contributing to ${destination.company} as a ${destination.title}. ${policy.applicationIntro}`,'User-authorized application draft using the approved resume summary template'); mapped=true;
    }
    if (q.required && !mapped) blocked.push({key,label,reason:consent.test(label)||q.kind==='consent'?'unapproved_consent':'unknown_fact_or_control'});
  }
  return { answers, facts, blocked };
}
