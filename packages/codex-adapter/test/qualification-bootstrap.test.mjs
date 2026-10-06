// Deterministic fixture-only module substitution. No production factory override or model process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { canonicalJson,digest } from '../../../dist/packages/contracts/src/index.js';
import { PostgresAdmission,createAccount } from '../../../dist/packages/admission/src/index.js';
import { proposalPrompt } from '../../../dist/packages/codex-adapter/src/index.js';
import { planCodexProposalLaunch,codexBoundaryAccountRevision,codexArtifactRevision } from '../../../dist/packages/codex-adapter/src/boundary.js';
import { startupLaunchRevision } from '../../../dist/packages/codex-adapter/src/startup-deadline.js';
import { MODEL_ROUTE,POLICY_VERSION,SUPPORTED_NATIVE_SHA256 } from '../../../dist/packages/codex-adapter/src/policy.js';
const hash=x=>createHash('sha256').update(x).digest('hex'),tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject};};
const symbol='bowerloom.bootstrap.synthetic-core';
globalThis[symbol]={proposalPrompt};
const fixture='data:text/javascript,'+encodeURIComponent(`export const proposalPrompt=globalThis['${symbol}'].proposalPrompt;export class CodexAdapterCore{constructor(options,gate){this.options=options;this.gate=gate;globalThis['${symbol}'].owners?.push(new WeakRef(this));}start(input,signal){return globalThis['${symbol}'].start(this.options,this.gate,input,signal);}quiescence(){return globalThis['${symbol}'].quiescence?.()??Promise.resolve({cleanup:'verified'});}}`);
const hook=registerHooks({resolve(specifier,context,next){if(specifier==='./adapter-core.js'&&context.parentURL?.endsWith('/qualification-bootstrap.js'))return{url:fixture,shortCircuit:true};return next(specifier,context);}});
const {QualificationBootstrap}=await import('../../../dist/packages/codex-adapter/src/qualification-bootstrap.js');hook.deregister();
const paths=['qualification-bootstrap','index','adapter-core','boundary','startup-deadline','installation','policy','protocol','reader','observation','safe','supervisor','guardian'].map(n=>`dist/packages/codex-adapter/src/${n}.js`).concat(['dist/packages/broker/src/index.js','dist/packages/contracts/src/index.js','dist/packages/mcp-connections/src/darwin-boot-session.js','dist/packages/mcp-connections/src/model.js']);
function memoryPool(seed){
 const policy={thresholdPercent:75,maxWorkers:2,maxObservationAgeMs:5000,headroomPercent:5,admittedRoutes:[MODEL_ROUTE],completedResetPolicy:'hold'};
 let stored=seed??createAccount('account',['alias'],policy),tail=Promise.resolve();
 const pool={queries:[],hook:null,snapshot:()=>structuredClone(stored),async connect(){const before=tail,lock=deferred();tail=lock.promise;await before;let staged,released=false;const c=new EventEmitter();c.release=()=>{assert.equal(released,false);released=true;lock.resolve();};c.query=async(sql,v)=>{
  pool.queries.push(sql);const execute=()=>{if(sql.startsWith('BEGIN'))staged=structuredClone(stored);else if(sql.startsWith('SET LOCAL')){}else if(sql==='SELECT current_database() AS name')return{rows:[{name:'synthetic'}]};else if(sql.includes('.metadata FOR SHARE'))return{rows:[{singleton:true,version:1}]};else if(sql.includes('WHERE account_id=(SELECT'))return{rows:[{account_id:staged.accountId,version:1,state:structuredClone(staged),checksum:digest(canonicalJson(staged))}]};else if(sql.startsWith('UPDATE'))staged=JSON.parse(v[1]);else if(sql==='COMMIT')stored=structuredClone(staged);else if(sql==='ROLLBACK')staged=undefined;else throw Error('fixture SQL');return{rows:[]};};if(pool.hook){const r=await pool.hook(sql,v,execute);if(r!==undefined)return r;}return execute();};return c;}};return pool;
}
function observation(){const now=Date.now();return{observationId:'sample-'+now,accountId:'account',observedAtMs:now,authentication:'subscription',ordinaryUsageAllowed:true,windows:{primary:{usedPercent:10,durationMs:600000,resetAtMs:now+300000,accountedThroughMs:null}},routes:{[MODEL_ROUTE]:{requiredWindows:['primary'],optionalWindows:[]}}};}
async function setup(){
 delete globalThis[symbol].quiescence;delete globalThis[symbol].owners;
 const pool=memoryPool(),abort=new AbortController(),binding={canonicalAccountId:'account',aliases:['alias'],providerAccountSha256:'a'.repeat(64),requiredWindows:['primary'],optionalWindows:[]};
 const hostBinding={installationId:'installation',databaseName:'synthetic',admissionSchema:'trellis_bootstrap',accountId:'account',accountAlias:'alias',launcherId:'launcher'};
 const installation={nativePath:'/synthetic/no-native-launch',nativeSha256:SUPPORTED_NATIVE_SHA256,version:'0.157.0',workRoot:'/synthetic/no-workspace'};
 const runtime={executable:process.execPath,sha256:'a'.repeat(64),nodeVersion:'v24.11.0',uvVersion:'1.51.0',platform:'darwin',arch:'arm64'};
 const artifact={root:resolve('.'),tarballSha256:'b'.repeat(64),files:await Promise.all(paths.map(async path=>({path,sha256:hash(await readFile(path))})))};
 const plan=planCodexProposalLaunch({version:installation.version,nativeSha256:installation.nativeSha256});const now=Date.now(),taskInput='Synthetic qualification task';
 const body={format:'bowerloom/codex-qualification-grant/v1',grantId:'grant',status:'active',operationId:'operation',hostBinding,accountBindingDigest:codexBoundaryAccountRevision(binding,'alias'),artifactRevision:codexArtifactRevision(artifact),nativeVersion:installation.version,nativeSha256:installation.nativeSha256,nativePath:installation.nativePath,runtime,proposalPlanRevision:plan.revision,launchPlanRevision:startupLaunchRevision(plan.revision,runtime),policyVersion:POLICY_VERSION,modelRoute:MODEL_ROUTE,taskDigest:hash(taskInput),promptDigest:hash(proposalPrompt(taskInput)),allowancePercent:{primary:10},issuedAtMs:now-1000,expiresAtMs:now+60000,reviewRevision:'c'.repeat(64),fixtureRevision:'d'.repeat(64)};
 const grant={...body,revision:hash(canonicalJson(body))};let lookups=0,reads=0,starts=0,terminates=0;
 const options={admission:new PostgresAdmission(pool,{schema:hostBinding.admissionSchema,launcherId:'launcher',controlIdentity:{installationId:'installation',databaseName:'synthetic'}}),observer:{async read(){reads++;return observation();}},fence:{binding:hostBinding,signal:abort.signal,assert(){if(abort.signal.aborted)throw Error('PRIVATE');},async guard(){}},installation,binding,accountAlias:'alias',runtime,artifact,async lookupGrant(){lookups++;return grant;}};
 const errors=[];for(const name of ['reserveControlled','launchOnceControlled','completeControlled']){const original=options.admission[name].bind(options.admission);options.admission[name]=async(...args)=>{try{return await original(...args);}catch(e){errors.push({name,code:e.code,message:e.message});throw e;}};}
 const input={grantId:'grant',grantRevision:grant.revision,operationId:'operation',taskInput};
 const handle={identity:{processRef:'process',ownershipDigest:'e'.repeat(64),pid:10001,groupId:10001,launcherId:'launcher'},result:Promise.resolve('synthetic proposal'),async terminate(){terminates++;}};
 let envelope;
 globalThis[symbol].start=async(opts,gate,i,s)=>{starts++;await gate.check(s);await gate.check(s,observation());gate.assertCurrent(s);envelope=gate.consume({launcherId:i.launcherId,accountBindingDigest:grant.accountBindingDigest,promptDigest:hash(proposalPrompt(i.taskInput)),modelRoute:i.modelRoute,launchPlanRevision:plan.revision},s);return handle;};
 return{pool,abort,options,input,grant,handle,stats:()=>({lookups,reads,starts,terminates,envelope,errors}),runner:()=>new QualificationBootstrap(options)};
}
test('private bootstrap uses exact lookup, fresh admission claim and one-use gate then controlled completion',async()=>{
 const e=await setup(),r=await e.runner().run(e.input,e.abort.signal);assert.equal(r.status,'proposal',JSON.stringify({r,stats:e.stats(),state:e.pool.snapshot()}));assert.equal(r.cleanup,'verified');assert.equal(r.ordinaryQualified,false);assert.equal(r.effectsAuthorized,false);assert.equal(e.stats().starts,1);assert.equal(e.stats().terminates,1);assert.ok(e.stats().reads>=3);assert.ok(e.stats().lookups>=5);
 const reservation=e.pool.snapshot().reservations[r.jobId];assert.equal(reservation.status,'COMPLETED');assert.equal(reservation.retained.primary.percent,10);assert.equal(reservation.permitHash,null);assert.equal(e.stats().envelope.admission.reservationId,reservation.reservationId);
 const replay=await e.runner().run(e.input,e.abort.signal);assert.equal(replay.status,'refused');assert.equal(e.stats().starts,1);
});
test('forged/drifted grant, task/prompt/identity mismatches and revoked lookup refuse before dispatch',async()=>{
 for(const patch of [{taskDigest:'f'.repeat(64)},{promptDigest:'f'.repeat(64)},{status:'revoked'},{hostBinding:{}},{modelRoute:'wrong'},{expiresAtMs:1},{runtime:{}}]){
  const e=await setup();Object.assign(e.grant,patch);const r=await e.runner().run(e.input,e.abort.signal);assert.equal(r.status,'refused');assert.equal(e.stats().starts,0);assert.deepEqual(e.pool.snapshot().reservations,{});
 }
 const e=await setup();const r=await e.runner().run({...e.input,taskInput:'changed'},e.abort.signal);assert.equal(r.status,'refused');assert.equal(e.stats().starts,0);
});
test('concurrent and different grant IDs for same operation cannot get another job or start',async()=>{
 const e=await setup(),a=e.runner(),b=e.runner();const results=await Promise.all([a.run(e.input,e.abort.signal),b.run(e.input,e.abort.signal)]);assert.equal(results.filter(r=>r.status==='proposal').length,1);assert.equal(e.stats().starts,1);assert.equal(results[0].jobId,results[1].jobId);
 const {revision,...body}=e.grant;body.grantId='new-grant';e.options.lookupGrant=async()=>({...body,revision:hash(canonicalJson(body))});const r=await e.runner().run({...e.input,grantId:body.grantId,grantRevision:hash(canonicalJson(body))},e.abort.signal);assert.equal(r.status,'refused');assert.equal(r.jobId,results[0].jobId);assert.equal(e.stats().starts,1);
});
test('lost reserve/claim/RUNNING/complete acknowledgments stay held, clean received handles and never redispatch',async()=>{
 for(const stage of ['RESERVED','LAUNCHING','RUNNING','COMPLETED']){
  const e=await setup();let fired=false;e.pool.hook=async(sql,v,execute)=>{if(sql==='COMMIT'){const out=execute();const row=Object.values(e.pool.snapshot().reservations)[0];if(!fired&&row?.status===stage){fired=true;throw Error('PRIVATE_ACK');}return out;}};
  const runner=e.runner(),r=await runner.run(e.input,e.abort.signal);assert.equal(fired,true,JSON.stringify({stage,result:r,stats:e.stats(),state:e.pool.snapshot()}));assert.equal(r.status,'held');assert.ok(!JSON.stringify(r).includes('PRIVATE'));assert.equal(e.stats().starts,['RESERVED','LAUNCHING'].includes(stage)?0:1);
  if(e.stats().starts)assert.equal(r.cleanup,'verified');const replay=await e.runner().run(e.input,e.abort.signal);assert.equal(replay.status,'refused');assert.equal(e.stats().starts,['RESERVED','LAUNCHING'].includes(stage)?0:1);
 }
});
test('result rejection completes only accounting after cleanup; invalid identity and failed cleanup remain held',async()=>{
 for(const mode of ['result','identity','cleanup']){const e=await setup();if(mode==='result'){e.handle.result=Promise.reject(Error('PRIVATE_RESULT'));void e.handle.result.catch(()=>{});}if(mode==='identity')e.handle.identity.launcherId='other';if(mode==='cleanup')e.handle.terminate=async()=>{throw Error('PRIVATE_CLEANUP');};const r=await e.runner().run(e.input,e.abort.signal);assert.equal(r.status,mode==='result'?'rejected':'held');assert.equal(Object.values(e.pool.snapshot().reservations)[0].status,mode==='result'?'COMPLETED':mode==='identity'?'LAUNCHING':'RUNNING');}
});
test('cancelled late start retains and cleans eventual handle; no RUNNING bookkeeping follows closure',async()=>{
 const e=await setup(),late=deferred(),entered=deferred(),base=globalThis[symbol].start;globalThis[symbol].start=async(...args)=>{await base(...args);entered.resolve();return late.promise;};
 const runner=e.runner(),pending=runner.run(e.input,e.abort.signal);await entered.promise;e.abort.abort();const r=await pending;assert.equal(r.status,'held');assert.equal(r.cleanup,'pending');assert.equal(Object.values(e.pool.snapshot().reservations)[0].status,'LAUNCHING');late.resolve(e.handle);await tick();await tick();assert.equal(e.stats().terminates,1);assert.equal(runner.inspect(r.jobId).cleanup,'verified');assert.equal(Object.values(e.pool.snapshot().reservations)[0].status,'LAUNCHING');
});
test('bounded stalled lookup, hostile getter and initial cancellation cannot start or issue grants',async()=>{
 const e=await setup();e.options.lookupGrant=()=>new Promise(()=>{});const before=performance.now();const r=await e.runner().run(e.input,e.abort.signal);assert.equal(r.status,'refused');assert.ok(performance.now()-before<2000);assert.equal(e.stats().starts,0);
 const f=await setup();let gets=0;f.options.lookupGrant=async()=>Object.defineProperty({},'format',{enumerable:true,get(){gets++;throw Error('PRIVATE');}});assert.equal((await f.runner().run(f.input,f.abort.signal)).status,'refused');assert.equal(gets,0);
 const c=await setup();c.abort.abort();assert.equal((await c.runner().run(c.input,c.abort.signal)).status,'refused');assert.equal(c.stats().starts,0);
});


test('exact trusted grant replacement after reservation closes the path and never launches',async()=>{
 const e=await setup();let n=0;e.options.lookupGrant=async()=>{n++;return n<=2?e.grant:{...e.grant,status:'revoked'};};
 const r=await e.runner().run(e.input,e.abort.signal);assert.equal(r.status,'held');assert.equal(e.stats().starts,0);assert.equal(Object.values(e.pool.snapshot().reservations)[0].status,'RESERVED');
});
test('late failed registry settlement is observed after cancellation and cannot resume',async()=>{
 const e=await setup(),pending=deferred(),entered=deferred();e.options.lookupGrant=()=>{entered.resolve();return pending.promise;};
 const run=e.runner().run(e.input,e.abort.signal);await entered.promise;e.abort.abort();assert.equal((await run).status,'refused');pending.reject(Error('PRIVATE_LATE'));await tick();assert.equal(e.stats().starts,0);assert.deepEqual(e.pool.snapshot().reservations,{});
});


test('self-consistent rehashed grants cannot replace task, runtime, artifact or host pins',async()=>{
 for(const patch of [{taskDigest:'f'.repeat(64)},{promptDigest:'f'.repeat(64)},{artifactRevision:'f'.repeat(64)},{nativePath:'/other'},{hostBinding:{installationId:'other'}},{accountBindingDigest:'f'.repeat(64)}]){
  const e=await setup();Object.assign(e.grant,patch);const {revision,...body}=e.grant;e.grant.revision=hash(canonicalJson(body));e.input.grantRevision=e.grant.revision;
  const r=await e.runner().run(e.input,e.abort.signal);assert.equal(r.status,'refused');assert.equal(e.stats().starts,0);assert.deepEqual(e.pool.snapshot().reservations,{});
 }
});
test('changed process identity after RUNNING is held and original terminate capability is retained',async()=>{
 const e=await setup(),output=deferred(),entered=deferred(),base=globalThis[symbol].start;e.handle.result=output.promise;
 globalThis[symbol].start=async(...args)=>{const h=await base(...args);entered.resolve();return h;};
 const run=e.runner().run(e.input,e.abort.signal);await entered.promise;
 while(Object.values(e.pool.snapshot().reservations)[0]?.status!=='RUNNING')await tick();
 e.handle.identity.processRef='changed';e.handle.terminate=async()=>{throw Error('replaced cleanup');};output.resolve('synthetic proposal');
 const result=await run;assert.equal(result.status,'held');assert.equal(result.cleanup,'verified');assert.equal(e.stats().terminates,1);assert.equal(Object.values(e.pool.snapshot().reservations)[0].status,'RUNNING');
});


test('pending cleanup reports uncertainty within its bound and retains eventual verification',async()=>{
 const e=await setup(),cleanup=deferred();e.handle.terminate=()=>cleanup.promise;
 const runner=e.runner(),before=performance.now(),r=await runner.run(e.input,e.abort.signal);
 assert.equal(r.status,'held');assert.equal(r.cleanup,'pending');assert.ok(performance.now()-before<5000);assert.equal(Object.values(e.pool.snapshot().reservations)[0].status,'RUNNING');
 cleanup.resolve();await tick();assert.equal(runner.inspect(r.jobId).cleanup,'verified');assert.equal(Object.values(e.pool.snapshot().reservations)[0].status,'RUNNING');
});


test('private bootstrap must be included in the measured installed closure',async()=>{
 const e=await setup();e.options.artifact.files=e.options.artifact.files.filter(f=>!f.path.endsWith('/qualification-bootstrap.js'));
 assert.throws(()=>e.runner(),/BOOTSTRAP_ARTIFACT/);assert.equal(e.stats().starts,0);
});

test('bootstrap passes its signal to host reader and retains late no-handle read cleanup',async()=>{
 const e=await setup(),entered=deferred(),read=deferred(),cleanup=deferred();let signal;
 e.options.observer={read:async(alias,s)=>{signal=s;entered.resolve();return read.promise;},quiescence:()=>cleanup.promise};
 const runner=e.runner(),pending=runner.run(e.input,e.abort.signal);await entered.promise;e.abort.abort();const r=await pending;
 assert.equal(signal.aborted,true);assert.equal(r.status,'held');assert.equal(r.cleanup,'pending');assert.equal(runner.lifecycle(r.jobId),'pending');let settled=false;const quiet=runner.quiescence(r.jobId).then(v=>{settled=true;return v;});
 read.reject(Error('late private read'));await tick();assert.equal(settled,false);cleanup.resolve({cleanup:'verified'});assert.deepEqual(await quiet,{cleanup:'verified'});assert.equal(e.stats().starts,0);
});
test('bootstrap retains an expired complete core start attempt before a handle, then awaits internal cleanup',async()=>{
 const e=await setup(),entered=deferred(),start=deferred(),cleanup=deferred();const {revision,...body}=e.grant;body.expiresAtMs=Date.now()+400;const grant={...body,revision:hash(canonicalJson(body))};e.options.lookupGrant=async()=>grant;e.input.grantRevision=grant.revision;
 globalThis[symbol].start=async()=>{entered.resolve();return start.promise;};globalThis[symbol].quiescence=()=>cleanup.promise;
 const runner=e.runner(),pending=runner.run(e.input,e.abort.signal);await entered.promise;const r=await pending;assert.equal(r.status,'held');assert.equal(r.cleanup,'pending');assert.equal(runner.lifecycle(r.jobId),'pending');
 let settled=false;const quiet=runner.quiescence(r.jobId).then(v=>{settled=true;return v;});start.reject(Error('late pre-handle rejection'));await tick();assert.equal(settled,false);cleanup.resolve({cleanup:'unverified'});assert.deepEqual(await quiet,{cleanup:'unverified'});assert.equal(runner.lifecycle(r.jobId),'unverified');assert.equal(runner.inspect(r.jobId),null);
 const second=await runner.run({...e.input,operationId:'another-operation'},new AbortController().signal);assert.equal(second.status,'refused');assert.equal(e.stats().terminates,0);
});
test('host reader timeout retains quiescence and cannot create a new operation while uncertain',async()=>{
 const e=await setup(),read=deferred(),cleanup=deferred();let signal;e.options.observer={read:async(alias,s)=>{signal=s;return read.promise;},quiescence:()=>cleanup.promise};const runner=e.runner(),r=await runner.run(e.input,e.abort.signal);assert.equal(signal.aborted,true);assert.equal(r.status,'held');assert.equal(r.cleanup,'pending');const other=await runner.run({...e.input,operationId:'other'},new AbortController().signal);assert.equal(other.status,'refused');read.resolve(observation());cleanup.reject(Error('cleanup refused'));assert.deepEqual(await runner.quiescence(r.jobId),{cleanup:'unverified'});assert.equal(e.stats().starts,0);
});

test('core-start reporting timer closes before a handle without abandoning the start promise',async t=>{
 const e=await setup(),late=deferred(),cleanup=deferred();globalThis[symbol].start=async()=>late.promise;globalThis[symbol].quiescence=()=>cleanup.promise;
 const original=globalThis.setTimeout;t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>original(fn,ms===40000?10:ms,...args));
 const runner=e.runner(),r=await runner.run(e.input,e.abort.signal);assert.equal(r.status,'held');assert.equal(r.cleanup,'pending');assert.equal(runner.lifecycle(r.jobId),'pending');
 const quiet=runner.quiescence(r.jobId);late.reject(Error('late start rejection'));cleanup.resolve({cleanup:'verified'});assert.deepEqual(await quiet,{cleanup:'verified'});assert.equal(runner.inspect(r.jobId),null);assert.equal(e.stats().terminates,0);
});

test('unverified no-handle core remains an explicitly retained cleanup owner after receipt settlement',async()=>{
 const e=await setup(),owners=[];globalThis[symbol].owners=owners;globalThis[symbol].start=async()=>{throw Error('no handle');};globalThis[symbol].quiescence=async()=>({cleanup:'unverified'});
 const runner=e.runner(),r=await runner.run(e.input,e.abort.signal);assert.equal(r.status,'held');assert.equal(runner.inspect(r.jobId),null);assert.deepEqual(await runner.quiescence(r.jobId),{cleanup:'unverified'});await tick();
 assert.equal(runner.retainedCleanupOwners(r.jobId),1);assert.equal(owners.length,1);if(typeof globalThis.gc==='function'){for(let i=0;i<4;i++){globalThis.gc();await tick();}}assert.ok(owners[0].deref());assert.equal(runner.lifecycle(r.jobId),'unverified');
 // A settled no-handle receipt does not clear the retained owner or reopen this bootstrap.
 assert.deepEqual(await runner.quiescence(r.jobId),{cleanup:'unverified'});assert.equal(runner.retainedCleanupOwners(r.jobId),1);assert.equal((await runner.run({...e.input,operationId:'fresh-id'},new AbortController().signal)).status,'refused');
});
test('verified core receipt releases its explicit owner only after complete quiescence',async()=>{
 const e=await setup(),runner=e.runner(),r=await runner.run(e.input,e.abort.signal);assert.equal(r.status,'proposal');assert.deepEqual(await runner.quiescence(r.jobId),{cleanup:'verified'});assert.equal(runner.retainedCleanupOwners(r.jobId),0);
});

test('self-consistent historical policy, route and launch bindings refuse without new admission',async()=>{
 const historicalProposal='44a3f4311e71195a1f420493030a5f1cc23b584f4948ebe37c75498b30c41ab2';
 const patches=[{policyVersion:'codex-subscription-proposal/v0.7-alpha.3'},
 ...['codex:gpt-5.5:low','codex:gpt-5.6-sol:low','codex:gpt-6.1-sol:low','codex:gpt-6-sol:medium'].map(modelRoute=>({modelRoute}))];
 for(const patch of [...patches,{proposalPlanRevision:historicalProposal}]){
  const e=await setup();Object.assign(e.grant,patch);
  if(patch.proposalPlanRevision)e.grant.launchPlanRevision=startupLaunchRevision(historicalProposal,e.options.runtime);
  const {revision,...body}=e.grant;e.grant.revision=hash(canonicalJson(body));e.input.grantRevision=e.grant.revision;
  const r=await e.runner().run(e.input,e.abort.signal);assert.equal(r.status,'refused');assert.equal(e.stats().reads,0);assert.equal(e.stats().starts,0);assert.deepEqual(e.pool.snapshot().reservations,{});
 }
});
test('explicit synthetic policy replacement preserves eight held points and fails closed without historical applicability',async()=>{
 const oldRoute='codex:gpt-5.5:low',now=Date.now();let clock=now;
 const policy={thresholdPercent:95,maxWorkers:2,maxObservationAgeMs:30000,headroomPercent:8,admittedRoutes:[oldRoute],completedResetPolicy:'hold'};
 const pool=memoryPool(createAccount('account',['alias'],policy));
 const admission=new PostgresAdmission(pool,{schema:'trellis_bootstrap',launcherId:'launcher',now:()=>clock});
 const observationFor=route=>({observationId:'route-proof-'+clock,accountId:'account',observedAtMs:clock,authentication:'subscription',ordinaryUsageAllowed:true,windows:{primary:{usedPercent:10,durationMs:600000,resetAtMs:now+300000,accountedThroughMs:null}},routes:{[route]:{requiredWindows:['primary'],optionalWindows:[]}}});
 const request=(jobId,modelRoute)=>({accountAlias:'alias',jobId,candidateRevision:'sha256:'+'a'.repeat(64),modelRoute,role:'worker',attempt:'initial',allowancePercent:{primary:2},paidFallback:false});
 for(let i=0;i<4;i++){
  const jobId='historical-'+i,reserved=await admission.reserve(request(jobId,oldRoute),observationFor(oldRoute));assert.equal(reserved.kind,'accepted');
  const launched=await admission.launchOnce('alias',jobId,reserved.launchPermit,observationFor(oldRoute),async()=>({processRef:'synthetic-'+i}));assert.equal(launched.kind,'started');
  await admission.complete('alias',jobId,{kind:'completed',proofRef:'proof-'+i,observedAtMs:clock,processRef:'synthetic-'+i,fencedLauncherId:null});
 }
 const before=pool.snapshot();assert.equal(Object.values(before.reservations).reduce((n,r)=>n+r.retained.primary.percent,0),8);
 const replacement={...policy,admittedRoutes:[MODEL_ROUTE]};assert.deepEqual(await admission.replacePolicy('alias',policy,replacement),replacement);
 const after=pool.snapshot();assert.deepEqual({...after,policy:before.policy},before);
 assert.equal(Object.values(after.reservations).reduce((n,r)=>n+r.retained.primary.percent,0),8);
 for(const r of Object.values(after.reservations)){assert.equal(r.status,'COMPLETED');assert.equal(r.request.modelRoute,oldRoute);}
 // A stale expected policy may not overwrite a distinct concurrent/current policy.
 await assert.rejects(admission.replacePolicy('alias',policy,{...replacement,headroomPercent:9}),{code:'POLICY_CONFLICT'});
 assert.deepEqual(pool.snapshot(),after);
 const oldDenied=await admission.reserve(request('old-new-request',oldRoute),observationFor(oldRoute));assert.equal(oldDenied.kind,'denied');assert.equal(pool.snapshot().reservations['old-new-request'],undefined);
 clock++;const current=await admission.reserve(request('new-route-request',MODEL_ROUTE),observationFor(MODEL_ROUTE));
 assert.deepEqual(current,{kind:'denied',reason:'UNRESOLVED_RESERVATION_WINDOWS'});assert.equal(pool.snapshot().reservations['new-route-request'],undefined);
 // The current reader only reports the new route. No test invents a production
 // bridge, drops the historical applicability check, or releases the eight points.
 for(const [id,r] of Object.entries(before.reservations))assert.deepEqual(pool.snapshot().reservations[id],r);
});

// Stage B: actual private composition/admission, with the existing explicitly synthetic core.
const OLD_ACCOUNTING_ROUTE='codex:gpt-5.5:low';
const accountingHelperPath='dist/packages/codex-adapter/src/historical-accounting.js';
const applicability=()=>({requiredWindows:['primary'],optionalWindows:['secondary']});
function rehashGrant(e){const {revision,...body}=e.grant;e.grant.revision=hash(canonicalJson(body));e.input.grantRevision=e.grant.revision;}
function rehashAccounting(e){const {revision,...body}=e.grant.historicalAccounting;e.grant.historicalAccounting={...body,revision:hash(canonicalJson(body))};e.grant.historicalAccountingRevision=e.grant.historicalAccounting.revision;rehashGrant(e);}
async function setupAccounting({historical=true}={}){
 const e=await setup();e.options.binding.optionalWindows=['secondary'];e.grant.accountBindingDigest=codexBoundaryAccountRevision(e.options.binding,'alias');
 e.options.artifact.files.push({path:accountingHelperPath,sha256:hash(await readFile(accountingHelperPath))});e.grant.artifactRevision=codexArtifactRevision(e.options.artifact);
 const epoch=Date.now(),resetAtMs=epoch+300000,events=[],controls=[];
 const sample=(route=MODEL_ROUTE)=>{const now=Date.now();return{observationId:'v2-sample-'+now,accountId:'account',observedAtMs:now,authentication:'subscription',ordinaryUsageAllowed:true,windows:{primary:{usedPercent:10,durationMs:600000,resetAtMs,accountedThroughMs:null},secondary:null},routes:{[route]:applicability()}};};
 const basePolicy=e.pool.snapshot().policy,oldPolicy={...basePolicy,thresholdPercent:95,headroomPercent:8,admittedRoutes:[OLD_ACCOUNTING_ROUTE]};
 await e.options.admission.replacePolicy('alias',basePolicy,oldPolicy);
 if(historical)for(let i=0;i<4;i++){
  await delay(2);const jobId='accounting-old-'+i,request={accountAlias:'alias',jobId,candidateRevision:digest('synthetic-history'),modelRoute:OLD_ACCOUNTING_ROUTE,role:'worker',attempt:'initial',allowancePercent:{primary:2},paidFallback:false};
  const observed=sample(OLD_ACCOUNTING_ROUTE),reserved=await e.options.admission.reserve(request,observed);assert.equal(reserved.kind,'accepted');
  assert.equal((await e.options.admission.launchOnce('alias',jobId,reserved.launchPermit,observed,async()=>({processRef:'history-'+i}))).kind,'started');
  await e.options.admission.complete('alias',jobId,{kind:'completed',proofRef:'history-complete-'+i,observedAtMs:Date.now(),processRef:'history-'+i,fencedLauncherId:null});
 }
 await e.options.admission.replacePolicy('alias',oldPolicy,{...oldPolicy,admittedRoutes:[MODEL_ROUTE]});await delay(2);
 const before=e.pool.snapshot(),now=Date.now();
 const binding={format:'bowerloom/codex-historical-accounting/v1',status:'active',reviewRevision:e.grant.reviewRevision,issuedAtMs:now-1000,expiresAtMs:now+60000,hostBinding:structuredClone(e.grant.hostBinding),accountBindingDigest:e.grant.accountBindingDigest,currentPolicyVersion:POLICY_VERSION,currentModelRoute:MODEL_ROUTE,historicalModelRoute:OLD_ACCOUNTING_ROUTE,requiredWindows:['primary'],optionalWindows:['secondary'],historicalEvidence:{ledgerObservationSha256:hash(canonicalJson(before)),ledgerChecksum:digest(canonicalJson(before)),reservationsDigest:hash(canonicalJson(Object.keys(before.reservations).sort().map(id=>before.reservations[id]))),reservationCount:4,retainedPrimaryPercent:8},oldLaunchAuthorized:false,coverageReleaseAttested:false};
 e.grant.format='bowerloom/codex-qualification-grant/v2';e.grant.historicalAccounting={...binding,revision:hash(canonicalJson(binding))};e.grant.historicalAccountingRevision=e.grant.historicalAccounting.revision;rehashGrant(e);
 let readCount=0,registryCount=0,coreStarts=0,consumed;
 e.options.observer={async read(alias,signal){readCount++;events.push({kind:'reader',readCount,signalAborted:signal.aborted});return sample();},async quiescence(){return{cleanup:'verified'};}};
 e.options.lookupGrant=async()=>{registryCount++;events.push({kind:'registry',registryCount});return e.grant;};
 const reserve=e.options.admission.reserveControlled.bind(e.options.admission),launch=e.options.admission.launchOnceControlled.bind(e.options.admission);
 e.options.admission.reserveControlled=async(request,observation,control)=>{events.push({kind:'reserve',observation:structuredClone(observation)});controls.push(control);return reserve(request,observation,control);};
 e.options.admission.launchOnceControlled=async(alias,id,permit,observation,callback,control)=>{events.push({kind:'claim',observation:structuredClone(observation)});controls.push(control);return launch(alias,id,permit,observation,(request,gate)=>callback(request,{check:async fresh=>{events.push({kind:'gate',observation:structuredClone(fresh)});return gate.check(fresh);},consume:()=>gate.consume()}),control);};
 const plan=planCodexProposalLaunch({version:e.options.installation.version,nativeSha256:e.options.installation.nativeSha256});
 const prepare=input=>({launcherId:input.launcherId,accountBindingDigest:e.grant.accountBindingDigest,promptDigest:hash(proposalPrompt(input.taskInput)),modelRoute:MODEL_ROUTE,launchPlanRevision:plan.revision});
 globalThis[symbol].start=async(opts,gate,input,signal)=>{
  coreStarts++;await gate.check(signal);await gate.check(signal,sample());gate.assertCurrent(signal);consumed=gate.consume(prepare(input),signal);return e.handle;
 };
 const original=e.stats;
 return Object.assign(e,{sample,before,events,controls,prepare,stats:()=>({...original(),readCount,registryCount,coreStarts,consumed})});
}
function assertHistory(e){for(const [id,reservation] of Object.entries(e.before.reservations))assert.deepEqual(e.pool.snapshot().reservations[id],reservation);assert.equal(Object.keys(e.before.reservations).length,4);assert.equal(Object.keys(e.before.reservations).reduce((n,id)=>n+e.pool.snapshot().reservations[id].retained.primary.percent,0),8);}
function currentRow(e){return Object.values(e.pool.snapshot().reservations).find(r=>r.request.modelRoute===MODEL_ROUTE);}

test('v1 keeps its exact schema and never imports or requires the accounting helper',async()=>{
 const e=await setup();assert.equal(e.options.artifact.files.some(f=>f.path===accountingHelperPath),false);let imports=0;
 const h=registerHooks({resolve(spec,context,next){if(spec==='./historical-accounting.js'&&context.parentURL?.endsWith('/qualification-bootstrap.js')){imports++;throw Error('v1 must not import helper');}return next(spec,context);}});
 try{assert.equal((await e.runner().run(e.input,e.abort.signal)).status,'proposal');assert.equal(imports,0);}finally{h.deregister();}
 for(const field of ['historicalAccounting','historicalAccountingRevision']){const f=await setup();f.grant[field]=field==='historicalAccounting'?{}:'a'.repeat(64);rehashGrant(f);assert.equal((await f.runner().run(f.input,f.abort.signal)).status,'refused');assert.equal(f.stats().reads,0);}
});
test('v2 projects outer reserve/claim and internal fresh/fallback samples; retains eight and denies replay',async()=>{
 const e=await setupAccounting(),runner=e.runner(),r=await runner.run(e.input,e.abort.signal);assert.equal(r.status,'proposal',JSON.stringify({r,events:e.events,errors:e.stats().errors}));assertHistory(e);
 const paths=e.events.filter(x=>['reserve','claim','gate'].includes(x.kind));assert.deepEqual(paths.map(x=>x.kind),['reserve','claim','gate','gate']);
 for(const {observation:o} of paths){assert.deepEqual(o.routes,{[MODEL_ROUTE]:applicability(),[OLD_ACCOUNTING_ROUTE]:applicability()});assert.equal(o.windows.primary.accountedThroughMs,null);assert.equal(o.windows.secondary,null);assert.equal(o.accountId,'account');}
 assert.equal(e.stats().readCount,3);assert.equal(e.stats().coreStarts,1);assert.ok(e.stats().registryCount>=5);assert.equal(r.cleanup,'verified');
 const replay=await runner.run(e.input,e.abort.signal);assert.equal(replay.status,'refused');assert.equal(e.stats().coreStarts,1);assertHistory(e);
});
test('valid v1 still holds on historical charges instead of silently projecting them',async()=>{
 const e=await setupAccounting();e.grant.format='bowerloom/codex-qualification-grant/v1';delete e.grant.historicalAccounting;delete e.grant.historicalAccountingRevision;rehashGrant(e);
 const r=await e.runner().run(e.input,e.abort.signal);assert.equal(r.status,'refused');assert.equal(e.stats().coreStarts,0);assert.equal(currentRow(e),undefined);assertHistory(e);
});
test('v2 strict nested authority mismatches refuse before observers, including self-consistent revision mutations',async()=>{
 const mutations=[e=>delete e.grant.historicalAccounting,e=>delete e.grant.historicalAccountingRevision,e=>e.grant.format='bowerloom/codex-qualification-grant/v3',e=>e.grant.extra=true,
 e=>e.grant.historicalAccountingRevision='f'.repeat(64),e=>{e.grant.historicalAccounting.hostBinding.launcherId='other';rehashAccounting(e);},e=>{e.grant.historicalAccounting.accountBindingDigest='f'.repeat(64);rehashAccounting(e);},
 e=>{e.grant.historicalAccounting.reviewRevision='f'.repeat(64);rehashAccounting(e);},e=>{e.grant.historicalAccounting.currentModelRoute=OLD_ACCOUNTING_ROUTE;rehashAccounting(e);},e=>{e.grant.historicalAccounting.extra=true;rehashAccounting(e);}];
 for(const mutate of mutations){const e=await setupAccounting();mutate(e);rehashGrant(e);const r=await e.runner().run(e.input,e.abort.signal);assert.equal(r.status,'refused');assert.equal(e.stats().readCount,0);assert.equal(e.stats().coreStarts,0);assert.equal(currentRow(e),undefined);assertHistory(e);}
});
test('v2 refuses missing or wrong measured helper entry before any reader/admission action',async()=>{
 for(const kind of ['missing','hash']){const e=await setupAccounting();if(kind==='missing')e.options.artifact.files=e.options.artifact.files.filter(f=>f.path!==accountingHelperPath);else e.options.artifact.files.find(f=>f.path===accountingHelperPath).sha256='f'.repeat(64);
 e.grant.artifactRevision=codexArtifactRevision(e.options.artifact);rehashGrant(e);const r=await e.runner().run(e.input,e.abort.signal);assert.equal(r.status,'refused');assert.equal(e.stats().readCount,0);assert.equal(e.events.some(x=>x.kind==='reserve'),false);assertHistory(e);}
});
test('v2 grant and binding expiry minimum narrows control and consumed original authorization',async()=>{
 for(const earlier of ['grant','binding']){const e=await setupAccounting(),expiry=Date.now()+10000;if(earlier==='grant')e.grant.expiresAtMs=expiry;else e.grant.historicalAccounting.expiresAtMs=expiry;rehashAccounting(e);
 const r=await e.runner().run(e.input,e.abort.signal);assert.equal(r.status,'proposal');assert.ok(e.controls.length>=2);for(const c of e.controls)assert.equal(c.binding.expiresAtMs,expiry);
 const envelope=e.stats().consumed.admission;assert.equal(envelope.binding.expiresAtMs,expiry);assert.ok(envelope.notAfterWallMs<=expiry);assertHistory(e);}
});

for(const boundary of ['reserve','claim','fallback','fresh'])for(const bad of ['coverage','secondary','missing-secondary','conflict'])test('v2 '+boundary+' refuses '+bad+' before downstream admission and preserves history',async()=>{
 const e=await setupAccounting();const poison=o=>{if(bad==='coverage')o.windows.primary.accountedThroughMs=Date.now()-1;else if(bad==='secondary')o.windows.secondary={...o.windows.primary};else if(bad==='missing-secondary')delete o.windows.secondary;else o.routes[OLD_ACCOUNTING_ROUTE]={requiredWindows:['primary'],optionalWindows:[]};return o;};
 const original=e.options.observer.read;let reads=0;e.options.observer.read=async(...args)=>{const o=await original(...args);reads++;return reads===({reserve:1,claim:2,fallback:3}[boundary])?poison(o):o;};
 if(boundary==='fresh')globalThis[symbol].start=async(opts,gate,input,signal)=>{await gate.check(signal,poison(e.sample()));throw Error('unreachable synthetic start');};
 const r=await e.runner().run(e.input,e.abort.signal);assert.equal(r.status,'held');assertHistory(e);
 const calls=e.events.filter(x=>['reserve','claim','gate'].includes(x.kind)).map(x=>x.kind);
 assert.deepEqual(calls,boundary==='reserve'?[]:boundary==='claim'?['reserve']:['reserve','claim']);
 assert.equal(currentRow(e)?.status,boundary==='reserve'?undefined:boundary==='claim'?'RESERVED':'LAUNCHING');assert.equal(e.stats().consumed,undefined);
});
test('v2 immutable full grant refresh refuses nested registry drift after reservation',async()=>{
 const e=await setupAccounting(),original=e.options.lookupGrant;let reads=0;e.options.lookupGrant=async()=>{const g=await original();reads++;if(reads===3){g.historicalAccounting.historicalEvidence.reservationsDigest='f'.repeat(64);rehashAccounting(e);}return g;};
 const r=await e.runner().run(e.input,e.abort.signal);assert.equal(r.status,'held');assert.equal(currentRow(e).status,'RESERVED');assert.equal(e.stats().coreStarts,0);assertHistory(e);
});
test('v2 registry revocation during internal fresh gate holds LAUNCHING and never consumes',async()=>{
 const e=await setupAccounting(),base=globalThis[symbol].start;globalThis[symbol].start=async(...args)=>{e.grant.status='revoked';rehashGrant(e);return base(...args);};
 const r=await e.runner().run(e.input,e.abort.signal);assert.equal(r.status,'held');assert.equal(currentRow(e).status,'LAUNCHING');assert.equal(e.stats().consumed,undefined);assertHistory(e);
});
test('v2 observed overlapping reset is refused by unchanged admission without rewriting high-water or history',async()=>{
 const e=await setupAccounting();e.options.observer.read=async()=>{const o=e.sample();o.windows.primary.resetAtMs+=100000;return o;};
 const r=await e.runner().run(e.input,e.abort.signal);assert.equal(r.status,'refused');assert.equal(currentRow(e),undefined);assert.deepEqual(e.pool.snapshot().highWater,e.before.highWater);assertHistory(e);
});
test('v2 binding expiry during pending observer cancels and observes late settlement with no reservation',async()=>{
 const e=await setupAccounting(),pending=deferred(),entered=deferred();e.grant.historicalAccounting.expiresAtMs=Date.now()+300;rehashAccounting(e);
 let signal;e.options.observer={read:async(alias,s)=>{signal=s;entered.resolve();return pending.promise;},async quiescence(){return{cleanup:'verified'};}};
 const runner=e.runner(),running=runner.run(e.input,e.abort.signal);await entered.promise;const r=await running;assert.equal(r.status,'held');assert.equal(signal.aborted,true);assert.equal(currentRow(e),undefined);assertHistory(e);
 pending.resolve(e.sample());assert.deepEqual(await runner.quiescence(r.jobId),{cleanup:'verified'});assert.equal(e.events.some(x=>x.kind==='reserve'),false);assert.equal((await runner.run(e.input,e.abort.signal)).status,'refused');
});
test('v2 binding expiry during pending registry refresh retains reservation after late rejection',async()=>{
 const e=await setupAccounting(),pending=deferred(),entered=deferred(),base=e.options.lookupGrant;let count=0;e.grant.historicalAccounting.expiresAtMs=Date.now()+300;rehashAccounting(e);
 e.options.lookupGrant=async()=>{const g=await base();if(++count===3){entered.resolve();return pending.promise;}return g;};
 const runner=e.runner(),running=runner.run(e.input,e.abort.signal);await entered.promise;const r=await running;assert.equal(r.status,'held');assert.equal(currentRow(e).status,'RESERVED');assert.equal(e.stats().coreStarts,0);
 pending.reject(Error('PRIVATE_LATE_REGISTRY'));await tick();assertHistory(e);assert.equal((await runner.run(e.input,e.abort.signal)).status,'refused');
});
test('v2 fixed helper import shares existing artifact deadline and cannot resume after late completion',async()=>{
 const e=await setupAccounting(),pending=deferred(),entered=deferred();e.grant.historicalAccounting.expiresAtMs=Date.now()+300;rehashAccounting(e);
 globalThis[symbol].importBarrier=pending.promise;globalThis[symbol].importEntered=()=>entered.resolve();
 const source=`globalThis[${JSON.stringify(symbol)}].importEntered();await globalThis[${JSON.stringify(symbol)}].importBarrier;export {captureHistoricalAccounting,projectHistoricalAccounting} from ${JSON.stringify(pathToFileURL(resolve(accountingHelperPath)).href)};`;
 const url='data:text/javascript,'+encodeURIComponent(source),hook=registerHooks({resolve(spec,context,next){if(spec==='./historical-accounting.js'&&context.parentURL?.endsWith('/qualification-bootstrap.js'))return{url,shortCircuit:true};return next(spec,context);}});
 try{const runner=e.runner(),running=runner.run(e.input,e.abort.signal);await entered.promise;const r=await running;assert.equal(r.status,'refused');assert.equal(e.stats().readCount,0);pending.resolve();await tick();await tick();assert.equal(currentRow(e),undefined);assertHistory(e);assert.equal((await runner.run(e.input,e.abort.signal)).status,'refused');}
 finally{pending.resolve();hook.deregister();delete globalThis[symbol].importBarrier;delete globalThis[symbol].importEntered;}
});
test('v2 refused fixed helper import cannot fall back to unmeasured or v1 accounting',async()=>{
 const e=await setupAccounting(),hook=registerHooks({resolve(spec,context,next){if(spec==='./historical-accounting.js'&&context.parentURL?.endsWith('/qualification-bootstrap.js'))throw Error('PRIVATE_IMPORT');return next(spec,context);}});
 try{const r=await e.runner().run(e.input,e.abort.signal);assert.equal(r.status,'refused');assert.equal(e.stats().readCount,0);assert.equal(currentRow(e),undefined);assertHistory(e);}finally{hook.deregister();}
});
test('v2 synchronous expiry or clock regression before consume closes permanently with no authorization',async t=>{
 for(const mode of ['expired','backwards']){const e=await setupAccounting();let consumes=0;globalThis[symbol].start=async(opts,gate,input,signal)=>{
  await gate.check(signal,e.sample());const now=Date.now();const mocked=t.mock.method(Date,'now',()=>mode==='expired'?e.grant.historicalAccounting.expiresAtMs:now-10000);
  try{const auth=gate.consume(e.prepare(input),signal);consumes++;return e.handle;}finally{mocked.mock.restore();}
 };
 const r=await e.runner().run(e.input,e.abort.signal);assert.equal(r.status,'held');assert.equal(consumes,0);assert.equal(currentRow(e).status,'LAUNCHING');assertHistory(e);}
});
test('v2 cancellation after consume retains and cleans late handle; no RUNNING accounting or retry follows',async()=>{
 const e=await setupAccounting(),start=deferred(),entered=deferred(),base=globalThis[symbol].start;globalThis[symbol].start=async(...args)=>{const handle=await base(...args);entered.resolve();await start.promise;return handle;};
 const runner=e.runner(),running=runner.run(e.input,e.abort.signal);await entered.promise;e.abort.abort();const r=await running;assert.equal(r.status,'held');assert.equal(r.cleanup,'pending');assert.equal(currentRow(e).status,'LAUNCHING');start.resolve();
 assert.deepEqual(await runner.quiescence(r.jobId),{cleanup:'verified'});assert.equal(e.stats().terminates,1);assert.equal(currentRow(e).status,'LAUNCHING');assertHistory(e);assert.equal((await runner.run(e.input,e.abort.signal)).status,'refused');
});
test('v2 internal fresh conflict with existing observation identity stays held without releasing history',async()=>{
 const e=await setupAccounting();globalThis[symbol].start=async(opts,gate,input,signal)=>{
  const before=e.pool.snapshot().observation,conflict=structuredClone(before);delete conflict.routes[OLD_ACCOUNTING_ROUTE];conflict.windows.primary.usedPercent++;
  await gate.check(signal,conflict);throw Error('unreachable');
 };
 const r=await e.runner().run(e.input,e.abort.signal);assert.equal(r.status,'held');assert.equal(currentRow(e).status,'LAUNCHING');assert.equal(e.stats().consumed,undefined);assertHistory(e);
});
test('v2 helper import cannot obtain another timeout beyond the existing two-second artifact budget',async()=>{
 const e=await setupAccounting(),pending=deferred(),entered=deferred();globalThis[symbol].artifactDeadlineBarrier=pending.promise;globalThis[symbol].artifactDeadlineEntered=()=>entered.resolve();
 const source=`globalThis[${JSON.stringify(symbol)}].artifactDeadlineEntered();await globalThis[${JSON.stringify(symbol)}].artifactDeadlineBarrier;export {captureHistoricalAccounting,projectHistoricalAccounting} from ${JSON.stringify(pathToFileURL(resolve(accountingHelperPath)).href)};`;
 const url='data:text/javascript,'+encodeURIComponent(source),hook=registerHooks({resolve(spec,context,next){if(spec==='./historical-accounting.js'&&context.parentURL?.endsWith('/qualification-bootstrap.js'))return{url,shortCircuit:true};return next(spec,context);}});
 try{const runner=e.runner(),start=performance.now(),running=runner.run(e.input,e.abort.signal);await entered.promise;const r=await running;
  assert.equal(r.status,'refused');assert.ok(performance.now()-start>=1900);assert.ok(performance.now()-start<4000);assert.equal(e.stats().readCount,0);assert.ok(Date.now()<e.grant.historicalAccounting.expiresAtMs);
  pending.reject(Error('PRIVATE_LATE_IMPORT'));await tick();assert.equal(currentRow(e),undefined);assertHistory(e);assert.equal((await runner.run(e.input,e.abort.signal)).status,'refused');
 }finally{pending.resolve();hook.deregister();delete globalThis[symbol].artifactDeadlineBarrier;delete globalThis[symbol].artifactDeadlineEntered;}
});
test('v2 cannot substitute an artifact root different from the executing bootstrap',async()=>{
 const e=await setupAccounting();e.options.artifact.root=resolve('synthetic-other-root');assert.throws(()=>e.runner(),/BOOTSTRAP_ARTIFACT/);assert.equal(e.stats().readCount,0);assertHistory(e);
});
