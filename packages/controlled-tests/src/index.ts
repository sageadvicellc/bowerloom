import { canonicalJson,digest } from '../../contracts/src/index.js';
import { systemClock } from '../../broker/src/index.js';
import type { Principal,Scope,Receipt } from '../../broker/src/index.js';
import type { RunInput,Acceptance,AcceptanceContext } from '../../runtime/src/types.js';
import { pin } from '../../runtime/src/ledger.js';
import { copy,fail,frozen,id,manifest,owner,record,report,request,same,scope,time } from './validation.js';
import { TestError } from './types.js';
import type { TestDependencies,TestManifest,TestRecord,TestExecution,TestEvidence,TestReport } from './types.js';
export type * from './types.js';
export { CRITERIA,TestError } from './types.js';
export { PostgresTestStore } from './postgres.js';
export { validateTestManifestPlan } from './validation.js';
export const validateRegisteredManifest=(bytes:string):TestManifest=>copy(manifest(bytes));
export const serializeTestManifest=(value:TestManifest):string=>{const s=canonicalJson(copy(value,4096));manifest(s);return s;};
export const testOperationId=(s:Scope,receipt:Receipt):string=>{if(!receipt||typeof receipt.operationKey!=='string'||!/^sha256:[a-f0-9]{64}$/.test(receipt.operationKey))fail('WRITE_RECEIPT_REQUIRED');return digest(canonicalJson({scope:scope(s),writeOperationKey:receipt.operationKey}));};
interface Active { scope:Scope; abort:AbortController; reap:Promise<void>|null }
export class RegisteredTestAcceptance {
  readonly #deps:TestDependencies;readonly #manifest:TestManifest;readonly #active=new Map<string,Active>();#last=0;#busy=false;
  constructor(deps:TestDependencies){this.#manifest=frozen(manifest(deps.manifest));if(typeof deps.executor?.execute!=='function'||typeof deps.executor?.reap!=='function'||typeof deps.identity?.authenticate!=='function')fail('TEST_DEPENDENCIES');this.#deps={...deps,clock:deps.clock??systemClock};}
  #now():number{const at=this.#deps.clock!.now();if(!time(at)||at<this.#last)fail('TEST_CLOCK');this.#last=at;return at;}
  async #principal(credential:unknown):Promise<Principal>{try{return copy(await this.#deps.identity.authenticate(credential),1024);}catch{fail('UNAUTHENTICATED');}}
  async #bounded<T>(promise:Promise<T>,deadline:number,signal?:AbortSignal):Promise<T>{
    let stop!:()=>void,remove=()=>{};const aborted=new Promise<never>((_,reject)=>{
      stop=this.#deps.clock!.alarm(deadline,()=>reject(new TestError('TEST_DEADLINE')));
      if(signal){const abort=()=>reject(new TestError('CANCELLED'));signal.addEventListener('abort',abort,{once:true});remove=()=>signal.removeEventListener('abort',abort);if(signal.aborted)abort();}
    });try{return await Promise.race([promise,aborted]);}finally{stop();remove();}
  }
  async #reap(operationId:string,abort=true):Promise<void>{const active=this.#active.get(operationId);if(!active)return;
    if(abort)active.abort.abort();active.reap??=Promise.resolve().then(()=>this.#deps.executor.reap(operationId));void active.reap.catch(()=>{});
    try{await this.#bounded(active.reap,this.#now()+2000);this.#active.delete(operationId);}catch{active.reap=null;fail('TEST_CLEANUP_UNKNOWN');}
  }
  async #stop(s:Scope,operationId:string,reason:string):Promise<void>{
    this.#active.get(operationId)?.abort.abort();
    await this.#deps.store.transaction(s,operationId,(current)=>{
      if(current&&current.status==='CLAIMED'){current.status=reason==='CANCELLED'?'CANCELLED':'HOLD';current.reason=reason;}
      return{record:current,result:undefined};
    });
  }
  async read(value:RunInput,receiptValue:Receipt,context:AcceptanceContext):Promise<Acceptance>{
    if(this.#busy||this.#active.size)fail('TEST_EXECUTOR_BUSY');this.#busy=true;
    try{return await this.#read(value,receiptValue,context);}finally{this.#busy=false;}
  }
  async #read(value:RunInput,receiptValue:Receipt,context:AcceptanceContext):Promise<Acceptance>{
    if(!context||typeof context.guard!=='function'||!context.signal||!id(context.launcherId))fail('TEST_CONTEXT_REQUIRED');
    const input=pin(copy(value)),receipt=copy(receiptValue),s=scope({workspaceId:input.task.workspaceId,runId:input.task.runId,taskId:input.task.taskId});
    const operationId=testOperationId(s,receipt),principal=await this.#principal(context.ownerCredential);
    await context.guard();if(context.signal.aborted)fail('CANCELLED');
    const claimed=await this.#deps.store.transaction(s,operationId,(current,authority)=>{
      const at=this.#now(),bound=request(input,receipt,authority,principal,this.#manifest,at),requestDigest=digest(canonicalJson(bound.request));
      if(current){const valid=record(current);if(valid.request.requestDigest!==requestDigest||valid.approvalDigest!==bound.approvalDigest)fail('TEST_BINDING_CONFLICT');return{record:valid,result:{created:false,record:valid}};}
      if(context.signal.aborted)fail('CANCELLED');if(this.#active.size)fail('TEST_EXECUTOR_BUSY');
      const execution:TestExecution={...bound.request,requestDigest,launcherId:context.launcherId,startedAtMs:at,deadlineMs:Math.min(at+this.#manifest.limits.timeoutMs,bound.expiresAtMs)};
      const next=record({version:1,id:operationId,request:execution,approvalDigest:bound.approvalDigest,status:'CLAIMED',reason:null,evidence:null,evidenceRef:null});
      return{record:next,result:{created:true,record:next}};
    });
    if(!claimed.created){if(claimed.record.evidence)return{accepted:claimed.record.evidence.accepted,evidenceRef:claimed.record.evidenceRef!};fail(claimed.record.reason??'TEST_OUTCOME_UNKNOWN');}
    const active:Active={scope:s,abort:new AbortController(),reap:null};this.#active.set(operationId,active);
    const signal=AbortSignal.any([active.abort.signal,context.signal]);let attempted=false;
    try{
      await context.guard();if(signal.aborted)fail('CANCELLED');
      // Fresh authority under the same broker-row lock immediately before dispatch.
      await this.#deps.store.transaction(s,operationId,(current,authority)=>{
        const bound=request(input,receipt,authority,principal,this.#manifest,this.#now());
        if(!current||current.status!=='CLAIMED'||current.request.requestDigest!==digest(canonicalJson(bound.request))||current.approvalDigest!==bound.approvalDigest)fail('TEST_STOPPED');
        if(signal.aborted)fail('CANCELLED');return{record:current,result:undefined};
      });
      await context.guard();if(signal.aborted||this.#now()>=claimed.record.request.deadlineMs)fail(signal.aborted?'CANCELLED':'TEST_DEADLINE');
      attempted=true;
      const running=Promise.resolve().then(()=>{if(signal.aborted)fail('CANCELLED');return this.#deps.executor.execute(frozen(copy(claimed.record.request)),signal);});
      void running.catch(()=>{});
      const result=await this.#bounded(running,claimed.record.request.deadlineMs,signal);
      const checked=report(result,claimed.record);
      await this.#reap(operationId,false);
      await context.guard();
      const evidence=await this.#deps.store.transaction(s,operationId,(current,authority)=>{
        const finished=this.#now(),bound=request(input,receipt,authority,principal,this.#manifest,finished);
        if(!current||current.status!=='CLAIMED'||signal.aborted||context.signal.aborted)fail('CANCELLED');
        if(finished>current.request.deadlineMs||current.approvalDigest!==bound.approvalDigest||current.request.requestDigest!==digest(canonicalJson(bound.request)))fail('TEST_RESULT_STALE');
        const accepted=checked.checks.every(c=>c.passed);
        const e:TestEvidence={format:'trellis/test-evidence/v0.7-alpha',request:current.request,approvalDigest:current.approvalDigest,finishedAtMs:finished,report:checked,accepted,processesReaped:true};
        current.status=accepted?'PASSED':'FAILED';current.evidence=e;current.evidenceRef=digest(canonicalJson(e));current.reason=null;
        return{record:record(current),result:{accepted,evidenceRef:current.evidenceRef}};
      });return evidence;
    }catch(error){
      let reason=error instanceof TestError?error.code:'TEST_EXECUTION_UNKNOWN';
      if(attempted){try{await this.#reap(operationId);}catch{reason='TEST_CLEANUP_UNKNOWN';}}else this.#active.delete(operationId);
      try{await this.#stop(s,operationId,reason);}catch{throw new TestError('TEST_OUTCOME_UNKNOWN');}
      throw new TestError(reason);
    }
  }
  async inspect(s:Scope,operationId:string,credential:unknown):Promise<TestRecord|null>{const principal=await this.#principal(credential);return this.#deps.store.transaction(s,operationId,(current,authority)=>{owner(authority,principal,this.#now());return{record:current,result:current};});}
  async readEvidence(s:Scope,operationId:string,evidenceRef:string,credential:unknown):Promise<TestEvidence>{
    const stored=await this.inspect(s,operationId,credential);if(!stored?.evidence||stored.evidenceRef!==evidenceRef)fail('TEST_EVIDENCE_NOT_FOUND');return copy(stored.evidence);
  }
  async cancel(input:RunInput):Promise<void>{const s=scope({workspaceId:input.task.workspaceId,runId:input.task.runId,taskId:input.task.taskId});
    const targets=[...this.#active].filter(([,a])=>same(a.scope,s));for(const [,a] of targets)a.abort.abort();
    const results=await Promise.allSettled(targets.map(async([key])=>{await this.#stop(s,key,'CANCELLED');await this.#reap(key);}));
    if(results.some(r=>r.status==='rejected'))fail('TEST_CLEANUP_UNKNOWN');
  }
  async close():Promise<void>{for(const a of this.#active.values())a.abort.abort();const stopped=await Promise.allSettled([...this.#active.keys()].map(key=>this.#reap(key)));if(stopped.some(r=>r.status==='rejected'))fail('TEST_CLEANUP_UNKNOWN');}
}
