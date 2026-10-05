import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, realpath, rm, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpContainerDiscoveryFactory, planMcpContainerDiscoveryLaunch, McpConnectionError } from '../../../dist/packages/mcp-connections/src/index.js';
import { readDarwinBootSession } from '../../../dist/packages/mcp-connections/src/darwin-boot-session.js';
const hash=v=>'sha256:'+createHash('sha256').update(v).digest('hex');
const DIGEST='sha256:'+'a'.repeat(64), MANIFEST='application/vnd.oci.image.manifest.v1+json';
const initial={protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'bowerloom-discovery',version:'0.7.0-beta.0'}};
const refused=e=>e instanceof McpConnectionError&&/^MCP_CONTAINER_[A-Z_]+$/.test(e.code)&&e.message===e.code&&!e.message.includes('PRIVATE');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture({config,manifest,index}={}){
 const cfg={architecture:'arm64',os:'linux',variant:'v8',config:{Env:['PATH=/usr/local/bin:/usr/bin:/bin','NODE_VERSION=24.21.0'],Entrypoint:['inherited-entrypoint'],Cmd:['inherited-command']},rootfs:{type:'layers',diff_ids:[DIGEST]}};config?.(cfg);
 const imageConfigJson=JSON.stringify(cfg),man={schemaVersion:2,mediaType:MANIFEST,config:{mediaType:'application/vnd.oci.image.config.v1+json',digest:hash(imageConfigJson),size:Buffer.byteLength(imageConfigJson)},layers:[{mediaType:'application/vnd.oci.image.layer.v1.tar+gzip',digest:DIGEST,size:1000}]};manifest?.(man);
 const imageManifestJson=JSON.stringify(man),idx={schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests:[{mediaType:MANIFEST,digest:hash(imageManifestJson),size:Buffer.byteLength(imageManifestJson),platform:{architecture:'arm64',os:'linux',variant:'v8'}}]};index?.(idx);
 const imageIndexJson=JSON.stringify(idx);
 return {synthetic:true,imageIndexJson,imageManifestJson,imageConfigJson,spec:{format:'bowerloom/mcp-container-launch/v1beta1',operationKey:DIGEST,imageIndexDigest:hash(imageIndexJson),imageManifestDigest:hash(imageManifestJson),imageConfigDigest:hash(imageConfigJson),platform:'linux/arm64',entrypoint:'/usr/local/bin/node',args:['--input-type=module','-e','console.log("synthetic")'],workingDirectory:'/tmp',user:{uid:10001,gid:10001},imageEnvironment:cfg.config.Env??[],limits:{cpuMillis:250,memoryBytes:134217728,pids:32,scratchBytes:8388608,shmBytes:1048576}}};
}
async function setup(t,mode='normal'){
 const bootSessionId=await readDarwinBootSession(),publicKey=generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).toString('base64');
 const root=await mkdtemp(join(await realpath(tmpdir()),'bowerloom-container-unit-'));await chmod(root,0o700);t.after(()=>rm(root,{recursive:true,force:true}));
 const launch=fixture(),plan=planMcpContainerDiscoveryLaunch(launch),signal=new AbortController(),notifications=[],writes=[],opens=[];
 const binding={format:'bowerloom/mcp-binding/v1beta1',connectionId:'labs',bindingId:'synthetic',protocolVersion:'2025-11-25',serverIdentity:{name:'labs-fixture',version:'1.0.0'},transport:{kind:'stdio',executable:'/usr/local/bin/node',workingDirectory:'/tmp',secretReferences:[]}};
 const context={binding,effect:{kind:'container-stdio',launch,launchRevision:plan.revision},operationKey:'sha256:'+'b'.repeat(64),scope:{workspaceId:'unit',runId:'unit',taskId:'unit'},signal:signal.signal,onNotification:n=>notifications.push(n),deadlineMs:Date.now()+10000,renewAuthority:async()=>{},bindGuardian:async descriptor=>({operationKey:'sha256:'+'b'.repeat(64),launchRevision:plan.revision,descriptor,revision:'sha256:'+'d'.repeat(64)})};
 const options={stateRoot:root,trustedDockerDesktop:true,requestTimeoutMs:100,sessionTimeoutMs:5000,cleanupTimeoutMs:200};
 let guardian,job,kills=0,sends=0;
 t.mock.method(cp,'fork',(url,args,opts)=>{
  opens.push({url,args,opts});guardian=new EventEmitter();guardian.pid=91234;guardian.connected=true;
  const finish=()=>{if(!guardian.connected)return;guardian.connected=false;guardian.emit('message',{type:'done',containerAbsent:mode!=='uncertain',noContainerCreated:false,attachReaped:mode!=='unreaped',stage:mode==='uncertain'?'UNCERTAIN':'REAPED',reason:'CANCELLED'});guardian.emit('close',0,null);};
  guardian.kill=()=>{kills++;queueMicrotask(finish);return true;};
  guardian.send=(message,callback)=>{
   sends++;if(message.type==='write'&&mode==='ipc-throw')throw Error('PRIVATE_IPC');if(message.type==='write'&&mode==='ipc-callback'){callback?.(Error('PRIVATE_IPC'));return;}
   callback?.(null);
   if(message.type==='start'){job=message.job;queueMicrotask(()=>guardian.emit('message',{type:'guardian-hello',nonce:message.nonce,operationKey:job.operationKey,launchRevision:job.launchRevision,descriptor:{guardianPid:guardian.pid,bootSessionId,guardianSessionId:'e'.repeat(64),publicKey}}));}
   else if(message.type==='guardian-bound'){queueMicrotask(()=>guardian.emit('message',{type:'lease-challenge',nonce:message.nonce,operationKey:job.operationKey,sequence:1,challenge:'e'.repeat(64)}));}
   else if(message.type==='lease-renewal'){queueMicrotask(()=>guardian.emit('message',{type:'started',nonce:message.nonce,guardianPid:guardian.pid}));}
   else if(message.type==='cancel'){queueMicrotask(finish);}
   else if(message.type==='write'){
    const r=JSON.parse(message.data);writes.push(r);if(r.method==='notifications/initialized'||mode==='hang')return;
    let response=JSON.stringify({jsonrpc:'2.0',id:r.id,result:r.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:binding.serverIdentity}:{tools:[],...(r.params.cursor?{}:{nextCursor:'second'})}})+'\n';
    if(mode==='notification')response=JSON.stringify({jsonrpc:'2.0',method:'notifications/tools/list_changed',params:{private:'PRIVATE'}})+'\n';
    if(mode==='wrong-id')response=JSON.stringify({jsonrpc:'2.0',id:99,result:{}})+'\n';
    if(mode==='duplicate')response='{"jsonrpc":"2.0","id":1,"id":1,"result":{}}\n';
    if(mode==='extra')response=JSON.stringify({jsonrpc:'2.0',id:r.id,result:{},private:'PRIVATE'})+'\n';
    if(mode==='flood')response='x'.repeat(300000);
    let bytes=mode==='utf8'?Buffer.from([0xff,10]):Buffer.from(response);
    queueMicrotask(()=>{for(let n=0;n<bytes.length;n+=32768)guardian.emit('message',{type:'chunk',data:bytes.subarray(n,n+32768).toString('base64')});});
   }
  };return guardian;
 });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 return{root,context,options,signal,notifications,writes,opens,get job(){return job;},get kills(){return kills;},get sends(){return sends;}};
}
test('container factory pins exact launch and deadline while exposing discovery only',async t=>{
 const f=await setup(t),a=await createMcpContainerDiscoveryFactory(f.options)(f.context);
 assert.equal((await a.initialize(initial)).protocolVersion,'2025-11-25');await a.initialized();assert.equal((await a.listTools({})).nextCursor,'second');assert.deepEqual((await a.listTools({cursor:'second'})).tools,[]);await a.close();
 assert.deepEqual(Object.keys(a).sort(),['close','initialize','initialized','listTools']);assert.deepEqual(f.writes.map(x=>x.method),['initialize','notifications/initialized','tools/list','tools/list']);assert.equal(JSON.stringify(f.job.launch),JSON.stringify(f.context.effect.launch));assert.equal(f.job.operationKey,f.context.operationKey);assert.notEqual(f.job.operationKey,f.job.launch.spec.operationKey);assert.ok(f.job.deadlineMs<=f.context.deadlineMs);assert.ok(f.job.deadlineMs<=Date.now()+5000);
 assert.deepEqual(f.opens[0].opts.execArgv,[]);assert.deepEqual(Object.keys(f.opens[0].opts.env),['NODE_V8_COVERAGE']);assert.equal(f.opens[0].opts.env.NODE_V8_COVERAGE,undefined);assert.equal(f.opens[0].opts.detached,true);
});
test('launch changes, missing deadline, secrets and unsupported effects cannot fork a guardian',async t=>{
 const f=await setup(t);for(const alter of [c=>c.effect.launch.spec.args.push('PRIVATE'),c=>c.effect.launchRevision=DIGEST,c=>c.binding.transport.executable='/bin/sh',c=>c.binding.transport.workingDirectory='/elsewhere',c=>c.binding.transport.secretReferences=[{environmentVariable:'PRIVATE',reference:'secret-ref:private/x'}],c=>delete c.bindGuardian,c=>c.bindGuardian=true,c=>delete c.renewAuthority,c=>c.renewAuthority=true,c=>delete c.deadlineMs,c=>c.deadlineMs=Date.now()-1,c=>c.operationKey='PRIVATE',c=>c.effect.kind='stdio',c=>c.extra='PRIVATE']){
  const c={...f.context,binding:structuredClone(f.context.binding),effect:structuredClone(f.context.effect)};alter(c);await assert.rejects(createMcpContainerDiscoveryFactory(f.options)(c),refused);
 }assert.equal(f.opens.length,0);
});
test('options and context getters stay inert; explicit trust and private canonical state root required',async t=>{
 const f=await setup(t);let reads=0;const options={...f.options};Object.defineProperty(options,'stateRoot',{get(){reads++;return 'PRIVATE';},enumerable:true});assert.throws(()=>createMcpContainerDiscoveryFactory(options),refused);
 const c={...f.context};Object.defineProperty(c,'effect',{get(){reads++;return {};},enumerable:true});await assert.rejects(createMcpContainerDiscoveryFactory(f.options)(c),refused);assert.equal(reads,0);
 assert.throws(()=>createMcpContainerDiscoveryFactory({...f.options,trustedDockerDesktop:false}),refused);
 await chmod(f.root,0o755);await assert.rejects(createMcpContainerDiscoveryFactory(f.options)(f.context),refused);await chmod(f.root,0o700);
 const alias=f.root+'-alias';await symlink(f.root,alias);t.after(()=>rm(alias,{force:true}));await assert.rejects(createMcpContainerDiscoveryFactory({...f.options,stateRoot:alias})(f.context),refused);assert.equal(f.opens.length,0);
});
test('abort before or during queued filesystem preflight starts nothing',async t=>{
 const f=await setup(t);const pending=createMcpContainerDiscoveryFactory(f.options)(f.context);const observed=assert.rejects(pending,refused);f.signal.abort();await observed;assert.equal(f.opens.length,0);
 await assert.rejects(createMcpContainerDiscoveryFactory(f.options)(f.context),refused);assert.equal(f.opens.length,0);
});
test('unsolicited data, invalid UTF8, duplicate keys, wrong IDs, extra envelopes and flood close safely',async t=>{
 for(const mode of ['notification','utf8','duplicate','wrong-id','extra','flood'])await t.test(mode,async t=>{
  const f=await setup(t,mode),a=await createMcpContainerDiscoveryFactory(f.options)(f.context);await assert.rejects(a.initialize(initial),refused);await a.close();if(mode==='notification')assert.deepEqual(f.notifications,[{method:'notifications/tools/list_changed'}]);
 });
});
test('request timeout and local close observe pending rejection and require guardian closure',async t=>{
 for(const action of ['timeout','close','abort'])await t.test(action,async t=>{const f=await setup(t,'hang'),a=await createMcpContainerDiscoveryFactory(f.options)(f.context),pending=a.initialize(initial),observed=assert.rejects(pending,refused);if(action==='close')await a.close();if(action==='abort')f.signal.abort();await observed;await a.close();});
});
test('uncertain container absence or unreaped attach prevents successful close',async t=>{
 for(const mode of ['uncertain','unreaped'])await t.test(mode,async t=>{const f=await setup(t,mode),a=await createMcpContainerDiscoveryFactory(f.options)(f.context);await assert.rejects(a.close(),e=>e.code==='MCP_CONTAINER_CLEANUP_UNCERTAIN');});
});
test('method order and overlapping requests fail without tool calls or retry',async t=>{
 const f=await setup(t,'hang'),a=await createMcpContainerDiscoveryFactory(f.options)(f.context);const pending=a.initialize(initial),observed=assert.rejects(pending,refused);await assert.rejects(a.listTools({}),refused);await observed;await a.close();assert.ok(f.writes.length<=1);assert.equal(f.opens.length,1);
});

test('stale connected IPC callback and synchronous errors never recursively cancel or leak',async t=>{
 for(const mode of ['ipc-throw','ipc-callback'])await t.test(mode,async t=>{const f=await setup(t,mode),a=await createMcpContainerDiscoveryFactory(f.options)(f.context);await assert.rejects(a.initialize(initial),refused);await a.close();assert.equal(f.kills,1);assert.ok(f.sends<=4);});
});

test('failed initial durable renewal opens no protocol session and cancels the owned guardian',async t=>{
 const f=await setup(t);let checks=0;f.context.renewAuthority=async()=>{checks++;throw Error('PRIVATE_DB_FAILURE');};
 await assert.rejects(createMcpContainerDiscoveryFactory(f.options)(f.context),refused);
 assert.equal(checks,1);assert.equal(f.writes.length,0);assert.equal(f.opens.length,1);
});
test('renewal completion after cancellation never sends an authority response or protocol request',async t=>{
 const f=await setup(t);let release,called;const checking=new Promise(r=>called=r);
 f.context.renewAuthority=()=>{called();return new Promise(r=>release=r);};
 const opening=createMcpContainerDiscoveryFactory(f.options)(f.context),observed=assert.rejects(opening,refused);await checking;
 f.signal.abort();await observed;const sends=f.sends;release();await new Promise(r=>setImmediate(r));assert.equal(f.sends,sends);assert.equal(f.writes.length,0);
});

test('missing durable binding capability or failed acknowledgement never reaches a lease or protocol',async t=>{
 const f=await setup(t);let checks=0,renewals=0;f.context.bindGuardian=async()=>{checks++;throw Error('PRIVATE_DB_UNKNOWN');};f.context.renewAuthority=async()=>{renewals++;};
 await assert.rejects(createMcpContainerDiscoveryFactory(f.options)(f.context),refused);assert.equal(checks,1);assert.equal(renewals,0);assert.equal(f.writes.length,0);
});
test('binding completion after cancellation cannot start lease or protocol',async t=>{
 const f=await setup(t);let release,called,renewals=0;const checking=new Promise(r=>called=r),original=f.context.bindGuardian;
 f.context.bindGuardian=async descriptor=>{called();await new Promise(r=>release=r);return original(descriptor);};f.context.renewAuthority=async()=>{renewals++;};
 const opening=createMcpContainerDiscoveryFactory(f.options)(f.context),observed=assert.rejects(opening,refused);await checking;f.signal.abort();await observed;const sends=f.sends;release();await wait(20);assert.equal(f.sends,sends);assert.equal(renewals,0);assert.equal(f.writes.length,0);
});
