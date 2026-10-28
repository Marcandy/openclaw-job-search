import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnswerContext, contextForRole } from '../lib/answer-context.mjs';
import {
  validateModelAnswers,
  buildAnswerPrompt,
  buildAnswerReviewPrompt,
  reviewSupportedAnswers,
} from '../lib/model-answers.mjs';
import { mapRoutineQuestions } from '../lib/daily-policy.mjs';

const resume =
  'I build reusable Python and TypeScript packages for 5 client engagements and mentor junior developers.';
const facts = { fields: {} };
const entry = (extra = {}) => ({
  id: 'delivery',
  kind: 'experience',
  text: 'I deployed a Django application used by legal-aid attorneys.',
  source: 'User interview guide',
  approvedAt: '2026-10-27T00:00:00Z',
  approvedBy: 'user',
  uses: ['application'],
  ...extra,
});
const question = (key, label, extra = {}) => ({
  key,
  label,
  type: 'textarea',
  required: true,
  ...extra,
});

test('prior narrative context requires explicit user provenance and valid scope', () => {
  assert.equal(validateAnswerContext({ version: 1, entries: [entry()] }).entries.length, 1);
  for (const e of [
    entry({ approvedBy: 'model' }),
    entry({ source: '' }),
    entry({ approvedAt: 'unknown' }),
    entry({ kind: 'identity' }),
    entry({ uses: [] }),
  ])
    assert.throws(() => validateAnswerContext({ version: 1, entries: [e] }), /provenance/);
  assert.throws(
    () => validateAnswerContext({ version: 1, entries: [entry(), entry()] }),
    /provenance/,
  );
});

test('employer-specific prior answers cannot reach another employer', () => {
  const context = validateAnswerContext({
    version: 1,
    entries: [entry(), entry({ id: 'acme', company: 'Acme' })],
  });
  assert.equal(contextForRole(context, { company: 'ACME' }).length, 2);
  assert.equal(contextForRole(context, { company: 'Other' }).length, 1);
});

test('the prompt includes private approved context but forbids inventing factual answers', () => {
  const text = buildAnswerPrompt({
    role: { company: 'Example' },
    questions: [],
    facts,
    resumeText: resume,
    answerContext: [entry()],
  });
  assert.match(text, /User-approved prior answer context/);
  assert.match(text, /Never turn missing data into a factual Yes\/No answer/);
  assert.match(text, /Django application/);
});

test('a traceable prior answer and a grounded inference can be proposed', () => {
  const qs = [
    question('why', 'Describe a relevant project'),
    question('exp', 'Describe your engineering experience'),
  ];
  const reply = {
    answers: [
      {
        key: 'why',
        basis: 'prior',
        contextId: 'delivery',
        text: entry().text,
        evidence: entry().text,
      },
      {
        key: 'exp',
        basis: 'inference',
        confidence: 0.95,
        text: 'My reusable Python and TypeScript tooling experience is relevant to platform engineering.',
        evidence: 'I build reusable Python and TypeScript packages',
      },
    ],
  };
  assert.equal(validateModelAnswers(qs, reply, facts, resume, [entry()]).accepted.length, 2);
});

test('unsupported numeric claims and missing or low-confidence evidence are rejected', () => {
  const qs = [question('a', 'Describe your engineering experience')];
  for (const answer of [
    { key: 'a', basis: 'resume', evidence: resume, text: 'I have 15 years of Python experience.' },
    { key: 'a', basis: 'inference', evidence: resume, text: 'I build tooling.', confidence: 0.5 },
    { key: 'a', basis: 'prior', contextId: 'missing', evidence: resume, text: 'I build tooling.' },
  ])
    assert.equal(
      validateModelAnswers(qs, { answers: [answer] }, facts, resume, [entry()]).accepted.length,
      0,
    );
});

test('personal identity, address, education, legal and authorization facts cannot be guessed', () => {
  for (const label of [
    'Your full name',
    'Please provide your full address',
    'What is your highest degree?',
    'What university did you graduate from?',
    'What is your nationality?',
    'Do you need visa sponsorship?',
    'Are you authorized to work in Canada?',
    'Do you hold a security clearance?',
    'What was your previous salary?',
  ]) {
    const q = question('a', label);
    for (const basis of ['routine', 'preference', 'honest_negative', 'inference', 'resume']) {
      const answer = { key: 'a', basis, text: 'No', evidence: resume, confidence: 0.99 };
      assert.equal(
        validateModelAnswers([q], { answers: [answer] }, facts, resume).accepted.length,
        0,
        label + ' ' + basis,
      );
    }
  }
});

test('a genuine quote paired with an unsupported claim must fail the second evidence pass', () => {
  const proposed = [
    {
      key: 'a',
      label: 'Experience',
      basis: 'resume',
      value: 'I led QA at a major bank.',
      evidence: resume,
    },
  ];
  const prompt = buildAnswerReviewPrompt({ answers: proposed, facts, resumeText: resume });
  assert.match(prompt, /EVERY factual claim/);
  assert.equal(
    reviewSupportedAnswers(
      proposed,
      { reviews: [{ key: 'a', supported: false, confidence: 0.99, evidence: resume }] },
      resume,
    ).accepted.length,
    0,
  );
  assert.equal(reviewSupportedAnswers(proposed, { reviews: [] }, resume).accepted.length, 0);
});

test('supported drafts require one high-confidence independent review with source evidence', () => {
  const answers = [{ key: 'a', value: resume, basis: 'resume' }];
  assert.equal(
    reviewSupportedAnswers(
      answers,
      { reviews: [{ key: 'a', supported: true, confidence: 0.95, evidence: resume }] },
      resume,
    ).accepted.length,
    1,
  );
  for (const reviews of [
    [{ key: 'a', supported: true, confidence: 0.5, evidence: resume }],
    [{ key: 'a', supported: true, confidence: 0.99, evidence: 'I have an invented degree.' }],
  ])
    assert.equal(reviewSupportedAnswers(answers, { reviews }, resume).accepted.length, 0);
});

test('synthetic Temporal source controls stay unfillable while an audited key uses truthful Other', () => {
  const role = { company: 'Temporal', url: 'https://jobs.ashbyhq.com/temporal/example' };
  const q = question('unmapped_15', 'How did you hear about Temporal?', {
    type: 'combobox',
    options: ['Other'],
  });
  const plan = mapRoutineQuestions([q], role, facts, {});
  assert.deepEqual(plan.answers, {});
  assert.equal(plan.blocked[0].reason, 'unfillable_control');
  assert.equal(mapRoutineQuestions([{ ...q, required: false }], role, facts, {}).blocked.length, 0);
  assert.equal(
    Object.keys(mapRoutineQuestions([{ ...q, key: 'source' }], role, facts, {}).answers).length,
    1,
  );
  assert.equal(
    validateModelAnswers(
      [q],
      { answers: [{ key: q.key, option: 'Other', basis: 'routine' }] },
      facts,
      resume,
    ).accepted.length,
    0,
  );
});

test('citizenship and authorization word variants cannot evade the factual boundary', () => {
  for (const label of [
    'Citizenship status',
    'Work authorization category',
    'Your sponsorship status',
  ]) {
    const q = question('a', label);
    assert.equal(
      validateModelAnswers(
        [q],
        { answers: [{ key: 'a', basis: 'honest_negative', text: 'No' }] },
        facts,
        resume,
      ).accepted.length,
      0,
    );
  }
});

test('an offered option must match its actual confirmed fact, not merely appear in the form', () => {
  const fs = { fields: { needsSponsorship: { value: false, uses: ['application'] } } };
  const q = question('a', 'Do you need sponsorship?', { type: 'radio', options: ['Yes', 'No'] });
  const reply = (option) => ({
    answers: [{ key: 'a', basis: 'fact', factKey: 'needsSponsorship', option }],
  });
  assert.equal(validateModelAnswers([q], reply('Yes'), fs, resume).accepted.length, 0);
  assert.equal(validateModelAnswers([q], reply('No'), fs, resume).accepted.length, 1);
});
