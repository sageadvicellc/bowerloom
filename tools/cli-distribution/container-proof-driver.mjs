import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,realpathSync,chmodSync,mkdirSync,existsSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash,randomBytes} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';

/** Shared synthetic scenarios. Call only after the host has verified runtime provenance. */
export function registerContainerPostgresProof({runtime,pg,moduleUrl,pgUrl,fixturesDir,installedGuard}) {
 const {DiscoveryAuthorityController,PostgresDiscoveryAuthorityStore,createDiscoveryProposal,createDiscoveryAuthorityState,mcpBindingRevision,planMcpContainerDiscoveryLaunch,createMcpContainerDiscoveryFactory}=runtime;
const enabled=process.env.BOWERLOOM_MCP_CONTAINER_POSTGRES_PROOF==='trellis-alpha-proof@127.0.0.1:56582';
const canonical=value=>JSON.stringify(value&&typeof value==='object'?(Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))]))):value);
const digest=s=>'sha256:'+createHash('sha256').update(s).digest('hex');
const read=part=>JSON.parse(readFileSync(join(fixturesDir,`stdio-${part}.json`),'utf8'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
async function bounded(promise,ms=12000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('SYNTHETIC_BOUND_EXCEEDED')),ms);})]);}finally{clearTimeout(timer);}}

test('approved container discovery composes with PostgreSQL and independent cleanup',{skip:!enabled,timeout:240000},async t=>{
 const evidence=resolve(process.env.BOWERLOOM_MCP_CONTAINER_EVIDENCE);
 const blobs=Object.fromEntries(['Index','Manifest','Config'].map(k=>[`image${k}Json`,readFileSync(join(evidence,`image-${k.toLowerCase()}.json`),'utf8')]));
 const image=JSON.parse(blobs.imageConfigJson),directory=realpathSync(mkdtempSync(join(installedGuard?.proofRoot??tmpdir(),'bowerloom-container-db-')));chmodSync(directory,0o700);
 const provenanceUrl=new URL('./container-guardian-provenance.js',moduleUrl).href;
 const stateRoot=join(directory,'state');mkdirSync(stateRoot,{mode:0o700});
 const credentialsPath=realpathSync(process.env.TRELLIS_BROKER_CREDENTIALS_FILE),credentials=JSON.parse(readFileSync(credentialsPath,'utf8'));
 const database=`bowerloom_container_${randomBytes(8).toString('hex')}`,schema='bowerloom_mcp_container';
 const connection={host:'127.0.0.1',port:56582,user:'postgres',database,ssl:false,connectionTimeoutMillis:3000,idleTimeoutMillis:1000,application_name:'bowerloom_container_proof'};
 const admin=new pg.Client({...connection,database:'postgres',password:credentials.POSTGRES_PASSWORD});
 const pool=new pg.Pool({...connection,password:credentials.POSTGRES_PASSWORD,max:3});pool.on('error',()=>{});
 const store=new PostgresDiscoveryAuthorityStore(pool,{schema});const runs=[],parents=[];let created=false;
 const identity={async authenticate(value){if(value!=='synthetic-owner')throw Error('SYNTHETIC_IDENTITY');return {subject:'hanna-dummy',proofRef:'synthetic:proof',expiresAtMs:Date.now()+60000};}};
 const dockerEnv={HOME:process.env.HOME,PATH:'/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'};
 const docker=args=>new Promise((resolve,reject)=>{
  const child=spawn('/usr/local/bin/docker',['--context','desktop-linux',...args],{env:dockerEnv,stdio:['ignore','pipe','pipe']});
  let out='',err='',failure;const timer=setTimeout(()=>{failure=Error('SYNTHETIC_DOCKER_TIMEOUT');child.kill('SIGKILL');},5000);
  for(const [stream,key] of [[child.stdout,'out'],[child.stderr,'err']])stream.on('data',b=>{if(key==='out')out+=b;else err+=b;if(Buffer.byteLength(out)+Buffer.byteLength(err)>65536){failure=Error('SYNTHETIC_DOCKER_BOUND');child.kill('SIGKILL');}});
  child.once('error',e=>failure=e);child.once('close',code=>{clearTimeout(timer);failure?reject(failure):resolve({code,out,err});});
 });
 function envelope(run){return existsSync(run.journal)?JSON.parse(readFileSync(run.journal,'utf8')):null;}
 function journal(run){const value=envelope(run);return value?.format==='bowerloom/mcp-container-journal/v1beta2'?value.body:value;}
 async function waitStage(run,stage){const end=performance.now()+10000;while(performance.now()<end){const j=journal(run);if(j?.stage===stage){if(stage==='STARTED'&&installedGuard){const command=spawnSync('/bin/ps',['-o','command=','-p',String(j.guardianPid)],{encoding:'utf8',timeout:1000,maxBuffer:8192});assert.equal(command.status,0);assert.ok(command.stdout.includes(installedGuard.guardianPath));run.guardianProvenance={pid:j.guardianPid,path:installedGuard.guardianPath,command:command.stdout.trim(),sha256:digest(readFileSync(installedGuard.guardianPath)),loaderHook:false};}return j;}if(j?.stage==='UNCERTAIN')assert.fail('Unexpected uncertain journal: '+j.reason);await wait(25);}assert.fail('Journal stage not reached: '+stage);}
 async function absent(cid){const r=await docker(['container','inspect',cid]);assert.notEqual(r.code,0);assert.match(r.err,/No such (object|container)/);}
 async function descendant(cid){let result;const end=performance.now()+2000;while(performance.now()<end){result=await docker(['container','top',cid,'-eo','pid,ppid,pgid,sid,args']);if(result.code===0&&result.out.includes('/bin/sleep 120'))break;await wait(25);}assert.equal(result?.code,0);const row=result.out.split('\n').find(x=>x.includes('/bin/sleep 120'));assert.ok(row);const fields=row.trim().split(/\s+/);assert.equal(fields[0],fields[2]);assert.equal(fields[0],fields[3]);return result;}
 async function cleaned(run){const j=await waitStage(run,'REAPED');assert.match(j.cid,/^[a-f0-9]{64}$/);await absent(j.cid);run.finalJournal=j;run.signedEnvelope=envelope(run);return j;}
 function controller(selectedStore=store,open=createMcpContainerDiscoveryFactory({stateRoot,trustedDockerDesktop:true,requestTimeoutMs:15000,sessionTimeoutMs:20000,cleanupTimeoutMs:9000})){
  return new DiscoveryAuthorityController({store:selectedStore,identity,open});
 }
 async function fixture(id,mode='normal',timeoutMs=20000){
  const scope={workspaceId:'synthetic-labs',runId:id,taskId:'container-discovery'};
  const input={declaration:read('declaration'),binding:read('binding'),catalog:read('catalog'),synthetic:true};
  input.binding.transport={kind:'stdio',executable:'/usr/local/bin/node',workingDirectory:'/tmp',secretReferences:[]};input.catalog.bindingRevision=mcpBindingRevision(input.binding);
  const source=`import {createInterface} from 'node:readline';import {spawn} from 'node:child_process';if(process.env.BOWERLOOM_PROOF_CREDENTIALS)process.exit(99);const mode=${JSON.stringify(mode)};if(mode==='hang'){const c=spawn('/bin/sleep',['120'],{detached:true,stdio:'ignore'});c.unref();process.on('SIGTERM',()=>{});setInterval(()=>{},1000);}const tools=${JSON.stringify(input.catalog.tools)};createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(mode==='hang'||r.method==='notifications/initialized')return;let result=r.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:${JSON.stringify(input.binding.serverIdentity)}}:{tools};if(mode==='drift'&&r.method==='tools/list')result.tools[0].inputSchema.description='changed';process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');});`;
  const launch={...blobs,synthetic:true,spec:{format:'bowerloom/mcp-container-launch/v1beta1',operationKey:digest(id+randomBytes(16).toString('hex')),
   imageIndexDigest:digest(blobs.imageIndexJson),imageManifestDigest:digest(blobs.imageManifestJson),imageConfigDigest:digest(blobs.imageConfigJson),platform:`linux/${image.architecture}`,
   entrypoint:'/usr/local/bin/node',args:['--input-type=module','-e',source],workingDirectory:'/tmp',user:{uid:10001,gid:10001},imageEnvironment:image.config.Env,
   limits:{cpuMillis:250,memoryBytes:134217728,pids:32,scratchBytes:8388608,shmBytes:1048576}}};
  const launchPlan=planMcpContainerDiscoveryLaunch(launch);
  const proposal=createDiscoveryProposal({scope,requestId:id,ownerEpoch:1,input,timeoutMs,effect:{kind:'container-stdio',launch,launchRevision:launchPlan.revision}});
  const now=Date.now(),initial=createDiscoveryAuthorityState(proposal,{scope,ownerSubject:'hanna-dummy',ownerEpoch:1,approverSubjects:['hanna-dummy'],readyAtMs:now-100,leaseExpiresAtMs:now+60000,revoked:false});
  await store.seed(initial);const c=controller(),run={id,scope,proposal,operationKey:initial.operationKey,controller:c,journal:join(stateRoot,initial.operationKey.slice(7),'journal.json'),launchPlan};runs.push(run);return run;
 }
 async function approve(run){await run.controller.approve(run.scope,{revision:run.proposal.revision,expiresAtMs:Date.now()+30000},'synthetic-owner');}
 const parentFile=join(directory,'controller.mjs');
 const childGuard=installedGuard?`const {installProofResolutionGuard}=await import(${JSON.stringify(installedGuard.moduleUrl)});installProofResolutionGuard(${JSON.stringify(installedGuard.configPath)},{provenanceFile:process.argv[2]+'.provenance.jsonl'});`:'';
 writeFileSync(parentFile,`import {readFileSync,writeFileSync} from 'node:fs';${childGuard}const {default:pg}=await import(${JSON.stringify(pgUrl)});const {DiscoveryAuthorityController,PostgresDiscoveryAuthorityStore,createMcpContainerDiscoveryFactory}=await import(${JSON.stringify(moduleUrl)});const c=JSON.parse(readFileSync(process.argv[2],'utf8'));const secret=JSON.parse(readFileSync(process.env.BOWERLOOM_PROOF_CREDENTIALS,'utf8'));const pool=new pg.Pool({...c.connection,password:secret.POSTGRES_PASSWORD,max:2});pool.on('error',()=>{});const store=new PostgresDiscoveryAuthorityStore(pool,{schema:c.schema});const ctl=new DiscoveryAuthorityController({store,identity:{async authenticate(){return {subject:'hanna-dummy',proofRef:'synthetic:proof',expiresAtMs:Date.now()+60000};}},open:createMcpContainerDiscoveryFactory({stateRoot:c.stateRoot,trustedDockerDesktop:true,requestTimeoutMs:15000,sessionTimeoutMs:20000,cleanupTimeoutMs:9000})});try{await ctl.dispatch(c.scope,'synthetic-owner');writeFileSync(c.result,JSON.stringify({unexpectedSuccess:true}));}catch{writeFileSync(c.result,JSON.stringify({held:true}));}finally{await pool.end();}`,{mode:0o600});
 const inspectFile=join(directory,'inspect.mjs');
 writeFileSync(inspectFile,`import {readFileSync,writeFileSync} from 'node:fs';${childGuard}const {default:pg}=await import(${JSON.stringify(pgUrl)});const {PostgresDiscoveryAuthorityStore}=await import(${JSON.stringify(moduleUrl)});const {inspectMcpGuardianProvenance}=await import(${JSON.stringify(provenanceUrl)});const c=JSON.parse(readFileSync(process.argv[2],'utf8'));const secret=JSON.parse(readFileSync(process.env.BOWERLOOM_PROOF_CREDENTIALS,'utf8'));const pool=new pg.Pool({...c.connection,password:secret.POSTGRES_PASSWORD,max:2});const store=new PostgresDiscoveryAuthorityStore(pool,{schema:c.schema});try{writeFileSync(c.result,JSON.stringify({report:await inspectMcpGuardianProvenance({store,stateRoot:c.stateRoot,trustedDarwinHost:true},c.scope)}));}catch(error){writeFileSync(c.result,JSON.stringify({refused:error.code??error.message}));}finally{await pool.end();}`,{mode:0o600});
 async function inspectFresh(run,label){
  const settings=join(directory,run.id+'-'+label+'.json'),result=settings+'.result';
  writeFileSync(settings,JSON.stringify({connection,schema,scope:run.scope,stateRoot,result}),{mode:0o600});
  const child=spawn(realpathSync(process.execPath),[inspectFile,settings],{env:{BOWERLOOM_PROOF_CREDENTIALS:credentialsPath},stdio:'ignore'});
  const exited=once(child,'exit');parents.push({parent:child,exited});await bounded(exited,20000);
  assert.equal(child.exitCode,0);const observation=JSON.parse(readFileSync(result,'utf8'));
  if(installedGuard){const records=readFileSync(settings+'.provenance.jsonl','utf8').trim().split('\n').map(line=>JSON.parse(line));assert.ok(records.some(item=>item.event==='resolved'&&item.url===provenanceUrl));run.inspectorProvenance=records;}
  return observation;
 }
 const databaseFailureFile=join(directory,'database-failure.mjs');
 writeFileSync(databaseFailureFile,`import {readFileSync,writeFileSync} from 'node:fs';${childGuard}const {default:pg}=await import(${JSON.stringify(pgUrl)});const {PostgresDiscoveryAuthorityStore}=await import(${JSON.stringify(moduleUrl)});const c=JSON.parse(readFileSync(process.argv[2],'utf8'));const secret=JSON.parse(readFileSync(process.env.BOWERLOOM_PROOF_CREDENTIALS,'utf8'));const pool=new pg.Pool({...c.connection,password:secret.POSTGRES_PASSWORD,max:1});pool.on('error',()=>{});const admin=new pg.Client({...c.connection,database:'postgres',password:secret.POSTGRES_PASSWORD});await admin.connect();let fired=false;const wrapped={async connect(){const client=await pool.connect(),query=client.query.bind(client);client.query=async(...args)=>{const result=await query(...args);if(!fired&&args[0]===c.trigger){fired=true;const killed=await admin.query('SELECT pg_terminate_backend(pid) AS killed FROM pg_stat_activity WHERE pid=$1 AND datname=$2',[client.processID,c.connection.database]);if(killed.rows.length!==1||!killed.rows[0].killed)throw Error('SYNTHETIC_TERMINATION_REFUSED');await new Promise(resolve=>setTimeout(resolve,50));}return result;};return client;}};const store=new PostgresDiscoveryAuthorityStore(wrapped,{schema:c.schema});try{await store.read(c.scope);writeFileSync(c.result,JSON.stringify({unexpectedSuccess:true,fired}));}catch(error){writeFileSync(c.result,JSON.stringify({refused:error.code??error.message,fired}));}finally{await pool.end();await admin.end();}`,{mode:0o600});
 function assertHeld(report,signature='verified-historical'){
  assert.equal(report.signature,signature);assert.equal(report.finding,'HOLD_RECOVERY');
  assert.equal(report.snapshotFreshness,'unproved');assert.equal(report.processIdentity,'unproved');
  for(const key of ['cleanupAuthorized','retryAuthorized','executionAuthorized','hostRestartSafetyVerified'])assert.equal(report[key],false);
 }
 try{
  await admin.connect();await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;await store.createSchema();await store.initializeGuardianBindings();
  await t.test('missing or changed approval creates no local operation',async()=>{
   const run=await fixture('unapproved');await assert.rejects(run.controller.dispatch(run.scope,'synthetic-owner'));
   await assert.rejects(run.controller.approve(run.scope,{revision:'sha256:'+'0'.repeat(64),expiresAtMs:Date.now()+30000},'synthetic-owner'));
   assert.equal(existsSync(run.journal),false);assert.equal(readdirSync(stateRoot).length,0);
  });
  await t.test('actual discovery completes once and saved completion never recreates the container',async()=>{
   const run=await fixture('normal');await approve(run);const result=await run.controller.dispatch(run.scope,'synthetic-owner');assert.equal(result.status,'COMPLETED');assert.equal(result.result.toolCalls,0);
   const j=await cleaned(run);assert.equal(j.launchRevision,run.launchPlan.revision);assert.equal(j.operationKey,run.operationKey);
   const snapshot=readFileSync(run.journal,'utf8');assert.equal((await controller().dispatch(run.scope,'synthetic-owner')).status,'COMPLETED');assert.equal(readFileSync(run.journal,'utf8'),snapshot);
  });
  for(const [label,trigger]of [['between-queries',"SET LOCAL synchronous_commit='on'"],['commit-ack','COMMIT']])await t.test('checked-out database error '+label,async()=>{
   const run=runs.find(item=>item.id==='normal'),settings=join(directory,label+'.json'),result=settings+'.result';
   writeFileSync(settings,JSON.stringify({connection,schema,scope:run.scope,trigger,result}),{mode:0o600});
   const child=spawn(realpathSync(process.execPath),[databaseFailureFile,settings],{env:{BOWERLOOM_PROOF_CREDENTIALS:credentialsPath},stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(0,16384);});const exited=once(child,'exit');parents.push({parent:child,exited});await bounded(exited,15000);
   const record={label,pid:child.pid,exitCode:child.exitCode,stderr,result:existsSync(result)?JSON.parse(readFileSync(result,'utf8')):null};(run.databaseFailureCases??=[]).push(record);
   assert.equal(child.exitCode,0,'Controller must contain a checked-out PostgreSQL client error');assert.equal(record.result.fired,true);assert.equal(record.result.unexpectedSuccess,undefined);assert.match(record.result.refused,/^MCP_AUTHORITY_(DATABASE_ERROR|ROLLBACK_FAILED|COMMIT_UNKNOWN)$/);if(label==='commit-ack')assert.equal(record.result.refused,'MCP_AUTHORITY_COMMIT_UNKNOWN');
  });
  await t.test('fresh process proves historical guardian origin and refuses tampered signed records',async()=>{
   const run=runs.find(item=>item.id==='normal'),original=readFileSync(run.journal,'utf8');
   const saved=await store.readGuardianEvidence(run.scope);run.publicGuardianBinding=saved.binding;
   assert.equal(saved.binding.revision,run.signedEnvelope.bindingRevision);assert.equal(saved.binding.descriptor.guardianPid,run.finalJournal.guardianPid);
   run.freshInspection=await inspectFresh(run,'genuine');assertHeld(run.freshInspection.report);assert.equal(run.freshInspection.report.bootSession,'matches');
   try{
    const tampered=JSON.parse(original);tampered.body.reason='TAMPERED';writeFileSync(run.journal,canonical(tampered));
    const changed=await inspectFresh(run,'tampered');assert.equal(changed.refused,'MCP_GUARDIAN_PROVENANCE_UNCERTAIN');run.tamperedInspection=changed;
    writeFileSync(run.journal,canonical(JSON.parse(original).body));const legacy=await inspectFresh(run,'legacy');assertHeld(legacy.report,'legacy-or-unavailable');run.legacyInspection=legacy;
   }finally{writeFileSync(run.journal,original);}
  });
  for(const mode of ['binding-revoked','binding-stop','binding-expired','binding-database-error','binding-lost-ack'])await t.test(mode,async()=>{
   const run=await fixture(mode);await approve(run);let seen=false;const eventStart=Math.floor(Date.now()/1000);
   const wrapper={transaction:store.transaction.bind(store),async bindContainerGuardian(expected,descriptor,live){seen=true;
    if(mode==='binding-revoked')await store.transaction(run.scope,state=>{state.grant.revoked=true;});
    if(mode==='binding-stop')await controller().stop(run.scope,'synthetic-owner');
    if(mode==='binding-expired')await store.transaction(run.scope,state=>{state.approval.expiresAtMs=Date.now()-1;});
    if(mode==='binding-database-error')throw Error('SYNTHETIC_BINDING_DATABASE_ERROR');
    const binding=await store.bindContainerGuardian(expected,descriptor,live);
    if(mode==='binding-lost-ack')throw Error('SYNTHETIC_BINDING_LOST_ACK');return binding;
   }};
   await assert.rejects(controller(wrapper).dispatch(run.scope,'synthetic-owner'));assert.equal(seen,true);
   assert.equal(journal(run)?.cid??null,null);const inspection=await docker(['container','inspect','bowerloom-mcp-'+run.launchPlan.spec.operationKey.slice(7)]);assert.notEqual(inspection.code,0);assert.match(inspection.err,/No such (object|container)/);
   const events=await docker(['events','--since',String(eventStart),'--until',String(Math.floor(Date.now()/1000)+1),'--filter','type=container','--filter','event=create','--filter','label=ai.bowerloom.mcp.operation='+run.launchPlan.spec.operationKey,'--format','{{json .}}']);assert.equal(events.code,0);assert.equal(events.err,'');assert.equal(events.out.trim(),'');run.noCreationEvents={since:eventStart,operationKey:run.launchPlan.spec.operationKey,events:[]};
   const saved=await store.readGuardianEvidence(run.scope);assert.equal(saved.binding!==null,mode==='binding-lost-ack');run.publicGuardianBinding=saved.binding;
   await assert.rejects(controller().dispatch(run.scope,'synthetic-owner'));
  });
  await t.test('catalog drift keeps a durable hold and removes the container',async()=>{
   const run=await fixture('drift','drift');await approve(run);await assert.rejects(run.controller.dispatch(run.scope,'synthetic-owner'));
   assert.equal((await store.read(run.scope)).status,'NEEDS_RECONCILIATION');await cleaned(run);
   await assert.rejects(controller().dispatch(run.scope,'synthetic-owner'));
  });
  await t.test('registered stop removes a running server and its detached child',async()=>{
   const run=await fixture('registered-stop','hang');await approve(run);const work=run.controller.dispatch(run.scope,'synthetic-owner');work.catch(()=>{});
   const j=await waitStage(run,'STARTED');const top=await descendant(j.cid);run.processesBeforeStop=top.out;
   await run.controller.stop(run.scope,'synthetic-owner');await assert.rejects(work);await cleaned(run);assert.equal((await store.read(run.scope)).reason,'STOP_REQUESTED');
  });
  await t.test('revoked authority creates no container',async()=>{
   const run=await fixture('revoked');await approve(run);await store.transaction(run.scope,state=>{state.grant.revoked=true;});
   await assert.rejects(run.controller.dispatch(run.scope,'synthetic-owner'));assert.equal(existsSync(run.journal),false);
  });
  await t.test('lost intent acknowledgement causes no creation or automatic retry',async()=>{
   const run=await fixture('lost-intent');await approve(run);let lost=false;
   const wrapper={async transaction(scope,mutate){let entered=false;const result=await store.transaction(scope,state=>{const before=state.status;const value=mutate(state);entered=before==='PREPARED'&&state.status==='IN_FLIGHT';return value;});if(entered&&!lost){lost=true;throw Error('SYNTHETIC_LOST_ACK');}return result;}};
   await assert.rejects(controller(wrapper).dispatch(run.scope,'synthetic-owner'));assert.equal(existsSync(run.journal),false);
   assert.equal((await controller().recover(run.scope,'synthetic-owner')).status,'NEEDS_RECONCILIATION');await assert.rejects(controller().dispatch(run.scope,'synthetic-owner'));
  });
  if(process.env.BOWERLOOM_MCP_LEASE_PROOF==='1')for(const mode of ['second-process-stop','second-process-revocation','database-outage','approval-expiry'])await t.test(mode,async()=>{
   const run=await fixture(mode,'hang',20000);
   const approvalExpiresAtMs=Date.now()+(mode==='approval-expiry'?6000:30000);
   await run.controller.approve(run.scope,{revision:run.proposal.revision,expiresAtMs:approvalExpiresAtMs},'synthetic-owner');
   const settings=join(directory,mode+'.json'),result=join(directory,mode+'.result');
   writeFileSync(settings,JSON.stringify({connection,schema,scope:run.scope,stateRoot,result}),{mode:0o600});
   const parent=spawn(realpathSync(process.execPath),[parentFile,settings],{env:{BOWERLOOM_PROOF_CREDENTIALS:credentialsPath},stdio:['ignore','ignore','pipe']});
   parent.stderr.on('data',b=>{run.controllerStderr=((run.controllerStderr??'')+b.toString()).slice(0,16384);});parent.on('exit',(code,signal)=>{run.controllerExit={code,signal};});
   const exited=once(parent,'exit');exited.catch(()=>{});parents.push({parent,exited});
   const j=await waitStage(run,'STARTED');assert.notEqual(j.guardianPid,parent.pid);
   run.processesBeforeRevocation=(await descendant(j.cid)).out;
   run.leaseObservation={mode,controllerPid:parent.pid,guardianPid:j.guardianPid,startedJournal:j,approvalExpiresAtMs};
   let databaseDisabled=false;
   try{
    if(mode==='second-process-stop')await controller().stop(run.scope,'synthetic-owner');
    if(mode==='second-process-revocation')await store.transaction(run.scope,state=>{state.grant.revoked=true;});
    if(mode==='database-outage'){
     await admin.query(`ALTER DATABASE "${database}" ALLOW_CONNECTIONS false`);databaseDisabled=true;
     await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',[database]);
    }
    const changeAtMs=Date.now(),changeAtMonotonic=performance.now();run.leaseObservation.changeAtMs=changeAtMs;
    const final=await cleaned(run);run.leaseObservation.absenceObservedAtMs=Date.now();
    run.leaseObservation.changeToAbsenceMs=performance.now()-changeAtMonotonic;
    run.leaseObservation.finalJournal=final;
    assert.ok(final.lease?.sequence>=1,'Guardian must record an accepted authority renewal');
    for(const field of ['lastRenewedAtMs','stopRequestedAtMs','containerAbsentAtMs','attachReapedAtMs'])assert.ok(Number.isFinite(final.lease[field]),'Missing guardian observation: '+field);
    assert.ok(final.lease.stopRequestedAtMs>=final.lease.lastRenewedAtMs);
    assert.ok(final.lease.containerAbsentAtMs>=final.lease.stopRequestedAtMs);
    run.leaseObservation.lastRenewalToStopMs=final.lease.stopRequestedAtMs-final.lease.lastRenewedAtMs;
    run.leaseObservation.cleanupToAbsenceMs=final.lease.containerAbsentAtMs-final.lease.stopRequestedAtMs;
    run.leaseObservation.authorityLeaseMs=2000;
    run.leaseObservation.renewalIntervalMs=500;
    if(mode!=='approval-expiry'){
     assert.ok(Date.now()<j.deadlineMs,'Lease cleanup must precede the original approval deadline');
     assert.ok(run.leaseObservation.changeToAbsenceMs<8000,'Synthetic lease cleanup exceeded the measured test bound');
    }else assert.ok(Date.now()<approvalExpiresAtMs+8000,'Expiry cleanup exceeded the measured test bound');
    await bounded(exited,12000);assert.deepEqual(JSON.parse(readFileSync(result,'utf8')),{held:true});
   }finally{if(databaseDisabled)await admin.query(`ALTER DATABASE "${database}" ALLOW_CONNECTIONS true`);}
   const current=await store.read(run.scope);assert.notEqual(current.status,'COMPLETED');
   if(current.status==='IN_FLIGHT')await controller().recover(run.scope,'synthetic-owner');
   await assert.rejects(controller().dispatch(run.scope,'synthetic-owner'));
   assert.equal((await store.read(run.scope)).status,'NEEDS_RECONCILIATION');
   if(mode==='second-process-stop')assert.equal((await store.read(run.scope)).reason,'STOP_REQUESTED');
   if(installedGuard){run.controllerProvenance=readFileSync(settings+'.provenance.jsonl','utf8').trim().split('\n').map(line=>JSON.parse(line));assert.ok(run.controllerProvenance.some(item=>item.event==='resolved'&&item.url===moduleUrl));assert.ok(run.controllerProvenance.some(item=>item.event==='resolved'&&item.url===pgUrl));}
   const end=performance.now()+3000;while(alive(j.guardianPid)&&performance.now()<end)await wait(25);assert.equal(alive(j.guardianPid),false);
  });
  for(const mode of ['controller-killed','controller-suspended'])await t.test(mode,async()=>{
   const run=await fixture(mode,'hang',5000);await approve(run);
   const settings=join(directory,mode+'.json'),result=join(directory,mode+'.result');
   writeFileSync(settings,JSON.stringify({connection,schema,scope:run.scope,stateRoot,result}),{mode:0o600});
   const parent=spawn(realpathSync(process.execPath),[parentFile,settings],{env:{BOWERLOOM_PROOF_CREDENTIALS:credentialsPath},stdio:['ignore','ignore','pipe']});
   parent.stderr.on('data',b=>{run.controllerStderr=((run.controllerStderr??'')+b.toString()).slice(0,16384);});parent.on('exit',(code,signal)=>{run.controllerExit={code,signal};});
   const exited=once(parent,'exit');exited.catch(()=>{});parents.push({parent,exited});
   const j=await waitStage(run,'STARTED');assert.notEqual(j.guardianPid,parent.pid);assert.equal((await store.read(run.scope)).status,'IN_FLIGHT');
   const top=await descendant(j.cid);run.processesBeforeLoss=top.out;const earlierSigned=readFileSync(run.journal,'utf8');
   parent.kill(mode==='controller-killed'?'SIGKILL':'SIGSTOP');if(mode==='controller-killed')await bounded(exited,5000);
   await cleaned(run);assert.equal((await store.read(run.scope)).status,'IN_FLIGHT');
   run.freshInspection=await inspectFresh(run,'parent-loss');assertHeld(run.freshInspection.report);assert.equal(run.freshInspection.report.bootSession,'matches');
   run.publicGuardianBinding=(await store.readGuardianEvidence(run.scope)).binding;
   const finalSigned=readFileSync(run.journal,'utf8');try{writeFileSync(run.journal,earlierSigned);run.historicalReplay=await inspectFresh(run,'replay');assertHeld(run.historicalReplay.report);assert.ok(run.historicalReplay.report.snapshotSequence<run.freshInspection.report.snapshotSequence);}finally{writeFileSync(run.journal,finalSigned);}

   run.guardianBeforeResume=alive(j.guardianPid)?spawnSync('/bin/ps',['-o','stat=','-p',String(j.guardianPid)],{encoding:'utf8',timeout:1000,maxBuffer:1024}).stdout.trim():'reaped';
   assert.ok(run.guardianBeforeResume==='reaped'||run.guardianBeforeResume.startsWith('Z'));
   assert.equal((await controller().recover(run.scope,'synthetic-owner')).status,'NEEDS_RECONCILIATION');await assert.rejects(controller().dispatch(run.scope,'synthetic-owner'));
   if(mode==='controller-suspended'){parent.kill('SIGCONT');await bounded(exited);assert.deepEqual(JSON.parse(readFileSync(result,'utf8')),{held:true});}
   if(installedGuard){run.controllerProvenance=readFileSync(settings+'.provenance.jsonl','utf8').trim().split('\n').map(line=>JSON.parse(line));assert.ok(run.controllerProvenance.some(item=>item.event==='resolved'&&item.url===moduleUrl));assert.ok(run.controllerProvenance.some(item=>item.event==='resolved'&&item.url===pgUrl));}
   const end=performance.now()+3000;while(alive(j.guardianPid)&&performance.now()<end)await wait(25);assert.equal(alive(j.guardianPid),false);
  });
 }finally{
  for(const {parent,exited} of parents){if(parent.exitCode===null&&parent.signalCode===null){parent.kill('SIGCONT');parent.kill('SIGKILL');await bounded(exited,5000).catch(()=>{});}}
  const emergency=[];
  for(const run of runs){const j=journal(run);if(j){run.observedJournal=j;if(j.cid){const r=await docker(['container','inspect',j.cid]);if(r.code===0){const actual=JSON.parse(r.out)[0];assert.equal(actual.Id,j.cid);assert.equal(actual.Name,'/'+j.name);assert.equal(actual.Config.Image,run.launchPlan.spec.imageIndexDigest);assert.equal(actual.Config.Labels['ai.bowerloom.mcp.operation'],run.launchPlan.spec.operationKey);await docker(['container','rm','--force',j.cid]);await absent(j.cid);emergency.push(run.id);}}}}
  writeFileSync(join(evidence,'container-postgres-qualification.json'),JSON.stringify({observedAt:new Date().toISOString(),runs:runs.map(({controller,...r})=>r),emergencyCleanup:emergency,imagePulls:0,toolCalls:0,externalEndpoints:0,productionContainment:false,nativeHarnessBypassTested:false},null,2)+'\n');
  await pool.end();if(created)await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);await admin.end();
  if(emergency.length===0&&!runs.some(run=>run.observedJournal?.stage==='UNCERTAIN'))rmSync(directory,{recursive:true,force:true});assert.deepEqual(emergency,[],'Guardian cleanup failed; test-owned containers required emergency removal');
 }
});

}
