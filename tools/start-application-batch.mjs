#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { loadRuntime, readJson, atomicJson, digest } from '../lib/runtime.mjs';
import { verifyStandingPolicy, dailyUsage } from '../lib/daily-policy.mjs';
import { EventStore } from '../lib/event-store.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1];
};
const count = Number(option('--count'));
const cli = option('--cli');
const instructionPath = option('--instruction-file');
if (!Number.isInteger(count) || count < 1 || count > 50 || !cli || !instructionPath)
  throw Error(
    'Use --count 1..50 --cli <openclaw.mjs> --instruction-file <explicit-user-request.txt>',
  );
const instruction = readFileSync(instructionPath, 'utf8').trim();
if (!instruction) throw Error('An explicit user instruction is required');
const runtime = loadRuntime();
const standingPath = join(runtime.root, 'autonomous-policy.json');
const standing = verifyStandingPolicy(runtime, standingPath);
const store = new EventStore(runtime.config.paths.database);
let initial;
try {
  initial = dailyUsage(store, standing.timezone);
} finally {
  store.close();
}
const id = randomUUID();
const directory = join(runtime.root, 'batches', initial.day, id);
const path = join(directory, 'policy.json');
const policy = {
  ...readJson(standingPath),
  campaignDate: initial.day,
  dailyLimit: initial.occupied + count,
  approvedAt: new Date().toISOString(),
  approvedBy: 'direct_user_instruction',
  instruction,
  batch: { id, maxAdditionalDeliveries: count, initial, standingPolicyHash: standing.hash },
};
atomicJson(path, policy);
verifyStandingPolicy(runtime, path);
const argv = [
  realpathSync(process.execPath),
  join(runtime.sourceRoot, 'tools', 'daily-run.mjs'),
  '--config',
  runtime.configPath,
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
  schedule: result,
});
console.log(
  JSON.stringify({ id, directory, count, initial, scheduleId: result.id ?? result.job?.id }),
);
