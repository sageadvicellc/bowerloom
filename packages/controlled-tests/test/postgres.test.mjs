import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import pg from 'pg';
import { PostgresTestStore } from '../../../dist/packages/controlled-tests/src/index.js';
import { PostgresBrokerStore } from '../../../dist/packages/broker-postgres/src/index.js';
import { fixture,Executor,digest,canonicalJson,testOperationId } from './fixtures.mjs';
const enabled=process.env.TRELLIS_TESTS_PROOF==='trellis-alpha-proof@127.0.0.1:56582';
test('registered test claims use the current broker authority in an isolated PostgreSQL database',{skip:!enabled,timeout:60000},async t=>{
  if(!process.env.TRELLIS_TESTS_CREDENTIALS_FILE)throw Error('Supply the private proof credential file path.');
  const {POSTGRES_PASSWORD:password}=JSON.parse(readFileSync(process.env.TRELLIS_TESTS_CREDENTIALS_FILE,'utf8'));
  if(typeof password!=='string'||!password)throw Error('Missing protected proof credential.');
  const config={host:'127.0.0.1',port:56582,user:'postgres',password,ssl:false,connectionTimeoutMillis:3000,idleTimeoutMillis:500,application_name:'trellis_registered_test'};
  const database=`trellis_registered_test_${randomBytes(8).toString('hex')}`,schema='trellis_tests',brokerSchema='trellis_broker';
  const admin=new pg.Client({...config,database:'postgres'}),pools=[new pg.Pool({...config,database,max:3}),new pg.Pool({...config,database,max:3})];
  for(const pool of pools)pool.on('error',()=>{});const [pool,other]=pools,store=new PostgresTestStore(pool,{schema,brokerSchema}),broker=new PostgresBrokerStore(pool,{schema:brokerSchema});
  const children=new Set();let created=false;
  const evidence={observedAt:new Date().toISOString(),database,cases:[],modelCalls:0,dockerOperations:0};
  const run=async(name,body)=>t.test(name,async()=>{try{await body();evidence.cases.push({name,passed:true});}catch(error){evidence.cases.push({name,passed:false});throw error;}});
  const wrap=handler=>({async connect(){const client=await pool.connect();return{query:(sql,values)=>handler(client,sql,values),release:discard=>client.release(discard)};}});
  const setup=async id=>{const f=await fixture(id);await broker.seed(f.authority);return f;};
  try{
    await admin.connect();await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;await broker.createSchema();await store.createSchema();
    await run('two clients consume one claim and recover identical detached evidence without replay',async()=>{
      const f=await setup('concurrent'),a=f.make(store),b=f.make(new PostgresTestStore(other,{schema,brokerSchema}));
      const outcomes=await Promise.allSettled([a.read(f.input,f.receipt,f.context),b.read(f.input,f.receipt,f.context)]);
      assert.ok(outcomes.some(v=>v.status==='fulfilled'));for(const v of outcomes)if(v.status==='rejected')assert.equal(v.reason.code,'TEST_OUTCOME_UNKNOWN');assert.equal(f.executor.calls.length,1);
      const id=testOperationId(f.authority.scope,f.receipt),read=await b.inspect(f.authority.scope,id,'owner');assert.equal(read.status,'PASSED');
      const saved=await b.readEvidence(f.authority.scope,id,read.evidenceRef,'owner');saved.report.checks[0].passed=false;
      assert.equal((await a.readEvidence(f.authority.scope,id,read.evidenceRef,'owner')).accepted,true);
      assert.deepEqual(await b.read(f.input,f.receipt,f.context),{accepted:true,evidenceRef:read.evidenceRef});assert.equal(f.executor.calls.length,1);
      await assert.rejects(b.inspect({...f.authority.scope,runId:'other'},id,'owner'),{code:'TEST_AUTHORITY_MISSING'});
    });
    await run('unknown claim commit cannot execute and fresh process observes permanent claim',async()=>{
      const f=await setup('unknown-claim');let lost=false;
      const uncertain=new PostgresTestStore(wrap(async(client,sql,values)=>{const result=await client.query(sql,values);if(sql==='COMMIT'&&!lost){lost=true;throw Error('Synthetic lost acknowledgement');}return result;}),{schema,brokerSchema});
      await assert.rejects(f.make(uncertain).read(f.input,f.receipt,f.context),{code:'TEST_COMMIT_UNKNOWN'});assert.equal(f.executor.calls.length,0);
      const child=fork(new URL('./process-worker.mjs',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH},execArgv:[]});children.add(child);child.once('exit',()=>children.delete(child));
      const exited=once(child,'exit'),message=once(child,'message');child.send({config:{...config,database},schema,brokerSchema,input:f.input,receipt:f.receipt,manifest:f.manifest});
      const [reply]=await message;const [code]=await exited;assert.equal(code,0);assert.deepEqual(reply,{status:'CLAIMED',error:'TEST_OUTCOME_UNKNOWN',executions:0});
    });
    await run('rollback permits retry but uncertain terminal commit only recovers immutable evidence',async()=>{
      const f=await setup('rollback');let broken=true;
      const wrapped=new PostgresTestStore(wrap(async(client,sql,values)=>{if(broken&&sql.startsWith('INSERT INTO ')&&sql.includes('.tests')){broken=false;throw Error('Synthetic insert failure');}return client.query(sql,values);}),{schema,brokerSchema});
      const reader=f.make(wrapped);await assert.rejects(reader.read(f.input,f.receipt,f.context),{code:'TEST_DATABASE_ERROR'});assert.equal(f.executor.calls.length,0);
      assert.equal(await reader.inspect(f.authority.scope,testOperationId(f.authority.scope,f.receipt),'owner'),null);
      let terminal=false,lost=false;const uncertain=new PostgresTestStore(wrap(async(client,sql,values)=>{if(sql.startsWith('INSERT INTO ')&&sql.includes('.tests'))terminal=JSON.parse(values[1]).status==='PASSED';const result=await client.query(sql,values);if(sql==='COMMIT'&&terminal&&!lost){lost=true;throw Error('Synthetic lost acknowledgement');}return result;}),{schema,brokerSchema});
      await assert.rejects(f.make(uncertain).read(f.input,f.receipt,f.context),{code:'TEST_COMMIT_UNKNOWN'});assert.equal(f.executor.calls.length,1);
      assert.equal((await f.make(store).read(f.input,f.receipt,f.context)).accepted,true);assert.equal(f.executor.calls.length,1);
    });
    await run('current authority row serializes last approver revocation and cancellation',async()=>{
      const f=await setup('revoked'),otherBroker=new PostgresBrokerStore(other,{schema:brokerSchema});
      await otherBroker.transaction(f.authority.scope,state=>{state.approverSubjects=[];});
      await assert.rejects(f.make(store).read(f.input,f.receipt,f.context),{code:'APPROVAL_REQUIRED'});assert.equal(f.executor.calls.length,0);
      const g=await setup('cancel-active');let entered;const ready=new Promise(r=>entered=r);g.executor.handler=async(request,signal)=>{entered();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));};
      const reader=g.make(store),pending=reader.read(g.input,g.receipt,g.context);void pending.catch(()=>{});await ready;
      await otherBroker.transaction(g.authority.scope,state=>{state.cancelRequested=true;});await reader.cancel(g.input);await assert.rejects(pending);
      assert.equal((await reader.inspect(g.authority.scope,testOperationId(g.authority.scope,g.receipt),'owner')).status,'CANCELLED');assert.equal(g.executor.reaped.length,1);
      await assert.rejects(g.make(new PostgresTestStore(other,{schema,brokerSchema})).read(g.input,g.receipt,g.context),{code:'CANCELLED'});assert.equal(g.executor.calls.length,1);
    });
    await run('authority is detached, void works, and delayed async rejection rolls back safely',async()=>{
      const f=await setup('detached'),id=testOperationId(f.authority.scope,f.receipt);let retained;
      const original=await broker.read(f.authority.scope);
      assert.equal(await store.transaction(f.authority.scope,id,(record,authority)=>{retained=authority;authority.cancelRequested=true;return{record,result:undefined};}),undefined);
      retained.ownerEpoch=2;assert.deepEqual(await broker.read(f.authority.scope),original);
      await assert.rejects(store.transaction(f.authority.scope,id,async()=>{await new Promise(r=>setTimeout(r,10));throw Error('Synthetic delayed callback rejection');}),{code:'INVALID_TEST_MUTATOR'});
      await new Promise(r=>setTimeout(r,30));assert.equal(await f.make(store).inspect(f.authority.scope,id,'owner'),null);
      await assert.rejects(store.transaction(f.authority.scope,id,record=>({record,result:new Date()})),{code:'INVALID_DATA'});
    });
    await run('checksums, strict parsing, scope binding and immutable history reject tampering',async()=>{
      const f=await setup('corrupt'),reader=f.make(store);await reader.read(f.input,f.receipt,f.context);const id=testOperationId(f.authority.scope,f.receipt);
      const saved=(await pool.query(`SELECT state,checksum FROM "${schema}".tests WHERE id=$1`,[id])).rows[0];
      await assert.rejects(store.transaction(f.authority.scope,id,current=>{current.status='HOLD';current.reason='RETRY';current.evidence=null;current.evidenceRef=null;return{record:current,result:null};}),{code:'TEST_HISTORY_CONFLICT'});
      await pool.query(`UPDATE "${schema}".tests SET checksum='wrong' WHERE id=$1`,[id]);await assert.rejects(reader.inspect(f.authority.scope,id,'owner'),{code:'CORRUPT_TEST'});
      const changed=structuredClone(saved.state);changed.request.artifact.content='changed';
      await pool.query(`UPDATE "${schema}".tests SET state=$2::jsonb,checksum=$3 WHERE id=$1`,[id,JSON.stringify(changed),digest(canonicalJson(changed))]);await assert.rejects(reader.inspect(f.authority.scope,id,'owner'),{code:'CORRUPT_TEST'});
      await pool.query(`UPDATE "${schema}".tests SET state=$2::jsonb,checksum=$3 WHERE id=$1`,[id,JSON.stringify(saved.state),saved.checksum]);
      assert.equal((await reader.inspect(f.authority.scope,id,'owner')).status,'PASSED');
      await pool.query(`UPDATE "${schema}".metadata SET version=2`);await assert.rejects(reader.inspect(f.authority.scope,id,'owner'),{code:'TEST_SCHEMA_VERSION'});await pool.query(`UPDATE "${schema}".metadata SET version=1`);
    });
    evidence.databaseBytes=Number((await pool.query('SELECT pg_database_size(current_database()) AS bytes')).rows[0].bytes);
  }finally{
    const errors=[];for(const child of children)try{const exited=once(child,'exit');child.kill('SIGKILL');await exited;}catch{errors.push('child');}
    for(const pool of pools)try{await pool.end();}catch{errors.push('pool');}
    if(created)try{await admin.query(`DROP DATABASE "${database}"`);evidence.databaseAbsent=(await admin.query('SELECT datname FROM pg_database WHERE datname=$1',[database])).rowCount===0;}catch{errors.push('database');}
    try{await admin.end();}catch{errors.push('admin');}
    evidence.childrenReaped=children.size===0;evidence.cleanupErrors=errors;evidence.passed=evidence.cases.length===6&&evidence.cases.every(c=>c.passed)&&evidence.databaseAbsent&&evidence.childrenReaped&&!errors.length;
    mkdirSync('packages/controlled-tests/.trellis',{recursive:true});writeFileSync('packages/controlled-tests/.trellis/postgres-result.json',JSON.stringify(evidence,null,2)+'\n');if(errors.length)throw Error('Synthetic controlled-test cleanup failed.');
  }
});
