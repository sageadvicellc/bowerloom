import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {planMcpContainerLaunch} from '../../../dist/packages/mcp-connections/src/index.js';

const enabled=process.env.BOWERLOOM_MCP_CONTAINER_PROOF==='synthetic-desktop-linux';
const digest=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// This opt-in qualification owns only containers that it creates. It is not a production transport.
test('cached immutable image policy restricts actual synthetic Linux containers',{skip:!enabled,timeout:90000},async t=>{
 const directory=resolve(process.env.BOWERLOOM_MCP_CONTAINER_EVIDENCE);
 const blobs=Object.fromEntries(['Index','Manifest','Config'].map(k=>[`image${k}Json`,readFileSync(join(directory,`image-${k.toLowerCase()}.json`),'utf8')]));
 const image=JSON.parse(blobs.imageConfigJson);
 const hostDirectory=realpathSync(mkdtempSync(join(tmpdir(),'bowerloom-container-canary-')));
 const canary=join(hostDirectory,'canary.txt');writeFileSync(canary,'synthetic-host-canary',{mode:0o600});
 const records=[],owned=new Map();
 const env={HOME:process.env.HOME,PATH:'/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'};
 async function docker(args,timeout=10000){
  return new Promise((resolve,reject)=>{
   const child=spawn('/usr/local/bin/docker',['--context','desktop-linux',...args],{env,stdio:['ignore','pipe','pipe']});
   let out='',err='',failure;const timer=setTimeout(()=>{failure=new Error('TEST_DOCKER_TIMEOUT');child.kill('SIGKILL');},timeout);
   for(const [stream,name] of [[child.stdout,'out'],[child.stderr,'err']])stream.on('data',b=>{
    if(name==='out')out+=b;else err+=b;
    if(Buffer.byteLength(out)+Buffer.byteLength(err)>65536){failure=new Error('TEST_DOCKER_OUTPUT_BOUND');child.kill('SIGKILL');}
   });
   child.on('error',e=>{failure=e;});child.on('close',code=>{clearTimeout(timer);failure?reject(failure):resolve({code,out,err});});
  });
 }
 async function inspect(cid){const r=await docker(['container','inspect',cid]);assert.equal(r.code,0,r.err);return JSON.parse(r.out)[0];}
 async function remove(cid){
  const record=owned.get(cid);assert.ok(record,'No unowned container removal');
  const current=await inspect(cid);assert.equal(current.Id,cid);assert.equal(current.Name,'/'+record.name);
  assert.equal(current.Config.Image,record.plan.spec.imageIndexDigest);assert.deepEqual(current.Config.Labels,record.labels);
  const removed=await docker(['container','rm','--force',cid]);assert.equal(removed.code,0,removed.err);
  const absent=await docker(['container','inspect',cid]);assert.notEqual(absent.code,0);assert.match(absent.err,/No such (object|container)/);
  record.removed=true;owned.delete(cid);
 }
 async function create(name,source){
  const operationKey=digest(name+randomBytes(16).toString('hex'));
  const spec={format:'bowerloom/mcp-container-launch/v1beta1',operationKey,
   imageIndexDigest:digest(blobs.imageIndexJson),imageManifestDigest:digest(blobs.imageManifestJson),imageConfigDigest:digest(blobs.imageConfigJson),
   platform:`linux/${image.architecture}`,entrypoint:'/usr/local/bin/node',args:['--input-type=module','-e',source.replaceAll('\n',' ')],workingDirectory:'/',
   user:{uid:10001,gid:10001},imageEnvironment:image.config.Env,
   limits:{cpuMillis:250,memoryBytes:134217728,pids:32,scratchBytes:8388608,shmBytes:1048576}};
  const plan=planMcpContainerLaunch({spec,...blobs,synthetic:true});
  const record={case:name,plan,removed:false};records.push(record);
  const nameIndex=plan.argv.indexOf('--name');assert.ok(nameIndex>=0);record.name=plan.argv[nameIndex+1];
  const created=await docker(plan.argv);assert.equal(created.code,0,created.err);
  const cid=created.out.trim();assert.match(cid,/^[a-f0-9]{64}$/);record.cid=cid;
  record.labels=Object.fromEntries(plan.argv.flatMap((arg,i)=>arg==='--label'?[plan.argv[i+1].split(/=(.*)/s).slice(0,2)]:[]));
  owned.set(cid,record);
  const current=await inspect(cid);record.hostConfig={network:current.HostConfig.NetworkMode,memory:current.HostConfig.Memory,
   memorySwap:current.HostConfig.MemorySwap,nanoCpus:current.HostConfig.NanoCpus,pids:current.HostConfig.PidsLimit,
   readonly:current.HostConfig.ReadonlyRootfs,privileged:current.HostConfig.Privileged,ipc:current.HostConfig.IpcMode,
   pid:current.HostConfig.PidMode,capDrop:current.HostConfig.CapDrop,securityOpt:current.HostConfig.SecurityOpt};
  assert.equal(current.Config.Image,spec.imageIndexDigest);assert.equal(current.Config.User,'10001:10001');
  assert.equal(current.HostConfig.NetworkMode,'none');assert.equal(current.HostConfig.ReadonlyRootfs,true);
  assert.equal(current.HostConfig.Privileged,false);assert.equal(current.HostConfig.PidMode,'');
  assert.equal(current.HostConfig.IpcMode,'private');assert.equal(current.HostConfig.Memory,134217728);
  assert.equal(current.HostConfig.MemorySwap,134217728);assert.equal(current.HostConfig.NanoCpus,250000000);
  assert.equal(current.HostConfig.PidsLimit,32);assert.ok(current.HostConfig.CapDrop.includes('ALL'));
  assert.ok(current.HostConfig.SecurityOpt.some(x=>x.startsWith('no-new-privileges')));
  assert.equal(current.HostConfig.Binds,null);assert.ok((current.Mounts??[]).every(x=>x.Type==='tmpfs'));
  assert.deepEqual(current.Config.Env,image.config.Env);assert.deepEqual(current.Config.Entrypoint,['/usr/local/bin/node']);
  assert.deepEqual(current.Config.Cmd,spec.args);return record;
 }
 async function run(record){const result=await docker(['container','start','--attach',record.cid],15000);record.result=result;
  const current=await inspect(record.cid);record.state=current.State;return result;}
 try{
  await t.test('host files, root writes, external network, and privilege alternatives are denied',async()=>{
   const source=`import fs from 'node:fs';import net from 'node:net';import {spawnSync} from 'node:child_process';
const denied=fn=>{try{fn();return false;}catch{return true;}};
const hostDenied=denied(()=>fs.readFileSync(${JSON.stringify(canary)}));
const rootDenied=denied(()=>fs.writeFileSync('/tmp/bowerloom-probe','no'));
const socketDenied=!fs.existsSync('/var/run/docker.sock');
const uidDenied=denied(()=>process.setuid(0));
const unshare=spawnSync('/usr/bin/unshare',['--user','--map-root-user','/usr/bin/id'],{encoding:'utf8',timeout:2000});
const mount=spawnSync('/bin/mount',['-t','tmpfs','none','/scratch'],{encoding:'utf8',timeout:2000});
const network=await new Promise(resolve=>{const s=net.connect({host:'198.51.100.1',port:9});s.setTimeout(1500);s.once('connect',()=>{s.destroy();resolve('connected');});s.once('error',e=>resolve(e.code));s.once('timeout',()=>{s.destroy();resolve('timeout');});});
fs.writeFileSync('/scratch/writable','synthetic');
let scratchBound=false;try{fs.writeFileSync('/scratch/too-big',Buffer.alloc(10*1024*1024,1));}catch(e){scratchBound=e.code==='ENOSPC';}
const status=fs.readFileSync('/proc/self/status','utf8');
console.log(JSON.stringify({hostDenied,rootDenied,socketDenied,uidDenied,unshareDenied:unshare.status!==0,mountDenied:mount.status!==0,
network,scratchBound,scratchWritable:fs.readFileSync('/scratch/writable','utf8')==='synthetic',uid:process.getuid(),
unshareProbe:{status:unshare.status,signal:unshare.signal,error:unshare.error?.code??null},mountProbe:{status:mount.status,signal:mount.signal,error:mount.error?.code??null},
noNewPrivs:/NoNewPrivs:\\s+1/.test(status),zeroCapabilities:/CapEff:\\s+0000000000000000/.test(status),seccomp:/Seccomp:\\s+2/.test(status)}));`;
   const record=await create('negative-boundaries',source);const result=await run(record);assert.equal(result.code,0,result.err);
   const measured=JSON.parse(result.out.trim());record.measurements=measured;
   for(const key of ['hostDenied','rootDenied','socketDenied','uidDenied','unshareDenied','mountDenied','scratchBound','scratchWritable','noNewPrivs','zeroCapabilities','seccomp'])assert.equal(measured[key],true,key);
   for(const probe of [measured.unshareProbe,measured.mountProbe]){assert.equal(probe.error,null);assert.equal(probe.signal,null);assert.equal(typeof probe.status,'number');assert.notEqual(probe.status,0);}
   assert.equal(measured.uid,10001);assert.ok(['ENETUNREACH','EHOSTUNREACH'].includes(measured.network),measured.network);
   assert.equal(readFileSync(canary,'utf8'),'synthetic-host-canary');await remove(record.cid);
  });
  await t.test('CPU work is throttled by the selected quota',async()=>{
   const record=await create('cpu-quota',`import fs from 'node:fs';const before=fs.readFileSync('/sys/fs/cgroup/cpu.stat','utf8');const end=Date.now()+1800;let n=0;while(Date.now()<end)n++;const after=fs.readFileSync('/sys/fs/cgroup/cpu.stat','utf8');console.log(JSON.stringify({before,after,max:fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8'),n}));`);
   const result=await run(record);assert.equal(result.code,0,result.err);record.measurements=JSON.parse(result.out);
   assert.equal(record.measurements.max.trim(),'25000 100000');const count=s=>Number(s.match(/nr_throttled (\d+)/)[1]);
   assert.ok(count(record.measurements.after)>count(record.measurements.before));await remove(record.cid);
  });
  await t.test('process creation reaches the selected PID bound',async()=>{
   const record=await create('pid-quota',`import fs from 'node:fs';import {spawn} from 'node:child_process';
const children=[],errors=[];for(let i=0;i<40;i++){await new Promise(resolve=>{const c=spawn('/bin/sleep',['30'],{stdio:'ignore'});c.once('spawn',()=>{children.push(c);resolve();});c.once('error',e=>{errors.push(e.code);resolve();});});if(errors.length)break;}
const max=fs.readFileSync('/sys/fs/cgroup/pids.max','utf8');const current=fs.readFileSync('/sys/fs/cgroup/pids.current','utf8');
await Promise.all(children.map(c=>new Promise(resolve=>{c.once('close',resolve);c.kill('SIGKILL');})));
console.log(JSON.stringify({created:children.length,errors,max,current}));`);
   const result=await run(record);assert.equal(result.code,0,result.err);record.measurements=JSON.parse(result.out);
   assert.ok(record.measurements.errors.includes('EAGAIN'));assert.equal(record.measurements.max.trim(),'32');
   assert.ok(Number(record.measurements.current)<=32);assert.ok(record.measurements.created>0);await remove(record.cid);
  });
  await t.test('excess allocation is killed inside the selected memory bound',async()=>{
   const record=await create('memory-quota',`import fs from 'node:fs';console.log(JSON.stringify({max:fs.readFileSync('/sys/fs/cgroup/memory.max','utf8')}));const held=[];for(let n=0;n<40;n++)held.push(Buffer.alloc(8*1024*1024,7));console.log('allocation unexpectedly survived');`);
   const result=await run(record);assert.equal(result.code,137);assert.equal(record.state.OOMKilled,true);
   record.measurements=JSON.parse(result.out);assert.equal(record.measurements.max.trim(),'134217728');await remove(record.cid);
  });
  await t.test('an escaped process group still stops with its owned container',async()=>{
   const record=await create('detached-descendant',`import {spawn} from 'node:child_process';const c=spawn('/bin/sleep',['120'],{detached:true,stdio:'ignore'});c.unref();console.log(JSON.stringify({pid:process.pid,child:c.pid}));setInterval(()=>{},1000);`);
   const attached=docker(['container','start','--attach',record.cid],15000);attached.catch(()=>{});
   let top;for(let n=0;n<50;n++){top=await docker(['container','top',record.cid,'-eo','pid,ppid,pgid,sid,args']);if(top.code===0&&top.out.includes('/bin/sleep 120'))break;await delay(50);}
   assert.equal(top.code,0,top.err);assert.match(top.out,/sleep 120/);record.processesBeforeStop=top.out;
   const row=top.out.split('\n').find(x=>x.includes('/bin/sleep 120'));assert.ok(row);const columns=row.trim().split(/\s+/);
   assert.equal(columns[0],columns[2]);assert.equal(columns[0],columns[3]);
   const stopped=await docker(['container','stop','--time','1',record.cid]);assert.equal(stopped.code,0,stopped.err);
   const result=await attached;record.result=result;record.measurements=JSON.parse(result.out.trim());
   const current=await inspect(record.cid);assert.equal(current.State.Running,false);
   const after=await docker(['container','top',record.cid]);assert.notEqual(after.code,0);record.stopped=true;await remove(record.cid);
  });
 }finally{
  const failures=[];for(const cid of [...owned.keys()])try{await remove(cid);}catch(e){failures.push(String(e));}
  const evidence={format:'bowerloom/mcp-container-qualification/v1beta1',observedAt:new Date().toISOString(),platform:`linux/${image.architecture}`,host:process.platform,
   records,cleanupFailures:failures,toolCalls:0,externalEndpointsContacted:0,imagePulls:0,productionDispatchIntegrated:false,
   nativeHarnessBypassTested:false,controllerLossCleanupTested:false,trustedDaemonRequired:true};
  writeFileSync(join(directory,'container-qualification.json'),JSON.stringify(evidence,null,2)+'\n');
  rmSync(hostDirectory,{recursive:true,force:true});assert.deepEqual(failures,[]);
 }
});
