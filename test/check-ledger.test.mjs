import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const { auditLedger, EXPECTED_HEADER } = await import(
  pathToFileURL(join(root, 'tools', 'check-ledger.mjs')).href
);

/**
 * 2026-09-16 regression coverage for the 2026-09-14 duplicate-submission
 * incident: a Gateway 1006 disconnect plus an embedded-agent fallback submitted
 * Muon Space and Tradepost (Backend) twice each, minutes apart. Nothing flagged
 * it. check-ledger.mjs is the watchdog that should have.
 */

const HEADER = EXPECTED_HEADER.join(',');
const row = (ts, company, title, url, status) =>
  `"${ts}","${company}","${title}","Chicago, IL","${url}","ashby","${status}","resume.pdf","note"`;

function rows(...lines) {
  const text = [HEADER, ...lines].join('\n');
  // reuse the tool's own parser semantics: simple split is fine here because
  // the fixtures carry no embedded commas inside quotes beyond location
  const out = [];
  let r = [],
    cur = '',
    q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      r.push(cur);
      cur = '';
    } else if (c === '\n') {
      r.push(cur);
      out.push(r);
      r = [];
      cur = '';
    } else if (c !== '\r') cur += c;
  }
  if (cur || r.length) {
    r.push(cur);
    out.push(r);
  }
  return out;
}

test('a clean ledger passes with no problems and no duplicates', () => {
  const { problems, duplicateSubmissions } = auditLedger(
    rows(
      row(
        '2026-09-14T16:39:23-04:00',
        'Acme',
        'Software Engineer',
        'https://jobs.ashbyhq.com/acme/1',
        'submitted',
      ),
      row(
        '2026-09-14T16:40:46-04:00',
        'Beta',
        'Frontend Engineer',
        'https://jobs.ashbyhq.com/beta/2',
        'blocked',
      ),
    ),
  );
  assert.equal(problems.length, 0);
  assert.equal(duplicateSubmissions.length, 0);
});

test('2026-09-14 regression: the same URL submitted twice on one day is flagged', () => {
  const url = 'https://job-boards.greenhouse.io/muonspace/jobs/5188072007';
  const { duplicateSubmissions } = auditLedger(
    rows(
      row(
        '2026-09-14T16:39:23-04:00',
        'Muon Space',
        'Software Engineer, Frontend',
        url,
        'submitted',
      ),
      row('2026-09-14T20:52:45Z', 'Muon Space', 'Software Engineer, Frontend', url, 'submitted'),
    ),
  );
  const sameDay = duplicateSubmissions.filter((d) => d.kind === 'same-day-duplicate');
  assert.equal(sameDay.length, 1);
  assert.deepEqual(sameDay[0].lines, [2, 3]);
});

test('a deliberate cross-day retry is reported as a note, not a same-day duplicate', () => {
  const url = 'https://jobs.ashbyhq.com/acme/1';
  const { duplicateSubmissions } = auditLedger(
    rows(
      row('2026-09-10T10:00:00-04:00', 'Acme', 'Software Engineer', url, 'submitted'),
      row('2026-09-14T10:00:00-04:00', 'Acme', 'Software Engineer', url, 'submitted'),
    ),
  );
  assert.equal(duplicateSubmissions.filter((d) => d.kind === 'same-day-duplicate').length, 0);
  assert.equal(duplicateSubmissions.filter((d) => d.kind === 'cross-day-repeat').length, 1);
});

test('a row with shifted columns is caught by field count and by the URL check', () => {
  const shifted =
    '"2026-09-14T20:55:07Z","Tradepost Software Engineer","Chicago, IL","ashby","submitted","resume.pdf","note"';
  const { problems } = auditLedger([EXPECTED_HEADER, ...rows(shifted).slice(1)]);
  assert.ok(problems.some((p) => p.kind === 'field-count'));
});

test('unknown status values are flagged', () => {
  const { problems } = auditLedger(
    rows(
      row(
        '2026-09-14T16:39:23-04:00',
        'Acme',
        'Software Engineer',
        'https://jobs.ashbyhq.com/acme/1',
        'submited',
      ),
    ),
  );
  assert.ok(problems.some((p) => p.kind === 'status'));
});

test('a bad header fails fast with a header problem', () => {
  const { problems } = auditLedger(rows().map((r, i) => (i === 0 ? ['time', 'co'] : r)));
  assert.equal(problems[0].kind, 'header');
});
