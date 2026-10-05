// Deterministic fixture-only module substitution. No production factory override or model process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
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
const fixture='data:text/javascript,'+encodeURIComponent(`export const proposalPrompt=globalThis['${symbol}'].proposalPrompt;export class CodexAdapterCore{constructor(options,gate){this.options=options;this.gate=gate;}start(input,signal){return globalThis['${symbol}'].start(this.options,this.gate,input,signal);}}`);
const hook=registerHooks({resolve(specifier,context,next){if(specifier==='./adapter-core.js'&&context.parentURL?.endsWith('/qualification-bootstrap.js'))return{url:fixture,shortCircuit:true};return next(specifier,context);}});
const {QualificationBootstrap}=await import('../../../dist/packages/codex-adapter/src/qualification-bootstrap.js');hook.deregister();
const paths=['qualification-bootstrap','index','adapter-core','boundary','startup-deadline','installation','policy','protocol','reader','observation','safe','supervisor','guardian'].map(n=>`dist/packages/codex-adapter/src/${n}.js`).concat(['dist/packages/broker/src/index.js','dist/packages/contracts/src/index.js','dist/packages/mcp-connections/src/darwin-boot-session.js','dist/packages/mcp-connections/src/model.js']);
function memoryPool(){
 const policy={thresholdPercent:75,maxWorkers:2,maxObservationAgeMs:5000,headroomPercent:5,admittedRoutes:[MODEL_ROUTE],completedResetPolicy:'hold'};
 let stored=createAccount('account',['alias'],policy),tail=Promise.resolve();
 const pool={queries:[],hook:null,snapshot:()=>structuredClone(stored),async connect(){const before=tail,lock=deferred();tail=lock.promise;await before;let staged,released=false;const c=new EventEmitter();c.release=()=>{assert.equal(released,false);released=true;lock.resolve();};c.query=async(sql,v)=>{
  pool.queries.push(sql);const execute=()=>{if(sql.startsWith('BEGIN'))staged=structuredClone(stored);else if(sql.startsWith('SET LOCAL')){}else if(sql==='SELECT current_database() AS name')return{rows:[{name:'synthetic'}]};else if(sql.includes('.metadata FOR SHARE'))return{rows:[{singleton:true,version:1}]};else if(sql.includes('WHERE account_id=(SELECT'))return{rows:[{account_id:staged.accountId,version:1,state:structuredClone(staged),checksum:digest(canonicalJson(staged))}]};else if(sql.startsWith('UPDATE'))staged=JSON.parse(v[1]);else if(sql==='COMMIT')stored=structuredClone(staged);else if(sql==='ROLLBACK')staged=undefined;else throw Error('fixture SQL');return{rows:[]};};if(pool.hook){const r=await pool.hook(sql,v,execute);if(r!==undefined)return r;}return execute();};return c;}};return pool;
}
function observation(){const now=Date.now();return{observationId:'sample-'+now,accountId:'account',observedAtMs:now,authentication:'subscription',ordinaryUsageAllowed:true,windows:{primary:{usedPercent:10,durationMs:600000,resetAtMs:now+300000,accountedThroughMs:null}},routes:{[MODEL_ROUTE]:{requiredWindows:['primary'],optionalWindows:[]}}};}
async function setup(){
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
  const runner=e.runner(),r=await runner.run(e.input,e.abort.signal);assert.equal(fired,true);assert.equal(r.status,'held');assert.ok(!JSON.stringify(r).includes('PRIVATE'));assert.equal(e.stats().starts,['RESERVED','LAUNCHING'].includes(stage)?0:1);
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
