#!/usr/bin/env node
import { chromium } from 'playwright';
import { inspectPublicApplication } from '../lib/form-inventory.mjs';
import { atomicJson } from '../lib/runtime.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(
    'Usage: node tools/inspect-form.mjs <official-ATS-https-url> [--out <private-runtime-file.json>]\nInspects visible public questions in a fresh browser. Never fills, uploads, or submits.',
  );
} else {
  if (![1, 3].includes(args.length) || (args.length === 3 && args[1] !== '--out'))
    throw new Error('Use --help for usage');
  const report = await inspectPublicApplication(args[0], { chromium });
  if (args[2]) atomicJson(args[2], report);
  console.log(JSON.stringify(report, null, 2));
  if (report.warnings.length) process.exitCode = 2;
}
