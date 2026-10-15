import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../lib/runtime.mjs';
import { checkLocation, evaluateRole } from '../lib/role-filter.mjs';
const config = readJson(new URL('../campaign.config.json', import.meta.url));
const city = config.cities.find((c) => c.id === 'st-louis');

test('St. Louis accepts Missouri spellings and rejects nearby or ambiguous locations', () => {
  assert.equal(city.dailyQuota, 1);
  assert.equal(city.minBackups, 2);
  assert.equal(city.companyProfileOverride.primaryHeadcountMax, 5000);
  for (const location of [
    'St. Louis, MO',
    'St Louis, Missouri (Hybrid)',
    'Saint Louis, MO, USA',
    'US-MO-St. Louis',
    'MO - Saint Louis',
  ]) {
    assert.equal(checkLocation({ location }, city).ok, true, location);
  }
  for (const location of [
    'St Louis',
    'St. Louis, IL',
    'East St. Louis, MO',
    'East Saint Louis, Illinois',
    'St. Louis County, MO',
    'Bay St. Louis, MO',
    'St. Louis, Michigan',
    'Greater St. Louis Area',
    'Clayton, MO',
    'Remote, US',
  ]) {
    assert.equal(checkLocation({ location }, city).ok, false, location);
  }
});

test('St. Louis applies the existing title gate', () => {
  const result = evaluateRole(
    {
      company: 'Synthetic',
      title: 'Senior AI Engineer',
      location: city.label,
      description: 'Build AI applications.',
    },
    city,
    config,
  );
  assert.equal(result.verdict, 'rejected');
  assert.ok(result.failures.some((f) => f.check === 'title'));
});
