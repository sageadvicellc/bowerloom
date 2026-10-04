import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import pg from 'pg';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { PostgresRecipeStore, RecipeService } from '../packages/recipes/src/index.js';
import { canonicalJson, digest } from '../packages/recipes/src/validation.js';
import { FakeGitHub, packet, spec } from './recipes-fixtures.js';
const enabled=process.env.TRELLIS_RECIPE_PROOF==='trellis-alpha-proof@127.0.0.1:56582';
test('recipe control store and LangGraph persistence on isolated real PostgreSQL schemas',{skip:!enabled,timeout:60000},async t=>{
  assert.ok(process.env.TRELLIS_RECIPE_CREDENTIALS_FILE,'Set the private proof credential path.');
  const secret=JSON.parse(await readFile(process.env.TRELLIS_RECIPE_CREDENTIALS_FILE,'utf8'));
  const password=secret.POSTGRES_PASSWORD??secret.password;assert.equal(typeof password,'string');
  const database=process.env.TRELLIS_RECIPE_TEST_DATABASE??'postgres';assert.match(database,/^(postgres|trellis_[a-z0-9_]+)$/);
  const config={host:'127.0.0.1',port:56582,user:'postgres',password,database,ssl:false,connectionTimeoutMillis:3000,idleTimeoutMillis:500,max:5,application_name:'trellis_recipe_synthetic_test'};
  const suffix=randomBytes(7).toString('hex'),schema=`trellis_recipe_test_${suffix}`,cpSchema=`trellis_recipe_cp_${suffix}`;
  const pool=new pg.Pool(config),other=new pg.Pool(config);for(const p of [pool,other])p.on('error',()=>{});
  const store=new PostgresRecipeStore(pool,schema),second=new PostgresRecipeStore(other,schema),saver=new PostgresSaver(pool,undefined,{schema:cpSchema});
  const github=new FakeGitHub(),issuer=Symbol('operator'),auth=async(c:unknown)=>{assert.equal(c,issuer);return{subject:'synthetic-operator'};};
  const service=new RecipeService({store,github,allowedRecipe:spec,authorizeApproval:auth},saver);
  const report:any={schemas:[schema,cpSchema],database,cases:[],modelCalls:0,liveGitHubCalls:0,startedAt:new Date().toISOString()};
  let controlOwned=false,checkpointOwned=false;const children=new Set<ReturnType<typeof fork>>();
  const run=async(name:string,body:()=>Promise<void>)=>t.test(name,async()=>{await body();report.cases.push(name);});
  try{
    await store.createSchema();controlOwned=true;await pool.query(`CREATE SCHEMA "${cpSchema}"`);checkpointOwned=true;await saver.setup();
    let plan:Awaited<ReturnType<typeof service.plan>>;
    await run('concurrent setup stores exactly one spec and refuses a conflicting setup',async()=>{
      await Promise.all([store.setup(spec),second.setup(spec)]);assert.equal((await pool.query(`SELECT count(*) AS n FROM "${schema}".records WHERE kind='recipe'`)).rows[0].n,'1');
      await assert.rejects(second.setup({...spec,sourceRevision:'d'.repeat(40)}),{code:'SETUP_CONFLICT'});
      plan=await service.plan(packet());
    });
    await run('review pause survives a fresh process with zero external writes',async()=>{
      assert.equal((await service.run(plan.jobId) as any).status,'WAITING_APPROVAL');
      const child=fork(new URL('../../packages/recipes/test/resume-worker.mjs',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc'],execArgv:[],env:{PATH:process.env.PATH}});
      children.add(child);const exit=once(child,'exit'),message=once(child,'message');
      const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
      try{child.send({config,schema,cpSchema,jobId:plan.jobId});const [answer]=await message;const [code]=await exit;assert.equal(code,0);assert.deepEqual(answer,{status:'WAITING_APPROVAL',mutations:0});report.freshProcess=true;}
      finally{clearTimeout(timer);children.delete(child);}
      assert.equal(Number((await pool.query(`SELECT count(*) AS n FROM "${cpSchema}".checkpoints`)).rows[0].n)>0,true);
    });
    await run('concurrent resumed runs claim every external step once',async()=>{
      await service.approve({jobId:plan.jobId,planDigest:plan.digest},issuer);
      const fresh=new RecipeService({store:second,github,allowedRecipe:spec,authorizeApproval:auth},new PostgresSaver(other,undefined,{schema:cpSchema}));
      const results=await Promise.allSettled([service.run(plan.jobId),fresh.run(plan.jobId)]);
      assert.ok(results.some(r=>r.status==='fulfilled'));assert.deepEqual(github.calls,['branch','file','pull']);
      assert.equal((await fresh.status(plan.jobId) as any).status,'DRAFT_PR_READY');await fresh.run(plan.jobId);assert.equal(github.calls.length,3);
    });
    await run('post-commit acknowledgement loss preserves a consumed claim across fresh store reads',async()=>{
      const p=packet();p.experiment.id='lost-ack';const planned=await service.plan(p);await service.approve({jobId:planned.jobId,planDigest:planned.digest},issuer);
      let lose=false;const wrapped={async connect(){const c=await pool.connect();return{query:async(sql:string,args?:unknown[])=>{const value=await c.query(sql,args);if(sql.startsWith('INSERT INTO'))lose=true;if(sql==='COMMIT'&&lose){lose=false;throw Error('synthetic ack loss');}return value;},release:(discard:boolean)=>c.release(discard)};}} as unknown as pg.Pool;
      const uncertain=new PostgresRecipeStore(wrapped,schema);
      await assert.rejects(uncertain.change(planned.jobId,current=>{assert.ok(current);current.steps.branch={status:'SENDING',claimedAt:Date.now(),completedAt:null,reason:null};return{job:current,result:null};}),{code:'COMMIT_UNKNOWN'});
      const before=github.calls.length;assert.equal((await service.run(planned.jobId) as any).status,'NEEDS_RECONCILIATION');await service.reconcile(planned.jobId);assert.equal(github.calls.length,before);
    });
    await run('unapproved post-write changes remain held across fresh PostgreSQL readers after normal and lost responses',async()=>{
      for(const lost of [false,true]){
        const localGitHub=new FakeGitHub(),localService=new RecipeService({store,github:localGitHub,allowedRecipe:spec,authorizeApproval:auth},saver);
        const input=packet();input.experiment.id=lost?'drift-lost':'drift-normal';const p=await localService.plan(input);
        await localService.approve({jobId:p.jobId,planDigest:p.digest},issuer);if(lost)localGitHub.lostAfter='file';
        const original=localGitHub.writeFile.bind(localGitHub);
        localGitHub.writeFile=async(...args)=>{try{await original(...args);}finally{
          const parent=localGitHub.refs.get(p.branch)!,head='e'.repeat(40),files=new Map(localGitHub.files.get(parent));
          files.set('unapproved.txt',{sha:'f'.repeat(40),content:'unapproved'});localGitHub.files.set(head,files);
          localGitHub.commits.set(head,{parent,message:'unapproved descendant'});localGitHub.refs.set(p.branch,head);
        }};
        await assert.rejects(localService.run(p.jobId));
        const fresh=new RecipeService({store:second,github:localGitHub,allowedRecipe:spec,authorizeApproval:auth},new PostgresSaver(other,undefined,{schema:cpSchema}));
        assert.equal((await fresh.status(p.jobId) as any).status,'NEEDS_RECONCILIATION');
        await assert.rejects(fresh.reconcile(p.jobId),{code:'WRITE_COMMIT_DRIFT'});await fresh.run(p.jobId);
        assert.deepEqual(localGitHub.calls,['branch','file']);assert.equal(localGitHub.pulls.size,0);
        assert.equal((await second.read(p.jobId))!.steps.file.status,'UNKNOWN');
      }
    });
    await run('throw, async callback and serialization failure roll back; snapshots detach',async()=>{
      const before=await store.read(plan.jobId);
      await assert.rejects(store.change(plan.jobId,()=>{throw Error('synthetic');}),{code:'DATABASE_ERROR'});
      await assert.rejects(store.change(plan.jobId,(async (current:unknown)=>({job:current!,result:null})) as any),{code:'ASYNC_MUTATOR'});
      await assert.rejects(store.change(plan.jobId,current=>({job:current!,result:()=>{}})));
      assert.deepEqual(await second.read(plan.jobId),before);const result=await store.change(plan.jobId,current=>({job:current!,result:current!}));result.cancelled=true;assert.equal((await second.read(plan.jobId))!.cancelled,false);
    });
    await run('corrupt checksums and unsupported control versions fail closed',async()=>{
      const row=(await pool.query(`SELECT * FROM "${schema}".records WHERE kind='job' AND id=$1`,[plan.jobId])).rows[0];
      await pool.query(`UPDATE "${schema}".records SET checksum='bad' WHERE kind='job' AND id=$1`,[plan.jobId]);await assert.rejects(service.status(plan.jobId),{code:'CORRUPT_RECORD'});
      await pool.query(`UPDATE "${schema}".records SET checksum=$2 WHERE kind='job' AND id=$1`,[plan.jobId,digest(canonicalJson(row.state))]);
      await pool.query(`UPDATE "${schema}".metadata SET version=99`);await assert.rejects(service.status(plan.jobId),{code:'UNSUPPORTED_SCHEMA'});
    });
  }finally{
    const cleanupErrors:string[]=[];
    for(const child of children)try{const exit=once(child,'exit');child.kill('SIGKILL');await exit;}catch{cleanupErrors.push('child');}
    if(checkpointOwned)try{await pool.query(`DROP SCHEMA "${cpSchema}" CASCADE`);}catch{cleanupErrors.push('checkpoint-schema');}
    if(controlOwned)try{await pool.query(`DROP SCHEMA "${schema}" CASCADE`);}catch{cleanupErrors.push('control-schema');}
    try{report.schemasAbsent=(await pool.query('SELECT nspname FROM pg_namespace WHERE nspname = ANY($1::text[])',[[schema,cpSchema]])).rowCount===0;}catch{cleanupErrors.push('absence-check');}
    for(const p of [pool,other])try{await p.end();}catch{cleanupErrors.push('pool');}
    report.cleanupErrors=cleanupErrors;report.passed=report.cases.length===7&&report.schemasAbsent&&!cleanupErrors.length;report.endedAt=new Date().toISOString();
    await mkdir('packages/recipes/.trellis',{recursive:true});await writeFile('packages/recipes/.trellis/postgres-result.json',JSON.stringify(report,null,2)+'\n');
    assert.equal(cleanupErrors.length,0);assert.equal(report.schemasAbsent,true);
  }
});
