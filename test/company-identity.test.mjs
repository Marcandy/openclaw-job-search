import test from 'node:test';
import assert from 'node:assert/strict';
import { employerDomains, companyIdentity, bindCompanyIdentity } from '../lib/company-identity.mjs';
const profile = (headcount, growth) => ({
  profile: {
    headcountSourceUrl: headcount,
    headcountExcerpt: 'The company employs between 51 and 200 employees.',
    thrivingSignals: [{ sourceUrl: growth }],
  },
});
test('company names cannot join Reply consulting jobs to Reply.io evidence', () => {
  assert.equal(
    companyIdentity(
      profile('https://ca.linkedin.com/company/replynow', 'https://reply.io/blog/launch'),
      'reply.com',
    ).ok,
    false,
  );
  assert.equal(
    companyIdentity(
      profile('https://reply.com/about', 'https://www.reply.com/en/news'),
      'reply.com',
    ).ok,
    true,
  );
  assert.equal(
    companyIdentity(profile('https://reply.com/about', 'https://reply.com/news'), 'reply.com').ok,
    true,
  );
  assert.equal(
    companyIdentity(
      profile('https://reply.com.evil.test/about', 'https://reply.com/news'),
      'reply.com',
    ).ok,
    false,
  );
  assert.equal(
    companyIdentity(profile('https://reply.com/about', 'https://reply.io/news'), 'reply.com').ok,
    false,
  );
  assert.equal(
    companyIdentity(profile('https://reply.com/about', 'https://reply.com/news'), null).ok,
    false,
  );
});
test('registry identity needs recorded provenance and cannot disagree across boards', () => {
  const b = {
    company: 'Example',
    employerDomain: 'example.com',
    identitySourceUrl: 'https://example.com/careers',
    identityVerifiedAt: '2026-10-30T12:00:00Z',
  };
  assert.equal(employerDomains({ boards: [b] }).get('example'), 'example.com');
  assert.equal(employerDomains({ boards: [{ ...b, identitySourceUrl: null }] }).size, 0);
  assert.equal(employerDomains({ boards: [b, { ...b, employerDomain: 'other.com' }] }).size, 0);
  assert.equal(employerDomains({ boards: [{ ...b, employerDomain: 'linkedin.com' }] }).size, 0);
});

test('a third-party headcount quote needs the actual employer website beside it', () => {
  const entry = profile('https://linkedin.com/company/reply', 'https://reply.com/news');
  assert.equal(companyIdentity(entry, 'reply.com').ok, false);
  const source = {
    url: entry.profile.headcountSourceUrl,
    text: 'Website https://www.reply.com/ ' + entry.profile.headcountExcerpt,
    bodyHash: 'a'.repeat(64),
  };
  const employerIdentity = bindCompanyIdentity(entry, 'reply.com', source);
  assert.equal(companyIdentity({ ...entry, employerIdentity }, 'reply.com').ok, true);
  assert.throws(
    () =>
      bindCompanyIdentity(entry, 'reply.com', {
        ...source,
        text: 'Website https://reply.io/ ' + entry.profile.headcountExcerpt,
      }),
    /does not corroborate/,
  );
  assert.throws(
    () =>
      bindCompanyIdentity(entry, 'reply.com', {
        ...source,
        text: 'Website https://reply.com.evil.test/ ' + entry.profile.headcountExcerpt,
      }),
    /does not corroborate/,
  );
});

test('model-reported size cannot waive employer identity during profile verification', async () => {
  const { verifyResearchedProfile } = await import('../lib/daily-discovery.mjs');
  const item = {
    company: 'Reply',
    profile: {
      headcountMin: 51,
      headcountMax: 200,
      headcountSourceUrl: 'https://www.linkedin.com/company/replynow',
      headcountExcerpt: 'Company size is between 51 and 200 employees.',
      isHouseholdName: false,
      thrivingSignals: [
        {
          type: 'product_launch_or_expansion',
          asOf: '2026-10-01',
          sourceUrl: 'https://reply.com/news',
          excerpt: 'Reply announced a new software product in October 2026.',
        },
      ],
    },
  };
  const fetcher = async (url) =>
    new Response(
      '<p>' +
        (/linkedin/.test(url)
          ? 'Website https://reply.io ' + item.profile.headcountExcerpt
          : item.profile.thrivingSignals[0].excerpt) +
        '</p>',
    );
  await assert.rejects(
    () =>
      verifyResearchedProfile(item, {
        fetcher,
        now: new Date('2026-10-30T12:00:00Z'),
        acceptModelReported: true,
        employerDomain: 'reply.com',
      }),
    /does not corroborate the verified employer/,
  );
});
