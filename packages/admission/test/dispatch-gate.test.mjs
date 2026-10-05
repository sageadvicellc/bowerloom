import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { PostgresAdmission, createAccount, AdmissionError } from '../../../dist/packages/admission/src/index.js';
import { AdmissionAttempt, createDispatchGate, parseHr } from '../../../dist/packages/admission/src/dispatch-gate.js';
import { canonicalJson, digest } from '../../../dist/packages/contracts/src/index.js';
import { policy, request, observation } from './fixtures.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function memoryPool(initial=createAccount('account',['alias'],policy())) {
  let stored=structuredClone(initial),tail=Promise.resolve();
  const pool={clients:[],queries:[],hook:null,connectHook:null,releaseHook:null,snapshot:()=>structuredClone(stored),mutate(fn){fn(stored);},async connect(){
    if(pool.connectHook)return pool.connectHook();
    const before=tail,unlocked=deferred();tail=unlocked.promise;await before;
    const client=new EventEmitter();pool.clients.push(client);let staged,released=false;
    client.release=destroy=>{assert.equal(released,false,'release once');released=true;client.discard=destroy;client.on('error',()=>{});pool.releaseHook?.(client);unlocked.resolve();};
    const execute=(sql,values)=>{
      if(sql.startsWith('BEGIN'))staged=structuredClone(stored);
      else if(sql.startsWith('SET LOCAL')){}
      else if(sql==='SELECT current_database() AS name')return{rows:[{name:'synthetic'}]};
      else if(sql.includes('.metadata FOR SHARE'))return{rows:[{singleton:true,version:1}]};
      else if(sql.includes('WHERE account_id=(SELECT'))return{rows:[{account_id:staged.accountId,version:1,state:structuredClone(staged),checksum:digest(canonicalJson(staged))}]};
      else if(sql.startsWith('UPDATE')){staged=JSON.parse(values[1]);assert.equal(values[2],digest(canonicalJson(staged)));}
      else if(sql==='COMMIT')stored=structuredClone(staged);
      else if(sql==='ROLLBACK')staged=undefined;
      else throw Error('unexpected mock query');
      return{rows:[]};
    };
    client.query=async(sql,values)=>{pool.queries.push(sql);if(pool.hook){const result=await pool.hook(sql,values,client,execute);if(result!==undefined)return result;}return execute(sql,values);};
    return client;
  }};return pool;
}
function setup({pool=memoryPool(),binding={},signal,assertFence=()=>{},clock}={}){
  let now=10000,offset=0n;const base=process.hrtime.bigint();const abort=new AbortController();
  const mono=()=>process.hrtime.bigint()-base+1_000_000_000n+offset;
  const req=request();
  const control={binding:{installationId:'installation',databaseName:'synthetic',admissionSchema:'trellis_control',launcherId:'launcher',accountId:'account',accountAlias:'alias',requestDigest:digest(canonicalJson(req)),authorizationRevision:'a'.repeat(64),expiresAtMs:30000,...binding},signal:signal??abort.signal,assert:assertFence};
  const store=new PostgresAdmission(pool,{schema:'trellis_control',launcherId:'launcher',now:()=>now,monotonicNow:clock??mono,controlIdentity:{installationId:'installation',databaseName:'synthetic'}});
  return{pool,store,req,control,abort,now:()=>now,advance(ms){now+=ms;offset+=BigInt(ms)*1_000_000n;},wall(ms){now=ms;},mono,async reserve(){const r=await store.reserveControlled(req,observation('account',now),control);assert.equal(r.kind,'accepted');return r;},launch(permit,start){return store.launchOnceControlled('alias','job',permit,observation('account',now),start,control);}};
}
const start=env=>async(req,gate)=>{assert.deepEqual(req,env.req);await gate.check(observation('account',env.now()));const envelope=gate.consume();assert.equal(envelope.requestDigest,env.control.binding.requestDigest);return{processRef:'process',launcherId:'launcher'};};
const held=env=>{const row=env.pool.snapshot().reservations.job;assert.ok(['LAUNCHING','RUNNING','UNKNOWN'].includes(row.status));assert.equal(row.permitHash,null);assert.equal(row.retained.primary.percent,10);return row;};

test('controlled successful start requires a committed check and immutable one-use envelope',async()=>{
 const e=setup(),r=await e.reserve();let gate,envelope;
 const result=await e.launch(r.launchPermit,async(req,g)=>{gate=g;await g.check(observation());envelope=g.consume();assert.ok(Object.isFrozen(envelope)&&Object.isFrozen(envelope.binding));assert.equal(envelope.reservationId,r.reservation.reservationId);assert.ok(parseHr(envelope.parentHrNs)<parseHr(envelope.notAfterHrNs));return{processRef:'process',launcherId:'launcher'};});
 assert.equal(result.kind,'started');assert.equal(held(e).status,'RUNNING');assert.throws(()=>gate.consume());await assert.rejects(gate.check(observation()));
 let starts=0;const replay=await e.launch(r.launchPermit,async()=>{starts++;});assert.equal(replay.reason,'ALREADY_CLAIMED');assert.equal(starts,0);
});
test('callback success without consume, forged envelope, wrong launcher or throw remains held',async()=>{
 for(const mode of ['no-consume','fake','wrong-launcher','throw']){
  const e=setup(),r=await e.reserve();await assert.rejects(e.launch(r.launchPermit,async(req,g)=>{
   await g.check(observation());if(mode==='wrong-launcher'||mode==='throw')g.consume();
   if(mode==='throw')throw Error('PRIVATE_CALLBACK');
   return{processRef:'process',launcherId:mode==='wrong-launcher'?'other':'launcher',...(mode==='fake'?{envelope:{format:'bowerloom/admission-dispatch/v1'}}:{})};
  }),{code:'LAUNCH_UNKNOWN'});assert.equal(held(e).status,'LAUNCHING');
 }
});
test('consume before check, double consume and check after consume permanently close the attempt',async()=>{
 for(const mode of ['before','double','after']){
  const e=setup(),r=await e.reserve();await assert.rejects(e.launch(r.launchPermit,async(req,g)=>{
   if(mode!=='before')await g.check(observation());if(mode==='before')assert.throws(()=>g.consume());else{g.consume();if(mode==='double')assert.throws(()=>g.consume());else await assert.rejects(g.check(observation()));}
   return{processRef:'process',launcherId:'launcher'};
  }),{code:'LAUNCH_UNKNOWN'});held(e);
 }
});
test('host binding mismatches and hostile descriptors refuse before client acquisition',async()=>{
 for(const field of ['installationId','databaseName','admissionSchema','launcherId','accountAlias','requestDigest']){
  const e=setup({binding:{[field]:field==='requestDigest'?'b'.repeat(64):'wrong'}});
  await assert.rejects(e.store.reserveControlled(e.req,observation(),e.control));assert.equal(e.pool.clients.length,0);
 }
 const e=setup();let called=0;Object.defineProperty(e.control.binding,'accountId',{enumerable:true,get(){called++;return'account';}});
 await assert.rejects(e.store.reserveControlled(e.req,observation(),e.control));assert.equal(called,0);assert.equal(e.pool.clients.length,0);
});
test('actual database and canonical account mismatches rollback without a reservation',async()=>{
 for(const kind of ['database','account']){const e=setup({binding:kind==='account'?{accountId:'other'}:{}});
  if(kind==='database')e.pool.hook=async sql=>sql==='SELECT current_database() AS name'?{rows:[{name:'other'}]}:undefined;
  await assert.rejects(e.store.reserveControlled(e.req,observation(),e.control),{code:'CONTROL_IDENTITY'});assert.deepEqual(e.pool.snapshot().reservations,{});assert.equal(e.pool.queries.at(-1),'ROLLBACK');
 }
});
test('pin control/request before asynchronous acquisition so caller mutation cannot substitute authority',async()=>{
 const e=setup(),entered=deferred(),release=deferred();e.pool.hook=async sql=>{if(sql.startsWith('BEGIN')){entered.resolve();await release.promise;}};
 const pending=e.reserve();await entered.promise;e.req.jobId='other';e.control.binding.accountId='other';release.resolve();const reserved=await pending;
 assert.equal(reserved.reservation.request.jobId,'job');assert.equal(e.pool.snapshot().accountId,'account');
});
test('ordered wall-clock and monotonic samples reject reversals and uint64 arithmetic errors',async()=>{
 for(const value of ['-1','01','1.5','18446744073709551616','99999999999999999999',1,undefined])assert.throws(()=>parseHr(value));
 assert.equal(parseHr('18446744073709551615'),(1n<<64n)-1n);
 for(const clock of [()=>-1n,()=>1n<<64n,()=>((1n<<64n)-1n),()=>1]){
  const e=setup({clock});await assert.rejects(e.store.reserveControlled(e.req,observation(),e.control));assert.equal(e.pool.clients.length,0);
 }
 for(const mode of ['wall','mono']){let hr=1_000_000_000n;const e=setup(mode==='mono'?{clock:()=>hr}:{}),r=await e.reserve();
  await assert.rejects(e.launch(r.launchPermit,async(req,g)=>{await g.check(observation());if(mode==='wall')e.wall(9999);else hr--;assert.throws(()=>g.consume());return{processRef:'process',launcherId:'launcher'};}),{code:'LAUNCH_UNKNOWN'});held(e);
 }
});
test('refreshed evidence tightens but never renews the original claim cutoff',async()=>{
 const e=setup(),r=await e.reserve();await assert.rejects(e.launch(r.launchPermit,async(req,g)=>{
  await g.check(observation());e.advance(4000);await g.check(observation('account',e.now()));e.advance(1001);assert.throws(()=>g.consume());return{processRef:'process',launcherId:'launcher'};
 }),{code:'LAUNCH_UNKNOWN'});held(e);
 const t=setup(),s=await t.reserve();let tightened;
 const result=await t.launch(s.launchPermit,async(req,g)=>{
  t.pool.mutate(state=>{state.policy.maxObservationAgeMs=1000;});
  await g.check(observation());tightened=g.consume().notAfterWallMs;
  return{processRef:'process',launcherId:'launcher'};
 });assert.equal(result.kind,'started');assert.equal(tightened,11000);
});
test('concurrent gate checks close both generations and late query success cannot arm or commit',async()=>{
 const e=setup(),r=await e.reserve(),entered=deferred(),late=deferred();let stoppedCount;
 await assert.rejects(e.launch(r.launchPermit,async(req,g)=>{
  e.pool.hook=async sql=>{if(sql==='SELECT current_database() AS name'){entered.resolve();return late.promise;}};
  const first=g.check(observation());void first.catch(()=>{});await entered.promise;
  await assert.rejects(g.check(observation()));await assert.rejects(first);stoppedCount=e.pool.queries.length;
  late.resolve({rows:[{name:'synthetic'}]});await tick();assert.equal(e.pool.queries.length,stoppedCount);assert.throws(()=>g.consume());return{processRef:'process',launcherId:'launcher'};
 }),{code:'LAUNCH_UNKNOWN'});held(e);await tick();
});
test('a new failed check invalidates earlier eligibility forever',async()=>{
 const e=setup(),r=await e.reserve();await assert.rejects(e.launch(r.launchPermit,async(req,g)=>{
  await g.check(observation());await assert.rejects(g.check({...observation(),authentication:'none'}));assert.throws(()=>g.consume());await assert.rejects(g.check(observation()));return{processRef:'process',launcherId:'launcher'};
 }),{code:'LAUNCH_UNKNOWN'});held(e);
});
test('late pool client is discarded exactly once without BEGIN after cancellation',async()=>{
 const e=setup(),late=deferred();const client=new EventEmitter();let released=0,queries=0;client.query=()=>{queries++;};client.release=discard=>{assert.equal(discard,true);released++;};e.pool.connectHook=()=>late.promise;
 const pending=e.store.reserveControlled(e.req,observation(),e.control);await tick();e.abort.abort();await assert.rejects(pending);late.resolve(client);await tick();assert.equal(released,1);assert.equal(queries,0);assert.equal(client.listenerCount('error'),0);
});
test('never-settling pool acquisition is bounded independently of the grant expiry', {timeout:4000},async()=>{
 const e=setup();e.pool.connectHook=()=>new Promise(()=>{});const begin=performance.now();await assert.rejects(e.store.reserveControlled(e.req,observation(),e.control),{code:'CONTROL_TIMEOUT'});assert.ok(performance.now()-begin<3000);assert.equal(e.pool.queries.length,0);
});
test('never-settling query and late query rejection are closed without additional commands',async()=>{
 for(const rejection of [false,true]){const e=setup(),entered=deferred(),late=deferred();e.pool.hook=async sql=>{if(sql.startsWith('SET LOCAL lock_timeout')){entered.resolve();return late.promise;}};
  const pending=e.store.reserveControlled(e.req,observation(),e.control);await entered.promise;e.abort.abort();await assert.rejects(pending);const count=e.pool.queries.length;
  rejection?late.reject(Error('PRIVATE_LATE')):late.resolve({rows:[]});await tick();assert.equal(e.pool.queries.length,count);assert.equal(e.pool.clients[0].discard,true);assert.deepEqual(e.pool.snapshot().reservations,{});
 }
});
test('delayed timer fulfillment past transaction cap refuses before later queries',async()=>{
 const e=setup();let advanced=false;e.pool.hook=async sql=>{if(!advanced&&sql.startsWith('SET LOCAL lock_timeout')){advanced=true;e.advance(2001);}};
 await assert.rejects(e.store.reserveControlled(e.req,observation(),e.control));assert.equal(e.pool.queries.at(-1),"SET LOCAL lock_timeout='5s'");assert.equal(e.pool.clients[0].discard,true);
});
test('cancel during claim COMMIT stays uncertain even after its real response and never calls start',async()=>{
 const e=setup(),r=await e.reserve(),entered=deferred(),late=deferred();let starts=0;
 e.pool.hook=async(sql,v,c,execute)=>{if(sql==='COMMIT'){const result=execute(sql,v);entered.resolve();await late.promise;return result;}};
 const pending=e.launch(r.launchPermit,async()=>{starts++;return{processRef:'process',launcherId:'launcher'};});await entered.promise;e.abort.abort();await assert.rejects(pending,{code:'COMMIT_UNKNOWN'});assert.equal(starts,0);held(e);late.resolve();await tick();assert.equal(starts,0);assert.equal(e.pool.clients.at(-1).discard,true);
});
test('lost claim acknowledgement retains one-use hold; no synthetic callback runs',async()=>{
 const e=setup(),r=await e.reserve();let starts=0;e.pool.hook=async(sql,v,c,execute)=>{if(sql==='COMMIT'){execute(sql,v);throw Error('PRIVATE_COMMIT');}};
 await assert.rejects(e.launch(r.launchPermit,async()=>{starts++;}),{code:'COMMIT_UNKNOWN'});assert.equal(starts,0);held(e);
});
test('bookkeeping COMMIT failure after consumed callback stays uncertain and held',async()=>{
 const e=setup(),r=await e.reserve();let started=0;
 await assert.rejects(e.launch(r.launchPermit,async(req,g)=>{await g.check(observation());g.consume();started++;e.pool.hook=async(sql,v,c,execute)=>{if(sql==='COMMIT'){execute(sql,v);throw Error('PRIVATE_COMMIT');}};return{processRef:'process',launcherId:'launcher'};}),{code:'COMMIT_UNKNOWN'});
 assert.equal(started,1);assert.equal(held(e).status,'RUNNING');
});
test('healthy semantic failure followed by hung rollback is bounded and discarded',async()=>{
 const e=setup(),entered=deferred(),late=deferred();e.pool.hook=async sql=>{if(sql==='SELECT current_database() AS name')return{rows:[{name:'wrong'}]};if(sql==='ROLLBACK'){entered.resolve();return late.promise;}};
 const pending=e.store.reserveControlled(e.req,observation(),e.control);await entered.promise;e.abort.abort();await assert.rejects(pending);late.resolve({rows:[]});await tick();assert.equal(e.pool.clients[0].discard,true);assert.equal(e.pool.queries.at(-1),'ROLLBACK');
});
test('same-operation concurrent controlled launch admits only one synthetic callback',async()=>{
 const e=setup(),r=await e.reserve();let calls=0;const callback=async(req,g)=>{calls++;await g.check(observation());g.consume();return{processRef:'process',launcherId:'launcher'};};
 const outcomes=await Promise.all([e.launch(r.launchPermit,callback),e.launch(r.launchPermit,callback)]);assert.equal(calls,1);assert.equal(outcomes.filter(x=>x.kind==='started').length,1);assert.equal(outcomes.find(x=>x.kind==='denied').reason,'ALREADY_CLAIMED');
});
test('returned-but-unconsumed callback closes any saved gate',async()=>{
 const e=setup(),r=await e.reserve();let saved;await assert.rejects(e.launch(r.launchPermit,async(req,g)=>{saved=g;await g.check(observation());return{processRef:'process',launcherId:'launcher'};}),{code:'LAUNCH_UNKNOWN'});assert.throws(()=>saved.consume());await assert.rejects(saved.check(observation()));held(e);
});

test('client errors during controlled acquisition handoff are consumed before any BEGIN',async()=>{
 const pool=memoryPool();let fired=false;const e=setup({pool,assertFence(){if(!fired&&pool.clients.length&&pool.queries.length===0){fired=true;pool.clients[0].emit('error',Error('PRIVATE_HANDOFF'));}}});
 await assert.rejects(e.store.reserveControlled(e.req,observation(),e.control));assert.equal(fired,true);assert.equal(pool.queries.length,0);assert.equal(pool.clients[0].discard,true);
});
test('claim commit that stalls beyond its original cutoff never invokes callback',async()=>{
 const e=setup(),r=await e.reserve();let count=0;e.pool.hook=async(sql,v,c,execute)=>{if(sql==='COMMIT'){const result=execute(sql,v);e.advance(5001);return result;}};
 await assert.rejects(e.launch(r.launchPermit,async()=>{count++;}),{code:'COMMIT_UNKNOWN'});assert.equal(count,0);held(e);
});
test('transaction watchdog bounds a silent query and a silent healthy rollback', {timeout:7000},async()=>{
 for(const rollback of [false,true]){const e=setup();e.pool.hook=async sql=>{
   if(rollback&&sql==='SELECT current_database() AS name')return{rows:[{name:'other'}]};
   if(sql===(rollback?'ROLLBACK':"SET LOCAL lock_timeout='5s'"))return new Promise(()=>{});
  };
  const begin=performance.now();await assert.rejects(e.store.reserveControlled(e.req,observation(),e.control));await tick();assert.ok(performance.now()-begin<3000);assert.equal(e.pool.clients[0].discard,true);assert.equal(e.pool.queries.at(-1),rollback?'ROLLBACK':"SET LOCAL lock_timeout='5s'");
 }
});
test('late pool rejection and a late COMMIT rejection after cancellation are observed',async()=>{
 const e=setup(),poolLate=deferred();e.pool.connectHook=()=>poolLate.promise;
 const acquisition=e.store.reserveControlled(e.req,observation(),e.control);await tick();e.abort.abort();await assert.rejects(acquisition);poolLate.reject(Error('PRIVATE_LATE_POOL'));await tick();
 const c=setup(),r=await c.reserve(),entered=deferred(),commitLate=deferred();c.pool.hook=async(sql,v,client,execute)=>{if(sql==='COMMIT'){execute(sql,v);entered.resolve();return commitLate.promise;}};
 const claiming=c.launch(r.launchPermit,async()=>{throw Error('must not start');});await entered.promise;c.abort.abort();await assert.rejects(claiming,{code:'COMMIT_UNKNOWN'});commitLate.reject(Error('PRIVATE_LATE_COMMIT'));await tick();held(c);
});

test('falsey or private pool rejections never resolve as a successful acquisition',async()=>{
 for(const reason of [undefined,null,false,Error('PRIVATE_POOL_DETAIL')]){const e=setup();e.pool.connectHook=()=>Promise.reject(reason);
  await assert.rejects(e.store.reserveControlled(e.req,observation(),e.control),error=>error.code==='CONTROL_OPERATION'&&!error.message.includes('PRIVATE_'));assert.equal(e.pool.queries.length,0);
 }
});


test('synchronous abort or closure in queued host fence never authorizes work', async()=>{
 for(const mode of ['abort','close']){
  let calls=0,work=0,attempt;const e=setup({assertFence:()=>{if(++calls===3){if(mode==='abort')e.abort.abort();else attempt.close();}}});
  attempt=new AdmissionAttempt(e.control,e.now,e.mono);
  await assert.rejects(attempt.wait(async()=>{work++;}),{code:mode==='abort'?'CONTROL_CANCELLED':'CONTROL_CLOSED'});
  assert.equal(calls,3);assert.equal(work,0);assert.equal(attempt.closed,true);
 }
});
test('synchronous clock callback aborts are checked before permission and subsequent clock callbacks',async()=>{
 for(const where of ['mono','wall']){
  const e=setup();let armed=false,work=0,wallCalls=0;
  const attempt=new AdmissionAttempt(e.control,()=>{wallCalls++;if(armed&&where==='wall')e.abort.abort();return e.now();},()=>{if(armed&&where==='mono')e.abort.abort();return e.mono();});
  armed=true;const before=wallCalls;
  assert.throws(()=>attempt.wait(async()=>{work++;}),{code:'CONTROL_CANCELLED'});
  assert.equal(work,0);if(where==='mono')assert.equal(wallCalls,before);assert.equal(attempt.closed,true);
 }
});
test('reentrant query and start fences cancel before external action',async()=>{
 const e=setup();let trip=false;
 e.control.assert=()=>{if(trip)e.abort.abort();};
 e.pool.hook=async sql=>{if(sql.startsWith('BEGIN'))trip=true;};
 await assert.rejects(e.store.reserveControlled(e.req,observation(),e.control),{code:'CONTROL_CANCELLED'});
 assert.deepEqual(e.pool.queries,['BEGIN ISOLATION LEVEL READ COMMITTED']);
 const s=setup(),r=await s.reserve();let arm=false,starts=0;
 s.control.assert=()=>{if(arm)s.abort.abort();};
 s.pool.releaseHook=()=>{arm=true;};
 await assert.rejects(s.launch(r.launchPermit,async()=>{starts++;}),{code:'COMMIT_UNKNOWN'});
 assert.equal(starts,0);held(s);
});
test('controlled rejections use fixed codes and stored sanitized messages at every gate boundary',async()=>{
 for(const code of ['CONTROL_PRIVATE_SENTINEL','CONTROL_OPERATION','DATABASE_ERROR']){
  for(const where of ['fence','wait','gate']){
   const e=setup();let armed=false;const raw=new AdmissionError(code,'PRIVATE_MESSAGE');
   e.control.assert=()=>{if(armed&&where==='fence')throw raw;};
   const attempt=new AdmissionAttempt(e.control,e.now,e.mono);armed=true;
   const validate=error=>{assert.notEqual(error,raw);assert.equal(JSON.stringify({code:error.code,message:error.message}).includes('PRIVATE'),false);assert.equal(error.code,code==='CONTROL_PRIVATE_SENTINEL'?'CONTROL_CLOSED':code);return true;};
   if(where==='fence')assert.throws(()=>attempt.check(),validate);
   if(where==='wait')await assert.rejects(attempt.wait(async()=>{throw raw;}),validate);
   if(where==='gate'){const owned=createDispatchGate(attempt,{reservationId:'reservation',requestDigest:e.control.binding.requestDigest,claimedAtMs:e.now()},async()=>{throw raw;});await assert.rejects(owned.gate.check(observation()),validate);}
   assert.equal(attempt.closed,true);assert.throws(()=>attempt.check(),validate);
  }
 }
});
