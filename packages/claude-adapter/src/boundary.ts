// Private controlled-launch capabilities. No public registration or default qualification exists.
import { isProxy } from 'node:util/types';
import { ROUTES,POLICY_VERSION,LIMITS,inert,exact,digest,hex,id,time,canonical } from './policy.js';
import type { StartupAuthorization,StartupPreparation } from '../../codex-adapter/src/startup-deadline.js';
export class LaunchError extends Error { readonly code='CLAUDE_LAUNCH_REFUSED';constructor(){super('CLAUDE_LAUNCH_REFUSED');} }
export function requireLaunch(value:unknown):asserts value {if(!value)throw new LaunchError();}
export function captureHostCapabilities(value:unknown,keys:readonly string[]):Record<string,any>{
  requireLaunch(value&&typeof value==='object'&&!isProxy(value));const p=Object.getPrototypeOf(value);requireLaunch(p===Object.prototype||p===null);
  const d=Object.getOwnPropertyDescriptors(value);requireLaunch(Reflect.ownKeys(value).length===keys.length&&keys.every(k=>d[k]&&Object.hasOwn(d[k],'value')&&d[k]!.enumerable));
  return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
}
export interface Fence {binding:{installationId:string;databaseName:string;admissionSchema:string;accountId:string;accountAlias:string;launcherId:string};signal:AbortSignal;assert():void;guard():Promise<void>}
export interface PrivateGate {check(signal:AbortSignal):Promise<void>;assertCurrent(signal:AbortSignal):void;consume(preparation:Readonly<StartupPreparation>,signal:AbortSignal):Readonly<StartupAuthorization>}
/** Closed private implementation choice; never a callback or boolean permission override. */
export type CorePolicy = Readonly<{kind:'strict'}>|Readonly<{kind:'limited';grant:unknown;qualification:unknown;ownerApproval:unknown}>;
export interface CleanupReceipt {cleanup:'verified'|'unverified'}
/** Finite original wall/hr scope. Pending work remains observed after bounded reporting. */
export class LaunchScope {
  readonly abort=new AbortController();readonly signal:AbortSignal;readonly pending=new Set<Promise<void>>();
  #closed=false;#wall:number;#hr:bigint;#wallEnd:number;#hrEnd:bigint;
  constructor(signal:AbortSignal,readonly fence:Fence,expiresAtMs:number){
    const wall=Date.now(),hr=process.hrtime.bigint();requireLaunch(time(wall)&&time(expiresAtMs)&&expiresAtMs>wall&&expiresAtMs-wall<=LIMITS.operationMs);
    this.#wall=wall;this.#hr=hr;this.#wallEnd=expiresAtMs;this.#hrEnd=hr+BigInt(expiresAtMs-wall)*1_000_000n;
    this.signal=AbortSignal.any([signal,fence.signal,this.abort.signal]);this.check();
  }
  check():void{try{requireLaunch(!this.#closed&&!this.signal.aborted);const r=this.fence.assert();requireLaunch(r===undefined&&!this.#closed&&!this.signal.aborted);
    const hr=process.hrtime.bigint(),wall=Date.now();requireLaunch(time(wall)&&wall>=this.#wall&&hr>=this.#hr&&wall<this.#wallEnd&&hr<this.#hrEnd);this.#wall=wall;this.#hr=hr;
  }catch{this.close();throw new LaunchError();}}
  get expiresAtMs():number{return this.#wallEnd;}
  tighten(expiresAtMs:number):void{this.check();requireLaunch(time(expiresAtMs));const delta=expiresAtMs-this.#wallEnd;if(delta<0){this.#wallEnd=expiresAtMs;this.#hrEnd+=BigInt(delta)*1_000_000n;}this.check();}
  close():void{this.#closed=true;this.abort.abort();}
  async wait<T>(action:()=>Promise<T>,limit:number):Promise<T>{
    this.check();requireLaunch(Number.isSafeInteger(limit)&&limit>0);limit=Math.min(limit,this.#wallEnd-this.#wall,Number((this.#hrEnd-this.#hr)/1_000_000n));requireLaunch(limit>0);const end=process.hrtime.bigint()+BigInt(limit)*1_000_000n;let timer:NodeJS.Timeout|undefined;let cancel=()=>{};
    const work=Promise.resolve().then(()=>{this.check();requireLaunch(process.hrtime.bigint()<end);return action();});
    const observed=work.then(()=>{},()=>{});this.pending.add(observed);void observed.then(()=>this.pending.delete(observed));
    try{const result=await Promise.race([work,new Promise<never>((_,reject)=>{cancel=()=>reject(new LaunchError());this.signal.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>{this.close();reject(new LaunchError());},limit);if(this.signal.aborted)cancel();})]);this.check();requireLaunch(process.hrtime.bigint()<end);return result;}
    catch{this.close();throw new LaunchError();}finally{clearTimeout(timer);this.signal.removeEventListener('abort',cancel);}
  }
}
export const HOST_KEYS=['installationId','databaseName','admissionSchema','accountId','accountAlias','launcherId'] as const;
export function hostBinding(value:unknown):Fence['binding']{const v=inert(value);exact(v,HOST_KEYS);requireLaunch(Object.values(v).every(id));return v;}
export function captureGrant(value:unknown):any {
  const v=inert(value);exact(v,['format','grantId','revision','status','operationId','hostBinding','accountBindingRevision','mappingRevision','qualificationId','qualificationRevision','artifactRevision','nativePath','nativeSha256','nativeVersion','runtime','policyVersion','roleAssetRevision','taskDigest','leadPromptDigest','allowances','issuedAtMs','expiresAtMs','reviewRevision','derivation']);
  const {revision,...body}=v;requireLaunch(hex(revision)&&digest(body)===revision&&v.format==='bowerloom/claude-exchange-grant/v1'&&v.status==='active'&&v.policyVersion===POLICY_VERSION&&v.derivation==='claude-one-child/v1');
  for(const k of ['grantId','operationId','qualificationId'])requireLaunch(id(v[k]));
  for(const k of ['accountBindingRevision','mappingRevision','qualificationRevision','artifactRevision','nativeSha256','roleAssetRevision','taskDigest','leadPromptDigest','reviewRevision'])requireLaunch(hex(v[k]));
  hostBinding(v.hostBinding);requireLaunch(typeof v.nativePath==='string'&&v.nativeVersion==='2.1.292');
  requireLaunch(time(v.issuedAtMs)&&time(v.expiresAtMs)&&v.issuedAtMs<v.expiresAtMs&&v.expiresAtMs-v.issuedAtMs<=LIMITS.operationMs);
  exact(v.allowances,['lead','worker']);for(const p of ['lead','worker']){const a=v.allowances[p];requireLaunch(a&&typeof a==='object'&&!Array.isArray(a)&&Object.keys(a).length>0&&Object.keys(a).length<=8);for(const [k,n] of Object.entries(a))requireLaunch(id(k)&&typeof n==='number'&&Number.isFinite(n)&&n>0&&n<=100);}
  return v;
}
/** Registry-origin assertions are trusted host authority, never self-qualification by model output. */
export function captureQualification(value:unknown,grant:any,now:number):any {
  const q=inert(value);exact(q,['format','receiptId','revision','status','nativeSha256','nativeVersion','artifactRevision','accountBindingRevision','policyVersion','environmentRevision','wireProfile','routes','controlsReviewRevision','issuedAtMs','expiresAtMs']);
  const {revision,...body}=q;requireLaunch(hex(revision)&&digest(body)===revision&&revision===grant.qualificationRevision&&q.receiptId===grant.qualificationId&&q.status==='active'&&q.format==='bowerloom/claude-launch-qualification/v1');
  requireLaunch(q.nativeSha256===grant.nativeSha256&&q.nativeVersion===grant.nativeVersion&&q.artifactRevision===grant.artifactRevision&&q.accountBindingRevision===grant.accountBindingRevision&&q.policyVersion===POLICY_VERSION&&canonical(q.routes)===canonical(ROUTES));
  requireLaunch(hex(q.controlsReviewRevision)&&hex(q.environmentRevision)&&q.wireProfile==='claude-json-unqualified/v1');
  requireLaunch(time(now)&&time(q.issuedAtMs)&&time(q.expiresAtMs)&&q.issuedAtMs<=now&&now<q.expiresAtMs&&q.expiresAtMs>=grant.expiresAtMs);return q;
}
