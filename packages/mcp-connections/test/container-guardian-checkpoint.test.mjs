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
const unusedRefused=e=>e instanceof McpConnectionError&&e.code==='MCP_RECOVERY_COLLECTOR_UNCERTAIN'&&e.message===e.code;
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

import {advanceGuardianCheckpoint,createGuardianCheckpoint,createGuardianClosure,guardianTerminalPayload,terminalDeclaration,verifyGuardianTerminal,validateGuardianCheckpointRecords,classifyGuardianCheckpoint,inspectMcpGuardianCheckpoints,collectMcpGuardianOperatorReceipt} from '../../../dist/packages/mcp-connections/src/container-guardian-checkpoint.js';
function terminal(f,sequence=5){const b=JSON.parse(f.journal.text);b.stage='REAPED';b.lease.containerAbsentAtMs=5001;b.lease.attachReapedAtMs=5002;const envelope=f.signed(b,sequence),body=terminalDeclaration(f.binding.revision,envelope),seal=canonicalJson({...body,signature:sign(null,guardianTerminalPayload(body),f.keys.privateKey).toString('base64')});const witness={format:'bowerloom/mcp-guardian-owned-close/v1beta1',bindingRevision:f.binding.revision,guardianSessionId:f.descriptor.guardianSessionId,guardianPid:f.descriptor.guardianPid,exitCode:0,signal:null,observedAtMs:7000};return{envelope,seal,witness};}
function started(f,sequence=3){const b=JSON.parse(f.journal.text);b.stage='STARTED';return f.signed(b,sequence);}
test('checkpoint chain pins exact signed bytes, monotonic sequence and prior revision',async t=>{
 const f=await signedFixture(t),text=started(f),empty={checkpoints:[],closure:null},first=advanceGuardianCheckpoint(f.binding,empty,null,text);
 assert.equal(first.checkpoints.length,1);const second=advanceGuardianCheckpoint(f.binding,first,first.checkpoints[0].revision,started(f,4));assert.deepEqual(advanceGuardianCheckpoint(f.binding,second,null,text),second);assert.deepEqual(advanceGuardianCheckpoint(f.binding,first,null,text),first);
 for(const [head,envelope] of [[null,started(f,4)],[first.checkpoints[0].revision,started(f,2)],[first.checkpoints[0].revision,f.signed({...JSON.parse(f.journal.text),stage:'STARTED',reason:'DIFFERENT'},3)]])assert.throws(()=>advanceGuardianCheckpoint(f.binding,first,head,envelope));
 assert.throws(()=>advanceGuardianCheckpoint({...f.binding,revision:hash('wrong')},empty,null,text));
 let reads=0;assert.throws(()=>validateGuardianCheckpointRecords(f.binding,[{get envelope(){reads++;return text;}}],null));assert.equal(reads,0);
});
test('terminal CAS refuses unseen normal commit, is exactly idempotent and prevents higher signed checkpoints',async t=>{
 const f=await signedFixture(t),first=advanceGuardianCheckpoint(f.binding,{checkpoints:[],closure:null},null,started(f)),final=terminal(f);
 assert.throws(()=>advanceGuardianCheckpoint(f.binding,first,null,final.envelope,final));
 const closed=advanceGuardianCheckpoint(f.binding,first,first.checkpoints[0].revision,final.envelope,final);
 assert.deepEqual(advanceGuardianCheckpoint(f.binding,closed,first.checkpoints[0].revision,final.envelope,final),closed);
 assert.throws(()=>advanceGuardianCheckpoint(f.binding,closed,closed.checkpoints.at(-1).revision,started(f,9)));
 assert.throws(()=>advanceGuardianCheckpoint(f.binding,closed,null,final.envelope,{...final,witness:{...final.witness,observedAtMs:7001}}));
 const corrupt=clone(closed);corrupt.checkpoints[1].previousRevision=null;assert.throws(()=>validateGuardianCheckpointRecords(f.binding,corrupt.checkpoints,corrupt.closure));
});
test('seal is domain separated and exact clean owned incarnation is required',async t=>{
 const f=await signedFixture(t),final=terminal(f),record=createGuardianCheckpoint(f.binding,null,final.envelope);
 for(const change of [v=>v.exitCode=1,v=>v.signal='SIGTERM',v=>v.guardianPid++,v=>v.guardianSessionId='f'.repeat(64),v=>v.bindingRevision=hash('other'),v=>v.extra=true]){const w=clone(final.witness);change(w);assert.throws(()=>createGuardianClosure(f.binding,record,final.seal,w));}
 const unsigned=JSON.parse(final.seal);delete unsigned.signature;const wrong=canonicalJson({...unsigned,signature:sign(null,guardianSignaturePayload(unsigned),f.keys.privateKey).toString('base64')});assert.throws(()=>verifyGuardianTerminal(final.envelope,wrong,f.binding));
 for(const change of [b=>b.lease.containerAbsentAtMs=null,b=>b.lease.attachReapedAtMs=null,b=>b.stage='UNCERTAIN']){const b=JSON.parse(final.envelope).body;change(b);assert.throws(()=>terminalDeclaration(f.binding.revision,f.signed(b,5)));}
});
test('rollback, checkpoint equality and newer local snapshots never assert latest state',async t=>{
 const f=await signedFixture(t),first=advanceGuardianCheckpoint(f.binding,{checkpoints:[],closure:null},null,started(f)),final=terminal(f),closed=advanceGuardianCheckpoint(f.binding,first,first.checkpoints[0].revision,final.envelope,final);
 assert.equal(classifyGuardianCheckpoint(started(f),f.binding,{checkpoints:[],closure:null}),'unknown');assert.equal(classifyGuardianCheckpoint(started(f,2),f.binding,first),'rollback');assert.equal(classifyGuardianCheckpoint(started(f),f.binding,first),'matches-checkpoint');assert.equal(classifyGuardianCheckpoint(started(f,4),f.binding,first),'newer-unanchored');assert.equal(classifyGuardianCheckpoint(final.envelope,f.binding,closed),'final-snapshot-verified');assert.equal(classifyGuardianCheckpoint(started(f),f.binding,closed),'rollback');assert.equal(classifyGuardianCheckpoint(started(f,7),f.binding,closed),'terminal-mismatch');assert.equal(classifyGuardianCheckpoint(f.journal.text,f.binding,first),'unknown');
});
test('fresh versioned inspection and private operator receipt preserve authority and falsify every effect flag',async t=>{
 const f=await signedFixture(t),final=terminal(f),records=advanceGuardianCheckpoint(f.binding,{checkpoints:[],closure:null},null,final.envelope,final);await writeFile(f.path,final.envelope);const original=canonicalJson(f.authority);let reads=0;
 const deps={stateRoot:f.root,trustedDarwinHost:true,store:{async readGuardianCheckpointEvidence(){reads++;return clone({authority:f.authority,binding:f.binding,...records});}}};
 const result=await inspectMcpGuardianCheckpoints(deps,f.authority.scope);assert.equal(result.format,'bowerloom/mcp-guardian-provenance/v1beta2');assert.equal(result.checkpointClassification,'final-snapshot-verified');assert.equal(result.currentExternalState,'unverified');assert.equal(result.processIdentity,'unproved');assert.equal(result.finding,'HOLD_RECOVERY');
 const receipt=await collectMcpGuardianOperatorReceipt(deps,f.authority.scope);assert.equal(receipt.disposition,'PRESERVE_HOLD');for(const key of ['cleanupAuthorized','retryAuthorized','executionAuthorized'])assert.equal(receipt[key],false);assert.equal(reads,4);assert.equal(canonicalJson(f.authority),original);
 await writeFile(f.path,started(f));assert.equal((await inspectMcpGuardianCheckpoints(deps,f.authority.scope)).checkpointClassification,'rollback');
});
function checkpointDatabase(authority,binding){
 let records=null,pending,available=true,version=1,hook=null,ack=null;const queries=[];
 const client=Object.assign(new EventEmitter(),{async query(sql,p){queries.push(sql);await hook?.(sql,p);
  if(sql.startsWith('BEGIN')){pending=clone(records);return{rows:[]};}if(sql==='ROLLBACK')return{rows:[]};if(sql==='COMMIT'){records=clone(pending);await ack?.();return{rows:[]};}if(sql.startsWith('SET '))return{rows:[]};
  if(sql.includes('guardian_checkpoint_metadata')){if(!available)throw Error('PRIVATE_MISSING');return{rows:[{singleton:true,version}]};}
  if(sql.includes('guardian_checkpoints')){if(sql.startsWith('INSERT')){pending={version:1,evidence:JSON.parse(p[3]),checksum:p[4]};return{rows:[]};}return{rows:pending?[clone(pending)]:[]};}
  if(sql.includes('guardian_metadata')||sql.includes('.metadata'))return{rows:[{singleton:true,version:1}]};
  if(sql.includes('guardian_bindings'))return{rows:[{version:1,binding:clone(binding),checksum:hash(canonicalJson(binding))}]};
  if(sql.includes('.discoveries'))return{rows:[{version:1,state:clone(authority),checksum:hash(canonicalJson(authority))}]};throw Error('UNEXPECTED');
 },release(){}});
 return{store:new PostgresDiscoveryAuthorityStore({async connect(){return client;}},{schema:'bowerloom_mcp_checkpoint_test'}),queries,get records(){return records;},set available(v){available=v;},set version(v){version=v;},set hook(v){hook=v;},set ack(v){ack=v;}};
}
test('normal PostgreSQL checkpoint compares all authority bytes and invokes live checks under lock; reads create nothing',async t=>{
 const f=await signedFixture(t);f.authority.status='IN_FLIGHT';f.authority.reason=null;const db=checkpointDatabase(f.authority,f.binding);let checks=0;const before=canonicalJson(f.authority);
 const check=s=>{checks++;assert.equal(s.status,'IN_FLIGHT');if(s.stopRequested||s.grant.revoked)throw Error('PRIVATE_DENIED');};
 const cp=await db.store.recordGuardianCheckpoint(f.authority,null,started(f),check);assert.ok(checks>=3);assert.ok(db.queries.some(q=>q.includes('.discoveries')&&q.includes('FOR UPDATE')));assert.equal(db.queries.some(q=>q.startsWith('CREATE')||q.startsWith('UPDATE')),false);assert.equal(canonicalJson(f.authority),before);assert.equal((await db.store.readGuardianCheckpointEvidence(f.authority.scope)).checkpoints[0].revision,cp.revision);
 const expected=clone(f.authority);db.hook=sql=>{if(sql.includes('.discoveries'))f.authority.stopRequested=true;};await assert.rejects(db.store.recordGuardianCheckpoint(expected,cp.revision,started(f,4),check));assert.equal(db.records.evidence.checkpoints.length,1);
});
test('normal schema, async authorization, late commit acknowledgement and terminal audit remain fail closed',async t=>{
 const f=await signedFixture(t);f.authority.status='IN_FLIGHT';f.authority.reason=null;const db=checkpointDatabase(f.authority,f.binding);
 db.available=false;await assert.rejects(db.store.recordGuardianCheckpoint(f.authority,null,started(f),()=>{}));assert.equal(db.records,null);db.available=true;db.version=2;await assert.rejects(db.store.readGuardianCheckpointEvidence(f.authority.scope));db.version=1;
 await assert.rejects(db.store.recordGuardianCheckpoint(f.authority,null,started(f),async()=>{}));assert.equal(db.records,null);
 db.ack=()=>{throw Error('PRIVATE_LOST_ACK');};await assert.rejects(db.store.recordGuardianCheckpoint(f.authority,null,started(f),()=>{}),{code:'MCP_AUTHORITY_COMMIT_UNKNOWN'});db.ack=null;const cp=db.records.evidence.checkpoints[0];assert.equal(db.records.evidence.checkpoints.length,1);
 f.authority.stopRequested=true;f.authority.grant.revoked=true;f.authority.status='NEEDS_RECONCILIATION';f.authority.reason='STOP_REQUESTED';
 const terminalValue=terminal(f),before=canonicalJson(f.authority);
 await assert.rejects(db.store.recordGuardianClosed(f.authority,null,terminalValue.envelope,terminalValue.seal,terminalValue.witness,()=>{}));assert.equal(db.records.evidence.closure,null);
 const closed=await db.store.recordGuardianClosed(f.authority,cp.revision,terminalValue.envelope,terminalValue.seal,terminalValue.witness,()=>{});assert.equal(canonicalJson(f.authority),before);assert.equal(closed.revision,db.records.evidence.closure.revision);
 await assert.rejects(db.store.recordGuardianCheckpoint(f.authority,db.records.evidence.checkpoints.at(-1).revision,started(f,9),()=>{}));assert.equal(db.records.evidence.checkpoints.length,2);
});
test('inspector fences changed database evidence and never accepts fabricated observations',async t=>{
 const f=await signedFixture(t);await writeFile(f.path,started(f));const records=advanceGuardianCheckpoint(f.binding,{checkpoints:[],closure:null},null,started(f));let reads=0;
 const deps={stateRoot:f.root,trustedDarwinHost:true,store:{async readGuardianCheckpointEvidence(){reads++;return clone({authority:f.authority,binding:f.binding,...(reads===2?{checkpoints:[],closure:null}:records)});}}};
 await assert.rejects(inspectMcpGuardianCheckpoints(deps,f.authority.scope),{code:'MCP_GUARDIAN_CHECKPOINT_UNCERTAIN'});
 await assert.rejects(inspectMcpGuardianCheckpoints({...deps,observedAtMs:1},f.authority.scope));
});

test('lost final COMMIT acknowledgement returns uncertainty while immutable closure remains readable without changing authority',async t=>{
 const f=await signedFixture(t),db=checkpointDatabase(f.authority,f.binding),final=terminal(f),before=canonicalJson(f.authority);
 db.ack=()=>{throw Error('PRIVATE_FINAL_COMMIT_ACK');};
 await assert.rejects(db.store.recordGuardianClosed(f.authority,null,final.envelope,final.seal,final.witness,()=>{}),{code:'MCP_AUTHORITY_COMMIT_UNKNOWN'});
 const committed=clone(db.records);assert.equal(committed.evidence.checkpoints.length,1);assert.ok(committed.evidence.closure);assert.equal(canonicalJson(f.authority),before);
 db.ack=null;const fresh=await db.store.readGuardianCheckpointEvidence(f.authority.scope);assert.equal(canonicalJson(fresh.closure),canonicalJson(committed.evidence.closure));
 assert.equal(canonicalJson(await db.store.recordGuardianClosed(f.authority,null,final.envelope,final.seal,final.witness,()=>{})),canonicalJson(committed.evidence.closure));
 assert.deepEqual(db.records,committed);assert.equal(canonicalJson(f.authority),before);
 assert.equal(db.queries.some(sql=>sql.startsWith('UPDATE')&&sql.includes('.discoveries')),false);
 await assert.rejects(db.store.recordGuardianClosed(f.authority,null,final.envelope,final.seal,{...final.witness,observedAtMs:7001},()=>{}));assert.deepEqual(db.records,committed);
});
