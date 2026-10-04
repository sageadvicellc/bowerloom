import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { parse, stringify } from 'yaml';
import { AUTHORED_CRAFT_SHOP_SCENARIO_DIGEST, prepareAuthoredCraftShop, provisionAuthoredInstallation } from '../apps/cli/src/provision.js';
import type { AuthoredInstallationAuthority, PrepareAuthoredCraftShopOptions, ProvisioningConfiguration } from '../apps/cli/src/provision.js';
import { compileAuthoring } from '../packages/authoring/src/index.js';
import type { AuthoredCrew } from '../packages/authoring/src/index.js';
import { compileCrew } from '../packages/crew/src/index.js';
import { canonicalJson, digest } from '../packages/contracts/src/index.js';
import { serializeTestManifest } from '../packages/controlled-tests/src/index.js';
import { PostgresAdmission } from '../packages/admission/src/index.js';
const reference=resolve('packages/workbench/reference-crews/craft-shop-control');
const scenarioFile=resolve('packages/workbench/scenarios/craft-shop-v1/scenario.json');
const registeredManifest=serializeTestManifest({format:'trellis/registered-test/v0.7-alpha',testId:'craft-shop-ui-v1',testerDigest:digest('synthetic installed tester'),environmentDigest:digest('synthetic installed environment'),criteria:['add-job','change-stage','reload','export'],limits:{timeoutMs:25000,outputBytes:16384,artifactBytes:65536}});
type Fixture={root:string;project:string;input:PrepareAuthoredCraftShopOptions;authority:AuthoredInstallationAuthority};
async function fixture(body:(f:Fixture)=>Promise<void>,single=false){
  const root=await realpath(await mkdtemp(join(tmpdir(),'trellis-authored-provision-'))),project=join(root,'source');
  try{
    await cp(reference,project,{recursive:true});await writeFile(join(project,'assets/test-manifest.json'),registeredManifest);
    const crew=parse(await readFile(join(project,'crew.yaml'),'utf8'));crew.id='personal-author';
    const names={emery:'maker',coda:'editor'} as Record<string,string>;
    for(const owner of crew.owners){owner.id=names[owner.id];owner.role=`Authored ${owner.id}`;}
    for(const task of crew.tasks){task.owner=names[task.owner];task.id=task.id==='design'?'compose':'refine';task.dependsOn=task.dependsOn.map(()=> 'compose');
      for(const input of Object.values(task.inputs) as any[])if(input.source.task){input.source.task='compose';input.source.output='page';}
      task.outputs={page:{kind:'artifact',mediaType:'text/html'}};}
    if(single){crew.owners[0].permissions.push(crew.owners[1].permissions[0]);crew.owners=[crew.owners[0]];crew.tasks[1].owner='maker';}
    // Definition order is not an execution identity: the compiled dependency order remains authoritative.
    crew.tasks.reverse();await writeFile(join(project,'crew.yaml'),stringify(crew));
    const edit=async(path:string,change:(v:any)=>void)=>{const v=JSON.parse(await readFile(join(project,path),'utf8'));change(v);await writeFile(join(project,path),JSON.stringify(v,null,2)+'\n');};
    await edit('authoring.json',v=>{v.id='personal-author';});
    await edit('skills/craft-ui.json',v=>{v.owners=single?['maker']:['maker','editor'];});
    await edit('maps/relay.json',v=>{v.participants=single?['maker']:['maker','editor'];Object.assign(v.routes[0],{fromOwner:'maker',fromTask:'compose',toOwner:single?'maker':'editor',toTask:'refine',bindings:[{output:'page',input:'draft'}]});});
    await edit('maps/vines.json',v=>{v.entries[0].owner='maker';v.entries[0].task='compose';v.entries[1].owner=single?'maker':'editor';v.entries[1].task='refine';});
    const bundle=await compileAuthoring(join(project,'authoring.json'),{scenarioFile}),frozenScenario=await readFile(scenarioFile,'utf8');
    const permissions=Object.fromEntries(crew.owners.map((owner:any)=>[owner.id,owner.permissions]));
    const owners=Object.fromEntries(crew.owners.map((owner:any,index:number)=>[owner.id,{subject:`trusted:${owner.id}`,epoch:index+4}]));
    const authority={bundle,frozenScenario,registeredManifest,permissions};
    await body({root,project,authority,input:{...authority,destination:join(root,'snapshot'),workspaceId:'trusted-workspace',runId:'trusted-run',owners}});
  }finally{await rm(root,{recursive:true,force:true});}
}
const exists=async(path:string)=>lstat(path).then(()=>true,()=>false);
function configuration(f:Fixture,graph:ProvisioningConfiguration['graph']):ProvisioningConfiguration{return{
  installationId:'alpha-authored-test',database:{host:'127.0.0.1',port:56582,name:'trellis_unused',credentialsFile:'/deliberately-missing-credential'},
  schemas:{runtime:'trellis_runtime',broker:'trellis_broker',admission:'trellis_admission',effects:'trellis_effects',graph:'trellis_graph',tests:'trellis_tests'},
  graph,bridge:{accountAlias:'shared-alias',modelRoute:'codex-test'},workspaceRoot:f.input.destination,codex:{stopUsedPercent:75},
};}
function repinAsset(bundle:AuthoredCrew,name:string,change:(text:string)=>string):AuthoredCrew{
  const copy=structuredClone(bundle);copy.assets[name]=change(copy.assets[name]!);
  Object.assign(copy.plan.assets[name]!,{bytes:Buffer.byteLength(copy.assets[name]!),digest:digest(copy.assets[name]!)});
  const{candidateRevision,...planBody}=copy.plan;copy.plan.candidateRevision=digest(canonicalJson(planBody));
  const{authoringRevision,...body}=copy;copy.authoringRevision=digest(canonicalJson(body));return copy;
}
for(const single of [false,true])test(`authored preparation preserves ${single?'one':'two renamed'} owner bindings, source pins, and accepted HTML handoff`,async()=>fixture(async f=>{
  const graph=await prepareAuthoredCraftShop(f.input);
  assert.equal(digest(f.authority.frozenScenario),AUTHORED_CRAFT_SHOP_SCENARIO_DIGEST);assert.deepEqual(graph.plan.taskOrder,['compose','refine']);
  assert.deepEqual(graph.owners,f.input.owners);assert.equal(graph.plan.definition.owners.length,single?1:2);
  assert.equal(graph.plan.candidateRevision,(f.input.bundle as AuthoredCrew).plan.candidateRevision);
  const second=graph.plan.definition.tasks.find(task=>task.id==='refine')!;assert.deepEqual(second.inputs.draft!.source,{task:'compose',output:'page'});
  assert.deepEqual(await compileCrew(join(f.input.destination,'crew.yaml')),graph.plan);
  for(const [name,asset]of Object.entries(graph.plan.assets)){const path=join(f.input.destination,asset.path);assert.equal(await readFile(path,'utf8'),graph.assets[name]);assert.equal((await lstat(path)).mode&0o077,0);}
  for(const path of ['','output/design','output/job-board'])assert.equal((await lstat(join(f.input.destination,path))).mode&0o077,0);
  assert.equal(await exists(join(f.input.destination,'output/design/index.html')),false);
  await assert.rejects(prepareAuthoredCraftShop(f.input),{code:'EEXIST'});assert.equal((await compileCrew(join(f.input.destination,'crew.yaml'))).candidateRevision,graph.plan.candidateRevision);
},single));

test('snapshot preparation supports a portable nested crew path without rewriting the authored manifest',async()=>fixture(async f=>{
  const path=join(f.project,'authoring.json'),manifest=JSON.parse(await readFile(path,'utf8'));manifest.crew='definition/crew.yaml';
  await mkdir(join(f.project,'definition'));await writeFile(join(f.project,'definition/crew.yaml'),await readFile(join(f.project,'crew.yaml')));await rm(join(f.project,'crew.yaml'));
  await writeFile(path,JSON.stringify(manifest,null,2)+'\n');const bundle=await compileAuthoring(path,{scenarioFile});
  const graph=await prepareAuthoredCraftShop({...f.input,bundle});assert.equal((await compileCrew(join(f.input.destination,'definition/crew.yaml'),{root:f.input.destination})).candidateRevision,graph.plan.candidateRevision);
  assert.equal(await readFile(join(f.input.destination,'authoring.json'),'utf8'),bundle.assets.authoring);
}));

const badCases:[string,(f:Fixture)=>PrepareAuthoredCraftShopOptions,string][]=[
  ['different frozen scenario',f=>({...f.input,frozenScenario:f.input.frozenScenario+'\n'}),'FROZEN_SCENARIO_REQUIRED'],
  ['different installed tester',f=>({...f.input,registeredManifest:registeredManifest.replace(digest('synthetic installed tester'),digest('other tester'))}),'TEST_MANIFEST_MISMATCH'],
  ['altered asset bytes',f=>{const bundle=structuredClone(f.input.bundle as AuthoredCrew);bundle.assets.orders+=' ';return{...f.input,bundle};},'AUTHORING_REVISION'],
  ['repinned unauthorized relay',f=>({...f.input,bundle:repinAsset(f.input.bundle as AuthoredCrew,'relay-map',text=>{const v=JSON.parse(text);v.routes[0].fromOwner='editor';return JSON.stringify(v);})}),'AUTHORING_RELAY_ROUTE'],
  ['repinned unauthorized vines',f=>({...f.input,bundle:repinAsset(f.input.bundle as AuthoredCrew,'vines-map',text=>{const v=JSON.parse(text);v.entries[0].sink='remote';return JSON.stringify(v);})}),'AUTHORING_VINES_SCHEMA'],
  ['missing trusted owner',f=>({...f.input,owners:{maker:f.input.owners.maker!}}),'INVALID_INPUT'],
  ['invalid trusted epoch',f=>({...f.input,owners:{...f.input.owners,maker:{subject:'trusted:maker',epoch:0}}}),'INVALID_OWNER'],
  ['missing permission grant',f=>({...f.input,permissions:{...f.input.permissions,maker:[]}}),'AUTHORED_PERMISSIONS'],
  ['broad write grant',f=>({...f.input,permissions:{...f.input.permissions,maker:[{operation:'workspace.write',path:'output'},{operation:'command.test',command:'craft-shop-ui-v1'}]}}),'AUTHORED_PERMISSIONS'],
  ['unknown grant recipient',f=>({...f.input,permissions:{...f.input.permissions,stranger:[]}}),'AUTHORED_PERMISSIONS'],
];
for(const[name,change,code]of badCases)test(`authored preparation refuses ${name} before a snapshot write`,async()=>fixture(async f=>{
  await assert.rejects(prepareAuthoredCraftShop(change(f)),{code});assert.equal(await exists(f.input.destination),false);
}));

test('public parents, symlinked destinations and existing snapshots stay untouched',async()=>fixture(async f=>{
  const publicRoot=join(f.root,'public');await mkdir(publicRoot);await chmod(publicRoot,0o755);
  await assert.rejects(prepareAuthoredCraftShop({...f.input,destination:join(publicRoot,'snapshot')}),{code:'UNSAFE_DIRECTORY'});
  assert.equal(await exists(join(publicRoot,'snapshot')),false);
  await symlink(f.root,join(f.root,'alias'));await assert.rejects(prepareAuthoredCraftShop({...f.input,destination:join(f.root,'alias/snapshot')}),{code:'UNSAFE_DIRECTORY'});
  await mkdir(join(f.root,'preserved'));await writeFile(join(f.root,'preserved/sentinel'),'keep');await symlink(join(f.root,'preserved'),f.input.destination);
  await assert.rejects(prepareAuthoredCraftShop(f.input),{code:'EEXIST'});assert.equal(await readFile(join(f.root,'preserved/sentinel'),'utf8'),'keep');
}));

test('authored provisioning refuses graph, bundle, scenario, tester and snapshot mismatches before credential reads',async()=>fixture(async f=>{
  const graph=await prepareAuthoredCraftShop(f.input),config=configuration(f,graph);
  const changed=structuredClone(graph);changed.assets.orders+=' ';
  await assert.rejects(provisionAuthoredInstallation({...config,graph:changed},f.authority),{code:'AUTHORED_GRAPH_BINDING'});
  const changedPlan=structuredClone(graph);changedPlan.plan.candidateRevision=digest('other');
  await assert.rejects(provisionAuthoredInstallation({...config,graph:changedPlan},f.authority),{code:'AUTHORED_GRAPH_BINDING'});
  for(const[,change,code]of badCases.filter(([name])=>!['missing trusted owner','invalid trusted epoch'].includes(name))){
    const{bundle,frozenScenario,registeredManifest,permissions}=change(f);
    await assert.rejects(provisionAuthoredInstallation(config,{bundle,frozenScenario,registeredManifest,permissions}),{code});
  }
  await writeFile(join(f.input.destination,'maps/vines.json'),'{}');
  await assert.rejects(provisionAuthoredInstallation(config,f.authority),{code:'AUTHORED_SNAPSHOT_CHANGED'});
  await writeFile(join(f.input.destination,'maps/vines.json'),graph.assets['vines-map']!);
  await chmod(join(f.input.destination,'maps/vines.json'),0o644);await assert.rejects(provisionAuthoredInstallation(config,f.authority),{code:'UNSAFE_SOURCE'});
  await chmod(join(f.input.destination,'maps/vines.json'),0o600);await rm(join(f.input.destination,'maps/vines.json'));
  await symlink(join(f.project,'maps/vines.json'),join(f.input.destination,'maps/vines.json'));await assert.rejects(provisionAuthoredInstallation(config,f.authority),{code:'UNSAFE_SOURCE'});
}));

test('snapshot file aliases are refused before materialization and concurrent preparation has one exclusive winner',async()=>fixture(async f=>{
  for(const path of ['assets/orders.json/child','OUTPUT/design/index.html']){
    const bundle=structuredClone(f.input.bundle as AuthoredCrew);
    bundle.plan.definition.assets['craft-ui']!.path=path;bundle.plan.assets['craft-ui']!.path=path;
    const{candidateRevision,...plan}=bundle.plan;bundle.plan.candidateRevision=digest(canonicalJson(plan));
    const{authoringRevision,...body}=bundle;bundle.authoringRevision=digest(canonicalJson(body));
    await assert.rejects(prepareAuthoredCraftShop({...f.input,bundle}),{code:'AUTHORED_SNAPSHOT_PATH'});assert.equal(await exists(f.input.destination),false);
  }
  const results=await Promise.allSettled([prepareAuthoredCraftShop(f.input),prepareAuthoredCraftShop(f.input)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const refusal=results.find(result=>result.status==='rejected');assert.equal(refusal?.status==='rejected'&&refusal.reason.code,'EEXIST');
  assert.equal((await compileCrew(join(f.input.destination,'crew.yaml'))).candidateRevision,(f.input.bundle as AuthoredCrew).plan.candidateRevision);
}));

const enabled=process.env.TRELLIS_PROVISION_PROOF==='trellis-alpha-proof@127.0.0.1:56582';
test('authored provisioning preserves held state and atomic installation in a unique synthetic PostgreSQL database',{skip:!enabled,timeout:30000},async t=>{
  const credentialFile=process.env.TRELLIS_PROVISION_CREDENTIALS_FILE;if(!credentialFile)throw Error('Supply the private proof credential file path.');
  const {POSTGRES_PASSWORD:password}=JSON.parse(await readFile(credentialFile,'utf8'));if(typeof password!=='string'||!password)throw Error('Missing private proof credential.');
  const database=`trellis_authored_test_${randomBytes(8).toString('hex')}`;
  const connection={host:'127.0.0.1',port:56582,user:'postgres',password,ssl:false,connectionTimeoutMillis:3000,idleTimeoutMillis:500,application_name:'trellis_authored_provision_test'};
  const admin=new pg.Client({...connection,database:'postgres'}),pool=new pg.Pool({...connection,database,max:2});pool.on('error',()=>{});let created=false;
  const report:{database:string;cases:{name:string;passed:boolean}[];databaseAbsent?:boolean;scratchRemoved?:boolean;cleanupErrors?:string[];passed?:boolean;modelCalls:number;browserCalls:number;retainedAllowancePercent:number}={database,cases:[],modelCalls:0,browserCalls:0,retainedAllowancePercent:2};
  const run=async(name:string,body:()=>Promise<void>)=>t.test(name,async()=>{try{await body();report.cases.push({name,passed:true});}catch(error){report.cases.push({name,passed:false});throw error;}});
  try{
    await admin.connect();await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;
    const admission=new PostgresAdmission(pool,{schema:'trellis_admission',launcherId:'synthetic-authored-test'});
    await admission.createSchema([{accountId:'synthetic-account',aliases:['shared-alias'],policy:{thresholdPercent:75,maxWorkers:2,headroomPercent:8,maxObservationAgeMs:5000,admittedRoutes:['codex-test'],completedResetPolicy:'hold'}}]);
    const now=Date.now();const reservation=await admission.reserve({accountAlias:'shared-alias',jobId:'existing-held',candidateRevision:digest('held candidate'),modelRoute:'codex-test',role:'worker',attempt:'initial',allowancePercent:{primary:2},paidFallback:false},
      {observationId:'synthetic-proof',accountId:'synthetic-account',observedAtMs:now,authentication:'subscription',ordinaryUsageAllowed:true,windows:{primary:{usedPercent:20,resetAtMs:now+100000,durationMs:100000,accountedThroughMs:null},secondary:null},routes:{'codex-test':{requiredWindows:['primary'],optionalWindows:['secondary']}}});assert.equal(reservation.kind,'accepted');
    const before=(await pool.query('SELECT account_id,version,state,checksum FROM trellis_admission.accounts')).rows;
    const unchanged=async()=>assert.deepEqual((await pool.query('SELECT account_id,version,state,checksum FROM trellis_admission.accounts')).rows,before);
    await fixture(async f=>{
      const graph=await prepareAuthoredCraftShop(f.input),config=configuration(f,graph);config.database={host:'127.0.0.1',port:56582,name:database,credentialsFile:resolve(credentialFile)};
      const names=[config.schemas.runtime,config.schemas.broker,config.schemas.effects,config.schemas.graph,config.schemas.tests];
      const noNew=async()=>assert.equal((await pool.query('SELECT nspname FROM pg_namespace WHERE nspname=ANY($1::text[])',[names])).rowCount,0);
      await run('unknown shared account and incompatible policy create no namespace or allowance change',async()=>{
        await assert.rejects(provisionAuthoredInstallation({...config,bridge:{...config.bridge,accountAlias:'absent'}},f.authority),{code:'ADMISSION_ACCOUNT_REQUIRED'});await noNew();await unchanged();
        await assert.rejects(provisionAuthoredInstallation({...config,codex:{stopUsedPercent:70}},f.authority),{code:'EXISTING_POLICY_INCOMPATIBLE'});await noNew();await unchanged();
      });
      await run('foreign DBOS history and partial schemas remain preserved',async()=>{
        await pool.query('CREATE SCHEMA dbos');await assert.rejects(provisionAuthoredInstallation(config,f.authority),{code:'DBOS_HISTORY_UNRECOGNIZED'});await noNew();
        await pool.query('CREATE TABLE dbos.workflow_status(id text)');await pool.query("INSERT INTO dbos.workflow_status VALUES('unrelated-history')");
        await assert.rejects(provisionAuthoredInstallation(config,f.authority),{code:'DBOS_HISTORY_PRESENT'});await noNew();await unchanged();
        assert.deepEqual((await pool.query('SELECT * FROM dbos.workflow_status')).rows,[{id:'unrelated-history'}]);await pool.query('DELETE FROM dbos.workflow_status');
      });
      await run('a refused final component rolls all created schemas back without touching held state',async()=>{
        await pool.query("CREATE FUNCTION public.refuse_test_schema() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE schema_name='trellis_tests') THEN RAISE EXCEPTION 'synthetic final DDL refusal'; END IF; END $$");
        await pool.query('CREATE EVENT TRIGGER refuse_last_schema ON ddl_command_end EXECUTE FUNCTION public.refuse_test_schema()');
        await assert.rejects(provisionAuthoredInstallation(config,f.authority),{code:'PROVISION_FAILED'});await noNew();await unchanged();
        await pool.query('DROP EVENT TRIGGER refuse_last_schema');await pool.query('DROP FUNCTION public.refuse_test_schema()');
      });
      await run('renamed owner installation commits five schemas with zero launches or held-state changes',async()=>{
        const receipt=await provisionAuthoredInstallation(config,f.authority);assert.equal(receipt.launches,0);assert.equal(receipt.dbosHistory,'empty');assert.equal(receipt.candidateRevision,graph.plan.candidateRevision);assert.equal(receipt.admission.stateDigest,before[0].checksum);await unchanged();
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema=ANY($1::text[])',[names])).rows[0].n,12);
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM trellis_runtime.runs')).rows[0].n,0);assert.equal((await pool.query('SELECT count(*)::int AS n FROM trellis_graph.graphs')).rows[0].n,0);
        await assert.rejects(provisionAuthoredInstallation(config,f.authority),{code:'SCHEMA_EXISTS'});await unchanged();
      });
    });
    await run('one authored owner also provisions without a runtime launch or fresh admission ledger',async()=>fixture(async f=>{
      const graph=await prepareAuthoredCraftShop(f.input),config=configuration(f,graph);config.installationId='alpha-authored-single';
      config.database={host:'127.0.0.1',port:56582,name:database,credentialsFile:resolve(credentialFile)};
      config.schemas={runtime:'trellis_single_runtime',broker:'trellis_single_broker',admission:'trellis_admission',effects:'trellis_single_effects',graph:'trellis_single_graph',tests:'trellis_single_tests'};
      const receipt=await provisionAuthoredInstallation(config,f.authority);assert.equal(receipt.launches,0);assert.equal(receipt.createdSchemas.length,5);assert.equal(receipt.admission.stateDigest,before[0].checksum);await unchanged();
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM trellis_single_runtime.runs')).rows[0].n,0);
    },true));
    report.scratchRemoved=true;
  }finally{
    const errors:string[]=[];try{await pool.end();}catch{errors.push('pool');}
    if(created)try{await admin.query(`DROP DATABASE "${database}"`);report.databaseAbsent=(await admin.query('SELECT datname FROM pg_database WHERE datname=$1',[database])).rowCount===0;}catch{errors.push('database');}
    try{await admin.end();}catch{errors.push('admin');}
    report.cleanupErrors=errors;report.passed=report.cases.length===5&&report.cases.every(c=>c.passed)&&report.databaseAbsent===true&&report.scratchRemoved===true&&!errors.length;
    await mkdir('dist/authored-installation-evidence',{recursive:true});await writeFile('dist/authored-installation-evidence/test-result.json',JSON.stringify(report,null,2)+'\n');if(errors.length)throw Error('Synthetic authored provisioning cleanup failed.');
  }
});
