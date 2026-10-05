import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STARTUP_CLOCK, startupCopy, startupHr, StartupDeadline, assertStartupPreparation, startupJobCopy, startupMessageDigest, startupPacket, startupLaunchRevision, type StartupAuthorization } from '../src/startup-deadline.js';
import { readDarwinBootSession } from '../../mcp-connections/src/darwin-boot-session.js';
import { startGuardian } from '../src/supervisor.js';
import { MODEL_ROUTE } from '../src/policy.js';
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
function authorization(wall=1000,hr=1000000n):StartupAuthorization {
 const value:StartupAuthorization={format:'bowerloom/codex-startup/v1',clock:STARTUP_CLOCK,runtime:{executable:process.execPath,sha256:'a'.repeat(64),nodeVersion:'v24.11.0',uvVersion:'1.51.0',platform:'darwin',arch:'arm64'},
 accountBindingDigest:'b'.repeat(64),promptDigest:hash('synthetic prompt'),modelRoute:MODEL_ROUTE,proposalPlanRevision:'c'.repeat(64),launchPlanRevision:'c'.repeat(64),
 admission:{format:'bowerloom/admission-dispatch/v1',binding:{installationId:'install',databaseName:'db',admissionSchema:'trellis_test',launcherId:'launcher',accountId:'account',accountAlias:'alias',requestDigest:'sha256:'+'d'.repeat(64),authorizationRevision:'e'.repeat(64),expiresAtMs:wall+10000},reservationId:'reservation',requestDigest:'sha256:'+'d'.repeat(64),claimedAtMs:wall,parentWallMs:wall,parentHrNs:String(hr),notAfterWallMs:wall+10000,notAfterHrNs:String(hr+10000000000n)}};value.launchPlanRevision=startupLaunchRevision(value.proposalPlanRevision,value.runtime);return value;
}
test('startup protocol is exact inert immutable data; getters and malformed clocks refuse',()=>{
 const a=authorization(),copy=startupCopy(a);assert.ok(Object.isFrozen(copy)&&Object.isFrozen(copy.admission.binding));
 (a.admission.binding as any).launcherId='mutated';assert.equal(copy.admission.binding.launcherId,'launcher');
 for(const n of ['-1','01','1.0','18446744073709551616',1,null])assert.throws(()=>startupHr(n));
 assert.equal(startupHr('18446744073709551615'),(1n<<64n)-1n);
 for(const patch of [{extra:true},{clock:'portable'},{modelRoute:'codex:unapproved:high'},{runtime:{...copy.runtime,nodeVersion:'v24.12.0'}},{admission:{...copy.admission,parentHrNs:copy.admission.notAfterHrNs}},{admission:{...copy.admission,notAfterWallMs:copy.admission.binding.expiresAtMs+1}}])assert.throws(()=>startupCopy({...copy,...patch}));
 let getter=0;const hostile=Object.defineProperty({...copy},'runtime',{enumerable:true,get(){getter++;return copy.runtime;}});assert.throws(()=>startupCopy(hostile));assert.equal(getter,0);
});
test('preparation pins launcher, account, prompt, route and launch-plan revision',()=>{
 const a=authorization();const p={launcherId:'launcher',accountBindingDigest:a.accountBindingDigest,promptDigest:a.promptDigest,modelRoute:a.modelRoute,launchPlanRevision:a.proposalPlanRevision};
 assertStartupPreparation(a,p);for(const key of Object.keys(p))assert.throws(()=>assertStartupPreparation(a,{...p,[key]:'changed'}));
});
test('original deadline survives delay and sleep advancement; reversal and closure never rearm',()=>{
 for(const sample of [[999999n,1000],[1000000n,999],[10001000000n,1000],[1000000n,11000],[1n<<64n,1000]] as const){const d=new StartupDeadline(authorization());assert.throws(()=>d.checkSample(sample[0],sample[1]));assert.throws(()=>d.checkSample(1000001n,1001));}
 const d=new StartupDeadline(authorization());d.checkSample(1000001n,1001);d.checkSample(9000000000n,1002);assert.throws(()=>d.checkSample(10001000000n,1003));
 const closed=new StartupDeadline(authorization());closed.close();assert.throws(()=>closed.checkSample(1000001n,1001));
});
test('complete job, original nonce and kernel boot are covered by start packet digest',()=>{
 const startup=authorization(),bootSession='AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA';
 const job=startupJobCopy({executable:'/bin/false',argv:[],cwd:'/tmp',env:{},seconds:1,stdoutBytes:100,stderrBytes:100,nonce:'f'.repeat(64)});
 const packet={type:'start-v2',job,startup,bootSession,bindingDigest:startupMessageDigest(job,startup,bootSession)};startupPacket(packet);
 for(const patch of [{extra:true},{type:'start'},{bootSession:bootSession.toLowerCase()},{job:{...job,nonce:'0'.repeat(64)}},{job:{...job,argv:['changed']}},{startup:{...startup,promptDigest:'0'.repeat(64)}},{bindingDigest:'0'.repeat(64)}])assert.throws(()=>startupPacket({...packet,...patch}));
});
async function fixture<T>(run:(cwd:string)=>Promise<T>){const cwd=await mkdtemp(join(await realpath(tmpdir()),'bowerloom-startup-fixture-'));try{return await run(cwd);}finally{await rm(cwd,{recursive:true,force:true});}}
async function actualAuthorization(){const hr=process.hrtime.bigint(),wall=Date.now();const a=authorization(wall,hr);a.runtime.sha256=hash(await readFile(process.execPath));a.launchPlanRevision=startupLaunchRevision(a.proposalPlanRevision,a.runtime);return a;}
const job=(cwd:string,code:string)=>({executable:process.execPath,argv:['-e',code],cwd,env:{PATH:'/usr/bin:/bin'},seconds:2,stdoutBytes:4096,stderrBytes:1024});
async function direct(cwd:string,change:(packet:any)=>void,duplicate=false){
 const a=await actualAuthorization(),bootSession=await readDarwinBootSession();
 const j=startupJobCopy({...job(cwd,'process.stdout.write("FIXTURE_STARTED");setTimeout(()=>{},20)'),nonce:randomBytes(32).toString('hex')});
 const packet:any={type:'start-v2',job:j,startup:a,bootSession,bindingDigest:startupMessageDigest(j,a,bootSession)};change(packet);
 const child=fork(new URL('../src/guardian.js',import.meta.url),[],{execArgv:[],env:{NODE_V8_COVERAGE:undefined},stdio:['ignore','ignore','ignore','ipc']});
 const messages:any[]=[];child.on('message',m=>messages.push(m));const closed=once(child,'close');child.send(packet);if(duplicate)child.send(packet);
 await closed;return messages;
}
test('real private guardian accepts one correctly bound synthetic Node fixture and verifies its acknowledgment',()=>fixture(async cwd=>{
 const startup=await actualAuthorization();let output='';const p=await startGuardian({...job(cwd,'process.stdin.on("data",d=>process.stdout.write(d));process.stdin.on("end",()=>process.exit(0));'),startup},new AbortController().signal,(_,b)=>output+=b.toString());
 p.write('synthetic prompt');p.end();const done=await p.done;assert.equal(done.code,0);assert.equal(done.reason,null);assert.equal(done.leaderReaped,true);assert.equal(done.groupGone,true);assert.equal(output,'synthetic prompt');
}));
test('real guardian refuses expired, future-parent, wrong runtime/boot, tampered and duplicate startup before fixture spawn',()=>fixture(async cwd=>{
 const changes=[
  (p:any)=>{p.startup.admission.parentWallMs-=20000;p.startup.admission.claimedAtMs-=20000;p.startup.admission.notAfterWallMs-=20000;},
  (p:any)=>{p.startup.admission.parentHrNs=String(process.hrtime.bigint()+5000000000n);},
  (p:any)=>{p.startup.runtime.sha256='0'.repeat(64);p.startup.launchPlanRevision=startupLaunchRevision(p.startup.proposalPlanRevision,p.startup.runtime);},
  (p:any)=>{p.bootSession='AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA';},
  (p:any)=>{p.bindingDigest='0'.repeat(64);},
 ];
 for(let i=0;i<changes.length;i++){
  const messages=await direct(cwd,p=>{changes[i]!(p);if(i<4)p.bindingDigest=startupMessageDigest(p.job,p.startup,p.bootSession);});
  assert.equal(messages.some(m=>m.type==='started'),false,`case ${i}`);assert.ok(messages.some(m=>m.type==='done'&&m.groupCheckStatus==='no-child'));
 }
 const messages=await direct(cwd,()=>{},true);assert.equal(messages.some(m=>m.type==='started'),false);assert.ok(messages.some(m=>m.type==='done'&&m.groupCheckStatus==='no-child'));
}));
test('controlled guardian rejects changed prompt and still reaps only its owned child',()=>fixture(async cwd=>{
 const startup=await actualAuthorization();const p=await startGuardian({...job(cwd,'setInterval(()=>{},1000)'),startup},new AbortController().signal,()=>{});
 p.write('different prompt');const done=await p.done;assert.equal(done.reason,'GUARDIAN_PROTOCOL');assert.equal(done.leaderReaped,true);assert.equal(done.groupGone,true);
}));


test('supervisor refuses a missing or mismatched controlled started acknowledgment and cleans its guardian',async t=>{
 for(const digest of [undefined,'0'.repeat(64),'late']){
  const signals:string[]=[];let fake:any;
  t.mock.method(childProcess,'fork',()=>{
   fake=Object.assign(new EventEmitter(),{pid:99999999,connected:true,send(message:any,callback:(error:Error|null)=>void){
    queueMicrotask(()=>{callback(null);if(message.type==='start-v2'){if(digest==='late')t.mock.method(Date,'now',()=>message.startup.admission.notAfterWallMs);fake.emit('message',{type:'started',pid:99999998,guardianPid:fake.pid,nonce:message.job.nonce,...(digest?{bindingDigest:digest==='late'?message.bindingDigest:digest}:{})});}
     if(message.type==='cancel'){fake.emit('message',{type:'done',code:null,reason:'CANCELLED',leaderReaped:true,groupGone:true,groupCheckStatus:'no-child',sizes:{stdout:0,stderr:0}});fake.emit('close');}});return true;
   },kill(s:string){signals.push(s);return true;}});return fake;
  });syncBuiltinESMExports();
  try{await assert.rejects(startGuardian({...job('/tmp',''),startup:await actualAuthorization()},new AbortController().signal,()=>{}),/GUARDIAN_PROTOCOL/);assert.deepEqual(signals,[]);}
  finally{t.mock.restoreAll();syncBuiltinESMExports();}
 }
});


test('final transfer carries latest parent samples without renewing deadlines or mutating the consumed claim',()=>{
 const original=authorization(1000,1000000n),parent=new StartupDeadline(original);
 parent.checkSample(2000000n,2000);const transfer=parent.transferSnapshot();
 assert.equal(transfer.admission.parentWallMs,2000);assert.equal(transfer.admission.parentHrNs,'2000000');
 assert.equal(original.admission.parentWallMs,1000);assert.equal(original.admission.parentHrNs,'1000000');
 assert.deepEqual({...transfer.admission,parentWallMs:1000,parentHrNs:'1000000'},{...startupCopy(original).admission});
 assert.equal(transfer.launchPlanRevision,original.launchPlanRevision);assert.deepEqual(transfer.runtime,startupCopy(original).runtime);
 assert.ok(Object.isFrozen(transfer)&&Object.isFrozen(transfer.admission));
 for(const sample of [[2500000n,1500],[1500000n,2500]] as const){
  const child=new StartupDeadline(transfer);assert.throws(()=>child.checkSample(sample[0],sample[1]),/STARTUP_EXPIRED/);
  assert.throws(()=>child.transferSnapshot(),/STARTUP_EXPIRED/);
  assert.throws(()=>child.checkSample(3000000n,3000),/STARTUP_EXPIRED/);
 }
 parent.checkSample(3000000n,3000);const later=parent.transferSnapshot();
 assert.equal(later.admission.notAfterWallMs,original.admission.notAfterWallMs);assert.equal(later.admission.notAfterHrNs,original.admission.notAfterHrNs);
 const job=startupJobCopy({executable:'/bin/false',argv:[],cwd:'/tmp',env:{},seconds:1,stdoutBytes:100,stderrBytes:100,nonce:'f'.repeat(64)});
 const bootSession='AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',oldDigest=startupMessageDigest(job,original,bootSession),bindingDigest=startupMessageDigest(job,transfer,bootSession);
 assert.notEqual(bindingDigest,oldDigest);
 assert.throws(()=>startupPacket({type:'start-v2',job,startup:transfer,bootSession,bindingDigest:oldDigest}));
 startupPacket({type:'start-v2',job,startup:transfer,bootSession,bindingDigest});
 parent.close();assert.throws(()=>parent.transferSnapshot());
});
test('supervisor sends final post-fork parent sample and binds that exact transferred snapshot',async t=>{
 const original=await actualAuthorization(),wall=Date.now()+1000;let fake:any,captured:any;
 t.mock.method(childProcess,'fork',()=>{
  t.mock.method(Date,'now',()=>wall);
  fake=Object.assign(new EventEmitter(),{pid:99999999,connected:true,send(message:any,callback:(error:Error|null)=>void){
   queueMicrotask(()=>{callback(null);if(message.type==='start-v2'){captured=message;fake.emit('message',{type:'started',pid:99999998,guardianPid:fake.pid,nonce:message.job.nonce,bindingDigest:message.bindingDigest});}
    if(message.type==='cancel'){fake.emit('message',{type:'done',code:null,reason:'CANCELLED',leaderReaped:true,groupGone:true,groupCheckStatus:'no-child',sizes:{stdout:0,stderr:0}});fake.emit('close');}});return true;
  },kill(){return true;}});return fake;
 });syncBuiltinESMExports();
 try{
  const owned=await startGuardian({...job('/tmp',''),startup:original},new AbortController().signal,()=>{});
  assert.equal(captured.startup.admission.parentWallMs,wall);assert.ok(startupHr(captured.startup.admission.parentHrNs)>=startupHr(original.admission.parentHrNs));
  assert.equal(captured.startup.admission.notAfterWallMs,original.admission.notAfterWallMs);assert.equal(captured.startup.admission.notAfterHrNs,original.admission.notAfterHrNs);
  assert.notEqual(original.admission.parentWallMs,wall);assert.equal(captured.bindingDigest,startupMessageDigest(captured.job,captured.startup,captured.bootSession));
  assert.equal(owned.identity.ownershipDigest,hash(`${captured.job.nonce}:${owned.identity.pid}:${owned.guardianPid}:${captured.bindingDigest}`));
  await owned.terminate();
 }finally{t.mock.restoreAll();syncBuiltinESMExports();}
});
