import { input as graphInput,seal,canonicalJson,digest } from '../../graph/test/fixtures.mjs';
import { createTaskState,ActionBroker,systemClock } from '../../../dist/packages/broker/src/index.js';
import { InMemoryWorkspaceEffects } from '../../../dist/packages/broker/src/synthetic.js';
import { encodeState } from '../../../dist/packages/broker-postgres/src/state.js';
import { RegisteredTestAcceptance,serializeTestManifest,testOperationId } from '../../../dist/packages/controlled-tests/src/index.js';
export { canonicalJson,digest,RegisteredTestAcceptance,testOperationId };
export const identity={async authenticate(key){if(!['owner','approver'].includes(key))throw Error('refused');return{subject:key==='owner'?'agent:coda':'lead:reviewer',proofRef:'synthetic-'+key,expiresAtMs:Date.now()+120000};}};
export function manifest(overrides={}){return serializeTestManifest({format:'trellis/registered-test/v0.7-alpha',testId:'craft-shop-ui-v1',testerDigest:digest('synthetic test-only harness'),environmentDigest:digest('synthetic test-only environment'),criteria:['add-job','change-stage','reload','export'],limits:{timeoutMs:2000,outputBytes:16384,artifactBytes:65536},...overrides});}
export class Store {
  records=new Map();tail=Promise.resolve();afterCommit;
  constructor(authority){this.authority=structuredClone(authority);}
  async transaction(scope,id,change){let release;const prior=this.tail;this.tail=new Promise(r=>release=r);await prior;
    try{const current=this.records.get(id);const output=change(current?structuredClone(current):null,encodeState(this.authority,scope).state);
      if(output.record)this.records.set(id,structuredClone(output.record));if(this.afterCommit)await this.afterCommit(output.record);return structuredClone(output.result);
    }finally{release();}
  }
}
export function report(request,passed=true){return{format:'trellis/test-report/v0.7-alpha',operationId:request.operationId,requestDigest:request.requestDigest,manifestDigest:request.manifestDigest,artifactDigest:request.artifact.digest,
  checks:['add-job','change-stage','reload','export'].map(id=>({id,passed,observation:'synthetic '+id})),exported:passed?{digest:digest('{"version":1,"jobs":[]}'),bytes:23}:null,exitCode:passed?0:1,
  stdout:{digest:digest(''),bytes:0},stderr:{digest:digest(''),bytes:0},scratchBytesPeak:10,scratchRemoved:true};}
export class Executor {
  calls=[];reaped=[];handler=async r=>report(r);
  async execute(value,signal){this.calls.push(value);return this.handler(value,signal);}
  async reap(id){this.reaped.push(id);}
}
export async function fixture(runId='tests',manifestBytes=manifest()){
  const original=await graphInput(runId),plan=structuredClone(original.plan),task=plan.definition.tasks[1];
  task.dependsOn=[];task.inputs={};task.approval='required';task.effects=[{operation:'workspace.write',path:'output/job-board/index.html'},{operation:'command.test',command:'craft-shop-ui-v1'}];
  task.requires=['workspace.write','command.test','approval.exact-revision'];task.policy.maxAttempts=1;task.policy.backoffSeconds=0;
  plan.definition.tasks=[task];plan.definition.scope=task.effects;plan.definition.requiredCapabilities=task.requires;
  for(const owner of plan.definition.owners)owner.permissions=task.effects;
  plan.definition.assets['test-manifest']={path:'tests/manifest.json',mediaType:'application/json'};
  plan.assets['test-manifest']={...plan.definition.assets['test-manifest'],bytes:Buffer.byteLength(manifestBytes),digest:digest(manifestBytes)};
  const compiled=seal(plan),now=Date.now(),config={workspaceId:'synthetic-workspace',runId,taskId:task.id,ownerSubject:'agent:coda',ownerEpoch:1,approverSubjects:['lead:reviewer'],readyAtMs:now-10,leaseExpiresAtMs:now+120000,completedDependencies:[]};
  let authority=createTaskState(compiled,config);
  const brokerStore={async transaction(scope,change){const cloned=structuredClone(authority),result=change(cloned);authority=cloned;return structuredClone(result);}};
  const effects=new InMemoryWorkspaceEffects(systemClock);
  const broker=new ActionBroker({store:brokerStore,identity,clock:systemClock,effects});
  const proposal={format:'trellis/action/v0.7-alpha',scope:authority.scope,requestId:'write',candidateRevision:compiled.candidateRevision,ownerEpoch:1,edit:{operation:'workspace.write',path:task.effects[0].path,expectedDigest:null,content:'<!doctype html><title>Synthetic craft shop</title>'}};
  const prepared=await broker.prepare(JSON.stringify(proposal),'owner');await broker.approve(authority.scope,'write',{candidateRevision:compiled.candidateRevision,actionDigest:prepared.actionDigest,ownerEpoch:1,expiresAtMs:now+100000},'approver');
  const completed=await broker.dispatch(authority.scope,'write','owner');
  if(completed.status!=='COMPLETED'||!completed.receipt)throw new Error('Synthetic write fixture did not complete');
  const input={plan:compiled,task:config,reservation:{accountAlias:'synthetic-alias',jobId:runId,candidateRevision:compiled.candidateRevision,modelRoute:'codex-test',role:'worker',attempt:'initial',allowancePercent:{primary:1},paidFallback:false},taskInput:'Synthetic test only'};
  const store=new Store(authority),executor=new Executor(),abort=new AbortController();
  const context={signal:abort.signal,launcherId:'launcher-synthetic',ownerCredential:'owner',async guard(){}};
  const make=(s=store,e=executor)=>new RegisteredTestAcceptance({store:s,manifest:manifestBytes,executor:e,identity});
  return{input,receipt:completed.receipt,authority,store,executor,abort,context,make,manifest:manifestBytes};
}
