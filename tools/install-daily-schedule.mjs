#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { loadRuntime,atomicJson,readJson,digest } from '../lib/runtime.mjs';
const args=process.argv.slice(2),at=k=>{const i=args.indexOf(k);return i<0?null:args[i+1];};
const runtime=loadRuntime(),cli=at('--cli');if(!cli)throw Error('Supply the installed OpenClaw CLI entrypoint with --cli');
const name='job-search-daily-ten',schedule='30 12,16 * * *';
const policyPath=join(runtime.root,'autonomous-policy.json');
const argv=[process.execPath,join(runtime.sourceRoot,'tools','daily-run.mjs'),'--config',runtime.configPath,'--runtime',runtime.root,'--policy',policyPath,'--policy-hash',digest(readJson(policyPath))];
const call=a=>JSON.parse(execFileSync(process.execPath,[cli,...a],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024}));
const before=call(['cron','list','--all','--json']);
const matches=before.jobs.filter(j=>j.name===name||j.name==='newark-sanjose-chicago-3-2-2'||j.name==='job-search-fullstack-research');
if(matches.length>1)throw Error('Multiple legacy job-search schedules; reconcile before changing them');
const flags=['--name',name,'--description','Autonomous job applications: target ten per New York day, confirmed facts, dedupe and receipts; catch up at 16:30.','--command-argv',JSON.stringify(argv),'--command-cwd',runtime.sourceRoot,'--cron',schedule,'--tz',runtime.config.timezone,'--exact','--timeout-seconds','5400','--no-output-timeout-seconds','1800','--output-max-bytes','65536','--no-deliver'];
if(!args.includes('--apply')){console.log(JSON.stringify({action:'preview',replaces:matches.map(j=>j.id),argv,schedule,timezone:runtime.config.timezone},null,2));process.exit(0);}
atomicJson(join(runtime.root,'autonomous-schedule-before.json'),before);
// Replace the one legacy job; never leave research and submission schedules competing.
const changed=matches.length?call(['cron','edit',matches[0].id,...flags,'--enable']):call(['cron','add',...flags,'--json']);
const after=call(['cron','list','--all','--json']);const jobs=after.jobs.filter(j=>j.name===name);
if(jobs.length!==1||!jobs[0].enabled||jobs[0].schedule?.expr!==schedule||jobs[0].schedule?.tz!==runtime.config.timezone||jobs[0].payload?.kind!=='command'||JSON.stringify(jobs[0].payload.argv)!==JSON.stringify(argv))throw Error('Daily schedule readback differs from the intended command');
atomicJson(join(runtime.root,'autonomous-schedule.json'),jobs[0]);console.log(JSON.stringify({ok:true,id:jobs[0].id,schedule,timezone:runtime.config.timezone,kind:jobs[0].payload.kind}));
