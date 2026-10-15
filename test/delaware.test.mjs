import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../lib/runtime.mjs';
import { checkLocation } from '../lib/role-filter.mjs';

const config = readJson(new URL('../campaign.config.json', import.meta.url));
const delaware = config.cities.find((city) => city.id === 'wilmington');

test('Wilmington accepts explicit Delaware city locations', () => {
  for (const location of [
    'Wilmington, DE',
    'Wilmington, Delaware (Hybrid)',
    'Wilmington, DE, USA',
    'US-DE-Wilmington',
    'Wilmington, DE 19801',
  ]) {
    assert.equal(checkLocation({ location }, delaware).ok, true, location);
  }
  assert.equal(
    checkLocation(
      { location: 'Newark, DE' },
      config.cities.find((city) => city.id === 'newark'),
    ).ok,
    false,
  );
});

test('Wilmington rejects statewide Delaware, other Delaware cities and neighboring states', () => {
  for (const location of [
    'Delaware',
    'DE',
    'Newark, DE',
    'Dover, Delaware',
    'North Wilmington, DE',
    'Wilmington Manor, DE',
    'Greater Wilmington, DE',
    'Delaware, OH',
    'Delaware, Ohio',
    'Delaware County, PA',
    'Delaware City, TX',
    'Newark, NJ',
    'Wilmington, NC',
    'Wilmington',
    'Berlin, Germany',
    'Remote, US',
  ]) {
    assert.equal(checkLocation({ location }, delaware).ok, false, location);
  }
});
