import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntime } from '../lib/runtime.mjs';
import { checkTitle } from '../lib/role-filter.mjs';

test('generic Engineer does not admit mechanical, manufacturing or hardware roles into a software campaign', () => {
  const { config } = loadRuntime();
  for (const title of [
    'Mechanical Engineer',
    'Mechanical Design Engineer',
    'Manufacturing Engineer II',
    'Hardware Test Engineer',
    'Robotics Field Service Engineer',
    'Transmission Portfolio Engineer',
    'ASIC Engineer',
  ]) {
    assert.equal(checkTitle(title, config).ok, false, title);
  }
  for (const title of [
    'Full Stack Software Engineer',
    'Applied AI Engineer',
    'QA Automation Engineer',
  ]) {
    assert.equal(checkTitle(title, config).ok, true, title);
  }
});
