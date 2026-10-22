import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  codeWaitBudget,
  manualCompletionEntry,
  recordManualCompletion,
} from '../lib/code-handoff.mjs';

const MIN = 60000;

test('waits are capped per posting, per run and by the run deadline', () => {
  let clock = 0;
  const budget = codeWaitBudget({
    maxWaitMs: 10 * MIN,
    totalWaitMs: 15 * MIN,
    deadline: () => 60 * MIN,
    now: () => clock,
  });
  assert.equal(budget.waitMs(), 10 * MIN);
  budget.waited({ waitedMs: 8 * MIN, entered: true });
  assert.equal(budget.waitMs(), 7 * MIN);
  clock = 58 * MIN;
  assert.equal(budget.waitMs(), 2 * MIN);
  clock = 59.5 * MIN;
  assert.equal(budget.waitMs(), 0, 'under a minute left is not worth an alert');
});

test('after one missed code the applicant is taken to be away', () => {
  const budget = codeWaitBudget({
    maxWaitMs: 10 * MIN,
    totalWaitMs: 20 * MIN,
    deadline: () => Infinity,
  });
  budget.waited({ waitedMs: 10 * MIN, entered: false });
  assert.equal(budget.waitMs(), 0);
});

test('the manual list keeps one entry per posting with the filled answers', () => {
  const root = mkdtempSync(join(tmpdir(), 'manual-'));
  try {
    const role = {
      company: 'Hark',
      title: 'Software Engineer',
      location: 'Chicago, IL',
      url: 'https://job-boards.greenhouse.io/hark/jobs/1',
      resumePath: 'C:\\runtime\\resumes\\Resume_General.pdf',
    };
    const questions = [
      { key: 'first_name', label: 'First Name*' },
      { key: 'q1', label: 'Why | Hark?' },
      { key: 'q2', label: 'Unfilled optional' },
    ];
    const first = manualCompletionEntry({
      role,
      questions,
      filled: { first_name: 'Ada', q1: 'Line one\nline two' },
      reason: 'Verification code was not entered within 10 minutes',
      now: new Date('2026-10-22T16:40:00Z'),
    });
    assert.equal(first.resume, 'Resume_General.pdf');
    assert.deepEqual(first.answers, [
      { question: 'First Name', answer: 'Ada' },
      { question: 'Why | Hark?', answer: 'Line one\nline two' },
    ]);
    recordManualCompletion(root, first);
    const readable = recordManualCompletion(root, { ...first, stoppedAt: 'later' });
    const list = JSON.parse(readFileSync(join(root, 'manual-completion.json'), 'utf8'));
    assert.equal(list.length, 1);
    assert.equal(list[0].stoppedAt, 'later');
    const md = readFileSync(readable, 'utf8');
    assert.match(md, /## Hark: Software Engineer/);
    assert.match(md, /\| Why \\\| Hark\? \| Line one line two \|/);
    assert.match(md, /NOT sent/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
