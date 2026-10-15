#!/usr/bin/env node
import { chromium } from 'playwright';
import { loadRuntime, readJson } from '../lib/runtime.mjs';
import { EventStore } from '../lib/event-store.mjs';
import { greenhouseDriver } from '../lib/greenhouse-driver.mjs';
import { runSubmission } from '../lib/submission-worker.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { parseCsv } from './ats-stats.mjs';
import { verifyManifestAuthorization } from '../lib/submission-manifest.mjs';
const r = loadRuntime();
const state = readJson(r.config.paths.state);
const store = new EventStore(r.config.paths.database);
try {
  verifyManifestAuthorization(state, r);
  if (existsSync(r.config.paths.ledgerCsv)) {
    const [head, ...rows] = parseCsv(
      readFileSync(r.config.paths.ledgerCsv, 'utf8').replace(/^\uFEFF/, ''),
    );
    store.importLedger(
      rows
        .filter((x) => x.length === head.length)
        .map((row) => Object.fromEntries(head.map((h, i) => [h, row[i]]))),
    );
  }
  const driver = await greenhouseDriver({
    receiptDir: r.config.paths.receipts,
    chromium,
    headless: process.argv.includes('--headless'),
  });
  const retryIndex = process.argv.indexOf('--retry-reason');
  console.log(
    JSON.stringify(
      await runSubmission(state, r, store, driver, {
        submit: process.argv.includes('--submit'),
        retryBlocked: process.argv.includes('--retry-blocked'),
        retryReason: retryIndex < 0 ? undefined : process.argv[retryIndex + 1],
        refreshAuthorization: () => {
          const runtime = loadRuntime();
          return { runtime, state: readJson(runtime.config.paths.state) };
        },
      }),
      null,
      2,
    ),
  );
} finally {
  store.close();
}
