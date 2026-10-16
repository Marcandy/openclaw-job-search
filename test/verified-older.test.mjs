import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntime } from '../lib/runtime.mjs';
import { checkSource, campaignToday } from '../lib/role-filter.mjs';

test('older postings require explicit configuration and same-day employer confirmation', () => {
  const config = loadRuntime().config;
  const role = {
    url: 'https://jobs.ashbyhq.com/example/00000000-0000-0000-0000-000000000001',
    source: 'ashby',
    postedDate: new Date(Date.now() - 100 * 86400000).toISOString(),
    verifiedActiveOn: campaignToday(config),
  };
  assert.equal(checkSource(role, config).ok, false);
  config.sourceFilter.allowVerifiedActiveOlderPostings = true;
  assert.equal(checkSource(role, config).ok, true);
  assert.equal(checkSource({ ...role, verifiedActiveOn: '2020-01-01' }, config).ok, false);
  assert.equal(checkSource({ ...role, verifiedActiveOn: undefined }, config).ok, false);
});
