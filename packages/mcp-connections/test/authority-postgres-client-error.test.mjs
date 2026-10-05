import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const moduleUrl=new URL('../../../dist/packages/mcp-connections/src/authority-postgres.js',import.meta.url).href;
function run(mode){
 const script=`import {EventEmitter} from 'node:events';import {PostgresDiscoveryAuthorityStore} from ${JSON.stringify(moduleUrl)};
 const mode=${JSON.stringify(mode)},client=new EventEmitter(),queries=[],releases=[];let fired=false,lateResolved=false,borrowedCounts=[],idleErrors=0;
 const idle=()=>{idleErrors++;};const expected=mode==='commit'||mode==='commit-after'||mode==='release'?'MCP_AUTHORITY_COMMIT_UNKNOWN':'MCP_AUTHORITY_DATABASE_ERROR';
 client.query=async sql=>{queries.push(sql);if(mode==='normal')return{rows:[]};
  const target=mode==='commit'||mode==='commit-after'?sql==='COMMIT':sql.startsWith('SET LOCAL lock_timeout');
  if(!fired&&target&&mode==='commit-after'){fired=true;queueMicrotask(()=>client.emit('error',Error('PRIVATE_POST_RESPONSE_ERROR')));return{rows:[]};}
  if(!fired&&target&&mode!=='release'){fired=true;return new Promise(resolve=>{setImmediate(()=>client.emit('error',Error('PRIVATE_DRIVER_ERROR')));if(mode!=='hang')setTimeout(()=>{lateResolved=true;resolve({rows:[]});},25);});}
  return{rows:[]};};
 client.release=discard=>{releases.push(discard);client.on('error',idle);if(mode==='release')client.emit('error',Error('PRIVATE_RELEASE_ERROR'));};
 const pool={async connect(){client.removeListener('error',idle);borrowedCounts.push(client.listenerCount('error'));return client;}};
 const store=new PostgresDiscoveryAuthorityStore(pool,{schema:'bowerloom_mcp_client_error'});let code,success=false;
 try{await store.createSchema();success=true;}catch(e){code=e.code;if(e.message!==e.code)throw Error('UNSANITIZED');}
 if(mode==='normal'){await store.createSchema();client.emit('error',Error('IDLE_EVENT'));}
 await new Promise(resolve=>setTimeout(resolve,45));
 console.log(JSON.stringify({code,success,queries,releases,borrowedCounts,listeners:client.listenerCount('error'),idleErrors,lateResolved,expected}));`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:2500,maxBuffer:32768,env:{PATH:process.env.PATH,NODE_V8_COVERAGE:undefined}});
 assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);assert.equal(result.stderr,'');return JSON.parse(result.stdout.trim());
}
test('checked-out asynchronous errors are consumed, latched and discarded without late queries',()=>{
 for(const mode of ['between','hang']){const r=run(mode);assert.equal(r.success,false);assert.equal(r.code,r.expected);assert.deepEqual(r.releases,[true]);assert.deepEqual(r.queries,['BEGIN ISOLATION LEVEL READ COMMITTED',"SET LOCAL lock_timeout='5s'"]);assert.equal(r.listeners,1);assert.equal(r.idleErrors,0);}
});
test('errors during or after the COMMIT response stay uncertain despite late resolution',()=>{
 for(const mode of ['commit','commit-after']){const r=run(mode);assert.equal(r.success,false);assert.equal(r.code,'MCP_AUTHORITY_COMMIT_UNKNOWN');assert.equal(r.queries.at(-1),'COMMIT');assert.equal(r.queries.includes('ROLLBACK'),false);assert.deepEqual(r.releases,[true]);assert.equal(r.listeners,1);assert.equal(r.lateResolved,mode==='commit');}
});
test('successful client reuse removes only the transaction listener and restores pool ownership',()=>{
 const r=run('normal');assert.equal(r.success,true);assert.deepEqual(r.releases,[false,false]);assert.deepEqual(r.borrowedCounts,[0,0]);assert.equal(r.listeners,1);assert.equal(r.idleErrors,1);
});
test('an error during release cannot turn into a successful acknowledgement',()=>{
 const r=run('release');assert.equal(r.success,false);assert.equal(r.code,'MCP_AUTHORITY_COMMIT_UNKNOWN');assert.equal(r.listeners,1);assert.equal(r.idleErrors,1);
});
