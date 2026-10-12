import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntime } from '../lib/runtime.mjs';
import { routeResume } from '../lib/resume-routing.mjs';
import { answerQuestions,activeBlockers } from '../lib/facts-and-blockers.mjs';
const {config}=loadRuntime();
test('required Python beats incidental Java; equal alternatives require review; backend routes separately',()=>{
  assert.equal(routeResume({title:'Python Engineer',description:'Build Python APIs. Java preferred.'},config).ruleId,'python');
  assert.equal(routeResume({title:'Engineer',description:'Proficiency in Java or Python required.'},config).ambiguous,true);
  assert.equal(routeResume({title:'Backend Engineer',description:'Build Python APIs.'},config).ruleId,'python-backend');
});
test('known general facts do not answer employer-specific history or unusual consent',()=>{
  const facts={version:'1',fields:{history:{value:false,source:'user',confirmedAt:'2026-10-12',uses:['application'],employer:'Other Employer'},consent:{value:true,source:'user',confirmedAt:'2026-10-12',uses:['application']}}};
  const result=answerQuestions([{key:'history',required:true,employerSpecific:true},{key:'recording',required:true,kind:'consent'},{key:'school',required:true}],{company:'Acme',answers:{history:'history',recording:'consent'}},facts);
  assert.equal(result.blocked.length,3);assert.deepEqual(result.answers,{});
});
test('resolved citizenship gap does not clear address policy or role-specific blockers at other roles',()=>{
  const role={company:'Acme',url:'https://example.com/job/1'};const b={id:'1',company:'Acme',kind:'fact',scope:'company',factKey:'workAuth',expiresAt:'2027-01-01'};
  const facts={fields:{workAuth:{value:'confirmed',uses:['application']}}};
  assert.equal(activeBlockers([b],role,facts,new Date('2026-10-12')).length,0);
  assert.equal(activeBlockers([{...b,kind:'policy'}],role,facts,new Date('2026-10-12')).length,1);
  assert.equal(activeBlockers([{...b,kind:'policy',scope:'role',url:'https://example.com/job/2'}],role,facts,new Date('2026-10-12')).length,0);
});
