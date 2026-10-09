// Stage A only: pure helper + actual admission against a fresh synthetic transaction pool.
// No provider, model, bootstrap, registry, real database or production ledger is invoked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { historicalAccountingRevision,captureHistoricalAccounting,projectHistoricalAccounting } from '../../../dist/packages/codex-adapter/src/historical-accounting.js';
import { MODEL_ROUTE,POLICY_VERSION } from '../../../dist/packages/codex-adapter/src/policy.js';
import { canonicalJson,digest } from '../../../dist/packages/contracts/src/index.js';
import { PostgresAdmission,createAccount,evaluateLaunch } from '../../../dist/packages/admission/src/index.js';
const OLD='codex:gpt-5.5:low',UNKNOWN='codex:unknown:low',NOW=1000000;
const hash=x=>createHash('sha256').update(x).digest('hex');
const map=()=>({requiredWindows:['primary'],optionalWindows:['secondary']});
const body=()=>({format:'bowerloom/codex-historical-accounting/v1',status:'active',reviewRevision:'a'.repeat(64),issuedAtMs:NOW-1000,expiresAtMs:NOW+60000,
 hostBinding:{installationId:'installation',databaseName:'synthetic',admissionSchema:'trellis_history',accountId:'account',accountAlias:'alias',launcherId:'launcher'},accountBindingDigest:'b'.repeat(64),
 currentPolicyVersion:POLICY_VERSION,currentModelRoute:MODEL_ROUTE,historicalModelRoute:OLD,requiredWindows:['primary'],optionalWindows:['secondary'],
 historicalEvidence:{ledgerObservationSha256:'c'.repeat(64),ledgerChecksum:'sha256:'+'d'.repeat(64),reservationsDigest:'e'.repeat(64),reservationCount:4,retainedPrimaryPercent:8},oldLaunchAuthorized:false,coverageReleaseAttested:false});
// Independent canonical construction permits malformed-but-self-consistent negative bindings.
function signed(b=body()){return{...b,revision:hash(canonicalJson(b))};}
function expected(b){return{hostBinding:structuredClone(b.hostBinding),accountBindingDigest:b.accountBindingDigest,reviewRevision:b.reviewRevision,historicalAccountingRevision:b.revision};}
const observe=(now=NOW,route=MODEL_ROUTE)=>({observationId:'observation-'+now,accountId:'account',observedAtMs:now,authentication:'subscription',ordinaryUsageAllowed:true,
 windows:{primary:{usedPercent:10,durationMs:600000,resetAtMs:NOW+300000,accountedThroughMs:null},secondary:null},routes:{[route]:map()}});
const refusal={name:'AdapterError',code:'HISTORICAL_ACCOUNTING_REFUSED',message:'HISTORICAL_ACCOUNTING_REFUSED'};
const capture=(b=signed(),e=expected(b),now=NOW)=>captureHistoricalAccounting(b,e,now);
const project=(o=observe(),b=signed(),e=expected(b),now=NOW)=>projectHistoricalAccounting(o,b,e,now);

test('canonical binding is detached/deeply frozen and only exact digest matches capture',()=>{
 const original=body(),binding=signed(original),e=expected(binding);assert.equal(historicalAccountingRevision(original),binding.revision);
 const captured=capture(binding,e);binding.hostBinding.launcherId='changed';binding.requiredWindows.push('changed');e.hostBinding.accountId='changed';
 assert.equal(captured.hostBinding.launcherId,'launcher');assert.deepEqual(captured.requiredWindows,['primary']);
 assert.ok(Object.isFrozen(captured)&&Object.isFrozen(captured.hostBinding)&&Object.isFrozen(captured.historicalEvidence)&&Object.isFrozen(captured.requiredWindows));
 assert.throws(()=>{captured.historicalEvidence.retainedPrimaryPercent=0;},TypeError);
});
test('projection preserves complete observation except exact old mapping and is idempotent/plain/immutable',()=>{
 const input=observe(),before=structuredClone(input),b=signed();const output=project(input,b);
 assert.deepEqual(input,before);assert.deepEqual(output,{...before,routes:{...before.routes,[OLD]:map()}});
 assert.deepEqual(project(output,b),output);assert.equal(Object.getPrototypeOf(output),Object.prototype);
 assert.equal(Object.getPrototypeOf(output.windows.primary),Object.prototype);assert.ok(Object.isFrozen(output.windows.primary));
 input.windows.primary.usedPercent=99;assert.equal(output.windows.primary.usedPercent,10);assert.throws(()=>{output.routes[OLD].optionalWindows.push('other');},TypeError);
});
for(const field of ['installationId','databaseName','admissionSchema','accountId','accountAlias','launcherId'])test('wrong trusted '+field+' refuses self-consistent binding',()=>{
 const b=signed(),e=expected(b);e.hostBinding[field]=field==='admissionSchema'?'trellis_other':'other';assert.throws(()=>capture(b,e),refusal);
});
for(const field of ['accountBindingDigest','reviewRevision','historicalAccountingRevision'])test('wrong trusted '+field+' refuses',()=>{
 const b=signed(),e=expected(b);e[field]='f'.repeat(64);assert.throws(()=>capture(b,e),refusal);
});
const badBodies=[
 ['format',b=>b.format='bowerloom/codex-historical-accounting/v2'],['inactive',b=>b.status='revoked'],['missing',b=>delete b.coverageReleaseAttested],['extra',b=>b.extra=true],
 ['wrong policy',b=>b.currentPolicyVersion='codex-subscription-proposal/v0.7-alpha.2'],['wrong current route',b=>b.currentModelRoute='codex:gpt-5.6-sol:low'],['wrong old route',b=>b.historicalModelRoute='codex:gpt-5.5:high'],
 ['wrong required mapping',b=>b.requiredWindows=['secondary']],['wrong optional mapping',b=>b.optionalWindows=[]],['old launch permission',b=>b.oldLaunchAuthorized=true],['release attestation',b=>b.coverageReleaseAttested=true],
 ['invalid review',b=>b.reviewRevision='invalid'],['invalid account digest',b=>b.accountBindingDigest='invalid'],['evidence checksum',b=>b.historicalEvidence.ledgerChecksum='d'.repeat(64)],
 ['evidence hash',b=>b.historicalEvidence.ledgerObservationSha256='invalid'],['reservation digest',b=>b.historicalEvidence.reservationsDigest='invalid'],['wrong history count',b=>b.historicalEvidence.reservationCount=5],['wrong history sum',b=>b.historicalEvidence.retainedPrimaryPercent=0],
 ['extra evidence',b=>b.historicalEvidence.currentStateVerified=true],['invalid host schema',b=>b.hostBinding.admissionSchema='public'],['extra host',b=>b.hostBinding.other=true],
 ['zero lifetime',b=>b.expiresAtMs=b.issuedAtMs],['overlong lifetime',b=>b.expiresAtMs=b.issuedAtMs+300001],['unsafe time',b=>b.issuedAtMs=Number.MAX_SAFE_INTEGER+1],['negative time',b=>b.issuedAtMs=-1],['fractional time',b=>b.issuedAtMs=0.5]
];
for(const [name,mutate] of badBodies)test('binding '+name+' refuses even with a matching self-hash',()=>{const b=body();mutate(b);const v=signed(b);assert.throws(()=>capture(v,expected(v)),refusal);assert.throws(()=>historicalAccountingRevision(b),refusal);});
test('binding clock bounds and digest/revision mismatch refuse without deadline extension',()=>{
 const b=signed();for(const now of [b.issuedAtMs-1,b.expiresAtMs,b.expiresAtMs+1,NaN,Infinity,-1,0.5])assert.throws(()=>capture(b,expected(b),now),refusal);
 assert.equal(capture(b,expected(b),b.issuedAtMs).revision,b.revision);assert.equal(capture(b,expected(b),b.expiresAtMs-1).revision,b.revision);
 const v=structuredClone(b);v.historicalEvidence.reservationsDigest='f'.repeat(64);assert.throws(()=>capture(v,expected(b)),refusal);
});
test('hostile getters/proxies/toJSON are never executed, and cycles/sparse/oversized input refuse',()=>{
 let invoked=0;const getter=()=>{invoked++;throw Error('PRIVATE');};
 const variants=[];const a=body();Object.defineProperty(a.hostBinding,'accountId',{enumerable:true,get:getter});variants.push(a);
 const b=body();Object.defineProperty(b,'extra',{enumerable:false,get:getter});variants.push(b);
 const c=body();c[Symbol('private')]=1;variants.push(c);const d=body();d.toJSON=getter;variants.push(d);
 variants.push(new Proxy(body(),{ownKeys:getter,getPrototypeOf:getter,get:getter}));
 const cyclic=body();cyclic.extra=cyclic;variants.push(cyclic);
 const sparse=body();sparse.requiredWindows=new Array(1);variants.push(sparse);
 const big=body();big.reviewRevision='x'.repeat(513);variants.push(big);
 const wide=body();for(let i=0;i<34;i++)wide['extra'+i]=i;variants.push(wide);
 const dangerous=body();Object.defineProperty(dangerous,'__proto__',{value:{},enumerable:true});variants.push(dangerous);
 for(const v of variants)assert.throws(()=>historicalAccountingRevision(v),refusal);assert.equal(invoked,0);
 const e=expected(signed());Object.defineProperty(e,'hostBinding',{get:getter,enumerable:true});assert.throws(()=>capture(signed(),e),refusal);assert.equal(invoked,0);
});
const badObservations=[
 ['coverage',o=>o.windows.primary.accountedThroughMs=NOW-1],['secondary usage',o=>o.windows.secondary={...o.windows.primary}],['missing secondary',o=>delete o.windows.secondary],['missing primary',o=>delete o.windows.primary],['null primary',o=>o.windows.primary=null],['extra window',o=>o.windows.extra=null],
 ['wrong account',o=>o.accountId='other'],['no subscription',o=>o.authentication='other'],['usage denied',o=>o.ordinaryUsageAllowed=false],['future observation',o=>o.observedAtMs=NOW+1],
 ['no current mapping',o=>o.routes={}],['null current mapping',o=>o.routes[MODEL_ROUTE]=null],['wrong required',o=>o.routes[MODEL_ROUTE].requiredWindows=['secondary']],['wrong optional',o=>o.routes[MODEL_ROUTE].optionalWindows=[]],
 ['conflicting old mapping',o=>o.routes[OLD]={requiredWindows:['primary'],optionalWindows:[]}],['null old mapping',o=>o.routes[OLD]=null],['unknown route',o=>o.routes[UNKNOWN]=map()],
 ['extra field',o=>o.private='SECRET'],['NaN usage',o=>o.windows.primary.usedPercent=NaN],['unsafe duration',o=>o.windows.primary.durationMs=Number.MAX_SAFE_INTEGER+1]
];
for(const [name,mutate] of badObservations)test('observation '+name+' refuses before downstream call and stays unchanged',()=>{
 const o=observe();mutate(o);const before=structuredClone(o);let calls=0;assert.throws(()=>{const projected=project(o);calls++;return projected;},refusal);assert.equal(calls,0);assert.deepEqual(o,before);
});
test('getter in observation is refused without reading it',()=>{let gets=0;const o=observe();Object.defineProperty(o.windows.primary,'accountedThroughMs',{enumerable:true,get(){gets++;return null;}});assert.throws(()=>project(o),refusal);assert.equal(gets,0);});

function poolFor(seed){
 let stored=structuredClone(seed);const pool={queries:[],snapshot:()=>structuredClone(stored),async connect(){let staged;const client=new EventEmitter();client.release=()=>{};client.query=async(sql,v)=>{
  pool.queries.push(sql);if(sql.startsWith('BEGIN'))staged=structuredClone(stored);else if(sql.startsWith('SET LOCAL')){}else if(sql.includes('.metadata FOR SHARE'))return{rows:[{singleton:true,version:1}]};
  else if(sql.includes('WHERE account_id=(SELECT'))return{rows:[{account_id:staged.accountId,version:1,state:structuredClone(staged),checksum:digest(canonicalJson(staged))}]};
  else if(sql.startsWith('UPDATE'))staged=JSON.parse(v[1]);else if(sql==='COMMIT')stored=structuredClone(staged);else if(sql==='ROLLBACK')staged=undefined;else throw Error('unrecognized synthetic SQL');return{rows:[]};};return client;}};return pool;
}
const request=(jobId,route=MODEL_ROUTE,percent=2)=>({accountAlias:'alias',jobId,candidateRevision:digest('synthetic'),modelRoute:route,role:'worker',attempt:'initial',allowancePercent:{primary:percent},paidFallback:false});
async function ledger(extraUnknown=false){
 let clock=NOW-100;const policy={thresholdPercent:95,maxWorkers:2,maxObservationAgeMs:30000,headroomPercent:8,admittedRoutes:[OLD,...(extraUnknown?[UNKNOWN]:[])],completedResetPolicy:'hold'};
 const pool=poolFor(createAccount('account',['alias'],policy)),admission=new PostgresAdmission(pool,{schema:'trellis_history',launcherId:'launcher',now:()=>clock});
 for(let i=0;i<4+(extraUnknown?1:0);i++){
  const route=i===4?UNKNOWN:OLD,job='old-'+i;const sample=observe(++clock,route);
  if(extraUnknown)sample.routes={...sample.routes,[OLD]:map(),[UNKNOWN]:map()};
  const reserved=await admission.reserve(request(job,route),sample);assert.equal(reserved.kind,'accepted');
  assert.equal((await admission.launchOnce('alias',job,reserved.launchPermit,sample,async()=>({processRef:'synthetic-'+i}))).kind,'started');
  await admission.complete('alias',job,{kind:'completed',proofRef:'completed-'+i,observedAtMs:clock,processRef:'synthetic-'+i,fencedLauncherId:null});
 }
 const before=pool.snapshot();await admission.replacePolicy('alias',policy,{...policy,admittedRoutes:[MODEL_ROUTE]});clock=NOW;
 return{pool,admission,before,tick:()=>++clock,sample:()=>observe(clock)};
}
const total=s=>Object.values(s.reservations).reduce((sum,r)=>sum+(r.retained.primary?.percent??0),0);
const unchanged=(e)=>{for(const [id,r] of Object.entries(e.before.reservations))assert.deepEqual(e.pool.snapshot().reservations[id],r);};
test('actual admission: no bridge refuses; eligible projection reserves current route without changing eight held points',async()=>{
 const e=await ledger();assert.equal(total(e.before),8);
 assert.deepEqual(await e.admission.reserve(request('no-bridge'),e.sample()),{kind:'denied',reason:'UNRESOLVED_RESERVATION_WINDOWS'});unchanged(e);
 e.tick();const o=e.sample(),p=project(o,signed(),expected(signed()),o.observedAtMs);
 assert.equal((await e.admission.reserve(request('current'),p)).kind,'accepted');unchanged(e);assert.equal(total(e.pool.snapshot()),10);
 assert.deepEqual(e.pool.snapshot().policy.admittedRoutes,[MODEL_ROUTE]);assert.equal(e.pool.snapshot().policy.headroomPercent,8);assert.equal(e.pool.snapshot().policy.thresholdPercent,95);
 assert.deepEqual(evaluateLaunch(e.pool.snapshot(),request('old-launch',OLD),o.observedAtMs),{allowed:false,reason:'ROUTE_NOT_ADMITTED'});
 assert.deepEqual(await e.admission.reserve(request('old-new',OLD),p),{kind:'denied',reason:'ROUTE_NOT_ADMITTED'});unchanged(e);
});
test('genuine later same-window coverage control releases old charges despite hold policy; helper refuses before admission',async()=>{
 const e=await ledger(),covered=e.sample();covered.routes[OLD]=map();covered.windows.primary.accountedThroughMs=NOW-1;
 assert.ok(Object.values(e.before.reservations).every(r=>covered.windows.primary.accountedThroughMs>r.completedAtMs));
 const queries=e.pool.queries.length;assert.throws(()=>project(covered),refusal);assert.equal(e.pool.queries.length,queries);unchanged(e);
 assert.equal(e.pool.snapshot().policy.completedResetPolicy,'hold');assert.equal((await e.admission.reserve(request('unsafe-control'),covered)).kind,'accepted');
 for(const [id,r] of Object.entries(e.before.reservations))assert.deepEqual(e.pool.snapshot().reservations[id],{...r,retained:{}});
 assert.equal(total(e.pool.snapshot()),2); // Only the new control request remains charged. This is synthetic evidence of H1's risk.
});
test('H1/H2 all refuse before test admission invocation and preserve exact durable synthetic state',async()=>{
 const e=await ledger();for(const mutate of [o=>o.windows.primary.accountedThroughMs=NOW-1,o=>o.windows.secondary={...o.windows.primary},o=>delete o.windows.secondary,o=>o.routes[OLD]={requiredWindows:['primary'],optionalWindows:[]}]){
  const input=e.sample();mutate(input);const before=e.pool.snapshot(),count=e.pool.queries.length;let called=0;
  assert.throws(()=>{const p=project(input);called++;void e.admission.reserve(request('forbidden'),p);},refusal);
  assert.equal(called,0);assert.equal(e.pool.queries.length,count);assert.deepEqual(e.pool.snapshot(),before);
 }
});
test('existing threshold boundary and additional current-route charges stay charged',async()=>{
 const e=await ledger();const atThreshold=e.sample();atThreshold.windows.primary.usedPercent=77;
 assert.deepEqual(await e.admission.reserve(request('threshold'),project(atThreshold)),{kind:'denied',reason:'CAPACITY_LIMIT'});unchanged(e);
 const f=await ledger();const p=project(f.sample()),reserved=await f.admission.reserve(request('current-extra'),p);assert.equal(reserved.kind,'accepted');
 assert.equal((await f.admission.launchOnce('alias','current-extra',reserved.launchPermit,p,async()=>({processRef:'synthetic-extra'}))).kind,'started');
 await f.admission.complete('alias','current-extra',{kind:'completed',proofRef:'extra-complete',observedAtMs:NOW,processRef:'synthetic-extra',fencedLauncherId:null});
 f.tick();const sample=f.sample();sample.windows.primary.usedPercent=75;const before=f.pool.snapshot().reservations;
 assert.deepEqual(await f.admission.reserve(request('would-overbook'),project(sample,signed(),expected(signed()),sample.observedAtMs)),{kind:'denied',reason:'CAPACITY_LIMIT'});
 assert.deepEqual(f.pool.snapshot().reservations,before);assert.equal(total(f.pool.snapshot()),10);unchanged(f);
});
test('another historical route remains unresolved; helper does not assert four-record equality',async()=>{
 const e=await ledger(true);assert.equal(total(e.before),10);
 assert.deepEqual(await e.admission.reserve(request('unknown-history'),project(e.sample())),{kind:'denied',reason:'UNRESOLVED_RESERVATION_WINDOWS'});unchanged(e);
});
