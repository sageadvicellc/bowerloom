import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { GraphDriver, PostgresGraphStore } from '../../../dist/packages/graph/src/index.js';
import { input, Executor, TestStore, canonicalJson, digest } from './fixtures.mjs';

// This owned child intentionally has no unhandledRejection listener or policy flag.
const mode=process.argv[2];
assert.ok(['delayed','immediate','foreign'].includes(mode));
const state=(await new GraphDriver(new TestStore(),new Executor()).submit(await input('async-mutator'))).state;
const initial=canonicalJson(state),commands=[];let callbacks=0,releases=0,settled=false,thenReads=0;
const pool={async connect(){return{
  async query(sql){
    commands.push(sql);
    if(sql.startsWith('SELECT singleton'))return{rows:[{singleton:true,version:1}]};
    if(sql.startsWith('SELECT version'))return{rows:[{version:1,state,checksum:digest(canonicalJson(state))}]};
    return{rows:[]};
  },
  release(discard){assert.equal(discard,false);releases++;},
};}};
const mutation=mode==='foreign'
  ? runInNewContext('(async function(current,delay,mark){await delay(20);current.cancelRequested=true;mark();throw Error("synthetic-foreign-rejection");})')
  : async(current,wait,mark)=>{
      if(mode==='delayed')await wait(20);
      current.cancelRequested=true;mark();throw new Error('synthetic-async-rejection');
    };
await assert.rejects(new PostgresGraphStore(pool,'trellis_async').transaction(state.id,current=>{
  callbacks++;
  const returned=mutation(current,delay,()=>{settled=true;});
  Object.defineProperty(returned,'then',{get(){thenReads++;throw new Error('Must not call custom then');}});
  return returned;
}),{code:'INVALID_MUTATOR'});
if(mode!=='immediate')assert.equal(settled,false,'store must roll back without awaiting the invalid callback');
await delay(60);
assert.equal(settled,true);assert.equal(callbacks,1);assert.equal(releases,1);assert.equal(thenReads,0);
assert.equal(commands.filter(sql=>sql==='ROLLBACK').length,1);
assert.equal(commands.some(sql=>sql==='COMMIT'||sql.startsWith('INSERT INTO')),false);
assert.equal(canonicalJson(state),initial,'late callback mutation must remain detached from persisted data');
console.log(JSON.stringify({mode,survived:true,callbacks,rollbacks:1,commits:0,writes:0,releases,thenReads,stateUnchanged:true}));
