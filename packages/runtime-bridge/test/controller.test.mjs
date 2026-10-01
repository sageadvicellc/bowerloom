import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {writeFile,mkdtemp,realpath,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {openLocalSession,localInstallation} from '../../../dist/apps/cli/src/controller.js';
import {RuntimeLedger,SupervisedRuntime} from '../../../dist/packages/runtime/src/index.js';
import {PostgresGraphStore,pinGraph} from '../../../dist/packages/graph/src/index.js';
import {PostgresWorkspaceEffects} from '../../../dist/packages/workspace-effects/src/index.js';
import {ActionBroker,createTaskState,systemClock} from '../../../dist/packages/broker/src/index.js';
import {InMemoryBrokerStore,InMemoryWorkspaceEffects} from '../../../dist/packages/broker/src/synthetic.js';
import {request as testRequest,manifest as parseManifest} from '../../../dist/packages/controlled-tests/src/validation.js';
import {MODEL_ROUTE} from '../../../dist/packages/codex-adapter/src/index.js';
import {input,seal,TestStore,canonicalJson,digest} from '../../graph/test/fixtures.mjs';
const manifest=canonicalJson({format:'trellis/registered-test/v0.7-alpha',testId:'craft-shop-ui-v1',testerDigest:digest('tester'),environmentDigest:digest('environment'),criteria:['add-job','change-stage','reload','export'],limits:{timeoutMs:25000,outputBytes:16384,artifactBytes:65536}});
async function fixture(name,nearDeadline=false){
 const graph=await input(name);
 graph.plan.definition.requiredCapabilities=['workspace.write','approval.exact-revision','command.test'];
 graph.plan.definition.scope.push({operation:'command.test',command:'craft-shop-ui-v1'});
 for(const owner of graph.plan.definition.owners)owner.permissions.push({operation:'command.test',command:'craft-shop-ui-v1'});
 for(const task of graph.plan.definition.tasks){task.requires=['workspace.write','approval.exact-revision','command.test'];task.effects.push({operation:'command.test',command:'craft-shop-ui-v1'});task.outputs=task.id==='design'?{brief:{kind:'artifact',mediaType:'text/html'}}:{application:{kind:'artifact',mediaType:'text/html'}};task.policy.deadlineSeconds=600;}
 graph.plan.definition.tasks[1].inputs.brief.type={kind:'artifact',mediaType:'text/html'};
graph.plan.definition.assets['test-manifest']={path:'test-manifest.json',mediaType:'application/json'};
 graph.plan.assets['test-manifest']={...graph.plan.definition.assets['test-manifest'],bytes:Buffer.byteLength(manifest),digest:digest(manifest)};graph.assets['test-manifest']=manifest;graph.plan=seal(graph.plan);pinGraph(graph);
 const scratch=await realpath(await mkdtemp(join(tmpdir(),'trellis-controller-')));const credentials=resolve(scratch,'credentials.json');await writeFile(credentials,JSON.stringify({POSTGRES_PASSWORD:'synthetic-never-connect'}),{mode:0o600});
 const now=Date.now()-(nearDeadline?599000:0),config=localInstallation({format:'trellis/local-installation/v0.7-alpha',installationId:'alpha-probe',database:{host:'127.0.0.1',port:54321,name:'trellis_probe',credentialsFile:credentials},
 schemas:{runtime:'trellis_runtime',broker:'trellis_broker',admission:'trellis_admission',effects:'trellis_effects',graph:'trellis_graph',tests:'trellis_tests'},graph,
 bridge:{accountAlias:'synthetic',modelRoute:MODEL_ROUTE,allowancePercent:{primary:2},approverSubjects:['founder:reviewer'],readyAtMs:now,leaseExpiresAtMs:now+1200000},workspaceRoot:scratch,
 codex:{installation:{nativePath:resolve(scratch,'never-executed'),nativeSha256:'0'.repeat(64),version:'0.157.0',workRoot:scratch},binding:{canonicalAccountId:'synthetic-account',aliases:['synthetic'],providerAccountSha256:'0'.repeat(64),requiredWindows:['primary'],optionalWindows:['secondary']},stopUsedPercent:75},browser:{}});
 const store=new TestStore(),hooks=[],scope={workspaceId:graph.workspaceId,runId:graph.runId,taskId:'design'};
 const runInput={plan:graph.plan,task:{...scope,ownerSubject:'agent:emery',ownerEpoch:1,approverSubjects:['founder:reviewer'],readyAtMs:now,leaseExpiresAtMs:now+1200000,completedDependencies:[]},taskInput:'synthetic',reservation:{}};
 const authority=createTaskState(graph.plan,runInput.task),brokerStore=new InMemoryBrokerStore();brokerStore.seed(authority);let broker,action,deps,opened=0,closed=0;
 hooks.push(mock.method(PostgresGraphStore.prototype,'transaction',(id,change)=>store.transaction(id,change)));
 hooks.push(mock.method(PostgresWorkspaceEffects,'open',async()=>({apply(){throw Error('unreachable');},lookup(){throw Error('unreachable');}})));
 hooks.push(mock.method(RuntimeLedger.prototype,'read',async()=>({id:'synthetic-run',input:runInput,proposal:action.proposal})));
 hooks.push(mock.method(SupervisedRuntime,'open',async(d)=>{opened++;deps=d;broker=new ActionBroker({store:brokerStore,identity:d.identity,clock:systemClock,effects:new InMemoryWorkspaceEffects(systemClock)});
  action=await broker.prepare(JSON.stringify({format:'trellis/action/v0.7-alpha',scope,requestId:'write',candidateRevision:graph.plan.candidateRevision,ownerEpoch:1,edit:{operation:'workspace.write',path:'output/design/brief.json',expectedDigest:null,content:'{"title":"Synthetic","count":1}'}}),d.ownerCredentialFor(runInput));
  return {async close(){closed++;},async approve(id,approval,credential){return broker.approve(scope,'write',approval,credential);}};
 }));
 return {config,scope,runInput,authority,brokerStore,get action(){return action;},get deps(){return deps;},get opened(){return opened;},get closed(){return closed;},async cleanup(){for(const hook of hooks.reverse())hook.mock.restore();await rm(scratch,{recursive:true});}};
}
const executor={async execute(){throw Error('no browser');},async reap(){}};
test('controller approval reaches the real broker within proof and task lifetimes',async()=>{
 const f=await fixture('approval');let session;try{session=await openLocalSession(f.config,executor,'start');
  await session.approve('design',f.config.graph.plan.candidateRevision,f.action.actionDigest);
  const state=await f.brokerStore.transaction(f.scope,s=>structuredClone(s));assert.ok(state.actions.write.approval);assert.ok(state.actions.write.approval.expiresAtMs<=f.runInput.task.readyAtMs+600000);assert.equal(state.actions.write.status,'PREPARED');
 }finally{if(session)await session.close();await f.cleanup();}
});
test('invalid bridge policy cannot reach runtime startup',async()=>{
 const f=await fixture('startup');try{f.config.bridge.modelRoute='unapproved-route';
  assert.throws(()=>localInstallation(f.config),{code:'INVALID_POLICY'});
  await assert.rejects(openLocalSession(f.config,executor,'start'),{code:'INVALID_POLICY'});
  assert.equal(f.opened,0);assert.equal(f.closed,0);
 }finally{await f.cleanup();}
});
test('the local controller refuses a write-only graph before runtime startup',async()=>{
 const f=await fixture('optional');try{const task=f.config.graph.plan.definition.tasks[0];task.effects=task.effects.filter(e=>e.operation!=='command.test');task.requires=task.requires.filter(e=>e!=='command.test');f.config.graph.plan=seal(f.config.graph.plan);pinGraph(f.config.graph);
  assert.throws(()=>localInstallation(f.config),{code:'TEST_GATE_REQUIRED'});
  await assert.rejects(openLocalSession(f.config,executor,'start'),{code:'TEST_GATE_REQUIRED'});assert.equal(f.opened,0);
 }finally{await f.cleanup();}
});
test('approval near the task deadline is capped and remains usable',async()=>{
 const f=await fixture('deadline',true);let session;try{session=await openLocalSession(f.config,executor,'start');await session.approve('design',f.config.graph.plan.candidateRevision,f.action.actionDigest);
  const state=await f.brokerStore.transaction(f.scope,s=>structuredClone(s));assert.equal(state.actions.write.approval.expiresAtMs,f.runInput.task.readyAtMs+600000);
 }finally{if(session)await session.close();await f.cleanup();}
});
