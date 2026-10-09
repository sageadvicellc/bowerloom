import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createObservationProjector,captureReceipt,captureMapping } from '../../../dist/packages/claude-adapter/src/observation.js';
import { digest,ROUTES,POLICY_VERSION } from '../../../dist/packages/claude-adapter/src/policy.js';
import { createAccount,acceptObservation,evaluateAdmission } from '../../../dist/packages/admission/src/policy.js';
import { digest as ledgerDigest,canonicalJson } from '../../../dist/packages/contracts/src/index.js';
// SYNTHETIC semantics/identity/timestamps, not new provider observations or calibrated defaults.
const H='a'.repeat(64),NOW=1800000000000;
const signed=body=>({...body,revision:digest(body)});
function fixture(){
  const windows=[['session','current-session',18000000],['weekly','all-model-weekly',604800000]].map(([windowId,windowClass,durationMs])=>({windowId,windowClass,durationMs,cutoffMs:NOW+300000,timezone:'America/New_York',rounding:'floor-percent',semanticsRevision:H}));
  const mapping=signed({format:'bowerloom/claude-window-mapping/v1',policyVersion:POLICY_VERSION,epochId:'synthetic-epoch',accountId:'synthetic-account',accountBindingRevision:H,reviewRevision:H,issuedAtMs:NOW-1000,expiresAtMs:NOW+150000,trialDeadlineMs:NOW+120000,completedResetPolicy:'hold',routes:Object.fromEntries(ROUTES.map(r=>[r,['session','weekly']])),windows});
  const receipt={format:'bowerloom/claude-ui-receipt/v1',receiptId:'sample-1',readerId:'synthetic-registry',sourceEvidenceSha256:H,accountId:'synthetic-account',accountBindingRevision:H,capacityLinkRevision:H,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max',creditsEnabled:false,ordinaryUsageAllowed:true,startedAtMs:NOW-100,completedAtMs:NOW,refreshComplete:true,applicabilityComplete:true,applicabilityEvidenceSha256:H,windows:windows.map(w=>({windowId:w.windowId,windowClass:w.windowClass,rawPercent:'0%',displayPercent:0,resetLabels:['Synthetic 11:10pm','Synthetic 11:09pm'],timezone:w.timezone,durationMs:w.durationMs,resetLowerMs:NOW+300000,resetUpperMs:NOW+360000,refreshComplete:true,conflicting:false,accountedThroughMs:null}))};
  return {mapping,receipt};
}
const pins=f=>({readerId:'synthetic-registry',accountId:'synthetic-account',accountBindingRevision:H,mappingRevision:f.mapping.revision,reviewRevision:H});
function rehash(f){const {revision,...body}=f.mapping;f.mapping=signed(body);return f;}
const project=(f,clock=()=>NOW)=>createObservationProjector(pins(f),()=>f,clock).project(f.receipt.receiptId);
const refusal=(f,code,clock)=>assert.throws(()=>project(f,clock),{code,message:`CLAUDE_${code}`});
test('fixed justified cutoff retains raw labels while converting displayed zero into supported upper bound',()=>{
  const f=fixture(),out=project(f);assert.equal(out.observation.windows.session.usedPercent,1);assert.equal(out.observation.windows.session.resetAtMs,NOW+300000);assert.equal(out.observation.windows.weekly.accountedThroughMs,null);assert.equal(out.identityMeaning,'host-policy-cutoff');assert.equal(out.executionAuthorized,false);assert.equal(out.originIndependentlyVerified,false);assert.deepEqual(out.evidence.windows[0].resetLabels,f.receipt.windows[0].resetLabels);
  f.receipt.windows[0].resetLabels.push('later');assert.equal(out.evidence.windows[0].resetLabels.length,2);assert.ok(Object.isFrozen(out.observation.windows.session));
});
test('one-minute UI label jitter does not change policy anchor or discard evidence',()=>{
  const f=fixture(),original=project(f);f.receipt.receiptId='sample-2';f.receipt.windows[0].resetLabels=['Synthetic 11:09pm','Synthetic 11:10pm'];f.receipt.windows[0].resetLowerMs+=60000;f.receipt.windows[0].resetUpperMs+=60000;
  const next=project(f);assert.equal(next.observation.windows.session.resetAtMs,original.observation.windows.session.resetAtMs);assert.notDeepEqual(next.evidence.windows[0].resetLabels,original.evidence.windows[0].resetLabels);
});
test('only explicitly pinned rounding algorithms supply their respective upper bounds',()=>{
  for(const [rounding,used] of [['floor-percent',11],['nearest-percent',10.5],['ceiling-percent',10]]){const f=fixture();f.mapping.windows[0].rounding=rounding;f.receipt.windows[0].displayPercent=10;f.receipt.windows[0].rawPercent='10%';rehash(f);assert.equal(project(f).observation.windows.session.usedPercent,used);}
  const f=fixture();f.mapping.windows[0].rounding=null;rehash(f);refusal(f,'ROUNDING');
});
const negatives=[
  ['unbound account',f=>f.receipt.accountId=null,'ACCOUNT_BINDING'],
  ['different account',f=>f.receipt.accountId='other','ACCOUNT_BINDING'],
  ['unlinked candidate fingerprint',f=>f.receipt.capacityLinkRevision=null,'ACCOUNT_BINDING'],
  ['API authentication',f=>f.receipt.authMethod='api-key','AUTH'],
  ['third party provider',f=>f.receipt.apiProvider='other','AUTH'],
  ['paid credits enabled',f=>f.receipt.creditsEnabled=true,'CREDITS'],
  ['unknown credits',f=>f.receipt.creditsEnabled=null,'CREDITS'],
  ['ordinary use unknown',f=>f.receipt.ordinaryUsageAllowed=null,'AUTH'],
  ['missing duration',f=>f.receipt.windows[0].durationMs=null,'DURATION'],
  ['wrong duration',f=>f.receipt.windows[0].durationMs++,'DURATION'],
  ['missing timezone',f=>f.receipt.windows[0].timezone=null,'TIMEZONE'],
  ['missing reset bound',f=>f.receipt.windows[0].resetLowerMs=null,'RESET'],
  ['reset before cutoff',f=>f.receipt.windows[0].resetLowerMs--,'RESET'],
  ['reversed reset interval',f=>f.receipt.windows[0].resetUpperMs=NOW,'RESET'],
  ['unrefreshed receipt',f=>f.receipt.refreshComplete=false,'STALE'],
  ['unrefreshed window',f=>f.receipt.windows[0].refreshComplete=false,'STALE'],
  ['unresolved conflicting labels',f=>f.receipt.windows[0].conflicting=true,'STALE'],
  ['future refresh',f=>f.receipt.completedAtMs++,'STALE'],
  ['backwards refresh',f=>f.receipt.startedAtMs=NOW+1,'STALE'],
  ['stale refresh',f=>f.receipt.startedAtMs=NOW-30001,'STALE'],
  ['unknown applicability',f=>f.receipt.applicabilityComplete=false,'APPLICABILITY'],
  ['missing limit',f=>f.receipt.windows.pop(),'APPLICABILITY'],
  ['unmatched class',f=>f.receipt.windows[0].windowClass='other','APPLICABILITY'],
  ['fabricated coverage',f=>f.receipt.windows[0].accountedThroughMs=NOW,'COVERAGE'],
  ['percent display mismatch',f=>f.receipt.windows[0].rawPercent='99%','ROUNDING'],
];
for(const [label,mutate,code] of negatives)test(`precise refusal: ${label}`,()=>{const f=fixture();mutate(f);refusal(f,code);});
test('receipt subset from the existing observation stays unlinked and cannot activate a mapping',()=>{
  const f=fixture();
  // Original labels/hash from accepted no-inference receipt f99f...; surrounding fixture clock/registry are synthetic.
  Object.assign(f.receipt,{sourceEvidenceSha256:'f99f268c6966a858aa11b75735174dc9dd8cdfad707c39a5bce3f3f70fc47dbe',accountId:null,accountBindingRevision:null,capacityLinkRevision:null,applicabilityComplete:false,applicabilityEvidenceSha256:null});
  f.receipt.windows[0].resetLabels=['11:10pm (America/New_York)','11:09pm (America/New_York)'];f.receipt.windows[1].resetLabels=['Oct 13 at 5am (America/New_York)','Oct 13 at 4:59am (America/New_York)'];
  for(const w of f.receipt.windows)Object.assign(w,{durationMs:null,resetLowerMs:null,resetUpperMs:null,conflicting:true});
  f.receipt.windows.push({...f.receipt.windows[1],windowId:'fable',windowClass:'fable-weekly',resetLabels:['Oct 13 at 5am (America/New_York)']});
  const captured=captureReceipt(f.receipt);assert.equal(captured.windows.length,3);assert.equal(captured.windows[0].displayPercent,0);refusal(f,'ACCOUNT_BINDING');
  // New auth fingerprint does not establish capacity linkage to that observation.
  f.receipt.accountId='synthetic-account';f.receipt.accountBindingRevision=H;refusal(f,'ACCOUNT_BINDING');
});
test('mapping refuses unknown fields, renewal shape, extra routes, missing limits and unsupported FUTURE_WINDOW arithmetic',()=>{
  for(const [mutate,code] of [
    [f=>f.mapping.renew=true,'INPUT'],[f=>f.mapping.routes['claude:sonnet:high']=['session'],'APPLICABILITY'],
    [f=>f.mapping.routes[ROUTES[0]]=['unknown'],'APPLICABILITY'],[f=>{for(const r of ROUTES)f.mapping.routes[r]=['session'];},'APPLICABILITY'],
    [f=>f.mapping.completedResetPolicy='release-covered','MAPPING'],[f=>f.mapping.windows[0].semanticsRevision=null,'MAPPING'],
    [f=>f.mapping.windows[0].cutoffMs=f.mapping.trialDeadlineMs,'RESET'],
    [f=>{f.mapping.windows[0].durationMs=100;f.receipt.windows[0].durationMs=100;},'RESET'],
  ]){const f=fixture();mutate(f);rehash(f);refusal(f,code);}
});
test('trusted registry pins cannot be replaced by a recomputed self digest',()=>{
  const f=fixture(),expected=pins(f);f.mapping.windows[0].rounding='ceiling-percent';rehash(f);const p=createObservationProjector(expected,()=>f,()=>NOW);assert.throws(()=>p.project('sample-1'),{code:'MAPPING'});
  f.receipt.readerId='other';assert.throws(()=>createObservationProjector(pins(f),()=>f,()=>NOW).project('sample-1'),{code:'LOOKUP'});
});
test('private foreign errors, promise/thenables, proxies and getters cannot enter capture',async()=>{
  const f=fixture();let calls=0;
  const bad=new Proxy({}, {get(){calls++;throw Error('SECRET');},ownKeys(){calls++;return [];}});
  for(const supplied of [bad,{...f,receipt:bad},{...f,receipt:Object.defineProperty({...f.receipt},'windows',{enumerable:true,get(){calls++;throw Error('SECRET');}})}])assert.throws(()=>createObservationProjector(pins(f),()=>supplied,()=>NOW).project('sample-1'),{code:'INPUT',message:'CLAUDE_INPUT'});
  assert.equal(calls,0);
  const hostile=new Proxy({}, {get(){calls++;throw Error('SECRET');}});
  assert.throws(()=>createObservationProjector(pins(f),()=>{throw hostile;},()=>NOW).project('sample-1'),{code:'LOOKUP',message:'CLAUDE_LOOKUP'});assert.equal(calls,0);
  assert.throws(()=>createObservationProjector(pins(f),()=>f,()=>{throw hostile;}).project('sample-1'),{code:'CLOCK',message:'CLAUDE_CLOCK'});
  assert.throws(()=>createObservationProjector(pins(f),()=>Promise.reject(Error('SECRET')),()=>NOW).project('sample-1'),{code:'LOOKUP'});await new Promise(r=>setImmediate(r));
  const thenable=Object.defineProperty({},'then',{enumerable:true,get(){calls++;throw Error('SECRET');}});assert.throws(()=>createObservationProjector(pins(f),()=>thenable,()=>NOW).project('sample-1'),{code:'INPUT'});assert.equal(calls,0);
});
test('expiry/clock discontinuity permanently close projector; late synchronous lookup gets no projection',()=>{
  const f=fixture();let n=NOW;const p=createObservationProjector(pins(f),()=>f,()=>n);p.project('sample-1');n=NOW-1;assert.throws(()=>p.project('sample-1'),{code:'CLOCK'});n=NOW;assert.throws(()=>p.project('sample-1'),{code:'STALE'});
  n=NOW;const late=createObservationProjector(pins(f),()=>{n=f.mapping.trialDeadlineMs;return f;},()=>n);assert.throws(()=>late.project('sample-1'),{code:'STALE'});n=NOW;assert.throws(()=>late.project('sample-1'),{code:'STALE'});
  refusal(f,'STALE',()=>f.mapping.expiresAtMs);refusal(f,'STALE',()=>f.mapping.windows[0].cutoffMs);
});
test('same receipt exact replay is inert; changed reused receipt ID is refused before admission',()=>{
  const f=fixture(),p=createObservationProjector(pins(f),()=>f,()=>NOW);const a=p.project('sample-1');assert.deepEqual(p.project('sample-1'),a);f.receipt.windows[0].displayPercent=1;f.receipt.windows[0].rawPercent='1%';assert.throws(()=>p.project('sample-1'),{code:'LOOKUP'});
});
const policy=()=>({thresholdPercent:75,maxWorkers:2,maxObservationAgeMs:30000,headroomPercent:5,admittedRoutes:[...ROUTES],completedResetPolicy:'hold'});
const request=(modelRoute=ROUTES[0],jobId='job',allowance=1)=>({accountAlias:'synthetic-alias',jobId,candidateRevision:`sha256:${H}`,modelRoute,role:'lead',attempt:'initial',allowancePercent:{session:allowance,weekly:allowance},paidFallback:false});
function retain(state,job,modelRoute=ROUTES[0]){
  const r=request(modelRoute,job,8),requestDigest=ledgerDigest(canonicalJson(r));state.reservations[job]={request:r,requestDigest,reservationId:ledgerDigest(canonicalJson({accountId:state.accountId,jobId:job,requestDigest})),status:'COMPLETED',createdAtMs:NOW-1000,claimedAtMs:NOW-900,launcherId:'synthetic-launcher',completedAtMs:NOW-800,processRef:`process-${job}`,permitHash:null,retained:Object.fromEntries(Object.entries(state.observation.windows).map(([k,w])=>[k,{percent:8,resetAtMs:w.resetAtMs,durationMs:w.durationMs}])),proofs:[{kind:'completed',proofRef:`proof-${job}`,observedAtMs:NOW-800,processRef:`process-${job}`,fencedLauncherId:null}]};
}
test('actual pure admission keeps increasing high water and eight retained points across both routes',()=>{
  const f=fixture();for(const w of f.receipt.windows){w.displayPercent=55;w.rawPercent='55%';}
  const first=acceptObservation(createAccount('synthetic-account',['synthetic-alias'],policy()),project(f).observation,NOW);assert.equal(first.accepted,true);let state=first.state;retain(state,'previous-high');const preserved=structuredClone(state.reservations);
  for(const r of ROUTES)assert.equal(evaluateAdmission(state,request(r),NOW).allowed,true);
  f.receipt.receiptId='sample-2';f.receipt.startedAtMs=NOW;f.receipt.completedAtMs=NOW+1;for(const w of f.receipt.windows){w.displayPercent=0;w.rawPercent='0%';}
  const second=acceptObservation(state,project(f,()=>NOW+1).observation,NOW+1);assert.equal(second.accepted,true);state=second.state;assert.equal(state.highWater.session.usedPercent,56);assert.deepEqual(state.reservations,preserved);
  for(const r of ROUTES)assert.equal(evaluateAdmission(state,request(r,'higher',6),NOW+1).reason,'CAPACITY_LIMIT');
  retain(state,'previous-medium',ROUTES[1]);for(const r of ROUTES)assert.equal(evaluateAdmission(state,request(r),NOW+1).reason,'CAPACITY_LIMIT');
  assert.equal(evaluateAdmission(state,request(),NOW+300000).allowed,false);
});
test('actual admission rejects old account/window mismatches and unknown old route holds',()=>{
  const f=fixture(),o=project(f).observation;
  assert.equal(acceptObservation(createAccount('other-account',['synthetic-alias'],policy()),o,NOW).reason,'ACCOUNT_MISMATCH');
  let s=acceptObservation(createAccount('synthetic-account',['synthetic-alias'],policy()),o,NOW).state;
  s.highWater.session.resetAtMs-=60000;assert.equal(acceptObservation(s,o,NOW).reason,'OVERLAPPING_RESET');
  s=acceptObservation(createAccount('synthetic-account',['synthetic-alias'],policy()),o,NOW).state;s.highWater.session.durationMs--;assert.equal(acceptObservation(s,o,NOW).reason,'WINDOW_DURATION_CHANGED');
  s=acceptObservation(createAccount('synthetic-account',['synthetic-alias'],policy()),o,NOW).state;retain(s,'old-route','claude:unknown:high');assert.equal(evaluateAdmission(s,request(),NOW).reason,'UNRESOLVED_RESERVATION_WINDOWS');
});

test('Promise refusal never invokes caller constructor or species accessors',()=>{
  const f=fixture();let constructorCalls=0,speciesCalls=0;
  // Already fulfilled: unsafe promises are intentionally not adopted or given a rejection handler.
  const ownGetter=Promise.resolve('ignored');
  Object.defineProperty(ownGetter,'constructor',{get(){constructorCalls++;throw Error('SECRET_CONSTRUCTOR');}});
  const customConstructor={};Object.defineProperty(customConstructor,Symbol.species,{get(){speciesCalls++;throw Error('SECRET_SPECIES');}});
  const ownSpecies=Promise.resolve('ignored');Object.defineProperty(ownSpecies,'constructor',{value:customConstructor});
  class ForeignPromise extends Promise {}
  Object.defineProperty(ForeignPromise,Symbol.species,{get(){speciesCalls++;throw Error('SECRET_SUBCLASS');}});
  const subclass=new ForeignPromise(resolve=>resolve('ignored'));
  for(const supplied of [ownGetter,ownSpecies,subclass])assert.throws(()=>createObservationProjector(pins(f),()=>supplied,()=>NOW).project('sample-1'),{code:'LOOKUP',message:'CLAUDE_LOOKUP'});
  assert.equal(constructorCalls,0);assert.equal(speciesCalls,0);
});
test('modified intrinsic species is refused without invoking it and is restored exactly',()=>{
  const f=fixture(),supplied=Promise.resolve('ignored'),original=Object.getOwnPropertyDescriptor(Promise,Symbol.species);let calls=0;
  try {
    Object.defineProperty(Promise,Symbol.species,{configurable:true,get(){calls++;throw Error('SECRET_INTRINSIC_SPECIES');}});
    assert.throws(()=>createObservationProjector(pins(f),()=>supplied,()=>NOW).project('sample-1'),{code:'LOOKUP',message:'CLAUDE_LOOKUP'});
    assert.equal(calls,0);
  } finally {Object.defineProperty(Promise,Symbol.species,original);}
});
test('late rejection is observed for safe native Promise; unsafe Promise stays with its trusted owner',async()=>{
  const f=fixture();let rejectSafe,rejectUnsafe,hostObserved=false,getterCalls=0;
  const safe=new Promise((_,reject)=>{rejectSafe=reject;});
  const unsafe=new Promise((_,reject)=>{rejectUnsafe=reject;});
  // The synchronous registry must already own asynchronous values it erroneously returns.
  const hostReceipt=unsafe.then(()=>undefined,()=>{hostObserved=true;});
  Object.defineProperty(unsafe,'constructor',{get(){getterCalls++;throw Error('SECRET_OWNER');}});
  for(const supplied of [safe,unsafe])assert.throws(()=>createObservationProjector(pins(f),()=>supplied,()=>NOW).project('sample-1'),{code:'LOOKUP',message:'CLAUDE_LOOKUP'});
  await new Promise(resolve=>setImmediate(resolve));
  rejectSafe(Error('SECRET_LATE_SAFE'));rejectUnsafe(Error('SECRET_LATE_OWNED'));
  await hostReceipt;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(getterCalls,0);assert.equal(hostObserved,true);
});
