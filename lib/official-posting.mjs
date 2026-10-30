import { load } from 'cheerio';
import { fetchBoard, normalizePosting } from './board-discovery.mjs';
import { officialJobIdentity } from './official-destination.mjs';

// Application tabs often omit the job description. Read the exact requisition
// from its public ATS API; never mistake the form text for job responsibilities.
export async function readOfficialPosting(destination, fetcher = fetch) {
  const { platform, slug, id } = officialJobIdentity(destination.url);
  if (platform !== destination.source) throw Error('Official posting source mismatch');
  const decode = (value) => (typeof value === 'string' ? load(value).root().text() : value);
  const wrapped = async (url, options) => {
    const response = await fetcher(url, options);
    return {
      ok: response.ok,
      status: response.status,
      json: async () => {
        const data = await response.json();
        for (const job of Array.isArray(data) ? data : (data.jobs ?? [])) {
          if (job.content?.includes('&lt;')) job.content = decode(job.content);
        }
        return data;
      },
    };
  };
  if (platform === 'lever' || platform === 'greenhouse') {
    const endpoint =
      platform === 'lever'
        ? `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}/${id}`
        : `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${id}?content=true`;
    const response = await fetcher(endpoint, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error('Official requisition is unavailable: HTTP ' + response.status);
    const raw = await response.json();
    if (String(raw.id) !== id) throw Error('Official requisition identity mismatch');
    if (raw.content?.includes('&lt;')) raw.content = decode(raw.content);
    const job = normalizePosting({ platform, slug, company: destination.company }, raw);
    const identity = officialJobIdentity(job.url);
    if (identity.platform !== platform || identity.slug !== slug || identity.id !== id)
      throw Error('Official requisition destination mismatch');
    if (!job.description?.trim()) throw Error('Official requisition description is unavailable');
    return job;
  }
  const jobs = await fetchBoard({ platform, slug, company: destination.company }, wrapped);
  const job = jobs.find((j) => j.postingId.split(':').at(-1) === id);
  if (!job || !job.description?.trim())
    throw Error('Official requisition or description is unavailable');
  return job;
}
