import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GraphDriver } from '../../../dist/packages/graph/src/index.js';
import { taskRequest } from '../../../dist/packages/graph/src/validation.js';
import { RuntimeTaskBridge, renderTask } from '../../../dist/packages/runtime-bridge/src/index.js';
import { MODEL_ROUTE, proposalPrompt } from '../../../dist/packages/codex-adapter/src/index.js';
import { input, seal, observed, TestStore, canonicalJson, digest } from '../../graph/test/fixtures.mjs';
const policy = () => ({ accountAlias:'synthetic',modelRoute:MODEL_ROUTE,allowancePercent:{primary:2},approverSubjects:['founder:reviewer'],readyAtMs:100,leaseExpiresAtMs:100000 });
class Runtime {
  starts=[]; runs=new Map(); policyCalls=0; beforePolicy;
  ledgerPolicy={thresholdPercent:75,maxWorkers:2,headroomPercent:8,maxObservationAgeMs:5000,admittedRoutes:[MODEL_ROUTE],completedResetPolicy:'hold'};
  async admissionPolicy() { this.policyCalls++; if(this.beforePolicy) await this.beforePolicy(); return structuredClone(this.ledgerPolicy); }
  async submit(value) {
    this.starts.push(structuredClone(value));
    const id=digest(canonicalJson({workspaceId:value.task.workspaceId,runId:value.task.runId,taskId:value.task.taskId}));
    this.runs.set(id,{version:1,id,input:structuredClone(value),inputDigest:digest(canonicalJson(value)),cancelled:false,status:'WAITING_APPROVAL',reason:null,
      process:null,modelOutcome:null,proposal:null,receipt:null,acceptance:null});
    return id;
  }
  async status(id) { if(!this.runs.has(id))throw Object.assign(new Error('unknown'),{code:'UNKNOWN_RUN'}); return {run:structuredClone(this.runs.get(id)),reservation:null,allowanceHeld:true}; }
  finish(request) {
    const run=[...this.runs.values()].find(run=>run.input.task.taskId===request.taskId);
    const completion=observed(request,'COMPLETED').completion;
    run.status='COMPLETED';run.proposal=completion.proposal;run.receipt=completion.receipt;run.acceptance={accepted:true,evidenceRef:completion.evidenceRef};
  }
}
async function setup(name='bridge', change=()=>{}) {
  const value=await input(name);change(value);value.plan=seal(value.plan);
  const store=new TestStore(),runtime=new Runtime(),p=policy();
  const bridge=new RuntimeTaskBridge(value,p,store,runtime),driver=new GraphDriver(store,bridge);
  const id=(await driver.submit(value)).state.id;
  return {value,store,runtime,p,bridge,driver,id,request:task=>taskRequest(store.data.get(id),task)};
}
test('two owners receive pinned role text and accepted typed handoffs, with exact proposal metadata',async()=>{
  const s=await setup();await s.driver.advance(s.id);
  const first=s.runtime.starts[0], rendered=JSON.parse(first.taskInput);
  assert.equal(first.task.ownerSubject,'agent:emery');assert.equal(rendered.role.id,'emery');
  assert.equal(rendered.role.instructions,s.value.assets['emery-prompt']);
  assert.equal(rendered.inputs.orders.value,s.value.assets.orders);
  assert.equal(rendered.proposal.scope.taskId,'design');assert.equal(rendered.proposal.candidateRevision,s.value.plan.candidateRevision);
  assert.equal(first.reservation.jobId,s.request('design').executionId);assert.equal(first.reservation.modelRoute,MODEL_ROUTE);
  assert.ok(Buffer.byteLength(proposalPrompt(first.taskInput))<=4096);
  s.runtime.finish(s.request('design'));assert.equal((await s.driver.advance(s.id)).status,'READY');
  await s.driver.advance(s.id);const second=s.runtime.starts[1];assert.equal(second.task.ownerSubject,'agent:coda');
  assert.deepEqual(JSON.parse(second.taskInput).inputs.brief.value,{title:'Treehouse',count:2});
  assert.deepEqual(second.task.completedDependencies,['design']);assert.equal(second.task.readyAtMs,100);
  s.runtime.finish(s.request('build'));assert.equal((await s.driver.advance(s.id)).status,'COMPLETED');
  assert.equal(s.runtime.policyCalls,2);
});
test('a new bridge observes the same durable run and never resubmits completed claims',async()=>{
  const s=await setup('restart');await s.driver.advance(s.id);s.runtime.finish(s.request('design'));
  const restart=new GraphDriver(s.store,new RuntimeTaskBridge(s.value,s.p,s.store,s.runtime));
  assert.equal((await restart.advance(s.id)).status,'READY');assert.equal(s.runtime.starts.length,1);
});
test('changed controller timestamps cannot rebind a persisted runtime run',async()=>{
  const s=await setup('binding');await s.driver.advance(s.id);
  const changed=new RuntimeTaskBridge(s.value,{...s.p,readyAtMs:101},s.store,s.runtime);
  await assert.rejects(changed.inspect(s.request('design')),{code:'RUNTIME_BINDING'});
});
test('forged requests and unclaimed tasks never reach the runtime',async()=>{
  const s=await setup('claim');const original=s.request('design');
  await assert.rejects(s.bridge.submit(original),{code:'CLAIM_BINDING'});
  await s.driver.advance(s.id);const forged=s.request('design');forged.inputs.orders.artifact.content='injected';
  await assert.rejects(s.bridge.submit(forged),{code:'CLAIM_BINDING'});
  const different={...s.value,owners:{...s.value.owners,emery:{subject:'agent:other',epoch:1}}};
  const alternate=new RuntimeTaskBridge(different,s.p,s.store,s.runtime);
  await assert.rejects(alternate.inspect(s.request('design')),{code:'GRAPH_BINDING'});assert.equal(s.runtime.starts.length,1);
});
for(const [name,change] of [
  ['weaker reserve',p=>{p.thresholdPercent=76;}],['too many workers',p=>{p.maxWorkers=8;}],['unapproved route',p=>{p.admittedRoutes=[];}]
]) test(`${name} in the actual runtime policy prevents submission`,async()=>{
  const s=await setup(name.replaceAll(' ','-'));change(s.runtime.ledgerPolicy);
  assert.equal((await s.driver.advance(s.id)).status,'HOLD');assert.equal(s.runtime.starts.length,0);
});
test('cancellation while the runtime policy awaits prevents submission',async()=>{
  const s=await setup('cancel');s.runtime.beforePolicy=()=>s.driver.cancel(s.id);
  assert.equal((await s.driver.advance(s.id)).status,'CANCELLED');assert.equal(s.runtime.starts.length,0);
});
test('missing runtime status holds the consumed graph claim without retry',async()=>{
  const s=await setup('missing');await s.driver.advance(s.id);s.runtime.runs.clear();
  assert.equal((await s.driver.advance(s.id)).status,'HOLD');await s.driver.advance(s.id);assert.equal(s.runtime.starts.length,1);
});
for(const [name,change] of [
  ['input',r=>{r.input.taskInput+=' ';}],['input digest',r=>{r.inputDigest=digest('wrong');}],
  ['acceptance',r=>{r.status='COMPLETED';r.acceptance={accepted:false,evidenceRef:'rejected'};}],
  ['receipt',r=>{r.status='COMPLETED';r.acceptance={accepted:true,evidenceRef:'accepted'};}],
  ['cancellation',r=>{r.cancelled=true;}]
]) test(`invalid runtime ${name} cannot release dependent work`,async()=>{
  const s=await setup(name.replaceAll(' ','-'));await s.driver.advance(s.id);change([...s.runtime.runs.values()][0]);
  assert.equal((await s.driver.advance(s.id)).status,'HOLD');assert.equal(s.runtime.starts.length,1);
});
test('oversized pinned inputs fail before admission or model submission without truncation',async()=>{
  const s=await setup('size',v=>{v.assets.orders='x'.repeat(33000);v.plan.assets.orders.digest=digest(v.assets.orders);v.plan.assets.orders.bytes=33000;});
  assert.equal((await s.driver.advance(s.id)).status,'HOLD');assert.equal(s.runtime.policyCalls,0);assert.equal(s.runtime.starts.length,0);
});
test('policy is copied and unsupported routes or invalid budgets fail at construction',async()=>{
  const s=await setup('policy-copy');s.p.accountAlias='mutated';s.p.allowancePercent.primary=50;s.p.approverSubjects.push('agent:worker');
  await s.driver.advance(s.id);assert.equal(s.runtime.starts[0].reservation.accountAlias,'synthetic');
  assert.equal(s.runtime.starts[0].reservation.allowancePercent.primary,2);assert.deepEqual(s.runtime.starts[0].task.approverSubjects,['founder:reviewer']);
  for(const patch of [{modelRoute:'paid-api'},{allowancePercent:{primary:0}},{leaseExpiresAtMs:1},{approverSubjects:[]}])
    assert.throws(()=>new RuntimeTaskBridge(s.value,{...policy(),...patch},s.store,s.runtime),{code:'INVALID_POLICY'});
});
