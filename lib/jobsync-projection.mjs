import { digest } from './runtime.mjs';
import { canonicalizeUrl } from './role-filter.mjs';
export function projectionJobs(store) {
  const hasPostings=store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='postings'").get();
  const postings=hasPostings?store.db.prepare('SELECT data_json FROM postings').all().map(x=>JSON.parse(x.data_json)):[];
  const skipped=[],jobs=[];
  for(const app of store.db.prepare("SELECT * FROM applications WHERE state='submitted'").all()) {
    const r=JSON.parse(app.record_json);const posting=postings.find(p=>canonicalizeUrl(p.url)===app.url);
    const description=r.description??posting?.description;
    if(!description||description.length<10){skipped.push({id:app.id,reason:'Full posting description unavailable; no fabricated description'});continue;}
    const outcomes=new Set(store.db.prepare('SELECT kind FROM messages WHERE app_id=? AND review=0').all(app.id).map(m=>m.kind));
    const status=outcomes.has('offer')?'offer':outcomes.has('rejected')?'rejected':outcomes.has('interview')?'interview':'applied';
    const args={company:r.company,jobTitle:r.title,jobDescription:description,location:r.location,source:r.source,jobUrl:app.url,applied:true,appliedDate:app.updated_at,status,upsert:true};
    const key=`${app.id}:${digest(args)}`;
    if(!store.db.prepare('SELECT 1 FROM projection WHERE id=?').get(key))jobs.push({key,args});
  }
  return {jobs,skipped};
}
export async function projectJobs(store,callTool,{apply=false}={}) {
  const plan=projectionJobs(store);
  if(!apply)return plan;
  for(const job of plan.jobs){
    const result=await callTool('add_job',job.args);
    const text=(result.content??[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
    if(result.isError||/error:|insufficient scope|validation error|rate limit|not created|failed/i.test(text))throw new Error('JobSync did not confirm projection; retry is an upsert, not another application');
    if(!/created|updated|saved|already exists|no changes|duplicate/i.test(text))throw new Error('Unrecognized JobSync response; projection remains pending');
    store.db.prepare('INSERT INTO projection VALUES(?,?)').run(job.key,new Date().toISOString());
  }
  return {synced:plan.jobs.length,skipped:plan.skipped};
}
