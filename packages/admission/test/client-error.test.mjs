import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const moduleUrl = new URL('../../../dist/packages/admission/src/index.js', import.meta.url).href;
const fixturesUrl = new URL('./fixtures.mjs', import.meta.url).href;
const contractsUrl = new URL('../../../dist/packages/contracts/src/index.js', import.meta.url).href;
function run(mode) {
  const script = `import { EventEmitter } from 'node:events';
import { PostgresAdmission, createAccount } from ${JSON.stringify(moduleUrl)};
import { policy, request, observation, intercept } from ${JSON.stringify(fixturesUrl)};
import { canonicalJson, digest } from ${JSON.stringify(contractsUrl)};
const mode=${JSON.stringify(mode)}, client=new EventEmitter(), queries=[], releases=[], borrowed=[];
let fired=false,lateResolved=false,lateRejected=false,idleErrors=0,otherErrors=0,starts=0;
const idle=()=>idleErrors++,other=()=>otherErrors++;client.on('error',other);
let stored=createAccount('account',['alias'],policy()),staged,commit=0;
const emit=()=>client.emit('error',Error('PRIVATE_CONNECTION_SECRET'));
client.query=async(sql,values)=>{
 queries.push(sql);
 if(mode==='claim'){
  if(sql.startsWith('BEGIN'))staged=structuredClone(stored);
  else if(sql.includes('.metadata FOR SHARE'))return {rows:[{singleton:true,version:1}]};
  else if(sql.includes('WHERE account_id=(SELECT'))return {rows:[{account_id:'account',version:1,state:staged,checksum:digest(canonicalJson(staged))}]};
  else if(sql.startsWith('UPDATE'))staged=JSON.parse(values[1]);
  else if(sql==='COMMIT'){stored=staged;if(++commit===2)queueMicrotask(emit);}
  return {rows:[]};
 }
 if(mode.startsWith('rollback')||mode==='safe-error'){
  if(sql.includes('.metadata FOR SHARE'))return {rows:[{singleton:true,version:99}]};
  if(sql==='ROLLBACK'&&mode==='rollback-reject')throw Error('PRIVATE_ROLLBACK_SECRET');
  if(sql==='ROLLBACK'&&mode==='rollback-error')return new Promise(()=>setImmediate(emit));
  if(sql==='ROLLBACK'&&mode==='rollback-after')queueMicrotask(emit);
  return {rows:[]};
 }
 const target=mode==='commit'||mode==='commit-after'?sql==='COMMIT':sql.startsWith('SET LOCAL lock_timeout');
 if(!fired&&target&&['between','hang','late-reject','commit','commit-after','sync-event','sync-throw'].includes(mode)){
  fired=true;
  if(mode==='sync-throw')throw Error('PRIVATE_QUERY_SECRET');
  if(mode==='sync-event'){emit();return{rows:[]};}
  if(mode==='commit-after'){queueMicrotask(emit);return{rows:[]};}
  return new Promise((resolve,reject)=>{setImmediate(emit);if(mode!=='hang')setTimeout(()=>{
    if(mode==='late-reject'){lateRejected=true;reject(Error('PRIVATE_LATE_SECRET'));}
    else{lateResolved=true;resolve({rows:[]});}
  },25);});
 }
 return{rows:[]};
};
client.release=discard=>{
 releases.push(discard);
 if(mode==='release-throw'){setImmediate(emit);throw Error('PRIVATE_RELEASE_SECRET');}
 client.on('error',idle);if(mode==='release-error')emit();
};
const pool={async connect(){client.removeListener('error',idle);borrowed.push(client.listenerCount('error'));return client;}};
const wrapped=mode==='intercept'?intercept(pool,(c,sql,v)=>c.query(sql,v)):pool;
const store=new PostgresAdmission(wrapped,{schema:'trellis_client_error',launcherId:'launcher',now:()=>10000});
let success=false,code,message;
try{
 if(mode==='claim'){
  const r=await store.reserve(request(),observation());
  await store.launchOnce('alias','job',r.launchPermit,observation(),async()=>{starts++;return{processRef:'unexpected'};});
 }else if(mode.startsWith('rollback')||mode==='safe-error')await store.lookup('alias','job');
 else await store.createSchema([{accountId:'account',aliases:['alias'],policy:policy()}]);
 success=true;
}catch(e){code=e.code;message=e.message;}
if(mode==='normal'||mode==='intercept'){
 await store.createSchema([{accountId:'account',aliases:['alias'],policy:policy()}]);emit();
}
await new Promise(resolve=>setTimeout(resolve,55));
console.log(JSON.stringify({success,code,message,queries,releases,borrowed,listeners:client.listenerCount('error'),idleErrors,otherErrors,lateResolved,lateRejected,starts,status:stored.reservations.job?.status,held:stored.reservations.job?.retained,permitHash:stored.reservations.job?.permitHash}));`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:3000,maxBuffer:65536,env:{PATH:process.env.PATH,NODE_V8_COVERAGE:undefined}});
  assert.equal(child.status,0,child.stderr);assert.equal(child.signal,null);assert.equal(child.stderr,'');
  const result=JSON.parse(child.stdout.trim());assert.doesNotMatch(result.message??'',/PRIVATE_/);return result;
}
test('checked-out emitted errors settle pending queries and prevent every later query',()=>{
 for(const mode of ['between','hang','late-reject','sync-event']){
  const r=run(mode);assert.equal(r.success,false);assert.equal(r.code,'DATABASE_ERROR');assert.deepEqual(r.releases,[true]);
  assert.deepEqual(r.queries,['BEGIN ISOLATION LEVEL READ COMMITTED',"SET LOCAL lock_timeout='5s'"]);
  assert.equal(r.listeners,2);assert.equal(r.idleErrors,0);assert.equal(r.otherErrors,1);
  if(mode==='between')assert.equal(r.lateResolved,true);if(mode==='late-reject')assert.equal(r.lateRejected,true);
 }
});
test('errors during COMMIT and after its response cannot become successful acknowledgement',()=>{
 for(const mode of ['commit','commit-after']){const r=run(mode);assert.equal(r.success,false);assert.equal(r.code,'COMMIT_UNKNOWN');assert.equal(r.queries.at(-1),'COMMIT');assert.ok(!r.queries.includes('ROLLBACK'));assert.deepEqual(r.releases,[true]);}
});
test('healthy rollback preserves safe semantic errors; SQL rejection is sanitized',()=>{
 for(const mode of ['safe-error','sync-throw']){const r=run(mode);assert.equal(r.success,false);assert.equal(r.code,mode==='safe-error'?'UNSUPPORTED_VERSION':'DATABASE_ERROR');assert.equal(r.queries.at(-1),'ROLLBACK');assert.ok(!r.queries.includes('COMMIT'));assert.deepEqual(r.releases,[false]);assert.equal(r.listeners,2);}
});
test('rollback rejection or emitted errors discard the connection without hanging',()=>{
 for(const mode of ['rollback-reject','rollback-error','rollback-after']){const r=run(mode);assert.equal(r.success,false);assert.ok(['ROLLBACK_FAILED','DATABASE_ERROR'].includes(r.code));assert.equal(r.queries.at(-1),'ROLLBACK');assert.deepEqual(r.releases,[true]);assert.equal(r.listeners,2);}
});
test('release faults cannot report success and failed handoff retains the consuming listener',()=>{
 for(const mode of ['release-error','release-throw']){const r=run(mode);assert.equal(r.success,false);assert.equal(r.code,'COMMIT_UNKNOWN');assert.equal(r.listeners,2);assert.equal(r.otherErrors,1);assert.equal(r.idleErrors,mode==='release-error'?1:0);}
});
test('successful reuse and real-client intercept restore pool ownership without removing other listeners',()=>{
 for(const mode of ['normal','intercept']){const r=run(mode);assert.equal(r.success,true);assert.deepEqual(r.releases,[false,false]);assert.deepEqual(r.borrowed,[1,1]);assert.equal(r.listeners,2);assert.equal(r.idleErrors,1);assert.equal(r.otherErrors,1);}
});
test('lost claim acknowledgement never calls start and preserves the consumed claim and allowance',()=>{
 const r=run('claim');assert.equal(r.success,false);assert.equal(r.code,'COMMIT_UNKNOWN');assert.equal(r.starts,0);assert.equal(r.status,'LAUNCHING');assert.equal(r.permitHash,null);assert.equal(r.held.primary.percent,10);assert.deepEqual(r.releases,[false,true]);
});
