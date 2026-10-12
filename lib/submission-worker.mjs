import { canonicalizeUrl } from './role-filter.mjs';
import { verifyManifestAuthorization,manifestHash } from './submission-manifest.mjs';
import { readJson, digest } from './runtime.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { answerQuestions } from './facts-and-blockers.mjs';
export async function runSubmission(state,runtime,store,driver,{submit=false,retryBlocked=false,retryReason,refreshAuthorization=()=>({state,runtime})}={}) {
  const manifest=verifyManifestAuthorization(state,runtime);const hash=manifestHash(manifest);
  const runId=store.startRun();const results=[];
  const reverify=()=>{const current=refreshAuthorization();const live=verifyManifestAuthorization(current.state,current.runtime);if(manifestHash(live)!==hash)throw new Error('Authorization changed during run');};
  const timer=setInterval(()=>{try{store.heartbeat(runId);}catch{}},10000);timer.unref();
  try {
    for(const destination of manifest.destinations) {
      const count=store.db.prepare("SELECT count(*) AS n FROM applications WHERE manifest_hash=? AND state!='blocked'").get(hash).n;
      if(count>=manifest.maxSubmissions)break;
      let id,submitStarted=false;
      const started=performance.now();
      try {
        reverify();
        id=store.claim(runId,{...destination,profile:manifest.profile},hash,{retryBlocked,retryReason});
        const form=await driver.preflight(destination);
        if(canonicalizeUrl(form.url)!==destination.url)throw new Error('Destination redirect is outside approved posting');
        if(form.title?.toLowerCase().trim()!==destination.title.toLowerCase().trim())throw new Error('Posting title changed');
        if(form.blockedReason)throw new Error(form.blockedReason);
        const plan=answerQuestions(form.questions,destination,readJson(manifest.factsPath));
        if(plan.blocked.length)throw new Error(`Required answer blocked: ${plan.blocked.map(b=>b.key+':'+b.reason).join(', ')}`);
        reverify();
        const resumeBytes=readFileSync(destination.resumePath);
        if(createHash('sha256').update(resumeBytes).digest('hex')!==destination.resumeHash)throw new Error('Resume changed before upload');
        store.transition(id,runId,'filling');
        await driver.fill(destination,plan.answers,resumeBytes);
        // Re-read form after filling: conditional requirements and changed consents
        // cannot silently join the approved payload.
        const final=await driver.inspect(destination);
        const finalPlan=answerQuestions(final.questions,destination,readJson(manifest.factsPath));
        if(final.blockedReason||finalPlan.blocked.length||canonicalizeUrl(final.url)!==destination.url)throw new Error(final.blockedReason??'Form changed or unknown required answers appeared');
        if(digest(plan.answers)!==digest(finalPlan.answers))throw new Error('Answer plan changed while filling');
        if(!submit){store.transition(id,runId,'blocked',{reason:'Dry-run complete; no final submit'});results.push({id,status:'dry_run'});continue;}
        reverify();
        store.transition(id,runId,'submit_started');submitStarted=true;
        const receipt=await driver.submit(destination);
        const original=new URL(destination.url),confirmed=new URL(receipt?.url??destination.url);
        if(confirmed.origin!==original.origin||!receipt?.text||!/thank you for applying|application (?:has been )?received|application submitted/i.test(receipt.text))throw new Error('No observed ATS confirmation');
        store.transition(id,runId,'submitted',{receipt,runId,durationMs:Math.round(performance.now()-started),usage:driver.usage?.()??null});
        results.push({id,status:'submitted'});
      }catch(e){
        if(id){store.transition(id,runId,submitStarted?'uncertain':'blocked',submitStarted?{reason:e.message}:{reason:e.message});}
        results.push({id,status:id?(submitStarted?'uncertain':'blocked'):'skipped',reason:e.message});
        if(submitStarted)break; // Reconcile before another possible transmission.
      }finally{await driver.closePosting?.();}
    }
    store.finishRun(runId,results.some(r=>r.status==='uncertain')?'uncertain result requires reconciliation':'batch completed or exhausted');
    return {runId,results};
  }finally{clearInterval(timer);await driver.close?.();}
}
