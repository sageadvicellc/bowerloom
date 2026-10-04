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
import {collectMcpContainerRecovery} from '../../../dist/packages/mcp-connections/src/container-recovery-collector.js';
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

import {planMcpContainerRecovery} from '../../../dist/packages/mcp-connections/src/container-recovery.js';
import {createMcpContainerRecoveryReceipt,validateMcpContainerRecoveryReceipt} from '../../../dist/packages/mcp-connections/src/container-recovery-receipt.js';
import {PostgresDiscoveryAuthorityStore} from '../../../dist/packages/mcp-connections/src/authority-postgres.js';
function collection(authority=fixture().authority){
 const input=fixture(); input.authority=authority;input.expectedJob.operationKey=authority.operationKey;input.observations.hostSession='unknown-or-restarted';input.journal={status:'missing',text:null,expectedSha256:null};
 input.observations.guardian={pid:null,state:'not-recorded'};input.observations.attach={pid:null,state:'not-recorded'};input.observations.container={requestedCid:null,returnedCid:null,state:'not-queried'};
 const planner=planMcpContainerRecovery(input);
 const body={format:'bowerloom/mcp-container-recovery-collection/v1beta1',evidenceScope:'local-read-only-observations',operationKey:authority.operationKey,authorityRevision:hash(canonicalJson(authority)),journalOrigin:'unverified-local-user-file',journal:{status:'missing',sha256:null,bytes:0},observations:{guardian:{...input.observations.guardian,observedAtMs:9000},attach:{...input.observations.attach,observedAtMs:9000},container:{...input.observations.container,observedAtMs:9000,commandClosed:null}},planner,authorityUnchangedAtFinalCheck:true,journalUnchangedAtFinalCheck:true,localUserTrustRequired:true,cleanupAuthorized:false,retryAuthorized:false,executionAuthorized:false,hostRestartSafetyVerified:false};
 return {...body,revision:hash(canonicalJson(body))};
}
const clone=v=>JSON.parse(JSON.stringify(v));
function fake(){
 const authority=fixture().authority,queries=[],rows=new Map();let metadata=true,version=1,pending,commitHook,queryHook,discarded=false;
 const key=p=>p.slice(0,4).join('|');
 const client={async query(sql,p){queries.push({sql,p});await queryHook?.(sql,p);
  if(sql.startsWith('BEGIN')){pending=new Map(rows);return{rows:[]};}
  if(sql==='ROLLBACK'){pending=null;return{rows:[]};}
  if(sql==='COMMIT'){if(pending){rows.clear();for(const[k,v]of pending)rows.set(k,v);}pending=null;await commitHook?.();return{rows:[]};}
  if(sql.startsWith('SET '))return{rows:[]};
  if(sql.includes('recovery_metadata')){
   if(sql.startsWith('CREATE')){assert.equal(metadata,false);metadata=true;return{rows:[]};}
   if(sql.startsWith('INSERT'))return{rows:[]};
   if(!metadata)throw Error('PRIVATE_MISSING_TABLE');return{rows:[{singleton:true,version}]};
  }
  if(sql.startsWith('CREATE TABLE')&&sql.includes('recovery_receipts'))return{rows:[]};
  if(sql.includes('.metadata'))return{rows:[{singleton:true,version:1}]};
  if(sql.includes('.discoveries')){assert.match(sql,/SELECT version,state,checksum/);return{rows:[{version:1,state:clone(authority),checksum:hash(canonicalJson(authority))}]};}
  if(sql.startsWith('INSERT')&&sql.includes('recovery_receipts')){if(!pending.has(key(p)))pending.set(key(p),{version:1,receipt:JSON.parse(p[4]),checksum:p[5]});return{rows:[]};}
  if(sql.startsWith('SELECT')&&sql.includes('recovery_receipts'))return{rows:pending?.has(key(p))?[clone(pending.get(key(p)))]:rows.has(key(p))?[clone(rows.get(key(p)))]:[]};
  throw Error('UNEXPECTED SQL '+sql);
 },release(discard){discarded ||= !!discard;}};
 const store=new PostgresDiscoveryAuthorityStore({async connect(){return client;}},{schema:'bowerloom_mcp_receipt_test'});
 return{store,authority,queries,rows,set metadata(v){metadata=v;},set version(v){version=v;},set commitHook(v){commitHook=v;},set queryHook(v){queryHook=v;},get discarded(){return discarded;}};
}
test('receipt is deterministic, scope-bound historical evidence with no new permission',()=>{
 const f=fixture(),c=collection(f.authority),a=createMcpContainerRecoveryReceipt(f.authority,c),b=createMcpContainerRecoveryReceipt(f.authority,c);
 assert.deepEqual(a,b);assert.equal(a.hostSession,'unknown');assert.equal(a.journalOrigin,'unverified-local-user-file');assert.equal(a.collection.planner.finding,'HOLD_HOST_SESSION');assert.equal(a.cleanupAuthorized,false);assert.equal(a.retryAuthorized,false);assert.equal(a.executionAuthorized,false);
 assert.deepEqual(JSON.parse(JSON.stringify(validateMcpContainerRecoveryReceipt(a,f.authority.scope))),JSON.parse(JSON.stringify(a)));
 assert.throws(()=>validateMcpContainerRecoveryReceipt(a,{...f.authority.scope,workspaceId:'other'}));
});
test('forged permissions, revisions, fields, scopes, prototype/accessors and bounds are refused',async t=>{
 const f=fixture(),base=createMcpContainerRecoveryReceipt(f.authority,collection(f.authority));
 for(const mutate of [r=>r.cleanupAuthorized=true,r=>r.hostSession='same-host-session',r=>r.journalOrigin='trusted',r=>r.collection.journal.sha256='sha256:'+'f'.repeat(64),r=>r.collection.observations.guardian.pid=1,r=>r.collection.planner.finding='KNOWN_ID_PRESENT',r=>r.collection.planner.grants.push('cleanup'),r=>r.extra='x',r=>r.scope.taskId='other',r=>r.revision='bad',r=>r.collection.operationKey='sha256:'+'f'.repeat(64),r=>r.collection.journal.bytes=9000,r=>r.extra='x'.repeat(17000)])await t.test(String(mutate),()=>{const r=clone(base);mutate(r);assert.throws(()=>validateMcpContainerRecoveryReceipt(r,f.authority.scope));});
 const getter=clone(base);Object.defineProperty(getter,'revision',{get(){throw Error('getter executed');}});assert.throws(()=>validateMcpContainerRecoveryReceipt(getter,f.authority.scope),e=>e.message!=='getter executed');
 assert.throws(()=>validateMcpContainerRecoveryReceipt(Object.create(base),f.authority.scope));
});
test('even recomputed integrity hashes cannot grant provenance or effects',()=>{
 const f=fixture(),base=collection(f.authority);base.planner.finding='EXACT_ID_ABSENCE_OBSERVED';let{revision,...body}=base.planner;base.planner.revision=hash(canonicalJson(body));({revision,...body}=base);base.revision=hash(canonicalJson(body));assert.throws(()=>createMcpContainerRecoveryReceipt(f.authority,base));
 const drift=clone(f.authority);drift.grant.revoked=true;assert.throws(()=>createMcpContainerRecoveryReceipt(drift,collection(f.authority)));
});
test('store locks exact authority and commits one receipt without updating authority',async()=>{
 const f=fake(),before=canonicalJson(f.authority),c=collection(f.authority);let checks=0;const check=()=>{checks++;};
 const r=await f.store.recordRecoveryReceipt(f.authority,c,check);await f.store.recordRecoveryReceipt(f.authority,c,check);assert.equal(f.rows.size,1);assert.equal(canonicalJson(f.authority),before);assert.ok(checks>=12);
 assert.deepEqual(await f.store.readRecoveryReceipt(f.authority.scope,r.revision),r);assert.ok(f.queries.some(q=>q.sql.includes('.discoveries')&&q.sql.includes('FOR UPDATE')));assert.equal(f.queries.some(q=>q.sql.startsWith('UPDATE')),false);assert.equal(f.queries.some(q=>q.sql.startsWith('CREATE')),false);
});
test('explicit optional initialization is separate from all read paths and existing schema remains1',async()=>{
 const f=fake();f.metadata=false;await assert.rejects(f.store.recordRecoveryReceipt(f.authority,collection(f.authority),()=>{}));assert.equal(f.rows.size,0);assert.equal(f.queries.some(q=>q.sql.startsWith('CREATE')),false);
 await f.store.initializeRecoveryReceipts();assert.equal(f.queries.filter(q=>q.sql.startsWith('CREATE TABLE')).length,2);await f.store.recordRecoveryReceipt(f.authority,collection(f.authority),()=>{});f.version=2;await assert.rejects(f.store.readRecoveryReceipt(f.authority.scope,[...f.rows.values()][0].receipt.revision));assert.deepEqual(await f.store.read(f.authority.scope),f.authority);
});
test('drift before lock and replay into another scope refuse without inserting',async()=>{
 const f=fake(),expected=clone(f.authority),c=collection(expected);f.authority.grant.revoked=true;await assert.rejects(f.store.recordRecoveryReceipt(expected,c,()=>{}));assert.equal(f.rows.size,0);
 const other=clone(expected);other.scope.taskId='other';await assert.rejects(f.store.recordRecoveryReceipt(other,c,()=>{}));assert.equal(f.rows.size,0);
});
test('duplicate corrupted record and historical row corruption are refused',async t=>{
 for(const mode of ['checksum','body','version','revision'])await t.test(mode,async()=>{const f=fake(),c=collection(f.authority),r=await f.store.recordRecoveryReceipt(f.authority,c,()=>{}),row=[...f.rows.values()][0];
 if(mode==='checksum')row.checksum='sha256:'+'0'.repeat(64);if(mode==='body'){row.receipt.cleanupAuthorized=true;row.checksum=hash(canonicalJson(row.receipt));}if(mode==='version')row.version=2;if(mode==='revision'){row.receipt.revision='sha256:'+'0'.repeat(64);row.checksum=hash(canonicalJson(row.receipt));}
 await assert.rejects(f.store.readRecoveryReceipt(f.authority.scope,r.revision));await assert.rejects(f.store.recordRecoveryReceipt(f.authority,c,()=>{}));assert.equal(f.rows.size,1);
 });
});
test('lost COMMIT acknowledgement stays uncertain but exact repetition does not duplicate',async()=>{
 const f=fake(),c=collection(f.authority),before=canonicalJson(f.authority);f.commitHook=()=>{throw Error('PRIVATE_ACK');};await assert.rejects(f.store.recordRecoveryReceipt(f.authority,c,()=>{}),{code:'MCP_AUTHORITY_COMMIT_UNKNOWN'});assert.equal(f.rows.size,1);assert.equal(f.discarded,true);f.commitHook=null;await f.store.recordRecoveryReceipt(f.authority,c,()=>{});assert.equal(f.rows.size,1);assert.equal(canonicalJson(f.authority),before);
});
test('expiry after INSERT rolls back before COMMIT; database failure never reports success',async()=>{
 const f=fake();let active=true;f.queryHook=sql=>{if(sql.startsWith('INSERT'))active=false;};await assert.rejects(f.store.recordRecoveryReceipt(f.authority,collection(f.authority),()=>{if(!active)throw Error('TIMEOUT');}));assert.equal(f.rows.size,0);assert.equal(f.queries.some(q=>q.sql==='COMMIT'),false);
 f.queryHook=()=>{throw Error('PRIVATE_DATABASE');};await assert.rejects(f.store.recordRecoveryReceipt(f.authority,collection(f.authority),()=>{}));assert.equal(f.rows.size,0);
});
test('nested receipt invariants reject malicious bodies even after every hash is recomputed',async t=>{
 const f=fixture();
 for(const mutate of [r=>r.collection.observations.guardian.pid=1,r=>r.collection.observations.container.state='absent',r=>r.collection.journal.bytes=8193,r=>r.collection.planner.grants.push('cleanup'),r=>r.collection.planner.observedAtMs=8000,r=>r.collection.localUserTrustRequired=false,r=>r.recordKind='reconciliation-complete'])await t.test(String(mutate),()=>{
  const r=clone(createMcpContainerRecoveryReceipt(f.authority,collection(f.authority)));mutate(r);
  for(const object of [r.collection.planner,r.collection,r]){const{revision,...body}=object;object.revision=hash(canonicalJson(body));}
  assert.throws(()=>validateMcpContainerRecoveryReceipt(r,f.authority.scope));
 });
});
test('late commit acknowledgement never becomes a successful store return',async()=>{
 const f=fake();let active=true;f.commitHook=()=>{active=false;};
 await assert.rejects(f.store.recordRecoveryReceipt(f.authority,collection(f.authority),()=>{if(!active)throw Error('EXPIRED');}),{code:'MCP_AUTHORITY_COMMIT_UNKNOWN'});
 assert.equal(f.rows.size,1);assert.equal(f.discarded,true);assert.equal(f.authority.status,'NEEDS_RECONCILIATION');
});
