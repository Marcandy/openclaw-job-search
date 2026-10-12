import test from 'node:test';
import assert from 'node:assert/strict';
import { EventStore } from '../lib/event-store.mjs';
import { cacheCompanyEvidence,cachedCompanyEvidence,evidenceIsCurrent } from '../lib/company-evidence.mjs';
import { checkCompanyProfile } from '../lib/role-filter.mjs';
import { loadRuntime } from '../lib/runtime.mjs';
test('company cache requires a current dated excerpt that the public source actually contains',async()=>{
  const s=new EventStore(':memory:');const signal={type:'recent_funding_round',sourceUrl:'https://example.com/funding',asOf:'2026-10-01',excerpt:'Acme raised a new funding round in October.'};
  try{
    const now=new Date('2026-10-12');await cacheCompanyEvidence(s,{company:'Acme',thrivingSignals:[signal]},{now,fetcher:async()=>({ok:true,text:async()=>'<p>'+signal.excerpt+'</p>'})});
    assert.ok(cachedCompanyEvidence(s,'Acme',{now}));assert.equal(cachedCompanyEvidence(s,'Acme',{now:new Date('2027-01-01')}),null);
    await assert.rejects(()=>cacheCompanyEvidence(s,{company:'Acme',thrivingSignals:[signal]},{now,fetcher:async()=>({ok:true,text:async()=>'<p>Nothing supports this claim</p>'})}),/corroborate/);
    assert.equal(evidenceIsCurrent({...signal,asOf:'2020-01-01'},24,now),false);
  }finally{s.close();}
});
test('company gates reject stale signals and apply headcount intervals without inventing a point estimate',()=>{
  const {config}=loadRuntime();const city=config.cities.find(c=>c.id==='chicago');
  const profile={headcountMin:50,headcountMax:150,headcountSourceUrl:'https://example.com/about',isHouseholdName:false,thrivingSignals:[{type:'recent_funding_round',detail:'New funding',sourceUrl:'https://example.com/funding',asOf:new Date().toISOString().slice(0,10)}]};
  assert.equal(checkCompanyProfile({company:'Acme',companyProfile:profile},config,city).primaryEligible,true);
  assert.equal(checkCompanyProfile({company:'Acme',companyProfile:{...profile,thrivingSignals:[{...profile.thrivingSignals[0],asOf:'2020-01-01'}]}},config,city).ok,false);
});
