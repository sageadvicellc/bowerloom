import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, realpath, readFile, rm, chmod, symlink, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { prepareEndorAlpha, provisionLocalInstallation } from '../apps/cli/src/provision.js';
import type { ProvisioningConfiguration } from '../apps/cli/src/provision.js';
import { serializeTestManifest } from '../packages/controlled-tests/src/index.js';
import { compileCrew } from '../packages/crew/src/index.js';
import { digest } from '../packages/contracts/src/index.js';
import { PostgresAdmission } from '../packages/admission/src/index.js';
const sourceDirectory=resolve('examples/endor-alpha');
const manifest=serializeTestManifest({format:'trellis/registered-test/v0.7-alpha',testId:'craft-shop-ui-v1',testerDigest:digest('synthetic tester'),environmentDigest:digest('synthetic environment'),criteria:['add-job','change-stage','reload','export'],limits:{timeoutMs:25000,outputBytes:16384,artifactBytes:65536}});
async function scratch(){return realpath(await mkdtemp(join(tmpdir(),'trellis-provision-')));}
async function prepare(root:string,name='crew',testManifest=manifest){return prepareEndorAlpha({sourceDirectory,destination:join(root,name),manifest:testManifest,workspaceId:'demo-workspace',runId:'demo-run'});}
test('portable alpha binds the supplied tester, contract and sequential HTML handoff deterministically',async()=>{
  const root=await scratch();try{
    const a=await prepare(root,'a'),b=await prepare(root,'b');assert.equal(a.plan.candidateRevision,b.plan.candidateRevision);
    assert.deepEqual(a.plan.taskOrder,['design','build']);assert.deepEqual(a.plan.layers,[['design'],['build']]);
    assert.deepEqual(a.plan.definition.budget,{maxActiveWorkers:2,reservePercent:25,paidFallback:false});
    assert.deepEqual(a.plan.definition.tasks[1]!.inputs.draft!.source,{task:'design',output:'draft'});
    assert.equal(a.assets['test-manifest'],manifest);assert.equal(a.plan.assets['test-manifest']!.digest,digest(manifest));
    assert.equal(a.plan.assets.contract!.digest,digest(await readFile(join(sourceDirectory,'assets/craft-shop-contract.md'),'utf8')));
    for(const task of a.plan.definition.tasks){assert.equal(task.approval,'required');assert.equal(task.policy.maxAttempts,1);assert.equal(task.effects.length,2);assert.equal(task.effects.some(e=>e.operation==='workspace.read'),false);}
    assert.equal((await compileCrew(join(root,'a/crew.yaml'))).candidateRevision,a.plan.candidateRevision);
    const changed=manifest.replace(digest('synthetic tester'),digest('other registered tester'));const c=await prepare(root,'c',changed);assert.notEqual(c.plan.candidateRevision,a.plan.candidateRevision);
    await assert.rejects(prepare(root,'a'),{code:'EEXIST'});assert.equal((await compileCrew(join(root,'a/crew.yaml'))).candidateRevision,a.plan.candidateRevision);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('preparation refuses invented manifests, symlinked source and public destination parents',async()=>{
  const root=await scratch();try{
    await assert.rejects(prepare(root,'bad',manifest+'\n'),{code:'INVALID_MANIFEST'});
    await symlink(sourceDirectory,join(root,'source'));await assert.rejects(prepareEndorAlpha({sourceDirectory:join(root,'source'),destination:join(root,'bad-source'),manifest,workspaceId:'w',runId:'r'}),{code:'UNSAFE_DIRECTORY'});
    await mkdir(join(root,'public'),{mode:0o755});await chmod(join(root,'public'),0o755);
    await assert.rejects(prepare(root,'public/crew'),{code:'UNSAFE_DIRECTORY'});
  }finally{await rm(root,{recursive:true,force:true});}
});
test('provisioning rejects remote endpoints and shared schema names before a credential or DB read',async()=>{
  const root=await scratch();try{
    const graph=await prepare(root);const value={installationId:'alpha-test',database:{host:'127.0.0.1',port:56582,name:'trellis_synthetic',credentialsFile:'/missing'},schemas:{runtime:'trellis_runtime',broker:'trellis_broker',admission:'trellis_admission',effects:'trellis_effects',graph:'trellis_graph',tests:'trellis_tests'},graph,bridge:{accountAlias:'alias',modelRoute:'codex-test'},workspaceRoot:join(root,'crew'),codex:{stopUsedPercent:75}} as ProvisioningConfiguration;
    await assert.rejects(provisionLocalInstallation({...value,database:{...value.database,host:'example.com' as '127.0.0.1'}}),{code:'LOCAL_DATABASE_REQUIRED'});
    await assert.rejects(provisionLocalInstallation({...value,schemas:{...value.schemas,tests:value.schemas.admission}}),{code:'INSTALLATION_SCHEMA'});
    await assert.rejects(provisionLocalInstallation({...value,codex:{stopUsedPercent:95}}),{code:'CAPACITY_POLICY'});
  }finally{await rm(root,{recursive:true,force:true});}
});
const enabled=process.env.TRELLIS_PROVISION_PROOF==='trellis-alpha-proof@127.0.0.1:56582';
test('provisioning preserves held admission state and refuses DBOS recovery history in an isolated database',{skip:!enabled,timeout:30000},async t=>{
  const credentials=process.env.TRELLIS_PROVISION_CREDENTIALS_FILE;if(!credentials)throw Error('Supply the private proof credential file path.');
  const {POSTGRES_PASSWORD:password}=JSON.parse(await readFile(credentials,'utf8'));if(typeof password!=='string'||!password)throw Error('Missing private proof credential.');
  const database=`trellis_provision_test_${randomBytes(8).toString('hex')}`;
  const connection={host:'127.0.0.1',port:56582,user:'postgres',password,ssl:false,connectionTimeoutMillis:3000,idleTimeoutMillis:500,application_name:'trellis_provision_test'};
  const admin=new pg.Client({...connection,database:'postgres'}),pool=new pg.Pool({...connection,database,max:2});pool.on('error',()=>{});const root=await scratch();let created=false;
  const report:{database:string;cases:{name:string;passed:boolean}[];databaseAbsent?:boolean;scratchRemoved?:boolean;cleanupErrors?:string[];passed?:boolean;modelCalls:number;browserCalls:number}={database,cases:[],modelCalls:0,browserCalls:0};
  const run=async(name:string,body:()=>Promise<void>)=>t.test(name,async()=>{try{await body();report.cases.push({name,passed:true});}catch(error){report.cases.push({name,passed:false});throw error;}});
  try{
    await admin.connect();await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;
    const admission=new PostgresAdmission(pool,{schema:'trellis_admission',launcherId:'synthetic-provision-test'});
    await admission.createSchema([{accountId:'synthetic-account',aliases:['shared-alias'],policy:{thresholdPercent:75,maxWorkers:2,headroomPercent:8,maxObservationAgeMs:5000,admittedRoutes:['codex-test'],completedResetPolicy:'hold'}}]);
    const now=Date.now();const reservation=await admission.reserve({accountAlias:'shared-alias',jobId:'existing-held',candidateRevision:digest('held candidate'),modelRoute:'codex-test',role:'worker',attempt:'initial',allowancePercent:{primary:2},paidFallback:false},
      {observationId:'synthetic-proof',accountId:'synthetic-account',observedAtMs:now,authentication:'subscription',ordinaryUsageAllowed:true,windows:{primary:{usedPercent:20,resetAtMs:now+100000,durationMs:100000,accountedThroughMs:null},secondary:null},routes:{'codex-test':{requiredWindows:['primary'],optionalWindows:['secondary']}}});assert.equal(reservation.kind,'accepted');
    const graph=await prepare(root),schemas={runtime:'trellis_runtime',broker:'trellis_broker',admission:'trellis_admission',effects:'trellis_effects',graph:'trellis_graph',tests:'trellis_tests'};
    const config:ProvisioningConfiguration={installationId:'alpha-test',database:{host:'127.0.0.1',port:56582,name:database,credentialsFile:resolve(credentials)},schemas,graph,bridge:{accountAlias:'shared-alias',modelRoute:'codex-test'},workspaceRoot:join(root,'crew'),codex:{stopUsedPercent:75}};
    const before=(await pool.query('SELECT account_id,version,state,checksum FROM trellis_admission.accounts')).rows;
    const unchanged=async()=>assert.deepEqual((await pool.query('SELECT account_id,version,state,checksum FROM trellis_admission.accounts')).rows,before);
    const noNew=async()=>assert.equal((await pool.query("SELECT nspname FROM pg_namespace WHERE nspname=ANY($1::text[])",[['trellis_runtime','trellis_broker','trellis_effects','trellis_graph','trellis_tests']])).rowCount,0);
    await run('missing shared alias and incompatible policy create no namespace',async()=>{
      await assert.rejects(provisionLocalInstallation({...config,bridge:{...config.bridge,accountAlias:'missing'}}),{code:'ADMISSION_ACCOUNT_REQUIRED'});await noNew();await unchanged();
      await assert.rejects(provisionLocalInstallation({...config,codex:{stopUsedPercent:70}}),{code:'EXISTING_POLICY_INCOMPATIBLE'});await noNew();await unchanged();
    });
    await run('pre-existing DBOS history or partial schema is never silently adopted',async()=>{
      await pool.query('CREATE SCHEMA dbos');await assert.rejects(provisionLocalInstallation(config),{code:'DBOS_HISTORY_UNRECOGNIZED'});await noNew();
      await pool.query('CREATE TABLE dbos.workflow_status(id text)');await pool.query("INSERT INTO dbos.workflow_status VALUES('unrelated-history')");
      await assert.rejects(provisionLocalInstallation(config),{code:'DBOS_HISTORY_PRESENT'});await noNew();await unchanged();
      assert.equal((await pool.query('SELECT * FROM dbos.workflow_status')).rows[0].id,'unrelated-history');await pool.query('DELETE FROM dbos.workflow_status');
    });
    await run('existing target schema refuses the entire attempt without resetting it',async()=>{
      await pool.query('CREATE SCHEMA trellis_tests');await pool.query('CREATE TABLE trellis_tests.preserved(value text)');await pool.query("INSERT INTO trellis_tests.preserved VALUES('keep')");
      await assert.rejects(provisionLocalInstallation(config),{code:'SCHEMA_EXISTS'});assert.equal((await pool.query('SELECT * FROM trellis_tests.preserved')).rows[0].value,'keep');
      assert.equal((await pool.query("SELECT nspname FROM pg_namespace WHERE nspname='trellis_runtime'")).rowCount,0);await unchanged();await pool.query('DROP SCHEMA trellis_tests CASCADE');
    });
    await run('five schema provisioning is atomic and leaves held allowance and policy exact',async()=>{
      // A synthetic event trigger fails the last DDL, proving the earlier component savepoints roll back with the outer transaction.
      await pool.query("CREATE FUNCTION public.refuse_test_schema() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE schema_name='trellis_tests') THEN RAISE EXCEPTION 'synthetic final DDL refusal'; END IF; END $$");
      await pool.query('CREATE EVENT TRIGGER refuse_last_schema ON ddl_command_end EXECUTE FUNCTION public.refuse_test_schema()');
      await assert.rejects(provisionLocalInstallation(config),{code:'PROVISION_FAILED'});await noNew();await unchanged();
      await pool.query('DROP EVENT TRIGGER refuse_last_schema');await pool.query('DROP FUNCTION public.refuse_test_schema()');
      const result=await provisionLocalInstallation(config);assert.equal(result.launches,0);assert.equal(result.dbosHistory,'empty');assert.equal(result.createdSchemas.length,5);assert.equal(result.admission.stateDigest,before[0].checksum);await unchanged();
      const tables=(await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema=ANY($1::text[])",[result.createdSchemas])).rows[0].n;assert.equal(tables,12);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM trellis_runtime.runs')).rows[0].n,0);assert.equal((await pool.query('SELECT count(*)::int AS n FROM trellis_graph.graphs')).rows[0].n,0);
      await assert.rejects(provisionLocalInstallation(config),{code:'SCHEMA_EXISTS'});await unchanged();
    });
  }finally{
    const errors:string[]=[];try{await pool.end();}catch{errors.push('pool');}
    if(created)try{await admin.query(`DROP DATABASE "${database}"`);report.databaseAbsent=(await admin.query('SELECT datname FROM pg_database WHERE datname=$1',[database])).rowCount===0;}catch{errors.push('database');}
    try{await admin.end();}catch{errors.push('admin');}try{await rm(root,{recursive:true,force:true});report.scratchRemoved=true;}catch{errors.push('scratch');}
    report.cleanupErrors=errors;report.passed=report.cases.length===4&&report.cases.every(c=>c.passed)&&report.databaseAbsent===true&&report.scratchRemoved===true&&!errors.length;
    await mkdir('dist/alpha-provision-evidence',{recursive:true});await writeFile('dist/alpha-provision-evidence/test-result.json',JSON.stringify(report,null,2)+'\n');if(errors.length)throw Error('Synthetic provisioning cleanup failed.');
  }
});
