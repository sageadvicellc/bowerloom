import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm,stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
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
  const parent=spawn(process.execPath,[fileURLToPath(new URL('./orphan-fixture.js',import.meta.url)),cwd],{stdio:['ignore','ignore','pipe']});
  // Keep the fixture's stderr, bounded, so a fixture that crashes at start explains itself when the poll gives up.
  let stderr='';parent.stderr!.setEncoding('utf8').on('data',(chunk:string)=>{if(stderr.length<8192)stderr+=chunk;});
  let owned:{pid:number;guardianPid:number}|undefined;
  try{for(let i=0;i<100;i++){try{owned=JSON.parse(await readFile(join(cwd,'owned.json'),'utf8'));break;}catch{await delay(25);}}
    assert.ok(owned,`orphan-fixture wrote no owned.json; exit ${parent.exitCode} signal ${parent.signalCode}; stderr:\n${stderr}`);const exited=once(parent,'exit');parent.kill('SIGKILL');await exited;await gone(owned.pid);await gone(owned.guardianPid);
  }finally{if(parent.exitCode===null&&parent.signalCode===null){parent.kill('SIGTERM');await once(parent,'exit');}}
}));
test('leader completion kills its owned descendant while unrelated process survives',()=>fixture(async cwd=>{
  const code=`const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.stdout.write(String(c.pid));setTimeout(()=>process.exit(0),100);`;
  let pid='';const p=await startGuardian(job(cwd,code),new AbortController().signal,(_,b)=>pid+=b.toString());const done=await p.done;assert.equal(done.leaderReaped,true);assert.equal(done.groupGone,true,JSON.stringify(done));await gone(Number(pid));
}));


test('implicit parent coverage is suppressed for guardian and server without ambient job inheritance',()=>fixture(async cwd=>{
  const previous=process.env.NODE_V8_COVERAGE,ambient=process.env.GUARDIAN_PRIVATE_AMBIENT,coverage=join(cwd,'unexpected-coverage');
  process.env.NODE_V8_COVERAGE=coverage;process.env.GUARDIAN_PRIVATE_AMBIENT='PRIVATE_AMBIENT';
  try{
    let output='';const p=await startGuardian({...job(cwd,'process.stdout.write(JSON.stringify({coverage:process.env.NODE_V8_COVERAGE??null,ambient:process.env.GUARDIAN_PRIVATE_AMBIENT??null,secret:process.env.SYNTHETIC_SECRET}))'),env:{SYNTHETIC_SECRET:'explicit-synthetic'}},new AbortController().signal,(_,b)=>output+=b.toString());
    const done=await p.done;assert.equal(done.leaderReaped,true);assert.equal(done.groupGone,true);assert.deepEqual(JSON.parse(output),{coverage:null,ambient:null,secret:'explicit-synthetic'});await gone(p.guardianPid);await assert.rejects(stat(coverage),(error:NodeJS.ErrnoException)=>error.code==='ENOENT');
  }finally{if(previous===undefined)delete process.env.NODE_V8_COVERAGE;else process.env.NODE_V8_COVERAGE=previous;if(ambient===undefined)delete process.env.GUARDIAN_PRIVATE_AMBIENT;else process.env.GUARDIAN_PRIVATE_AMBIENT=ambient;}
}));
test('cancellation while guardian startup is pending still observes owned cleanup',()=>fixture(async cwd=>{
  const abort=new AbortController();const pending=startGuardian(job(cwd,'setInterval(()=>{},1000)'),abort.signal,()=>{});abort.abort();
  try{const owned=await pending;const result=await owned.done;assert.equal(result.leaderReaped,true);assert.equal(result.groupGone,true);await gone(owned.identity.pid);await gone(owned.guardianPid);}
  catch(error){assert.match(String(error),/CANCELLED|GUARDIAN_NOT_STARTED/);}
}));


test('failed IPC with stale connected state is never retried through recursive cancellation',async t=>{
  for(const failing of ['start','cancel'])for(const synchronous of [false,true]){
    const messages:string[]=[],signals:string[]=[];let fake:EventEmitter&{pid:number;connected:boolean;send:(message:any,callback:(error:Error|null)=>void)=>boolean;kill:(signal:string)=>boolean};
    t.mock.method(childProcess,'fork',()=>{
      fake=Object.assign(new EventEmitter(),{pid:99999999,connected:true,
        send(message:any,callback:(error:Error|null)=>void){
          messages.push(message.type);
          if(synchronous&&message.type===failing)throw new Error('PRIVATE_IPC_FAILURE');
          queueMicrotask(()=>{
            if(message.type===failing){callback(new Error('PRIVATE_IPC_FAILURE'));return;}
            if(message.type==='start')fake.emit('message',{type:'started',pid:99999998,guardianPid:fake.pid,nonce:message.job.nonce});
          });return true;
        },
        kill(signal:string){signals.push(signal);queueMicrotask(()=>fake.emit('close'));return true;}});
      return fake as any;
    });syncBuiltinESMExports();
    try{
      const pending=startGuardian(job('/synthetic-not-used',''),new AbortController().signal,()=>{});
      if(failing==='start')await assert.rejects(pending,/CONTROL_CHANNEL/);
      else{const owned=await pending;await assert.rejects(owned.terminate(),/CONTROL_CHANNEL/);}
      assert.deepEqual(messages,failing==='start'?['start']:['start','cancel']);assert.deepEqual(signals,['SIGTERM']);
    }finally{t.mock.restoreAll();syncBuiltinESMExports();}
  }
});

test('Claude queued write/end after cutoff forwards nothing before delayed timer callback',async()=>{
 // Isolated JS guardian, mocked child + host measurements; no native/model process or real signal.
 for(const kind of ['write','end'])for(const clockMode of ['wall','hr','backward']){
  const startupUrl=new URL('../src/startup-deadline.js',import.meta.url).href,guardianUrl=new URL('../src/guardian.js',import.meta.url).href;
  const code=`import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {registerHooks} from 'node:module';import {createHash} from 'node:crypto';
  const clock=await import(${JSON.stringify(startupUrl)});let wall=1000,hr=1000000n;Date.now=()=>wall;process.hrtime.bigint=()=>hr;
  let writes=0,ends=0,spawns=0,kills=0;const timers=[];globalThis.setTimeout=(fn,ms)=>{timers.push({fn,ms});return{unref(){}};};globalThis.clearTimeout=()=>{};process.kill=()=>{kills++;return true;};Object.defineProperty(process,'connected',{value:true,configurable:true});process.send=()=>true;
  const child=new EventEmitter();child.pid=99999997;child.stdin=Object.assign(new EventEmitter(),{write(){writes++;},end(){ends++;}});child.stdout=Object.assign(new EventEmitter(),{destroy(){}});child.stderr=Object.assign(new EventEmitter(),{destroy(){}});globalThis.__syntheticSpawn=()=>{spawns++;queueMicrotask(()=>child.emit('spawn'));return child;};
  const host='data:text/javascript,'+encodeURIComponent('export * from '+JSON.stringify(${JSON.stringify(startupUrl)})+';export async function verifyStartupHost(){return "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";}');
  const spawn='data:text/javascript,'+encodeURIComponent('export const spawn=(...args)=>globalThis.__syntheticSpawn(...args);');
  const hook=registerHooks({resolve(s,c,n){if(c.parentURL===${JSON.stringify(guardianUrl)}){if(s==='./startup-deadline.js')return{url:host,shortCircuit:true};if(s==='node:child_process')return{url:spawn,shortCircuit:true};}return n(s,c);}});
  const h='a'.repeat(64),runtime={executable:process.execPath,sha256:h,nodeVersion:'v24.11.0',uvVersion:'1.51.0',platform:'darwin',arch:'arm64'},route='claude:claude-sonnet-5-5:high';
  const startup={format:'bowerloom/claude-startup/v1',clock:clock.STARTUP_CLOCK,runtime,accountBindingDigest:h,promptDigest:createHash('sha256').update('synthetic').digest('hex'),modelRoute:route,proposalPlanRevision:h,launchPlanRevision:clock.claudeStartupLaunchRevision(h,runtime,route),admission:{format:'bowerloom/admission-dispatch/v1',binding:{installationId:'install',databaseName:'db',admissionSchema:'trellis_test',launcherId:'launcher',accountId:'account',accountAlias:'alias',requestDigest:'sha256:'+h,authorizationRevision:h,expiresAtMs:11000},reservationId:'reservation',requestDigest:'sha256:'+h,claimedAtMs:1000,parentWallMs:1000,parentHrNs:'1000000',notAfterWallMs:11000,notAfterHrNs:'10001000000'}};
  const job=clock.startupJobCopy({executable:'/synthetic/no-native',argv:[],cwd:'/synthetic',env:{},seconds:60,stdoutBytes:4096,stderrBytes:1024,nonce:h}),bootSession='AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA';
  await import(${JSON.stringify(guardianUrl)});hook.deregister();process.emit('message',{type:'start-v2',job,startup,bootSession,bindingDigest:clock.startupMessageDigest(job,startup,bootSession)});await new Promise(r=>setImmediate(r));assert.equal(spawns,1);
  if(${JSON.stringify(kind)}==='end'){process.emit('message',{type:'write',data:'synthetic'});assert.equal(writes,1);}
  ${clockMode==='wall'?'wall=7000;':clockMode==='hr'?'hr=6001000000n;':'wall=999;'}process.emit('message',${JSON.stringify(kind==='write'?{type:'write',data:'synthetic'}:{type:'end'})});await new Promise(r=>setImmediate(r));
  wall=1001;hr=1000001n;process.emit('message',${JSON.stringify(kind==='write'?{type:'write',data:'synthetic'}:{type:'end'})});
  assert.equal(writes,${kind==='write'?0:1});assert.equal(ends,0);assert.ok(kills>0);assert.ok(timers.length>0);process.stdout.write('queued-cutoff-refused');`;
  const child=spawn(process.execPath,['--input-type=module','--eval',code],{env:{PATH:'/usr/bin:/bin',NODE_V8_COVERAGE:undefined},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const timer=setTimeout(()=>child.kill('SIGKILL'),5000);const [exit,signal]=await once(child,'close');clearTimeout(timer);assert.equal(signal,null);assert.equal(exit,0,stderr);assert.equal(stdout,'queued-cutoff-refused');
 }
});
