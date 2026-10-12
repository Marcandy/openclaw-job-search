import { digest } from './runtime.mjs';
import { canonicalizeUrl, checkTitle, checkLocation, checkRoleRelevance } from './role-filter.mjs';
const text = value => String(value??'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
export function boardEndpoint(board, offset=0) {
  if(!['greenhouse','lever','ashby'].includes(board.platform)||!/^[-a-zA-Z0-9_]+$/.test(board.slug)||!board.company) throw new Error('Invalid employer board registry entry');
  if(board.platform==='greenhouse') return `https://boards-api.greenhouse.io/v1/boards/${board.slug}/jobs?content=true`;
  if(board.platform==='lever') return `https://api.lever.co/v0/postings/${board.slug}?mode=json&limit=100&skip=${offset}`;
  return `https://api.ashbyhq.com/posting-api/job-board/${board.slug}?includeCompensation=true`;
}
export function normalizePosting(board,job) {
  const url=job.absolute_url??job.hostedUrl??job.jobUrl;
  if(!job.id||!url) throw new Error('Posting missing ID or official URL');
  const locations=board.platform==='greenhouse'?[job.location?.name]:board.platform==='lever'?[job.categories?.location,...(job.categories?.allLocations??[])]:[job.location,...(job.secondaryLocations??[]).map(x=>x.location)];
  return {postingId:`${board.platform}:${board.slug}:${job.id}`,company:board.company,title:job.title??job.text,locations:[...new Set(locations.filter(Boolean))],url:canonicalizeUrl(url),employerUrl:canonicalizeUrl(url),source:board.platform,description:text(job.content??job.descriptionPlain??job.descriptionHtml??job.description),postedDate:job.publishedAt??(job.createdAt?new Date(job.createdAt).toISOString():null),employmentType:job.employmentType??job.categories?.commitment??null,compensation:job.compensation??null};
}
export async function fetchBoard(board, fetcher=fetch) {
  const jobs=[];
  for(let offset=0;offset<=9900;offset+=100) {
    const response=await fetcher(boardEndpoint(board,offset),{redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok) throw new Error(`Board ${board.platform}/${board.slug} HTTP ${response.status}`);
    const data=await response.json();const page=board.platform==='lever'?data:data.jobs;
    if(!Array.isArray(page)) throw new Error('Unexpected board response; previous cache remains intact');
    jobs.push(...page.map(j=>normalizePosting(board,j)));
    if(board.platform!=='lever'||page.length<100) return jobs;
  }
  throw new Error('Board pagination exceeded bounded budget; cache is unchanged');
}
export function cacheBoard(store,board,jobs,at=new Date().toISOString()) {
  const key=`${board.platform}:${board.slug}`;
  store.db.exec('CREATE TABLE IF NOT EXISTS postings(id TEXT PRIMARY KEY,board TEXT NOT NULL,hash TEXT NOT NULL,data_json TEXT NOT NULL,first_seen TEXT NOT NULL,last_seen TEXT NOT NULL,active INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS company_evidence(company TEXT PRIMARY KEY,data_json TEXT NOT NULL,checked_at TEXT NOT NULL)');
  return store.transaction(()=>{
    const changed=[];
    store.db.prepare('UPDATE postings SET active=0 WHERE board=?').run(key);
    for(const job of jobs) {
      const hash=digest(job);const old=store.db.prepare('SELECT * FROM postings WHERE id=?').get(job.postingId);
      if(!old||old.hash!==hash) changed.push({...job,change:old?'changed':'new'});
      store.db.prepare('INSERT INTO postings VALUES (?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,data_json=excluded.data_json,last_seen=excluded.last_seen,active=1').run(job.postingId,key,hash,JSON.stringify(job),old?.first_seen??at,at);
    }
    return {changed,total:jobs.length};
  });
}
export function triagePostings(jobs,config,at=new Date()) {
  const cities=Object.fromEntries(config.cities.map(c=>[c.id,{leads:[]}])) ;
  for(const job of jobs) {
    if(!checkTitle(job.title,config).ok||!checkRoleRelevance(job,config).ok) continue;
    for(const city of config.cities) {
      const location=job.locations.find(l=>checkLocation({location:l},city).ok);
      if(location) cities[city.id].leads.push({...job,cityId:city.id,location,observedAt:at.toISOString()});
    }
  }
  return {generatedAt:at.toISOString(),cities};
}
