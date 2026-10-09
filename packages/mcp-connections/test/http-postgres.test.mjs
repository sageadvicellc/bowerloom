import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, realpathSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import https from 'node:https';
import pg from 'pg';
import { DiscoveryAuthorityController, PostgresDiscoveryAuthorityStore, createDiscoveryProposal,
  createDiscoveryAuthorityState, createMcpHttpDiscoveryFactory, mcpBindingRevision, planMcpConnection } from '../../../dist/packages/mcp-connections/src/index.js';

const enabled=process.env.BOWERLOOM_MCP_HTTP_PROOF==='trellis-alpha-proof@127.0.0.1:56582';
const read=part=>JSON.parse(readFileSync(new URL(`./fixtures/streamable-http-${part}.json`,import.meta.url),'utf8'));
test('real HTTPS discovery uses durable PostgreSQL approval with synthetic accounts',{skip:!enabled,timeout:60000},async t=>{
  const directory=realpathSync(mkdtempSync(join(tmpdir(),'bowerloom-http-db-')));chmodSync(directory,0o700);
  const keyPath=join(directory,'key.pem'),certPath=join(directory,'cert.pem');
  const certResult=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',certPath,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{encoding:'utf8',timeout:10000});
  assert.equal(certResult.status,0,'Synthetic TLS certificate generation failed');chmodSync(keyPath,0o600);
  const key=readFileSync(keyPath),ca=readFileSync(certPath,'utf8');
  const credentials=JSON.parse(readFileSync(process.env.TRELLIS_BROKER_CREDENTIALS_FILE,'utf8'));
  const database=`bowerloom_http_test_${randomBytes(8).toString('hex')}`,schema='bowerloom_mcp_http';
  const options={host:'127.0.0.1',port:56582,user:'postgres',password:credentials.POSTGRES_PASSWORD,ssl:false,connectionTimeoutMillis:3000,idleTimeoutMillis:1000,application_name:'bowerloom_http_proof'};
  const admin=new pg.Client({...options,database:'postgres'}),pool=new pg.Pool({...options,database,max:3});pool.on('error',()=>{});
  const store=new PostgresDiscoveryAuthorityStore(pool,{schema});
  let created=false,requests=0,trapRequests=0,mode='json',currentScope,source,catalogPage=0,serverFailure=null;
  const observed=[];const opaqueToken='synthetic-opaque-access-value';
  const trap=https.createServer({key,cert:ca},(_req,res)=>{trapRequests++;res.writeHead(500).end();});
  const server=https.createServer({key,cert:ca},async(req,res)=>{
    try {
      requests++;assert.equal(req.method,'POST');assert.equal(req.url,'/mcp');assert.equal(req.headers.authorization,`Bearer ${opaqueToken}`);
      const row=(await pool.query(`SELECT state FROM "${schema}".discoveries WHERE workspace_id=$1 AND run_id=$2 AND task_id=$3`,[currentScope.workspaceId,currentScope.runId,currentScope.taskId])).rows[0];
      assert.equal(row.state.status,'IN_FLIGHT');assert.ok(row.state.intent);assert.equal(row.state.approval.revision,row.state.proposal.revision);
      let body='';for await(const chunk of req){body+=chunk;assert.ok(body.length<16384);}const request=JSON.parse(body);observed.push(request.method);
      assert.ok(['initialize','notifications/initialized','tools/list'].includes(request.method));
      if(mode==='redirect'){res.writeHead(307,{location:`https://127.0.0.1:${trap.address().port}/stolen`}).end();return;}
      if(request.method!=='initialize'){assert.equal(req.headers['mcp-session-id'],'synthetic-session');assert.equal(req.headers['mcp-protocol-version'],'2025-11-25');}
      if(request.method==='notifications/initialized'){res.writeHead(202).end();return;}
      let result;
      if(request.method==='initialize')result={protocolVersion:'2025-11-25',serverInfo:source.binding.serverIdentity,capabilities:{tools:{}}};
      else {catalogPage++;const tool=structuredClone(source.catalog.tools[catalogPage===1?0:1]);if(mode==='drift')tool.inputSchema.description='changed schema';
        result=catalogPage===1?{tools:[tool],nextCursor:'second'}:{tools:[tool]};}
      const message=JSON.stringify({jsonrpc:'2.0',id:request.id,result});
      if(mode==='sse'||mode==='notification'){
        res.writeHead(200,{'content-type':'text/event-stream',...(request.method==='initialize'?{'mcp-session-id':'synthetic-session'}:{})});
        if(mode==='notification'&&request.method==='tools/list')res.write('event: message\ndata: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n');
        res.end(`: heartbeat\n\nevent: message\ndata: ${message}\n\n`);
      }else res.writeHead(200,{'content-type':'application/json',...(request.method==='initialize'?{'mcp-session-id':'synthetic-session'}:{})}).end(message);
    }catch(error){serverFailure=error;res.writeHead(500).end('synthetic failure');}
  });
  const close=s=>new Promise(resolve=>{s.close(resolve);s.closeAllConnections();});
  try {
    await admin.connect();await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;await store.createSchema();
    await Promise.all([new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)),new Promise(resolve=>trap.listen(0,'127.0.0.1',resolve))]);
    const endpoint=`https://127.0.0.1:${server.address().port}/mcp`;
    async function setup(id,changeCredential=()=>{},trustedCa=ca) {
      source={declaration:read('declaration'),binding:read('binding'),catalog:read('catalog'),synthetic:true};
      source.binding.transport.endpoint=endpoint;source.binding.transport.auth.audience=endpoint;source.catalog.bindingRevision=mcpBindingRevision(source.binding);
      currentScope={workspaceId:'synthetic',runId:id,taskId:'discovery'};catalogPage=0;
      const proposal=createDiscoveryProposal({scope:currentScope,requestId:id,ownerEpoch:1,input:source,timeoutMs:5000,
        effect:{kind:'streamable-http',endpoint,authBindingRevision:planMcpConnection(source).bindingRevision}});
      const now=Date.now(),state=createDiscoveryAuthorityState(proposal,{scope:currentScope,ownerSubject:'hanna-dummy',ownerEpoch:1,approverSubjects:['hanna-dummy'],readyAtMs:now-100,leaseExpiresAtMs:now+60000,revoked:false});
      await store.seed(state);let credentialReads=0;
      const open=createMcpHttpDiscoveryFactory({loopbackTls:{endpoint,ca:trustedCa},requestTimeoutMs:2000,sessionTimeoutMs:5000,
        resolveCredential:async request=>{credentialReads++;assert.ok(Object.isFrozen(request));const value={...request,token:opaqueToken,expiresAtMs:Date.now()+30000,revoked:false};changeCredential(value,credentialReads);return value;}});
      const controller=new DiscoveryAuthorityController({store,open,identity:{async authenticate(value){assert.equal(value,'synthetic-owner');return {subject:'hanna-dummy',proofRef:'synthetic:proof',expiresAtMs:Date.now()+60000};}}});
      await controller.approve(currentScope,{revision:proposal.revision,expiresAtMs:now+30000},'synthetic-owner');
      return {controller,scope:currentScope,credentialReads:()=>credentialReads};
    }
    for(const responseMode of ['json','sse'])await t.test(`${responseMode} discovery completes only after durable approval and never repeats contact`,async()=>{
      mode=responseMode;const run=await setup(responseMode),before=requests;
      const result=await run.controller.dispatch(run.scope,'synthetic-owner');assert.equal(result.status,'COMPLETED');assert.equal(result.result.pageCount,2);assert.equal(result.result.toolCalls,0);
      assert.equal(requests-before,4);assert.equal(run.credentialReads(),4);
      await run.controller.dispatch(run.scope,'synthetic-owner');assert.equal(requests-before,4);
      assert.ok(!JSON.stringify(await store.read(run.scope)).includes(opaqueToken));
    });
    await t.test('an unrelated certificate authority cannot authenticate the loopback server',async()=>{
      const otherKey=join(directory,'unrelated-key.pem'),otherCert=join(directory,'unrelated-cert.pem');
      const result=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',otherKey,'-out',otherCert,'-days','1','-subj','/CN=unrelated-test-ca'],{encoding:'utf8',timeout:10000});
      assert.equal(result.status,0,'Unrelated test certificate generation failed');chmodSync(otherKey,0o600);
      mode='json';const run=await setup('wrong-ca',()=>{},readFileSync(otherCert,'utf8')),before=requests;
      await assert.rejects(run.controller.dispatch(run.scope,'synthetic-owner'));assert.equal(requests,before);
      assert.equal((await store.read(run.scope)).status,'NEEDS_RECONCILIATION');
    });
    for(const [name,change,expected] of [
      ['wrong audience',v=>{v.audience='https://other.example.test/';},0],
      ['expired',v=>{v.expiresAtMs=Date.now()-1;},0],
      ['revoked after init',(v,n)=>{if(n>1)v.revoked=true;},1],
    ])await t.test(`${name} blocks the next HTTP request`,async()=>{
      mode='json';const run=await setup(name.replaceAll(' ','-'),change),before=requests;
      await assert.rejects(run.controller.dispatch(run.scope,'synthetic-owner'));assert.equal(requests-before,expected);assert.equal((await store.read(run.scope)).status,'NEEDS_RECONCILIATION');
    });
    for(const responseMode of ['redirect','drift','notification'])await t.test(`${responseMode} response holds the intent without another attempt`,async()=>{
      mode=responseMode;const run=await setup(responseMode);await assert.rejects(run.controller.dispatch(run.scope,'synthetic-owner'));
      const before=requests;await assert.rejects(run.controller.dispatch(run.scope,'synthetic-owner'));assert.equal(requests,before);assert.equal(trapRequests,0);
      assert.equal((await store.read(run.scope)).status,'NEEDS_RECONCILIATION');
    });
    assert.equal(serverFailure,null);assert.equal(trapRequests,0);assert.ok(!observed.includes('tools/call'));
    console.log(JSON.stringify({proof:'durable-approval-with-real-loopback-https',requests,trapRequests,jsonAndSse:true,credentialMetadataRechecked:true,realPostgres:true,toolCalls:0,externalEndpoints:0,productionOAuthEnrollment:false}));
  } finally {
    await Promise.all([close(server),close(trap)]);await pool.end();if(created)await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);await admin.end();rmSync(directory,{recursive:true,force:true});
  }
});
