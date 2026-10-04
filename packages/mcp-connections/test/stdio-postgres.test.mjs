import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,realpathSync,chmodSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import pg from 'pg';
import {DiscoveryAuthorityController,PostgresDiscoveryAuthorityStore,createDiscoveryProposal,
 createDiscoveryAuthorityState,createMcpStdioDiscoveryFactory,mcpBindingRevision} from '../../../dist/packages/mcp-connections/src/index.js';

const enabled=process.env.BOWERLOOM_MCP_STDIO_PROOF==='trellis-alpha-proof@127.0.0.1:56582';
const read=part=>JSON.parse(readFileSync(new URL(`./fixtures/stdio-${part}.json`,import.meta.url),'utf8'));
const hash=path=>'sha256:'+createHash('sha256').update(readFileSync(path)).digest('hex');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('real trusted stdio discovery composes with durable PostgreSQL approval',{skip:!enabled,timeout:60000},async t=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'bowerloom-stdio-db-')));chmodSync(directory,0o700);
 const credentials=JSON.parse(readFileSync(process.env.TRELLIS_BROKER_CREDENTIALS_FILE,'utf8'));
 const database=`bowerloom_stdio_test_${randomBytes(8).toString('hex')}`,schema='bowerloom_mcp_stdio';
 const options={host:'127.0.0.1',port:56582,user:'postgres',password:credentials.POSTGRES_PASSWORD,ssl:false,connectionTimeoutMillis:3000,idleTimeoutMillis:1000,application_name:'bowerloom_stdio_proof'};
 const admin=new pg.Client({...options,database:'postgres'}),pool=new pg.Pool({...options,database,max:3});pool.on('error',()=>{});
 const store=new PostgresDiscoveryAuthorityStore(pool,{schema});
 const executable=realpathSync(process.execPath),exeDigest=hash(executable),secret='synthetic-stdio-secret';
 const catalog=read('catalog'),serverIdentity=read('binding').serverIdentity;
 const serverSource=`import {appendFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
const mode=process.argv[2];
const record=value=>appendFileSync(process.env.SYNTHETIC_LOG,JSON.stringify(value)+'\\n');
record({event:'start',pid:process.pid,inherited:!!process.env.BOWERLOOM_PARENT_SENTINEL,secretMatches:process.env.SYNTHETIC_SECRET===${JSON.stringify(secret)}});
const tools=${JSON.stringify(catalog.tools)},serverInfo=${JSON.stringify(serverIdentity)};
createInterface({input:process.stdin}).on('line',line=>{
 const request=JSON.parse(line);record({event:'message',method:request.method});
 if(request.method==='notifications/initialized')return;
 if(mode==='delay'&&request.method==='initialize')return;
 if(mode==='exit')process.exit(7);
 if(mode==='notification'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/tools/list_changed'})+'\\n');return;}
 let result=request.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo}:
 request.params?.cursor?{tools:[tools[1]]}:{tools:[tools[0]],nextCursor:'second'};
 if(mode==='drift'&&request.method==='tools/list')result.tools[0].inputSchema.description='changed';
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
});
`;
 const previous=process.env.BOWERLOOM_PARENT_SENTINEL;process.env.BOWERLOOM_PARENT_SENTINEL='must-not-leak';
 let created=false,starts=0,successes=0;const runs=[];
 function events(run){return existsSync(run.log)?readFileSync(run.log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];}
 async function childExited(run){
  const pid=events(run).find(e=>e.event==='start')?.pid;if(!pid)return;
  for(let n=0;n<100;n++){try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH'){run.confirmedExited=true;return;}throw e;}await wait(10);}
  assert.fail('Synthetic direct child remained alive after cleanup');
 }
 try {
  await admin.connect();await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;await store.createSchema();
  async function setup(id,mode='normal',gate=null){
   const server=join(directory,id+'.mjs'),log=join(directory,id+'.jsonl');writeFileSync(server,serverSource,{mode:0o600});
   const input={declaration:read('declaration'),binding:read('binding'),catalog:read('catalog'),synthetic:true};
   const refs=[{environmentVariable:'SYNTHETIC_LOG',reference:'secret-ref:synthetic/log'},{environmentVariable:'SYNTHETIC_SECRET',reference:'secret-ref:synthetic/value'}];
   Object.assign(input.binding.transport,{executable,workingDirectory:directory,secretReferences:refs});input.catalog.bindingRevision=mcpBindingRevision(input.binding);
   const scope={workspaceId:'synthetic',runId:id,taskId:'discovery'};
   const proposal=createDiscoveryProposal({scope,requestId:id,ownerEpoch:1,input,timeoutMs:5000,effect:{kind:'stdio',executable:{path:executable,digest:exeDigest},entrypoints:[{path:server,digest:hash(server)}],args:[server,mode],cwd:directory,environment:{inherit:false,secretReferences:refs}}});
   const now=Date.now();await store.seed(createDiscoveryAuthorityState(proposal,{scope,ownerSubject:'hanna-dummy',ownerEpoch:1,approverSubjects:['hanna-dummy'],readyAtMs:now-100,leaseExpiresAtMs:now+60000,revoked:false}));
   let reads=0;
   const open=createMcpStdioDiscoveryFactory({trustedLocalServerOnly:true,requestTimeoutMs:1500,sessionTimeoutMs:5000,cleanupTimeoutMs:500,
    resolveSecret:async ref=>{
     reads++;const state=await store.read(scope);assert.equal(state.status,'IN_FLIGHT');assert.equal(state.approval.revision,proposal.revision);assert.ok(state.intent);
     if(gate)await gate.promise;
     return ref.environmentVariable==='SYNTHETIC_LOG'?log:secret;
    }});
   const controller=new DiscoveryAuthorityController({store,open,identity:{async authenticate(value){assert.equal(value,'synthetic-owner');return {subject:'hanna-dummy',proofRef:'synthetic:proof',expiresAtMs:Date.now()+60000};}}});
   const run={controller,scope,proposal,server,log,reads:()=>reads};runs.push(run);return run;
  }
  const approve=run=>run.controller.approve(run.scope,{revision:run.proposal.revision,expiresAtMs:Date.now()+30000},'synthetic-owner');
  await t.test('no approval opens no process or credential resolver',async()=>{
   const run=await setup('unapproved');await assert.rejects(run.controller.dispatch(run.scope,'synthetic-owner'));assert.equal(run.reads(),0);assert.deepEqual(events(run),[]);
  });
  await t.test('concurrent approved dispatch starts one process and saved completion never restarts it',async()=>{
   const run=await setup('success');await approve(run);
   const results=await Promise.allSettled([run.controller.dispatch(run.scope,'synthetic-owner'),run.controller.dispatch(run.scope,'synthetic-owner')]);
   const fulfilled=results.filter(r=>r.status==='fulfilled');assert.ok(fulfilled.length>=1);const result=fulfilled[0].value;
   assert.equal(result.status,'COMPLETED');assert.equal(result.result.pageCount,2);assert.equal(result.result.toolCalls,0);successes++;
   const before=events(run);assert.equal(before.filter(e=>e.event==='start').length,1);assert.equal(before[0].inherited,false);assert.equal(before[0].secretMatches,true);
   assert.deepEqual(before.filter(e=>e.event==='message').map(e=>e.method),['initialize','notifications/initialized','tools/list','tools/list']);
   await run.controller.dispatch(run.scope,'synthetic-owner');assert.deepEqual(events(run),before);await childExited(run);
   assert.ok(!JSON.stringify(await store.read(run.scope)).includes(secret));
  });
  await t.test('changed measured source prevents spawn and holds the intent',async()=>{
   const run=await setup('changed');await approve(run);writeFileSync(run.server,serverSource+'\n// changed after approval\n');
   await assert.rejects(run.controller.dispatch(run.scope,'synthetic-owner'));assert.deepEqual(events(run),[]);assert.equal((await store.read(run.scope)).status,'NEEDS_RECONCILIATION');
  });
  for(const mode of ['drift','notification','exit'])await t.test(`${mode} holds uncertainty and does not retry the process`,async()=>{
   const run=await setup(mode,mode);await approve(run);await assert.rejects(run.controller.dispatch(run.scope,'synthetic-owner'));
   assert.equal((await store.read(run.scope)).status,'NEEDS_RECONCILIATION');const before=events(run);await assert.rejects(run.controller.dispatch(run.scope,'synthetic-owner'));assert.deepEqual(events(run),before);await childExited(run);
  });
  await t.test('durable stop terminates the active direct child',async()=>{
   const run=await setup('stop','delay');await approve(run);const dispatched=run.controller.dispatch(run.scope,'synthetic-owner');void dispatched.catch(()=>{});
   for(let n=0;n<100&&!events(run).some(e=>e.method==='initialize');n++)await wait(10);
   assert.ok(events(run).some(e=>e.method==='initialize'));await run.controller.stop(run.scope,'synthetic-owner');await assert.rejects(dispatched);await childExited(run);
   const state=await store.read(run.scope);assert.equal(state.status,'NEEDS_RECONCILIATION');assert.equal(state.stopRequested,true);
  });
  await t.test('stop during credential resolution prevents late spawn',async()=>{
   let release;const gate={promise:new Promise(resolve=>{release=resolve;})};const run=await setup('late-secret','normal',gate);await approve(run);
   const dispatched=run.controller.dispatch(run.scope,'synthetic-owner');void dispatched.catch(()=>{});
   for(let n=0;n<100&&!run.reads();n++)await wait(10);assert.ok(run.reads()>0);
   await run.controller.stop(run.scope,'synthetic-owner');release();await assert.rejects(dispatched);await wait(50);assert.deepEqual(events(run),[]);
  });
  for(const run of runs){await childExited(run);starts+=events(run).filter(e=>e.event==='start').length;assert.ok(!events(run).some(e=>e.method==='tools/call'));}
  console.log(JSON.stringify({proof:'durable-approval-with-real-trusted-stdio',realPostgres:true,starts,successes,externalEndpoints:0,toolCalls:0,productionContainment:false}));
 }finally{
  if(previous===undefined)delete process.env.BOWERLOOM_PARENT_SENTINEL;else process.env.BOWERLOOM_PARENT_SENTINEL=previous;
  for(const run of runs){const pid=events(run).find(e=>e.event==='start')?.pid;if(pid&&!run.confirmedExited)try{process.kill(pid,'SIGKILL');}catch{}}
  await pool.end();if(created)await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);await admin.end();rmSync(directory,{recursive:true,force:true});
 }
});
