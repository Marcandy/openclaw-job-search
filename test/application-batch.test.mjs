import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { EventStore, applicationId } from '../lib/event-store.mjs';
import { dailyUsage, belowCompanyCap, verifyStandingPolicy } from '../lib/daily-policy.mjs';
import { digest, fileDigest, atomicJson } from '../lib/runtime.mjs';
import {
  remainingBatchCount,
  applyBatchOverrides,
  scopedBatchCities,
  readCompletedReceipts,
  importCompletedReceipts,
} from '../lib/application-batch.mjs';

const now = new Date('2026-10-28T01:00:00Z'),
  timezone = 'America/New_York';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const url = (n) =>
  `https://jobs.ashbyhq.com/example/00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'batch-receipts-'));
  const image = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(200)]);
  writeFileSync(join(root, 'proof.png'), image);
  const packet = {
    version: 1,
    receipts: Array.from({ length: 7 }, (_, n) => ({
      company: n < 2 ? 'Example' : `Company ${n}`,
      title: 'Software Engineer',
      location: 'Philadelphia',
      url: url(n),
      resume: 'approved.pdf',
      receipt: {
        url: url(n) + '/application',
        text: 'Your application was successfully submitted.',
        observedAt: now.toISOString(),
        screenshot: 'proof.png',
        screenshotSha256: hash(image),
      },
    })),
  };
  const path = join(root, 'receipts.json');
  const save = () => writeFileSync(path, JSON.stringify(packet));
  save();
  return { root, path, packet, save, close: () => rmSync(root, { recursive: true, force: true }) };
};

test('fifteen total minus seven receipts means eight additional, not fifteen more', () => {
  assert.equal(remainingBatchCount({ targetTotal: '15', completed: 7 }), 8);
  assert.equal(remainingBatchCount({ count: '15', completed: 7 }), 15);
  assert.equal(remainingBatchCount({ targetTotal: 7, completed: 7 }), 0);
  for (const arg of [
    {},
    { count: 8, targetTotal: 15 },
    { targetTotal: 6, completed: 7 },
    { count: 0 },
    { targetTotal: 'fifteen' },
  ])
    assert.throws(() => remainingBatchCount(arg));
});

test('seven-day and three-company overrides are isolated and do not reapply stale profiles', () => {
  const original = {
    cities: [{ id: 'chicago' }, { id: 'philadelphia' }, { id: 'atlanta' }],
    sourceFilter: { maxPostingAgeDays: 5, allowVerifiedActiveOlderPostings: true },
    autonomous: { maxApplicationsPerCompanyPerDay: 2 },
    profiles: { fullstack: { sourceFilter: { maxPostingAgeDays: 5 } } },
  };
  const copy = structuredClone(original);
  const batch = applyBatchOverrides(original, {
    maxPostingAgeDays: 7,
    maxPerCompany: 3,
    cities: ['chicago', 'philadelphia'],
  });
  assert.equal(batch.sourceFilter.maxPostingAgeDays, 7);
  assert.equal(batch.sourceFilter.allowVerifiedActiveOlderPostings, false);
  assert.equal(batch.autonomous.maxApplicationsPerCompanyPerDay, 3);
  assert.equal(batch.profiles, undefined);
  assert.deepEqual(
    batch.cities.map((c) => c.id),
    ['chicago', 'philadelphia'],
  );
  assert.deepEqual(original, copy);
  assert.throws(() => applyBatchOverrides(original, { maxPostingAgeDays: -1 }));
  assert.throws(() => applyBatchOverrides(original, { maxPerCompany: 0 }));
});

test('batch cities must be a subset of previously authorized cities', () => {
  assert.deepEqual(scopedBatchCities(['chicago', 'philadelphia'], 'philadelphia,chicago'), [
    'philadelphia',
    'chicago',
  ]);
  assert.throws(() => scopedBatchCities(['chicago'], 'new-york'), /subset/);
});

test('seven receipts reconcile once, count toward daily/company caps and suppress retries', () => {
  const f = fixture(),
    store = new EventStore(':memory:');
  try {
    const rows = readCompletedReceipts(f.path, { timezone, now });
    assert.equal(importCompletedReceipts(store, rows, fileDigest(f.path)), 7);
    assert.equal(importCompletedReceipts(store, rows, fileDigest(f.path)), 0);
    assert.deepEqual(dailyUsage(store, timezone, now), {
      day: '2026-10-27',
      confirmed: 7,
      occupied: 7,
      uncertain: 0,
    });
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM events WHERE kind='submitted'").get().n,
      7,
    );
    const below = belowCompanyCap(store, timezone, 3, now);
    assert.equal(below({ company: 'Example' }), true);
    assert.equal(belowCompanyCap(store, timezone, 2, now)({ company: 'Example' }), false);
    const run = store.startRun();
    assert.throws(() => store.claim(run, { url: url(0) }, 'manifest'), /already submitted/);
    store.finishRun(run, 'test');
  } finally {
    store.close();
    f.close();
  }
});

test('wrong origin, job identity, dates, acceptance, evidence or duplicate records fail before DB import', () => {
  const changes = [
    (p) => {
      p.receipts[0].receipt.url = 'http://jobs.ashbyhq.com/example/a';
    },
    (p) => {
      p.receipts[0].receipt.url = 'https://indeed.com/viewjob?jk=1';
    },
    (p) => {
      p.receipts[0].receipt.url = url(30) + '/application';
    },
    (p) => {
      p.receipts[0].receipt.observedAt = 'not-a-date';
    },
    (p) => {
      p.receipts[0].receipt.observedAt = '2026-10-26T12:00:00Z';
    },
    (p) => {
      p.receipts[0].receipt.observedAt = '2026-10-29T12:00:00Z';
    },
    (p) => {
      p.receipts[0].receipt.text = 'Fetching application form';
    },
    (p) => {
      p.receipts[0].receipt.text = 'Your application was not submitted. Submission failed.';
    },
    (p) => {
      p.receipts[0].receipt.screenshotSha256 = 'a'.repeat(64);
    },
    (p) => {
      p.receipts[0].receipt.screenshot = 'missing.png';
    },
    (p) => {
      p.receipts.push(structuredClone(p.receipts[0]));
    },
  ];
  for (const change of changes) {
    const f = fixture();
    try {
      change(f.packet);
      f.save();
      assert.throws(() => readCompletedReceipts(f.path, { timezone, now }));
    } finally {
      f.close();
    }
  }
});

test('receipt application/confirmation paths match the exact underlying ATS job', () => {
  const f = fixture();
  try {
    f.packet.receipts = [
      {
        ...f.packet.receipts[0],
        url: 'https://job-boards.greenhouse.io/example/jobs/123',
        receipt: {
          ...f.packet.receipts[0].receipt,
          url: 'https://boards.greenhouse.io/example/jobs/123/confirmation',
        },
      },
    ];
    f.save();
    assert.equal(readCompletedReceipts(f.path, { timezone, now }).length, 1);
    f.packet.receipts[0].receipt.url = 'https://boards.greenhouse.io/example/jobs/456/confirmation';
    f.save();
    assert.throws(() => readCompletedReceipts(f.path, { timezone, now }), /differs/);
  } finally {
    f.close();
  }
});

test('manual receipt import respects another live worker and never recovers it automatically', () => {
  const f = fixture(),
    store = new EventStore(':memory:');
  try {
    const run = store.startRun();
    const rows = readCompletedReceipts(f.path, { timezone, now });
    assert.throws(
      () => importCompletedReceipts(store, rows, fileDigest(f.path)),
      /active or crashed/,
    );
    assert.equal(store.status().applications.length, 0);
    store.finishRun(run, 'test');
  } finally {
    store.close();
    f.close();
  }
});

test('pending or uncertain receipt collisions are refused without changing their original records', () => {
  for (const state of ['claimed', 'filling', 'submit_started', 'uncertain']) {
    const f = fixture(),
      store = new EventStore(':memory:');
    try {
      const run = store.startRun(),
        id = store.claim(
          run,
          { url: url(0), company: 'Example', title: 'Original title' },
          'original-manifest',
        );
      if (state !== 'claimed') store.transition(id, run, 'filling');
      if (['submit_started', 'uncertain'].includes(state))
        store.transition(id, run, 'submit_started');
      if (state === 'uncertain')
        store.transition(id, run, 'uncertain', { reason: 'unknown delivery' });
      store.db.prepare("UPDATE runs SET state='finished' WHERE id=?").run(run);
      const before = store.get(id),
        rows = readCompletedReceipts(f.path, { timezone, now });
      assert.throws(() => importCompletedReceipts(store, rows, fileDigest(f.path)), /conflicts/);
      assert.deepEqual(store.get(id), before);
      assert.equal(store.status().applications.length, 1);
    } finally {
      store.close();
      f.close();
    }
  }
});

test('generic CSV imports cannot promote pending or uncertain deliveries into submitted', () => {
  const store = new EventStore(':memory:');
  try {
    const run = store.startRun(),
      id = store.claim(run, { url: url(0), title: 'Original' }, 'manifest');
    const before = store.get(id);
    assert.throws(
      () =>
        store.importLedger([{ url: url(0), timestamp: now.toISOString(), status: 'submitted' }]),
      /cannot overwrite/,
    );
    assert.deepEqual(store.get(id), before);
    store.recoverRun(run, 'test cleanup');
  } finally {
    store.close();
  }
});

test('pinned prior-answer context and batch limits fail validation if changed', () => {
  const f = fixture();
  try {
    const input = join(f.root, 'input.json');
    writeFileSync(input, '{}');
    const context = join(f.root, 'context.json');
    writeFileSync(context, '{"version":1,"entries":[]}');
    const h = fileDigest(input),
      runtime = {
        configDigest: 'config',
        sourceDigest: 'source',
        config: {
          timezone,
          sourceFilter: { maxPostingAgeDays: 7 },
          autonomous: { maxApplicationsPerCompanyPerDay: 3 },
          paths: { facts: input, boards: input },
        },
      };
    const policy = {
      enabled: true,
      dailyLimit: 15,
      timezone,
      approvedBy: 'user',
      approvedAt: now.toISOString(),
      instruction: 'complete this batch',
      campaignDate: '2026-10-27',
      configDigest: 'config',
      sourceDigest: 'source',
      factsHash: h,
      boardsHash: h,
      seedProfilesPath: input,
      seedProfilesHash: h,
      resumes: { [input]: h },
      allowedCityIds: ['philadelphia'],
      answerContextPath: context,
      answerContextHash: fileDigest(context),
      batch: {
        id: 'batch',
        targetTotal: 15,
        completedReceiptCount: 7,
        maxAdditionalDeliveries: 8,
        initial: { occupied: 7 },
        overrides: { maxPostingAgeDays: 7, maxPerCompany: 3 },
        cities: ['philadelphia'],
        instructionDigest: digest('complete this batch'),
      },
    };
    policy.batch.scopeDigest = digest({ campaignDate: policy.campaignDate, ...policy.batch });
    const path = join(f.root, 'policy.json');
    atomicJson(path, policy);
    assert.equal(verifyStandingPolicy(runtime, path, { now }).dailyLimit, 15);
    atomicJson(path, { ...policy, dailyLimit: 16 });
    assert.throws(() => verifyStandingPolicy(runtime, path, { now }), /integrity/);
    atomicJson(path, policy);
    writeFileSync(context, '{"version":1,"entries":[1]}');
    assert.throws(() => verifyStandingPolicy(runtime, path, { now }), /context changed/);
  } finally {
    f.close();
  }
});
