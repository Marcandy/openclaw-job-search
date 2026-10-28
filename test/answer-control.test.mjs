import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liveAtsDriver } from '../lib/live-ats-driver.mjs';

test('synthetic question keys fail before upload, typing, resume hashing or browser access', async () => {
  const receiptDir = mkdtempSync(join(tmpdir(), 'openclaw-answer-control-'));
  const context = {
    newPage() {
      throw Error('Browser access must not occur');
    },
  };
  try {
    const driver = await liveAtsDriver({ context, receiptDir });
    await assert.rejects(
      driver.fill({}, { unmapped_15: 'Other' }, null),
      /Unfillable synthetic control/,
    );
  } finally {
    rmSync(receiptDir, { recursive: true, force: true });
  }
});
