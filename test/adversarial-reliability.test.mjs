import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyRole, checkActualLocation } from '../lib/role-qualification.mjs';
import { officialApplicationUrl } from '../lib/official-destination.mjs';
import { usRemote } from '../lib/daily-discovery.mjs';
import { mapRoutineQuestions } from '../lib/daily-policy.mjs';
const role = (description) => ({ title: 'Software Engineer', description });

test('unrelated preferred language cannot waive a mandatory specialty', () => {
  for (const description of [
    'Production Vue experience required, React preferred.',
    'Vue preferred and Vue experience required.',
    'Requirements\nMust have production experience with Vue.\nNice-to-have\nReact experience.',
    'Must have Salesforce Marketing Cloud experience; Vue preferred.',
  ])
    assert.equal(qualifyRole(role(description)).ok, false, description);
  assert.equal(
    qualifyRole(role('Build web applications.\nNice-to-have\nProfessional Vue experience.')).ok,
    true,
  );
});

test('ordinary software work involving sales or test harnesses is not physical engineering', () => {
  assert.equal(
    qualifyRole({
      title: 'Backend Engineer, Sales Platform',
      description: 'Build Java APIs for the sales platform.',
    }).ok,
    true,
  );
  assert.equal(
    qualifyRole({
      title: 'Test Harness Engineer',
      description: 'Develop software test harnesses in Python.',
    }).ok,
    true,
  );
});

test('no-clearance wording differs from mandatory clearance; Secret does not establish TS/SCI', () => {
  assert.equal(qualifyRole(role('Build software. No security clearance required.')).ok, true);
  assert.equal(qualifyRole(role('Must be a U.S. citizen.')).ok, false);
  const facts = { fields: { securityClearance: { value: 'Secret', uses: ['application'] } } };
  assert.equal(qualifyRole(role('Ability to obtain TS//SCI clearance.'), {}, facts).ok, false);
  assert.equal(
    qualifyRole(
      role('Must be a U.S. citizen.'),
      {},
      { fields: { citizenship: { value: 'United States', uses: ['application'] } } },
    ).ok,
    true,
  );
});

test('same-name cities and negated work locations cannot override the approved state', () => {
  const city = { label: 'Denver, CO', acceptedLocationAliases: ['Denver, CO'] };
  assert.equal(checkActualLocation(role('Work Location: onsite in Denver, NC.'), city).ok, false);
  assert.equal(checkActualLocation(role('Work Location: onsite, not Denver, CO.'), city).ok, false);
});

test('North America alone is not United States residence eligibility', () => {
  assert.equal(usRemote({ locations: ['Remote - North America'], description: '' }), false);
  assert.equal(usRemote({ locations: ['Remote - Canada'], description: '' }), false);
  assert.equal(
    usRemote({ locations: ['Remote - United States'], description: 'Cannot hire in New York.' }),
    false,
  );
});

test('a conflicting custom-source job ID is refused instead of silently repaired', () => {
  assert.throws(
    () =>
      officialApplicationUrl(
        { platform: 'greenhouse', slug: 'seatgeek' },
        '123',
        'https://seatgeek.com/jobs?gh_jid=999',
      ),
    /mismatch/,
  );
});

test('state abbreviation maps only to a unique offered equivalent; employer history stays unknown', () => {
  const q = {
    key: 'state',
    required: true,
    type: 'select',
    label: 'Which U.S. State or Canadian Province do you reside in?',
    options: ['New York', 'California'],
  };
  const facts = { fields: { homeState: { value: 'NY', uses: ['application'] } } };
  const d = { company: 'Example', url: 'https://example.test/job' };
  const plan = mapRoutineQuestions([q], d, facts, {});
  assert.equal(plan.facts.fields[plan.answers.state].value, 'New York');
  const ambiguous = mapRoutineQuestions([{ ...q, options: ['NY', 'New York'] }], d, facts, {});
  assert.equal(ambiguous.answers.state, 'homeState'); // exact offered confirmed value wins
  assert.equal(
    mapRoutineQuestions([{ ...q, options: ['Ontario'] }], d, facts, {}).blocked.length,
    1,
  );
});
