#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { loadRuntime, readJson, atomicJson, digest, fileDigest } from '../lib/runtime.mjs';
import { verifyStandingPolicy, dailyUsage } from '../lib/daily-policy.mjs';
import { EventStore } from '../lib/event-store.mjs';
import {
  remainingBatchCount,
  applyBatchOverrides,
  scopedBatchCities,
  readCompletedReceipts,
  importCompletedReceipts,
} from '../lib/application-batch.mjs';
import { readAnswerContext } from '../lib/answer-context.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  if (index < 0) return null;
  if (args.indexOf(name, index + 1) >= 0 || !args[index + 1] || args[index + 1].startsWith('--'))
    throw Error('Missing or duplicate option ' + name);
  return args[index + 1];
};
const cli = option('--cli'),
  instructionPath = option('--instruction-file');
const targetTotal = option('--target-total'),
  requestedCount = option('--count');
const receiptsPath = option('--completed-receipts'),
  contextPath = option('--answer-context-file');
const maxPostingAgeDays = option('--max-posting-age-days'),
  maxPerCompany = option('--max-per-company');
const cities = option('--cities');
if (!cli || !instructionPath || (targetTotal != null && !receiptsPath))
  throw Error(
    'Use --count 1..50 OR --target-total 1..50 --completed-receipts <packet.json>, plus --cli and --instruction-file',
  );
if (args.includes('--allow-verified-open-older') && maxPostingAgeDays != null)
  throw Error('A bounded posting age cannot be combined with verified-open older postings');
const instruction = readFileSync(instructionPath, 'utf8').trim();
if (!instruction) throw Error('An explicit user instruction is required');
const runtime = loadRuntime();
const standingPath = join(runtime.root, 'autonomous-policy.json');
const standing = verifyStandingPolicy(runtime, standingPath);
const packetHash = receiptsPath ? fileDigest(receiptsPath) : null;
const rows = receiptsPath
  ? readCompletedReceipts(receiptsPath, { timezone: standing.timezone })
  : [];
const count = remainingBatchCount({ count: requestedCount, targetTotal, completed: rows.length });
if (receiptsPath && fileDigest(receiptsPath) !== packetHash)
  throw Error('Receipt packet changed during validation');
const allowedCityIds = scopedBatchCities(standing.allowedCityIds, cities);
const context = contextPath ? readAnswerContext(contextPath) : null;
// Validate every option and private input before writing any campaign event.
const batchConfig = applyBatchOverrides(runtime.config, {
  maxPostingAgeDays,
  maxPerCompany,
  cities: cities ? allowedCityIds : null,
});
if (args.includes('--allow-verified-open-older'))
  batchConfig.sourceFilter.allowVerifiedActiveOlderPostings = true;
if (count === 0) {
  console.log(
    JSON.stringify({
      status: 'already_complete',
      targetTotal: Number(targetTotal),
      completedReceiptCount: rows.length,
      scheduled: false,
    }),
  );
  process.exit(0);
}
const store = new EventStore(runtime.config.paths.database);
let initial, imported;
try {
  imported = importCompletedReceipts(store, rows, packetHash);
  initial = dailyUsage(store, standing.timezone);
} finally {
  store.close();
}
const id = randomUUID(),
  directory = join(runtime.root, 'batches', initial.day, id);
let batchRuntime = runtime;
if (
  args.includes('--allow-verified-open-older') ||
  maxPostingAgeDays != null ||
  maxPerCompany != null ||
  cities
) {
  const configPath = join(directory, 'config.json');
  atomicJson(configPath, batchConfig);
  batchRuntime = loadRuntime({
    ...process.env,
    CAMPAIGN_CONFIG_PATH: configPath,
    CAMPAIGN_RUNTIME_ROOT: runtime.root,
  });
}
let answerContextPath = standing.answerContextPath,
  answerContextHash = standing.answerContextHash;
if (context) {
  answerContextPath = join(directory, 'answer-context.json');
  atomicJson(answerContextPath, context);
  answerContextHash = fileDigest(answerContextPath);
}
const policy = {
  ...readJson(standingPath),
  campaignDate: initial.day,
  // Unrelated daily activity remains accounted for; only this batch's remaining deliveries are added.
  dailyLimit: initial.occupied + count,
  configDigest: batchRuntime.configDigest,
  approvedAt: new Date().toISOString(),
  approvedBy: 'direct_user_instruction',
  instruction,
  allowedCityIds,
  ...(answerContextPath ? { answerContextPath, answerContextHash } : {}),
  batch: {
    id,
    targetTotal: targetTotal == null ? null : Number(targetTotal),
    completedReceiptCount: rows.length,
    receiptPacketHash: packetHash,
    maxAdditionalDeliveries: count,
    initial,
    standingPolicyHash: standing.hash,
    overrides: {
      maxPostingAgeDays: batchRuntime.config.sourceFilter.maxPostingAgeDays,
      maxPerCompany: batchRuntime.config.autonomous?.maxApplicationsPerCompanyPerDay ?? 2,
    },
    cities: allowedCityIds,
    instructionDigest: digest(instruction),
  },
};
policy.batch.scopeDigest = digest({ campaignDate: policy.campaignDate, ...policy.batch });
const path = join(directory, 'policy.json');
atomicJson(path, policy);
verifyStandingPolicy(batchRuntime, path);
const argv = [
  realpathSync(process.execPath),
  join(runtime.sourceRoot, 'tools', 'daily-run.mjs'),
  '--config',
  batchRuntime.configPath,
  '--runtime',
  runtime.root,
  '--policy',
  path,
  '--policy-hash',
  digest(policy),
];
const result = JSON.parse(
  execFileSync(
    process.execPath,
    [
      cli,
      'cron',
      'add',
      '--name',
      `job-search-batch-${id}`,
      '--description',
      `User-requested batch: ${count} additional applications on ${initial.day}`,
      '--command-argv',
      JSON.stringify(argv),
      '--command-cwd',
      runtime.sourceRoot,
      '--at',
      new Date(Date.now() + 15000).toISOString(),
      '--delete-after-run',
      '--no-deliver',
      '--timeout-seconds',
      '5400',
      '--no-output-timeout-seconds',
      '1800',
      '--output-max-bytes',
      '65536',
      '--json',
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 120000 },
  ),
);
atomicJson(join(directory, 'schedule.json'), result);
atomicJson(join(runtime.root, 'latest-requested-batch.json'), {
  id,
  directory,
  policyPath: path,
  count,
  initial,
  targetTotal: policy.batch.targetTotal,
  completedReceiptCount: rows.length,
  imported,
  schedule: result,
});
console.log(
  JSON.stringify({
    id,
    directory,
    count,
    initial,
    imported,
    targetTotal: policy.batch.targetTotal,
    scheduleId: result.id ?? result.job?.id,
  }),
);
