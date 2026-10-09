import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inert,route,ROUTES,candidateArgv,CANDIDATE_ENV,SETTINGS_BYTES,MCP_BYTES,digest } from '../../../dist/packages/claude-adapter/src/policy.js';
test('closed exact routes and immutable candidate controls grant no arbitrary passthrough',()=>{
  for(const r of ROUTES){assert.equal(route(r),r);const a=candidateArgv(r);assert.ok(Object.isFrozen(a));assert.equal(a[a.indexOf('--model')+1],'claude-sonnet-5-5');assert.equal(a[a.indexOf('--effort')+1],r.split(':').at(-1));assert.ok(a.includes(SETTINGS_BYTES));assert.ok(a.includes(MCP_BYTES));assert.ok(!a.includes('--bare'));}
  for(const r of ['sonnet','claude:sonnet:high','claude:claude-sonnet-5-5:low','claude:claude-sonnet-5-5:HIGH','codex:gpt-6-sol:low',{},null])assert.throws(()=>route(r),{code:'ROUTE',message:'CLAUDE_ROUTE'});
  assert.deepEqual(CANDIDATE_ENV,{DISABLE_UPDATES:'1',LANG:'C'});
});
test('inert capture refuses proxy/getter without traps, snapshots and recursively freezes',()=>{
  let traps=0;const p=new Proxy({x:1},{ownKeys(){traps++;throw Error('SECRET');},get(){traps++;throw Error('SECRET');},getPrototypeOf(){traps++;throw Error('SECRET');}});
  const getter={};Object.defineProperty(getter,'x',{enumerable:true,get(){traps++;return 1;}});
  for(const input of [p,{nested:p},getter])assert.throws(()=>inert(input),{code:'INPUT',message:'CLAUDE_INPUT'});
  assert.equal(traps,0);const original={a:[{b:'original'}]};const frozen=inert(original);original.a[0].b='changed';assert.equal(frozen.a[0].b,'original');assert.throws(()=>{frozen.a.push(1);});assert.throws(()=>{frozen.a[0].b='other';});
});
test('bounds, descriptors, invalid unicode and JSON strings cannot masquerade as contract objects',()=>{
  const cyc={};cyc.self=cyc;const sparse=[];sparse.length=1;
  for(const input of [cyc,sparse,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,()=>{},new Date(),Object.create({a:1}),new String('x'),'x'.repeat(32769),'é'.repeat(16385),'\ud800',{[Symbol('x')]:1},Object.defineProperty({},'x',{value:1})])assert.throws(()=>inert(input),{code:'INPUT'});
  assert.equal(digest({a:1,b:2}),digest({b:2,a:1}));assert.notEqual(digest('é'),digest('é'));
});
