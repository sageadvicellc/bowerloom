import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalJson} from '../../../dist/packages/contracts/src/index.js';
import {createDiscoveryProposal,createDiscoveryAuthorityState,mcpBindingRevision,planMcpContainerDiscoveryLaunch,McpConnectionError} from '../../../dist/packages/mcp-connections/src/index.js';
import {planMcpContainerRecovery} from '../../../dist/packages/mcp-connections/src/container-recovery.js';
const hash=v=>'sha256:'+createHash('sha256').update(v).digest('hex');
const refused=e=>e instanceof McpConnectionError&&e.code==='MCP_CONTAINER_RECOVERY_INPUT'&&e.message===e.code;
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
function changeJournal(f,mutate){const j=JSON.parse(f.journal.text);mutate(j);f.journal.text=canonicalJson(j);f.journal.expectedSha256=hash(f.journal.text);}
function noAuthority(r){assert.equal(r.cleanupAuthorized,false);assert.equal(r.retryAuthorized,false);assert.equal(r.executionAuthorized,false);assert.equal(r.liveVerified,false);assert.equal(r.hostRestartSafetyVerified,false);assert.equal(r.requiresReconciliation,true);assert.equal(r.authorityDisposition,'unchanged');assert.deepEqual(r.grants,[]);}
test('exact-ID absence is a revision-bound observation and never clears uncertain effects',()=>{
 const f=fixture(),before=canonicalJson(f),r=planMcpContainerRecovery(f);assert.equal(r.finding,'EXACT_ID_ABSENCE_OBSERVED');assert.equal(r.containerId,'c'.repeat(64));noAuthority(r);assert.equal(canonicalJson(f),before);
 assert.equal(r.evidenceRevision,hash(canonicalJson(f)));assert.deepEqual(planMcpContainerRecovery(f),r);
 f.observations.observedAtMs++;assert.notEqual(planMcpContainerRecovery(f).revision,r.revision);
});
test('known ID still present is distinguished from absence without claiming ownership or cleanup',()=>{
 const f=fixture();f.observations.container.state='present';f.observations.container.returnedCid='c'.repeat(64);const r=planMcpContainerRecovery(f);assert.equal(r.finding,'KNOWN_ID_PRESENT');noAuthority(r);
});
test('no journal or untrusted bytes cannot supply container identity',()=>{
 const f=fixture();f.journal={status:'missing',text:null,expectedSha256:null};assert.equal(planMcpContainerRecovery(f).finding,'HOLD_JOURNAL_MISSING');
 for(const source of [{status:'untrusted',text:'PRIVATE',expectedSha256:null},{...fixture().journal,expectedSha256:null}]){f.journal=source;const r=planMcpContainerRecovery(f);assert.equal(r.finding,'HOLD_JOURNAL_UNTRUSTED');assert.equal(r.containerId,null);assert.equal(JSON.stringify(r).includes('PRIVATE'),false);}
});
test('journal tamper, noncanonical bytes, duplicate fields and binding mismatch all remain held',()=>{
 const mutations=[f=>f.journal.text+=' ',f=>{f.journal.text='{"operationKey":"PRIVATE","operationKey":"PRIVATE"}';f.journal.expectedSha256=hash(f.journal.text);},f=>f.journal.expectedSha256=hash('different'),
  ...[j=>j.operationKey='sha256:'+'e'.repeat(64),j=>j.launchRevision='sha256:'+'e'.repeat(64),j=>j.launchOperationKey='sha256:'+'e'.repeat(64),j=>j.name='other',j=>j.deadlineMs++,j=>j.stage='COMPLETED',j=>j.guardianPid=0,j=>j.extra='PRIVATE',j=>delete j.lease,j=>j.lease.sequence=-1,j=>j.lease.expiresMonotonicMs=-1,j=>j.lease.lastRenewedAtMs=null,j=>j.cid='short'].map(change=>f=>changeJournal(f,change))];
 for(const mutate of mutations){const f=fixture();mutate(f);const r=planMcpContainerRecovery(f);assert.equal(r.finding,'HOLD_JOURNAL_INVALID');assert.equal(r.containerId,null);noAuthority(r);assert.equal(JSON.stringify(r).includes('PRIVATE'),false);}
});
test('missing create ID cannot be recovered from name, label, or an unrelated absence',()=>{
 const f=fixture();changeJournal(f,j=>{j.cid=null;j.attachPid=null;});f.observations.attach={pid:null,state:'not-recorded'};
 assert.equal(planMcpContainerRecovery(f).finding,'HOLD_UNKNOWN_IDENTITY');
 f.observations.container={requestedCid:null,state:'not-queried',returnedCid:null};assert.equal(planMcpContainerRecovery(f).finding,'HOLD_UNKNOWN_IDENTITY');
 f.observations.container.name='bowerloom-mcp-'+ 'a'.repeat(64);assert.throws(()=>planMcpContainerRecovery(f),refused);
});
test('active, unknown or mismatched process observations block even reported container absence',()=>{
 for(const role of ['guardian','attach'])for(const state of ['present','unknown']){const f=fixture();f.observations[role].state=state;const r=planMcpContainerRecovery(f);assert.equal(r.finding,state==='present'?'HOLD_PROCESS_ACTIVE':'HOLD_PROCESS_UNKNOWN');noAuthority(r);}
 for(const role of ['guardian','attach']){const f=fixture();f.observations[role].pid++;assert.equal(planMcpContainerRecovery(f).finding,'HOLD_PROCESS_MISMATCH');}
});
test('host restart ambiguity, future observations and old observations are held',()=>{
 for(const [mutate,want] of [[f=>f.observations.hostSession='unknown-or-restarted','HOLD_HOST_SESSION'],[f=>f.observations.observedAtMs=9002,'HOLD_STALE_OBSERVATION'],[f=>f.nowMs=14001,'HOLD_STALE_OBSERVATION']]){const f=fixture();mutate(f);assert.equal(planMcpContainerRecovery(f).finding,want);}
});
test('exact query ID and returned identity must match the journal; daemon uncertainty is not absence',()=>{
 const f=fixture();f.observations.container.requestedCid='d'.repeat(64);assert.equal(planMcpContainerRecovery(f).finding,'HOLD_CONTAINER_MISMATCH');
 f.observations.container={requestedCid:'c'.repeat(64),state:'present',returnedCid:'d'.repeat(64)};assert.equal(planMcpContainerRecovery(f).finding,'HOLD_CONTAINER_MISMATCH');
 f.observations.container={requestedCid:'c'.repeat(64),state:'unknown',returnedCid:null};assert.equal(planMcpContainerRecovery(f).finding,'HOLD_CONTAINER_UNKNOWN');
});
test('an active durable operation is held even if both process observations claim absence',()=>{
 const f=fixture();f.authority.status='IN_FLIGHT';f.authority.reason=null;assert.equal(planMcpContainerRecovery(f).finding,'HOLD_AUTHORITY');
});
test('expected launch and operation cannot be substituted, extended or used to mutate authority',()=>{
 for(const mutate of [f=>f.expectedJob.operationKey='sha256:'+'f'.repeat(64),f=>f.expectedJob.launchRevision='sha256:'+'f'.repeat(64),f=>f.synthetic=false,f=>f.authority.intent.ownerEpoch++,f=>f.cleanup=true,f=>f.journal.text='x'.repeat(8193)]){const f=fixture();mutate(f);assert.throws(()=>planMcpContainerRecovery(f),refused);}
 const f=fixture();f.expectedJob.deadlineMs=6001;assert.equal(planMcpContainerRecovery(f).finding,'HOLD_AUTHORITY');
});
test('getters and custom objects stay inert and private failures remain fixed',()=>{
 const f=fixture();let reads=0;Object.defineProperty(f.journal,'text',{get(){reads++;throw Error('PRIVATE');},enumerable:true});assert.throws(()=>planMcpContainerRecovery(f),refused);assert.equal(reads,0);
 for(const v of [null,[],new Date(),{...fixture(),nowMs:Infinity}])assert.throws(()=>planMcpContainerRecovery(v),refused);
});

test('unrecorded attach after a known create stays held because a crash may hide its spawned PID',()=>{
 const f=fixture();changeJournal(f,j=>{j.stage='CREATED';j.attachPid=null;});f.observations.attach={pid:null,state:'not-recorded'};
 assert.equal(planMcpContainerRecovery(f).finding,'HOLD_PROCESS_UNKNOWN');
});

test('fresh-looking observations before intent start or any recorded wall event remain uncertain',()=>{
 const initial=fixture();initial.observations.observedAtMs=1001;initial.nowMs=1002;
 assert.equal(planMcpContainerRecovery(initial).finding,'HOLD_TEMPORAL_INCONSISTENCY');
 for(const event of ['lastRenewedAtMs','stopRequestedAtMs','containerAbsentAtMs','attachReapedAtMs']){
   const f=fixture();changeJournal(f,j=>{j.lease[event]=9002;});
   const r=planMcpContainerRecovery(f);assert.equal(r.finding,'HOLD_TEMPORAL_INCONSISTENCY');noAuthority(r);
 }
});
test('recorded wall-clock reversal stays held without comparing guardian monotonic time',()=>{
 for(const change of [j=>j.lease.lastRenewedAtMs=1999,j=>j.lease.stopRequestedAtMs=2500,
   j=>j.lease.containerAbsentAtMs=4500,j=>j.lease.attachReapedAtMs=2500]){
   const f=fixture();changeJournal(f,change);assert.equal(planMcpContainerRecovery(f).finding,'HOLD_TEMPORAL_INCONSISTENCY');
 }
 const f=fixture();changeJournal(f,j=>{j.lease.expiresMonotonicMs=999999999;});
 assert.equal(planMcpContainerRecovery(f).finding,'EXACT_ID_ABSENCE_OBSERVED');
});
