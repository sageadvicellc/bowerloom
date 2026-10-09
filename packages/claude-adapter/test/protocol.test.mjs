import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateResponseEvidence } from '../../../dist/packages/claude-adapter/src/protocol.js';
import { ROUTES } from '../../../dist/packages/claude-adapter/src/policy.js';
// Synthetic normalized evidence, NOT a recorded Claude wire response or an effective-route receipt.
const H='a'.repeat(64);
const fixture=(r=ROUTES[0])=>({format:'bowerloom/claude-response-evidence/v1',requestedRoute:r,requestRevision:H,responseEvidenceSha256:H,localSelection:{model:'claude-sonnet-5-5',effort:r.split(':').at(-1),nativeVersion:'2.1.292'},effective:{model:'claude-sonnet-5-5',effort:r.split(':').at(-1),evidenceSha256:H},toolEvents:[],output:r===ROUTES[0]?{kind:'delegation-proposal',workerRole:'knowledge-library',task:'Review synthetic notes',requestedOutput:'Brief summary'}:{kind:'worker-result',parentOutputRevision:H,text:'Synthetic summary'}});
const expected=v=>({requestedRoute:v.requestedRoute,requestRevision:H,responseEvidenceSha256:H,parentOutputRevision:v.requestedRoute===ROUTES[0]?null:H});
test('normalized route agreement returns only inert proposal/result and retains charges',()=>{
  for(const r of ROUTES){const v=fixture(r),out=validateResponseEvidence(v,expected(v));assert.equal(out.effectiveRoute,r);assert.equal(out.executionAuthorized,false);assert.equal(out.qualificationAccepted,false);assert.equal(out.retainedChargesMustRemain,true);assert.equal(out.originIndependentlyVerified,false);v.output.kind='mutated';assert.notEqual(out.evidence.output.kind,'mutated');}
});
test('requested, local and effective routes remain distinct; aliases/fallback/coercion refuse',()=>{
  for(const mutate of [v=>v.localSelection.model='sonnet',v=>v.localSelection.effort='low',v=>v.localSelection.nativeVersion='2.1.288']){const v=fixture();mutate(v);assert.throws(()=>validateResponseEvidence(v,expected(v)),{code:'LOCAL_SELECTION'});}
  for(const mutate of [v=>v.effective=null,v=>v.effective.effort=null,v=>delete v.effective.evidenceSha256]){const v=fixture();mutate(v);assert.throws(()=>validateResponseEvidence(v,expected(v)),{code:'EFFECTIVE_EVIDENCE'});}
  for(const mutate of [v=>v.effective.model='claude-opus-5-5',v=>v.effective.effort='medium',v=>v.effective.model='sonnet']){const v=fixture();mutate(v);assert.throws(()=>validateResponseEvidence(v,expected(v)),{code:'RESPONSE_ROUTE'});}
});
test('no tools, recursive delegation, changed binding, uncontrolled outputs or JSON decoder acceptance',()=>{
  for(const mutate of [v=>v.toolEvents.push({type:'tool'}),v=>v.output.workerRole='tech-lead',v=>v.output.argv=['claude'],v=>v.output.task='é'.repeat(2049),v=>v.responseEvidenceSha256='b'.repeat(64),v=>v.requestRevision='b'.repeat(64)]){const v=fixture();mutate(v);assert.throws(()=>validateResponseEvidence(v,expected(v)));}
  const v=fixture();assert.throws(()=>validateResponseEvidence('{"format":"x","format":"y"}',expected(v)),{code:'INPUT'});
  let hits=0;Object.defineProperty(v,'effective',{enumerable:true,get(){hits++;throw Error('SECRET');}});assert.throws(()=>validateResponseEvidence(v,{requestedRoute:ROUTES[0],requestRevision:H,responseEvidenceSha256:H,parentOutputRevision:null}),{code:'INPUT',message:'CLAUDE_INPUT'});assert.equal(hits,0);
});

test('worker lineage is pinned to the approved parent output',()=>{const v=fixture(ROUTES[1]);v.output.parentOutputRevision='b'.repeat(64);assert.throws(()=>validateResponseEvidence(v,expected(v)),{code:'PROTOCOL'});});
