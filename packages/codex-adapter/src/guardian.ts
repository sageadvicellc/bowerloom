// Internal trusted orphan guardian. Only its original control channel can create/cancel its one child.
// Never adopts a PID or accepts a second launch. No raw output is written to terminal/log files.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { check, object } from './safe.js';
interface Job { executable: string; argv: string[]; cwd: string; env: Record<string,string>; seconds: number; stdoutBytes: number; stderrBytes: number; nonce: string }
let child: ChildProcessWithoutNullStreams | null = null;
let hardKillSent=false,leaderExited=false;let cleanupBound:NodeJS.Timeout|null=null;
let started = false, finishing = false, reason: string | null = null, ended = false;
let timer: NodeJS.Timeout | null = setTimeout(() => stop('NO_START'), 5000), escalation: NodeJS.Timeout | null = null;
let totalInput = 0;
const sizes = { stdout: 0, stderr: 0 };
const send = (value: unknown) => { if (process.connected) process.send?.(value, error => { if (error) stop('CONTROLLER_LOST'); }); };
function kill(signal: NodeJS.Signals) {
  if (!child?.pid || (signal==='SIGKILL'&&hardKillSent)) return;
  if(signal==='SIGKILL')hardKillSent=true;
  try { process.kill(-child.pid,signal); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') reason = 'GROUP_KILL_FAILED'; }
}
function stop(code: string | null) {
  if (code && !reason) reason = code;
  if (finishing) return; finishing = true;
  if (timer) clearTimeout(timer);
  if (!child) { finish(null); return; }
  kill('SIGTERM');
  cleanupBound=setTimeout(()=>{reason='REAP_UNVERIFIED';child?.stdout.destroy();child?.stderr.destroy();finish(null);},1500);
  escalation = setTimeout(() => kill('SIGKILL'),200);
}
function finish(code: number | null) {
  if (ended) return; ended = true;
  if (timer) clearTimeout(timer); if (escalation) clearTimeout(escalation);if(cleanupBound)clearTimeout(cleanupBound);
  // The leader's close event means Node reaped it and both output pipes closed.
  // Confirm this created process group is gone; never discover/adopt another PID.
  kill('SIGKILL');const deadline=performance.now()+1000;
  const complete=(groupGone:boolean,groupCheckStatus:string)=>{
    if(!groupGone)reason='GROUP_CLEANUP_UNVERIFIED';
    const result={type:'done',code,reason,leaderReaped:leaderExited,groupGone,groupCheckStatus,sizes};
    if(process.connected)process.send?.(result,()=>{if(process.connected)process.disconnect();process.exit(0);});
    else process.exit(0);
  };
  const poll=()=>{
    if(!child?.pid){complete(true,'no-child');return;}
    try{process.kill(-child.pid,0);}
    catch(e){const code=(e as NodeJS.ErrnoException).code;if(code==='ESRCH'){complete(true,'ESRCH');return;}
      if(code==='EPERM'&&performance.now()<deadline){setTimeout(poll,25);return;}
      complete(false,['EPERM','EINVAL'].includes(code??'')?code!:'other');return;}
    if(performance.now()>=deadline){complete(false,'still-present');return;}setTimeout(poll,25);
  };
  poll();
}
process.on('disconnect', () => stop('CONTROLLER_LOST'));
process.on('SIGTERM', () => stop('GUARDIAN_TERMINATED'));
process.on('SIGINT', () => stop('GUARDIAN_TERMINATED'));
process.on('uncaughtException', () => stop('GUARDIAN_ERROR'));
process.on('unhandledRejection', () => stop('GUARDIAN_ERROR'));
process.on('message', value => {
  try {
    const msg = object(value);
    if (msg.type === 'cancel') { stop('CANCELLED'); return; }
    if (msg.type === 'write') {
      check(child && !finishing && typeof msg.data === 'string', 'INVALID_WRITE');
      totalInput += Buffer.byteLength(msg.data); check(totalInput <= 65536, 'INPUT_BOUND');
      child.stdin.write(msg.data, e => { if (e) stop('STDIN_FAILED'); }); return;
    }
    if (msg.type === 'end') { check(child && !finishing, 'INVALID_END'); child.stdin.end(); return; }
    check(msg.type === 'start' && !started && !finishing, 'INVALID_START'); started = true;
    const j = object(msg.job) as unknown as Job;
    check(typeof j.executable === 'string' && j.executable.startsWith('/') && Array.isArray(j.argv)
      && j.argv.length <= 256 && j.argv.every(s=>typeof s==='string' && s.length<=4096)
      && typeof j.cwd==='string' && j.cwd.startsWith('/') && /^[a-f0-9]{64}$/.test(j.nonce)
      && Number.isInteger(j.seconds) && j.seconds>0 && j.seconds<=60
      && Number.isInteger(j.stdoutBytes) && j.stdoutBytes>0 && j.stdoutBytes<=2097152
      && Number.isInteger(j.stderrBytes) && j.stderrBytes>0 && j.stderrBytes<=32768, 'INVALID_JOB');
    check(process.permission === undefined, 'HOST_PERMISSION_MODEL_UNSUPPORTED');
    check(Object.values(object(j.env)).every(v=>typeof v==='string'), 'INVALID_ENV');
    const env:NodeJS.ProcessEnv=Object.assign(Object.create(null),j.env);
    // Preserve explicit job settings while blocking implicit parent coverage inheritance.
    if(!Object.hasOwn(env,'NODE_V8_COVERAGE'))env.NODE_V8_COVERAGE=undefined;
    if(timer)clearTimeout(timer); timer=setTimeout(()=>stop('DEADLINE'),j.seconds*1000);
    child=spawn(j.executable,j.argv,{cwd:j.cwd,env,detached:true,stdio:['pipe','pipe','pipe']});
    child.on('error',()=>stop('SPAWN_FAILED'));
    child.stdin.on('error',()=>stop('STDIN_FAILED'));
    child.once('spawn',()=>send({type:'started',pid:child!.pid,guardianPid:process.pid,nonce:j.nonce}));
    for(const key of ['stdout','stderr'] as const) child[key].on('data',(data:Buffer)=>{
      sizes[key]+=data.length;
      if(sizes[key]>(key==='stdout'?j.stdoutBytes:j.stderrBytes)) {stop('OUTPUT_BOUND');return;}
      if(!finishing)send({type:'chunk',stream:key,data:data.toString('base64')});
    });
    child.on('exit',()=>{leaderExited=true;kill('SIGKILL');
      if(!cleanupBound)cleanupBound=setTimeout(()=>{reason??='OUTPUT_PIPES_NOT_CLOSED';child?.stdout.destroy();child?.stderr.destroy();finish(null);},1000);
    });
    child.on('close',code=>finish(code));
  } catch { stop('GUARDIAN_PROTOCOL'); }
});
