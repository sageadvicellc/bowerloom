import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,renameSync,mkdirSync,chmodSync} from 'node:fs';
import {mkdtemp,realpath,mkdir,writeFile,chmod,rm,symlink,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createHash} from 'node:crypto';
import {canonicalJson} from '../../../dist/packages/contracts/src/index.js';
import {createDiscoveryProposal,createDiscoveryAuthorityState,mcpBindingRevision,planMcpContainerDiscoveryLaunch,McpConnectionError} from '../../../dist/packages/mcp-connections/src/index.js';
import {collectMcpContainerRecovery,collectAndPersistMcpContainerRecovery} from '../../../dist/packages/mcp-connections/src/container-recovery-collector.js';
const hash=v=>'sha256:'+createHash('sha256').update(v).digest('hex');
const refused=e=>e instanceof McpConnectionError&&e.code==='MCP_RECOVERY_COLLECTOR_UNCERTAIN'&&e.message===e.code;
function fixture(){
 const d='sha256:'+'a'.repeat(64),scope={workspaceId:'synthetic',runId:'run',taskId:'discovery'};
 const imageConfigJson=JSON.stringify({architecture:'arm64',os:'linux',config:{Env:[]},rootfs:{type:'layers',diff_ids:[d]}});
 const imageManifestJson=JSON.stringify({schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',config:{mediaType:'application/vnd.oci.image.config.v1+json',digest:hash(imageConfigJson),size:Buffer.byteLength(imageConfigJson)},layers:[{mediaType:'application/vnd.oci.image.layer.v1.tar',digest:d,size:1000}]});
 const imageIndexJson=JSON.stringify({schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests:[{mediaType:'application/vnd.oci.image.manifest.v1+json',digest:hash(imageManifestJson),size:Buffer.byteLength(imageManifestJson),platform:{architecture:'arm64',os:'linux'}}]});
 const launch={synthetic:true,imageIndexJson,imageManifestJson,imageConfigJson,spec:{format:'bowerloom/mcp-container-launch/v1beta1',operationKey:d,imageIndexDigest:hash(imageIndexJson),imageManifestDigest:hash(imageManifestJson),imageConfigDigest:hash(imageConfigJson),platform:'linux/arm64',entrypoint:'/usr/local/bin/node',args:['-e','process.stdin.resume()'],workingDirectory:'/tmp',user:{uid:10001,gid:10001},imageEnvironment:[],limits:{cpuMillis:250,memoryBytes:134217728,pids:32,scratchBytes:8388608,shmBytes:1048576}}};
 const input={synthetic:true,...Object.fromEntries(['declaration','binding','catalog'].map(part=>[part,JSON.parse(readFileSync(new URL(`./fixtures/stdio-${part}.json`,import.meta.url),'utf8'))]))};
 input.binding.transport={kind:'stdio',executable:'/usr/local/bin/node',workingDirectory:'/tmp',secretReferences:[]};input.catalog.bindingRevision=mcpBindingRevision(input.binding);
 const effect={kind:'container-stdio',launch,launchRevision:planMcpContainerDiscoveryLaunch(launch).revision};
 const proposal=createDiscoveryProposal({scope,requestId:'recovery',ownerEpoch:1,input,effect,timeoutMs:4000});
 const authority=createDiscoveryAuthorityState(proposal,{scope,ownerSubject:'owner',ownerEpoch:1,approverSubjects:['founder'],readyAtMs:1000,leaseExpiresAtMs:20000,revoked:false});
 authority.approval={revision:proposal.revision,expiresAtMs:10000,subject:'founder',proofRef:'synthetic:proof',approvedAtMs:1000,ownerEpoch:1};
 authority.intent={operationKey:authority.operationKey,proposalRevision:proposal.revision,ownerSubject:'owner',ownerEpoch:1,principalExpiresAtMs:15000,startedAtMs:2000,deadlineMs:6000};authority.status='NEEDS_RECONCILIATION';authority.reason='SESSION_UNCERTAIN';
 const journal={format:'bowerloom/mcp-container-journal/v1beta1',operationKey:authority.operationKey,launchOperationKey:d,launchRevision:effect.launchRevision,name:'bowerloom-mcp-'+d.slice(7),cid:'c'.repeat(64),stage:'UNCERTAIN',deadlineMs:6000,guardianPid:2100,attachPid:2101,reason:'CLEANUP_UNCERTAIN',lease:{sequence:3,lastRenewedAtMs:3000,expiresMonotonicMs:4500.5,stopRequestedAtMs:5000,containerAbsentAtMs:null,attachReapedAtMs:null}};
 const text=canonicalJson(journal);
 return {format:'bowerloom/mcp-container-recovery-input/v1beta1',synthetic:true,authority,expectedJob:{operationKey:authority.operationKey,launchRevision:effect.launchRevision,deadlineMs:6000},journal:{status:'trusted-snapshot',text,expectedSha256:hash(text)},observations:{observedAtMs:9000,hostSession:'same-host-session',guardian:{pid:2100,state:'absent'},attach:{pid:2101,state:'absent'},container:{requestedCid:journal.cid,state:'absent',returnedCid:null}},nowMs:9001};
}
async function setup(t,mode='absent'){
 const f=fixture(),root=await mkdtemp(join(await realpath(tmpdir()),'bowerloom-collector-test-'));await chmod(root,0o700);t.after(()=>rm(root,{recursive:true,force:true}));
 const state=structuredClone(f.authority),directory=join(root,state.operationKey.slice(7)),path=join(directory,'journal.json');await mkdir(directory,{mode:0o700});
 const j=JSON.parse(f.journal.text);if(mode==='real-ps')j.guardianPid=process.pid;
 await writeFile(path,canonicalJson(j),{mode:0o600});
 const calls=[];let transactions=0,kills=0;const hooks={beforeTransaction:null,duringDocker:null};
 const store={async transaction(scope,mutate){transactions++;await hooks.beforeTransaction?.(transactions,state);const draft=structuredClone(state);const result=mutate(draft);assert.deepEqual(draft,state,'collector must leave store state unchanged');return structuredClone(result);}};
 const originalSpawn=cp.spawn;
 t.mock.method(cp,'spawn',(exe,argv,options)=>{
  calls.push({exe,argv,options});assert.equal(options.shell,false);assert.deepEqual(Object.keys(options.env).sort(),['HOME','NODE_V8_COVERAGE','PATH']);assert.equal(options.env.NODE_V8_COVERAGE,undefined);
  if(mode==='real-ps'&&exe==='/bin/ps')return originalSpawn(exe,argv,options);
  assert.ok(['/bin/ps','/usr/local/bin/docker'].includes(exe));
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.unref=()=>{};child.kill=()=>{kills++;queueMicrotask(()=>child.emit('close',null));return true;};
  queueMicrotask(()=>{
   let code=0,out='';
   if(exe==='/bin/ps'){assert.deepEqual(argv,['-p',`${j.guardianPid},${j.attachPid}`,'-o','pid=']);if(mode==='ps-failure'){code=2;child.stderr.end('PRIVATE_PS');}else if(mode==='ps-stderr'){code=1;child.stderr.end('PRIVATE_PS_PERMISSION');}else if(mode==='ps-zero-stderr'){child.stderr.end('PRIVATE_PS_OPERATION');out=` ${j.guardianPid}\n`;}else if(mode==='active')out=` ${j.guardianPid}\n`;else code=1;}
   else{
    assert.deepEqual(argv,['--context','desktop-linux','container','ls','--all','--no-trunc','--filter','id='+j.cid,'--format','{{.ID}}']);hooks.duringDocker?.();
    if(mode==='timeout')return;if(mode==='failure'){code=1;child.stderr.end('PRIVATE_DOCKER');}if(mode==='present')out=j.cid+'\n';if(mode==='wrong-cid')out='d'.repeat(64)+'\n';if(mode==='flood')out='x'.repeat(65537);if(mode==='invalid-utf8'){child.stdout.end(Buffer.from([0xff]));child.emit('close',0);return;}
   }
   child.stdout.end(out);child.stderr.end();child.emit('close',code);
  });return child;
 });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 return{root,directory,path,j,state,hooks,calls,store,get transactions(){return transactions;},get kills(){return kills;},collect:()=>collectMcpContainerRecovery({store,stateRoot:root,trustedDockerDesktop:true},state.scope)};
}
test('collector reads actual private bytes and exact process/container queries while holding provenance unknown',async t=>{
 const f=await setup(t),before=canonicalJson(f.state),r=await f.collect();assert.equal(r.journal.status,'stable-private-file');assert.equal(r.journal.sha256,hash(readFileSync(f.path)));assert.equal(r.observations.guardian.state,'absent');assert.equal(r.observations.attach.state,'absent');assert.equal(r.observations.container.state,'absent');
 assert.equal(r.planner.finding,'HOLD_HOST_SESSION');assert.equal(r.journalOrigin,'unverified-local-user-file');assert.equal(r.authorityUnchangedAtFinalCheck,true);assert.equal(r.journalUnchangedAtFinalCheck,true);assert.equal(r.cleanupAuthorized,false);assert.equal(r.retryAuthorized,false);assert.equal(r.executionAuthorized,false);assert.equal(r.hostRestartSafetyVerified,false);assert.equal(canonicalJson(f.state),before);assert.equal(f.transactions,2);assert.equal(f.kills,0);
});
test('actual ps observes this live test process without signaling it',async t=>{
 const f=await setup(t,'real-ps'),r=await f.collect();assert.equal(r.observations.guardian.pid,process.pid);assert.equal(r.observations.guardian.state,'present');assert.equal(r.planner.finding,'HOLD_HOST_SESSION');assert.equal(f.kills,0);
});
test('present or failed process observations remain distinct and non-authorizing',async t=>{
 for(const [mode,state]of[['active','present'],['ps-failure','unknown'],['ps-stderr','unknown'],['ps-zero-stderr','unknown']])await t.test(mode,async t=>{const f=await setup(t,mode),r=await f.collect();assert.equal(r.observations.guardian.state,state);assert.equal(r.planner.finding,'HOLD_HOST_SESSION');});
});
test('Docker errors, wrong IDs, invalid text, flood and timeout never mean absence',async t=>{
 for(const mode of ['failure','wrong-cid','invalid-utf8','flood','timeout'])await t.test(mode,async t=>{const f=await setup(t,mode),r=await f.collect();assert.equal(r.observations.container.state,'unknown');assert.equal(JSON.stringify(r).includes('PRIVATE'),false);if(mode==='timeout'||mode==='flood')assert.equal(f.kills,1);else assert.equal(f.kills,0);});
 const f=await setup(t,'present');assert.equal((await f.collect()).observations.container.state,'present');
});
test('missing operation directory and missing journal yield held reports and no read commands',async t=>{
 for(const level of ['directory','file'])await t.test(level,async t=>{const f=await setup(t);await rm(level==='directory'?f.directory:f.path,{recursive:true});const r=await f.collect();assert.equal(r.journal.status,'missing');assert.equal(r.observations.container.state,'not-queried');assert.equal(f.calls.length,0);assert.equal(f.transactions,2);});
});
test('symlink files, hardlinks, symlink operation ancestors and unsafe modes refuse before subprocesses',async t=>{
 for(const mode of ['symlink','hardlink','ancestor','dangling-ancestor','file-mode','special-mode','root-mode','directory-mode','oversize'])await t.test(mode,async t=>{
  const f=await setup(t);
  if(mode==='symlink'){await renameForLink(f);await symlink(f.path+'-saved',f.path);}if(mode==='hardlink')await link(f.path,f.path+'-linked');
  if(mode==='ancestor'||mode==='dangling-ancestor'){await rm(f.directory,{recursive:true});await symlink(mode==='ancestor'?f.root:f.root+'-missing',f.directory);}
  if(mode==='file-mode')await chmod(f.path,0o644);if(mode==='special-mode')await chmod(f.path,0o4600);if(mode==='root-mode')await chmod(f.root,0o755);if(mode==='directory-mode')await chmod(f.directory,0o755);if(mode==='oversize')await writeFile(f.path,'x'.repeat(8193));
  await assert.rejects(f.collect(),refused);assert.equal(f.calls.length,0);
 });
});
async function renameForLink(f){renameSync(f.path,f.path+'-saved');}
test('journal tampering and exact authority/launch mismatch refuse before Docker contact',async t=>{
 for(const mutate of [j=>j.operationKey='sha256:'+'e'.repeat(64),j=>j.launchRevision='sha256:'+'e'.repeat(64),j=>j.cid='short',j=>j.deadlineMs++,j=>j.extra='PRIVATE'])await t.test(String(mutate),async t=>{const f=await setup(t);mutate(f.j);await writeFile(f.path,canonicalJson(f.j));await assert.rejects(f.collect(),refused);assert.equal(f.calls.length,0);});
});
test('file content, file identity, and ancestor replacement during observations invalidate the report',async t=>{
 for(const mode of ['content','file','ancestor','metadata'])await t.test(mode,async t=>{
  const f=await setup(t);f.hooks.duringDocker=()=>{if(mode==='content')writeFileSync(f.path,canonicalJson({...f.j,reason:'CHANGED'}));else if(mode==='metadata'){chmodSync(f.path,0o600);}else if(mode==='file'){renameSync(f.path,f.path+'-old');writeFileSync(f.path,canonicalJson(f.j),{mode:0o600});}else{renameSync(f.directory,f.directory+'-old');mkdirSync(f.directory,{mode:0o700});writeFileSync(f.path,canonicalJson(f.j),{mode:0o600});}};
  await assert.rejects(f.collect(),refused);assert.equal(f.transactions,1);
 });
});
test('new journal appearance after an initial missing observation invalidates the report',async t=>{
 const f=await setup(t);await rm(f.path);f.hooks.beforeTransaction=n=>{if(n===2)writeFileSync(f.path,canonicalJson(f.j),{mode:0o600});};await assert.rejects(f.collect(),refused);
});
test('final full-authority comparison detects concurrent changes and DB failure without clearing holds',async t=>{
 for(const mode of ['revocation','first-error','final-error','lost-ack'])await t.test(mode,async t=>{
  const f=await setup(t);f.hooks.beforeTransaction=(n,state)=>{if(mode==='first-error'&&n===1||mode==='final-error'&&n===2)throw Error('PRIVATE_DB');if(mode==='revocation'&&n===2)state.grant.revoked=true;};
  if(mode==='lost-ack'){const original=f.store.transaction.bind(f.store);f.store.transaction=async(...args)=>{const result=await original(...args);if(f.transactions===2)throw Error('PRIVATE_ACK');return result;};}
  await assert.rejects(f.collect(),refused);assert.equal(f.state.status,'NEEDS_RECONCILIATION');if(mode==='first-error')assert.equal(f.calls.length,0);
 });
});
test('active durable authority and external observation overrides are rejected',async t=>{
 const f=await setup(t);f.state.status='IN_FLIGHT';f.state.reason=null;await assert.rejects(f.collect(),refused);assert.equal(f.calls.length,0);
 f.state.status='NEEDS_RECONCILIATION';f.state.reason='SESSION_UNCERTAIN';
 for(const extra of [{observations:{}},{now:()=>1},{executable:'/bin/echo'},{env:{DOCKER_HOST:'PRIVATE'}}])await assert.rejects(collectMcpContainerRecovery({store:f.store,stateRoot:f.root,trustedDockerDesktop:true,...extra},f.state.scope),refused);
 let reads=0;const deps={store:f.store,stateRoot:f.root,trustedDockerDesktop:true};Object.defineProperty(deps,'stateRoot',{get(){reads++;return f.root;},enumerable:true});await assert.rejects(collectMcpContainerRecovery(deps,f.state.scope),refused);assert.equal(reads,0);
});

test('unresponsive trusted store has a bounded collection deadline and cannot resume host reads later',{timeout:18000},async t=>{
 const f=await setup(t);let release;f.hooks.beforeTransaction=()=>new Promise(resolve=>{release=resolve;});
 await assert.rejects(f.collect(),refused);assert.equal(f.calls.length,0);release();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,0);
});

import {createMcpContainerRecoveryReceipt} from '../../../dist/packages/mcp-connections/src/container-recovery-receipt.js';
test('collector-owned persistence takes only fresh observations and retains uncertainty',async t=>{
 const f=await setup(t);let writes=0;f.store.recordRecoveryReceipt=async(expected,collection,check)=>{check();writes++;assert.equal(canonicalJson(expected),canonicalJson(f.state));return createMcpContainerRecoveryReceipt(expected,collection);};
 const r=await collectAndPersistMcpContainerRecovery({store:f.store,stateRoot:f.root,trustedDockerDesktop:true},f.state.scope);assert.equal(writes,1);assert.equal(r.persistence,'commit-acknowledged');assert.equal(r.receipt.collection.revision,r.collection.revision);assert.equal(r.receipt.hostSession,'unknown');assert.equal(r.receipt.executionAuthorized,false);
 await assert.rejects(collectAndPersistMcpContainerRecovery({store:f.store,stateRoot:f.root,trustedDockerDesktop:true,report:r.collection},f.state.scope),refused);assert.equal(writes,1);
});
test('collector persistence error, corrupt acknowledgement or post-commit journal change returns uncertainty',async t=>{
 for(const mode of ['error','corrupt','journal-change'])await t.test(mode,async t=>{const f=await setup(t);f.store.recordRecoveryReceipt=async(expected,collection,check)=>{check();if(mode==='error')throw Error('PRIVATE_ACK');const r=createMcpContainerRecoveryReceipt(expected,collection);if(mode==='corrupt')r.hostSession='trusted';if(mode==='journal-change')writeFileSync(f.path,canonicalJson({...f.j,reason:'CHANGED'}));return r;};await assert.rejects(collectAndPersistMcpContainerRecovery({store:f.store,stateRoot:f.root,trustedDockerDesktop:true},f.state.scope),refused);assert.equal(f.state.status,'NEEDS_RECONCILIATION');});
});
test('collector timeout cannot turn a late persistence completion into success', {timeout:18000},async t=>{
 const f=await setup(t);let release,entered;const started=new Promise(resolve=>entered=resolve);f.store.recordRecoveryReceipt=async(expected,collection,check)=>{entered();await new Promise(resolve=>release=resolve);check();return createMcpContainerRecoveryReceipt(expected,collection);};
 const pending=collectAndPersistMcpContainerRecovery({store:f.store,stateRoot:f.root,trustedDockerDesktop:true},f.state.scope);await started;await assert.rejects(pending,refused);release();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.state.status,'NEEDS_RECONCILIATION');
});
