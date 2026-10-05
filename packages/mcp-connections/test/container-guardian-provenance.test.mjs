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
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
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

import {readDarwinBootSession} from '../../../dist/packages/mcp-connections/src/darwin-boot-session.js';
import {createGuardianBinding,validateGuardianBinding,guardianSignaturePayload,verifyGuardianJournal,inspectMcpGuardianProvenance} from '../../../dist/packages/mcp-connections/src/container-guardian-provenance.js';
import {PostgresDiscoveryAuthorityStore} from '../../../dist/packages/mcp-connections/src/authority-postgres.js';
const clone=v=>JSON.parse(JSON.stringify(v));
async function signedFixture(t){
 const f=fixture(),keys=generateKeyPairSync('ed25519'),bootSessionId=await readDarwinBootSession();
 const descriptor={guardianPid:2100,bootSessionId,guardianSessionId:'e'.repeat(64),publicKey:keys.publicKey.export({format:'der',type:'spki'}).toString('base64')};
 let binding=createGuardianBinding(f.authority,descriptor);const root=await mkdtemp(join(await realpath(tmpdir()),'bowerloom-provenance-test-'));await chmod(root,0o700);t.after(()=>rm(root,{recursive:true,force:true}));
 const directory=join(root,f.authority.operationKey.slice(7));await mkdir(directory,{mode:0o700});const path=join(directory,'journal.json');
 const signed=(body=JSON.parse(f.journal.text),sequence=1,selected=binding)=>{const p={format:'bowerloom/mcp-container-journal/v1beta2',bindingRevision:selected.revision,sequence,body};return canonicalJson({...p,signature:sign(null,guardianSignaturePayload(p),keys.privateKey).toString('base64')});};
 await writeFile(path,signed(),{mode:0o600});let reads=0;const hooks={read:null};const store={async readGuardianEvidence(scope){assert.equal(canonicalJson(scope),canonicalJson(f.authority.scope));reads++;await hooks.read?.(reads);return clone({authority:f.authority,binding});}};
 return{...f,keys,descriptor,root,path,signed,store,hooks,get binding(){return binding;},set binding(v){binding=v;},inspect:()=>inspectMcpGuardianProvenance({store,stateRoot:root,trustedDarwinHost:true},f.authority.scope)};
}
test('actual file and kernel boot inspection verifies historical signatures without freshness or PID authority',async t=>{
 const f=await signedFixture(t),r=await f.inspect();assert.equal(r.signature,'verified-historical');assert.equal(r.bootSession,'matches');assert.equal(r.snapshotFreshness,'unproved');assert.equal(r.processIdentity,'unproved');assert.equal(r.finding,'HOLD_RECOVERY');assert.equal(r.cleanupAuthorized,false);assert.equal(r.retryAuthorized,false);assert.equal(r.executionAuthorized,false);assert.equal(r.hostRestartSafetyVerified,false);
 await writeFile(f.path,f.signed(undefined,8));assert.equal((await f.inspect()).snapshotSequence,8);await writeFile(f.path,f.signed(undefined,1));const replay=await f.inspect();assert.equal(replay.signature,'verified-historical');assert.equal(replay.snapshotFreshness,'unproved');assert.equal(replay.finding,'HOLD_RECOVERY');
});
test('body, signature, operation and substituted key corruption refuse',async t=>{
 for(const mode of ['body','signature','operation','public-key','extra'])await t.test(mode,async t=>{
  const f=await signedFixture(t),v=JSON.parse(f.signed());if(mode==='body')v.body.cid='d'.repeat(64);if(mode==='signature')v.signature=Buffer.alloc(64).toString('base64');if(mode==='operation')v.body.operationKey='sha256:'+'a'.repeat(64);if(mode==='extra')v.extra=true;
  if(mode==='public-key'){const keys=generateKeyPairSync('ed25519');f.binding=createGuardianBinding(f.authority,{...f.descriptor,publicKey:keys.publicKey.export({format:'der',type:'spki'}).toString('base64')});}
  await writeFile(f.path,canonicalJson(v));await assert.rejects(f.inspect(),{code:'MCP_GUARDIAN_PROVENANCE_UNCERTAIN'});
 });
});
test('different boot and unknown attach process remain held despite valid signature',async t=>{
 const f=await signedFixture(t);f.binding=createGuardianBinding(f.authority,{...f.descriptor,bootSessionId:'00000000-0000-0000-0000-000000000001'});const body=JSON.parse(f.journal.text);body.attachPid=null;await writeFile(f.path,f.signed(body,1,f.binding));const r=await f.inspect();assert.equal(r.signature,'verified-historical');assert.equal(r.bootSession,'differs');assert.equal(r.processIdentity,'unproved');assert.equal(r.finding,'HOLD_RECOVERY');
});
test('legacy and missing journal/binding never receive retroactive provenance',async t=>{
 const f=await signedFixture(t);await writeFile(f.path,f.journal.text);assert.equal((await f.inspect()).signature,'legacy-or-unavailable');await rm(f.path);assert.equal((await f.inspect()).signature,'legacy-or-unavailable');f.binding=null;const r=await f.inspect();assert.equal(r.signature,'legacy-or-unavailable');assert.equal(r.bootSession,'unknown');
});
test('authority/binding drift, file change, cross scope and database failure refuse',async t=>{
 for(const mode of ['authority','binding','file','db'])await t.test(mode,async t=>{const f=await signedFixture(t);f.hooks.read=n=>{if(n!==2)return;if(mode==='authority')f.authority.grant.revoked=true;if(mode==='binding')f.binding=null;if(mode==='file')writeFileSync(f.path,f.signed(undefined,2));if(mode==='db')throw Error('PRIVATE_DB');};await assert.rejects(f.inspect(),{code:'MCP_GUARDIAN_PROVENANCE_UNCERTAIN'});});
 const f=await signedFixture(t);await assert.rejects(inspectMcpGuardianProvenance({store:f.store,stateRoot:f.root,trustedDarwinHost:true},{...f.authority.scope,taskId:'other'}));await assert.rejects(inspectMcpGuardianProvenance({store:f.store,stateRoot:f.root,trustedDarwinHost:true,bootSessionId:f.descriptor.bootSessionId},f.authority.scope));
});
test('boot command is fixed and failed/ambiguous output cannot establish boot identity',async t=>{
 for(const mode of ['stderr','bad','oversize','exit'])await t.test(mode,async t=>{
  t.mock.method(cp,'spawn',(exe,args,options)=>{assert.equal(exe,'/usr/sbin/sysctl');assert.deepEqual(args,['-n','kern.bootsessionuuid']);assert.equal(options.shell,false);assert.deepEqual(Object.keys(options.env),['PATH','NODE_V8_COVERAGE']);assert.equal(options.env.NODE_V8_COVERAGE,undefined);const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>true;queueMicrotask(()=>{c.stdout.end(mode==='oversize'?'A'.repeat(129):mode==='bad'?'wrong':'00000000-0000-0000-0000-000000000001\n');if(mode==='stderr')c.stderr.end('PRIVATE');c.emit('close',mode==='exit'?1:0);});return c;});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});await assert.rejects(readDarwinBootSession());
 });
});
function database(authority){
 let row=null,pending,metadata=true,version=1,hook=null,ack=null;const queries=[];
 const client=Object.assign(new EventEmitter(),{async query(sql,p){queries.push(sql);await hook?.(sql,p);if(sql.startsWith('BEGIN')){pending=clone(row);return{rows:[]};}if(sql==='ROLLBACK'){pending=null;return{rows:[]};}if(sql==='COMMIT'){row=clone(pending);await ack?.();return{rows:[]};}if(sql.startsWith('SET '))return{rows:[]};
  if(sql.includes('guardian_metadata')){if(sql.startsWith('CREATE')){assert.equal(metadata,false);metadata=true;return{rows:[]};}if(sql.startsWith('INSERT'))return{rows:[]};if(!metadata)throw Error('MISSING_SCHEMA');return{rows:[{singleton:true,version}]};}
  if(sql.startsWith('CREATE TABLE')&&sql.includes('guardian_bindings'))return{rows:[]};
  if(sql.includes('.metadata'))return{rows:[{singleton:true,version:1}]};
  if(sql.includes('.discoveries'))return{rows:[{version:1,state:clone(authority),checksum:hash(canonicalJson(authority))}]};
  if(sql.startsWith('INSERT')&&sql.includes('guardian_bindings')){pending??={version:1,binding:JSON.parse(p[3]),checksum:p[4]};return{rows:[]};}
  if(sql.startsWith('SELECT')&&sql.includes('guardian_bindings'))return{rows:pending?[clone(pending)]:[]};throw Error('UNEXPECTED SQL');
 },release(){}});
 return{store:new PostgresDiscoveryAuthorityStore({async connect(){return client;}},{schema:'bowerloom_mcp_provenance_test'}),queries,get row(){return row;},set row(v){row=v;},set metadata(v){metadata=v;},set version(v){version=v;},set hook(v){hook=v;},set ack(v){ack=v;}};
}
test('binding uses full authority lock, immutable exact identity and explicit schema without authority update',async t=>{
 const f=await signedFixture(t);f.authority.status='IN_FLIGHT';f.authority.reason=null;const d=database(f.authority),before=canonicalJson(f.authority);let checked=0;
 const b=await d.store.bindContainerGuardian(f.authority,f.descriptor,()=>{checked++;});await d.store.bindContainerGuardian(f.authority,f.descriptor,()=>{});assert.ok(checked>=3);assert.deepEqual((await d.store.readGuardianEvidence(f.authority.scope)).binding,b);assert.equal(canonicalJson(f.authority),before);assert.equal(d.queries.some(q=>q.startsWith('UPDATE')),false);assert.ok(d.queries.some(q=>q.includes('.discoveries')&&q.includes('FOR UPDATE')));
 await assert.rejects(d.store.bindContainerGuardian(f.authority,{...f.descriptor,guardianSessionId:'d'.repeat(64)},()=>{}));assert.deepEqual(d.row.binding,JSON.parse(JSON.stringify(b)));
});
test('binding refuses unavailable schema, live callback drift/async/mutation, corruption and lost commit acknowledgement',async t=>{
 const f=await signedFixture(t);f.authority.status='IN_FLIGHT';f.authority.reason=null;const d=database(f.authority);d.metadata=false;await assert.rejects(d.store.bindContainerGuardian(f.authority,f.descriptor,()=>{}));assert.equal(d.row,null);assert.equal(d.queries.some(q=>q.startsWith('CREATE')),false);await d.store.initializeGuardianBindings();
 await assert.rejects(d.store.bindContainerGuardian(f.authority,f.descriptor,async()=>{}));await assert.rejects(d.store.bindContainerGuardian(f.authority,f.descriptor,state=>{state.grant.revoked=true;}));
 const expected=clone(f.authority);d.hook=sql=>{if(sql.includes('.discoveries'))f.authority.grant.revoked=true;};await assert.rejects(d.store.bindContainerGuardian(expected,f.descriptor,()=>{}));assert.equal(d.row,null);d.hook=null;f.authority.grant.revoked=false;
 d.ack=()=>{throw Error('PRIVATE_LOST_ACK');};await assert.rejects(d.store.bindContainerGuardian(f.authority,f.descriptor,()=>{}),{code:'MCP_AUTHORITY_COMMIT_UNKNOWN'});assert.ok(d.row);d.ack=null;d.row.checksum='sha256:'+'f'.repeat(64);await assert.rejects(d.store.readGuardianEvidence(f.authority.scope));d.version=2;await assert.rejects(d.store.readGuardianEvidence(f.authority.scope));
});
test('even signed malformed body shapes do not pass the verifier',async t=>{
 const f=await signedFixture(t);
 for(const change of [b=>b.extra=true,b=>b.launchOperationKey='sha256:'+'f'.repeat(64),b=>b.name='/wrong',b=>b.attachPid=-1,b=>b.lease.sequence=0,b=>b.lease.expiresMonotonicMs=-1,b=>{b.stage='STARTED';b.attachPid=null;}]){const b=JSON.parse(f.journal.text);change(b);assert.throws(()=>verifyGuardianJournal(f.signed(b),f.binding));}
});
