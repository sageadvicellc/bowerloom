import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,realpathSync,chmodSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash,randomBytes} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import pg from 'pg';
import {DiscoveryAuthorityController,PostgresDiscoveryAuthorityStore,createDiscoveryProposal,createDiscoveryAuthorityState,mcpBindingRevision} from '../../../dist/packages/mcp-connections/src/index.js';
const enabled=process.env.BOWERLOOM_MCP_GUARDIAN_PROOF==='trellis-alpha-proof@127.0.0.1:56582';
const read=part=>JSON.parse(readFileSync(new URL(`./fixtures/stdio-${part}.json`,import.meta.url),'utf8'));
const hash=path=>'sha256:'+createHash('sha256').update(readFileSync(path)).digest('hex');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function exitWithin(exit){let timer;try{return await Promise.race([exit,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Synthetic controller did not exit within its bound')),5000);})]);}finally{clearTimeout(timer);}}
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
async function gone(pid,timeout=6500){const end=performance.now()+timeout;while(alive(pid)&&performance.now()<end)await wait(25);assert.equal(alive(pid),false,'Owned process did not exit');}

async function terminated(pid){
 const end=performance.now()+6500;
 while(performance.now()<end){
  if(!alive(pid))return 'reaped';
  const observed=spawnSync('/bin/ps',['-o','stat=','-p',String(pid)],{encoding:'utf8',timeout:1000,maxBuffer:1024});
  if(observed.status===0&&observed.stdout.trim().startsWith('Z'))return 'zombie-awaiting-parent-reap';
  await wait(25);
 }
 assert.fail('Owned guardian remained live after its independent deadline');
}

test('guardian survives discovery controller loss while PostgreSQL holds the uncertain intent',{skip:!enabled,timeout:60000},async t=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'bowerloom-guardian-db-')));chmodSync(directory,0o700);
 const credentialsPath=realpathSync(process.env.TRELLIS_BROKER_CREDENTIALS_FILE),credentials=JSON.parse(readFileSync(credentialsPath,'utf8'));
 const database=`bowerloom_guardian_test_${randomBytes(8).toString('hex')}`,schema='bowerloom_mcp_guardian';
 const connection={host:'127.0.0.1',port:56582,user:'postgres',database,ssl:false,connectionTimeoutMillis:3000,idleTimeoutMillis:1000,application_name:'bowerloom_guardian_proof'};
 const admin=new pg.Client({...connection,database:'postgres',password:credentials.POSTGRES_PASSWORD}),pool=new pg.Pool({...connection,password:credentials.POSTGRES_PASSWORD,max:3});pool.on('error',()=>{});
 const store=new PostgresDiscoveryAuthorityStore(pool,{schema}),executable=realpathSync(process.execPath),exeDigest=hash(executable);
 const moduleUrl=new URL('../../../dist/packages/mcp-connections/src/index.js',import.meta.url).href;
 const pgUrl=pathToFileURL(createRequire(import.meta.url).resolve('pg')).href;
 const serverSource=`import {appendFileSync} from 'node:fs';import {createInterface} from 'node:readline';
const record=value=>appendFileSync(process.env.SYNTHETIC_LOG,JSON.stringify(value)+'\\n');
record({event:'start',pid:process.pid,guardian:process.ppid,parentCredentialsLeaked:!!process.env.BOWERLOOM_PROOF_CREDENTIALS});
process.on('SIGTERM',()=>{});setInterval(()=>{},1000);
createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);record({event:'message',method:r.method});});
`;
 const parentSource=`import {readFileSync,writeFileSync} from 'node:fs';import pg from ${JSON.stringify(pgUrl)};
import {DiscoveryAuthorityController,PostgresDiscoveryAuthorityStore,createMcpStdioDiscoveryFactory} from ${JSON.stringify(moduleUrl)};
const c=JSON.parse(readFileSync(process.argv[2],'utf8'));
const secrets=JSON.parse(readFileSync(process.env.BOWERLOOM_PROOF_CREDENTIALS,'utf8'));
const pool=new pg.Pool({...c.connection,password:secrets.POSTGRES_PASSWORD,max:2});pool.on('error',()=>{});
const store=new PostgresDiscoveryAuthorityStore(pool,{schema:c.schema});
const controller=new DiscoveryAuthorityController({store,identity:{async authenticate(){return {subject:'hanna-dummy',proofRef:'synthetic:proof',expiresAtMs:Date.now()+60000};}},
open:createMcpStdioDiscoveryFactory({trustedLocalServerOnly:true,requestTimeoutMs:10000,sessionTimeoutMs:c.sessionTimeoutMs,cleanupTimeoutMs:1000,
resolveSecret:async ref=>{const state=await store.read(c.scope);if(state.status!=='IN_FLIGHT'||state.approval.revision!==c.revision)throw Error('SYNTHETIC_APPROVAL_MISSING');return c.log;}})});
try {await controller.dispatch(c.scope,'synthetic-owner');writeFileSync(c.result,JSON.stringify({unexpectedSuccess:true}));}
catch {writeFileSync(c.result,JSON.stringify({held:true}));}
finally {await pool.end();}
`;
 const parentFile=join(directory,'controller.mjs');writeFileSync(parentFile,parentSource,{mode:0o600});
 let created=false;const runs=[];let opened=0;const guardianStates=[];
 function events(run){return existsSync(run.log)?readFileSync(run.log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];}
 try {
  await admin.connect();await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;await store.createSchema();
  for(const mode of ['controller-killed','controller-suspended'])await t.test(mode,async()=>{
   const scope={workspaceId:'synthetic',runId:mode,taskId:'discovery'},server=join(directory,mode+'.mjs'),log=join(directory,mode+'.log'),result=join(directory,mode+'.result');
   writeFileSync(server,serverSource,{mode:0o600});
   const input={declaration:read('declaration'),binding:read('binding'),catalog:read('catalog'),synthetic:true};
   const refs=[{environmentVariable:'SYNTHETIC_LOG',reference:'secret-ref:synthetic/log'}];Object.assign(input.binding.transport,{executable,workingDirectory:directory,secretReferences:refs});input.catalog.bindingRevision=mcpBindingRevision(input.binding);
   const proposal=createDiscoveryProposal({scope,requestId:mode,ownerEpoch:1,input,timeoutMs:10000,effect:{kind:'stdio',executable:{path:executable,digest:exeDigest},entrypoints:[{path:server,digest:hash(server)}],args:[server],cwd:directory,environment:{inherit:false,secretReferences:refs}}});
   const now=Date.now();await store.seed(createDiscoveryAuthorityState(proposal,{scope,ownerSubject:'hanna-dummy',ownerEpoch:1,approverSubjects:['hanna-dummy'],readyAtMs:now-100,leaseExpiresAtMs:now+60000,revoked:false}));
   const observer=new DiscoveryAuthorityController({store,identity:{async authenticate(){return {subject:'hanna-dummy',proofRef:'synthetic:proof',expiresAtMs:Date.now()+60000};}},open:async()=>{opened++;throw Error('SYNTHETIC_REPLAY_FORBIDDEN');}});
   await observer.approve(scope,{revision:proposal.revision,expiresAtMs:now+30000},'synthetic-owner');
   const settings=join(directory,mode+'.json');writeFileSync(settings,JSON.stringify({connection,schema,scope,revision:proposal.revision,log,result,sessionTimeoutMs:mode==='controller-suspended'?2000:10000}),{mode:0o600});
   const parent=spawn(executable,[parentFile,settings],{env:{BOWERLOOM_PROOF_CREDENTIALS:credentialsPath},stdio:'ignore'});
   const parentExit=once(parent,'exit');void parentExit.catch(()=>{});const run={parent,log,parentExit};runs.push(run);
   for(let n=0;n<200&&!events(run).some(e=>e.method==='initialize');n++)await wait(25);
   const start=events(run).find(e=>e.event==='start');assert.ok(start);run.serverPid=start.pid;run.guardianPid=start.guardian;
   assert.notEqual(start.guardian,parent.pid);assert.equal(start.parentCredentialsLeaked,false);assert.ok(events(run).some(e=>e.method==='initialize'));
   assert.equal((await store.read(scope)).status,'IN_FLIGHT');
   parent.kill(mode==='controller-killed'?'SIGKILL':'SIGSTOP');if(mode==='controller-killed')await exitWithin(parentExit);
   await gone(start.pid);run.serverGone=true;
   if(mode==='controller-suspended')guardianStates.push(await terminated(start.guardian));
   else {await gone(start.guardian);run.guardianGone=true;guardianStates.push('reaped');}
   assert.equal((await store.read(scope)).status,'IN_FLIGHT');
   const recovered=await observer.recover(scope,'synthetic-owner');assert.equal(recovered.status,'NEEDS_RECONCILIATION');assert.equal(recovered.reason,'RECOVERY_UNCERTAIN');
   const before=events(run);await assert.rejects(observer.dispatch(scope,'synthetic-owner'));assert.equal(opened,0);assert.deepEqual(events(run),before);
   if(mode==='controller-suspended'){parent.kill('SIGCONT');await exitWithin(parentExit);await gone(start.guardian);run.guardianGone=true;assert.deepEqual(JSON.parse(readFileSync(result,'utf8')),{held:true});}
   assert.equal(events(run).filter(e=>e.event==='start').length,1);assert.ok(!events(run).some(e=>e.method==='tools/call'));
  });
  console.log(JSON.stringify({proof:'guardian-orphan-and-independent-deadline-with-postgres',cases:2,processStarts:2,guardianStates,durableUncertainty:true,recoveryReplayAttempts:opened,toolCalls:0,externalEndpoints:0,escapedDescendantsProved:false,productionContainment:false}));
 }finally{
  for(const run of runs){if(run.parent.exitCode===null&&run.parent.signalCode===null){run.parent.kill('SIGCONT');run.parent.kill('SIGKILL');await run.parentExit.catch(()=>{});}if(run.serverPid&&!run.serverGone)try{process.kill(run.serverPid,'SIGKILL');}catch{}if(run.guardianPid&&!run.guardianGone)try{process.kill(run.guardianPid,'SIGTERM');}catch{}}
  await pool.end();if(created)await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);await admin.end();rmSync(directory,{recursive:true,force:true});
 }
});
