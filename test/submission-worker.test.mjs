import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRuntime } from '../lib/runtime.mjs';
import { EventStore } from '../lib/event-store.mjs';
import { buildManifest,manifestHash } from '../lib/submission-manifest.mjs';
import { campaignToday } from '../lib/role-filter.mjs';
import { runSubmission } from '../lib/submission-worker.mjs';
async function fixture(fn){
  const dir=mkdtempSync(join(tmpdir(),'worker-'));const r=loadRuntime({CAMPAIGN_RUNTIME_ROOT:dir});mkdirSync(join(dir,'resumes'));writeFileSync(r.config.paths.resume,'synthetic resume');writeFileSync(r.config.paths.facts,JSON.stringify({version:'test',fields:{}}));
  const state={status:'awaiting_authorization',campaignDate:campaignToday(r.config),dailyQuota:{Chicago:1},pool:{Chicago:{primary:[{company:'Acme',title:'Engineer',location:'Chicago',source:'greenhouse',url:'https://job-boards.greenhouse.io/acme/jobs/1'}],backup:[]}}};
  state.submissionManifest=buildManifest(state,r);state.status='authorized';state.authorization={manifestHash:manifestHash(state.submissionManifest),authorizedBy:'Test',authorizedAt:new Date().toISOString()};
  const s=new EventStore(join(dir,'campaign.sqlite'));let submits=0;
  const driver={preflight:async d=>({url:d.url,title:d.title,questions:[]}),fill:async()=>{},inspect:async d=>({url:d.url,questions:[]}),submit:async d=>{submits++;return {url:d.url+'/confirmation',text:'Thank you for applying',observedAt:new Date().toISOString()};}};
  try{await fn(r,state,s,driver,()=>submits);}finally{s.close();rmSync(dir,{recursive:true,force:true});}
}
test('successful worker consumes destination once and respects its submission limit',()=>fixture(async(r,state,s,d,count)=>{
  await runSubmission(state,r,s,d,{submit:true});await runSubmission(state,r,s,d,{submit:true});assert.equal(count(),1);assert.equal(s.status().applications[0].state,'submitted');
}));
test('authorized dry run can proceed only through an explicit blocked retry',()=>fixture(async(r,state,s,d,count)=>{
  await runSubmission(state,r,s,d);assert.equal(count(),0);
  await runSubmission(state,r,s,d,{submit:true});assert.equal(count(),0);
  await runSubmission(state,r,s,d,{submit:true,retryBlocked:true,retryReason:'Reviewed dry run; complete the same approved payload'});assert.equal(count(),1);
}));
test('post-submit timeout stays uncertain and is never automatically retried',()=>fixture(async(r,state,s,d,count)=>{
  d.submit=async()=>{throw new Error('Browser disconnected after clicking submit');};
  await runSubmission(state,r,s,d,{submit:true});assert.equal(s.status().applications[0].state,'uncertain');
  await runSubmission(state,r,s,d,{submit:true});assert.equal(s.status().applications[0].state,'uncertain');
}));
test('unknown conditional consent blocks before final submit',()=>fixture(async(r,state,s,d,count)=>{
  d.inspect=async row=>({url:row.url,questions:[{key:'arbitration',kind:'consent',required:true}]});
  await runSubmission(state,r,s,d,{submit:true});assert.equal(count(),0);assert.equal(s.status().applications[0].state,'blocked');
}));
test('changed resume and wrong-employer redirect block before transmission',()=>fixture(async(r,state,s,d,count)=>{
  d.preflight=async row=>({url:'https://evil.example/jobs/1',title:row.title,questions:[]});
  await runSubmission(state,r,s,d,{submit:true});assert.equal(count(),0);
  writeFileSync(r.config.paths.resume,'changed');await assert.rejects(()=>runSubmission(state,r,s,d,{submit:true}),/Resume changed/);
}));
