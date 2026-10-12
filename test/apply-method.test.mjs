import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectApplyMethod, atsHostOf } from '../lib/apply-method.mjs';

/**
 * 2026-09-01 regression: Flotive AI reached a Newark PRIMARY slot with an
 * email-only careers page. verify-candidates reported [ OK ] because the page
 * loaded and the recorded values appeared on it. Nothing asked whether a form
 * existed, so a slot was spent on a destination that could never produce a
 * receipt.
 */

const FLOTIVE_TEXT = `
  Careers Come build with us. We're a small team building AI-enabled software
  for infrastructure development. Founding Software Engineer Own the technical
  architecture of our regulatory-intelligence platform, working directly with
  the founders. Jersey City, NJ In-person Full-time $150K-$180K + equity
  About the role As a Founding Backend Software Engineer at Flotive, you will
  work closely with the co-founders. What we are looking for 4+ years of
  experience as a software engineer. Compensation $150,000 to $180,000 base
  salary, plus equity. Location This role is in-person, based in Jersey City,
  NJ. Applying Interested candidates should reach out to careers@flotive.ai
  with the subject line "Founding Software Engineer" and attach their resume.
  Apply via Email Apply via LinkedIn Don't see the right role?
  <a href="mailto:careers@flotive.ai">Email us</a>
`;

test('2026-09-01 regression: an email-only careers page cannot occupy a slot', () => {
  const r = detectApplyMethod('https://flotive.ai/careers.html', FLOTIVE_TEXT);
  assert.equal(r.method, 'email-only');
  assert.equal(r.ok, false, 'an email-only posting must not be presentable');
  assert.match(r.detail, /email/i);
});

test('a known ATS host is accepted without reading the page', () => {
  for (const url of [
    'https://jobs.ashbyhq.com/sourgum/3691acb1-8df1-406a-9c79-4faa59231070',
    'https://job-boards.greenhouse.io/prolaio/jobs/5395907008',
    'https://ats.rippling.com/supernova-technology/jobs/abc',
    'https://bitdeer.breezy.hr/p/ed6314823d0c-sre',
    'https://corebridgefinancial.wd1.myworkdayjobs.com/x/job/y',
    'https://careers-appliedsystems.icims.com/jobs/7318/job',
    'https://jobs.lever.co/loadsmart/152abf3a',
  ]) {
    const r = detectApplyMethod(url, '');
    assert.equal(r.method, 'ats', `${url} should be recognised as an ATS`);
    assert.equal(r.ok, true);
  }
});

test('an ATS posting that merely prints a recruiter address is not email-only', () => {
  // Ashby renders client-side, so this arrives with an email in the text and
  // no form markers. It must NOT be rejected: the host is the form.
  const r = detectApplyMethod(
    'https://jobs.ashbyhq.com/acme/1234',
    'Questions? Please send your resume questions to talent@acme.com mailto:talent@acme.com'
  );
  assert.equal(r.method, 'ats');
  assert.equal(r.ok, true);
});

test('a custom employer page with a real form is accepted', () => {
  const text = `
    Software Engineer - Back End. Arrive Logistics. Chicago, IL.
    Apply for this job. First name. Last name. Email. Upload resume.
    LinkedIn profile. Submit application.
  `.repeat(3);
  const r = detectApplyMethod('https://www.arrivelogistics.com/job/software-engineer-back-end-3/', text);
  assert.equal(r.ok, true);
  assert.equal(r.method, 'form');
});

test('an unreadable page is flagged for browser confirmation, never auto-rejected', () => {
  const r = detectApplyMethod('https://example.com/careers', '');
  assert.equal(r.method, 'unknown');
  assert.equal(r.ok, true, 'an unread page is not evidence that a form is absent');
  assert.match(r.detail, /browser/i);
});

test('a page offering BOTH a form and an email is treated as having a form', () => {
  const text = `
    Founding Engineer. Apply for this job below, or if you prefer you may
    email your resume to jobs@acme.com. First name Last name Upload resume.
  `.repeat(3);
  const r = detectApplyMethod('https://acme.com/careers', text);
  assert.equal(r.ok, true);
  assert.equal(r.method, 'form');
});

test('atsHostOf resolves subdomains and rejects unrelated hosts', () => {
  assert.equal(atsHostOf('https://job-boards.greenhouse.io/x/jobs/1'), 'greenhouse.io');
  assert.equal(atsHostOf('https://flotive.ai/careers.html'), null);
  assert.equal(atsHostOf('not a url'), null);
});
