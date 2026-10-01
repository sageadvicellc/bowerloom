import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { startGuardian } from '../src/supervisor.js';
function alive(pid:number){try{process.kill(pid,0);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')return false;throw e;}}
async function gone(pid:number){for(let i=0;i<80&&alive(pid);i++)await delay(25);assert.equal(alive(pid),false);}
async function fixture<T>(run:(cwd:string)=>Promise<T>){const cwd=await mkdtemp(join(tmpdir(),'trellis-guardian-test-'));try{return await run(cwd);}finally{await rm(cwd,{recursive:true,force:true});}}
const job=(cwd:string,code:string)=>({executable:process.execPath,argv:['-e',code],cwd,env:{PATH:'/usr/bin:/bin'},seconds:2,stdoutBytes:4096,stderrBytes:1024});
test('owned child completes and leader is reaped before result',()=>fixture(async cwd=>{let text='';const p=await startGuardian(job(cwd,'process.stdout.write("synthetic")'),new AbortController().signal,(_,b)=>text+=b.toString());const done=await p.done;assert.equal(done.code,0);assert.equal(done.reason,null);assert.equal(done.leaderReaped,true);assert.equal(done.groupGone,true,JSON.stringify(done));assert.equal(text,'synthetic');await gone(p.identity.pid);await gone(p.guardianPid);assert.match(p.identity.ownershipDigest,/^[a-f0-9]{64}$/);}));
test('explicit cancellation and AbortSignal terminate only owned group',()=>fixture(async cwd=>{
  const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  try{for(const bySignal of [true,false]){const c=new AbortController();const p=await startGuardian(job(cwd,'setInterval(()=>{},1000)'),c.signal,()=>{});if(bySignal)c.abort();else await p.terminate();const d=await p.done;assert.equal(d.reason,'CANCELLED');assert.equal(d.leaderReaped,true);assert.equal(d.groupGone,true);await gone(p.identity.pid);assert.equal(alive(unrelated.pid!),true);}}
  finally{unrelated.kill('SIGTERM');await once(unrelated,'exit');}
}));
test('deadline, stdout, stderr overflow and parser refusal reap',()=>fixture(async cwd=>{
  const cases=[['setInterval(()=>{},1000)','DEADLINE'],['process.stdout.write("x".repeat(9000));setInterval(()=>{},1000)','OUTPUT_BOUND'],['process.stderr.write("x".repeat(9000));setInterval(()=>{},1000)','OUTPUT_BOUND'],['process.stdout.write("synthetic");setInterval(()=>{},1000)','OUTPUT_REJECTED']];
  for(const [code,reason] of cases){const p=await startGuardian({...job(cwd,code!),seconds:1},new AbortController().signal,()=>{if(reason==='OUTPUT_REJECTED')throw new Error('PRIVATE');});const d=await p.done;assert.equal(d.reason,reason);assert.equal(d.leaderReaped,true);assert.equal(d.groupGone,true);await gone(p.identity.pid);}
}));
test('spawn failure and pre-abort launch no adopted process',()=>fixture(async cwd=>{
  const aborted=new AbortController();aborted.abort();await assert.rejects(startGuardian(job(cwd,'process.exit(0)'),aborted.signal,()=>{}),/CANCELLED/);
  await assert.rejects(startGuardian({...job(cwd,''),executable:join(cwd,'does-not-exist')},new AbortController().signal,()=>{}),/SPAWN_FAILED/);
}));
test('controller SIGKILL closes original channel; guardian kills child and exits',()=>fixture(async cwd=>{
  const parent=spawn(process.execPath,[new URL('./orphan-fixture.js',import.meta.url).pathname,cwd],{stdio:'ignore'});
  let owned:{pid:number;guardianPid:number}|undefined;
  try{for(let i=0;i<100;i++){try{owned=JSON.parse(await readFile(join(cwd,'owned.json'),'utf8'));break;}catch{await delay(25);}}
    assert.ok(owned);const exited=once(parent,'exit');parent.kill('SIGKILL');await exited;await gone(owned.pid);await gone(owned.guardianPid);
  }finally{if(parent.exitCode===null&&parent.signalCode===null){parent.kill('SIGTERM');await once(parent,'exit');}}
}));
test('leader completion kills its owned descendant while unrelated process survives',()=>fixture(async cwd=>{
  const code=`const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.stdout.write(String(c.pid));setTimeout(()=>process.exit(0),100);`;
  let pid='';const p=await startGuardian(job(cwd,code),new AbortController().signal,(_,b)=>pid+=b.toString());const done=await p.done;assert.equal(done.leaderReaped,true);assert.equal(done.groupGone,true,JSON.stringify(done));await gone(Number(pid));
}));
