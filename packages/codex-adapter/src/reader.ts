import type { AccountObservation } from '../../admission/src/types.js';
import type { Installation,AccountBinding,ObservationReader,CleanupStatus,CleanupReceipt } from './types.js';
import { bindingCopy,observationFromResponses,requireHeadroom,capacityCeiling,provisionalMargin,sanitized,verifyModel,verifyProvenance,supportedSubscriptionPlan } from './observation.js';
import { installationChecks,workspace } from './installation.js';
import { startGuardian,type OwnedGuardian } from './supervisor.js';
import { AdapterError,check,object,strictJson } from './safe.js';
import { CONTROLS,LIMITS,RPC_METHODS } from './policy.js';
export async function readAuthenticatedObservation(
  rpc:(method:string,params:unknown)=>Promise<unknown>,initialized:()=>void,binding:AccountBinding,cwd:string,started:number,now:()=>number=Date.now,stopUsedPercent:number=75,provisionalPercent:number=10
):Promise<AccountObservation>{
  capacityCeiling(stopUsedPercent);provisionalMargin(provisionalPercent);
  await rpc('initialize',{clientInfo:{name:'trellis_codex_observer',version:'0.7.0-alpha.0'},capabilities:{experimentalApi:true}});
  initialized();
  const cfg=await rpc('config/read',{cwd,includeLayers:true}),req=await rpc('configRequirements/read',{});verifyProvenance(cfg,req);
  for(const name of ['local','remote'])check(object(await rpc('environment/status',{environmentId:name})).status==='unknown','EXECUTION_ENVIRONMENT_AVAILABLE');
  const account=await rpc('account/read',{refreshToken:false});
  const auth=object(object(account).account);check(auth.type==='chatgpt'&&supportedSubscriptionPlan(auth.planType),'SUBSCRIPTION_REQUIRED');
  verifyModel(await rpc('model/list',{includeHidden:false,limit:100}));
  const usage=await rpc('account/rateLimits/read',{});
  const observation=observationFromResponses(account,usage,binding,started,now());requireHeadroom(observation,stopUsedPercent,provisionalPercent);return observation;
}
// Private stdio reader. No thread, turn, tool, login, token export or auth-file API exists here.
export class CodexObservationReader implements ObservationReader {
  readonly #install:Installation;readonly #binding:AccountBinding;readonly #ceiling:number;readonly #margin:number;#busy=false;#quarantined=false;#uncertain=false;#active:Promise<void>|null=null;readonly #retained=new Set<unknown>();
  constructor(installation:Installation,binding:AccountBinding,stopUsedPercent:number=75,provisionalPercent:number=10){this.#install=structuredClone(installation);this.#binding=bindingCopy(binding);this.#ceiling=capacityCeiling(stopUsedPercent);this.#margin=provisionalMargin(provisionalPercent);}
  cleanupStatus():CleanupStatus{return this.#active?'pending':this.#uncertain?'unverified':'verified';}
  async quiescence():Promise<CleanupReceipt>{while(this.#active)await this.#active;return Object.freeze({cleanup:this.#uncertain?'unverified':'verified'});}
  async read(accountAlias:string,signal?:AbortSignal):Promise<AccountObservation>{
    check(this.#binding.aliases.includes(accountAlias),'UNKNOWN_ACCOUNT_ALIAS');
    check(!this.#busy&&!this.#quarantined,'OBSERVER_BUSY_OR_QUARANTINED');check(!signal?.aborted,'CANCELLED');this.#busy=true;
    const pending=this.#read(signal).finally(()=>{this.#busy=false;this.#active=null;});
    this.#active=pending.then(()=>{},()=>{});
    return pending;
  }
  async #read(signal?:AbortSignal):Promise<AccountObservation>{
    const live=()=>check(!signal?.aborted,'CANCELLED');live();
    const started=Date.now();let work:Awaited<ReturnType<typeof workspace>>|undefined,workspaceAttempted=false;
    let attempted=false;let owned:OwnedGuardian|undefined,buffer='',rid=0;const decoder=new TextDecoder('utf-8',{fatal:true});
    const controller=new AbortController();const operationSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    let pending:{id:number;resolve:(v:unknown)=>void;reject:(e:unknown)=>void}|null=null;
    const reject=(code:string)=>{pending?.reject(new AdapterError(code));pending=null;controller.abort();};
    const onAbort=()=>reject('CANCELLED');signal?.addEventListener('abort',onAbort,{once:true});
    try {
      live();const env=await installationChecks(this.#install);live();workspaceAttempted=true;work=await workspace(this.#install.workRoot,{});this.#retained.add(work);live();
      attempted=true;owned=await startGuardian({executable:this.#install.nativePath,argv:[...CONTROLS,'app-server','--strict-config','--stdio'],cwd:work.cwd,env,
        seconds:30,stdoutBytes:LIMITS.observerBytes,stderrBytes:LIMITS.stderrBytes},operationSignal,(stream,data)=>{
          if(stream==='stderr')return;buffer+=decoder.decode(data,{stream:true});check(Buffer.byteLength(buffer)<=LIMITS.observerBytes,'OBSERVER_OUTPUT');
          for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);const msg=object(strictJson(line));
            if(pending&&msg.id===pending.id){const p=pending;pending=null;if(Object.hasOwn(msg,'error')||!Object.hasOwn(msg,'result'))p.reject(new AdapterError('OBSERVER_RPC_REJECTED'));else p.resolve(msg.result);}
            // Unsolicited private notifications are discarded in memory, never logged.
          }
        });
      this.#retained.add(owned);
      void owned.done.then(()=>reject('OBSERVER_ENDED'),()=>reject('OBSERVER_LOST'));
      live();
      const rpc=(method:string,params:unknown):Promise<unknown>=>{
        live();check(RPC_METHODS.includes(method)&&pending===null,'OBSERVER_METHOD');
        return new Promise((resolve,rejectPromise)=>{pending={id:++rid,resolve,reject:rejectPromise};owned!.write(JSON.stringify({id:rid,method,params})+'\n');});
      };
      const observation=await readAuthenticatedObservation(rpc,()=>{live();owned!.write(JSON.stringify({method:'initialized',params:{}})+'\n');},this.#binding,work.cwd,started,Date.now,this.#ceiling,this.#margin);
      live();await work.verify();live();return observation;
    }catch(error){if((attempted&&!owned)||(workspaceAttempted&&!work)){this.#quarantined=true;this.#uncertain=true;}throw sanitized(error);}
    finally{
      signal?.removeEventListener('abort',onAbort);
      try{if(owned)await owned.terminate();}catch(error){this.#quarantined=true;this.#uncertain=true;throw sanitized(error);}
      finally{try{if(work)await work.close();}catch(error){this.#quarantined=true;this.#uncertain=true;throw sanitized(error);}finally{if(!this.#uncertain)this.#retained.clear();}}
    }
  }
}
