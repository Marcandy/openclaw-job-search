import test from 'node:test';
import assert from 'node:assert/strict';
import { EventStore } from '../lib/event-store.mjs';
import {
  readEvidenceSource,
  extractHtmlText,
  corroborateExcerpt,
} from '../lib/source-documents.mjs';

test('HTML extraction decodes entities, keeps inline text and JSON-LD, and excludes executable source', () => {
  const text = extractHtmlText(
    '<p>Our <b>team</b> has 51 &ndash; 200 employees.</p><script>Fake funding claim</script><script type="application/ld+json">{"description":"We raised funding in October 2026."}</script>',
  );
  assert.match(text, /Our team has 51 – 200 employees/);
  assert.match(text, /We raised funding in October 2026/);
  assert.doesNotMatch(text, /Fake funding claim/);
});

test('source cache survives separate reads and refreshes after expiry without retaining failed responses', async () => {
  const store = new EventStore(':memory:');
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return new Response('<p>Our team has 51 to 200 employees.</p>');
  };
  try {
    const first = await readEvidenceSource('https://example.org/about', {
      store,
      fetcher,
      now: new Date('2026-10-16'),
    });
    const cached = await readEvidenceSource(first.url, {
      store,
      fetcher,
      now: new Date('2026-10-17'),
    });
    assert.equal(calls, 1);
    assert.equal(cached.cached, true);
    assert.equal(
      corroborateExcerpt(cached, 'Our team has 51 to 200 employees.').bodyHash,
      first.bodyHash,
    );
    await assert.rejects(
      readEvidenceSource(first.url, {
        store,
        now: new Date('2026-10-24'),
        fetcher: async () => new Response('', { status: 503 }),
      }),
      /HTTP 503/,
    );
    await readEvidenceSource(first.url, { store, fetcher, now: new Date('2026-10-24') });
    assert.equal(calls, 2);
    assert.throws(
      () => corroborateExcerpt(first, 'This company raised one billion dollars.'),
      /corroborate/,
    );
  } finally {
    store.close();
  }
});

test('evidence rejects local URLs and oversized streams before parsing', async () => {
  for (const url of [
    'http://example.org',
    'https://127.0.0.1',
    'https://10.0.0.1',
    'https://localhost',
    'https://[::1]',
  ]) {
    await assert.rejects(
      readEvidenceSource(url, {
        fetcher: () => {
          throw Error('must not fetch');
        },
      }),
      /public HTTPS/,
    );
  }
  await assert.rejects(
    readEvidenceSource('https://example.org/huge', {
      fetcher: async () => new Response('a'.repeat(20000001)),
    }),
    /size budget/,
  );
  await assert.rejects(
    readEvidenceSource('https://example.org/huge.pdf', {
      fetcher: async () => new Response('%PDF-' + 'a'.repeat(5000001)),
    }),
    /size budget/,
  );
});

test('evidence follows public redirects with browser headers and refuses private hops', async () => {
  const seen = [];
  const fetcher = async (url, options) => {
    seen.push({ url, options });
    if (url === 'https://example.org/about')
      return new Response('', { status: 301, headers: { location: '/about/' } });
    return new Response('<p>We have about 350 employees across three offices.</p>', {
      headers: { 'content-type': 'text/html' },
    });
  };
  const source = await readEvidenceSource('https://example.org/about', { fetcher });
  assert.match(source.text, /about 350 employees/);
  assert.deepEqual(
    seen.map((s) => s.url),
    ['https://example.org/about', 'https://example.org/about/'],
  );
  assert.equal(seen[0].options.redirect, 'manual');
  assert.match(seen[0].options.headers['user-agent'], /Mozilla/);
  await assert.rejects(
    readEvidenceSource('https://example.org/out', {
      fetcher: async () =>
        new Response('', { status: 302, headers: { location: 'https://127.0.0.1/admin' } }),
    }),
    /public HTTPS/,
  );
  await assert.rejects(
    readEvidenceSource('https://example.org/loop', {
      fetcher: async (url) => new Response('', { status: 302, headers: { location: url + 'x' } }),
    }),
    /too many times/,
  );
});

function textPdf(text) {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, '0') + ' 00000 n ')
    .join('\n')}\ntrailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

test('PDF text extraction records the corroborating page and rejects unsupported claims', async () => {
  const source = await readEvidenceSource('https://example.org/report.pdf', {
    fetcher: async () =>
      new Response(textPdf('Our company has 51 to 200 employees.'), {
        headers: { 'content-type': 'application/pdf' },
      }),
  });
  assert.equal(source.mediaType, 'application/pdf');
  assert.equal(corroborateExcerpt(source, 'Our company has 51 to 200 employees.').page, 1);
  assert.throws(() => corroborateExcerpt(source, 'Our company has 5000 employees.'), /corroborate/);
});
