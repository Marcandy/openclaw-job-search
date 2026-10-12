import { readJson, digest, fileDigest } from './runtime.mjs';
import { canonicalizeUrl, campaignToday } from './role-filter.mjs';
import { validateData } from './schemas.mjs';

export function buildManifest(state, runtime, { expiresAt, maxSubmissions, now = new Date() } = {}) {
  if (state.status !== 'awaiting_authorization') throw new Error('Manifest requires a pool awaiting_authorization');
  if (state.campaignDate !== campaignToday(runtime.config, now)) throw new Error('Stale pool; revalidate before preparing a manifest');
  const facts = validateData('facts', readJson(runtime.config.paths.facts));
  const destinations = Object.values(state.pool ?? {}).flatMap(c=>['primary','backup'].flatMap(bucket=>(c[bucket]??[]).map(r=>({
    url:canonicalizeUrl(r.canonicalUrl??r.url),company:r.company,title:r.title,location:r.location??'',source:r.source??'',postingId:r.postingId??canonicalizeUrl(r.url??r.canonicalUrl),bucket,
    resumePath:r.resumePath??runtime.config.resumeRouting?.default??runtime.config.paths.resume,
    resumeHash:fileDigest(r.resumePath??runtime.config.resumeRouting?.default??runtime.config.paths.resume),answers:r.answers??{},
  }))));
  if (new Set(destinations.map(d=>d.url)).size !== destinations.length) throw new Error('Duplicate manifest destinations');
  const limit = maxSubmissions ?? Object.values(state.dailyQuota??{}).reduce((a,b)=>a+b,0);
  const manifest = {schemaVersion:1,campaignDate:state.campaignDate,profile:runtime.profile,configDigest:runtime.configDigest,sourceDigest:runtime.sourceDigest,factsPath:runtime.config.paths.facts,factsHash:fileDigest(runtime.config.paths.facts),factsVersion:facts.version,expiresAt:expiresAt??new Date(now.getTime()+8*3600000).toISOString(),maxSubmissions:Math.min(limit,destinations.length),destinations};
  validateManifest(manifest,runtime,now);
  return manifest;
}
export const manifestHash = m => digest({...m,destinations:[...m.destinations].sort((a,b)=>a.url.localeCompare(b.url))});
export function validateManifest(m, runtime, now = new Date()) {
  validateData('manifest',m);
  const expiry=Date.parse(m.expiresAt);
  if (!Number.isFinite(expiry)||expiry<=now.getTime()||expiry>now.getTime()+24*3600000) throw new Error('Manifest expired or lifetime exceeds 24 hours');
  if (m.profile!==runtime.profile||m.configDigest!==runtime.configDigest) throw new Error('Config or profile changed');
  if (m.sourceDigest!==runtime.sourceDigest)throw new Error('Executable source changed');
  if (m.factsPath!==runtime.config.paths.facts||fileDigest(m.factsPath)!==m.factsHash) throw new Error('Applicant facts changed');
  const facts=validateData('facts',readJson(m.factsPath));
  if(facts.version!==m.factsVersion) throw new Error('Fact version changed');
  const seen=new Set();
  for(const d of m.destinations) {
    if(!/^https:\/\//.test(d.url)||canonicalizeUrl(d.url)!==d.url||seen.has(d.url)) throw new Error('Invalid or duplicate destination');
    seen.add(d.url);
    if(fileDigest(d.resumePath)!==d.resumeHash) throw new Error('Resume changed');
    for(const key of Object.values(d.answers)) {
      const f=facts.fields[key];
      if(!f||f.value==null||!f.uses.includes('application')||!Number.isFinite(Date.parse(f.confirmedAt))) throw new Error(`Unknown or unapproved application fact: ${key}`);
    }
  }
  if(m.maxSubmissions>m.destinations.length) throw new Error('Submission limit exceeds destination count');
  return facts;
}
export function verifyManifestAuthorization(state,runtime,now=new Date()) {
  if(!['authorized','submitting'].includes(state.status)) throw new Error(`state status is "${state.status}", expected "authorized"`);
  const auth=state.authorization;
  if(!auth?.manifestHash||!state.submissionManifest) throw new Error('Legacy URL-only approval cannot submit; prepare and authorize a manifest');
  validateManifest(state.submissionManifest,runtime,now);
  if(manifestHash(state.submissionManifest)!==auth.manifestHash) throw new Error('Manifest changed after authorization');
  const poolUrls=Object.values(state.pool??{}).flatMap(c=>[...(c.primary??[]),...(c.backup??[])]).map(r=>canonicalizeUrl(r.canonicalUrl??r.url)).sort();
  const urls=state.submissionManifest.destinations.map(d=>d.url).sort();
  if(digest(poolUrls)!==digest(urls)) throw new Error('Pool destinations changed after authorization');
  if(!auth.authorizedBy||!Number.isFinite(Date.parse(auth.authorizedAt))) throw new Error('Missing authorization identity');
  return state.submissionManifest;
}
