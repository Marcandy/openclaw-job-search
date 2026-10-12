import test from 'node:test';
import assert from 'node:assert/strict';
import { EventStore } from '../lib/event-store.mjs';
import { projectJobs } from '../lib/jobsync-projection.mjs';
test('JobSync projects confirmed applications once, never submits, and does not manufacture descriptions',async()=>{
  const s=new EventStore(':memory:');try{
    s.importLedger([{company:'Acme',title:'Engineer',location:'Chicago',source:'greenhouse',url:'https://example.com/jobs/1',description:'Build production web applications.',status:'submitted',timestamp:'2026-09-01T00:00:00Z'},{company:'Other',title:'Engineer',url:'https://example.com/jobs/2',status:'submitted',timestamp:'2026-09-01T00:00:00Z'}]);
    const calls=[];const send=async(name,args)=>{calls.push({name,args});return {content:[{type:'text',text:'Job created'}]};};
    const preview=await projectJobs(s,send);assert.equal(calls.length,0);assert.equal(preview.skipped.length,1);
    await projectJobs(s,send,{apply:true});await projectJobs(s,send,{apply:true});assert.equal(calls.length,1);assert.equal(calls[0].args.upsert,true);
  }finally{s.close();}
});
