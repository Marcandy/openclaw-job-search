import test from 'node:test';
import assert from 'node:assert/strict';
import { validateData } from '../lib/schemas.mjs';
import { answerQuestions } from '../lib/facts-and-blockers.mjs';
test('candidate boundary rejects invented score ranges and malformed values',()=>{
  const c={company:'Acme',title:'Engineer',cityId:'chicago',location:'Chicago',url:'https://example.com/job/1'};
  assert.throws(()=>validateData('candidate',{...c,fitScore:999}),/schema/);
  assert.throws(()=>validateData('candidate',{...c,salaryMax:'nan'}),/schema/);
  assert.throws(()=>validateData('config',{cities:[]}),/schema/);
});
test('job instructions cannot approve an unknown school or new recording consent',()=>{
  const result=answerQuestions([{key:'school',required:true},{key:'record',kind:'consent',required:true}],{company:'Acme',answers:{school:'fake',record:'authorization'}},{version:'v1',fields:{authorization:{value:true,source:'user',confirmedAt:'2026-10-12',uses:['application']}}});
  assert.equal(result.blocked.length,2);
});
