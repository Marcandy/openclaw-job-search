import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../lib/runtime.mjs';
import { checkLocation, evaluateRole } from '../lib/role-filter.mjs';
const config = readJson(new URL('../campaign.config.json', import.meta.url));
const city = config.cities.find((c) => c.id === 'philadelphia');

test('Philadelphia accepts Pennsylvania city spellings', () => {
  assert.equal(city.dailyQuota, 1);
  assert.equal(city.minBackups, 2);
  assert.equal(city.companyProfileOverride.primaryHeadcountMax, 5000);
  for (const location of [
    'Philadelphia, PA',
    'Philadelphia, Pennsylvania (Hybrid)',
    'Philadelphia, PA, USA',
    'Philadelphia, PA 19103',
    'US-PA-Philadelphia',
    'PA - Philadelphia',
    'Philadelphia, Pennsylvania, United States',
  ]) {
    assert.equal(checkLocation({ location }, city).ok, true, location);
  }
});

test('Philadelphia rejects same-name towns, metro labels and suburbs', () => {
  for (const location of [
    'Philadelphia',
    'New Philadelphia, OH',
    'New Philadelphia, PA',
    'Philadelphia, MS',
    'Philadelphia, Mississippi',
    'Philadelphia, NY',
    'Philadelphia, TN',
    'Greater Philadelphia Area',
    'Philadelphia Metropolitan Area',
    'King of Prussia, PA',
    'Conshohocken, PA',
    'Camden, NJ',
    'Pittsburgh, PA',
    'Remote, US',
  ]) {
    assert.equal(checkLocation({ location }, city).ok, false, location);
  }
});

test('Philadelphia applies the existing title gate', () => {
  const result = evaluateRole(
    {
      company: 'Synthetic',
      title: 'Staff Software Engineer',
      location: city.label,
      description: 'Build web applications.',
    },
    city,
    config,
  );
  assert.equal(result.verdict, 'rejected');
  assert.ok(result.failures.some((f) => f.check === 'title'));
});
