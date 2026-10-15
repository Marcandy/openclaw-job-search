import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../lib/runtime.mjs';
import { checkLocation } from '../lib/role-filter.mjs';

const config = readJson(new URL('../campaign.config.json', import.meta.url));
const delaware = config.cities.find((city) => city.id === 'delaware');

test('Delaware accepts explicit state locations, including Wilmington, Newark and Dover', () => {
  for (const location of [
    'Delaware',
    'DE',
    'Wilmington, DE',
    'Newark, Delaware (Hybrid)',
    'Dover, DE, USA',
    'Lewes, Delaware, United States',
    'US-DE-Middletown',
    'Milford, DE 19963',
    'Remote - Delaware',
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

test('Delaware rejects same-name cities, counties and neighboring states', () => {
  for (const location of [
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
