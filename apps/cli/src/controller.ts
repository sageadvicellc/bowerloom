import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import pg from 'pg';
import { canonicalJson, digest, DefinitionError } from '../../../packages/contracts/src/index.js';
import { strictJson } from '../../../packages/codex-adapter/src/safe.js';
import { CodexAdapter, CodexObservationReader } from '../../../packages/codex-adapter/src/index.js';
import type { Installation, AccountBinding } from '../../../packages/codex-adapter/src/index.js';
import { PostgresBrokerStore } from '../../../packages/broker-postgres/src/index.js';
import { PostgresWorkspaceEffects } from '../../../packages/workspace-effects/src/index.js';
import { GraphDriver, PostgresGraphStore, pinGraph } from '../../../packages/graph/src/index.js';
import type { GraphInput, GraphView } from '../../../packages/graph/src/index.js';
import { RuntimeTaskBridge, pinBridgePolicy } from '../../../packages/runtime-bridge/src/index.js';
import type { BridgePolicy } from '../../../packages/runtime-bridge/src/index.js';
import { PostgresAdmission } from '../../../packages/admission/src/index.js';
import type { AdmissionPolicy } from '../../../packages/admission/src/index.js';
import { provisionalMargin } from '../../../packages/codex-adapter/src/observation.js';
import { RuntimeLedger, SupervisedRuntime, RuntimeError } from '../../../packages/runtime/src/index.js';
import { PostgresTestStore, RegisteredTestAcceptance, validateTestManifestPlan } from '../../../packages/controlled-tests/src/index.js';
import type { TestExecutor } from '../../../packages/controlled-tests/src/index.js';
import type { SessionPort } from './session.js';

export interface LocalInstallation {
  format:'trellis/local-installation/v0.7-alpha';
  installationId:string;
  database:{host:'127.0.0.1';port:number;name:string;credentialsFile:string};
  schemas:{runtime:string;broker:string;admission:string;effects:string;graph:string;tests:string};
  graph:GraphInput;
  bridge:BridgePolicy;
  workspaceRoot:string;
  codex:{installation:Installation;binding:AccountBinding;stopUsedPercent:number;provisionalPercent?:number};
  browser:unknown;
}
function fail(code:string):never{throw new DefinitionError(code,'The local installation does not meet the declared alpha contract.');}
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join()===keys.sort().join();
export async function privateJson(file:string,limit=2*1024*1024):Promise<unknown>{
  const path=resolve(file);if(await realpath(path)!==path)fail('INSTALLATION_PATH');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await fd.stat();
    if(!before.isFile()||before.nlink!==1||before.size>limit||(before.mode&0o077)!==0||before.uid!==process.getuid?.())fail('PRIVATE_FILE_REQUIRED');
    const bytes=Buffer.alloc(limit+1);let size=0;
    while(size<bytes.length){const read=await fd.read(bytes,size,bytes.length-size,null);if(!read.bytesRead)break;size+=read.bytesRead;}
    const after=await fd.stat();
    if(size>limit||size!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)fail('INSTALLATION_CHANGED');
    return structuredClone(strictJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)),limit));
  }finally{await fd.close();}
}
export function localInstallation(value:unknown):LocalInstallation{
  if(!exact(value,['format','installationId','database','schemas','graph','bridge','workspaceRoot','codex','browser'])
    ||value.format!=='trellis/local-installation/v0.7-alpha'||typeof value.installationId!=='string'
    ||!/^alpha-[a-z0-9-]{1,64}$/.test(value.installationId))fail('INSTALLATION_FORMAT');
  const db=value.database;
  if(!exact(db,['host','port','name','credentialsFile'])||db.host!=='127.0.0.1'||!Number.isInteger(db.port)
    ||(db.port as number)<1024||(db.port as number)>65535||typeof db.name!=='string'||!/^trellis_[a-z0-9_]{1,60}$/.test(db.name)
    ||typeof db.credentialsFile!=='string'||!isAbsolute(db.credentialsFile))fail('LOCAL_DATABASE_REQUIRED');
  if(!exact(value.schemas,['runtime','broker','admission','effects','graph','tests'])
    ||Object.values(value.schemas).some(name=>typeof name!=='string'||!/^trellis_[a-z][a-z0-9_]{0,46}$/.test(name)))fail('INSTALLATION_SCHEMA');
  if(new Set(Object.values(value.schemas)).size!==6)fail('INSTALLATION_SCHEMA');
  if(typeof value.workspaceRoot!=='string'||!isAbsolute(value.workspaceRoot))fail('WORKSPACE_ROOT');
  if((!exact(value.codex,['installation','binding','stopUsedPercent'])&&!exact(value.codex,['installation','binding','stopUsedPercent','provisionalPercent']))||typeof value.codex.stopUsedPercent!=='number'
    ||!Number.isFinite(value.codex.stopUsedPercent)||value.codex.stopUsedPercent>95||value.codex.stopUsedPercent<=10)fail('CAPACITY_POLICY');
  if(value.codex.provisionalPercent!==undefined)provisionalMargin(value.codex.provisionalPercent as number);
  const graph=pinGraph(value.graph as GraphInput);
  if(graph.plan.definition.tasks.some(task=>!task.effects.some(effect=>effect.operation==='command.test')))fail('TEST_GATE_REQUIRED');
  pinBridgePolicy(value.bridge as BridgePolicy);
  return structuredClone(value) as unknown as LocalInstallation;
}
export function enforceLocalBudget(config:LocalInstallation,policy:AdmissionPolicy):void{
  const margin=provisionalMargin(config.codex.provisionalPercent);
  const allowance=Math.max(...Object.values(config.bridge.allowancePercent));
  if(policy.thresholdPercent>config.codex.stopUsedPercent||policy.thresholdPercent>100-config.graph.plan.definition.budget.reservePercent
    ||policy.maxWorkers>config.graph.plan.definition.budget.maxActiveWorkers||!policy.admittedRoutes.includes(config.bridge.modelRoute)
    ||margin<policy.headroomPercent+allowance)fail('CREW_BUDGET_NOT_ENFORCED');
}
export async function openLocalSession(config:LocalInstallation,executor:TestExecutor,mode:'start'|'read'|'cancel'):Promise<SessionPort>{
  config=localInstallation(config);
  const graph=pinGraph(config.graph),manifest=graph.assets['test-manifest'];
  if(!manifest)fail('TEST_MANIFEST_REQUIRED');validateTestManifestPlan(graph.plan,manifest);
  if(config.codex.stopUsedPercent>100-graph.plan.definition.budget.reservePercent)fail('CREW_BUDGET_NOT_ENFORCED');
  const secret=await privateJson(config.database.credentialsFile,16384);
  if(!secret||typeof secret!=='object'||typeof (secret as Record<string,unknown>).POSTGRES_PASSWORD!=='string')fail('DATABASE_CREDENTIAL_REQUIRED');
  const password=(secret as {POSTGRES_PASSWORD:string}).POSTGRES_PASSWORD;if(!password)fail('DATABASE_CREDENTIAL_REQUIRED');
  const pool=new pg.Pool({host:config.database.host,port:config.database.port,database:config.database.name,user:'postgres',password,
    ssl:false,max:6,connectionTimeoutMillis:3000,idleTimeoutMillis:500,application_name:'trellis_alpha_cli'});
  pool.on('error',()=>{});
  let runtime:SupervisedRuntime|undefined,acceptance:RegisteredTestAcceptance|undefined;
  const runId=(taskId:string)=>digest(canonicalJson({workspaceId:graph.workspaceId,runId:graph.runId,taskId}));
  const ledger=new RuntimeLedger(pool,config.schemas.runtime),store=new PostgresGraphStore(pool,config.schemas.graph);
  const id=digest(canonicalJson({workspaceId:graph.workspaceId,runId:graph.runId}));
  const ownerTokens=new Map(Object.values(graph.owners).map(owner=>[owner.subject,Object.freeze({subject:owner.subject})]));
  const approver=Object.freeze({kind:'local-operator'});
  const identity={async authenticate(token:unknown){
    const subject=token===approver?config.bridge.approverSubjects[0]:[...ownerTokens].find(([,value])=>value===token)?.[0];
    if(!subject)throw new Error('Unauthenticated');return{subject,proofRef:`local-${config.installationId}`,expiresAtMs:Date.now()+(token===approver?120000:30000)};
  }};
  try{
    let driver:GraphDriver;
    if(mode==='start')enforceLocalBudget(config,await new PostgresAdmission(pool,{schema:config.schemas.admission,launcherId:'local-preflight'}).policy(config.bridge.accountAlias));
    const stored=new GraphDriver(store,{async submit(){fail('NO_DISPATCH');},async inspect(){fail('NO_DISPATCH');}});
    if(mode==='start')await stored.submit(graph);
    else if(canonicalJson((await stored.status(id)).state.input)!==canonicalJson(graph))fail('GRAPH_BINDING');
    if(mode==='cancel'){
      const cancelled=new GraphDriver(store,{async submit(){fail('CANCEL_ONLY');},async inspect(){fail('CANCEL_ONLY');}});
      await cancelled.cancel(id);
      for(const taskId of graph.plan.taskOrder){
        try{await ledger.change(runId(taskId),state=>{state.cancelled=true;state.status='CANCELLED';state.reason='CANCELLED';});}
        catch(error){if(!(error instanceof RuntimeError&&error.code==='UNKNOWN_RUN'))throw error;}
      }
    }
    if(mode!=='read'){
      const paths=graph.plan.definition.tasks.flatMap(task=>task.effects.flatMap(e=>e.operation==='workspace.write'?[e.path]:[]));
      const effects=await PostgresWorkspaceEffects.open(pool,{schema:config.schemas.effects,
        workspaces:[{workspaceId:graph.workspaceId,root:config.workspaceRoot,writablePaths:paths}]});
      acceptance=new RegisteredTestAcceptance({store:new PostgresTestStore(pool,{schema:config.schemas.tests,brokerSchema:config.schemas.broker}),manifest,executor,identity});
      const uri=new URL(`postgresql://127.0.0.1:${config.database.port}/${config.database.name}`);uri.username='postgres';uri.password=password;
      runtime=await SupervisedRuntime.open({pool,brokerStore:new PostgresBrokerStore(pool,{schema:config.schemas.broker}),effects,identity,
        ownerCredential:null,ownerCredentialFor:input=>ownerTokens.get(input.task.ownerSubject),recoveryCredential:approver,
        observations:new CodexObservationReader(config.codex.installation,config.codex.binding,config.codex.stopUsedPercent,config.codex.provisionalPercent),
        models:new CodexAdapter({...config.codex,accountAlias:config.bridge.accountAlias}),acceptance},
        {installationId:config.installationId,schema:config.schemas.runtime,admissionSchema:config.schemas.admission,systemDatabaseUrl:uri.href});
      driver=new GraphDriver(store,new RuntimeTaskBridge(graph,config.bridge,store,runtime,manifest));
      await driver.submit(graph);
    }else{
      driver=new GraphDriver(store,{async submit(){fail('READ_ONLY_COMMAND');},async inspect(){fail('READ_ONLY_COMMAND');}});
    }
    return{
      status:()=>driver.status(id),advance:()=>driver.advance(id),
      async run(taskId){try{return await ledger.read(runId(taskId));}catch(error){if(error instanceof RuntimeError&&error.code==='UNKNOWN_RUN')return null;throw error;}},
      async approve(taskId,candidateRevision,actionDigest){
        if(!runtime)fail('READ_ONLY_COMMAND');const state=await ledger.read(runId(taskId));
        await runtime.approve(state.id,{candidateRevision,actionDigest,ownerEpoch:state.input.task.ownerEpoch,
          expiresAtMs:Math.min(Date.now()+60000,state.input.task.leaseExpiresAtMs,state.input.task.readyAtMs+state.input.plan.definition.tasks.find(task=>task.id===taskId)!.policy.deadlineSeconds*1000)},approver);
      },
      async cancel(){if(!runtime)fail('READ_ONLY_COMMAND');await driver.cancel(id);for(const taskId of graph.plan.taskOrder){
        try{await runtime.cancel(runId(taskId));}catch(error){if(!(error instanceof RuntimeError&&error.code==='UNKNOWN_RUN'))throw error;}
      }},
      async close(){try{if(runtime)await runtime.close();if(acceptance)await acceptance.close();}finally{await pool.end();}},
    };
  }catch(error){try{if(runtime)await runtime.close();if(acceptance)await acceptance.close();}finally{await pool.end();}throw error;}
}
