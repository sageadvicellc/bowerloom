import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GraphDriver, pinGraph, validateGraphState } from '../../../dist/packages/graph/src/index.js';
import { compileCrew } from '../../../dist/packages/crew/src/index.js';
import { input, seal, observed, Executor, TestStore, canonicalJson, digest } from './fixtures.mjs';
const setup=async(name='test')=>{const store=new TestStore(),executor=new Executor(),driver=new GraphDriver(store,executor);const value=await input(name);const created=await driver.submit(value);return{store,executor,driver,value,id:created.state.id};};
test('pins a canonical graph and hands accepted typed data to the next owner in deterministic order',async()=>{
  const {driver,executor,id,value}=await setup();
  assert.equal((await driver.status(id)).status,'READY'); await driver.advance(id); assert.equal(executor.submitted.length,1);
  const design=executor.submitted[0]; assert.equal(design.taskId,'design');assert.equal(design.ownerId,'emery');assert.equal(design.ownerSubject,'agent:emery');
  assert.equal(design.inputs.orders.artifact.digest,value.plan.assets.orders.digest);assert.equal(design.inputs.orders.value,null);
  assert.deepEqual(design.completedDependencies,[]);
  executor.complete(); assert.equal((await driver.advance(id)).status,'READY');assert.equal(executor.submitted.length,1);
  await driver.advance(id);const build=executor.submitted[1];assert.equal(build.taskId,'build');assert.equal(build.ownerId,'coda');
  assert.deepEqual(build.completedDependencies,['design']);assert.deepEqual(build.inputs.brief.value,{count:2,title:'Treehouse'});
  assert.equal(build.inputs.brief.valueDigest,digest(canonicalJson({count:2,title:'Treehouse'})));
  assert.equal(build.inputs.brief.artifact.digest,digest(build.inputs.brief.artifact.content));
  executor.complete(1);const completed=await driver.advance(id);assert.equal(completed.status,'COMPLETED');
  assert.equal(completed.state.tasks.build.output.artifact.mediaType,'text/html');
  await driver.advance(id);assert.equal(executor.submitted.length,2);
});
test('rechecks digest, canonical order, pinned source bytes, and owner bindings before calling an executor',async()=>{
  const value=await input();const executor=new Executor();const driver=new GraphDriver(new TestStore(),executor);
  for(const mutate of [v=>{v.plan.candidateRevision=digest('forged');},v=>{v.assets.orders+=' ';},v=>{v.plan.assets.orders.extra=true;v.plan=seal(v.plan);},
    v=>{delete v.owners.emery;},v=>{v.extra=true;},v=>{v.owners.coda.epoch=0;}]) {
    const invalid=structuredClone(value);mutate(invalid);assert.throws(()=>driver.submit(invalid));
  }
  const forged=structuredClone(value);forged.plan.taskOrder.reverse();const{candidateRevision,...body}=forged.plan;forged.plan.candidateRevision=digest(canonicalJson(body));
  assert.throws(()=>driver.submit(forged),{code:'INVALID_PLAN'});assert.equal(executor.submitted.length,0);
});
test('refuses executable objects without invoking their getters',async()=>{
  const value=await input();let called=0;Object.defineProperty(value,'assets',{enumerable:true,get(){called++;return{};}});
  assert.throws(()=>pinGraph(value),{code:'INVALID_VALUE'});assert.equal(called,0);
});
test('existing Endor and unsupported effects, approval, retries, capabilities, or output shapes fail before execution',async()=>{
  const value=await input();const actual=await compileCrew('examples/endor/crew.yaml');assert.throws(()=>pinGraph({...value,plan:actual}),{code:'UNSUPPORTED_GRAPH'});
  for(const mutate of [v=>{v.plan.definition.tasks[0].approval='none';},v=>{v.plan.definition.tasks[0].policy.maxAttempts=2;v.plan.definition.tasks[0].policy.deadlineSeconds=600;},
    v=>{v.plan.definition.tasks[0].outputs.other={kind:'string'};},v=>{v.plan.definition.tasks[0].effects=[];},
    v=>{v.plan.definition.requiredCapabilities.push('command.test');},v=>{v.plan.definition.tasks[1].outputs.application={kind:'array',items:{kind:'artifact',mediaType:'text/plain'}};}]) {
    const invalid=structuredClone(value);mutate(invalid);invalid.plan=seal(invalid.plan);assert.throws(()=>pinGraph(invalid),error=>error.code.startsWith('UNSUPPORTED_'));
  }
});
for(const status of ['HOLD','CANCELLED','ACCEPTANCE_FAILED','WAITING_APPROVAL']) test(`${status} does not release downstream work`,async()=>{
  const {driver,executor,id}=await setup(status);await driver.advance(id);executor.observations.set('design',observed(executor.submitted[0],status));
  assert.equal((await driver.advance(id)).status,status);await driver.advance(id);assert.equal(executor.submitted.length,1);
});
for(const [name,change] of [
  ['wrong data type',request=>observed(request,'COMPLETED',canonicalJson({title:'Treehouse',count:'two'}))],
  ['missing output field',request=>observed(request,'COMPLETED',canonicalJson({title:'Treehouse'}))],
  ['noncanonical JSON',request=>observed(request,'COMPLETED','{"title":"Treehouse", "count":2}')],
  ['forged receipt',request=>{const value=observed(request,'COMPLETED');value.completion.receipt.afterDigest=digest('other');return value;}],
  ['wrong owner epoch',request=>{const value=observed(request,'COMPLETED');value.completion.proposal.ownerEpoch++;return value;}],
  ['wrong execution',request=>({...observed(request,'COMPLETED'),executionId:digest('other')})],
]) test(`${name} holds the graph and exposes no downstream output`,async()=>{
  const {driver,executor,id}=await setup(name.replaceAll(' ','-'));await driver.advance(id);executor.observations.set('design',change(executor.submitted[0]));
  const held=await driver.advance(id);assert.equal(held.status,'HOLD');assert.equal(held.state.tasks.design.output,null);
  await driver.advance(id);assert.equal(executor.submitted.length,1);
});
test('restart with a consumed claim inspects the same runtime identity and never submits it again',async()=>{
  const {driver,executor,id,store}=await setup();await driver.advance(id);executor.complete();
  const restarted=new GraphDriver(store,executor);assert.equal((await restarted.advance(id)).status,'READY');
  assert.equal(executor.submitted.length,1);await restarted.advance(id);assert.equal(executor.submitted.length,2);
});
test('unknown task status and submission acknowledgements retain claims without automatic retry',async()=>{
  for(const mode of ['status','submission']) {
    const {driver,executor,id}=await setup(mode);
    if(mode==='submission')executor.submit=async request=>{executor.submitted.push(request);throw new Error('lost acknowledgement');};
    await driver.advance(id);if(mode==='status'){executor.inspect=async()=>null;await driver.advance(id);}
    const state=await driver.status(id);assert.equal(state.status,'HOLD');assert.ok(state.state.tasks.design.claim);await driver.advance(id);
    assert.equal(executor.submitted.length,1);
  }
});
test('an ambiguous graph claim commit causes zero execution and restart only inspects',async()=>{
  const {driver,executor,id,store}=await setup();let fired=false;store.afterCommit=state=>{if(state.tasks.design.claim&&!fired){fired=true;throw new Error('COMMIT_UNKNOWN');}};
  await assert.rejects(driver.advance(id),/COMMIT_UNKNOWN/);assert.equal(executor.submitted.length,0);store.afterCommit=null;executor.inspect=async()=>null;
  const restarted=new GraphDriver(store,executor);assert.equal((await restarted.advance(id)).status,'HOLD');assert.equal(executor.submitted.length,0);
});
test('duplicate submissions and competing advances preserve one pinned claim',async()=>{
  const {driver,executor,id,store,value}=await setup();const other=new GraphDriver(store,executor);
  assert.equal((await other.submit(value)).state.id,id);
  const changed=structuredClone(value);changed.owners.coda.epoch++;await assert.rejects(other.submit(changed),{code:'GRAPH_CONFLICT'});
  await Promise.all([driver.advance(id),other.advance(id)]);assert.equal(executor.submitted.length,1);
});
test('cancellation commits before new claims and retains an already claimed task without asserting termination',async()=>{
  const first=await setup('before');await first.driver.cancel(first.id);await first.driver.advance(first.id);assert.equal(first.executor.submitted.length,0);
  const {driver,executor,id,store}=await setup('during');let release;const gate=new Promise(resolve=>{release=resolve;});let entered;
  const reached=new Promise(resolve=>{entered=resolve;});executor.submit=async request=>{executor.submitted.push(request);entered();await gate;};
  const advancing=driver.advance(id);await reached;const cancelled=await driver.cancel(id);assert.equal(cancelled.status,'CANCELLED');assert.ok(cancelled.state.tasks.design.claim);
  release();assert.equal((await advancing).status,'CANCELLED');await new GraphDriver(store,executor).advance(id);assert.equal(executor.submitted.length,1);
});
test('returned views and task requests cannot mutate pinned graph state',async()=>{
  const {driver,executor,id}=await setup();const exposed=await driver.status(id);exposed.state.input.assets.orders='changed';
  await driver.advance(id);executor.submitted[0].inputs.orders.artifact.content='changed';
  const current=await driver.status(id);assert.notEqual(current.state.input.assets.orders,'changed');validateGraphState(current.state);
});
for(const [name,type,value] of [
  ['string',{kind:'string'},'bridges'],['number',{kind:'number'},1.25],['boolean',{kind:'boolean'},true],
  ['array',{kind:'array',items:{kind:'record',fields:{done:{kind:'boolean'}}}},[{done:true},{done:false}]],
]) test(`hands off an exact ${name} value with the written JSON digest`,async()=>{
  const source=await input(`typed-${name}`);source.plan.definition.tasks[0].outputs.brief=type;source.plan.definition.tasks[1].inputs.brief.type=type;source.plan=seal(source.plan);
  const executor=new Executor(),driver=new GraphDriver(new TestStore(),executor);const{id}= (await driver.submit(source)).state;
  await driver.advance(id);executor.complete(0,canonicalJson(value));await driver.advance(id);await driver.advance(id);
  assert.deepEqual(executor.submitted[1].inputs.brief.value,value);assert.equal(executor.submitted[1].inputs.brief.artifact.digest,digest(canonicalJson(value)));
});
test('a late stale status cannot overwrite a completed receipt or typed output',async()=>{
  const {driver,executor,id}=await setup('stale-status');await driver.advance(id);let entered,release;
  const reached=new Promise(resolve=>{entered=resolve;});const pending=new Promise(resolve=>{release=resolve;});let inspections=0;
  executor.inspect=async request=>{if(++inspections===1){entered();await pending;return observed(request,'RUNNING');}return observed(request,'COMPLETED');};
  const stale=driver.advance(id);await reached;const completed=await driver.advance(id);assert.ok(completed.state.tasks.design.output);release();
  const result=await stale;assert.deepEqual(result.state.tasks.design,completed.state.tasks.design);assert.equal(executor.submitted.length,1);
});
test('two different completed results under one claim stop scheduling without replacing the first receipt',async()=>{
  const {driver,executor,id}=await setup('conflicting-status');await driver.advance(id);let entered,release;
  const reached=new Promise(resolve=>{entered=resolve;});const pending=new Promise(resolve=>{release=resolve;});let inspections=0;
  executor.inspect=async request=>{if(++inspections===1){entered();await pending;return observed(request,'COMPLETED',canonicalJson({title:'changed',count:3}));}return observed(request,'COMPLETED');};
  const stale=driver.advance(id);await reached;const completed=await driver.advance(id);release();const held=await stale;
  assert.equal(held.status,'HOLD');assert.equal(held.state.holdReason,'EXECUTION_CONFLICT');assert.deepEqual(held.state.tasks.design,completed.state.tasks.design);
  await driver.advance(id);assert.equal(executor.submitted.length,1);
});
