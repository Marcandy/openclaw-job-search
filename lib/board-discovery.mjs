import { officialApplicationUrl } from './official-destination.mjs';
import { digest } from './runtime.mjs';
import { canonicalizeUrl, checkTitle, checkLocation, checkRoleRelevance } from './role-filter.mjs';
const text = (value) =>
  String(value ?? '')
    .replace(/<\/?(?:p|li|h[1-6]|div|br)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t\r]+/g, ' ')
    .trim();
export function boardEndpoint(board, offset = 0) {
  let slug;
  try {
    slug = decodeURIComponent(board.slug);
  } catch {}
  if (
    !['greenhouse', 'lever', 'ashby'].includes(board.platform) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_. -]{0,119}$/.test(slug ?? '') ||
    slug.includes('..') ||
    !board.company
  )
    throw new Error('Invalid employer board registry entry');
  slug = encodeURIComponent(slug);
  if (board.platform === 'greenhouse')
    return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  if (board.platform === 'lever')
    return `https://api.lever.co/v0/postings/${slug}?mode=json&limit=100&skip=${offset}`;
  return `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;
}
export function normalizePosting(board, job) {
  const url = job.absolute_url ?? job.hostedUrl ?? job.jobUrl;
  if (!job.id || !url) throw new Error('Posting missing ID or official URL');
  const locations =
    board.platform === 'greenhouse'
      ? [job.location?.name]
      : board.platform === 'lever'
        ? [job.categories?.location, ...(job.categories?.allLocations ?? [])]
        : [job.location, ...(job.secondaryLocations ?? []).map((x) => x.location)];
  return {
    postingId: `${board.platform}:${board.slug}:${job.id}`,
    company: board.company,
    title: job.title ?? job.text,
    locations: [...new Set(locations.filter(Boolean))],
    sourceUrl: canonicalizeUrl(url),
    url: canonicalizeUrl(officialApplicationUrl(board, job.id, url)),
    employerUrl: canonicalizeUrl(officialApplicationUrl(board, job.id, url)),
    source: board.platform,
    description: text(
      [
        job.content ?? job.descriptionPlain ?? job.descriptionHtml ?? job.description,
        ...(job.lists ?? []).map((section) => `${section.text} ${section.content}`),
        job.additionalPlain ?? job.additional,
        job.salaryDescriptionPlain,
      ]
        .filter(Boolean)
        .join(' '),
    ),
    // Greenhouse publishes first_published; updated_at changes on any edit and is not a posting date.
    postedDate: job.publishedAt ?? job.first_published ?? null,
    createdAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
    dateEvidence: job.publishedAt || job.first_published ? 'publication' : 'undated',
    employmentType: job.employmentType ?? job.categories?.commitment ?? null,
    compensation:
      job.compensation ??
      (job.salaryRange
        ? {
            summaryComponents: [
              {
                currencyCode: job.salaryRange.currency,
                compensationType: 'Salary',
                interval: /year|annual/i.test(job.salaryRange.interval)
                  ? '1 YEAR'
                  : job.salaryRange.interval,
                minValue: job.salaryRange.min,
                maxValue: job.salaryRange.max,
              },
            ],
          }
        : null),
    remoteMetadata:
      board.platform === 'lever'
        ? {
            workplaceType:
              job.workplaceType === 'remote'
                ? 'Remote'
                : job.workplaceType === 'hybrid'
                  ? 'Hybrid'
                  : 'OnSite',
          }
        : undefined,
  };
}
export async function fetchBoard(board, fetcher = fetch) {
  const jobs = [];
  for (let offset = 0; offset <= 9900; offset += 100) {
    const response = await fetcher(boardEndpoint(board, offset), {
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const error = new Error(`Board ${board.platform}/${board.slug} HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    const page = board.platform === 'lever' ? data : data.jobs;
    if (!Array.isArray(page))
      throw new Error('Unexpected board response; previous cache remains intact');
    jobs.push(...page.map((j) => normalizePosting(board, j)));
    if (board.platform !== 'lever' || page.length < 100) return jobs;
  }
  throw new Error('Board pagination exceeded bounded budget; cache is unchanged');
}
export function cacheBoard(store, board, jobs, at = new Date().toISOString()) {
  const key = `${board.platform}:${board.slug}`;
  store.db.exec(
    'CREATE TABLE IF NOT EXISTS postings(id TEXT PRIMARY KEY,board TEXT NOT NULL,hash TEXT NOT NULL,data_json TEXT NOT NULL,first_seen TEXT NOT NULL,last_seen TEXT NOT NULL,active INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS company_evidence(company TEXT PRIMARY KEY,data_json TEXT NOT NULL,checked_at TEXT NOT NULL)',
  );
  return store.transaction(() => {
    const changed = [];
    const prior = new Map(
      store.db
        .prepare('SELECT * FROM postings WHERE board=?')
        .all(key)
        .map((p) => [p.id, p]),
    );
    store.db.prepare('UPDATE postings SET active=0 WHERE board=?').run(key);
    for (const job of jobs) {
      const hash = digest(job);
      const old = prior.get(job.postingId);
      if (!old || !old.active || old.hash !== hash)
        changed.push({ ...job, change: old ? 'changed' : 'new' });
      store.db
        .prepare(
          'INSERT INTO postings VALUES (?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,data_json=excluded.data_json,last_seen=excluded.last_seen,active=1',
        )
        .run(job.postingId, key, hash, JSON.stringify(job), old?.first_seen ?? at, at);
    }
    return { changed, total: jobs.length };
  });
}
export function triagePostings(jobs, config, at = new Date()) {
  const cities = Object.fromEntries(config.cities.map((c) => [c.id, { leads: [] }]));
  for (const job of jobs) {
    if (!checkTitle(job.title, config).ok || !checkRoleRelevance(job, config).ok) continue;
    for (const city of config.cities) {
      const location = job.locations.find((l) => checkLocation({ location: l }, city).ok);
      if (location)
        cities[city.id].leads.push({
          ...job,
          cityId: city.id,
          location,
          observedAt: at.toISOString(),
        });
    }
  }
  return { generatedAt: at.toISOString(), cities };
}
