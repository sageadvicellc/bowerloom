import { isProxy } from 'node:util/types';
import { performance } from 'node:perf_hooks';
import { canonicalJson, digest } from '../../contracts/src/index.js';
import { AdmissionError, identifier, legacyStateCopy, observationCopy, validTime } from './validation.js';
import type { AccountState, ContinuityAccountState, ContinuityApproval, ContinuityAuthority, ContinuityScope, WindowContinuityInput, WindowContinuityPlan } from './types.js';

export const CONTINUITY_LOOKUP_MS = 1000;
export const continuityFailure = (code = 'CONTINUITY_INPUT'): AdmissionError => new AdmissionError(code, 'Window continuity refused. Preserve the account and inspect its durable state; do not retry automatically.');
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const hash = (x: unknown) => digest(canonicalJson(x));
const sha = (x: unknown): x is string => typeof x === 'string' && /^sha256:[a-f0-9]{64}$/.test(x);
export function continuityData(value: unknown, maxBytes = 1024 * 1024): any {
  let nodes = 0;
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > 150000 || depth > 24 || isProxy(v)) throw continuityFailure();
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'string' && !v.includes('\0') && Buffer.byteLength(v) <= 512) return;
    if (typeof v === 'number' && Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v))) return;
    if (!v || typeof v !== 'object' || (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype)) throw continuityFailure();
    const keys = Reflect.ownKeys(v); if (keys.length > 1025 || (Array.isArray(v) && keys.length !== v.length + 1)) throw continuityFailure();
    for (const key of keys) {
      if (Array.isArray(v) && key === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key) || !d?.enumerable || !Object.hasOwn(d, 'value')) throw continuityFailure();
      visit(d.value, depth + 1);
    }
  };
  visit(value, 0); if (Buffer.byteLength(canonicalJson(value)) > maxBytes) throw continuityFailure();
  return structuredClone(value);
}
function keys(value: any, names: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !same(Object.keys(value).sort(), [...names].sort())) throw continuityFailure();
}
function scopeCopy(value: unknown): ContinuityScope {
  const scope = continuityData(value); keys(scope, ['installationId','databaseName','admissionSchema','launcherId','accountId','accountAlias']);
  for (const v of Object.values(scope)) identifier(v);
  if (!/^trellis_[a-z][a-z0-9_]{0,46}$/.test(scope.admissionSchema)) throw continuityFailure();
  return scope;
}
export const continuityAliasesDigest = (accountId: string, aliases: string[]): string => hash([...aliases].sort().map(alias => ({alias,accountId})));
export function planWindowContinuity(originInput: unknown, input: WindowContinuityInput, now: number): WindowContinuityPlan {
  const origin = legacyStateCopy(continuityData(originInput)), data = continuityData(input);
  keys(data,['operationId','scope','observation','evidence','sourceRevision','reviewRevision']);
  identifier(data.operationId); const scope = scopeCopy(data.scope), observation = observationCopy(data.observation);
  keys(data.evidence,['receiptId','receiptRevision','artifactRevision','nativeRevision','accountBindingRevision']); identifier(data.evidence.receiptId);
  for (const [k,v] of Object.entries(data.evidence)) if (k !== 'receiptId' && !sha(v)) throw continuityFailure();
  if (!sha(data.sourceRevision) || !sha(data.reviewRevision)) throw continuityFailure();
  if (scope.accountId !== origin.accountId || !origin.aliases.includes(scope.accountAlias) || observation.accountId !== origin.accountId) throw continuityFailure('CONTINUITY_IDENTITY');
  const reservations = Object.values(origin.reservations), old = origin.highWater.primary, prior = origin.observation;
  if (!same(Object.keys(origin.highWater),['primary']) || !old || old.usedPercent <= 0 || !prior || origin.policy.completedResetPolicy !== 'hold'
    || reservations.length !== 4 || reservations.some(r => r.status !== 'COMPLETED' || r.proofs.length !== 1 || !same(Object.keys(r.retained),['primary']) || r.retained.primary!.percent !== 2)) throw continuityFailure('CONTINUITY_ELIGIBILITY');
  const priorSample=prior.windows.primary;
  if(!priorSample || old.usedPercent<priorSample.usedPercent || priorSample.durationMs!==old.durationMs
    || Math.abs(priorSample.resetAtMs-old.resetAtMs)>1000 || Math.abs(priorSample.resetAtMs-old.resetAtMs)>=old.durationMs)throw continuityFailure('CONTINUITY_ELIGIBILITY');
  const sample = observation.windows.primary;
  if (!validTime(now) || observation.observedAtMs > now || now-observation.observedAtMs > origin.policy.maxObservationAgeMs
    || observation.observedAtMs <= prior.observedAtMs || observation.observationId === prior.observationId) throw continuityFailure('CONTINUITY_OBSERVATION');
  if (observation.authentication !== 'subscription' || !observation.ordinaryUsageAllowed || !same(Object.keys(observation.windows).sort(),['primary','secondary'])
    || !sample || observation.windows.secondary !== null || sample.accountedThroughMs !== null || sample.durationMs !== old.durationMs
    || sample.resetAtMs <= now || sample.resetAtMs < sample.durationMs || sample.resetAtMs-sample.durationMs > observation.observedAtMs
    || sample.resetAtMs-old.resetAtMs <= 1000 || sample.resetAtMs-sample.durationMs >= old.resetAtMs) throw continuityFailure('CONTINUITY_OBSERVATION');
  const core = { ...data, scope, observation, originState: origin, originChecksum:hash(origin), aliasesDigest:continuityAliasesDigest(origin.accountId,origin.aliases), policyChecksum:hash(origin.policy), observationDigest:hash(observation), historicalFloorBasisPoints:Math.ceil(old.usedPercent*100), newAnchor:{resetAtMs:sample.resetAtMs,durationMs:sample.durationMs} };
  const resultCoreDigest = hash({...core,providerResetEstablished:false,coverageEstablished:false,providerAllocationEquivalenceEstablished:false,retentionReleaseAuthorized:false,effectsAuthorized:false}), payload = {format:'bowerloom/window-continuity-plan/v1' as const,...core,resultCoreDigest};
  return { ...payload, revision:hash(payload) };
}
export function continuityPlanCopy(input: unknown): WindowContinuityPlan {
  const p = continuityData(input); keys(p,['format','operationId','scope','observation','evidence','sourceRevision','reviewRevision','originState','originChecksum','aliasesDigest','policyChecksum','observationDigest','historicalFloorBasisPoints','newAnchor','resultCoreDigest','revision']);
  const expected = planWindowContinuity(p.originState,{operationId:p.operationId,scope:p.scope,observation:p.observation,evidence:p.evidence,sourceRevision:p.sourceRevision,reviewRevision:p.reviewRevision},p.observation?.observedAtMs);
  if (!same(p,expected)) throw continuityFailure(); return expected;
}
export function continuityApprovalCopy(input: unknown, plan: WindowContinuityPlan): ContinuityApproval {
  const a = continuityData(input); keys(a,['format','purpose','approvalId','planRevision','resultCoreDigest','scope','principalId','approverId','ownerEpoch','issuedAtMs','expiresAtMs','leaseExpiresAtMs','approvalRevision']);
  for (const key of ['approvalId','principalId','approverId']) identifier(a[key]);
  if (a.format !== 'bowerloom/window-continuity-approval/v1' || a.purpose !== 'window-continuity' || a.planRevision !== plan.revision || a.resultCoreDigest !== plan.resultCoreDigest || !same(scopeCopy(a.scope),plan.scope)
    || !Number.isSafeInteger(a.ownerEpoch) || a.ownerEpoch < 1 || !validTime(a.issuedAtMs) || !validTime(a.expiresAtMs) || !validTime(a.leaseExpiresAtMs)
    || a.expiresAtMs <= a.issuedAtMs || a.expiresAtMs-a.issuedAtMs > 300000 || a.leaseExpiresAtMs <= a.issuedAtMs) throw continuityFailure('CONTINUITY_AUTHORITY');
  const {approvalRevision,...payload}=a; if (approvalRevision !== hash(payload)) throw continuityFailure('CONTINUITY_AUTHORITY'); return a;
}
export function continuityDeadline(plan: WindowContinuityPlan, approval: ContinuityApproval, now: number): number {
  const cutoff = plan.observation.observedAtMs+plan.originState.policy.maxObservationAgeMs;
  if (!validTime(cutoff) || !validTime(now) || now < approval.issuedAtMs || now < plan.observation.observedAtMs) throw continuityFailure('CONTINUITY_AUTHORITY');
  const deadline=Math.min(approval.expiresAtMs,approval.leaseExpiresAtMs,cutoff,plan.newAnchor.resetAtMs-1);
  if (now >= deadline) throw continuityFailure('CONTINUITY_EXPIRED'); return deadline;
}
export function continuityEnvelopes(planInput: unknown, approvalInput: unknown): {held:ContinuityAccountState;applied:ContinuityAccountState} {
  const plan=continuityPlanCopy(planInput), approval=continuityApprovalCopy(approvalInput,plan);
  const held:ContinuityAccountState={...structuredClone(plan.originState),version:2,continuity:{format:'bowerloom/admission-window-continuity/v1',phase:'HELD',plan,approval,providerResetEstablished:false,coverageEstablished:false,providerAllocationEquivalenceEstablished:false,retentionReleaseAuthorized:false,effectsAuthorized:false}};
  const applied=structuredClone(held); applied.continuity.phase='APPLIED'; applied.observation=structuredClone(plan.observation);
  applied.highWater={primary:{...plan.newAnchor,usedPercent:plan.observation.windows.primary!.usedPercent}};
  continuityData(held,8*1024*1024);continuityData(applied,8*1024*1024);return {held,applied};
}
export function continuityStateCopy(input: unknown): ContinuityAccountState {
  try {
    const s=continuityData(input,8*1024*1024); keys(s,['version','accountId','aliases','policy','observation','highWater','reservations','continuity']);
    const c=s.continuity;keys(c,['format','phase','plan','approval','providerResetEstablished','coverageEstablished','providerAllocationEquivalenceEstablished','retentionReleaseAuthorized','effectsAuthorized']);
    const {held,applied}=continuityEnvelopes(c.plan,c.approval);
    if (s.version!==2 || !['HELD','APPLIED'].includes(c.phase) || !same(c,{...held.continuity,phase:c.phase})) throw continuityFailure();
    const {continuity: _extension,...ordinary}=s;
    legacyStateCopy({...ordinary,version:1});
    if(c.phase==='HELD'){if(!same(s,held))throw continuityFailure();return s;}
    for(const field of ['accountId','aliases','policy'])if(!same(s[field],applied[field as keyof ContinuityAccountState]))throw continuityFailure();
    for(const [id,record] of Object.entries(c.plan.originState.reservations))if(!same(s.reservations[id],record))throw continuityFailure();
    const o=s.observation, sample=o?.windows.primary, peak=s.highWater.primary, anchor=c.plan.newAnchor;
    if(!o || o.accountId!==s.accountId || o.authentication!=='subscription' || !o.ordinaryUsageAllowed
      || !same(Object.keys(o.windows).sort(),['primary','secondary']) || o.windows.secondary!==null || !sample || sample.accountedThroughMs!==null
      || sample.durationMs!==anchor.durationMs || Math.abs(sample.resetAtMs-anchor.resetAtMs)>1000 || Math.abs(sample.resetAtMs-anchor.resetAtMs)>=anchor.durationMs
      || o.observedAtMs<c.plan.observation.observedAtMs || !same(Object.keys(s.highWater),['primary']) || !peak
      || peak.resetAtMs!==anchor.resetAtMs || peak.durationMs!==anchor.durationMs || peak.usedPercent<sample.usedPercent
      || peak.usedPercent<c.plan.observation.windows.primary.usedPercent)throw continuityFailure();
    if(o.observationId===c.plan.observation.observationId && !same(o,c.plan.observation))throw continuityFailure();
    return s;
  } catch { throw continuityFailure('CORRUPT_ACCOUNT'); }
}
export function freezeContinuity<T>(value:T):Readonly<T>{if(value && typeof value==='object'){for(const v of Object.values(value))freezeContinuity(v);Object.freeze(value);}return value;}
export function captureContinuityAuthority(value:ContinuityAuthority):Readonly<ContinuityAuthority>{
  try {
    if(!value || isProxy(value) || typeof value!=='object')throw continuityFailure();
    const d=Object.getOwnPropertyDescriptors(value), names=Reflect.ownKeys(d);
    if(names.some(name=>typeof name!=='string') || !same(names.sort(),['assertCurrent','readObservation','resolveApproval']))throw continuityFailure();
    for(const item of Object.values(d))if(!item.enumerable || !Object.hasOwn(item,'value') || typeof item.value!=='function')throw continuityFailure();
    return Object.freeze({resolveApproval:d.resolveApproval!.value!,readObservation:d.readObservation!.value!,assertCurrent:d.assertCurrent!.value!});
  } catch { throw continuityFailure('CONTINUITY_AUTHORITY'); }
}
/** Bounded trusted capability wait; late outcomes never enter database work. */
export function continuityCapability<T>(signal:AbortSignal, operation:()=>Promise<T>):Promise<T>{
  if(isProxy(signal) || !(signal instanceof AbortSignal))return Promise.reject(continuityFailure('CONTINUITY_AUTHORITY'));
  return new Promise((resolve,reject)=>{
    let settled=false;const deadline=performance.now()+CONTINUITY_LOOKUP_MS;
    const finish=(error:AdmissionError|null,value?:T)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);error?reject(error):resolve(value!);};
    const abort=()=>finish(continuityFailure('CONTROL_CANCELLED'));
    const timer=setTimeout(()=>finish(continuityFailure('CONTINUITY_TIMEOUT')),CONTINUITY_LOOKUP_MS);
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(()=>{if(settled)return;if(signal.aborted){abort();return;}if(performance.now()>=deadline){finish(continuityFailure('CONTINUITY_TIMEOUT'));return;}return operation();}).then(value=>{
      if(signal.aborted)abort();else if(performance.now()>=deadline)finish(continuityFailure('CONTINUITY_TIMEOUT'));else finish(null,value!);
    },()=>{if(signal.aborted)abort();else finish(continuityFailure('CONTINUITY_AUTHORITY'));});
    if(signal.aborted)abort();
  });
}

/** Every ordinary v2 write conserves the origin and monotonic current charge. */
export function validateContinuityMutation(before:AccountState,after:AccountState):void{
  if(before.version===1){if(after.version!==1)throw continuityFailure('CONTINUITY_CONSERVATION');return;}
  const a=continuityStateCopy(after);
  if(before.continuity.phase!=='APPLIED' || a.continuity.phase!=='APPLIED' || !same(before.continuity,a.continuity)
    || !same(before.policy,a.policy) || a.highWater.primary!.usedPercent<before.highWater.primary!.usedPercent)
    throw continuityFailure('CONTINUITY_CONSERVATION');
}
export function continuityInspection(state:AccountState){
  // HELD has no usable accounting state. Its charge is the exact proposed result,
  // explicitly labeled; the stored legacy live fields have not been replaced.
  const held=state.version===2 && state.continuity.phase==='HELD';
  const peak=held?state.continuity.plan.observation.windows.primary!.usedPercent:(state.highWater.primary?.usedPercent??0);
  const historicalFloorBasisPoints=state.version===1?0:state.continuity.plan.historicalFloorBasisPoints;
  const segmentPeakBasisPoints=Math.ceil(peak*100);
  const retainedBasisPoints=Object.values(state.reservations).reduce((sum,r)=>sum+Math.ceil((r.retained.primary?.percent??0)*100),0);
  const headroomBasisPoints=Math.ceil(state.policy.headroomPercent*100);
  return {format:'bowerloom/window-continuity-inspection/v1' as const,accountId:state.accountId,version:state.version,
    phase:state.version===1?'LEGACY':state.continuity.phase,stateChecksum:hash(state),
    accountingBasis:held?'PROPOSED_HELD':state.version===1?'LEGACY':'APPLIED',
    scope:state.version===1?null:structuredClone(state.continuity.plan.scope),
    operationId:state.version===1?null:state.continuity.plan.operationId,
    approvalRevision:state.version===1?null:state.continuity.approval.approvalRevision,
    planRevision:state.version===1?null:state.continuity.plan.revision,
    originChecksum:state.version===1?null:state.continuity.plan.originChecksum,
    historicalFloorBasisPoints,segmentPeakBasisPoints,retainedBasisPoints,headroomBasisPoints,
    totalBasisPoints:historicalFloorBasisPoints+segmentPeakBasisPoints+retainedBasisPoints+headroomBasisPoints,
    effectsAuthorized:false as const,launchAuthorized:false as const,retryAuthorized:false as const};
}
