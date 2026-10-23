import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';

const parserVersion = 1;
// SEC filings and large company pages run well past 5 MB of HTML; PDFs keep
// the smaller limit because they are parsed in a memory-bounded worker.
const maxBytes = 20000000;
const maxPdfBytes = 5000000;
const maxTextChars = 5000000;
// Many company sites refuse requests that do not look like a browser.
const requestHeaders = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

/**
 * Fetch a public HTTPS source, following at most five redirects and checking
 * that every hop is still a public HTTPS address before requesting it.
 */
export async function fetchPublic(input, fetcher = fetch) {
  let url = assertPublicSource(input).href;
  for (let hop = 0; hop <= 5; hop++) {
    const response = await fetcher(url, {
      redirect: 'manual',
      headers: requestHeaders,
      signal: AbortSignal.timeout(20000),
    });
    const location = response.headers?.get?.('location');
    if (response.status >= 300 && response.status < 400 && location) {
      url = assertPublicSource(new URL(location, url)).href;
      continue;
    }
    return response;
  }
  throw Error('Evidence redirected too many times');
}
export const normalizeEvidenceText = (value) =>
  String(value).normalize('NFKC').replace(/\s+/g, ' ').trim();

export function assertPublicSource(input) {
  const url = new URL(input);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    /^(?:localhost(?:\.|$)|0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[)/i.test(
      url.hostname,
    )
  ) {
    throw Error('Evidence requires a public HTTPS source');
  }
  return url;
}

function jsonText(data) {
  const strings = [];
  const visit = (value, depth = 0) => {
    if (depth > 30) return;
    if (typeof value === 'string' || typeof value === 'number') strings.push(String(value));
    else if (value && typeof value === 'object')
      Object.values(value).forEach((item) => visit(item, depth + 1));
  };
  visit(data);
  return strings.join(' ');
}

export function extractHtmlText(html) {
  const $ = load(html);
  const structured = [];
  $('script[type="application/ld+json"],script#__NEXT_DATA__').each((_, element) => {
    try {
      structured.push(jsonText(JSON.parse($(element).text())));
    } catch {}
  });
  $('script,style,template,noscript').remove();
  $('p,div,section,article,li,br,h1,h2,h3,h4,td,tr').each((_, element) => {
    $(element).prepend(' ');
    $(element).append(' ');
  });
  return normalizeEvidenceText($('body').text() + ' ' + structured.join(' '));
}

async function responseBytes(response) {
  if (Number(response.headers?.get('content-length')) > maxBytes)
    throw Error('Evidence exceeds size budget');
  if (!response.body) {
    const bytes = Buffer.from(await response.text());
    if (bytes.length > maxBytes) throw Error('Evidence exceeds size budget');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw Error('Evidence exceeds size budget');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export function extractPdf(bytes) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdf-extract-worker.mjs', import.meta.url), {
      workerData: { bytes },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(Error('PDF extraction timeout'));
    }, 15000);
    worker.once('message', (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once('exit', (code) => {
      clearTimeout(timer);
      if (code) reject(Error('PDF extraction worker stopped'));
    });
  });
}

// Statuses a site returns to clients it takes for bots; a real browser often gets the page.
const BROWSER_RETRY_STATUS = new Set([401, 403, 429, 503]);

/**
 * Read a source as a browser renders it: visible text plus published
 * structured data. `browser` is a reader from browser-evidence.mjs.
 */
async function readRendered(url, browser, now) {
  const rendered = await browser.read(url);
  return {
    url: rendered.url,
    mediaType: 'text/html',
    bodyHash: createHash('sha256').update(rendered.html).digest('hex'),
    text: normalizeEvidenceText(rendered.text + ' ' + extractHtmlText(rendered.html)),
    pages: [],
    truncated: false,
    fetchedAt: now.toISOString(),
    renderedBy: 'browser',
  };
}

export async function readEvidenceSource(
  input,
  { store, fetcher = fetch, now = new Date(), maxAgeDays = 7, browser, forceBrowser = false } = {},
) {
  const url = assertPublicSource(input).href;
  if (store) {
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS source_documents(url TEXT PRIMARY KEY,parser_version INTEGER NOT NULL,data_json TEXT NOT NULL,fetched_at TEXT NOT NULL)',
    );
    const cached = store.db.prepare('SELECT * FROM source_documents WHERE url=?').get(url);
    const age = cached ? now.getTime() - Date.parse(cached.fetched_at) : Infinity;
    const data = cached ? JSON.parse(cached.data_json) : null;
    if (
      cached?.parser_version === parserVersion &&
      age >= 0 &&
      age < maxAgeDays * 86400000 &&
      (!forceBrowser || data.renderedBy === 'browser')
    )
      return { ...data, cached: true };
  }
  const save = (result) => {
    if (!result.text) throw Error('Source contains no extractable text');
    if (result.text.length > maxTextChars) throw Error('Source text exceeds extraction budget');
    if (store)
      store.db
        .prepare(
          'INSERT INTO source_documents VALUES(?,?,?,?) ON CONFLICT(url) DO UPDATE SET parser_version=excluded.parser_version,data_json=excluded.data_json,fetched_at=excluded.fetched_at',
        )
        .run(url, parserVersion, JSON.stringify(result), now.toISOString());
    return { ...result, cached: false };
  };
  if (forceBrowser && browser) return save(await readRendered(url, browser, now));
  const response = await fetchPublic(url, fetcher);
  if (!response.ok && browser && BROWSER_RETRY_STATUS.has(response.status))
    return save(await readRendered(url, browser, now));
  if (!response.ok) throw Error('Evidence HTTP ' + response.status);
  const bytes = await responseBytes(response);
  const contentType = response.headers?.get('content-type') ?? '';
  const isPdf = bytes.subarray(0, 5).toString() === '%PDF-';
  if (isPdf && bytes.length > maxPdfBytes) throw Error('Evidence exceeds size budget');
  let pages = [],
    truncated = false,
    text;
  if (isPdf) {
    ({ pages, truncated } = await extractPdf(bytes));
    text = pages.map((page) => page.text).join(' ');
  } else if (/pdf/i.test(contentType)) throw Error('Invalid PDF source');
  else {
    const body = bytes.toString('utf8');
    try {
      text = normalizeEvidenceText(jsonText(JSON.parse(body)));
    } catch {
      text = extractHtmlText(body);
    }
  }
  // An app shell has no text until its scripts run.
  if (!isPdf && !normalizeEvidenceText(text) && browser)
    return save(await readRendered(url, browser, now));
  return save({
    url,
    mediaType: isPdf
      ? 'application/pdf'
      : /json/i.test(contentType)
        ? 'application/json'
        : 'text/html',
    bodyHash: createHash('sha256').update(bytes).digest('hex'),
    text: normalizeEvidenceText(text),
    pages,
    truncated,
    fetchedAt: now.toISOString(),
  });
}

export function corroborateExcerpt(source, excerpt) {
  const expected = normalizeEvidenceText(excerpt);
  if (expected.length < 20 || !source.text.toLowerCase().includes(expected.toLowerCase()))
    throw Error('Source does not corroborate excerpt');
  return {
    url: source.url,
    excerpt,
    bodyHash: source.bodyHash,
    fetchedAt: source.fetchedAt,
    page:
      source.pages.find((page) =>
        normalizeEvidenceText(page.text).toLowerCase().includes(expected.toLowerCase()),
      )?.page ?? null,
  };
}
