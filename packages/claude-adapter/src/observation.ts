// Private synchronous data projection. The injected registry is trusted host code, not model input.
// No live reader, provider parsing, durable registration, renewal or admission mutation occurs here.
import { isPromise,isProxy } from 'node:util/types';
import type { AccountObservation } from '../../admission/src/types.js';
import { ROUTES,LIMITS,POLICY_VERSION,inert,exact,demand,refuse,id,hex,time,digest } from './policy.js';
// Captured at trusted module initialization. Do not adopt Promise subclasses or foreign species.
const intrinsicPromise=Promise;
const intrinsicPromisePrototype=Promise.prototype;
const intrinsicThen=Promise.prototype.then;
const intrinsicSpecies=Object.getOwnPropertyDescriptor(Promise,Symbol.species);
function refusePromise(value:Promise<unknown>):never {
  try {
    // Native then consults constructor/species. Inspect descriptors without calling either accessor.
    const ctor=Object.getOwnPropertyDescriptor(intrinsicPromisePrototype,'constructor');
    const species=Object.getOwnPropertyDescriptor(intrinsicPromise,Symbol.species);
    if(!isProxy(value)&&Object.getPrototypeOf(value)===intrinsicPromisePrototype
      &&Object.getOwnPropertyDescriptor(value,'constructor')===undefined
      &&ctor&&Object.hasOwn(ctor,'value')&&ctor.value===intrinsicPromise
      &&Object.getOwnPropertyDescriptor(intrinsicPromise,'prototype')?.value===intrinsicPromisePrototype
      &&species&&intrinsicSpecies&&species.get===intrinsicSpecies.get&&species.get!==undefined
      &&species.set===undefined&&!Object.hasOwn(species,'value')) {
      void Reflect.apply(intrinsicThen,value,[()=>undefined,()=>undefined]);
    }
  } catch { /* Fixed refusal below; never disclose a foreign attachment failure. */ }
  // An unsafe Promise cannot be observed without invoking caller code. Its trusted host owner must
  // retain/observe it independently; this synchronous API promises neither adoption nor quiescence.
  refuse('LOOKUP');
}
const nullableHash=(v:unknown)=>v===null||hex(v);
const nullableTime=(v:unknown)=>v===null||time(v);
const name=(v:unknown):v is string=>id(v)&&/^[A-Za-z]/.test(v);
const text=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=256;
/** Retains incomplete evidence as data. Capture alone never makes it eligible. */
export function captureReceipt(value:unknown):any {
  const v=inert(value);
  exact(v,['format','receiptId','readerId','sourceEvidenceSha256','accountId','accountBindingRevision','capacityLinkRevision','authMethod','apiProvider','subscriptionType','creditsEnabled','ordinaryUsageAllowed','startedAtMs','completedAtMs','refreshComplete','applicabilityComplete','applicabilityEvidenceSha256','windows']);
  demand(v.format==='bowerloom/claude-ui-receipt/v1'&&name(v.receiptId)&&name(v.readerId)&&hex(v.sourceEvidenceSha256),'INPUT');
  demand((v.accountId===null||name(v.accountId))&&nullableHash(v.accountBindingRevision)&&nullableHash(v.capacityLinkRevision),'INPUT');
  demand(['claude.ai','api-key','unknown'].includes(v.authMethod)&&['firstParty','other','unknown'].includes(v.apiProvider)&&['max','pro','unknown'].includes(v.subscriptionType),'INPUT');
  for(const key of ['creditsEnabled','ordinaryUsageAllowed']) demand(v[key]===null||typeof v[key]==='boolean','INPUT');
  demand(time(v.startedAtMs)&&time(v.completedAtMs)&&typeof v.refreshComplete==='boolean'&&typeof v.applicabilityComplete==='boolean'&&nullableHash(v.applicabilityEvidenceSha256),'INPUT');
  demand(Array.isArray(v.windows)&&v.windows.length>=1&&v.windows.length<=8,'INPUT');
  const seen=new Set<string>();
  for(const w of v.windows) {
    exact(w,['windowId','windowClass','rawPercent','displayPercent','resetLabels','timezone','durationMs','resetLowerMs','resetUpperMs','refreshComplete','conflicting','accountedThroughMs']);
    demand(name(w.windowId)&&name(w.windowClass)&&!seen.has(w.windowId),'INPUT');seen.add(w.windowId);
    demand(text(w.rawPercent)&&Number.isInteger(w.displayPercent)&&w.displayPercent>=0&&w.displayPercent<=100,'INPUT');
    demand(Array.isArray(w.resetLabels)&&w.resetLabels.length>=1&&w.resetLabels.length<=4&&w.resetLabels.every(text),'INPUT');
    demand((w.timezone===null||text(w.timezone))&&nullableTime(w.durationMs)&&nullableTime(w.resetLowerMs)&&nullableTime(w.resetUpperMs),'INPUT');
    demand(typeof w.refreshComplete==='boolean'&&typeof w.conflicting==='boolean','INPUT');
    demand(w.accountedThroughMs===null,'COVERAGE');
  }
  return v;
}
/** Immutable host policy, not provider reset precision. Review/semantics hashes do not prove origin. */
export function captureMapping(value:unknown):any {
  const m=inert(value);
  exact(m,['format','policyVersion','epochId','accountId','accountBindingRevision','reviewRevision','issuedAtMs','expiresAtMs','trialDeadlineMs','completedResetPolicy','routes','windows','revision']);
  demand(m.format==='bowerloom/claude-window-mapping/v1'&&m.policyVersion===POLICY_VERSION&&name(m.epochId)&&name(m.accountId)&&hex(m.accountBindingRevision)&&hex(m.reviewRevision),'MAPPING');
  demand(time(m.issuedAtMs)&&time(m.expiresAtMs)&&time(m.trialDeadlineMs)&&m.issuedAtMs<m.trialDeadlineMs&&m.trialDeadlineMs<=m.expiresAtMs&&m.expiresAtMs-m.issuedAtMs<=LIMITS.operationMs,'MAPPING');
  demand(m.completedResetPolicy==='hold','MAPPING');exact(m.routes,ROUTES,'APPLICABILITY');
  demand(Array.isArray(m.windows)&&m.windows.length>=1&&m.windows.length<=8,'MAPPING');
  const seen=new Set<string>();
  for(const w of m.windows) {
    exact(w,['windowId','windowClass','durationMs','cutoffMs','timezone','rounding','semanticsRevision']);
    demand(name(w.windowId)&&name(w.windowClass)&&!seen.has(w.windowId),'MAPPING');seen.add(w.windowId);
    demand(time(w.durationMs)&&w.durationMs>0&&w.durationMs<=366*86400000,'DURATION');
    demand(time(w.cutoffMs)&&w.cutoffMs>=w.durationMs&&m.expiresAtMs<=w.cutoffMs&&m.trialDeadlineMs<w.cutoffMs,'RESET');
    demand(text(w.timezone),'TIMEZONE');demand(['floor-percent','nearest-percent','ceiling-percent'].includes(w.rounding),'ROUNDING');
    demand(hex(w.semanticsRevision),'MAPPING');
  }
  for(const r of ROUTES) {
    const names=m.routes[r];demand(Array.isArray(names)&&names.length>0&&names.length<=8&&new Set(names).size===names.length&&names.every((n:unknown)=>typeof n==='string'&&seen.has(n)),'APPLICABILITY');
  }
  // No observed limit may disappear. Nonapplicability requires another explicitly reviewed contract.
  demand([...seen].every(n=>ROUTES.some(r=>m.routes[r].includes(n))),'APPLICABILITY');
  const {revision,...body}=m;demand(hex(revision)&&digest(body)===revision,'MAPPING');return m;
}
export interface ProjectedObservation {
  observation: AccountObservation;
  evidence: unknown;
  mapping: unknown;
  mappingRevision: string;
  identityMeaning: 'host-policy-cutoff';
  provenanceDependency: 'trusted-host-registry';
  originIndependentlyVerified: false;
  executionAuthorized: false;
}
/** The host must register complete receipt/mapping data and separately pin expected identity/review.
 * Lookup and clock are synchronous trusted dependencies. No Promise/thenable is adopted as a reader.
 * A projector cannot renew itself; expiry/backwards clock closes this instance permanently.
 */
export function createObservationProjector(expected:unknown,lookup:(receiptId:string)=>unknown,clock:()=>number):{project(receiptId:unknown):Readonly<ProjectedObservation>} {
  const e=inert(expected);exact(e,['readerId','accountId','accountBindingRevision','mappingRevision','reviewRevision']);
  demand(name(e.readerId)&&name(e.accountId)&&hex(e.accountBindingRevision)&&hex(e.mappingRevision)&&hex(e.reviewRevision),'ACCOUNT_BINDING');
  demand(typeof lookup==='function'&&typeof clock==='function','LOOKUP');
  let lastClock=-1,closed=false;const seen=new Map<string,string>();
  const now=()=>{demand(!closed,'STALE');let n:unknown;try{n=clock();}catch{closed=true;return refuse('CLOCK');}
    if(!time(n)||n<lastClock){closed=true;return refuse('CLOCK');}lastClock=n;return n;};
  return Object.freeze({project(receiptId:unknown):Readonly<ProjectedObservation> {
    demand(name(receiptId),'INPUT');const before=now();let supplied:unknown;
    try { supplied=lookup(receiptId); } catch { refuse('LOOKUP'); }
    // Only known intrinsic Promise machinery may attach rejection observation; all promises refuse.
    if(isPromise(supplied))refusePromise(supplied);
    const registered=inert(supplied);exact(registered,['receipt','mapping'],'LOOKUP');
    const r=captureReceipt(registered.receipt),m=captureMapping(registered.mapping),after=now();
    demand(r.receiptId===receiptId&&r.readerId===e.readerId,'LOOKUP');
    demand(m.revision===e.mappingRevision&&m.reviewRevision===e.reviewRevision,'MAPPING');
    demand(r.accountId===e.accountId&&m.accountId===e.accountId&&r.accountBindingRevision===e.accountBindingRevision&&m.accountBindingRevision===e.accountBindingRevision&&hex(r.capacityLinkRevision),'ACCOUNT_BINDING');
    demand(r.authMethod==='claude.ai'&&r.apiProvider==='firstParty'&&['max','pro'].includes(r.subscriptionType),'AUTH');
    demand(r.creditsEnabled===false,'CREDITS');demand(r.ordinaryUsageAllowed===true,'AUTH');
    if(after>=m.expiresAtMs||after>=m.trialDeadlineMs){closed=true;refuse('STALE');}
    demand(r.startedAtMs>=m.issuedAtMs&&r.startedAtMs<=r.completedAtMs&&r.completedAtMs<=before&&after-r.startedAtMs<=LIMITS.observationAgeMs&&r.refreshComplete,'STALE');
    demand(r.applicabilityComplete&&hex(r.applicabilityEvidenceSha256)&&r.windows.length===m.windows.length,'APPLICABILITY');
    const windows:AccountObservation['windows']={};
    for(const w of r.windows) {
      const anchor=m.windows.find((a:any)=>a.windowId===w.windowId);
      demand(anchor&&anchor.windowClass===w.windowClass,'APPLICABILITY');
      demand(w.durationMs===anchor.durationMs,'DURATION');demand(w.timezone===anchor.timezone,'TIMEZONE');
      demand(time(w.resetLowerMs)&&time(w.resetUpperMs)&&w.resetLowerMs<=w.resetUpperMs&&w.resetLowerMs>=anchor.cutoffMs&&anchor.cutoffMs-anchor.durationMs<=r.startedAtMs,'RESET');
      demand(w.refreshComplete&&!w.conflicting,'STALE');
      // A whole-percent string is preserved and cross-checked; its interpretation is pinned host evidence.
      demand(w.rawPercent===`${w.displayPercent}%`,'ROUNDING');
      const delta=anchor.rounding==='floor-percent'?1:anchor.rounding==='nearest-percent'?0.5:0;
      windows[w.windowId]={usedPercent:Math.min(100,w.displayPercent+delta),durationMs:anchor.durationMs,resetAtMs:anchor.cutoffMs,accountedThroughMs:null};
    }
    const revision=digest(r),prior=seen.get(receiptId);
    demand(prior===undefined||prior===revision,'LOOKUP');demand(prior!==undefined||seen.size<64,'LOOKUP');seen.set(receiptId,revision);
    const routes:AccountObservation['routes']={};
    for(const key of ROUTES) routes[key]={requiredWindows:[...m.routes[key]],optionalWindows:[]};
    return inert({observation:{observationId:receiptId,accountId:e.accountId,observedAtMs:r.completedAtMs,authentication:'subscription',ordinaryUsageAllowed:true,windows,routes},
      evidence:r,mapping:m,mappingRevision:m.revision,identityMeaning:'host-policy-cutoff',provenanceDependency:'trusted-host-registry',originIndependentlyVerified:false,executionAuthorized:false});
  }});
}
