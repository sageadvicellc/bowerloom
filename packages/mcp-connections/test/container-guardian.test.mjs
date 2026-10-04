import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, writeFile, readFile, rm, chmod, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planMcpContainerDiscoveryLaunch } from '../../../dist/packages/mcp-connections/src/index.js';
const hash=v=>'sha256:'+createHash('sha256').update(v).digest('hex');
const DIGEST='sha256:'+'a'.repeat(64), MANIFEST='application/vnd.oci.image.manifest.v1+json';
function fixture({config,manifest,index}={}){
 const cfg={architecture:'arm64',os:'linux',variant:'v8',config:{Env:['PATH=/usr/local/bin:/usr/bin:/bin','NODE_VERSION=24.21.0'],Entrypoint:['inherited-entrypoint'],Cmd:['inherited-command']},rootfs:{type:'layers',diff_ids:[DIGEST]}};config?.(cfg);
 const imageConfigJson=JSON.stringify(cfg),man={schemaVersion:2,mediaType:MANIFEST,config:{mediaType:'application/vnd.oci.image.config.v1+json',digest:hash(imageConfigJson),size:Buffer.byteLength(imageConfigJson)},layers:[{mediaType:'application/vnd.oci.image.layer.v1.tar+gzip',digest:DIGEST,size:1000}]};manifest?.(man);
 const imageManifestJson=JSON.stringify(man),idx={schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests:[{mediaType:MANIFEST,digest:hash(imageManifestJson),size:Buffer.byteLength(imageManifestJson),platform:{architecture:'arm64',os:'linux',variant:'v8'}}]};index?.(idx);
 const imageIndexJson=JSON.stringify(idx);
 return {synthetic:true,imageIndexJson,imageManifestJson,imageConfigJson,spec:{format:'bowerloom/mcp-container-launch/v1beta1',operationKey:DIGEST,imageIndexDigest:hash(imageIndexJson),imageManifestDigest:hash(imageManifestJson),imageConfigDigest:hash(imageConfigJson),platform:'linux/arm64',entrypoint:'/usr/local/bin/node',args:['--input-type=module','-e','console.log("synthetic")'],workingDirectory:'/tmp',user:{uid:10001,gid:10001},imageEnvironment:cfg.config.Env??[],limits:{cpuMillis:250,memoryBytes:134217728,pids:32,scratchBytes:8388608,shmBytes:1048576}}};
}
const guardianUrl=new URL('../../../dist/packages/mcp-connections/src/container-guardian.js',import.meta.url).href;
async function run(t,mode,prepare){
 const directory=await mkdtemp(join(await realpath(tmpdir()),'bowerloom-guardian-unit-'));await chmod(directory,0o700);t.after(()=>rm(directory,{recursive:true,force:true}));
 const log=join(directory,'calls.json'),script=join(directory,'mock.mjs'),stateRoot=join(directory,'state');await mkdir(stateRoot,{mode:0o700});
 const launch=fixture(),plan=planMcpContainerDiscoveryLaunch(launch),job={stateRoot,operationKey:'sha256:'+'b'.repeat(64),launch,launchRevision:plan.revision,deadlineMs:Date.now()+5000};
 const journalPath=join(stateRoot,job.operationKey.slice(7),'journal.json');await prepare?.({stateRoot,journalPath,job});
 await writeFile(script,`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';import {writeFileSync,unlinkSync,symlinkSync} from 'node:fs';import {join} from 'node:path';const mode=${JSON.stringify(mode)},log=${JSON.stringify(log)},calls=[];let job;process.on('message',m=>{if(m.type==='start')job=m.job;if(m.type==='write'&&mode==='deadline')Date.now=()=>job.deadlineMs+1;});cp.spawn=(exe,argv,options)=>{if(exe!=='/usr/local/bin/docker'||argv[0]!=='--context'||argv[1]!=='desktop-linux')throw Error('unexpected command');if(Object.keys(options.env).some(k=>!['HOME','PATH','NODE_V8_COVERAGE'].includes(k)))throw Error('ambient environment');calls.push(argv);writeFileSync(log,JSON.stringify(calls));const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>true;if(mode==='deadline'&&argv[3]==='start'){c.pid=99123;c.stdin=new PassThrough();c.stdin.on('data',()=>{calls.push(['FORBIDDEN_FORWARD']);writeFileSync(log,JSON.stringify(calls));});c.kill=()=>{queueMicrotask(()=>c.emit('close',0));return true;};return c;}queueMicrotask(()=>{let out='',code=0;const a=argv.slice(2);if(a[1]==='ls'&&mode==='collision')out='c'.repeat(64)+'\\n';if(a[1]==='create'){if(mode==='unknown')code=1;else{out='c'.repeat(64)+'\\n';if(mode==='corrupt')writeFileSync(join(job.stateRoot,job.operationKey.slice(7),'journal.json'),'PRIVATE_CORRUPT');if(mode==='symlink'){const path=join(job.stateRoot,job.operationKey.slice(7),'journal.json'),target=join(job.stateRoot,'external');writeFileSync(target,'PRIVATE_EXTERNAL');unlinkSync(path);symlinkSync(target,path);}}}if(a[1]==='inspect'){if(mode!=='deadline')out=JSON.stringify([{Id:'d'.repeat(64),Name:'/wrong',Config:{},HostConfig:{},State:{Running:false}}]);else{const s=job.launch.spec,l=s.limits;out=JSON.stringify([{Id:'c'.repeat(64),Name:'/bowerloom-mcp-'+s.operationKey.slice(7),Config:{Image:s.imageIndexDigest,Labels:{'ai.bowerloom.mcp.operation':s.operationKey},User:s.user.uid+':'+s.user.gid,WorkingDir:s.workingDirectory,Entrypoint:[s.entrypoint],Cmd:s.args,Env:s.imageEnvironment,OpenStdin:true,Tty:false},HostConfig:{NetworkMode:'none',IpcMode:'private',PidMode:'',UTSMode:'',CgroupnsMode:'private',ReadonlyRootfs:true,Privileged:false,Init:true,CapDrop:['ALL'],SecurityOpt:['no-new-privileges=true','seccomp=builtin'],Memory:l.memoryBytes,MemorySwap:l.memoryBytes,NanoCpus:l.cpuMillis*1000000,PidsLimit:l.pids,ShmSize:l.shmBytes,RestartPolicy:{Name:'no'},LogConfig:{Type:'none'},PublishAllPorts:false,Tmpfs:{'/scratch':'rw,noexec,nosuid,nodev,size='+l.scratchBytes+',mode=0700,uid='+s.user.uid+',gid='+s.user.gid},Ulimits:[{Name:'core',Hard:0,Soft:0},{Name:'nofile',Hard:64,Soft:64}]},State:{Running:false}}]);}}c.stdout.end(out);c.stderr.end('PRIVATE_DOCKER_DIAGNOSTIC');c.emit('close',code);});return c;};syncBuiltinESMExports();await import(${JSON.stringify(guardianUrl)});`,{mode:0o600});
 const child=fork(script,[],{execArgv:[],env:{NODE_V8_COVERAGE:undefined},stdio:['ignore','ignore','ignore','ipc']});let done,started=false;const timer=setTimeout(()=>child.kill('SIGKILL'),8000);t.after(()=>clearTimeout(timer));
 child.on('message',m=>{if(m.type==='done')done=m;if(m.type==='started'){started=true;if(mode==='deadline')child.send({type:'write',data:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'bowerloom-discovery',version:'0.7.0-beta.0'}}})+'\n'});}});
 const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});child.send({type:'start',nonce:'f'.repeat(64),job});const status=await exit;clearTimeout(timer);assert.equal(status.code,0);assert.equal(started,mode==='deadline');assert.ok(done);assert.equal(JSON.stringify(done).includes('PRIVATE'),false);
 let calls=[];try{calls=JSON.parse(await readFile(log,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 return{done,calls,journalPath,job};
}
test('unknown create result stays uncertain and never discovers or removes a container by name',async t=>{
 const r=await run(t,'unknown');assert.equal(r.done.stage,'UNCERTAIN');assert.equal(r.done.noContainerCreated,false);assert.equal(r.done.containerAbsent,false);assert.equal(r.done.attachReaped,true);
 const methods=r.calls.map(x=>x[3]);assert.deepEqual(methods,['ls','create']);const j=JSON.parse(await readFile(r.journalPath,'utf8'));assert.equal(j.cid,null);assert.equal(j.stage,'UNCERTAIN');
});
test('corrupt persisted journal prevents rewriting ownership and prevents cleanup by guessed identity',async t=>{
 const r=await run(t,'corrupt');assert.equal(r.done.stage,'UNCERTAIN');assert.equal(await readFile(r.journalPath,'utf8'),'PRIVATE_CORRUPT');assert.deepEqual(r.calls.map(x=>x[3]),['ls','create']);
});
test('mismatched inspected container identity never starts or removes that container',async t=>{
 const r=await run(t,'mismatch');assert.equal(r.done.stage,'UNCERTAIN');assert.equal(r.done.containerAbsent,false);assert.deepEqual(r.calls.map(x=>x[3]),['ls','create','inspect','inspect']);const j=JSON.parse(await readFile(r.journalPath,'utf8'));assert.equal(j.cid,'c'.repeat(64));assert.equal(j.stage,'UNCERTAIN');
});
test('existing name collision is never adopted or removed, even when public labels can match',async t=>{
 const r=await run(t,'collision');assert.equal(r.done.stage,'CANCELLED');assert.equal(r.done.noContainerCreated,true);assert.deepEqual(r.calls.map(x=>x[3]),['ls']);
});
test('existing operation directory never resumes or retries creation',async t=>{
 const r=await run(t,'unknown',async({journalPath})=>{await mkdir(join(journalPath,'..'),{mode:0o700});await writeFile(journalPath,'PRIVATE_EXISTING',{mode:0o600});});assert.equal(r.done.noContainerCreated,true);assert.deepEqual(r.calls,[]);assert.equal(await readFile(r.journalPath,'utf8'),'PRIVATE_EXISTING');
});

test('journal replaced by symlink is refused without touching its target',async t=>{
 const r=await run(t,'symlink');assert.equal(r.done.stage,'UNCERTAIN');assert.deepEqual(r.calls.map(x=>x[3]),['ls','create']);assert.equal(await readFile(join(r.job.stateRoot,'external'),'utf8'),'PRIVATE_EXTERNAL');
});

test('IPC forwarding checks absolute deadline even before the scheduled timer runs',async t=>{
 const r=await run(t,'deadline');assert.equal(r.done.stage,'REAPED');assert.equal(r.done.reason,'GUARDIAN_PROTOCOL');assert.equal(r.done.containerAbsent,true);assert.equal(r.done.attachReaped,true);assert.equal(r.calls.some(x=>x[0]==='FORBIDDEN_FORWARD'),false);assert.deepEqual(r.calls.map(x=>x[3]),['ls','create','inspect','start','inspect','inspect','rm','ls']);
});
