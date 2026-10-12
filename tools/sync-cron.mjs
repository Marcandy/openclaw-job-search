#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadRuntime, readJson, digest } from '../lib/runtime.mjs';
const r = loadRuntime();
const deployment = readJson(join(r.root, 'deployment.json'));
const identity = { sourceRoot: r.sourceRoot, configPath: r.configPath, configDigest: r.configDigest, profile: r.profile };
if (digest(identity) !== digest(deployment.identity)) throw new Error('Deployment drift: run prepare-runtime first');
const name = `job-search-${r.profile}-research`;
const message = `Read ${deployment.researchPrompt} in full and execute public research only. Expected config digest ${r.configDigest}. Never transmit applicant data or submit applications.`;
const args = ['cron', 'add', '--name', name, '--message', message, '--cron', r.config.runtime.schedule, '--tz', r.config.timezone, '--agent', 'main', '--session', 'isolated', '--timeout-seconds', '3600', '--no-deliver'];
if (!process.argv.includes('--apply')) { console.log(JSON.stringify({ action: 'preview', identity, args }, null, 2)); process.exit(0); }
const i = process.argv.indexOf('--cli');
const cli = i >= 0 ? process.argv[i + 1] : process.env.OPENCLAW_CLI ?? join(homedir(), '.openclaw', 'npm', 'node_modules', 'openclaw', 'openclaw.mjs');
if (!existsSync(cli)) throw new Error('Supply --cli with the installed OpenClaw .mjs entrypoint; shell shims are not accepted');
const call = a => execFileSync(process.execPath, [cli, ...a], { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
const listing = JSON.parse(call(['cron', 'list', '--all', '--json']));
if (!Array.isArray(listing.jobs)) throw new Error('Unexpected cron inventory');
const matches = listing.jobs.filter(j => j.name === name);
if (matches.length > 1) throw new Error('Multiple research schedules found; reconcile before sync');
if (matches.length) {
  call(['cron', 'edit', matches[0].id, '--message', message]);
  call(['cron', 'edit', matches[0].id, '--cron', r.config.runtime.schedule, '--tz', r.config.timezone, '--timeout-seconds', '3600', '--no-deliver']);
} else call(args);
const check = JSON.parse(call(['cron', 'list', '--all', '--json'])).jobs.filter(j => j.name === name);
if (check.length !== 1 || check[0].schedule?.expr !== r.config.runtime.schedule || check[0].schedule?.tz !== r.config.timezone || check[0].payload?.message !== message) throw new Error('Schedule readback did not match');
console.log(JSON.stringify({ ok: true, id: check[0].id, identity }));
