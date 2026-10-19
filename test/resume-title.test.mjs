import test from 'node:test';
import assert from 'node:assert/strict';
import { experienceTitle, resumeTitleMismatches } from '../lib/resume-title.mjs';

// A one-page PDF whose only text is `line`, with a correct cross-reference table.
function pdfWithText(line) {
  const stream = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const at = body.length;
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) body += `${String(at).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const facts = (title) => ({
  fields: {
    currentCompany: { value: 'Lotnivo' },
    ...(title ? { currentTitle: { value: title } } : {}),
  },
});

test('experience title is read from the entry at the current company', () => {
  const skills = 'SKILLS Python, React | AWS EXPERIENCE ';
  assert.equal(
    experienceTitle(
      skills + 'Software Consultant — Lotnivo, Remote March 2022 - Present',
      'Lotnivo',
    ),
    'Software Consultant',
  );
  assert.equal(
    experienceTitle(skills + 'Software Consultant / Technical Lead – Lotnivo, Remote', 'Lotnivo'),
    'Software Consultant / Technical Lead',
  );
  assert.equal(
    experienceTitle(skills + 'Full-Stack Developer & AI Engineer — Lotnivo', 'Lotnivo'),
    'Full-Stack Developer & AI Engineer',
  );
  assert.equal(experienceTitle('EXPERIENCE Engineer — Acme', 'Lotnivo'), null);
});

test('pinned resumes must show the confirmed current title', async () => {
  const files = {
    mid: pdfWithText('EXPERIENCE Software Consultant - Lotnivo, Remote March 2022 - Present'),
    senior: pdfWithText('EXPERIENCE Software Consultant / Technical Lead - Lotnivo, Remote'),
    other: pdfWithText('EXPERIENCE Engineer - Acme'),
  };
  const read = (path) => files[path];
  assert.deepEqual(
    await resumeTitleMismatches(['mid'], facts('Software Consultant'), { read }),
    [],
  );
  assert.deepEqual(
    await resumeTitleMismatches(['mid', 'senior', 'other'], facts('Software Consultant'), { read }),
    [
      {
        path: 'senior',
        expected: 'Software Consultant',
        found: 'Software Consultant / Technical Lead',
      },
      { path: 'other', expected: 'Software Consultant', found: null },
    ],
  );
  // No confirmed title: nothing to compare, so nothing is reported.
  assert.deepEqual(await resumeTitleMismatches(['senior'], facts(null), { read }), []);
});
