// Private finite composition. No default registry, observer, grant, public factory or retry path.
import type { PostgresAdmission } from '../../admission/src/index.js';
import type { AdmissionControl,ReservationRequest } from '../../admission/src/types.js';
import type { ModelProcess } from '../../runtime/src/types.js';
import { STARTUP_CLOCK,startupCopy,claudeStartupLaunchRevision } from '../../codex-adapter/src/startup-deadline.js';
import { ClaudeAdapterCore } from './adapter-core.js';
import { captureHost,measureHost,environmentRevision,type HostConfig } from './host.js';
import { createObservationProjector } from './observation.js';
import { decodeEnvelope } from './wire.js';
import { captureLimitedGrant,captureLimitedQualification,captureLimitedOwnerApproval,limitedEnvironmentRevision,LIMITED_POLICY } from './limited-policy.js';
import { validateLimitedResponse } from './limited-protocol.js';
import { ROUTES,LIMITS,inert,exact,digest,byteDigest,canonical,id,hex } from './policy.js';
import { captureHostCapabilities,captureGrant,captureQualification,hostBinding,LaunchScope,LaunchError,requireLaunch,type Fence,type CleanupReceipt } from './boundary.js';
const ROLE_PINS=Object.freeze({techLead:'0cf5258758c143c9fb53e27e3d7016bc0303299a532ac31f5b686f51f100a73e',knowledgeLibrary:'93ca37c698b3a211d74a06ef0796295201679195993d6062f74640202f1ddc51',agreement:'0e08c654ace7845d25b8bbea651b603d8a4e38bae3819f68ad18c91759c2bb77',practice:'ee86922a5ad4d530a125fc8cefc6a576522750ddfe806b9e03daac263cfd4a90',policy:'c6b827dac06e7d1cded46819179c1865a3dff7439651b03c3d5c9b2ac95cb369'});
export interface ExchangeOptions {
 host:HostConfig;fence:Fence;admission:Pick<PostgresAdmission,'reserveControlled'|'launchOnceControlled'|'completeControlled'>;
 lookupGrant(id:string,signal:AbortSignal):Promise<unknown>;lookupQualification(id:string,signal:AbortSignal):Promise<unknown>;
 /** Trusted owned observer returns complete registered receipt+mapping. No implementation is wired here. */
 observer:{readerId:string;read(signal:AbortSignal):Promise<unknown>;quiescence():Promise<CleanupReceipt>};roleAssets:unknown;
}
export interface LimitedExchangeOptions extends ExchangeOptions {lookupOwnerApproval(id:string,signal:AbortSignal):Promise<unknown>}
interface Activity {scope:LaunchScope;owners:Set<object>;pending:Set<Promise<void>>;uncertain:boolean}
export function captureRoleAssets(value:unknown):any {
 const v=inert(value);exact(v,Object.keys(ROLE_PINS));for(const [key,pin] of Object.entries(ROLE_PINS))requireLaunch(typeof v[key]==='string'&&byteDigest(v[key])===pin);return v;
}
/** Trial wrapper is separate from the unchanged original role/shared bytes. */
export function exchangePrompt(assets:unknown,task:string,parent:unknown=null):string {
 const a=captureRoleAssets(assets);requireLaunch(typeof task==='string'&&task.length>0&&Buffer.byteLength(task)<=4096);const p=parent===null?null:inert(parent);
 if(p!==null){exact(p,['kind','workerRole','task','requestedOutput']);requireLaunch(p.kind==='delegation-proposal'&&p.workerRole==='knowledge-library');for(const k of ['task','requestedOutput'])requireLaunch(typeof p[k]==='string'&&p[k].length>0&&Buffer.byteLength(p[k])<=4096);}
 const prompt=[`FINITE SYNTHETIC TRIAL. One response only. No tools, files, commands, network, delegation execution or paid fallback. The controller alone may authorize one knowledge-library worker. Return only the requested JSON.`,
 p===null?a.techLead:a.knowledgeLibrary,a.agreement,a.practice,a.policy,
 `SYNTHETIC TASK:\n${task}`,p===null?'Return {"kind":"delegation-proposal","workerRole":"knowledge-library","task":"...","requestedOutput":"..."}.':`PARENT OUTPUT ${digest(p)}:\n${canonical(p)}\nReturn {"kind":"worker-result","parentOutputRevision":"${digest(p)}","text":"..."}.`].join('\n\n');
 requireLaunch(Buffer.byteLength(prompt)<=LIMITS.inputBytes);return prompt;
}
class ExchangeEngine {
 readonly #mode:'strict'|'limited';readonly #o:ExchangeOptions&Partial<Pick<LimitedExchangeOptions,'lookupOwnerApproval'>>;readonly #assets:any;readonly #used=new Set<string>();readonly #activities=new Set<Activity>();#busy=false;#quarantined=false;
 constructor(options:ExchangeOptions|LimitedExchangeOptions,mode:'strict'|'limited'){this.#mode=mode;const o=captureHostCapabilities(options,['host','fence','admission','lookupGrant','lookupQualification','observer','roleAssets',...(mode==='limited'?['lookupOwnerApproval']:[])]);if(mode==='limited')requireLaunch(typeof o.lookupOwnerApproval==='function');
  requireLaunch(typeof o.lookupGrant==='function'&&typeof o.lookupQualification==='function');const observer=captureHostCapabilities(o.observer,['readerId','read','quiescence']);requireLaunch(id(observer.readerId)&&typeof observer.read==='function'&&typeof observer.quiescence==='function');
  this.#assets=captureRoleAssets(o.roleAssets);this.#o=Object.freeze({host:captureHost(o.host),fence:o.fence,admission:o.admission,lookupGrant:o.lookupGrant.bind(options),lookupQualification:o.lookupQualification.bind(options),...(mode==='limited'?{lookupOwnerApproval:o.lookupOwnerApproval.bind(options)}:{}),observer:Object.freeze({readerId:observer.readerId,read:observer.read.bind(o.observer),quiescence:observer.quiescence.bind(o.observer)}),roleAssets:this.#assets});
 }
 retainedOwners():number{return [...this.#activities].reduce((n,a)=>n+a.owners.size,0);}
 lifecycle():'pending'|'verified'|'unverified'{return this.#busy||[...this.#activities].some(a=>a.pending.size||a.scope.pending.size)?'pending':this.#quarantined||[...this.#activities].some(a=>a.uncertain)?'unverified':'verified';}
 async quiescence():Promise<CleanupReceipt>{for(const a of this.#activities)while(a.pending.size||a.scope.pending.size)await Promise.all([...a.pending,...a.scope.pending]);return {cleanup:this.lifecycle()==='verified'?'verified':'unverified'};}
 #track<T>(a:Activity,p:Promise<T>):Promise<T>{const settled=p.then(()=>{},()=>{});a.pending.add(settled);void settled.then(()=>a.pending.delete(settled));return p;}
 async #release(a:Activity,owner:object,cleanup:()=>Promise<CleanupReceipt>):Promise<void>{
  const p=this.#track(a,Promise.resolve().then(cleanup).then(r=>{if(r?.cleanup==='verified')a.owners.delete(owner);else{a.uncertain=true;this.#quarantined=true;}},()=>{a.uncertain=true;this.#quarantined=true;}));
  let timer:NodeJS.Timeout|undefined;await Promise.race([p,new Promise<void>(resolve=>{timer=setTimeout(()=>{a.uncertain=true;this.#quarantined=true;resolve();},4000);})]);clearTimeout(timer);
 }
 async run(input:unknown,signal:AbortSignal):Promise<any>{
  requireLaunch(!this.#busy&&!this.#quarantined&&!signal.aborted);const v=inert(input);exact(v,['operationId','grantId','grantRevision','syntheticTask']);requireLaunch(id(v.operationId)&&id(v.grantId)&&hex(v.grantRevision)&&typeof v.syntheticTask==='string'&&v.syntheticTask.length>0&&Buffer.byteLength(v.syntheticTask)<=4096);
  requireLaunch(!this.#used.has(v.operationId));this.#used.add(v.operationId);this.#busy=true;
  const o=this.#o;let a:Activity|undefined;
  try {
   const binding=hostBinding(o.fence.binding);
   // Even initial registry waiting is finite and owned; the tighter grant bound replaces no lifetime.
   const scope=new LaunchScope(signal,o.fence,Date.now()+LIMITS.operationMs);a={scope,owners:new Set(),pending:new Set(),uncertain:false};this.#activities.add(a);const activity=a;
   const capture=this.#mode==='limited'?captureLimitedGrant:captureGrant;
   const grant=capture(await scope.wait(()=>o.lookupGrant(v.grantId,scope.signal),1000));requireLaunch(grant.revision===v.grantRevision&&grant.operationId===v.operationId&&grant.grantId===v.grantId&&canonical(grant.hostBinding)===canonical(binding)&&grant.issuedAtMs<=Date.now());scope.tighten(grant.expiresAtMs);
   requireLaunch(grant.taskDigest===byteDigest(v.syntheticTask)&&grant.roleAssetRevision===digest(this.#assets)&&grant.leadPromptDigest===byteDigest(exchangePrompt(this.#assets,v.syntheticTask)));
   requireLaunch(grant.nativePath===o.host.nativePath&&grant.nativeSha256===o.host.nativeSha256&&grant.nativeVersion===o.host.nativeVersion&&grant.artifactRevision===o.host.artifactRevision);
   let qualification:any,ownerApproval:any;
   const refresh=async()=>{scope.check();requireLaunch(canonical(hostBinding(o.fence.binding))===canonical(binding));await scope.wait(()=>o.fence.guard(),1000);const g=capture(await scope.wait(()=>o.lookupGrant(v.grantId,scope.signal),1000));requireLaunch(canonical(g)===canonical(grant));const q=(this.#mode==='limited'?captureLimitedQualification:captureQualification)(await scope.wait(()=>o.lookupQualification(grant.qualificationId,scope.signal),1000),grant,Date.now());requireLaunch(q.environmentRevision===(this.#mode==='limited'?limitedEnvironmentRevision():environmentRevision()));if(this.#mode==='limited')ownerApproval=captureLimitedOwnerApproval(await scope.wait(()=>o.lookupOwnerApproval!(grant.ownerApprovalId,scope.signal),1000),grant,Date.now());qualification=q;scope.check();};
   let registered:unknown;const projector=createObservationProjector({readerId:o.observer.readerId,accountId:binding.accountId,accountBindingRevision:grant.accountBindingRevision,mappingRevision:grant.mappingRevision,reviewRevision:grant.reviewRevision},()=>registered,()=>Date.now());
   const observe=async()=>{await refresh();activity.owners.add(o.observer);const raw=await scope.wait(()=>o.observer.read(scope.signal),2000);registered=inert(raw);exact(registered,['receipt','mapping']);const result=projector.project((registered as any).receipt.receiptId);const mapping:any=result.mapping;scope.tighten(Math.min(mapping.expiresAtMs,mapping.trialDeadlineMs));scope.check();return result.observation;};
   await refresh();await scope.wait(()=>measureHost(o.host,scope.signal),5000);
   const outputs:any[]=[];let parent:any=null;
   for(const [index,phase] of ['lead','worker'].entries()) {
    scope.check();const prompt=exchangePrompt(this.#assets,v.syntheticTask,parent),parentRevision=parent===null?null:digest(parent),modelRoute=ROUTES[index]!;
    const request:ReservationRequest=inert({accountAlias:binding.accountAlias,jobId:`claude-${digest({installationId:binding.installationId,accountId:binding.accountId,operationId:v.operationId,phase})}`,candidateRevision:`sha256:${digest({grantRevision:grant.revision,phase,promptDigest:byteDigest(prompt),parentOutputRevision:parentRevision})}`,modelRoute,role:phase==='lead'?'lead':'worker',attempt:'initial',allowancePercent:grant.allowances[phase],paidFallback:false});
    const control=():AdmissionControl=>({binding:{...binding,requestDigest:`sha256:${digest(request)}`,authorizationRevision:grant.revision,expiresAtMs:scope.expiresAtMs},signal:scope.signal,assert:()=>scope.check()});
    const first=await observe(),reserved=await scope.wait(()=>o.admission.reserveControlled(request,first,control()),2000);requireLaunch(reserved.kind==='accepted');
    const fresh=await observe();let handle:ModelProcess|undefined,core:ClaudeAdapterCore|undefined;let result:Promise<{ok:true;text:string}|{ok:false}>|undefined;let planRevision:string|undefined;
    try {
     const launched=await scope.wait(()=>o.admission.launchOnceControlled(binding.accountAlias,request.jobId,reserved.launchPermit,fresh,async (captured,gate)=>{
      scope.check();requireLaunch(canonical(captured)===canonical(request));
      core=new ClaudeAdapterCore(o.host,{assertCurrent:()=>scope.check(),check:async()=>{const obs=await observe();await scope.wait(()=>gate.check(obs),2000);scope.check();},consume:(preparation)=>{
       scope.check();requireLaunch(preparation.launcherId===binding.launcherId&&preparation.accountBindingDigest===grant.accountBindingRevision&&preparation.promptDigest===byteDigest(prompt)&&preparation.modelRoute===modelRoute&&hex(preparation.launchPlanRevision));
       planRevision=preparation.launchPlanRevision;const admission=gate.consume();scope.check();return startupCopy({format:'bowerloom/claude-startup/v1',clock:STARTUP_CLOCK,admission,runtime:grant.runtime,accountBindingDigest:grant.accountBindingRevision,promptDigest:byteDigest(prompt),modelRoute,proposalPlanRevision:preparation.launchPlanRevision,launchPlanRevision:claudeStartupLaunchRevision(preparation.launchPlanRevision,grant.runtime,modelRoute)});
      }},this.#mode==='limited'?{kind:'limited',grant,qualification,ownerApproval}:{kind:'strict'});activity.owners.add(core);const ownedCore=core;
      // Capture late handles and result rejection before any reporting race can abandon ownership.
      const starting=this.#track(activity,core.start({launcherId:binding.launcherId,modelRoute,prompt,issuedAtMs:grant.issuedAtMs,expiresAtMs:scope.expiresAtMs,accountBindingRevision:grant.accountBindingRevision,requestRevision:request.candidateRevision.slice(7),parentOutputRevision:parentRevision},scope.signal).then(h=>{
       handle=h;activity.owners.add(h);result=this.#track(activity,h.result.then(text=>({ok:true as const,text}),()=>({ok:false as const})));if(scope.signal.aborted)void this.#release(activity,h,async()=>{await h.terminate();return ownedCore.quiescence();});return h;
      }));
      const h=await scope.wait(()=>starting,8000);scope.check();const p=inert(h.identity);exact(p,['processRef','ownershipDigest','pid','groupId','launcherId']);requireLaunch(id(p.processRef)&&hex(p.ownershipDigest)&&p.launcherId===binding.launcherId&&Number.isSafeInteger(p.pid)&&p.pid>0&&p.groupId===p.pid);return {processRef:p.processRef,launcherId:p.launcherId};
     },control()),12000);
     requireLaunch(launched.kind==='started'&&handle&&result&&launched.reservation.processRef===handle.identity.processRef&&launched.reservation.launcherId===binding.launcherId);
     const settled=await scope.wait(()=>result!,LIMITS.processMs);scope.check();let output:any,responseReceipt:any,valid=false;
     try{requireLaunch(settled.ok);output=decodeEnvelope(Buffer.from(settled.text));if(this.#mode==='limited'){responseReceipt=validateLimitedResponse(output,{requestedRoute:modelRoute,requestRevision:request.candidateRevision.slice(7),parentOutputRevision:parentRevision,launchPlanRevision:planRevision,qualificationRevision:grant.qualificationRevision,ownerApprovalRevision:grant.ownerApprovalRevision});output=responseReceipt.output;}
      if(phase==='lead'){exact(output,['kind','workerRole','task','requestedOutput']);requireLaunch(output.kind==='delegation-proposal'&&output.workerRole==='knowledge-library');for(const k of ['task','requestedOutput'])requireLaunch(typeof output[k]==='string'&&output[k].length>0&&Buffer.byteLength(output[k])<=4096);}
      else{exact(output,['kind','parentOutputRevision','text']);requireLaunch(output.kind==='worker-result'&&output.parentOutputRevision===parentRevision&&typeof output.text==='string'&&output.text.length>0&&Buffer.byteLength(output.text)<=16384);}
      valid=true;
     }catch{/* Rejected output still owes exact completion accounting after verified cleanup. */}
     await this.#release(activity,core!,()=>core!.quiescence());requireLaunch(!activity.owners.has(core!)&&!activity.uncertain);activity.owners.delete(handle);
     await scope.wait(()=>o.admission.completeControlled(binding.accountAlias,request.jobId,{kind:'completed',proofRef:`claude-output:${valid?digest(output):digest({requestRevision:request.candidateRevision,rejected:true})}`,observedAtMs:Date.now(),processRef:handle!.identity.processRef,fencedLauncherId:binding.launcherId},control()),2000);
     requireLaunch(valid);outputs.push({phase,modelRoute,requestRevision:request.candidateRevision,outputRevision:digest(output),...(this.#mode==='limited'?{responseReceipt,appliedEffort:'unknown',strictPolicyAccepted:false,ordinaryQualification:false}:{})});parent=output;
    }finally{if(handle)await this.#release(activity,handle,async()=>{await handle!.terminate();return core!.quiescence();});if(core)await this.#release(activity,core,()=>core!.quiescence());}
   }
   await this.#release(activity,o.observer,()=>o.observer.quiescence());requireLaunch(!activity.uncertain&&activity.owners.size===0);scope.check();return inert({format:this.#mode==='limited'?'bowerloom/claude-limited-exchange/v1':'bowerloom/claude-finite-exchange/v1',...(this.#mode==='limited'?{policyVersion:LIMITED_POLICY,ownerApprovalRevision:grant.ownerApprovalRevision,qualificationRevision:grant.qualificationRevision,appliedEffort:'unknown',strictPolicyAccepted:false}:{}),operationId:v.operationId,phases:outputs,output:parent,ordinaryQualification:false,protectedEffectsAuthorized:false});
  }catch{throw new LaunchError();}finally{if(a){a.scope.close();if(a.owners.has(o.observer))await this.#release(a,o.observer,async()=>{while(a!.scope.pending.size)await Promise.all([...a!.scope.pending]);return o.observer.quiescence();});if(a.owners.size||a.pending.size||a.scope.pending.size){a.uncertain=true;this.#quarantined=true;}else if(!a.uncertain)this.#activities.delete(a);}this.#busy=false;}
 }
}

/** Distinct private constructors. Neither is registered or exported by a public package index. */
export class ClaudeControlledExchange extends ExchangeEngine {constructor(options:ExchangeOptions){super(options,'strict');}}
export class LimitedClaudeControlledExchange extends ExchangeEngine {constructor(options:LimitedExchangeOptions){super(options,'limited');}}
