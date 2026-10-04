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
import pg from 'pg';
import {DiscoveryAuthorityController,PostgresDiscoveryAuthorityStore,createDiscoveryProposal,createDiscoveryAuthorityState,
 mcpBindingRevision,planMcpContainerDiscoveryLaunch,createMcpContainerDiscoveryFactory} from '../../../dist/packages/mcp-connections/src/index.js';

const enabled=process.env.BOWERLOOM_MCP_CONTAINER_POSTGRES_PROOF==='trellis-alpha-proof@127.0.0.1:56582';
const digest=s=>'sha256:'+createHash('sha256').update(s).digest('hex');
const read=part=>JSON.parse(readFileSync(new URL(`./fixtures/stdio-${part}.json`,import.meta.url),'utf8'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
async function bounded(promise,ms=12000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('SYNTHETIC_BOUND_EXCEEDED')),ms);})]);}finally{clearTimeout(timer);}}

test('approved container discovery composes with PostgreSQL and independent cleanup',{skip:!enabled,timeout:150000},async t=>{
 const evidence=resolve(process.env.BOWERLOOM_MCP_CONTAINER_EVIDENCE);
 const blobs=Object.fromEntries(['Index','Manifest','Config'].map(k=>[`image${k}Json`,readFileSync(join(evidence,`image-${k.toLowerCase()}.json`),'utf8')]));
 const image=JSON.parse(blobs.imageConfigJson),directory=realpathSync(mkdtempSync(join(tmpdir(),'bowerloom-container-db-')));chmodSync(directory,0o700);
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
 function journal(run){return existsSync(run.journal)?JSON.parse(readFileSync(run.journal,'utf8')):null;}
 async function waitStage(run,stage){const end=performance.now()+10000;while(performance.now()<end){const j=journal(run);if(j?.stage===stage)return j;if(j?.stage==='UNCERTAIN')assert.fail('Unexpected uncertain journal: '+j.reason);await wait(25);}assert.fail('Journal stage not reached: '+stage);}
 async function absent(cid){const r=await docker(['container','inspect',cid]);assert.notEqual(r.code,0);assert.match(r.err,/No such (object|container)/);}
 async function descendant(cid){let result;const end=performance.now()+2000;while(performance.now()<end){result=await docker(['container','top',cid,'-eo','pid,ppid,pgid,sid,args']);if(result.code===0&&result.out.includes('/bin/sleep 120'))break;await wait(25);}assert.equal(result?.code,0);const row=result.out.split('\n').find(x=>x.includes('/bin/sleep 120'));assert.ok(row);const fields=row.trim().split(/\s+/);assert.equal(fields[0],fields[2]);assert.equal(fields[0],fields[3]);return result;}
 async function cleaned(run){const j=await waitStage(run,'REAPED');assert.match(j.cid,/^[a-f0-9]{64}$/);await absent(j.cid);run.finalJournal=j;return j;}
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
 const moduleUrl=new URL('../../../dist/packages/mcp-connections/src/index.js',import.meta.url).href;
 const pgUrl=pathToFileURL(createRequire(import.meta.url).resolve('pg')).href;
 const parentFile=join(directory,'controller.mjs');
 writeFileSync(parentFile,`import {readFileSync,writeFileSync} from 'node:fs';import pg from ${JSON.stringify(pgUrl)};import {DiscoveryAuthorityController,PostgresDiscoveryAuthorityStore,createMcpContainerDiscoveryFactory} from ${JSON.stringify(moduleUrl)};const c=JSON.parse(readFileSync(process.argv[2],'utf8'));const secret=JSON.parse(readFileSync(process.env.BOWERLOOM_PROOF_CREDENTIALS,'utf8'));const pool=new pg.Pool({...c.connection,password:secret.POSTGRES_PASSWORD,max:2});pool.on('error',()=>{});const store=new PostgresDiscoveryAuthorityStore(pool,{schema:c.schema});const ctl=new DiscoveryAuthorityController({store,identity:{async authenticate(){return {subject:'hanna-dummy',proofRef:'synthetic:proof',expiresAtMs:Date.now()+60000};}},open:createMcpContainerDiscoveryFactory({stateRoot:c.stateRoot,trustedDockerDesktop:true,requestTimeoutMs:15000,sessionTimeoutMs:20000,cleanupTimeoutMs:9000})});try{await ctl.dispatch(c.scope,'synthetic-owner');writeFileSync(c.result,JSON.stringify({unexpectedSuccess:true}));}catch{writeFileSync(c.result,JSON.stringify({held:true}));}finally{await pool.end();}`,{mode:0o600});
 try{
  await admin.connect();await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;await store.createSchema();
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
  for(const mode of ['controller-killed','controller-suspended'])await t.test(mode,async()=>{
   const run=await fixture(mode,'hang',5000);await approve(run);
   const settings=join(directory,mode+'.json'),result=join(directory,mode+'.result');
   writeFileSync(settings,JSON.stringify({connection,schema,scope:run.scope,stateRoot,result}),{mode:0o600});
   const parent=spawn(realpathSync(process.execPath),[parentFile,settings],{env:{BOWERLOOM_PROOF_CREDENTIALS:credentialsPath},stdio:'ignore'});
   const exited=once(parent,'exit');exited.catch(()=>{});parents.push({parent,exited});
   const j=await waitStage(run,'STARTED');assert.notEqual(j.guardianPid,parent.pid);assert.equal((await store.read(run.scope)).status,'IN_FLIGHT');
   const top=await descendant(j.cid);run.processesBeforeLoss=top.out;
   parent.kill(mode==='controller-killed'?'SIGKILL':'SIGSTOP');if(mode==='controller-killed')await bounded(exited,5000);
   await cleaned(run);assert.equal((await store.read(run.scope)).status,'IN_FLIGHT');
   run.guardianBeforeResume=alive(j.guardianPid)?spawnSync('/bin/ps',['-o','stat=','-p',String(j.guardianPid)],{encoding:'utf8',timeout:1000,maxBuffer:1024}).stdout.trim():'reaped';
   assert.ok(run.guardianBeforeResume==='reaped'||run.guardianBeforeResume.startsWith('Z'));
   assert.equal((await controller().recover(run.scope,'synthetic-owner')).status,'NEEDS_RECONCILIATION');await assert.rejects(controller().dispatch(run.scope,'synthetic-owner'));
   if(mode==='controller-suspended'){parent.kill('SIGCONT');await bounded(exited);assert.deepEqual(JSON.parse(readFileSync(result,'utf8')),{held:true});}
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
