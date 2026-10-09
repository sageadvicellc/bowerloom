import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { canonicalJson, digest } from '../../../dist/packages/contracts/src/index.js';
import { createDiscoveryProposal, createDiscoveryAuthorityState, DiscoveryAuthorityController,
  PostgresDiscoveryAuthorityStore, planMcpConnection, McpConnectionError } from '../../../dist/packages/mcp-connections/src/index.js';

const enabled = process.env.BOWERLOOM_MCP_AUTHORITY_PROOF === 'trellis-alpha-proof@127.0.0.1:56582';
const copy = value => JSON.parse(JSON.stringify(value));
const input = () => ({ ...Object.fromEntries(['declaration','binding','catalog'].map(part => [part,
  JSON.parse(readFileSync(new URL(`./fixtures/streamable-http-${part}.json`, import.meta.url), 'utf8'))])), synthetic: true });
function initial(id) {
  const source = input(), scope = { workspaceId:'synthetic', runId:id, taskId:'discovery' };
  const proposal = createDiscoveryProposal({ scope, requestId:id, ownerEpoch:1, input:source,
    effect:{kind:'streamable-http',endpoint:source.binding.transport.endpoint,authBindingRevision:planMcpConnection(source).bindingRevision},timeoutMs:1000 });
  return createDiscoveryAuthorityState(proposal, { scope, ownerSubject:'hanna-dummy', ownerEpoch:1,
    approverSubjects:['hanna-dummy'], readyAtMs:1000, leaseExpiresAtMs:60000, revoked:false });
}
const identity = { async authenticate(value) {
  if(value !== 'synthetic-owner') throw new Error('PRIVATE_IDENTITY_ERROR');
  return {subject:'hanna-dummy',proofRef:'synthetic:proof',expiresAtMs:60000};
} };
const clock = {now:()=>2000,alarm:(deadline,callback)=>{const timer=setTimeout(callback,Math.max(1,deadline-2000));return ()=>clearTimeout(timer);}};
function adapter(observed) {
  return async context => {
    observed.opens++;
    assert.ok(Object.isFrozen(context.effect));
    assert.match(context.operationKey,/^sha256:/);
    return {async initialize(){return {protocolVersion:'2025-11-25',serverInfo:input().binding.serverIdentity,capabilities:{tools:{}}};},
      async initialized(){},async listTools(){return {tools:input().catalog.tools};},async close(){observed.closes++;}};
  };
}
function controller(store, observed, open=adapter(observed)) {
  return new DiscoveryAuthorityController({store,identity,clock,open});
}
const intercept = (pool, hook) => ({async connect(){const client=await pool.connect();return {
  query:(sql,params)=>hook(client,sql,params), release:discard=>client.release(discard),
  on:client.on.bind(client), removeListener:client.removeListener.bind(client),
};}});

test('authority store rejects unsafe namespaces before database contact',()=>{
  let connects=0;const pool={async connect(){connects++;throw new Error('PRIVATE_CONNECTION');}};
  for(const schema of ['public','bowerloom_mcp_../x','bowerloom_mcp_X','bowerloom_mcp_x;DROP SCHEMA public','bowerloom_mcp_'+ 'x'.repeat(40)])
    assert.throws(()=>new PostgresDiscoveryAuthorityStore(pool,{schema}),{code:'MCP_AUTHORITY_SCHEMA'});
  assert.equal(connects,0);
});
test('authority store hides unavailable pool errors and uses no fallback',async()=>{
  let connects=0;const store=new PostgresDiscoveryAuthorityStore({async connect(){connects++;throw new Error('PRIVATE_CONNECTION');}},{schema:'bowerloom_mcp_proof'});
  await assert.rejects(store.createSchema(),error=>error.code==='MCP_AUTHORITY_STORE_UNAVAILABLE'&&!error.message.includes('PRIVATE'));
  assert.equal(connects,1);
});

test('dedicated PostgreSQL discovery authority proof', {skip:!enabled,timeout:60000}, async t => {
  const credentials = JSON.parse(readFileSync(process.env.TRELLIS_BROKER_CREDENTIALS_FILE, 'utf8'));
  assert.equal(typeof credentials.POSTGRES_PASSWORD,'string');
  const options={host:'127.0.0.1',port:56582,user:'postgres',password:credentials.POSTGRES_PASSWORD,ssl:false,
    connectionTimeoutMillis:3000,idleTimeoutMillis:1000,application_name:'bowerloom_mcp_authority_proof'};
  const database=`bowerloom_mcp_test_${randomBytes(8).toString('hex')}`, schema='bowerloom_mcp_proof';
  const admin=new pg.Client({...options,database:'postgres'}),aPool=new pg.Pool({...options,database,max:3}),bPool=new pg.Pool({...options,database,max:3});
  aPool.on('error',()=>{});bPool.on('error',()=>{});
  const a=new PostgresDiscoveryAuthorityStore(aPool,{schema}), b=new PostgresDiscoveryAuthorityStore(bPool,{schema});
  let created=false,observed={opens:0,closes:0};
  const prepare=async id=>{const state=initial(id);await a.seed(state);const c=controller(a,observed);
    await c.approve(state.scope,{revision:state.proposal.revision,expiresAtMs:10000},'synthetic-owner');return state;};
  try {
    await admin.connect();await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;await a.createSchema();
    await t.test('independent pools serialize duplicate provisioning and deny cross-scope reads',async()=>{
      const state=initial('seed'),results=await Promise.allSettled([a.seed(state),b.seed(state)]);
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
      assert.equal(results.find(x=>x.status==='rejected').reason.code,'MCP_AUTHORITY_SCOPE_EXISTS');
      const read=await b.read(state.scope);read.grant.ownerEpoch=99;assert.equal((await a.read(state.scope)).grant.ownerEpoch,1);
      await assert.rejects(a.read({...state.scope,workspaceId:'other'}),{code:'MCP_AUTHORITY_SCOPE_MISSING'});
      await assert.rejects(a.createSchema(),{code:'MCP_AUTHORITY_DATABASE_ERROR'});
    });
    await t.test('concurrent dispatch opens once and completion survives a new controller',async()=>{
      const state=await prepare('race'),before=observed.opens;
      const results=await Promise.allSettled([controller(a,observed).dispatch(state.scope,'synthetic-owner'),controller(b,observed).dispatch(state.scope,'synthetic-owner')]);
      assert.ok(results.some(x=>x.status==='fulfilled'&&x.value.status==='COMPLETED'));
      assert.equal(observed.opens-before,1);assert.equal((await b.read(state.scope)).status,'COMPLETED');
      const again=await controller(b,observed).dispatch(state.scope,'synthetic-owner');assert.equal(again.status,'COMPLETED');assert.equal(observed.opens-before,1);
    });
    await t.test('lost intent acknowledgement persists uncertainty without opening an adapter',async()=>{
      const state=await prepare('lost-intent'),before=observed.opens;let injected=false;
      const pool=intercept(aPool,async(client,sql,params)=>{const result=await client.query(sql,params);
        if(sql==='COMMIT'&&!injected){injected=true;throw new Error('PRIVATE_COMMIT_ERROR');}return result;});
      const store=new PostgresDiscoveryAuthorityStore(pool,{schema});
      await assert.rejects(controller(store,observed).dispatch(state.scope,'synthetic-owner'));
      assert.equal(observed.opens,before);assert.equal((await b.read(state.scope)).status,'IN_FLIGHT');
      await controller(b,observed).recover(state.scope,'synthetic-owner');assert.equal((await a.read(state.scope)).status,'NEEDS_RECONCILIATION');
      await assert.rejects(controller(a,observed).dispatch(state.scope,'synthetic-owner'));assert.equal(observed.opens,before);
    });
    await t.test('lost completion acknowledgement cannot repeat completed discovery',async()=>{
      const state=await prepare('lost-completion'),before=observed.opens;let completion=false,injected=false;
      const pool=intercept(aPool,async(client,sql,params)=>{if(sql.startsWith('UPDATE')&&typeof params?.[3]==='string'&&JSON.parse(params[3]).status==='COMPLETED')completion=true;
        const result=await client.query(sql,params);if(sql==='COMMIT'&&completion&&!injected){injected=true;throw new Error('PRIVATE_COMPLETION_ERROR');}return result;});
      await assert.rejects(controller(new PostgresDiscoveryAuthorityStore(pool,{schema}),observed).dispatch(state.scope,'synthetic-owner'));
      assert.equal(injected,true);assert.equal((await b.read(state.scope)).status,'COMPLETED');
      await controller(b,observed).dispatch(state.scope,'synthetic-owner');assert.equal(observed.opens-before,1);
    });
    await t.test('persisted stop after intent commit prevents adapter opening',async()=>{
      const state=await prepare('stop-boundary'),before=observed.opens;let injected=false;
      const pool=intercept(aPool,async(client,sql,params)=>{const result=await client.query(sql,params);
        if(sql==='COMMIT'&&!injected){injected=true;await controller(b,observed).stop(state.scope,'synthetic-owner');}return result;});
      await controller(new PostgresDiscoveryAuthorityStore(pool,{schema}),observed).dispatch(state.scope,'synthetic-owner').catch(()=>{});
      assert.equal(observed.opens,before);assert.equal((await b.read(state.scope)).stopRequested,true);
    });
    await t.test('persisted revocation after intent commit prevents adapter opening',async()=>{
      const state=await prepare('revoke-boundary'),before=observed.opens;let injected=false;
      const pool=intercept(aPool,async(client,sql,params)=>{const result=await client.query(sql,params);
        if(sql==='COMMIT'&&!injected){injected=true;await b.transaction(state.scope,draft=>{draft.grant.revoked=true;});}return result;});
      await controller(new PostgresDiscoveryAuthorityStore(pool,{schema}),observed).dispatch(state.scope,'synthetic-owner').catch(()=>{});
      assert.equal(observed.opens,before);assert.equal((await b.read(state.scope)).grant.revoked,true);
    });
    await t.test('lost stop acknowledgement still aborts a local active adapter',async()=>{
      const state=await prepare('lost-stop');let armed=false,injected=false,sessionSignal,resolveOpened;
      const opened=new Promise(resolve=>{resolveOpened=resolve;});
      const pool=intercept(aPool,async(client,sql,params)=>{const result=await client.query(sql,params);
        if(sql==='COMMIT'&&armed&&!injected){injected=true;throw new Error('PRIVATE_STOP_ACK');}return result;});
      const c=controller(new PostgresDiscoveryAuthorityStore(pool,{schema}),observed,async context=>{
        const transport=await adapter(observed)(context);sessionSignal=context.signal;
        const initialize=transport.initialize;transport.initialize=async()=>{resolveOpened();return initialize();};
        transport.listTools=()=>new Promise(()=>{});return transport;
      });
      const running=c.dispatch(state.scope,'synthetic-owner').catch(error=>error);
      await opened;armed=true;await assert.rejects(c.stop(state.scope,'synthetic-owner'));
      assert.equal(injected,true);assert.equal(sessionSignal.aborted,true);
      await running;assert.equal((await b.read(state.scope)).stopRequested,true);
    });
    await t.test('immediate adapter rejection stays handled during a delayed commit acknowledgement',async()=>{
      const state=await prepare('rejected-open');let commits=0,opens=0;
      const pool=intercept(aPool,async(client,sql,params)=>{const result=await client.query(sql,params);
        if(sql==='COMMIT'&&++commits===2)await new Promise(resolve=>setTimeout(resolve,30));return result;});
      const c=controller(new PostgresDiscoveryAuthorityStore(pool,{schema}),observed,async()=>{opens++;throw new Error('PRIVATE_ADAPTER_MARKER');});
      await assert.rejects(c.dispatch(state.scope,'synthetic-owner'),{code:'MCP_AUTHORITY_DISPATCH_UNCERTAIN',message:'MCP_AUTHORITY_DISPATCH_UNCERTAIN'});
      assert.equal(opens,1);assert.equal((await b.read(state.scope)).status,'NEEDS_RECONCILIATION');
      await assert.rejects(c.dispatch(state.scope,'synthetic-owner'));assert.equal(opens,1);
    });
    await t.test('callback rollback and forged record cannot erase durable history',async()=>{
      const state=await prepare('rollback'),before=await a.read(state.scope);
      await assert.rejects(a.transaction(state.scope,draft=>{draft.stopRequested=true;throw new Error('PRIVATE_MUTATOR_ERROR');}),{code:'MCP_AUTHORITY_DATABASE_ERROR'});
      assert.deepEqual(await b.read(state.scope),before);
      await assert.rejects(a.transaction(state.scope,async()=>{}),{code:'MCP_AUTHORITY_ASYNC_MUTATOR'});
      await assert.rejects(a.transaction(state.scope,()=>{throw new McpConnectionError('PRIVATE_MARKER');}),{code:'MCP_AUTHORITY_STATE_REFUSED',message:'MCP_AUTHORITY_STATE_REFUSED'});
      await assert.rejects(a.transaction(state.scope,draft=>{draft.proposal.requestId='replacement';}));
      await aPool.query(`UPDATE "${schema}".discoveries SET checksum=$1 WHERE run_id=$2`,['sha256:'+'0'.repeat(64),'rollback']);
      await assert.rejects(b.read(state.scope),{code:'MCP_AUTHORITY_STATE_CORRUPT'});
      await assert.rejects(controller(b,observed).dispatch(state.scope,'synthetic-owner'),{code:'MCP_AUTHORITY_STORE_UNCERTAIN'});
      const damaged=copy(before);damaged.scope.workspaceId='other';
      await aPool.query(`UPDATE "${schema}".discoveries SET state=$1::jsonb,checksum=$2 WHERE run_id=$3`,[canonicalJson(damaged),digest(canonicalJson(damaged)),'rollback']);
      await assert.rejects(b.read(state.scope));
    });
    console.log(JSON.stringify({proof:'postgres-mcp-discovery-authority',separatePools:true,opens:observed.opens,closes:observed.closes,
      realDatabase:true,adapter:'synthetic-in-process',externalRequests:0,toolCalls:0,productionTransport:false}));
  } finally {
    await aPool.end();await bPool.end();
    if(created)await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.end();
  }
});
