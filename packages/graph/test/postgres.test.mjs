import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { GraphDriver, PostgresGraphStore } from '../../../dist/packages/graph/src/index.js';
import { input, Executor, digest, canonicalJson } from './fixtures.mjs';
const enabled=process.env.TRELLIS_GRAPH_PROOF==='trellis-alpha-proof@127.0.0.1:56582';
test('durable graph claims and typed handoff in one isolated PostgreSQL database',{skip:!enabled,timeout:60000},async t=>{
  if(!process.env.TRELLIS_GRAPH_CREDENTIALS_FILE)throw new Error('Supply the private proof credential file path.');
  const {POSTGRES_PASSWORD:password}=JSON.parse(readFileSync(process.env.TRELLIS_GRAPH_CREDENTIALS_FILE,'utf8'));
  if(typeof password!=='string'||!password)throw new Error('Missing protected proof credential.');
  const config={host:'127.0.0.1',port:56582,user:'postgres',password,ssl:false,connectionTimeoutMillis:3000,idleTimeoutMillis:500,application_name:'trellis_graph_test'};
  const database=`trellis_graph_test_${randomBytes(8).toString('hex')}`,schema='trellis_graph';
  const admin=new pg.Client({...config,database:'postgres'});
  const pools=[new pg.Pool({...config,database,max:3}),new pg.Pool({...config,database,max:3})];for(const pool of pools)pool.on('error',()=>{});
  const [pool,other]=pools;const store=new PostgresGraphStore(pool,schema);const children=new Set();let created=false;
  const report={observedAt:new Date().toISOString(),database,cases:[],modelCalls:0,dockerOperations:0};
  const run=async(name,body)=>t.test(name,async()=>{try{await body();report.cases.push({name,passed:true});}catch(error){report.cases.push({name,passed:false});throw error;}});
  const wrap=handler=>({async connect(){const client=await pool.connect();return{query:(sql,values)=>handler(client,sql,values),release:discard=>client.release(discard)};}});
  try{
    await admin.connect();await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;await store.createSchema();
    await run('two clients serialize graph creation and dispatch one pinned task',async()=>{
      const executor=new Executor();const a=new GraphDriver(store,executor),b=new GraphDriver(new PostgresGraphStore(other,schema),executor);const value=await input('concurrent');
      const submitted=await Promise.all([a.submit(value),b.submit(value)]);assert.equal(submitted[0].state.id,submitted[1].state.id);const id=submitted[0].state.id;
      await Promise.all([a.advance(id),b.advance(id)]);assert.equal(executor.submitted.length,1);
      executor.complete();await b.advance(id);await a.advance(id);assert.equal(executor.submitted.length,2);assert.deepEqual(executor.submitted[1].inputs.brief.value,{count:2,title:'Treehouse'});
      executor.complete(1);assert.equal((await b.advance(id)).status,'COMPLETED');
      const changed=structuredClone(value);changed.owners.coda.epoch++;await assert.rejects(a.submit(changed),{code:'GRAPH_CONFLICT'});
    });
    await run('lost claim commit acknowledgement starts nothing and a fresh process cannot replay it',async()=>{
      const executor=new Executor(),normal=new GraphDriver(store,executor);const {state}=await normal.submit(await input('unknown-commit'));let lost=false;
      const uncertain=new GraphDriver(new PostgresGraphStore(wrap(async(client,sql,values)=>{
        const result=await client.query(sql,values);if(sql==='COMMIT'&&!lost){lost=true;throw new Error('Synthetic lost acknowledgement');}return result;
      }),schema),executor);
      await assert.rejects(uncertain.advance(state.id),{code:'COMMIT_UNKNOWN'});assert.equal(executor.submitted.length,0);
      assert.ok((await normal.status(state.id)).state.tasks.design.claim);
      const child=fork(new URL('./process-worker.mjs',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH},execArgv:[]});
      children.add(child);child.once('exit',()=>children.delete(child));const exited=once(child,'exit'),message=once(child,'message');
      child.send({config:{...config,database},schema,id:state.id});const [reply]=await message;await exited;
      assert.deepEqual(reply,{status:'HOLD',holdReason:'CLAIM_NOT_OBSERVED',submissions:0,inspections:1});report.freshProcessNoReplay=true;
    });
    await run('precommit errors roll back without dispatch and a known rollback can be retried',async()=>{
      const executor=new Executor(),normal=new GraphDriver(store,executor);const {state}=await normal.submit(await input('rollback'));
      const broken=new GraphDriver(new PostgresGraphStore(wrap(async(client,sql,values)=>{
        if(sql.startsWith('INSERT INTO ')&&sql.includes('.graphs'))throw new Error('Synthetic write failure');return client.query(sql,values);
      }),schema),executor);
      await assert.rejects(broken.advance(state.id),{code:'GRAPH_DATABASE_ERROR'});assert.equal(executor.submitted.length,0);assert.equal((await normal.status(state.id)).state.tasks.design.claim,null);
      await normal.advance(state.id);assert.equal(executor.submitted.length,1);
    });
    await run('cancellation survives a fresh store and preserves an already consumed claim',async()=>{
      const executor=new Executor(),a=new GraphDriver(store,executor);const {state}=await a.submit(await input('cancel'));await a.advance(state.id);await a.cancel(state.id);
      const b=new GraphDriver(new PostgresGraphStore(other,schema),executor);const result=await b.advance(state.id);
      assert.equal(result.status,'CANCELLED');assert.ok(result.state.tasks.design.claim);assert.equal(executor.submitted.length,1);assert.equal(result.state.tasks.build.claim,null);
    });
    await run('checksum, state binding, and schema versions fail closed',async()=>{
      const executor=new Executor(),driver=new GraphDriver(store,executor);const {state}=await driver.submit(await input('corrupt'));
      const row=(await pool.query(`SELECT * FROM "${schema}".graphs WHERE id=$1`,[state.id])).rows[0];
      await pool.query(`UPDATE "${schema}".graphs SET checksum='wrong' WHERE id=$1`,[state.id]);await assert.rejects(driver.advance(state.id),{code:'CORRUPT_GRAPH'});
      const corrupt=structuredClone(row.state);corrupt.input.plan.taskOrder.reverse();
      await pool.query(`UPDATE "${schema}".graphs SET state=$2::jsonb,checksum=$3 WHERE id=$1`,[state.id,JSON.stringify(corrupt),digest(canonicalJson(corrupt))]);
      await assert.rejects(driver.advance(state.id));
      await pool.query(`UPDATE "${schema}".graphs SET state=$2::jsonb,checksum=$3,version=2 WHERE id=$1`,[state.id,JSON.stringify(row.state),row.checksum]);await assert.rejects(driver.advance(state.id),{code:'UNSUPPORTED_VERSION'});
      assert.equal(executor.submitted.length,0);
    });
    await run('transaction results are detached; void works and asynchronous mutation rolls back',async()=>{
      const driver=new GraphDriver(store,new Executor());const {state}=await driver.submit(await input('detached'));let retained;
      const result=await store.transaction(state.id,current=>{retained=current;return{state:current,result:current};});result.cancelRequested=true;retained.cancelRequested=true;
      assert.equal((await driver.status(state.id)).state.cancelRequested,false);
      assert.equal(await store.transaction(state.id,current=>({state:current,result:undefined})),undefined);
      await assert.rejects(store.transaction(state.id,async current=>{current.cancelRequested=true;return{state:current,result:null};}),{code:'INVALID_MUTATOR'});
      assert.equal((await driver.status(state.id)).state.cancelRequested,false);
    });
    report.databaseBytes=Number((await pool.query('SELECT pg_database_size(current_database()) AS bytes')).rows[0].bytes);
  }finally{
    const errors=[];
    for(const child of children)try{const exited=once(child,'exit');child.kill('SIGKILL');await exited;}catch{errors.push('child');}
    for(const pool of pools)try{await pool.end();}catch{errors.push('pool');}
    if(created)try{await admin.query(`DROP DATABASE "${database}"`);report.databaseRemoved=true;report.databaseAbsent=(await admin.query('SELECT datname FROM pg_database WHERE datname=$1',[database])).rowCount===0;}catch{errors.push('database');}
    try{await admin.end();}catch{errors.push('admin');}
    report.childrenReaped=children.size===0;report.cleanupErrors=errors;report.passed=report.cases.length===6&&report.cases.every(value=>value.passed)&&report.databaseAbsent&&report.childrenReaped&&!errors.length;
    mkdirSync('packages/graph/.trellis',{recursive:true});writeFileSync('packages/graph/.trellis/test-result.json',JSON.stringify(report,null,2)+'\n');
    if(errors.length)throw new Error('Synthetic graph cleanup failed.');
  }
});
