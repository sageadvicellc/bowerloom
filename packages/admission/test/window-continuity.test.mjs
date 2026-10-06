import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PostgresAdmission, createAccount, acceptObservation, evaluateAdmission, evaluateLaunch, planWindowContinuity } from '../../../dist/packages/admission/src/index.js';
import { continuityEnvelopes, continuityInspection, continuityPlanCopy, continuityCapability, validateContinuityMutation } from '../../../dist/packages/admission/src/window-continuity.js';
import { stateCopy } from '../../../dist/packages/admission/src/validation.js';
import { canonicalJson, digest } from '../../../dist/packages/contracts/src/index.js';
import { policy, observation, request, proof } from './fixtures.mjs';
const hash=x=>digest(canonicalJson(x));
const scope={installationId:'installation',databaseName:'synthetic_db',admissionSchema:'trellis_continuity',launcherId:'launcher',accountId:'account',accountAlias:'alias'};
function fixture(floor=58,used=25,oldRoute='codex-test'){
 const origin=createAccount('account',['alias'],policy({thresholdPercent:95,headroomPercent:8,admittedRoutes:[...new Set(['codex-test',oldRoute])]}));
 origin.observation=observation();origin.observation.windows.primary.usedPercent=floor;
 origin.highWater={primary:{usedPercent:floor,resetAtMs:100000,durationMs:100000}};
 for(let i=0;i<4;i++){
  const r=request('alias',`old-${i}`,{allowancePercent:{primary:2},modelRoute:oldRoute}),requestDigest=hash(r),end=20000+i;
  origin.reservations[r.jobId]={request:r,requestDigest,reservationId:hash({accountId:'account',jobId:r.jobId,requestDigest}),status:'COMPLETED',createdAtMs:11000,claimedAtMs:12000,launcherId:'old-launcher',completedAtMs:end,processRef:`process-${i}`,permitHash:null,retained:{primary:{percent:2,resetAtMs:100000+i,durationMs:100000}},proofs:[proof('completed',end,`process-${i}`)]};
 }
 const sample=observation('account',60000);sample.windows.primary={usedPercent:used,resetAtMs:150000,durationMs:100000,accountedThroughMs:null};
 const evidence={receiptId:'receipt',receiptRevision:digest('receipt'),artifactRevision:digest('artifact'),nativeRevision:digest('native'),accountBindingRevision:digest('account-binding')};
 const input={operationId:'operation',scope,observation:sample,evidence,sourceRevision:digest('source'),reviewRevision:digest('review')};
 const plan=planWindowContinuity(origin,input,60001);
 const a={format:'bowerloom/window-continuity-approval/v1',purpose:'window-continuity',approvalId:'approval',planRevision:plan.revision,resultCoreDigest:plan.resultCoreDigest,scope,principalId:'operator',approverId:'founder',ownerEpoch:1,issuedAtMs:60000,expiresAtMs:65000,leaseExpiresAtMs:65000};
 const approval={...a,approvalRevision:hash(a)},envelopes=continuityEnvelopes(plan,approval);
 return {origin,input,plan,approval,sample,evidence,...envelopes};
}
// A transactional protocol fixture, not a PostgreSQL concurrency qualification.
function storeFixture(f,options={}){
 let stored=structuredClone(options.state??f.origin),commits=0,updates=0,connects=0;
 const log=[],releases=[];let tail=Promise.resolve();
 const pool={async connect(){connects++;const previous=tail;let unlock;tail=new Promise(r=>unlock=r);await previous;
  const c=new EventEmitter();let staged=structuredClone(stored);c.release=discard=>{releases.push(discard);unlock();};
  c.query=async(sql,values)=>{log.push(sql);await options.beforeQuery?.(sql,{stored,staged,commits});
   if(sql==='SELECT current_database() AS name')return{rows:[{name:options.database??'synthetic_db'}]};
   if(sql.includes('.metadata FOR SHARE'))return{rows:[{singleton:true,version:1}]};
   if(sql.includes('WHERE account_id=(SELECT'))return{rows:[{account_id:stored.accountId,version:options.rowVersion??staged.version,state:staged,checksum:options.checksum??hash(staged)}]};
   if(sql.startsWith('SELECT alias'))return{rows:(options.aliases??stored.aliases).map(alias=>({alias}))};
   if(sql.startsWith('UPDATE')){if(options.casZero)return{rows:[],rowCount:0};updates++;staged=JSON.parse(values[1]);return{rows:[],rowCount:1};}
   if(sql==='COMMIT'){commits++;stored=staged;await options.afterCommit?.(commits);if(options.loseCommit===commits)throw Error('PRIVATE_COMMIT_PAYLOAD');}
   return{rows:[]};
  };return c;
 }};
 const authority={resolveApproval:async()=>f.approval,readObservation:async()=>({observation:f.sample,evidence:f.evidence}),assertCurrent:()=>{},...options.authority};
 const store=new PostgresAdmission(pool,{schema:scope.admissionSchema,launcherId:scope.launcherId,now:options.now??(()=>60001),controlIdentity:{installationId:scope.installationId,databaseName:scope.databaseName},...(options.noAuthority?{}:{continuityAuthority:authority})});
 return{store,log,releases,state:()=>structuredClone(stored),counts:()=>({commits,updates,connects})};
}
const signal=()=>new AbortController().signal;
const code=expected=>e=>{assert.equal(e.code,expected);assert.doesNotMatch(e.message,/PRIVATE_/);return true;};
function control(r){return {signal:signal(),assert(){},binding:{...scope,requestDigest:hash(r),authorizationRevision:'a'.repeat(64),expiresAtMs:65000}};}

test('v1 origin bytes, protected histories and deterministic full envelopes survive v2 transition',()=>{
 const f=fixture();assert.deepEqual(stateCopy(f.origin),f.origin);assert.deepEqual(continuityPlanCopy(f.plan),f.plan);
 assert.deepEqual(continuityEnvelopes(f.plan,f.approval),{held:f.held,applied:f.applied});
 for(const s of [f.held,f.applied]){assert.deepEqual(stateCopy(s),s);assert.deepEqual(s.reservations,f.origin.reservations);assert.deepEqual(s.continuity.plan.originState,f.origin);}
 assert.equal(continuityInspection(f.applied).totalBasisPoints,9900);assert.equal(continuityInspection(f.applied).effectsAuthorized,false);
});
test('additive 99 percent, threshold equality and over100 charges refuse without clamping',()=>{
 for(const [floor,used,total] of [[58,25,9900],[54,25,9500],[90,30,13600]]){
  const f=fixture(floor,used),r=request();assert.equal(continuityInspection(f.applied).totalBasisPoints,total);
  assert.equal(evaluateAdmission(f.applied,r,60001).reason,'CAPACITY_LIMIT');assert.equal(evaluateLaunch(f.applied,r,60001).reason,'CAPACITY_LIMIT');
 }
});
test('lower observations cannot reduce peak, jitter cannot chain, and coverage/window changes refuse',()=>{
 const f=fixture(),lower=structuredClone(f.sample);lower.observationId='lower';lower.observedAtMs=60002;lower.windows.primary.usedPercent=0;
 const accepted=acceptObservation(f.applied,lower,60002);assert.equal(accepted.accepted,true);assert.equal(accepted.state.highWater.primary.usedPercent,25);assert.equal(continuityInspection(accepted.state).totalBasisPoints,9900);
 for(const change of [x=>x.windows.primary.accountedThroughMs=60000,x=>x.windows.secondary=x.windows.primary,x=>delete x.windows.secondary,x=>x.windows.extra=null,x=>x.windows.primary.durationMs++,x=>x.windows.primary.resetAtMs+=1001,x=>x.windows.primary.resetAtMs+=100000]){
  const n=structuredClone(lower);change(n);assert.equal(acceptObservation(accepted.state,n,60002).accepted,false);
 }
 lower.windows.primary.resetAtMs+=1000;const jitter=acceptObservation(f.applied,lower,60002);assert.equal(jitter.accepted,true);assert.equal(jitter.state.highWater.primary.resetAtMs,150000);
 lower.observationId='chained';lower.observedAtMs++;lower.windows.primary.resetAtMs++;assert.equal(acceptObservation(jitter.state,lower,60003).accepted,false);
});
test('missing old route applicability still refuses independently of the new route',()=>{
 const f=fixture(1,0,'historical-route');
 assert.equal(evaluateLaunch(f.applied,request(),60001).reason,'UNRESOLVED_RESERVATION_WINDOWS');
});
test('closed schemas, getters, proxies, mixed versions and protected mutation refuse',()=>{
 const f=fixture();let touched=0;
 const getter=Object.defineProperty({},'version',{enumerable:true,get(){touched++;return 2;}});assert.throws(()=>stateCopy(getter));
 const proxy=new Proxy(f.applied,{ownKeys(){touched++;return[];}});assert.throws(()=>stateCopy(proxy));assert.equal(touched,0);
 for(const change of [x=>x.version=1,x=>x.extra=true,x=>x.continuity.phase='OTHER',x=>x.continuity.plan.historicalFloorBasisPoints--,x=>x.reservations['old-0'].retained={},x=>x.reservations['old-0'].proofs[0].proofRef='changed',x=>x.policy.headroomPercent=0]){const n=structuredClone(f.applied);change(n);assert.throws(()=>stateCopy(n));}
 const lowered=structuredClone(f.applied);lowered.highWater.primary.usedPercent=24;assert.throws(()=>validateContinuityMutation(f.applied,lowered));
 assert.throws(()=>planWindowContinuity(f.origin,{...f.input,extra:true},60001));
 const active=structuredClone(f.origin);active.reservations.extra={};assert.throws(()=>planWindowContinuity(active,f.input,60001));
});
test('complete two-commit application pins exact origin; inspector does not write; replay refuses',async()=>{
 const f=fixture(),m=storeFixture(f);const result=await m.store.applyWindowContinuity(f.plan,'approval',signal());
 assert.equal(result.phase,'APPLIED');assert.deepEqual(m.state(),f.applied);assert.deepEqual(m.counts(),{commits:2,updates:2,connects:2});
 const updates=m.counts().updates;assert.equal((await m.store.inspectWindowContinuity('alias')).phase,'APPLIED');assert.equal(m.counts().updates,updates);
 await assert.rejects(m.store.applyWindowContinuity(f.plan,'approval',signal()),code('CONTINUITY_CONFLICT'));assert.deepEqual(m.state(),f.applied);
});
test('HELD rejects every ordinary path before writes or callbacks',async()=>{
 const f=fixture(),m=storeFixture(f,{state:f.held}),r=request('alias','new');let starts=0;
 const calls=[()=>m.store.observe('alias',f.sample),()=>m.store.policy('alias'),()=>m.store.replacePolicy('alias',f.origin.policy,f.origin.policy),()=>m.store.lookup('alias','old-0'),()=>m.store.reserve(r,f.sample),()=>m.store.reserveControlled(r,f.sample,control(r)),()=>m.store.launchOnce('alias','new','x',f.sample,async()=>{starts++;}),()=>m.store.launchOnceControlled('alias','new','x',f.sample,async()=>{starts++;},control(r)),()=>m.store.complete('alias','old-0',f.origin.reservations['old-0'].proofs[0]),()=>m.store.completeControlled('alias','new',proof('completed',60001,'p'),control(r)),()=>m.store.reconcile(r,proof('not-started',60001))];
 for(const run of calls)await assert.rejects(run(),code('CONTINUITY_HELD'));
 assert.equal(starts,0);assert.equal(m.counts().updates,0);assert.deepEqual(m.state(),f.held);
 assert.equal((await m.store.inspectWindowContinuity('alias')).phase,'HELD');assert.equal(m.counts().updates,0);
});
test('missing capability, wrong exact receipt/sample/approval scope and expired lease produce zero writes',async()=>{
 const f=fixture();
 for(const options of [{noAuthority:true},{authority:{resolveApproval:async()=>({...f.approval,ownerEpoch:2})}},{authority:{readObservation:async()=>({observation:{...f.sample,observationId:'replacement'},evidence:f.evidence})}},{now:()=>65000},{authority:{assertCurrent(){throw Error('PRIVATE_REVOKED');}}}]){
  const m=storeFixture(f,options);await assert.rejects(m.store.applyWindowContinuity(f.plan,'approval',signal()),e=>{assert.doesNotMatch(e.message,/PRIVATE_/);return true;});assert.equal(m.counts().updates,0);
 }
});
test('actual database, alias rows, changed state, mixed row version and CAS conflicts refuse',async()=>{
 const f=fixture(),changed=structuredClone(f.origin);changed.policy.headroomPercent=9;
 for(const options of [{database:'wrong'},{aliases:['alias','unapproved']},{state:changed},{rowVersion:2},{casZero:true},{checksum:digest('wrong')}]){const m=storeFixture(f,options);await assert.rejects(m.store.applyWindowContinuity(f.plan,'approval',signal()));assert.equal(m.counts().updates,0);}
});
test('claim and final acknowledgement loss preserve durable envelopes without another transaction',async()=>{
 for(const commit of [1,2]){const f=fixture(),m=storeFixture(f,{loseCommit:commit});await assert.rejects(m.store.applyWindowContinuity(f.plan,'approval',signal()),code('COMMIT_UNKNOWN'));assert.equal(m.counts().connects,commit);assert.deepEqual(m.state(),commit===1?f.held:f.applied);assert.equal(m.log.at(-1),'COMMIT');}
});
test('cancellation after first commit leaves HELD; no final acquisition',async()=>{
 const f=fixture(),abort=new AbortController(),m=storeFixture(f,{afterCommit(){abort.abort();}});await assert.rejects(m.store.applyWindowContinuity(f.plan,'approval',abort.signal));assert.deepEqual(m.state(),f.held);assert.equal(m.counts().connects,1);
});
test('serialized concurrent invocations cannot finalize another claim',async()=>{
 const f=fixture(),m=storeFixture(f);const results=await Promise.allSettled([m.store.applyWindowContinuity(f.plan,'approval',signal()),m.store.applyWindowContinuity(f.plan,'approval',signal())]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(m.counts().updates,2);assert.deepEqual(m.state(),f.applied);
});
test('APPLIED new lifecycle retains history; policy edits and conflicting old proofs refuse',async()=>{
 const f=fixture(1,0),m=storeFixture(f,{state:f.applied}),r=request('alias','new',{allowancePercent:{primary:1}});
 const reserved=await m.store.reserve(r,f.sample);assert.equal(reserved.kind,'accepted');let starts=0;
 assert.equal((await m.store.launchOnce('alias','new',reserved.launchPermit,f.sample,async()=>{starts++;return{processRef:'new-process'};})).kind,'started');
 await m.store.complete('alias','new',proof('completed',60001,'new-process'));assert.equal(starts,1);
 await m.store.complete('alias','old-0',f.origin.reservations['old-0'].proofs[0]);
 await assert.rejects(m.store.replacePolicy('alias',f.origin.policy,{...f.origin.policy,headroomPercent:0}),code('CONTINUITY_POLICY'));
 await assert.rejects(m.store.complete('alias','old-0',{...f.origin.reservations['old-0'].proofs[0],proofRef:'changed'}));
 for(const id of Object.keys(f.origin.reservations))assert.deepEqual(m.state().reservations[id],f.origin.reservations[id]);assert.equal(m.state().reservations.new.retained.primary.percent,1);
});
test('capability cancellation, timeout and late resolution/rejection cannot acquire a client',async()=>{
 const f=fixture();for(const outcome of ['resolve','reject']){
  let finish;const abort=new AbortController(),m=storeFixture(f,{authority:{resolveApproval:()=>new Promise((resolve,reject)=>{finish=outcome==='resolve'?()=>resolve(f.approval):()=>reject(Error('PRIVATE_LATE'));})}});
  const pending=m.store.applyWindowContinuity(f.plan,'approval',abort.signal);const checked=assert.rejects(pending,code('CONTROL_CANCELLED'));await new Promise(r=>setImmediate(r));abort.abort();await checked;finish();await new Promise(r=>setImmediate(r));assert.equal(m.counts().connects,0);
 }
 const m=storeFixture(f,{authority:{resolveApproval:()=>new Promise(()=>{})}});await assert.rejects(m.store.applyWindowContinuity(f.plan,'approval',signal()),code('CONTINUITY_TIMEOUT'));assert.equal(m.counts().connects,0);
});
test('pre-abort and synchronous authority abort prevent any SQL, async authority faults stay observed',async()=>{
 const f=fixture();for(const mode of ['pre','inside','promise']){const abort=new AbortController();if(mode==='pre')abort.abort();
  const m=storeFixture(f,{authority:{assertCurrent(){if(mode==='inside')abort.abort();if(mode==='promise')return Promise.reject(Error('PRIVATE_ASSERT'));}}});
  await assert.rejects(m.store.applyWindowContinuity(f.plan,'approval',abort.signal));await new Promise(r=>setImmediate(r));assert.equal(m.counts().connects,0);
 }
});
test('APPLIED ordinary launch, controlled launch and consumed-gate recheck all include carried floor',async()=>{
 for(const mode of ['ordinary','controlled','gate']){
  const f=fixture(58,0),m=storeFixture(f,{state:f.applied,now:()=>60002}),r=request('alias','new',{allowancePercent:{primary:1}});
  const reserved=await m.store.reserve(r,f.sample);assert.equal(reserved.kind,'accepted');let starts=0,consumed=0;
  const high=structuredClone(f.sample);high.observationId='higher';high.observedAtMs=60002;high.windows.primary.usedPercent=25;
  if(mode==='ordinary')assert.equal((await m.store.launchOnce('alias','new',reserved.launchPermit,high,async()=>{starts++;})).reason,'CAPACITY_LIMIT');
  else if(mode==='controlled')assert.equal((await m.store.launchOnceControlled('alias','new',reserved.launchPermit,high,async()=>{starts++;},control(r))).reason,'CAPACITY_LIMIT');
  else await assert.rejects(m.store.launchOnceControlled('alias','new',reserved.launchPermit,f.sample,async(_request,gate)=>{starts++;await gate.check(high);gate.consume();consumed++;return{processRef:'forbidden',launcherId:'launcher'};},control(r)));
  assert.equal(starts,mode==='gate'?1:0);assert.equal(consumed,0);
 }
});
test('changed approved zero/sixty samples, result core and oversized nested data are rejected before DB',async()=>{
 const f=fixture();for(const usedPercent of [0,60]){const m=storeFixture(f,{authority:{readObservation:async()=>{const sample=structuredClone(f.sample);sample.windows.primary.usedPercent=usedPercent;return{observation:sample,evidence:f.evidence};}}});await assert.rejects(m.store.applyWindowContinuity(f.plan,'approval',signal()),code('CONTINUITY_OBSERVATION'));assert.equal(m.counts().connects,0);}
 for(const mutate of [x=>x.resultCoreDigest=digest('forged'),x=>x.evidence.receiptRevision='x'.repeat(513),x=>x.originState.aliases.push('other'),x=>x.extra=Object.fromEntries(Array.from({length:1026},(_,i)=>[`k${i}`,0]))]){const value=structuredClone(f.plan);mutate(value);const m=storeFixture(f);await assert.rejects(m.store.applyWindowContinuity(value,'approval',signal()));assert.equal(m.counts().connects,0);}
});
test('a final transaction failure leaves the acknowledged hold; late or repeated invocation cannot finalize it',async()=>{
 const f=fixture();let failure=true;const m=storeFixture(f,{beforeQuery(sql,{commits}){if(failure && commits===1 && sql.startsWith('UPDATE'))throw Error('PRIVATE_FINAL_FAILURE');}});
 await assert.rejects(m.store.applyWindowContinuity(f.plan,'approval',signal()),code('DATABASE_ERROR'));assert.deepEqual(m.state(),f.held);
 failure=false;await assert.rejects(m.store.applyWindowContinuity(f.plan,'approval',signal()),code('CONTINUITY_CONFLICT'));assert.deepEqual(m.state(),f.held);
});
test('authority epoch revocation after durable claim never writes final state',async()=>{
 const f=fixture();let revoked=false;const m=storeFixture(f,{afterCommit(){revoked=true;},authority:{assertCurrent(){if(revoked)throw Error('PRIVATE_REVOKED');}}});
 await assert.rejects(m.store.applyWindowContinuity(f.plan,'approval',signal()));assert.deepEqual(m.state(),f.held);assert.equal(m.counts().connects,1);
});
test('actual monotonic capability deadline rejects late fulfillment before a starved timer callback',async()=>{
 const started=performance.now();await assert.rejects(continuityCapability(signal(),async()=>{while(performance.now()-started<1020){}return 'late';}),code('CONTINUITY_TIMEOUT'));
 let touched=0;const abort=new AbortController();const pending=continuityCapability(abort.signal,async()=>{touched++;});abort.abort();await assert.rejects(pending,code('CONTROL_CANCELLED'));assert.equal(touched,0);
});
test('plan refuses understated historical peak and v2 observation refuses lost subscription authority',()=>{
 const f=fixture(),origin=structuredClone(f.origin);origin.highWater.primary.usedPercent=57;
 assert.throws(()=>planWindowContinuity(origin,f.input,60001),code('CONTINUITY_ELIGIBILITY'));
 for(const change of [x=>x.authentication='none',x=>x.ordinaryUsageAllowed=false]){const sample=structuredClone(f.sample);sample.observationId='unauthorized';sample.observedAtMs=60002;change(sample);assert.equal(acceptObservation(f.applied,sample,60002).accepted,false);}
});
test('host clock cancellation during capability-to-transaction handoff produces no SQL',async()=>{
 const f=fixture(),abort=new AbortController();const m=storeFixture(f,{now(){abort.abort();return 60001;}});
 await assert.rejects(m.store.applyWindowContinuity(f.plan,'approval',abort.signal));assert.equal(m.counts().connects,0);
});
test('authority object getters and symbol fields are rejected without evaluation or raw diagnostics',()=>{
 let reads=0;
 const pool={connect(){throw Error('forbidden');}},options={schema:scope.admissionSchema,launcherId:'launcher'};
 const authority=Object.defineProperty({readObservation:async()=>null,assertCurrent(){}},'resolveApproval',{enumerable:true,get(){reads++;return async()=>null;}});
 const baseline=reads;assert.throws(()=>new PostgresAdmission(pool,{...options,continuityAuthority:authority}),code('CONTINUITY_AUTHORITY'));assert.equal(reads,baseline);
 assert.throws(()=>new PostgresAdmission(pool,{...options,continuityAuthority:{resolveApproval:async()=>null,readObservation:async()=>null,assertCurrent(){},[Symbol('PRIVATE_NAME')]:true}}),code('CONTINUITY_AUTHORITY'));
});
