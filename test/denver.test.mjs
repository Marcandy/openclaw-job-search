import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../lib/runtime.mjs';
import { checkLocation } from '../lib/role-filter.mjs';
const config = readJson(new URL('../campaign.config.json', import.meta.url));
const city = config.cities.find((c) => c.id === 'denver');

test('Denver accepts Colorado city spellings', () => {
  assert.equal(city.companyProfileOverride.primaryHeadcountMax, 10000);
  for (const location of [
    'Denver, CO',
    'Denver, Colorado (Hybrid)',
    'Denver, CO, USA',
    'Denver, CO 80202',
    'US-CO-Denver',
    'CO - Denver',
    'Denver, Colorado, United States',
  ]) {
    assert.equal(checkLocation({ location }, city).ok, true, location);
  }
});

test('Denver rejects same-name towns, metro labels and suburbs', () => {
  for (const location of [
    'Denver',
    'Denver, NC',
    'Denver, North Carolina',
    'Denver, PA',
    'Denver, IA',
    'Denver City, TX',
    'Greater Denver Area',
    'Denver Metropolitan Area',
    'Aurora, CO',
    'Boulder, CO',
    'Colorado Springs, CO',
    'Remote, US',
  ]) {
    assert.equal(checkLocation({ location }, city).ok, false, location);
  }
});
