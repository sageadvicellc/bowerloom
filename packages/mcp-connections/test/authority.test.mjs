import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDiscoveryProposal,createDiscoveryAuthorityState,validateDiscoveryAuthorityState,validateDiscoveryAuthorityTransition,DiscoveryAuthorityController,McpConnectionError,mcpBindingRevision } from '../../../dist/packages/mcp-connections/src/index.js';
const clone=value=>structuredClone(value);
const input=kind=>({...Object.fromEntries(['declaration','binding','catalog'].map(part=>[part,JSON.parse(fs.readFileSync(new URL(`./fixtures/${kind}-${part}.json`,import.meta.url),'utf8'))])),synthetic:true});
const code=expected=>error=>error instanceof McpConnectionError&&error.code===expected&&error.message===expected;
const selected={workspaceId:'synthetic-labs',runId:'discovery-run',taskId:'one-contact'};
class MemoryStore {
 constructor(state){this.state=validateDiscoveryAuthorityState(state);this.lock=Promise.resolve();this.commits=0;this.afterCommit=null;this.beforeCommit=null;this.loseAck=null;}
 async transaction(scope,mutate){let release;const before=this.lock;this.lock=new Promise(r=>release=r);await before;
  try{const previous=validateDiscoveryAuthorityState(this.state,scope),draft=clone(previous),result=mutate(draft);if(result&&typeof result.then==='function')throw Error('Async callback');validateDiscoveryAuthorityTransition(previous,draft);if(this.beforeCommit)await this.beforeCommit(previous,draft);this.state=clone(draft);this.commits++;
   if(this.afterCommit)this.afterCommit(this);if(this.loseAck?.(previous,draft))throw Error('PRIVATE_DATABASE_ACK');return clone(result);
  }finally{release();}
 }
}
function fixture(kind='stdio'){
 const plan=input(kind),effect=kind==='stdio'?{kind,executable:{path:plan.binding.transport.executable,digest:'sha256:'+'a'.repeat(64)},entrypoints:[{path:'/synthetic/labs/server.mjs',digest:'sha256:'+'b'.repeat(64)}],args:['/synthetic/labs/server.mjs'],cwd:plan.binding.transport.workingDirectory,environment:{inherit:false,secretReferences:clone(plan.binding.transport.secretReferences)}}:{kind,endpoint:plan.binding.transport.endpoint,authBindingRevision:mcpBindingRevision(plan.binding)};
 const proposal=createDiscoveryProposal({scope:selected,requestId:'one-discovery',ownerEpoch:1,input:plan,effect,timeoutMs:1000});
 const grant={scope:selected,ownerSubject:'owner',ownerEpoch:1,approverSubjects:['founder'],readyAtMs:1000,leaseExpiresAtMs:10000,revoked:false};
 const store=new MemoryStore(createDiscoveryAuthorityState(proposal,grant));let now=2000;const alarms=new Map();
 const clock={now:()=>now,alarm:(at,callback)=>{alarms.set(callback,at);return()=>alarms.delete(callback);}};
 const identity={authenticate:async credential=>{if(!['owner','founder','stranger'].includes(credential))throw Error('PRIVATE_IDENTITY_ERROR');return{subject:credential,proofRef:'synthetic:proof',expiresAtMs:9000};}};
 const observed={opens:0,closes:0,context:null};
 let open=async context=>{observed.opens++;observed.context=context;assert.equal(store.state.status,'IN_FLIGHT');assert.ok(store.commits>=2);return {
  initialize:async()=>({protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:clone(plan.binding.serverIdentity)}),initialized:async()=>{},listTools:async()=>({tools:clone(plan.catalog.tools)}),close:async()=>{observed.closes++;},
 };};
 const controller=()=>new DiscoveryAuthorityController({store,identity,clock,open:context=>open(context)});
 return {plan,proposal,grant,store,clock,identity,observed,controller,setOpen:value=>open=value,getOpen:()=>open,advance:ms=>{now=ms;for(const [cb,at]of alarms)if(at<=now)cb();},approve:async c=>c.approve(selected,{revision:proposal.revision,expiresAtMs:8000},'founder')};
}
for(const kind of ['stdio','streamable-http'])test(`${kind}: persisted exact intent precedes one adapter contact and stored completion never recontacts`,async()=>{
 const f=fixture(kind),c=f.controller();await f.approve(c);const result=await c.dispatch(selected,'owner');assert.equal(result.status,'COMPLETED');assert.equal(result.result.executionAuthorized,false);assert.equal(f.observed.opens,1);assert.equal(f.observed.closes,1);
 assert.ok(Object.isFrozen(f.observed.context));assert.ok(Object.isFrozen(f.observed.context.effect));assert.ok(Object.isFrozen(f.observed.context.scope));assert.equal(f.observed.context.operationKey,result.operationKey);
 const again=await f.controller().dispatch(selected,'owner');assert.equal(again.status,'COMPLETED');assert.equal(f.observed.opens,1);
 f.advance(20000);assert.equal((await c.dispatch(selected,'owner').catch(error=>error)).code,'MCP_AUTHORITY_IDENTITY');
});
test('no approval, wrong approver, changed proposal and cross-scope dispatch cause zero opens',async()=>{
 const f=fixture(),c=f.controller();await assert.rejects(c.dispatch(selected,'owner'),code('MCP_AUTHORITY_APPROVAL_EXPIRED'));
 await assert.rejects(c.approve(selected,{revision:f.proposal.revision,expiresAtMs:8000},'owner'),code('MCP_AUTHORITY_FORBIDDEN'));
 await assert.rejects(c.approve(selected,{revision:'sha256:'+'0'.repeat(64),expiresAtMs:8000},'founder'),code('MCP_AUTHORITY_APPROVAL'));
 await f.approve(c);await assert.rejects(c.dispatch({...selected,taskId:'other'},'owner'));
 await assert.rejects(c.dispatch(selected,'stranger'),code('MCP_AUTHORITY_FORBIDDEN'));
 f.store.state.proposal.effect.args.push('--changed');await assert.rejects(c.dispatch(selected,'owner'));assert.equal(f.observed.opens,0);
});
test('effect envelope pins arguments, executable and entrypoint bytes, environment and HTTP binding',()=>{
 const f=fixture(),base={scope:selected,requestId:'one-discovery',ownerEpoch:1,input:f.plan,effect:f.proposal.effect,timeoutMs:1000};
 for(const change of [v=>v.effect.executable.digest='sha256:'+'c'.repeat(64),v=>v.effect.entrypoints[0].digest='sha256:'+'c'.repeat(64),v=>v.effect.args.push('--safe-fixture-flag')]){const v=clone(base);change(v);assert.notEqual(createDiscoveryProposal(v).revision,f.proposal.revision);}
 for(const change of [v=>v.effect.cwd='/different',v=>v.effect.executable.path='/different',v=>v.effect.environment.inherit=true,v=>v.effect.environment.secretReferences=[],v=>v.effect.environment.env={TOKEN:'PRIVATE'}]){const v=clone(base);change(v);assert.throws(()=>createDiscoveryProposal(v),McpConnectionError);}
 const h=fixture('streamable-http'),bad=clone(h.proposal);delete bad.format;delete bad.revision;delete bad.planRevision;bad.effect.endpoint='https://other.example.test/mcp';assert.throws(()=>createDiscoveryProposal(bad),code('MCP_AUTHORITY_EFFECT_BINDING'));
});
test('expiry, revoked grant and owner epoch changes block dispatch',async()=>{
 for(const update of [f=>f.advance(8000),f=>f.advance(10000),f=>f.store.state.grant.revoked=true,f=>f.store.state.grant.ownerEpoch=2]){
  const f=fixture(),c=f.controller();await f.approve(c);update(f);await assert.rejects(c.dispatch(selected,'owner'));assert.equal(f.observed.opens,0);
 }
});
test('revocation, stop, epoch changes and approval expiry after intent commit prevent adapter opening',async()=>{
 for(const change of [f=>f.store.state.grant.revoked=true,f=>{f.store.state.stopRequested=true;f.store.state.status='NEEDS_RECONCILIATION';f.store.state.reason='STOP_REQUESTED';},f=>f.store.state.grant.ownerEpoch=2,f=>f.advance(8000)]){
  const f=fixture(),c=f.controller();await f.approve(c);let done=false;f.store.afterCommit=()=>{if(!done&&f.store.state.status==='IN_FLIGHT'){done=true;change(f);}};
  await assert.rejects(c.dispatch(selected,'owner'),code('MCP_AUTHORITY_DISPATCH_UNCERTAIN'));assert.equal(f.observed.opens,0);assert.equal(f.store.state.status,'NEEDS_RECONCILIATION');
 }
});
test('concurrent controllers dispatch the same scope at most once',async()=>{
 const f=fixture(),one=f.controller(),two=f.controller();await f.approve(one);const results=await Promise.allSettled([one.dispatch(selected,'owner'),two.dispatch(selected,'owner')]);
 assert.equal(f.observed.opens,1);assert.equal(f.store.state.status,'COMPLETED');assert.ok(results.some(r=>r.status==='fulfilled'));
});
test('lost intent acknowledgement opens nothing and restart recovery holds the operation',async()=>{
 const f=fixture(),c=f.controller();await f.approve(c);f.store.loseAck=(before,after)=>before.status==='PREPARED'&&after.status==='IN_FLIGHT';
 await assert.rejects(c.dispatch(selected,'owner'),code('MCP_AUTHORITY_STORE_UNCERTAIN'));assert.equal(f.observed.opens,0);assert.equal(f.store.state.status,'IN_FLIGHT');
 f.store.loseAck=null;const recovered=await f.controller().recover(selected,'owner');assert.equal(recovered.status,'NEEDS_RECONCILIATION');assert.equal(recovered.reason,'RECOVERY_UNCERTAIN');
 await assert.rejects(f.controller().dispatch(selected,'owner'));assert.equal(f.observed.opens,0);
});
test('lost completion acknowledgement retains durable completion with no blind retry',async()=>{
 const f=fixture(),c=f.controller();await f.approve(c);f.store.loseAck=(before,after)=>before.status==='IN_FLIGHT'&&after.status==='COMPLETED';
 await assert.rejects(c.dispatch(selected,'owner'),code('MCP_AUTHORITY_DISPATCH_UNCERTAIN'));assert.equal(f.store.state.status,'COMPLETED');assert.equal(f.observed.opens,1);
 f.store.loseAck=null;assert.equal((await f.controller().dispatch(selected,'owner')).status,'COMPLETED');assert.equal(f.observed.opens,1);
});
test('failed completion commit preserves intent and restart cannot forge a successful outcome',async()=>{
 const f=fixture(),c=f.controller();await f.approve(c);const original=f.store.transaction.bind(f.store);
 f.store.transaction=(s,mutate)=>original(s,state=>{const result=mutate(state);if(state.status==='COMPLETED')throw Error('PRIVATE_FAILURE');return result;});
 await assert.rejects(c.dispatch(selected,'owner'),code('MCP_AUTHORITY_DISPATCH_UNCERTAIN'));assert.equal(f.store.state.status,'NEEDS_RECONCILIATION');assert.equal(f.store.state.result,null);
 await assert.rejects(f.controller().dispatch(selected,'owner'));assert.equal(f.observed.opens,1);
 const forged=clone(f.store.state);forged.status='PREPARED';forged.intent=null;forged.reason=null;assert.throws(()=>validateDiscoveryAuthorityTransition(f.store.state,forged),McpConnectionError);
});
test('stop before dispatch cancels; stop during discovery aborts the local session and keeps held evidence',async()=>{
 const before=fixture(),c=before.controller();await before.approve(c);assert.equal((await c.stop(selected,'founder')).status,'CANCELLED');await assert.rejects(c.dispatch(selected,'owner'));assert.equal(before.observed.opens,0);
 const f=fixture(),active=f.controller();await f.approve(active);const original=f.getOpen();let started;const ready=new Promise(resolve=>started=resolve);
 f.setOpen(async context=>{const adapter=await original(context);adapter.listTools=async()=>{started();return new Promise(()=>{});};return adapter;});
 const pending=active.dispatch(selected,'owner');await ready;await active.stop(selected,'founder');await assert.rejects(pending,code('MCP_AUTHORITY_DISPATCH_UNCERTAIN'));
 assert.equal(f.observed.context.signal.aborted,true);assert.equal(f.observed.closes,1);assert.equal(f.store.state.status,'NEEDS_RECONCILIATION');assert.equal(f.store.state.reason,'STOP_REQUESTED');
});
test('deadline uses the trusted clock and does not depend on a cooperative adapter',async()=>{
 const f=fixture(),c=f.controller();await f.approve(c);const original=f.getOpen();let started;const ready=new Promise(resolve=>started=resolve);
 f.setOpen(async context=>{const adapter=await original(context);adapter.listTools=()=>{started();return new Promise(()=>{});};return adapter;});
 const pending=c.dispatch(selected,'owner');await ready;f.advance(3000);await assert.rejects(pending,code('MCP_AUTHORITY_DISPATCH_UNCERTAIN'));assert.equal(f.observed.closes,1);assert.equal(f.store.state.status,'NEEDS_RECONCILIATION');
});
test('adapter, identity and forged typed store errors stay fixed and private',async()=>{
 const f=fixture(),c=f.controller();await f.approve(c);f.setOpen(async()=>{throw new McpConnectionError('MCP_AUTHORITY_PRIVATE_PAYLOAD');});
 await assert.rejects(c.dispatch(selected,'owner'),code('MCP_AUTHORITY_DISPATCH_UNCERTAIN'));assert.equal(f.store.state.status,'NEEDS_RECONCILIATION');
 await assert.rejects(c.inspect(selected,'private-credential'),code('MCP_AUTHORITY_IDENTITY'));
 const other=fixture(),bad=new DiscoveryAuthorityController({store:{transaction:async()=>{throw new McpConnectionError('MCP_AUTHORITY_PRIVATE_PAYLOAD');}},identity:other.identity,clock:other.clock,open:other.getOpen()});
 await assert.rejects(bad.inspect(selected,'owner'),code('MCP_AUTHORITY_STORE_UNCERTAIN'));
});
test('state and transition guards refuse altered immutable records, terminal rollback and inert getters',async()=>{
 const f=fixture(),before=clone(f.store.state),changed=clone(before);changed.operationKey='sha256:'+'0'.repeat(64);assert.throws(()=>validateDiscoveryAuthorityState(changed),McpConnectionError);
 const moved=clone(before);moved.scope.taskId='other';assert.throws(()=>validateDiscoveryAuthorityState(moved),McpConnectionError);
 const granted=clone(before);granted.grant.approverSubjects.push('attacker');assert.throws(()=>validateDiscoveryAuthorityTransition(before,granted),code('MCP_AUTHORITY_TRANSITION'));
 const c=f.controller();await f.approve(c);await c.dispatch(selected,'owner');assert.throws(()=>validateDiscoveryAuthorityTransition(f.store.state,before),code('MCP_AUTHORITY_TRANSITION'));
 let reads=0;const getter=clone(before);Object.defineProperty(getter.proposal.input,'binding',{enumerable:true,get(){reads++;return {};}});assert.throws(()=>validateDiscoveryAuthorityState(getter));assert.equal(reads,0);
});

test('lost stop acknowledgement still aborts a known local operation after authenticated scope validation',async()=>{
 const f=fixture(),c=f.controller();await f.approve(c);const original=f.getOpen();let started;const ready=new Promise(resolve=>started=resolve);
 f.setOpen(async context=>{const adapter=await original(context);adapter.listTools=()=>{started();return new Promise(()=>{});};return adapter;});
 const pending=c.dispatch(selected,'owner');await ready;
 await assert.rejects(c.stop(selected,'stranger'),code('MCP_AUTHORITY_FORBIDDEN'));assert.equal(f.observed.context.signal.aborted,false);
 f.store.loseAck=(before,after)=>before.status==='IN_FLIGHT'&&after.stopRequested;
 await assert.rejects(c.stop(selected,'founder'),code('MCP_AUTHORITY_STORE_UNCERTAIN'));
 await assert.rejects(pending,code('MCP_AUTHORITY_DISPATCH_UNCERTAIN'));assert.equal(f.observed.context.signal.aborted,true);assert.equal(f.observed.closes,1);assert.equal(f.store.state.reason,'STOP_REQUESTED');
});


test('immediately rejected adapter is observed while its invocation commit acknowledgement is pending',async()=>{
 const f=fixture(),c=f.controller();await f.approve(c);let attempts=0,eventLoopCrossed=false;
 f.setOpen(()=>{attempts++;return Promise.reject(new McpConnectionError('PRIVATE_ADAPTER_FAILURE'));});
 f.store.beforeCommit=async(before,after)=>{
  if(before.status==='IN_FLIGHT'&&after.status==='IN_FLIGHT'){
   await new Promise(resolve=>setImmediate(resolve));
   await new Promise(resolve=>setImmediate(resolve));
   eventLoopCrossed=true;
  }
 };
 await assert.rejects(c.dispatch(selected,'owner'),code('MCP_AUTHORITY_DISPATCH_UNCERTAIN'));
 assert.equal(eventLoopCrossed,true);assert.equal(attempts,1);assert.equal(f.store.state.status,'NEEDS_RECONCILIATION');assert.equal(f.store.state.result,null);
 await assert.rejects(f.controller().dispatch(selected,'owner'));assert.equal(attempts,1);
});
