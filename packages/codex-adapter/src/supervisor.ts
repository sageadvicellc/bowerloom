import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { StartupDeadline, verifyStartupHost, startupJobCopy, startupMessageDigest, type StartupAuthorization } from './startup-deadline.js';
import { AdapterError, check, object, sha } from './safe.js';
export interface GuardianJob { executable: string; argv: string[]; cwd: string; env: Record<string,string>; seconds: number; stdoutBytes: number; stderrBytes: number; startup?: Readonly<StartupAuthorization> }
export interface GuardianDone { code: number | null; reason: string | null; leaderReaped: boolean; groupGone:boolean; groupCheckStatus:string; sizes: { stdout: number; stderr: number } }
export interface OwnedGuardian {
  guardianPid:number;
  identity: {pid:number;groupId:number;ownershipDigest:string}; done: Promise<GuardianDone>;
  write(data:string):void; end():void; terminate():Promise<void>;
}
export async function startGuardian(job: GuardianJob, signal: AbortSignal, onChunk: (stream:'stdout'|'stderr',data:Buffer)=>void): Promise<OwnedGuardian> {
  check(!signal.aborted,'CANCELLED');
  check(process.permission === undefined,'HOST_PERMISSION_MODEL_UNSUPPORTED');
  const nonce=randomBytes(32).toString('hex');
  const startup=job.startup ? new StartupDeadline(job.startup) : undefined;
  const {startup:_,...jobFields}=job;
  const pinnedJob=startup ? startupJobCopy({...jobFields,nonce}) : {...jobFields,nonce};
  const active=()=>check(!signal.aborted,'CANCELLED');
  const bootSession=startup ? await verifyStartupHost(startup,active) : null;
  active(); startup?.check();
  let bindingDigest:string|null=null;
  // Guardian startup receives no job secrets or ambient environment. Its job arrives only over owned IPC.
  // The own undefined key blocks Node's implicit coverage propagation and is omitted from envPairs.
  const guardian=fork(new URL('./guardian.js',import.meta.url),[],{execPath:process.execPath,execArgv:[],env:{NODE_V8_COVERAGE:undefined},detached:true,stdio:['ignore','ignore','ignore','ipc']});
  let hardStop:NodeJS.Timeout|null=null;
  let started=false, settled=false, failure:string|null=null, doneMessage:GuardianDone|null=null;
  let cancelSent=false,channelFailed=false;
  let resolveStart:(v:OwnedGuardian['identity'])=>void,rejectStart:(e:unknown)=>void;
  const identity=new Promise<OwnedGuardian['identity']>((r,j)=>{resolveStart=r;rejectStart=j;});
  let resolveDone:(v:GuardianDone)=>void,rejectDone:(e:unknown)=>void;
  const done=new Promise<GuardianDone>((r,j)=>{resolveDone=r;rejectDone=j;});
  // A start error can precede the caller receiving the completion promise.
  void done.catch(()=>{});void identity.catch(()=>{});
  const controlFailure=()=>{
    if(settled||channelFailed)return;channelFailed=true;failure??='CONTROL_CHANNEL';
    // Never send again through failed IPC. Repeated send-error cancellation can starve close events.
    // SIGTERM targets our guardian, whose handler cleans its owned child group.
    try{guardian.kill('SIGTERM');}catch{/* The existing watchdog and completion checks remain authoritative. */}
  };
  const send=(v:unknown)=>{
    if(settled||channelFailed)return;
    if(!guardian.connected){controlFailure();return;}
    try{guardian.send(v as any,e=>{if(e)controlFailure();});}catch{controlFailure();}
  };
  const cancel=()=>{if(cancelSent||settled)return;cancelSent=true;send({type:'cancel'});};
  const fail=(code:string)=>{if(!settled){failure??=code;cancel();}};
  signal.addEventListener('abort',cancel,{once:true});
  const watchdog=setTimeout(()=>{fail('GUARDIAN_TIMEOUT');guardian.kill('SIGTERM');
    hardStop=setTimeout(()=>{if(!settled)guardian.kill('SIGKILL');},2000);},(job.seconds+3)*1000);
  guardian.on('error',()=>fail('GUARDIAN_SPAWN_FAILED'));
  guardian.on('message',value=>{
    try {
      const m=object(value);
      if(m.type==='started') {
        if(startup){if(cancelSent||signal.aborted||failure!==null){fail('CANCELLED');return;}startup.check();}
        check(startup ? m.bindingDigest===bindingDigest && Object.keys(m).sort().join()==='bindingDigest,guardianPid,nonce,pid,type' : m.bindingDigest===undefined,'GUARDIAN_BINDING');
        check(!started && m.nonce===nonce && Number.isSafeInteger(m.pid)&&m.pid>0 && m.guardianPid===guardian.pid,'GUARDIAN_IDENTITY');
        started=true;resolveStart!({pid:m.pid,groupId:m.pid,ownershipDigest:sha(`${nonce}:${m.pid}:${m.guardianPid}${bindingDigest?`:${bindingDigest}`:''}`)});
      } else if(m.type==='chunk') {
        check(started && (m.stream==='stdout'||m.stream==='stderr') && typeof m.data==='string','GUARDIAN_CHUNK');
        try {onChunk(m.stream,Buffer.from(m.data,'base64'));} catch {fail('OUTPUT_REJECTED');}
      } else if(m.type==='done') {
        check(!doneMessage,'GUARDIAN_DUPLICATE');
        check((m.code===null||Number.isSafeInteger(m.code))&&(m.reason===null||typeof m.reason==='string')
          && typeof m.leaderReaped==='boolean'&&typeof m.groupGone==='boolean'
          && ['ESRCH','EPERM','EINVAL','other','no-child','still-present'].includes(m.groupCheckStatus),'GUARDIAN_COMPLETION');
        doneMessage={code:m.code,reason:failure??m.reason,leaderReaped:m.leaderReaped,groupGone:m.groupGone,groupCheckStatus:m.groupCheckStatus,sizes:m.sizes};
      } else fail('GUARDIAN_PROTOCOL');
    } catch {fail('GUARDIAN_PROTOCOL');}
  });
  guardian.on('close',()=>{
    settled=true;clearTimeout(watchdog);if(hardStop)clearTimeout(hardStop);signal.removeEventListener('abort',cancel);
    const m=doneMessage;if(m&&failure)m.reason=failure;
    if(!started)rejectStart!(new AdapterError(failure??m?.reason??'GUARDIAN_NOT_STARTED'));
    if(m && m.leaderReaped)resolveDone!(m);else rejectDone!(new AdapterError(failure??m?.reason??'GUARDIAN_LOST'));
  });
  // Recheck after listeners are installed so cancellation cannot disappear between check and spawn.
  if(signal.aborted)cancel();else {
    try {
      if(startup){
        // This sample and its immutable transfer are adjacent to owned IPC: no await or host callback.
        startup.check(); const transfer=startup.transferSnapshot();
        bindingDigest=startupMessageDigest(pinnedJob,transfer,bootSession!);
        send({type:'start-v2',job:pinnedJob,startup:transfer,bootSession,bindingDigest});
      }else send({type:'start',job:pinnedJob});
    }
    catch { fail('STARTUP_EXPIRED'); }
  }
  const own=await identity;
  return {identity:own,guardianPid:guardian.pid!,done,write(data){check(!settled,'PROCESS_ENDED');send({type:'write',data});},end(){send({type:'end'});},
    async terminate(){cancel();const end=await done;check(end.leaderReaped&&end.groupGone,'REAP_UNVERIFIED');} };
}
