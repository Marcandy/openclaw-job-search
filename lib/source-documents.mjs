import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';

const parserVersion = 1;
const maxBytes = 5000000;
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

export async function readEvidenceSource(
  input,
  { store, fetcher = fetch, now = new Date(), maxAgeDays = 7 } = {},
) {
  const url = assertPublicSource(input).href;
  if (store) {
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS source_documents(url TEXT PRIMARY KEY,parser_version INTEGER NOT NULL,data_json TEXT NOT NULL,fetched_at TEXT NOT NULL)',
    );
    const cached = store.db.prepare('SELECT * FROM source_documents WHERE url=?').get(url);
    const age = cached ? now.getTime() - Date.parse(cached.fetched_at) : Infinity;
    if (cached?.parser_version === parserVersion && age >= 0 && age < maxAgeDays * 86400000)
      return { ...JSON.parse(cached.data_json), cached: true };
  }
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error('Evidence HTTP ' + response.status);
  const bytes = await responseBytes(response);
  const contentType = response.headers?.get('content-type') ?? '';
  const isPdf = bytes.subarray(0, 5).toString() === '%PDF-';
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
  const result = {
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
  };
  if (!result.text) throw Error('Source contains no extractable text');
  if (result.text.length > 1000000) throw Error('Source text exceeds extraction budget');
  if (store)
    store.db
      .prepare(
        'INSERT INTO source_documents VALUES(?,?,?,?) ON CONFLICT(url) DO UPDATE SET parser_version=excluded.parser_version,data_json=excluded.data_json,fetched_at=excluded.fetched_at',
      )
      .run(url, parserVersion, JSON.stringify(result), now.toISOString());
  return { ...result, cached: false };
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
