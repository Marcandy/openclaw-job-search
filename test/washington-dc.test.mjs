import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../lib/runtime.mjs';
import { checkLocation, containsPlace } from '../lib/role-filter.mjs';
const config = readJson(new URL('../campaign.config.json', import.meta.url));
const city = (id) => config.cities.find((c) => c.id === id);

test('Washington, DC accepts District spellings', () => {
  for (const location of [
    'Washington, DC',
    'Washington, D.C. (Hybrid)',
    'Washington, DC 20001',
    'Washington, District of Columbia, United States',
    'US-DC-Washington',
    'DC',
    'Remote - DC',
    'DMV',
  ]) {
    assert.equal(checkLocation({ location }, city('washington-dc')).ok, true, location);
  }
});

test('Washington, DC rejects Washington State, same-name towns, suburbs and embedded letters', () => {
  for (const location of [
    'Washington',
    'Seattle, Washington',
    'Washington, PA',
    'Washington, NC',
    'Arlington, VA',
    'Bethesda, MD',
    'Woodcliff Lake, NJ',
    'Redcliff, AB',
    'Hudson, NY',
    'Admvantage HQ',
  ]) {
    assert.equal(checkLocation({ location }, city('washington-dc')).ok, false, location);
  }
});

test('aliases match on word boundaries, not inside other words', () => {
  assert.equal(containsPlace('woodcliff lake, nj', 'DC'), false);
  assert.equal(containsPlace('washington, dc', 'DC'), true);
  assert.equal(containsPlace('columbus - oh', 'US -'), false);
  assert.equal(containsPlace('us - remote', 'US -'), true);
  assert.equal(containsPlace('u.s.a.', 'U.S.'), true);
  const usRemote = {
    label: 'US Remote',
    acceptedLocationAliases: ['Remote', 'United States', 'USA', 'US -', 'U.S.'],
  };
  assert.equal(checkLocation({ location: 'Columbus - OH' }, usRemote).ok, false);
  assert.equal(checkLocation({ location: 'US - Remote' }, usRemote).ok, true);
  assert.equal(checkLocation({ location: 'Newark, NJ 07102' }, city('newark')).ok, true);
  assert.equal(checkLocation({ location: 'Chicago, IL (Hybrid)' }, city('chicago')).ok, true);
});
