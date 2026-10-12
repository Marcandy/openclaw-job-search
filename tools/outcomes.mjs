#!/usr/bin/env node
import { loadRuntime,readJson } from '../lib/runtime.mjs';
import { EventStore } from '../lib/event-store.mjs';
import { ingestOutcomes,funnel } from '../lib/outcomes.mjs';
import { readGmail } from '../lib/gmail-reader.mjs';
const [action,path]=process.argv.slice(2);const r=loadRuntime();const s=new EventStore(r.config.paths.database);
try{
  let result;
  if(action==='import')result=ingestOutcomes(s,readJson(path).messages);
  else if(action==='gmail') {const inbox=await readGmail({token:process.env.GMAIL_ACCESS_TOKEN,labelId:process.env.GMAIL_JOB_LABEL});result={outcomes:ingestOutcomes(s,inbox.messages),nextPageToken:inbox.nextPageToken};}
  else if(action==='funnel')result=funnel(s,{minAgeDays:Number(path??7)});
  else throw new Error('Use import <messages.json>, gmail, or funnel [minimum-cohort-age-days]');
  console.log(JSON.stringify(result,null,2));
}finally{s.close();}
