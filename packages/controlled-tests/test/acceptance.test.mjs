import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture,manifest,report,canonicalJson,digest,Executor,testOperationId,RegisteredTestAcceptance,identity } from './fixtures.mjs';
import { validateRegisteredManifest,validateTestManifestPlan,TestError } from '../../../dist/packages/controlled-tests/src/index.js';
const key=f=>testOperationId(f.authority.scope,f.receipt);
const read=f=>f.make().read(f.input,f.receipt,f.context);
test('exact approved snapshot yields four immutable checks and scoped evidence without replay',async()=>{
  const f=await fixture(),reader=f.make(),result=await reader.read(f.input,f.receipt,f.context);
  assert.equal(result.accepted,true);assert.equal(f.executor.calls.length,1);assert.deepEqual(f.executor.reaped,[key(f)]);
  const execution=f.executor.calls[0];assert.equal(execution.artifact.content,f.authority.actions.write.proposal.edit.content);assert.ok(Object.isFrozen(execution.artifact));assert.equal('argv'in execution,false);
  const evidence=await reader.readEvidence(f.authority.scope,key(f),result.evidenceRef,'owner');assert.equal(evidence.report.checks.length,4);assert.equal(evidence.processesReaped,true);
  evidence.report.checks[0].passed=false;assert.equal((await reader.readEvidence(f.authority.scope,key(f),result.evidenceRef,'owner')).accepted,true);
  assert.deepEqual(await f.make().read(f.input,f.receipt,{...f.context,launcherId:'fresh-launcher'}),result);assert.equal(f.executor.calls.length,1);
  await assert.rejects(reader.readEvidence(f.authority.scope,key(f),result.evidenceRef,'approver'),{code:'FORBIDDEN'});
});
test('failed criterion reports remain negative immutable evidence',async()=>{const f=await fixture();f.executor.handler=async r=>report(r,false);const result=await read(f);assert.equal(result.accepted,false);assert.equal((await f.make().inspect(f.authority.scope,key(f),'owner')).status,'FAILED');});
for(const [name,mutate] of [
  ['owner epoch',f=>f.store.authority.ownerEpoch++],['owner identity',f=>f.store.authority.ownerSubject='agent:other'],['last approver revocation',f=>f.store.authority.approverSubjects=[]],
  ['task cancellation',f=>f.store.authority.cancelRequested=true],['expired approval',f=>f.store.authority.actions.write.approval.expiresAtMs=Date.now()-1],
  ['expired lease',f=>f.store.authority.leaseExpiresAtMs=Date.now()-1],['forged receipt',f=>f.receipt.afterDigest=digest('wrong')],
  ['forged plan',f=>f.input.plan.taskOrder.reverse().push('forged')],['undeclared manifest',f=>{delete f.input.plan.assets['test-manifest'];}],
])test(`${name} refuses before execution`,async()=>{const f=await fixture();mutate(f);await assert.rejects(read(f));assert.equal(f.executor.calls.length,0);assert.equal(f.store.records.size,0);});
test('prelaunch authority recheck catches revocation after committed claim',async()=>{
  const f=await fixture();let commits=0;f.store.afterCommit=()=>{if(++commits===1)f.store.authority.approverSubjects=[];};await assert.rejects(read(f),{code:'APPROVAL_REQUIRED'});assert.equal(f.executor.calls.length,0);assert.equal(f.store.records.get(key(f)).status,'HOLD');
});
test('unknown claim acknowledgement cannot execute or replay from a fresh reader',async()=>{
  const f=await fixture();f.store.afterCommit=()=>{throw new TestError('TEST_COMMIT_UNKNOWN');};await assert.rejects(read(f),{code:'TEST_COMMIT_UNKNOWN'});f.store.afterCommit=null;
  await assert.rejects(read(f),{code:'TEST_OUTCOME_UNKNOWN'});assert.equal(f.executor.calls.length,0);assert.equal(f.store.records.get(key(f)).status,'CLAIMED');
});
test('uncertain terminal commit is recovered from immutable receipt without another execution',async()=>{
  const f=await fixture();let lost=false;f.store.afterCommit=r=>{if(r?.status==='PASSED'&&!lost){lost=true;throw new TestError('TEST_COMMIT_UNKNOWN');}};
  await assert.rejects(read(f),{code:'TEST_COMMIT_UNKNOWN'});f.store.afterCommit=null;assert.equal((await read(f)).accepted,true);assert.equal(f.executor.calls.length,1);
});
test('cancel during active execution reaps and prevents late positive publication',async()=>{
  const f=await fixture();let release;const started=new Promise(resolve=>{f.executor.handler=async(r,signal)=>{resolve();await new Promise(ok=>release=ok);return report(r);};});
  const pending=read(f);await started;f.abort.abort();await assert.rejects(pending,{code:'CANCELLED'});release();await delay(0);
  assert.deepEqual(f.executor.reaped,[key(f)]);assert.equal(f.store.records.get(key(f)).status,'CANCELLED');assert.equal(f.store.records.get(key(f)).evidence,null);
});
test('revocation during execution prevents publishing a result',async()=>{const f=await fixture();f.executor.handler=async r=>{f.store.authority.approverSubjects=[];return report(r);};await assert.rejects(read(f),{code:'APPROVAL_REQUIRED'});assert.equal(f.store.records.get(key(f)).status,'HOLD');});
test('bounded timeout consumes claim and aborts/reaps the owned operation',async()=>{
  const f=await fixture('timeout',manifest({limits:{timeoutMs:30,outputBytes:16384,artifactBytes:65536}}));
  let at=Date.now(),signal,started;const alarms=new Map(),ready=new Promise(resolve=>started=resolve);
  const clock={now:()=>at,alarm(deadline,handler){const key=Symbol();alarms.set(key,{deadline,handler});return()=>alarms.delete(key);}};
  f.executor.handler=async(request,s)=>{signal=s;started(request.deadlineMs);await new Promise(()=>{});};
  const reader=new RegisteredTestAcceptance({store:f.store,manifest:f.manifest,executor:f.executor,identity,clock});
  const pending=reader.read(f.input,f.receipt,f.context);const rejected=assert.rejects(pending,{code:'TEST_DEADLINE'});
  // Trigger the registered deadline only after execution starts. Host load must
  // not turn this active-operation test into a pre-dispatch timeout test.
  at=await ready;assert.equal(alarms.size,1);for(const alarm of [...alarms.values()])if(alarm.deadline<=at)alarm.handler();
  await rejected;assert.equal(signal.aborted,true);assert.equal(f.executor.reaped.length,1);
  await assert.rejects(reader.read(f.input,f.receipt,f.context),{code:'TEST_DEADLINE'});assert.equal(f.executor.calls.length,1);assert.equal(alarms.size,0);
});
test('cleanup failure holds and quarantines until owned cleanup is proved',async()=>{
  const f=await fixture(),reader=f.make();f.executor.reap=async()=>{throw Error('owned process not reaped');};await assert.rejects(reader.read(f.input,f.receipt,f.context),{code:'TEST_CLEANUP_UNKNOWN'});
  await assert.rejects(reader.read(f.input,f.receipt,f.context),{code:'TEST_EXECUTOR_BUSY'});assert.equal(f.store.records.get(key(f)).status,'HOLD');
  f.executor.reap=async()=>{};await reader.close();await assert.rejects(reader.read(f.input,f.receipt,f.context),{code:'TEST_CLEANUP_UNKNOWN'});assert.equal(f.executor.calls.length,1);
});
for(const [name,mutate]of[['wrong artifact',r=>r.artifactDigest=digest('other')],['omitted reload',r=>r.checks.splice(2,1)],['missing export',r=>r.exported=null],['unremoved scratch',r=>r.scratchRemoved=false],['output cap',r=>r.stdout.bytes=16385],['combined output cap',r=>{r.stdout.bytes=10000;r.stderr.bytes=10000;}],['fake pass',r=>r.exitCode=1],['extra field',r=>r.shell='echo forged']])test(`report ${name} holds with no positive evidence`,async()=>{const f=await fixture();f.executor.handler=async req=>{const r=report(req);mutate(r);return r;};await assert.rejects(read(f));assert.equal(f.store.records.get(key(f)).status,'HOLD');assert.equal(f.store.records.get(key(f)).evidence,null);});
test('competing readers consume one claim; waiting on status never launches twice',async()=>{
  const f=await fixture();const results=await Promise.allSettled([read(f),read(f)]);assert.equal(f.executor.calls.length,1);assert.ok(results.some(r=>r.status==='fulfilled'));assert.ok(results.some(r=>r.status==='rejected'&&r.reason.code==='TEST_OUTCOME_UNKNOWN'));
});
test('registry helpers reject changed manifests, duplicate keys and executable data',async()=>{
  const f=await fixture();assert.equal(validateRegisteredManifest(f.manifest).testId,'craft-shop-ui-v1');assert.equal(validateTestManifestPlan(f.input.plan,f.manifest).testId,'craft-shop-ui-v1');
  assert.throws(()=>validateRegisteredManifest(f.manifest+' '));assert.throws(()=>validateRegisteredManifest(f.manifest.replace('"testId":','"testId":"craft-shop-ui-v1","testId":')));
  const changed=manifest({testerDigest:digest('changed')});assert.throws(()=>validateTestManifestPlan(f.input.plan,changed),{code:'TEST_MANIFEST_MISMATCH'});
  let getters=0;Object.defineProperty(f.input,'plan',{get(){getters++;return{};},enumerable:true});await assert.rejects(read(f),{code:'INVALID_DATA'});assert.equal(getters,0);
});
test('context cancellation before claim and coordinator loss never dispatch',async()=>{const f=await fixture();f.abort.abort();await assert.rejects(read(f),{code:'CANCELLED'});assert.equal(f.executor.calls.length,0);const g=await fixture();g.context.guard=async()=>{throw new TestError('COORDINATOR_FENCED');};await assert.rejects(read(g),{code:'COORDINATOR_FENCED'});assert.equal(g.executor.calls.length,0);});

test('missing write receipt refuses before claim or execution',async()=>{const f=await fixture();await assert.rejects(f.make().read(f.input,null,f.context),{code:'WRITE_RECEIPT_REQUIRED'});assert.equal(f.executor.calls.length,0);assert.equal(f.store.records.size,0);});

for(const status of ['CLAIMED','HOLD','CANCELLED'])test(`fresh cancellation reaps persisted ${status} operation without execution`,async()=>{
  const f=await fixture();f.store.afterCommit=()=>{throw new TestError('TEST_COMMIT_UNKNOWN');};await assert.rejects(read(f));f.store.afterCommit=null;
  const saved=f.store.records.get(key(f));saved.status=status;saved.reason=status==='CLAIMED'?null:'CANCELLED';
  const restarted=new Executor();await f.make(f.store,restarted).cancel(f.input,f.receipt);
  assert.deepEqual(restarted.reaped,[key(f)]);assert.equal(restarted.calls.length,0);assert.equal(f.store.records.get(key(f)).status,'CANCELLED');
});
test('fresh cancellation never reaps an absent or completed test and refuses changed receipts',async()=>{
  const f=await fixture();await f.make().cancel(f.input,f.receipt);assert.deepEqual(f.executor.reaped,[]);
  await read(f);const count=f.executor.reaped.length;await f.make().cancel(f.input,f.receipt);assert.equal(f.executor.reaped.length,count);
  await assert.rejects(f.make().cancel(f.input,{...f.receipt,afterDigest:digest('changed')}),{code:'TEST_BINDING_CONFLICT'});assert.equal(f.executor.reaped.length,count);
});
test('fresh cancellation retains unknown cleanup as an error and retries only owned reap',async()=>{
  const f=await fixture();f.store.afterCommit=()=>{throw new TestError('TEST_COMMIT_UNKNOWN');};await assert.rejects(read(f));f.store.afterCommit=null;
  const executor=new Executor();executor.reap=async()=>{throw Error('unknown');};const restarted=f.make(f.store,executor);
  await assert.rejects(restarted.cancel(f.input,f.receipt),{code:'TEST_CLEANUP_UNKNOWN'});assert.equal(f.store.records.get(key(f)).status,'CANCELLED');
  executor.reap=async id=>{executor.reaped.push(id);};await restarted.cancel(f.input,f.receipt);assert.deepEqual(executor.reaped,[key(f)]);assert.equal(executor.calls.length,0);
});
