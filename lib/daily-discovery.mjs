import { readEvidenceSource, corroborateExcerpt } from './source-documents.mjs';
import { fetchBoard, cacheBoard } from './board-discovery.mjs';
import { applicationId } from './event-store.mjs';
import {
  checkTitle,
  checkRoleRelevance,
  checkExperience,
  checkSkillMatch,
  checkEligibility,
  checkSource,
  checkCompensation,
  checkLocation,
  normalizeCompany,
  campaignToday,
} from './role-filter.mjs';
import { evidenceIsCurrent } from './company-evidence.mjs';

const decode = (s) =>
  String(s ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
export function postedSalary(job) {
  const components =
    job.compensation?.summaryComponents ??
    job.compensation?.compensationTiers?.flatMap((t) => t.components) ??
    [];
  const salaries = components.filter(
    (c) =>
      c.currencyCode === 'USD' &&
      c.compensationType === 'Salary' &&
      c.interval === '1 YEAR' &&
      Number.isFinite(c.minValue) &&
      Number.isFinite(c.maxValue),
  );
  if (salaries.length)
    return {
      salaryMin: Math.min(...salaries.map((s) => s.minValue)),
      salaryMax: Math.max(...salaries.map((s) => s.maxValue)),
    };
  if (
    components.some((c) => c.compensationType === 'Salary') ||
    /\bCAD\b|Canadian dollars|\bEUR\b|\bGBP\b/.test(job.description ?? '')
  )
    return { salaryMin: null, salaryMax: null };
  const matches = [
    ...String(job.description ?? '').matchAll(
      /\$\s*([\d,]+(?:\.\d+)?)\s*([kK])?\s*(?:-|–|—|to)\s*\$?\s*([\d,]+(?:\.\d+)?)\s*([kK])?/g,
    ),
  ];
  const ranges = matches
    .map((m) => [
      Number(m[1].replaceAll(',', '')) * (m[2] ? 1000 : 1),
      Number(m[3].replaceAll(',', '')) * (m[4] ? 1000 : 1),
    ])
    .filter(([lo, hi]) => lo >= 30000 && hi >= lo && hi <= 1000000);
  return ranges.length
    ? {
        salaryMin: Math.min(...ranges.map((r) => r[0])),
        salaryMax: Math.max(...ranges.map((r) => r[1])),
      }
    : { salaryMin: null, salaryMax: null };
}
export function usRemote(job) {
  const meta = job.remoteMetadata ?? {},
    locations = job.locations.join(' '),
    body = job.description ?? '';
  if (
    /(?:not|isn't|is not) (?:a )?remote (?:role|position|opportunity)|100% onsite|fully on[- ]site/i.test(
      body,
    )
  )
    return false;
  if (
    /(?:exclud(?:es|ing)?|except|not available (?:in|to)|cannot hire (?:in|from)).{0,40}(?:New York|\bNY\b)/i.test(
      body,
    )
  )
    return false;
  const secondary = meta.secondaryLocations ?? [];
  const remoteUS = secondary.some(
    (s) =>
      /remote/i.test(s.location ?? '') &&
      s.address?.postalAddress?.addressCountry === 'United States',
  );
  if (remoteUS) return true;
  const remote =
    meta.workplaceType === 'Remote' || meta.isRemote === true || /\bremote\b/i.test(locations);
  const us =
    /United States|\bUSA\b|\bUS\b|\bU\.S\.|North America/i.test(locations) ||
    meta.address?.postalAddress?.addressCountry === 'United States';
  return remote && us && meta.workplaceType !== 'OnSite' && meta.workplaceType !== 'Hybrid';
}
export async function discoverDaily(
  store,
  config,
  registry,
  { fetcher = fetch, now = new Date(), onProgress = () => {} } = {},
) {
  const jobs = [],
    errors = [];
  let cursor = 0,
    checked = 0;
  const boards = registry.boards.filter(
    (b) => b.disabled !== true && ['ashby', 'greenhouse', 'lever'].includes(b.platform),
  );
  async function worker() {
    while (cursor < boards.length) {
      const board = boards[cursor++],
        metadata = new Map();
      try {
        const wrapped = async (url, opts) => {
          const r = await fetcher(url, opts);
          return {
            ok: r.ok,
            status: r.status,
            json: async () => {
              const d = await r.json();
              for (const j of d.jobs ?? []) {
                metadata.set(String(j.id), {
                  isRemote: j.isRemote,
                  workplaceType: j.workplaceType,
                  secondaryLocations: j.secondaryLocations,
                  address: j.address,
                });
                if (j.content) j.content = decode(j.content);
                if (j.descriptionPlain) j.descriptionPlain = decode(j.descriptionPlain);
              }
              return d;
            },
          };
        };
        const fresh = (await fetchBoard(board, wrapped)).map((j) => ({
          ...j,
          remoteMetadata: metadata.get(j.postingId.split(':').at(-1)) ?? j.remoteMetadata,
        }));
        cacheBoard(store, board, fresh, now.toISOString());
        jobs.push(...fresh);
      } catch (e) {
        errors.push({ board: board.platform + ':' + board.slug, reason: e.message });
      }
      checked++;
      onProgress({ checked, total: boards.length });
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  const seen = new Set(),
    pairs = new Set(
      store.db
        .prepare(
          "SELECT record_json FROM applications WHERE state IN ('submitted','uncertain','submit_started')",
        )
        .all()
        .map((a) => {
          const r = JSON.parse(a.record_json);
          return normalizeCompany(r.company) + '::' + String(r.title).toLowerCase().trim();
        }),
    ),
    candidates = [];
  for (const job of jobs) {
    if (
      seen.has(applicationId(job.url)) ||
      store.get(applicationId(job.url)) ||
      pairs.has(normalizeCompany(job.company) + '::' + job.title.toLowerCase().trim())
    )
      continue;
    const remote = usRemote(job),
      city =
        config.cities.find(
          (c) =>
            c.id !== 'us-remote' && job.locations.some((l) => checkLocation({ location: l }, c).ok),
        ) ?? (remote ? config.cities.find((c) => c.id === 'us-remote') : null);
    if (!city) continue;
    const role = {
      ...job,
      ...postedSalary(job),
      cityId: city.id,
      location:
        city.id === 'us-remote'
          ? 'Remote, United States'
          : job.locations.find((l) => checkLocation({ location: l }, city).ok),
      verifiedActiveOn: campaignToday(config, now),
      fitScore: /full.?stack|applied.?ai|ai engineer/i.test(job.title) ? 90 : 75,
    };
    const checks = [
      checkTitle(role.title, config),
      checkRoleRelevance(role, config),
      checkExperience(role.description, config),
      checkSkillMatch(role, config),
      checkEligibility(role, config),
      checkSource(role, config),
      checkCompensation(role, config),
    ];
    if (checks.some((c) => !c.ok)) continue;
    seen.add(applicationId(role.url));
    candidates.push(role);
  }
  return {
    candidates: candidates.sort((a, b) => b.fitScore - a.fitScore),
    errors,
    boards: boards.length,
  };
}

export function profileCurrent(item, now = new Date()) {
  return (
    item &&
    Date.parse(item.verifiedAt) <= now.getTime() &&
    now.getTime() - Date.parse(item.verifiedAt) < 30 * 86400000 &&
    item.profile?.thrivingSignals?.every((s) => evidenceIsCurrent(s, 24, now))
  );
}
export async function verifyResearchedProfile(
  item,
  { store, fetcher = fetch, now = new Date() } = {},
) {
  const p = item.profile;
  if (
    !item.company ||
    !Number.isFinite(p?.headcountMin) ||
    !Number.isFinite(p?.headcountMax) ||
    p.headcountMin < 1 ||
    p.headcountMax < p.headcountMin ||
    p.headcountMax > 30000 ||
    typeof p.isHouseholdName !== 'boolean' ||
    !p.thrivingSignals?.length
  )
    throw Error('Company profile lacks a sourced size interval or dated signal');
  const cache = new Map();
  const sourceDocuments = [];
  async function corroborate(url, excerpt) {
    if (!cache.has(url)) cache.set(url, await readEvidenceSource(url, { store, fetcher, now }));
    sourceDocuments.push(corroborateExcerpt(cache.get(url), decode(excerpt)));
  }
  await corroborate(p.headcountSourceUrl, p.headcountExcerpt);
  if (
    !/employees|headcount|team members|staff|team (?:of|size)|\d[- ]person/i.test(
      p.headcountExcerpt,
    )
  )
    throw Error('Headcount excerpt must describe employee or team size');
  const sizeText = p.headcountExcerpt.replaceAll(',', '');
  for (const n of [p.headcountMin, p.headcountMax])
    if (!new RegExp('\\b' + n + '\\b').test(sizeText))
      throw Error('Headcount interval does not occur in source excerpt');
  for (const s of p.thrivingSignals) {
    if (!evidenceIsCurrent(s, 24, now)) throw Error('Stale signal');
    await corroborate(s.sourceUrl, s.excerpt);
  }
  return { ...item, sourceDocuments, verifiedAt: now.toISOString() };
}
