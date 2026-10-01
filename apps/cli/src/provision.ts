import { constants } from 'node:fs';
import { open, lstat, realpath, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import pg from 'pg';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { stringify } from 'yaml';
import { canonicalJson, digest, DefinitionError, validateDefinition } from '../../../packages/contracts/src/index.js';
import type { Effect } from '../../../packages/contracts/src/index.js';
import { authoredGraph, validateAuthoredCrew, AUTHORING_LIMITS, checked, parseJson } from '../../../packages/authoring/src/index.js';
import type { AuthoredCrew, AuthoringManifest } from '../../../packages/authoring/src/index.js';
import { parseCrew, compileCrew } from '../../../packages/crew/src/index.js';
import type { GraphInput } from '../../../packages/graph/src/index.js';
import { copyJson, identifier } from '../../../packages/graph/src/validation.js';
import { RuntimeLedger } from '../../../packages/runtime/src/ledger.js';
import { PostgresBrokerStore } from '../../../packages/broker-postgres/src/index.js';
import { PostgresWorkspaceEffects } from '../../../packages/workspace-effects/src/index.js';
import { PostgresGraphStore } from '../../../packages/graph/src/index.js';
import { PostgresTestStore, validateRegisteredManifest, validateTestManifestPlan } from '../../../packages/controlled-tests/src/index.js';
import { ADMISSION_VERSION } from '../../../packages/admission/src/index.js';
import { stateCopy } from '../../../packages/admission/src/validation.js';
import { strictJson } from '../../../packages/codex-adapter/src/safe.js';

const schemaPattern=/^trellis_[a-z][a-z0-9_]{0,46}$/;
const same=(a:unknown,b:unknown):boolean=>canonicalJson(a)===canonicalJson(b);
function fail(code:string):never{throw new DefinitionError(code,'The alpha preparation or provisioning requirement was not met. No launch was requested.');}
function exact(value:unknown,keys:string[]):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)&&same(Object.keys(value).sort(),[...keys].sort());}
async function directory(path:string,privateMode=false):Promise<string>{
  if(!isAbsolute(path)||resolve(path)!==path||await realpath(path)!==path)fail('UNSAFE_DIRECTORY');
  const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||(privateMode&&(stat.uid!==process.getuid?.()||(stat.mode&0o077)!==0)))fail('UNSAFE_DIRECTORY');return path;
}
async function textFile(path:string,limit:number,privateMode=false):Promise<string>{
  if(await realpath(path)!==path)fail('UNSAFE_SOURCE');const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await handle.stat();if(!before.isFile()||before.nlink!==1||before.size>limit||(privateMode&&(before.uid!==process.getuid?.()||(before.mode&0o077)!==0)))fail('UNSAFE_SOURCE');
    const bytes=Buffer.alloc(limit+1);let size=0;while(size<bytes.length){const read=await handle.read(bytes,size,bytes.length-size,null);if(!read.bytesRead)break;size+=read.bytesRead;}
    const after=await handle.stat(),current=await lstat(path);
    if(size>limit||size!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||current.ino!==before.ino||current.dev!==before.dev||await realpath(path)!==path)fail('SOURCE_CHANGED');
    try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size));}catch{fail('INVALID_ENCODING');}
  }finally{await handle.close();}
}
const paths=['output/design/index.html','output/job-board/index.html'];
function demoGraph(value:GraphInput):GraphInput{
  const graph=copyJson(value,1024*1024);
  if(!exact(graph,['workspaceId','runId','plan','assets','owners'])||!identifier(graph.workspaceId)||!identifier(graph.runId))fail('DEMO_GRAPH');
  const manifest=graph.assets['test-manifest'];if(typeof manifest!=='string')fail('TEST_MANIFEST_REQUIRED');validateTestManifestPlan(graph.plan,manifest);
  const definition=graph.plan.definition;
  if(!same(graph.plan.taskOrder,['design','build'])||definition.tasks.length!==2||!same(definition.owners.map(o=>o.id).sort(),['coda','emery'])
    ||!same(Object.keys(graph.owners).sort(),['coda','emery'])||!same(Object.keys(graph.assets).sort(),Object.keys(graph.plan.assets).sort()))fail('DEMO_GRAPH');
  for(const owner of Object.values(graph.owners))if(!exact(owner,['subject','epoch'])||!identifier(owner.subject)||!Number.isSafeInteger(owner.epoch)||owner.epoch<1)fail('DEMO_OWNER');
  for(const [id,pinned]of Object.entries(graph.plan.assets)){const content=graph.assets[id];if(typeof content!=='string'||digest(content)!==pinned.digest||Buffer.byteLength(content)!==pinned.bytes)fail('ASSET_MISMATCH');}
  for(const [index,task]of definition.tasks.entries()){
    if(task.id!==['design','build'][index]||task.owner!==['emery','coda'][index]||!same(task.dependsOn,index?['design']:[])
      ||!same(task.effects,[{operation:'workspace.write',path:paths[index]},{operation:'command.test',command:'craft-shop-ui-v1'}])
      ||task.approval!=='required'||task.policy.maxAttempts!==1||task.policy.backoffSeconds!==0
      ||!same([...task.requires].sort(),['approval.exact-revision','command.test','workspace.write'])||Object.values(task.outputs).length!==1
      ||!same(Object.values(task.outputs)[0],{kind:'artifact',mediaType:'text/html'}))fail('DEMO_TASK');
  }
  return graph;
}
export interface PrepareEndorAlphaOptions {
  sourceDirectory:string;
  destination:string;
  manifest:string;
  workspaceId:string;
  runId:string;
  owners?:GraphInput['owners'];
  // Omitted means the public 25% reserve. Explicit overrides still pass crew schema validation.
  reservePercent?:number;
}
/** Materialize a new private portable snapshot. Never overwrite a previous candidate. */
export async function prepareEndorAlpha(options:PrepareEndorAlphaOptions):Promise<GraphInput>{
  const input=copyJson(options,16384);validateRegisteredManifest(input.manifest);
  const source=await directory(input.sourceDirectory);const destination=input.destination;
  if(!isAbsolute(destination)||resolve(destination)!==destination)fail('UNSAFE_DESTINATION');await directory(dirname(destination),true);
  const definition=parseCrew(await textFile(join(source,'crew.yaml'),32768));
  if(input.reservePercent!==undefined){definition.budget.reservePercent=input.reservePercent;validateDefinition(definition);}
  const assets:Record<string,string>={};let total=0;
  for(const [id,asset]of Object.entries(definition.assets)){
    if(id==='test-manifest')assets[id]=input.manifest;else assets[id]=await textFile(join(source,asset.path),16384);
    total+=Buffer.byteLength(assets[id]!);if(total>65536)fail('ASSET_LIMIT');
  }
  // mkdir without recursive is exclusive; existing destinations remain untouched.
  await mkdir(destination,{mode:0o700});
  await writeFile(join(destination,'crew.yaml'),stringify(definition),{mode:0o600,flag:'wx'});
  for(const [id,asset]of Object.entries(definition.assets)){
    const parent=dirname(join(destination,asset.path));if(parent!==destination)await mkdir(parent,{recursive:true,mode:0o700});
    await writeFile(join(destination,asset.path),assets[id]!,{mode:0o600,flag:'wx'});
  }
  const graph=demoGraph({workspaceId:input.workspaceId,runId:input.runId,plan:await compileCrew(join(destination,'crew.yaml')),assets,
    owners:input.owners??{emery:{subject:'agent:emery',epoch:1},coda:{subject:'agent:coda',epoch:1}}});
  for(const path of paths)await mkdir(dirname(join(destination,path)),{recursive:true,mode:0o700});
  return graph;
}

/** This installation profile accepts this exact Workbench scenario, not a bundle-selected substitute. */
export const AUTHORED_CRAFT_SHOP_SCENARIO_DIGEST='sha256:bc620b68e6c6a147f0e121327d5175a50c0b89ea23514e3202b8464ccb6827b8';
export interface AuthoredInstallationAuthority {
  bundle:unknown;
  frozenScenario:string;
  /** Exact canonical bytes returned by the trusted installed tester registry. */
  registeredManifest:string;
  /** Controller grants, supplied independently of the authored project. No path-prefix grants. */
  permissions:Record<string,Effect[]>;
}
export interface PrepareAuthoredCraftShopOptions extends AuthoredInstallationAuthority {
  destination:string;
  workspaceId:string;
  runId:string;
  owners:GraphInput['owners'];
}
function authoredProfile(value:AuthoredInstallationAuthority,bindings:Pick<GraphInput,'workspaceId'|'runId'|'owners'>):{bundle:AuthoredCrew;graph:GraphInput;crewPath:string}{
  if(typeof value.frozenScenario!=='string'||Buffer.byteLength(value.frozenScenario)>AUTHORING_LIMITS.jsonBytes
    ||digest(value.frozenScenario)!==AUTHORED_CRAFT_SHOP_SCENARIO_DIGEST)fail('FROZEN_SCENARIO_REQUIRED');
  const bundle=validateAuthoredCrew(value.bundle,value.frozenScenario);
  validateRegisteredManifest(value.registeredManifest);
  if(bundle.assets['test-manifest']!==value.registeredManifest)fail('TEST_MANIFEST_MISMATCH');
  const graph=authoredGraph(bundle,value.frozenScenario,bindings);
  const grants=copyJson(value.permissions,16384),definition=graph.plan.definition;
  if(!exact(grants,definition.owners.map(owner=>owner.id)))fail('AUTHORED_PERMISSIONS');
  const allowed:Effect[]=[...paths.map(path=>({operation:'workspace.write' as const,path})),{operation:'command.test',command:'craft-shop-ui-v1'}];
  const normalize=(effects:Effect[])=>effects.map(effect=>canonicalJson(effect)).sort();
  if(definition.scope.some(effect=>!allowed.some(grant=>same(grant,effect))))fail('AUTHORED_PERMISSIONS');
  for(const owner of definition.owners){
    const assigned=grants[owner.id];
    if(!Array.isArray(assigned)||assigned.some(effect=>!allowed.some(grant=>same(grant,effect)))
      ||!same(normalize(assigned),normalize(owner.permissions)))fail('AUTHORED_PERMISSIONS');
  }
  const manifest=checked<AuthoringManifest>('authoring',parseJson(bundle.assets[bundle.manifestAsset]!));
  // Reject file/directory aliases before materializing anything, including case-insensitive filesystem collisions.
  const files=[manifest.crew,...Object.values(graph.plan.assets).map(asset=>asset.path),...paths].map(path=>path.toLowerCase());
  if(files.some((path,index)=>files.some((other,j)=>j!==index&&(path===other||path.startsWith(`${other}/`)))))fail('AUTHORED_SNAPSHOT_PATH');
  return{bundle,graph,crewPath:manifest.crew};
}
async function verifyAuthoredSnapshot(root:string,profile:ReturnType<typeof authoredProfile>):Promise<void>{
  await directory(root,true);
  await textFile(join(root,profile.crewPath),1024*1024,true);
  for(const [name,asset]of Object.entries(profile.graph.plan.assets)){
    if(await textFile(join(root,asset.path),AUTHORING_LIMITS.assetBytes,true)!==profile.bundle.assets[name])fail('AUTHORED_SNAPSHOT_CHANGED');
  }
  const plan=await compileCrew(join(root,profile.crewPath),{root});
  if(!same(plan,profile.graph.plan))fail('AUTHORED_SNAPSHOT_CHANGED');
}
/** Trusted-controller preparation only. No identities, grants, or tester authority are inferred from bundle text. */
export async function prepareAuthoredCraftShop(options:PrepareAuthoredCraftShopOptions):Promise<GraphInput>{
  const input=copyJson(options,2*1024*1024);
  if(!exact(input,['bundle','frozenScenario','registeredManifest','permissions','destination','workspaceId','runId','owners']))fail('AUTHORED_PREPARATION');
  const profile=authoredProfile(input,{workspaceId:input.workspaceId,runId:input.runId,owners:input.owners});
  const destination=input.destination;
  if(typeof destination!=='string'||!isAbsolute(destination)||resolve(destination)!==destination)fail('UNSAFE_DESTINATION');
  await directory(dirname(destination),true);
  // Exclusive creation never adopts or replaces an existing snapshot. Partial failures remain for inspection.
  await mkdir(destination,{mode:0o700});
  const files=[{path:profile.crewPath,content:stringify(profile.graph.plan.definition)},
    ...Object.entries(profile.graph.plan.assets).map(([id,asset])=>({path:asset.path,content:profile.bundle.assets[id]!}))];
  for(const file of files){
    await mkdir(dirname(join(destination,file.path)),{recursive:true,mode:0o700});
    await writeFile(join(destination,file.path),file.content,{mode:0o600,flag:'wx'});
  }
  for(const path of paths)await mkdir(dirname(join(destination,path)),{recursive:true,mode:0o700});
  await verifyAuthoredSnapshot(destination,profile);
  return profile.graph;
}

/** Structural subset accepted directly from the controller's LocalInstallation. */
export interface ProvisioningConfiguration {
  installationId:string;
  database:{host:'127.0.0.1';port:number;name:string;credentialsFile:string};
  schemas:{runtime:string;broker:string;admission:string;effects:string;graph:string;tests:string};
  graph:GraphInput;
  bridge:{accountAlias:string;modelRoute:string};
  workspaceRoot:string;
  codex:{stopUsedPercent:number};
}
export interface ProvisioningReceipt {
  installationId:string;
  database:string;
  candidateRevision:string;
  createdSchemas:string[];
  admission:{schema:string;accountAlias:string;accountId:string;stateDigest:string};
  dbosHistory:'absent'|'empty';
  launches:0;
}
/** Provision only: no DBOS launch, account creation, observation, reservation or policy update. */
export async function provisionLocalInstallation(value:ProvisioningConfiguration):Promise<ProvisioningReceipt>{
  return provisionInstallation(value,demoGraph);
}
/** Validate the authored snapshot and trusted installation bindings before credentials or database access. */
export async function provisionAuthoredInstallation(value:ProvisioningConfiguration,authority:AuthoredInstallationAuthority):Promise<ProvisioningReceipt>{
  const config=copyJson(value,2*1024*1024),input=copyJson(authority,2*1024*1024);
  if(!exact(input,['bundle','frozenScenario','registeredManifest','permissions']))fail('AUTHORED_AUTHORITY');
  if(!config.graph)fail('AUTHORED_GRAPH_BINDING');
  const profile=authoredProfile(input,{workspaceId:config.graph.workspaceId,runId:config.graph.runId,owners:config.graph.owners});
  if(!same(config.graph,profile.graph))fail('AUTHORED_GRAPH_BINDING');
  await verifyAuthoredSnapshot(config.workspaceRoot,profile);
  return provisionInstallation(config,graph=>{if(!same(graph,profile.graph))fail('AUTHORED_GRAPH_BINDING');return profile.graph;});
}
async function provisionInstallation(value:ProvisioningConfiguration,profile:(value:GraphInput)=>GraphInput):Promise<ProvisioningReceipt>{
  const config=copyJson(value,2*1024*1024),db=config.database,schemas=config.schemas;
  if(!/^alpha-[a-z0-9-]{1,64}$/.test(config.installationId)||!exact(db,['host','port','name','credentialsFile'])||db.host!=='127.0.0.1'
    ||!Number.isSafeInteger(db.port)||db.port<1024||db.port>65535||!/^trellis_[a-z0-9_]{1,60}$/.test(db.name)
    ||typeof db.credentialsFile!=='string'||!isAbsolute(db.credentialsFile))fail('LOCAL_DATABASE_REQUIRED');
  if(!exact(schemas,['runtime','broker','admission','effects','graph','tests'])||Object.values(schemas).some(s=>typeof s!=='string'||!schemaPattern.test(s))||new Set(Object.values(schemas)).size!==6)fail('INSTALLATION_SCHEMA');
  if(!identifier(config.bridge.accountAlias)||!identifier(config.bridge.modelRoute)||!Number.isFinite(config.codex.stopUsedPercent)||config.codex.stopUsedPercent<=0||config.codex.stopUsedPercent>100-config.graph.plan.definition.budget.reservePercent)fail('CAPACITY_POLICY');
  const graph=profile(config.graph);await directory(config.workspaceRoot,true);
  const secret=strictJson(await textFile(resolve(db.credentialsFile),16384,true),16384) as Record<string,unknown>;
  if(!secret||typeof secret.POSTGRES_PASSWORD!=='string'||!secret.POSTGRES_PASSWORD)fail('DATABASE_CREDENTIAL_REQUIRED');
  const pool=new pg.Pool({host:db.host,port:db.port,database:db.name,user:'postgres',password:secret.POSTGRES_PASSWORD,ssl:false,max:1,
    connectionTimeoutMillis:3000,idleTimeoutMillis:500,application_name:'trellis_alpha_provision'});pool.on('error',()=>{});
  let client:PoolClient|undefined,committing=false,discard=false;
  try{
    client=await pool.connect();await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='10s';SET LOCAL idle_in_transaction_session_timeout='10s';SET LOCAL synchronous_commit='on'");
    if((await client.query('SELECT current_database() AS name')).rows[0]?.name!==db.name)fail('DATABASE_BINDING');
    const dbosSchema=(await client.query("SELECT oid FROM pg_namespace WHERE nspname='dbos'")).rowCount;
    let history:'absent'|'empty'='absent';
    if(dbosSchema){
      const table=(await client.query("SELECT to_regclass('dbos.workflow_status') AS name")).rows[0]?.name;
      if(!table)fail('DBOS_HISTORY_UNRECOGNIZED');
      if((await client.query('SELECT 1 FROM dbos.workflow_status LIMIT 1')).rowCount)fail('DBOS_HISTORY_PRESENT');history='empty';
    }
    const quoted=`"${schemas.admission}"`;
    const metadata=(await client.query(`SELECT singleton,version FROM ${quoted}.metadata FOR SHARE`)).rows;
    if(metadata.length!==1||metadata[0].singleton!==true||metadata[0].version!==ADMISSION_VERSION)fail('ADMISSION_SCHEMA_REQUIRED');
    const rows=(await client.query(`SELECT a.account_id,a.version,a.state,a.checksum FROM ${quoted}.accounts a JOIN ${quoted}.aliases b ON a.account_id=b.account_id WHERE b.alias=$1 FOR SHARE OF a,b`,[config.bridge.accountAlias])).rows;
    if(rows.length!==1)fail('ADMISSION_ACCOUNT_REQUIRED');const row=rows[0],account=stateCopy(row.state);
    if(row.version!==ADMISSION_VERSION||account.accountId!==row.account_id||!account.aliases.includes(config.bridge.accountAlias)||digest(canonicalJson(account))!==row.checksum)fail('ADMISSION_ACCOUNT_CORRUPT');
    if(account.policy.thresholdPercent>100-graph.plan.definition.budget.reservePercent||account.policy.thresholdPercent>config.codex.stopUsedPercent
      ||account.policy.maxWorkers>graph.plan.definition.budget.maxActiveWorkers||!account.policy.admittedRoutes.includes(config.bridge.modelRoute))fail('EXISTING_POLICY_INCOMPATIBLE');
    const names=[schemas.runtime,schemas.broker,schemas.effects,schemas.graph,schemas.tests];
    if((await client.query('SELECT nspname FROM pg_namespace WHERE nspname=ANY($1::text[])',[names])).rowCount)fail('SCHEMA_EXISTS');
    // Existing package DDL runs inside savepoints of this one outer provisioning transaction.
    // The borrowed client cannot release the connection or commit the outer transaction.
    let nesting=false;
    const borrowed={async connect(){return {async query(sql:string,values?:unknown[]):Promise<QueryResult>{
      if(sql==='BEGIN'||sql.startsWith('BEGIN ISOLATION')){if(nesting)fail('NESTED_PROVISION');nesting=true;return client!.query('SAVEPOINT trellis_provision_component');}
      if(sql==='COMMIT'){if(!nesting)fail('NESTED_PROVISION');const result=await client!.query('RELEASE SAVEPOINT trellis_provision_component');nesting=false;return result;}
      if(sql==='ROLLBACK'){const result=await client!.query('ROLLBACK TO SAVEPOINT trellis_provision_component');nesting=false;return result;}
      return client!.query(sql,values);
    },release(){}} as unknown as PoolClient;}} satisfies Pick<Pool,'connect'>;
    const effects=await PostgresWorkspaceEffects.open(borrowed,{schema:schemas.effects,workspaces:[{workspaceId:graph.workspaceId,root:config.workspaceRoot,writablePaths:graph.plan.definition.tasks.flatMap(task=>task.effects.flatMap(effect=>effect.operation==='workspace.write'?[effect.path]:[]))}]});
    await new RuntimeLedger(borrowed,schemas.runtime).createSchema();await new PostgresBrokerStore(borrowed,{schema:schemas.broker}).createSchema();
    await effects.createSchema();await new PostgresGraphStore(borrowed,schemas.graph).createSchema();await new PostgresTestStore(borrowed,{schema:schemas.tests,brokerSchema:schemas.broker}).createSchema();
    const receipt:ProvisioningReceipt={installationId:config.installationId,database:db.name,candidateRevision:graph.plan.candidateRevision,createdSchemas:names,
      admission:{schema:schemas.admission,accountAlias:config.bridge.accountAlias,accountId:account.accountId,stateDigest:row.checksum},dbosHistory:history,launches:0};
    committing=true;await client.query('COMMIT');return receipt;
  }catch(error){
    if(committing){discard=true;fail('PROVISION_COMMIT_UNKNOWN');}
    if(client)try{await client.query('ROLLBACK');}catch{discard=true;fail('PROVISION_ROLLBACK_UNKNOWN');}
    if(error instanceof DefinitionError)throw error;return fail('PROVISION_FAILED');
  }finally{client?.release(discard);await pool.end();}
}
