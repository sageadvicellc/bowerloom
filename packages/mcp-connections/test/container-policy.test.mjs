import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import cp from 'node:child_process';
import https from 'node:https';
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import { planMcpContainerLaunch, planMcpContainerDiscoveryLaunch, McpConnectionError } from '../../../dist/packages/mcp-connections/src/index.js';
const hash=v=>'sha256:'+createHash('sha256').update(v).digest('hex');
const DIGEST='sha256:'+'a'.repeat(64), MANIFEST='application/vnd.oci.image.manifest.v1+json';
const refused=error=>error instanceof McpConnectionError&&/^MCP_CONTAINER_[A-Z_]+$/.test(error.code)&&error.code===error.message&&!error.message.includes('PRIVATE');
function fixture({config,manifest,index}={}){
 const cfg={architecture:'arm64',os:'linux',variant:'v8',config:{Env:['PATH=/usr/local/bin:/usr/bin:/bin','NODE_VERSION=24.21.0'],Entrypoint:['inherited-entrypoint'],Cmd:['inherited-command']},rootfs:{type:'layers',diff_ids:[DIGEST]}};config?.(cfg);
 const imageConfigJson=JSON.stringify(cfg),man={schemaVersion:2,mediaType:MANIFEST,config:{mediaType:'application/vnd.oci.image.config.v1+json',digest:hash(imageConfigJson),size:Buffer.byteLength(imageConfigJson)},layers:[{mediaType:'application/vnd.oci.image.layer.v1.tar+gzip',digest:DIGEST,size:1000}]};manifest?.(man);
 const imageManifestJson=JSON.stringify(man),idx={schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests:[{mediaType:MANIFEST,digest:hash(imageManifestJson),size:Buffer.byteLength(imageManifestJson),platform:{architecture:'arm64',os:'linux',variant:'v8'}}]};index?.(idx);
 const imageIndexJson=JSON.stringify(idx);
 return {synthetic:true,imageIndexJson,imageManifestJson,imageConfigJson,spec:{format:'bowerloom/mcp-container-launch/v1beta1',operationKey:DIGEST,imageIndexDigest:hash(imageIndexJson),imageManifestDigest:hash(imageManifestJson),imageConfigDigest:hash(imageConfigJson),platform:'linux/arm64',entrypoint:'/usr/local/bin/node',args:['--input-type=module','-e','console.log("synthetic")'],workingDirectory:'/',user:{uid:10001,gid:10001},imageEnvironment:cfg.config.Env??[],limits:{cpuMillis:250,memoryBytes:134217728,pids:32,scratchBytes:8388608,shmBytes:1048576}}};
}
test('pure immutable plan pins exact OCI chain and hardened argv without contact or grant',t=>{
 for(const [object,name]of [[cp,'spawn'],[cp,'execFile'],[https,'request'],[dns,'lookup'],[fs,'writeFile']])t.mock.method(object,name,()=>{throw Error('unexpected external effect');});
 const input=fixture(),plan=planMcpContainerLaunch(input),args=plan.argv;
 assert.deepEqual(args.slice(0,3),['container','create','--pull=never']);assert.equal(args[args.indexOf('--')+1],input.spec.imageIndexDigest);assert.deepEqual(args.slice(args.indexOf('--')+2),input.spec.args);
 const value=key=>args[args.indexOf(key)+1];for(const [key,expected]of [['--network','none'],['--ipc','private'],['--cgroupns','private'],['--cap-drop','ALL'],['--security-opt','no-new-privileges=true'],['--user','10001:10001'],['--cpus','0.250'],['--memory','134217728'],['--memory-swap','134217728'],['--pids-limit','32'],['--restart','no'],['--log-driver','none'],['--platform','linux/arm64'],['--entrypoint','/usr/local/bin/node']])assert.equal(value(key),expected,key);
 assert.deepEqual(args.flatMap((value,index)=>value==='--security-opt'?[args[index+1]]:[]),['no-new-privileges=true','seccomp=builtin']);
 assert.ok(args.includes('--init'));assert.ok(args.includes('--read-only'));assert.ok(args.includes('--no-healthcheck'));assert.equal(value('--tmpfs'),'/scratch:rw,noexec,nosuid,nodev,size=8388608,mode=0700,uid=10001,gid=10001');
 for(const flag of ['--privileged','--pid','--mount','--volume','--device','--publish','--env','--env-file','--gpus'])assert.equal(args.includes(flag),false);
 assert.equal(plan.executionAuthorized,false);assert.equal(plan.containmentVerified,false);assert.equal(plan.transportVerified,false);assert.deepEqual(plan.grants,[]);assert.ok(Object.isFrozen(plan));assert.ok(Object.isFrozen(plan.argv));assert.ok(Object.isFrozen(plan.spec.limits));
 assert.deepEqual(planMcpContainerLaunch(input),plan);input.spec.args.push('later');assert.equal(plan.spec.args.length,3);
});
test('every launch identity, platform artifact and resource choice changes the revision',()=>{
 const original=fixture(),before=planMcpContainerLaunch(original).revision;
 for(const change of [v=>v.spec.operationKey='sha256:'+'b'.repeat(64),v=>v.spec.entrypoint='/usr/local/bin/other',v=>v.spec.args.push('literal'),v=>v.spec.workingDirectory='/app',v=>v.spec.user.uid=10002,v=>v.spec.user.gid=10002,v=>v.spec.limits.cpuMillis=500,v=>v.spec.limits.memoryBytes=268435456,v=>v.spec.limits.pids=64,v=>v.spec.limits.scratchBytes=16777216,v=>v.spec.limits.shmBytes=2097152]){const altered=structuredClone(original);change(altered);assert.notEqual(planMcpContainerLaunch(altered).revision,before);}
 const artifact=fixture({config:v=>{v.history=[{created_by:'synthetic revision'}];}});assert.notEqual(planMcpContainerLaunch(artifact).revision,before);
});
test('refuses tags, wrong digests, missing artifacts, unsupported platform and opaque new permissions',()=>{
 for(const change of [v=>v.synthetic=false,v=>v.spec.imageIndexDigest='node:24',v=>v.spec.imageConfigDigest='sha256:'+'b'.repeat(64),v=>v.imageManifestJson+=' ',v=>delete v.imageConfigJson,v=>v.spec.platform='linux/riscv64',v=>v.spec.mounts=['/private'],v=>v.spec.network='host',v=>v.spec.env={PRIVATE:'inline'},v=>v.extra='PRIVATE']){const v=fixture();change(v);assert.throws(()=>planMcpContainerLaunch(v),refused);}
});
test('manifest selection is unique and exact for OS, architecture, variant, size and config identity',()=>{
 for(const options of [{index:v=>v.manifests.push(structuredClone(v.manifests[0]))},{index:v=>v.manifests[0].platform.variant='v9'},{index:v=>v.manifests[0].platform.os='windows'},{index:v=>v.manifests[0].size++},{index:v=>v.manifests[0].digest=DIGEST},{manifest:v=>v.config.size++},{manifest:v=>v.config.digest=DIGEST},{config:v=>v.variant='v7'},{config:v=>v.os='windows'},{config:v=>v.architecture='amd64'}])assert.throws(()=>planMcpContainerLaunch(fixture(options)),refused);
 const sameArch=fixture({index:v=>v.manifests.push({...v.manifests[0],platform:{architecture:'arm64',os:'linux'}})});assert.throws(()=>planMcpContainerLaunch(sameArch),refused);
 const other=fixture({index:v=>v.manifests.push({...v.manifests[0],platform:{architecture:'unknown',os:'unknown'}})});assert.equal(planMcpContainerLaunch(other).containmentVerified,false);
});
test('image environment must match exactly and cannot smuggle loader controls or obvious secrets',()=>{
 for(const item of ['NODE_OPTIONS=--eval=PRIVATE','NODE_PATH=/scratch','NODE_V8_COVERAGE=/scratch','LD_PRELOAD=/tmp/x','DYLD_INSERT_LIBRARIES=/tmp/x','HTTPS_PROXY=https://private','API_TOKEN=PRIVATE','APP_SECRET=PRIVATE','PATH=/bin\nPRIVATE=1','MISSING_EQUALS'])assert.throws(()=>planMcpContainerLaunch(fixture({config:v=>v.config.Env.push(item)})),refused);
 assert.throws(()=>planMcpContainerLaunch(fixture({config:v=>v.config.Env.push(v.config.Env[0])})),refused);
 const mismatch=fixture();mismatch.spec.imageEnvironment.reverse();assert.throws(()=>planMcpContainerLaunch(mismatch),refused);
});
test('image side effects, external blobs and inconsistent rootfs metadata fail closed',()=>{
 for(const config of [v=>v.config.Volumes={'/data':{}},v=>v.config.Healthcheck={Test:['CMD','echo','hi']},v=>v.config.OnBuild=['RUN echo private'],v=>v.config.ExposedPorts={'80/tcp':{}},v=>v.config.ArgsEscaped=true,v=>v.config.Unknown=true,v=>v.rootfs.diff_ids=[],v=>v.rootfs.type='external',v=>v.rootfs.diff_ids=['not-a-digest']])assert.throws(()=>planMcpContainerLaunch(fixture({config})),refused);
 for(const manifest of [v=>v.layers[0].urls=['https://elsewhere.test/layer'],v=>v.layers[0].mediaType='external/layer',v=>v.layers=[],v=>v.config.mediaType='wrong'])assert.throws(()=>planMcpContainerLaunch(fixture({manifest})),refused);
});
test('numeric ceilings, nonroot IDs, image paths and argv are bounded and closed',()=>{
 for(const change of [v=>v.spec.user.uid=0,v=>v.spec.user.gid=0,v=>v.spec.user.uid='1000',v=>v.spec.limits.cpuMillis=0,v=>v.spec.limits.cpuMillis=2001,v=>v.spec.limits.memoryBytes=2**31,v=>v.spec.limits.pids=-1,v=>v.spec.limits.scratchBytes=134217728,v=>v.spec.limits.shmBytes=33554432,v=>v.spec.limits.memoryBytes=33554432,v=>v.spec.args=[],v=>v.spec.args=['x'.repeat(8193)],v=>v.spec.args=Array(5).fill('x'.repeat(8192)),v=>v.spec.args=['\0'],v=>v.spec.entrypoint='node',v=>v.spec.entrypoint='/usr/../bin/node',v=>v.spec.entrypoint='/proc/self/exe',v=>v.spec.workingDirectory='/scratch',v=>v.spec.workingDirectory='/app//more']){const v=fixture();change(v);if(v.spec.limits.memoryBytes===33554432)v.spec.limits.scratchBytes=33554432;assert.throws(()=>planMcpContainerLaunch(v),refused);}
 const injection=fixture();injection.spec.args=['--mount','/host:/host','$(touch /host/private)'];const plan=planMcpContainerLaunch(injection);assert.deepEqual(plan.argv.slice(-3),injection.spec.args);assert.equal(plan.argv.indexOf('--mount')>plan.argv.indexOf('--'),true);
});
test('strict raw JSON preserves byte identities and rejects duplicates, bad unicode and excessive inputs',()=>{
 const v=fixture();v.imageConfigJson='{"architecture":"arm64","architecture":"arm64"}';v.spec.imageConfigDigest=hash(v.imageConfigJson);assert.throws(()=>planMcpContainerLaunch(v),refused);
 for(const content of ['\ud800','x'.repeat(131073),'null','[]']){const input=fixture();input.imageIndexJson=content;input.spec.imageIndexDigest=hash(content);assert.throws(()=>planMcpContainerLaunch(input),refused);}
});
test('getters, serialization hooks, prototypes and caller mutation cannot execute or alter plans',()=>{
 let reads=0;const getter=fixture();Object.defineProperty(getter.spec,'args',{enumerable:true,get(){reads++;return ['PRIVATE'];}});assert.throws(()=>planMcpContainerLaunch(getter),refused);assert.equal(reads,0);
 const hook=fixture();hook.spec.toJSON=()=>{reads++;return {};};assert.throws(()=>planMcpContainerLaunch(hook),refused);assert.equal(reads,0);
 const proto=fixture();Object.setPrototypeOf(proto.spec,{PRIVATE:'inherited'});assert.throws(()=>planMcpContainerLaunch(proto),refused);
});

test('interactive discovery has a separate revision domain and leaves historical plans unchanged',()=>{
 const input=fixture(),original=planMcpContainerLaunch(input),discovery=planMcpContainerDiscoveryLaunch(input);
 assert.equal(original.argv.includes('--interactive'),false);assert.equal(discovery.argv.filter(x=>x==='--interactive').length,1);
 assert.deepEqual(discovery.argv.filter(x=>x!=='--interactive'),original.argv);
 assert.notEqual(discovery.revision,original.revision);assert.equal(discovery.format,'bowerloom/mcp-container-discovery-launch/v1beta1');
 assert.deepEqual(planMcpContainerLaunch(input),original);assert.equal(discovery.executionAuthorized,false);assert.ok(Object.isFrozen(discovery.argv));
});
