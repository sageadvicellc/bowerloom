import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, realpath, readFile, writeFile, mkdir, rm, stat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { openLocalSession, localInstallation } from '../apps/cli/src/controller.js';
import type { LocalInstallation } from '../apps/cli/src/controller.js';
import { executeSession } from '../apps/cli/src/session.js';
import type { SessionPort, SessionCommand } from '../apps/cli/src/session.js';
import { prepareEndorAlpha, provisionLocalInstallation } from '../apps/cli/src/provision.js';
import { GraphDriver, PostgresGraphStore } from '../packages/graph/src/index.js';
import type { GraphView } from '../packages/graph/src/index.js';
import { taskRequest } from '../packages/graph/src/validation.js';
import { renderTask } from '../packages/runtime-bridge/src/index.js';
import { RuntimeLedger } from '../packages/runtime/src/index.js';
import type { RunInput } from '../packages/runtime/src/index.js';
import { PostgresAdmission } from '../packages/admission/src/index.js';
import { PostgresBrokerStore } from '../packages/broker-postgres/src/index.js';
import { serializeTestManifest } from '../packages/controlled-tests/src/index.js';
import type { TestExecutor, TestExecution, TestReport } from '../packages/controlled-tests/src/index.js';
import { MODEL_ROUTE, SUPPORTED_NATIVE_SHA256 } from '../packages/codex-adapter/src/index.js';
import { canonicalJson, digest } from '../packages/contracts/src/index.js';
const enabled=process.env.TRELLIS_CLI_PROOF==='trellis-alpha-proof@127.0.0.1:56582';
const manifest=serializeTestManifest({format:'trellis/registered-test/v0.7-alpha',testId:'craft-shop-ui-v1',testerDigest:digest('test-only synthetic tester'),environmentDigest:digest('test-only synthetic environment'),criteria:['add-job','change-stage','reload','export'],limits:{timeoutMs:25000,outputBytes:16384,artifactBytes:65536}});
const html=(task:string)=>`<!doctype html><html><title>Captured synthetic ${task}</title><body><p>Policy fixture; this is not a browser acceptance proof.</p></body></html>`;
class FixtureExecutor implements TestExecutor {
  calls:TestExecution[]=[];reaped:string[]=[];
  handler=async(request:TestExecution,_signal:AbortSignal):Promise<TestReport>=>({format:'trellis/test-report/v0.7-alpha',operationId:request.operationId,requestDigest:request.requestDigest,
    manifestDigest:request.manifestDigest,artifactDigest:request.artifact.digest,checks:['add-job','change-stage','reload','export'].map(id=>({id:id as TestReport['checks'][number]['id'],passed:true,observation:'Synthetic policy result only'})),
    exported:{digest:digest('{"version":1,"jobs":[]}'),bytes:23},exitCode:0,stdout:{digest:digest(''),bytes:0},stderr:{digest:digest(''),bytes:0},scratchBytesPeak:0,scratchRemoved:true});
  async execute(request:TestExecution,signal:AbortSignal){this.calls.push(structuredClone(request));return this.handler(request,signal);}
  async reap(operationId:string){assert.ok(this.calls.some(call=>call.operationId===operationId),'Synthetic cleanup may target only an operation actually owned by this fixture');this.reaped.push(operationId);}
}
interface Summary {status:string;candidateRevision:string;tasks:{id:string;status:string;actionDigest:string|null;proposal?:unknown;receipt:unknown;acceptance:unknown}[]}
test('CLI sessions compose real PostgreSQL, DBOS, exact approval and retained admission without native/model execution',{skip:!enabled,timeout:120000},async t=>{
  const credentialFile=process.env.TRELLIS_CLI_CREDENTIALS_FILE;if(!credentialFile)throw Error('Supply the existing private proof credential path.');
  const {POSTGRES_PASSWORD:password}=JSON.parse(await readFile(credentialFile,'utf8'));if(typeof password!=='string'||!password)throw Error('Missing private proof credential.');
  const connection={host:'127.0.0.1',port:56582,user:'postgres',password,ssl:false,connectionTimeoutMillis:3000,idleTimeoutMillis:500,application_name:'trellis_cli_test'};
  const evidence:{observedAt:string;modelCalls:number;browserCalls:number;cases:Record<string,unknown>[];passed?:boolean}={observedAt:new Date().toISOString(),modelCalls:0,browserCalls:0,cases:[]};
  const run=async(name:string,check:(f:Awaited<ReturnType<typeof setup>>)=>Promise<void>)=>t.test(name,async()=>{
    const f=await setup();const result:Record<string,unknown>={name,database:f.database,passed:false};
    try{await check(f);await f.unchangedAdmission();assert.deepEqual(await readdir(f.nativeRoot),[]);await assert.rejects(stat(f.config.codex.installation.nativePath),{code:'ENOENT'});
      assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM trellis_runtime.runs WHERE state->\'process\'<>\'null\'::jsonb')).rows[0].n,0);result.passed=true;
    }finally{
      const errors:string[]=[];for(const port of [...f.ports])try{await port.close();}catch{errors.push('session');}
      if(DBOS.isInitialized())try{await DBOS.shutdown({deregister:true,workflowCompletionTimeoutMS:1000});}catch{errors.push('dbos');}
      try{await f.pool.end();}catch{errors.push('pool');}
      try{await f.admin.query(`DROP DATABASE "${f.database}"`);result.databaseAbsent=(await f.admin.query('SELECT datname FROM pg_database WHERE datname=$1',[f.database])).rowCount===0;}catch{errors.push('database');}
      try{await f.admin.end();}catch{errors.push('admin');}
      try{await rm(f.root,{recursive:true,force:true});result.scratchRemoved=true;}catch{errors.push('scratch');}
      result.cleanupErrors=errors;result.syntheticTestExecutions=f.executor.calls.length;result.noNativeExecutable=true;result.dbosStopped=!DBOS.isInitialized();evidence.cases.push(result);
      evidence.passed=evidence.cases.length===4&&evidence.cases.every(c=>c.passed&&c.databaseAbsent&&c.scratchRemoved&&c.dbosStopped&&Array.isArray(c.cleanupErrors)&&c.cleanupErrors.length===0);
      await mkdir('dist/alpha-cli-postgres-evidence',{recursive:true});await writeFile('dist/alpha-cli-postgres-evidence/test-result.json',JSON.stringify(evidence,null,2)+'\n');if(errors.length)throw Error('Synthetic CLI test cleanup failed.');
    }
  });
  async function setup(){
    assert.equal(DBOS.isInitialized(),false);const database=`trellis_cli_test_${randomBytes(8).toString('hex')}`;
    const admin=new pg.Client({...connection,database:'postgres'}),pool=new pg.Pool({...connection,database,max:4});pool.on('error',()=>{});
    const root=await realpath(await mkdtemp(join(tmpdir(),'trellis-cli-')));const nativeRoot=join(root,'native');await mkdir(nativeRoot,{mode:0o700});
    const ports=new Set<SessionPort>();let created=false;
    try{
      await admin.connect();await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;
      const admission=new PostgresAdmission(pool,{schema:'trellis_admission',launcherId:'synthetic-ledger-only'});
      await admission.createSchema([{accountId:'synthetic-account',aliases:['synthetic-alias'],policy:{thresholdPercent:75,maxWorkers:2,headroomPercent:8,maxObservationAgeMs:5000,admittedRoutes:[MODEL_ROUTE],completedResetPolicy:'hold'}}]);
      const at=Date.now();const held=await admission.reserve({accountAlias:'synthetic-alias',jobId:'existing-held-allowance',candidateRevision:digest('preexisting synthetic allowance'),modelRoute:MODEL_ROUTE,role:'worker',attempt:'initial',allowancePercent:{primary:2},paidFallback:false},
        {observationId:'synthetic-observation',accountId:'synthetic-account',observedAtMs:at,authentication:'subscription',ordinaryUsageAllowed:true,windows:{primary:{usedPercent:20,resetAtMs:at+1000000,durationMs:1000000,accountedThroughMs:null},secondary:null},routes:{[MODEL_ROUTE]:{requiredWindows:['primary'],optionalWindows:['secondary']}}});assert.equal(held.kind,'accepted');
      const graph=await prepareEndorAlpha({sourceDirectory:resolve('examples/endor-alpha'),destination:join(root,'crew'),manifest,workspaceId:'synthetic-workspace',runId:'synthetic-run'});
      const config=localInstallation({format:'trellis/local-installation/v0.7-alpha',installationId:'alpha-cli-proof',database:{host:'127.0.0.1',port:56582,name:database,credentialsFile:resolve(credentialFile!)},
        schemas:{runtime:'trellis_runtime',broker:'trellis_broker',admission:'trellis_admission',effects:'trellis_effects',graph:'trellis_graph',tests:'trellis_tests'},graph,
        bridge:{accountAlias:'synthetic-alias',modelRoute:MODEL_ROUTE,allowancePercent:{primary:2},approverSubjects:['operator:synthetic'],readyAtMs:at,leaseExpiresAtMs:at+1800000},workspaceRoot:join(root,'crew'),
        codex:{installation:{nativePath:join(nativeRoot,'unavailable-native'),nativeSha256:SUPPORTED_NATIVE_SHA256,version:'0.157.0',workRoot:nativeRoot},binding:{canonicalAccountId:'synthetic-account',aliases:['synthetic-alias'],providerAccountSha256:'0'.repeat(64),requiredWindows:['primary'],optionalWindows:['secondary']},stopUsedPercent:75},browser:{}});
      await provisionLocalInstallation(config);
      const before=(await pool.query('SELECT account_id,version,state,checksum FROM trellis_admission.accounts')).rows;
      const unchangedAdmission=async()=>assert.deepEqual((await pool.query('SELECT account_id,version,state,checksum FROM trellis_admission.accounts')).rows,before);
      const store=new PostgresGraphStore(pool,config.schemas.graph),ledger=new RuntimeLedger(pool,config.schemas.runtime),broker=new PostgresBrokerStore(pool,{schema:config.schemas.broker});
      const driver=new GraphDriver(store,{async submit(){throw Error('Seed driver cannot dispatch');},async inspect(){throw Error('Seed driver cannot inspect runtime');}});
      const submitted=await driver.submit(graph),graphId=submitted.state.id;const executor=new FixtureExecutor();const seeded=new Set<string>();let afterAdvance:((view:GraphView)=>Promise<void>)|undefined;
      const runId=(taskId:string)=>digest(canonicalJson({workspaceId:graph.workspaceId,runId:graph.runId,taskId}));
      const seed=async(taskId:string)=>{
        const state=(await driver.status(graphId)).state;assert.equal(state.tasks[taskId]!.claim,null,'Seed captured output before the real graph claims the task');
        const request=taskRequest(state,taskId),policy=config.bridge;
        if(taskId==='build'){assert.equal(request.inputs.draft!.artifact.content,html('design'));assert.equal(request.inputs.draft!.valueDigest,digest(html('design')));}
        const input:RunInput={plan:request.plan,task:{workspaceId:request.workspaceId,runId:request.runId,taskId,ownerSubject:request.ownerSubject,ownerEpoch:request.ownerEpoch,approverSubjects:policy.approverSubjects,readyAtMs:policy.readyAtMs,leaseExpiresAtMs:policy.leaseExpiresAtMs,completedDependencies:request.completedDependencies},
          taskInput:renderTask(request),reservation:{accountAlias:policy.accountAlias,jobId:request.executionId,candidateRevision:request.candidateRevision,modelRoute:policy.modelRoute,role:'worker',attempt:'initial',allowancePercent:policy.allowancePercent,paidFallback:false}};
        const created=await ledger.create(input),effect=request.plan.definition.tasks.find(v=>v.id===taskId)!.effects.find(v=>v.operation==='workspace.write')!;assert.equal(effect.operation,'workspace.write');
        await ledger.change(created.id,current=>{current.proposal={format:'trellis/action/v0.7-alpha',scope:{workspaceId:request.workspaceId,runId:request.runId,taskId},requestId:`write-${request.executionId.slice(7)}`,candidateRevision:request.candidateRevision,ownerEpoch:request.ownerEpoch,edit:{operation:'workspace.write',path:effect.path,expectedDigest:null,content:html(taskId)}};});seeded.add(taskId);
      };
      const track=async(mode:'start'|'read'|'cancel',value:LocalInstallation=config)=>{
        const real=await openLocalSession(value,executor,mode);const port:SessionPort={...real,async advance(){const view=await real.advance();await afterAdvance?.(view);return view;},async close(){try{await real.close();}finally{ports.delete(port);}}};ports.add(port);return port;
      };
      const command=async(kind:SessionCommand['command'],args:{candidate?:string;action?:string;signal?:AbortSignal;seedBuild?:boolean}={})=>{
        const mode=kind==='status'||kind==='review'?'read':kind==='cancel'?'cancel':'start',port=await track(mode);let summary:Summary|undefined;const started=Date.now();
        const parsed:SessionCommand=kind==='approve'?{command:kind,installation:'synthetic-only',candidate:args.candidate!,action:args.action!}:kind==='up'?{command:kind,installation:'synthetic-only',tier:'pro'}:{command:kind,installation:'synthetic-only'};
        await executeSession(parsed,port,value=>{assert.equal(DBOS.isInitialized(),false,'Session closes DBOS before emitting');summary=value as Summary;},args.signal??new AbortController().signal,
          async()=>{if(args.seedBuild&&!seeded.has('build')&&(await driver.status(graphId)).state.tasks.design!.observation?.status==='COMPLETED')await seed('build');await delay(10);},
          ()=>started+(Date.now()-started)*10); // Bound a broken polling path to about twelve seconds, without changing real proof/lease clocks.
        assert.ok(summary);return summary;
      };
      const snapshot=async(taskId:string)=>{const path=join(config.workspaceRoot,taskId==='design'?'output/design/index.html':'output/job-board/index.html');const s=await stat(path,{bigint:true});return{content:await readFile(path,'utf8'),inode:String(s.ino),mtime:String(s.mtimeNs)};};
      return{database,admin,pool,root,nativeRoot,ports,config,executor,driver,ledger,broker,graphId,seed,runId,track,command,snapshot,unchangedAdmission,setAdvanceHook(hook:(view:GraphView)=>Promise<void>){afterAdvance=hook;}};
    }catch(error){for(const port of ports)await port.close().catch(()=>{});if(DBOS.isInitialized())await DBOS.shutdown({deregister:true,workflowCompletionTimeoutMS:1000});await pool.end();if(created)await admin.query(`DROP DATABASE "${database}"`);await admin.end();await rm(root,{recursive:true,force:true});throw error;}
  }
  await run('read commands and mismatched configurations cannot start DBOS or dispatch',async f=>{
    assert.equal((await f.pool.query("SELECT to_regnamespace('dbos') AS schema")).rows[0].schema,null);
    const status=await f.command('status');assert.equal(status.status,'READY');assert.ok(status.tasks.every(t=>t.status==='NOT_STARTED'));
    const review=await f.command('review');assert.ok(review.tasks.every(t=>t.proposal===null));assert.equal(f.executor.calls.length,0);assert.equal(DBOS.isInitialized(),false);
    const changed=structuredClone(f.config);changed.graph.owners.coda!.epoch++;
    for(const mode of ['start','read','cancel']as const){await assert.rejects(f.track(mode,changed));assert.equal(DBOS.isInitialized(),false);assert.equal((await f.driver.status(f.graphId)).state.cancelRequested,false);}
    const bad=structuredClone(f.config);bad.bridge.modelRoute='unregistered' as typeof MODEL_ROUTE;await assert.rejects(f.track('start',bad),{code:'INVALID_POLICY'});
    assert.equal((await f.pool.query("SELECT to_regnamespace('dbos') AS schema")).rows[0].schema,null);assert.equal(f.executor.calls.length,0);
  });
  await run('exact approval crosses the broker lifetime boundary and both tasks survive restart without replay',async f=>{
    await f.seed('design');const pending=await f.command('up');assert.equal(pending.status,'WAITING_APPROVAL');assert.equal(pending.tasks[0]!.status,'WAITING_APPROVAL');assert.equal(f.executor.calls.length,0);
    await assert.rejects(f.command('approve',{candidate:digest('stale candidate'),action:pending.tasks[0]!.actionDigest!}),{code:'STALE_APPROVAL'});
    await assert.rejects(f.command('approve',{candidate:pending.candidateRevision,action:digest('wrong action')}),{code:'STALE_APPROVAL'});
    const beforeApproval=await f.broker.read({workspaceId:f.config.graph.workspaceId,runId:f.config.graph.runId,taskId:'design'});assert.equal(Object.values(beforeApproval.actions)[0]!.approval,null);await assert.rejects(f.snapshot('design'),{code:'ENOENT'});
    // Force the legal interleaving: advance returns the approved task's old WAITING view,
    // then acceptance commits COMPLETED before executeSession decides whether to stop.
    let entered!:()=>void,release!:()=>void,raced=false;const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
    const normal=f.executor.handler;f.executor.handler=async(request,signal)=>{if(request.scope.taskId==='design'){entered();await gate;}return normal(request,signal);};
    f.setAdvanceHook(async view=>{if(!raced&&view.status==='WAITING_APPROVAL'&&view.state.tasks.design!.observation?.status==='WAITING_APPROVAL'){
      await Promise.race([started,delay(3000).then(()=>{throw Error('Synthetic acceptance did not start');})]);release();
      for(let i=0;i<300;i++){if((await f.ledger.read(f.runId('design'))).status==='COMPLETED'){raced=true;break;}await delay(10);}assert.equal(raced,true);
    }});
    const approvedAt=Date.now();const second=await f.command('approve',{candidate:pending.candidateRevision,action:pending.tasks[0]!.actionDigest!,seedBuild:true});
    assert.equal(raced,true);assert.equal(second.status,'WAITING_APPROVAL');assert.equal(second.tasks[0]!.status,'COMPLETED');assert.equal(second.tasks[1]!.status,'WAITING_APPROVAL');assert.equal(f.executor.calls.length,1);
    const approved=Object.values((await f.broker.read(beforeApproval.scope)).actions)[0]!.approval!;assert.ok(approved.expiresAtMs-approvedAt>45000,'One-minute approval must fit the two-minute operator proof, not the old thirty-second proof');
    const firstSnapshot=await f.snapshot('design');assert.equal(firstSnapshot.content,html('design'));
    const completed=await f.command('approve',{candidate:second.candidateRevision,action:second.tasks[1]!.actionDigest!});assert.equal(completed.status,'COMPLETED');assert.equal(f.executor.calls.length,2);assert.equal(f.executor.reaped.length,2);
    const finalSnapshot=await f.snapshot('build');assert.equal(finalSnapshot.content,html('build'));
    assert.equal((await f.command('up')).status,'COMPLETED');assert.equal((await f.command('review')).status,'COMPLETED');assert.deepEqual(await f.snapshot('design'),firstSnapshot);assert.deepEqual(await f.snapshot('build'),finalSnapshot);assert.equal(f.executor.calls.length,2);
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM trellis_effects.operations')).rows[0].n,2);assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM trellis_tests.tests WHERE state->>'status'='PASSED'")).rows[0].n,2);
    assert.equal((await f.ledger.read(f.runId('design'))).process,null);assert.equal((await f.ledger.read(f.runId('build'))).process,null);
  });
  await run('cancel persists before recovery and pending approval cannot dispatch after restart',async f=>{
    await f.seed('design');const pending=await f.command('up');assert.equal(pending.status,'WAITING_APPROVAL');
    assert.equal((await f.command('cancel')).status,'CANCELLED');assert.equal((await f.command('status')).status,'CANCELLED');
    await assert.rejects(f.command('approve',{candidate:pending.candidateRevision,action:pending.tasks[0]!.actionDigest!}),{code:'APPROVAL_UNAVAILABLE'});
    assert.equal(f.executor.calls.length,0);await assert.rejects(f.snapshot('design'),{code:'ENOENT'});assert.equal((await f.ledger.read(f.runId('design'))).cancelled,true);assert.equal((await f.driver.status(f.graphId)).state.tasks.build!.claim,null);
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM trellis_effects.operations')).rows[0].n,0);
  });
  await run('interrupt during acceptance reaps the owned test and preserves the completed write receipt',async f=>{
    await f.seed('design');const pending=await f.command('up');assert.equal(pending.status,'WAITING_APPROVAL');const abort=new AbortController();
    f.executor.handler=async(_request,signal)=>{abort.abort();await new Promise<never>((_,reject)=>{const stopped=()=>reject(Error('Synthetic executor cancelled'));signal.addEventListener('abort',stopped,{once:true});if(signal.aborted)stopped();});throw Error('unreachable');};
    const cancelled=await f.command('approve',{candidate:pending.candidateRevision,action:pending.tasks[0]!.actionDigest!,signal:abort.signal});assert.equal(cancelled.status,'CANCELLED');
    const state=await f.ledger.read(f.runId('design'));assert.ok(state.receipt);assert.equal(state.acceptance,null);assert.equal(state.cancelled,true);assert.equal(f.executor.calls.length,1);assert.ok(f.executor.reaped.length>=1);assert.deepEqual([...new Set(f.executor.reaped)],[f.executor.calls[0]!.operationId]);
    assert.equal((await f.pool.query('SELECT state FROM trellis_tests.tests')).rows[0].state.status,'CANCELLED');assert.equal((await f.driver.status(f.graphId)).state.tasks.build!.claim,null);
    const saved=await f.snapshot('design');assert.equal((await f.command('status')).status,'CANCELLED');assert.deepEqual(await f.snapshot('design'),saved);assert.equal(f.executor.calls.length,1);
  });
});
