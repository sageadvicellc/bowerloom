// Private trusted-host composition. Not exported by index or selected by a public CLI.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { isPromise } from 'node:util/types';
import { canonicalJson, digest } from '../../contracts/src/index.js';
import type { PostgresAdmission } from '../../admission/src/index.js';
import type { AdmissionControl, AdmissionDispatchGate, ReservationRequest, ReconciliationProof } from '../../admission/src/types.js';
import { CodexAdapterCore, proposalPrompt } from './adapter-core.js';
import { codexArtifactRevision, codexBoundaryAccountRevision, measureCodexInstalledArtifact, planCodexProposalLaunch, type CodexArtifactBinding, type AdapterBoundaryGate } from './boundary.js';
import { startupCopy, startupLaunchRevision, type StartupRuntime } from './startup-deadline.js';
import { MODEL_ROUTE, POLICY_VERSION } from './policy.js';
import { AdapterError, check, id, sha, time } from './safe.js';
import type { AccountBinding, Installation, ModelProcess, ObservationReader, CleanupStatus, CleanupReceipt } from './types.js';
import type { HistoricalAccountingBinding, HistoricalAccountingExpected } from './historical-accounting.js';

export interface QualificationHostBinding { installationId:string; databaseName:string; admissionSchema:string; accountId:string; accountAlias:string; launcherId:string }
export interface QualificationFence { binding:QualificationHostBinding; signal:AbortSignal; assert():void; guard():Promise<void> }
export interface QualificationBootstrapOptions {
  admission:Pick<PostgresAdmission,'reserveControlled'|'launchOnceControlled'|'completeControlled'>;
  observer:ObservationReader; fence:QualificationFence; installation:Installation; binding:AccountBinding;
  accountAlias:string; runtime:StartupRuntime; artifact:CodexArtifactBinding; lookupGrant(grantId:string):Promise<unknown>;
}
export interface QualificationInput {grantId:string;grantRevision:string;operationId:string;taskInput:string}
export interface QualificationResult {
  status:'proposal'|'rejected'|'held'|'refused'; jobId:string; processRef:string|null; proposal:string|null;
  cleanup:'not-started'|'pending'|'verified'|'unverified'; reason:string|null; ordinaryQualified:false; effectsAuthorized:false;
}
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function data(v:unknown,depth=0,count={nodes:0}):any {
  check(depth<=10&&++count.nodes<=20000,'BOOTSTRAP_INPUT');
  if(v===null||typeof v==='boolean'||typeof v==='number'||typeof v==='string'){check(typeof v!=='string'||Buffer.byteLength(v)<=65536,'BOOTSTRAP_INPUT');return v;}
  check(v&&typeof v==='object','BOOTSTRAP_INPUT');const d=Object.getOwnPropertyDescriptors(v);
  if(Array.isArray(v)){check(Object.getPrototypeOf(v)===Array.prototype&&v.length<=1024&&Reflect.ownKeys(v).length===v.length+1,'BOOTSTRAP_INPUT');return Object.freeze(Array.from({length:v.length},(_,i)=>{const e=d[String(i)];check(e&&Object.hasOwn(e,'value')&&e.enumerable,'BOOTSTRAP_INPUT');return data(e.value,depth+1,count);}));}
  check([Object.prototype,null].includes(Object.getPrototypeOf(v))&&Object.keys(d).length<=40&&Reflect.ownKeys(v).length===Object.keys(d).length,'BOOTSTRAP_INPUT');
  const out:Record<string,unknown>=Object.create(null);for(const k of Object.keys(d).sort()){check(Object.hasOwn(d[k]!,'value')&&d[k]!.enumerable,'BOOTSTRAP_INPUT');out[k]=data(d[k]!.value,depth+1,count);}return Object.freeze(out);
}
function exact(v:any,keys:string[]){check(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.sort().join(),'BOOTSTRAP_SCHEMA');}
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
const refused=()=>new AdapterError('BOOTSTRAP_REFUSED');
class Scope {
  readonly abort=new AbortController();readonly signal:AbortSignal; #closed=false;#wall=0;#hr=0n;#expiry=Number.MAX_SAFE_INTEGER;#expiryHr=(1n<<64n)-1n;#timer:ReturnType<typeof setTimeout>|undefined;
  constructor(signal:AbortSignal,readonly fence:QualificationFence){this.signal=AbortSignal.any([signal,fence.signal,this.abort.signal]);}
  close(){this.#closed=true;this.abort.abort();clearTimeout(this.#timer);}
  expiry(wall:number){const hr=process.hrtime.bigint(),now=Date.now();const end=hr+BigInt(wall-now)*1000000n;this.#expiryHr=end<this.#expiryHr?end:this.#expiryHr;this.#expiry=Math.min(this.#expiry,wall);clearTimeout(this.#timer);this.check();this.#timer=setTimeout(()=>this.close(),Math.max(1,this.#expiry-Date.now()));}
  check(){try{check(!this.#closed&&!this.signal.aborted,'BOOTSTRAP_CLOSED');const response=this.fence.assert();if(isPromise(response))void response.catch(()=>{});check(response===undefined&&!this.#closed&&!this.signal.aborted,'BOOTSTRAP_CLOSED');const hr=process.hrtime.bigint(),wall=Date.now();check(time(wall)&&wall>=this.#wall&&hr>=this.#hr&&hr<this.#expiryHr&&wall<this.#expiry,'BOOTSTRAP_CLOSED');this.#wall=wall;this.#hr=hr;}catch{this.close();throw refused();}}
  async wait<T>(action:()=>Promise<T>,ms:number):Promise<T>{
    this.check();const end=process.hrtime.bigint()+BigInt(ms)*1000000n;
    let timer:ReturnType<typeof setTimeout>|undefined,aborted:()=>void=()=>{};
    const pending=Promise.resolve().then(()=>{this.check();check(process.hrtime.bigint()<end,'BOOTSTRAP_TIMEOUT');return action();});
    try{
      const value=await Promise.race([pending,new Promise<never>((_,reject)=>{aborted=()=>reject(refused());this.signal.addEventListener('abort',aborted,{once:true});timer=setTimeout(()=>{this.close();reject(refused());},ms);if(this.signal.aborted)aborted();})]);
      this.check();check(process.hrtime.bigint()<end,'BOOTSTRAP_TIMEOUT');return value;
    }catch{this.close();throw refused();}finally{clearTimeout(timer);this.signal.removeEventListener('abort',aborted);}
  }
}
interface Activity {running:boolean;owners:Set<object>;pending:Set<Promise<void>>;uncertain:boolean;finished:Promise<void>;finish():void}
interface Owned {handle:ModelProcess;terminate:()=>Promise<void>;identity:ModelProcess['identity']|null;result:Promise<{ok:true;proposal:string}|{ok:false}>;cleanup:'pending'|'verified'|'unverified';cleaning?:Promise<void>}
/** One host object may hold several historical operations, but no operation can be dispatched twice. */
export class QualificationBootstrap {
  readonly #options:QualificationBootstrapOptions;readonly #used=new Set<string>();readonly #owned=new Map<string,Owned>();readonly #activities=new Map<string,Activity>();#quarantined=false;
  constructor(options:QualificationBootstrapOptions){
    // Functions and service objects are trusted installed-host capabilities, captured rather than task-selected.
    const o=Object.getOwnPropertyDescriptors(options);check(Reflect.ownKeys(options).length===9&&Object.keys(o).sort().join()==='accountAlias,admission,artifact,binding,fence,installation,lookupGrant,observer,runtime' .split(',').sort().join(),'BOOTSTRAP_OPTIONS');
    check(Object.values(o).every(x=>Object.hasOwn(x,'value')),'BOOTSTRAP_OPTIONS');
    const fence=options.fence,binding=data(fence.binding);exact(binding,['installationId','databaseName','admissionSchema','accountId','accountAlias','launcherId']);Object.values(binding).forEach(id);
    check(fence.signal instanceof AbortSignal,'BOOTSTRAP_OPTIONS');
    const artifact=data(options.artifact),ownPath='dist/packages/codex-adapter/src/qualification-bootstrap.js';
    check(Array.isArray(artifact.files)&&artifact.files.some((f:any)=>f.path===ownPath)&&fileURLToPath(import.meta.url)===join(artifact.root,ownPath),'BOOTSTRAP_ARTIFACT');
    this.#options=Object.freeze({...options,installation:data(options.installation),binding:data(options.binding),runtime:data(options.runtime),artifact,
      fence:Object.freeze({binding,signal:fence.signal,assert:fence.assert.bind(fence),guard:fence.guard.bind(fence)}),
      observer:Object.freeze({read:options.observer.read.bind(options.observer),...(options.observer.quiescence?{quiescence:options.observer.quiescence.bind(options.observer)}:{})}),admission:Object.freeze({reserveControlled:options.admission.reserveControlled.bind(options.admission),launchOnceControlled:options.admission.launchOnceControlled.bind(options.admission),completeControlled:options.admission.completeControlled.bind(options.admission)}),lookupGrant:options.lookupGrant});
  }
  inspect(jobId:string):Readonly<{cleanup:Owned['cleanup'];processRef:string|null}>|null {const o=this.#owned.get(jobId);return o?Object.freeze({cleanup:o.cleanup,processRef:o.identity?.processRef??null}):null;}
  lifecycle(jobId:string):CleanupStatus|null {if(this.#activities.get(jobId)?.running)return 'pending';return this.#cleanupState(jobId);}
  #cleanupState(jobId:string):CleanupStatus|null {const a=this.#activities.get(jobId);if(!a)return null;const owned=this.#owned.get(jobId);return a.pending.size||owned?.cleanup==='pending'?'pending':a.uncertain||owned?.cleanup==='unverified'?'unverified':'verified';}
  retainedCleanupOwners(jobId:string):number{return this.#activities.get(jobId)?.owners.size??0;}
  async quiescence(jobId:string):Promise<CleanupReceipt>{const a=this.#activities.get(jobId);check(a,'BOOTSTRAP_OPERATION');await a.finished;while(a.pending.size)await Promise.all([...a.pending]);const owned=this.#owned.get(jobId);if(owned)await this.#cleanup(owned);const cleanup=this.lifecycle(jobId);return Object.freeze({cleanup:cleanup==='verified'?'verified':'unverified'});}
  #track<T>(a:Activity,promise:Promise<T>,receipt?:()=>Promise<CleanupReceipt>,owner?:object):Promise<T>{
    // Pending promises alone do not root the owner once an uncertain receipt settles.
    const retained=owner??receipt;if(retained)a.owners.add(retained);
    const settled=promise.then(()=>false,()=>true).then(async rejected=>{if(receipt){try{if((await receipt()).cleanup!=='verified')a.uncertain=true;else if(retained)a.owners.delete(retained);}catch{a.uncertain=true;}}else if(rejected)a.uncertain=true;else if(retained)a.owners.delete(retained);if(a.uncertain)this.#quarantined=true;});
    a.pending.add(settled);void settled.then(()=>a.pending.delete(settled));return promise;
  }
  #retain(jobId:string,handle:ModelProcess):Owned {
    const owned:Owned={handle,terminate:handle.terminate.bind(handle),identity:null,result:Promise.resolve(handle.result).then(proposal=>({ok:true as const,proposal}),()=>({ok:false as const})),cleanup:'pending'};
    this.#owned.set(jobId,owned);return owned;
  }
  #cleanup(owned:Owned):Promise<void> {
    if(!owned.cleaning)owned.cleaning=Promise.resolve().then(()=>owned.terminate()).then(()=>{owned.cleanup='verified';},()=>{owned.cleanup='unverified';this.#quarantined=true;});
    return owned.cleaning;
  }
  async #cleanupBounded(owned:Owned):Promise<void>{let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([this.#cleanup(owned),new Promise<void>(resolve=>{timer=setTimeout(resolve,4000);})]);}finally{clearTimeout(timer);}}
  async run(input:QualificationInput,signal:AbortSignal):Promise<Readonly<QualificationResult>>{
    const v=data(input);exact(v,['grantId','grantRevision','operationId','taskInput']);id(v.grantId);id(v.operationId);check(hex(v.grantRevision)&&typeof v.taskInput==='string','BOOTSTRAP_INPUT');
    const o=this.#options,h=o.fence.binding,jobId='qualification-'+sha(canonicalJson({installationId:h.installationId,accountId:h.accountId,operationId:v.operationId}));
    let startAttempted=false,cleanupWaited=false;
    const result=(status:QualificationResult['status'],reason:string|null,proposal:string|null=null):Readonly<QualificationResult>=>{const owned=this.#owned.get(jobId);return Object.freeze({status,jobId,processRef:owned?.identity?.processRef??null,proposal,cleanup:this.#cleanupState(jobId)==='pending'?'pending':this.#cleanupState(jobId)==='unverified'?'unverified':owned?.cleanup??(startAttempted?'verified':'not-started'),reason,ordinaryQualified:false,effectsAuthorized:false});};
    if(this.#quarantined||this.#used.has(jobId)||this.#used.size>=64)return result('refused','BOOTSTRAP_REPLAY');this.#used.add(jobId);
    let finish!:()=>void;const activity:Activity={running:true,owners:new Set(),pending:new Set(),uncertain:false,finished:new Promise<void>(r=>{finish=r;}),finish:()=>finish()};this.#activities.set(jobId,activity);
    const scope=new Scope(signal,o.fence);let durableAttempted=false;
    try{
      const prompt=proposalPrompt(v.taskInput),proposalPlan=planCodexProposalLaunch({version:o.installation.version,nativeSha256:o.installation.nativeSha256}),accountRevision=codexBoundaryAccountRevision(o.binding,o.accountAlias);
      const lookup=async()=>data(await scope.wait(()=>o.lookupGrant(v.grantId),1000));
      const grant=await lookup();
      const accountingMode=grant?.format==='bowerloom/codex-qualification-grant/v2';
      exact(grant,['format','grantId','revision','status','operationId','hostBinding','accountBindingDigest','artifactRevision','nativeVersion','nativeSha256','nativePath','runtime','proposalPlanRevision','launchPlanRevision','policyVersion','modelRoute','taskDigest','promptDigest','allowancePercent','issuedAtMs','expiresAtMs','reviewRevision','fixtureRevision',...(accountingMode?['historicalAccounting','historicalAccountingRevision']:[])]);
      const {revision,...body}=grant;
      check((accountingMode||grant.format==='bowerloom/codex-qualification-grant/v1')&&grant.status==='active'&&grant.grantId===v.grantId&&grant.operationId===v.operationId&&revision===v.grantRevision&&sha(canonicalJson(body))===revision,'BOOTSTRAP_GRANT');
      check(same(grant.hostBinding,h)&&o.binding.canonicalAccountId===h.accountId&&o.accountAlias===h.accountAlias&&grant.accountBindingDigest===accountRevision,'BOOTSTRAP_IDENTITY');
      check(grant.nativeVersion===o.installation.version&&grant.nativeSha256===o.installation.nativeSha256&&grant.nativePath===o.installation.nativePath&&same(grant.runtime,o.runtime),'BOOTSTRAP_IDENTITY');
      check(grant.artifactRevision===codexArtifactRevision(o.artifact)&&grant.proposalPlanRevision===proposalPlan.revision&&grant.launchPlanRevision===startupLaunchRevision(proposalPlan.revision,o.runtime),'BOOTSTRAP_IDENTITY');
      check(grant.policyVersion===POLICY_VERSION&&grant.modelRoute===MODEL_ROUTE&&grant.taskDigest===sha(v.taskInput)&&grant.promptDigest===sha(prompt)&&hex(grant.reviewRevision)&&hex(grant.fixtureRevision),'BOOTSTRAP_TASK');
      check(time(grant.issuedAtMs)&&time(grant.expiresAtMs)&&grant.issuedAtMs<=Date.now()&&grant.expiresAtMs>grant.issuedAtMs&&grant.expiresAtMs-grant.issuedAtMs<=300000,'BOOTSTRAP_EXPIRY');
      let effectiveExpiry=grant.expiresAtMs;
      const helperPath='dist/packages/codex-adapter/src/historical-accounting.js';
      if(accountingMode){
        // Narrow before measurement/import or observer work; full nested validation follows measured import.
        const b=grant.historicalAccounting;
        check(b&&time(b.issuedAtMs)&&time(b.expiresAtMs)&&b.issuedAtMs<=Date.now()&&b.expiresAtMs>b.issuedAtMs&&b.expiresAtMs-b.issuedAtMs<=300000,'BOOTSTRAP_EXPIRY');
        effectiveExpiry=Math.min(effectiveExpiry,b.expiresAtMs);
        check(o.artifact.files.some(f=>f.path===helperPath&&hex(f.sha256))
          &&fileURLToPath(new URL('./historical-accounting.js',import.meta.url))===join(o.artifact.root,helperPath),'BOOTSTRAP_ARTIFACT');
      }
      scope.expiry(effectiveExpiry);
      const expected:HistoricalAccountingExpected=Object.freeze({hostBinding:h,accountBindingDigest:accountRevision,reviewRevision:grant.reviewRevision,historicalAccountingRevision:grant.historicalAccountingRevision});
      let helper:Pick<typeof import('./historical-accounting.js'),'captureHistoricalAccounting'|'projectHistoricalAccounting'>|null=null;
      let accounting:Readonly<HistoricalAccountingBinding>|null=null;
      const accountingCurrent=()=>{
        scope.check();if(accountingMode){check(helper&&accounting,'BOOTSTRAP_ACCOUNTING');helper.captureHistoricalAccounting(accounting,expected,Date.now());scope.check();}
      };
      const project=(value:unknown):unknown=>{
        scope.check();if(!accountingMode)return value;
        check(helper&&accounting,'BOOTSTRAP_ACCOUNTING');const projected=helper.projectHistoricalAccounting(value,accounting,expected,Date.now());scope.check();return projected;
      };
      const refresh=async()=>{
        check(same(await lookup(),grant),'BOOTSTRAP_REVOKED');await scope.wait(()=>o.fence.guard(),1000);scope.check();
        await scope.wait(async()=>{
          check(await measureCodexInstalledArtifact(o.artifact,scope.signal)===grant.artifactRevision,'BOOTSTRAP_ARTIFACT');scope.check();
          if(accountingMode&&!helper){
            // Fixed measured path, v2 only: v1 retains no dependency on this optional private module.
            const loaded=await import('./historical-accounting.js');scope.check();
            check(typeof loaded.captureHistoricalAccounting==='function'&&typeof loaded.projectHistoricalAccounting==='function','BOOTSTRAP_ARTIFACT');
            const captured=loaded.captureHistoricalAccounting(grant.historicalAccounting,expected,Date.now());scope.check();
            helper=Object.freeze({captureHistoricalAccounting:loaded.captureHistoricalAccounting,projectHistoricalAccounting:loaded.projectHistoricalAccounting});accounting=captured;
          }
        },2000);
        accountingCurrent();
      };
      await refresh();
      const request:ReservationRequest={accountAlias:h.accountAlias,jobId,candidateRevision:'sha256:'+revision,modelRoute:MODEL_ROUTE,role:'worker',attempt:'initial',allowancePercent:{...grant.allowancePercent},paidFallback:false};
      const control:AdmissionControl={binding:{...h,requestDigest:digest(canonicalJson(request)),authorizationRevision:revision,expiresAtMs:effectiveExpiry},signal:scope.signal,assert:()=>scope.check()};
      const observation=()=>scope.wait(()=>this.#track(activity,Promise.resolve().then(()=>{scope.check();return o.observer.read(h.accountAlias,scope.signal);}),o.observer.quiescence,o.observer),2000);
      durableAttempted=true;const reserved=await o.admission.reserveControlled(request,project(await observation()),control);scope.check();
      if(reserved.kind!=='accepted')return result('refused',reserved.kind==='existing'?'BOOTSTRAP_REPLAY':'BOOTSTRAP_CAPACITY');
      await refresh();
      const launched=await o.admission.launchOnceControlled(h.accountAlias,jobId,reserved.launchPermit,project(await observation()),async(pinned,admissionGate:AdmissionDispatchGate)=>{
        check(same(pinned,request),'BOOTSTRAP_REQUEST');scope.check();
        const gate:AdapterBoundaryGate={
          check:async(s,fresh)=>{check(s===scope.signal,'BOOTSTRAP_SIGNAL');await refresh();await admissionGate.check(project(fresh??await observation()));scope.check();},
          assertCurrent:s=>{check(s===scope.signal,'BOOTSTRAP_SIGNAL');accountingCurrent();},
          consume:(preparation,s)=>{check(s===scope.signal,'BOOTSTRAP_SIGNAL');accountingCurrent();check(preparation.launcherId===h.launcherId&&preparation.accountBindingDigest===accountRevision&&preparation.promptDigest===grant.promptDigest&&preparation.modelRoute===MODEL_ROUTE&&preparation.launchPlanRevision===proposalPlan.revision,'BOOTSTRAP_BINDING');
            return startupCopy({format:'bowerloom/codex-startup/v1',clock:'darwin-node24.11.0-libuv1.51.0-hrtime-v1',admission:admissionGate.consume(),runtime:o.runtime,accountBindingDigest:accountRevision,promptDigest:grant.promptDigest,modelRoute:MODEL_ROUTE,proposalPlanRevision:proposalPlan.revision,launchPlanRevision:grant.launchPlanRevision});},
        };
        const core=new CodexAdapterCore({installation:o.installation,binding:o.binding,accountAlias:o.accountAlias},gate);
        startAttempted=true;const starting=core.start({launcherId:h.launcherId,taskInput:v.taskInput,modelRoute:MODEL_ROUTE},scope.signal);
        const pending=this.#track(activity,starting,()=>core.quiescence(),core).then(handle=>{
          const owned=this.#retain(jobId,handle);
          try{scope.check();}catch{void this.#cleanup(owned);throw refused();}
          return owned;
        });
        void pending.catch(()=>{});
        const owned=await scope.wait(()=>pending,40000);
        try{
          const identity=data(owned.handle.identity);exact(identity,['processRef','ownershipDigest','pid','groupId','launcherId']);id(identity.processRef);
          check(identity.launcherId===h.launcherId&&hex(identity.ownershipDigest)&&Number.isSafeInteger(identity.pid)&&identity.pid>0&&identity.groupId===identity.pid,'BOOTSTRAP_PROCESS');owned.identity=identity;
          return {processRef:identity.processRef,launcherId:identity.launcherId};
        }catch{void this.#cleanup(owned);throw refused();}
      },control);
      scope.check();if(launched.kind!=='started')return result('refused','BOOTSTRAP_REPLAY');
      const owned=this.#owned.get(jobId);check(owned?.identity&&owned.identity.processRef===launched.reservation.processRef,'BOOTSTRAP_PROCESS');
      const output=await scope.wait(()=>owned.result,40000);cleanupWaited=true;await this.#cleanupBounded(owned);check(owned.cleanup==='verified','BOOTSTRAP_CLEANUP');scope.check();
      check(same(data(owned.handle.identity),owned.identity),'BOOTSTRAP_PROCESS');
      const proof:ReconciliationProof={kind:'completed',proofRef:'qualification-'+sha(canonicalJson({jobId,processRef:owned.identity.processRef,ownershipDigest:owned.identity.ownershipDigest})),observedAtMs:Date.now(),processRef:owned.identity.processRef,fencedLauncherId:null};
      await o.admission.completeControlled(h.accountAlias,jobId,proof,control);scope.check();
      return output.ok?result('proposal',null,output.proposal):result('rejected','BOOTSTRAP_PROPOSAL_REJECTED');
    }catch{
      scope.close();if(activity.pending.size)this.#quarantined=true;const owned=this.#owned.get(jobId);if(owned&&!cleanupWaited)await this.#cleanupBounded(owned);
      return result(durableAttempted?'held':'refused',durableAttempted?'BOOTSTRAP_OUTCOME_HELD':'BOOTSTRAP_REFUSED');
    }finally{scope.close();activity.running=false;activity.finish();}
  }
}
