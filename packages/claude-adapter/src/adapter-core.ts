// Private actual process launcher. Constructed only by the controlled exchange; no public factory.
import { randomUUID } from 'node:crypto';
import { startGuardian,type OwnedGuardian } from '../../codex-adapter/src/supervisor.js';
import { assertStartupPreparation } from '../../codex-adapter/src/startup-deadline.js';
import type { ModelProcess } from '../../runtime/src/types.js';
import { prepareInstallation } from './installation.js';
import { LIMITS,route,inert,exact,hex,time,id,digest,byteDigest,canonical } from './policy.js';
import { captureHost,measureHost,privateWorkspace,candidateEnvironment,environmentRevision,type HostConfig,type PrivateWorkspace } from './host.js';
import { ClaudeWire,WIRE_PROFILE } from './wire.js';
import { LimitedClaudeWire } from './limited-wire.js';
import { captureLimitedGrant,captureLimitedQualification,captureLimitedOwnerApproval,prepareLimitedInstallation,LIMITED_ENV,limitedEnvironmentRevision } from './limited-policy.js';
import { requireLaunch,LaunchError,captureHostCapabilities,type PrivateGate,type CleanupReceipt,type CorePolicy } from './boundary.js';
export interface CoreInput {launcherId:string;modelRoute:string;prompt:string;issuedAtMs:number;expiresAtMs:number;accountBindingRevision:string;requestRevision:string;parentOutputRevision:string|null}
export class ClaudeAdapterCore {
  readonly #limited:any|null;readonly #host:Readonly<HostConfig>;readonly #gate:PrivateGate;readonly #pending=new Set<Promise<void>>();readonly #owners=new Set<object>();
  #busy=false;#uncertain=false;#quarantined=false;
  constructor(host:HostConfig,gate:PrivateGate,policy:CorePolicy={kind:'strict'}){this.#host=captureHost(host);const p=inert(policy);requireLaunch(p.kind==='strict'||p.kind==='limited');if(p.kind==='strict'){exact(p,['kind']);this.#limited=null;}else{exact(p,['kind','grant','qualification','ownerApproval']);const grant=captureLimitedGrant(p.grant);captureLimitedQualification(p.qualification,grant,Date.now());captureLimitedOwnerApproval(p.ownerApproval,grant,Date.now());requireLaunch(grant.artifactRevision===this.#host.artifactRevision&&grant.nativePath===this.#host.nativePath&&grant.nativeSha256===this.#host.nativeSha256);this.#limited=p;}const g=captureHostCapabilities(gate,['check','assertCurrent','consume']);requireLaunch(Object.values(g).every(f=>typeof f==='function'));this.#gate=Object.freeze({check:g.check.bind(gate),assertCurrent:g.assertCurrent.bind(gate),consume:g.consume.bind(gate)});}
  #track<T>(promise:Promise<T>):Promise<T>{const observed=promise.then(()=>{},()=>{});this.#pending.add(observed);void observed.then(()=>this.#pending.delete(observed));return promise;}
  retainedOwners():number{return this.#owners.size;}
  lifecycle():'pending'|'verified'|'unverified'{return this.#pending.size||this.#busy?'pending':this.#uncertain?'unverified':'verified';}
  async quiescence():Promise<CleanupReceipt>{while(this.#pending.size)await Promise.all([...this.#pending]);return Object.freeze({cleanup:this.#uncertain?'unverified':'verified'});}
  start(input:CoreInput,signal:AbortSignal):Promise<ModelProcess>{return this.#track(this.#start(input,signal));}
  async #start(input:CoreInput,signal:AbortSignal):Promise<ModelProcess>{
    requireLaunch(!this.#quarantined&&!this.#busy&&!signal.aborted);const v=inert(input);exact(v,['launcherId','modelRoute','prompt','issuedAtMs','expiresAtMs','accountBindingRevision','requestRevision','parentOutputRevision']);
    requireLaunch(id(v.launcherId)&&hex(v.accountBindingRevision)&&hex(v.requestRevision)&&(v.parentOutputRevision===null||hex(v.parentOutputRevision))&&typeof v.prompt==='string'&&Buffer.byteLength(v.prompt)<=LIMITS.inputBytes&&time(v.issuedAtMs)&&time(v.expiresAtMs));const modelRoute=route(v.modelRoute);this.#busy=true;
    const current=()=>{requireLaunch(!signal.aborted&&Date.now()<v.expiresAtMs);this.#gate.assertCurrent(signal);requireLaunch(!signal.aborted&&Date.now()<v.expiresAtMs);};
    let guardian:OwnedGuardian|undefined,work:PrivateWorkspace|undefined,startAttempted=false,workspaceAttempted=false;
    const stream=this.#limited?new LimitedClaudeWire():new ClaudeWire();const processRef=randomUUID();
    let cleaning:Promise<void>|undefined;
    const cleanup=()=>cleaning??=(async()=>{
      let verified=true;try{if(guardian)await guardian.terminate();}catch{verified=false;}
      try{if(work)await work.close();}catch{verified=false;}
      if(!verified){this.#uncertain=true;this.#quarantined=true;}else if(!this.#uncertain){if(guardian)this.#owners.delete(guardian);if(work)this.#owners.delete(work);}
      requireLaunch(verified);
    })();
    try {
      await this.#gate.check(signal);current();await measureHost(this.#host,signal);current();workspaceAttempted=true;work=await privateWorkspace(this.#host.workRoot,signal);this.#owners.add(work);current();
      const measured=await measureHost(this.#host,signal);current();await work.verify();current();
      const expected={nativePath:this.#host.nativePath,nativeSha256:this.#host.nativeSha256,nativeVersion:this.#host.nativeVersion,artifactRevision:this.#host.artifactRevision};
      const plan=(this.#limited?prepareLimitedInstallation:prepareInstallation)(measured,expected,{route:modelRoute,promptSchema:'bowerloom/claude-finite-request/v1',prompt:v.prompt,issuedAtMs:v.issuedAtMs,expiresAtMs:v.expiresAtMs},Date.now());
      const environment=this.#limited?LIMITED_ENV:candidateEnvironment();requireLaunch(digest(plan.environment)===digest(environment));if(this.#limited){captureLimitedQualification(this.#limited.qualification,this.#limited.grant,Date.now());captureLimitedOwnerApproval(this.#limited.ownerApproval,this.#limited.grant,Date.now());requireLaunch(plan.environmentRevision===limitedEnvironmentRevision());}else requireLaunch(environmentRevision().length===64&&WIRE_PROFILE==='claude-json-unqualified/v1');
      const preparation=Object.freeze({launcherId:v.launcherId,accountBindingDigest:v.accountBindingRevision,promptDigest:byteDigest(v.prompt),modelRoute,launchPlanRevision:plan.revision});
      // Final asynchronous authority/capacity refresh follows all host/workspace preparation.
      await this.#gate.check(signal);current();const startup=assertStartupPreparation(this.#gate.consume(preparation,signal),preparation);requireLaunch(startup.format==='bowerloom/claude-startup/v1');current();
      startAttempted=true;const opening=startGuardian({executable:this.#host.nativePath,argv:[...plan.argv],cwd:work.cwd,env:environment,seconds:60,stdoutBytes:LIMITS.stdoutBytes,stderrBytes:LIMITS.stderrBytes,startup},signal,(which,bytes)=>{if(which==='stdout')stream.feed(bytes);});
      guardian=await opening;this.#owners.add(guardian);void guardian.done.catch(()=>{});current();guardian.write(v.prompt);guardian.end();
      const own=guardian,workspace=work;
      const result=this.#track((async()=>{
        try{const done=await own.done;requireLaunch(done.leaderReaped&&done.groupGone&&done.code===0&&done.reason===null);current();await workspace.verify();current();
          // Strict still refuses missing effective effort. Limited uses only its fixed separately qualified profile.
          const validated:any=stream.finish({requestedRoute:modelRoute,requestRevision:v.requestRevision,parentOutputRevision:v.parentOutputRevision,...(this.#limited?{launchPlanRevision:plan.revision,qualificationRevision:this.#limited.grant.qualificationRevision,ownerApprovalRevision:this.#limited.grant.ownerApprovalRevision}:{})});
          current();return canonical(this.#limited?validated:validated.evidence.output);
        }catch{throw new LaunchError();}
        finally{try{await cleanup();}finally{this.#busy=false;}}
      })());
      return {identity:{...own.identity,processRef,launcherId:v.launcherId},result,terminate:()=>this.#track(cleanup().catch(()=>{this.#quarantined=true;throw new LaunchError();}))};
    }catch{
      if((startAttempted&&!guardian)||(workspaceAttempted&&!work)){this.#uncertain=true;this.#quarantined=true;}
      try{await cleanup();}catch{/* ownership is retained */}this.#busy=false;throw new LaunchError();
    }
  }
}
