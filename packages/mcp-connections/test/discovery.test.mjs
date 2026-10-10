import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { discoverMcpCatalog, planMcpConnection, McpConnectionError } from '../../../dist/packages/mcp-connections/src/index.js';
const fixture=()=>({...Object.fromEntries(['declaration','binding','catalog'].map(part=>[part,JSON.parse(fs.readFileSync(new URL(`./fixtures/stdio-${part}.json`,import.meta.url),'utf8'))])),synthetic:true});
const copy=value=>JSON.parse(JSON.stringify(value));
const code=expected=>error=>error instanceof McpConnectionError&&error.code===expected&&error.message===expected;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function harness(input,custom={}){
 const observed={opens:0,closed:0,methods:[],context:null};
 const adapter={
  async initialize(params){observed.methods.push(['initialize',params]);return {protocolVersion:'2025-11-25',capabilities:{tools:{listChanged:true}},serverInfo:copy(input.binding.serverIdentity)};},
  async initialized(){observed.methods.push(['notifications/initialized']);},
  async listTools(params){observed.methods.push(['tools/list',params]);return {tools:copy(input.catalog.tools)};},
  async close(){observed.closed++;},
  ...custom,
 };
 return {observed,adapter,options:{approve:planMcpConnection(input).revision,timeoutMs:1000,open:async context=>{observed.opens++;observed.context=context;return adapter;}}};
}
test('exact approved discovery initializes, acknowledges, lists, matches and closes without tool calls',async()=>{
 const input=fixture(),h=harness(input),before=copy(input),result=await discoverMcpCatalog(input,h.options);
 assert.equal(h.observed.opens,1);assert.equal(h.observed.closed,1);assert.deepEqual(h.observed.methods.map(x=>x[0]),['initialize','notifications/initialized','tools/list']);
 assert.deepEqual(h.observed.methods[0][1],{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'bowerloom-discovery',version:'0.7.0-beta.2'}});
 assert.equal(result.catalogRevision,planMcpConnection(input).catalogRevision);assert.equal(result.catalogMatched,true);assert.equal(result.cleanup,'closed');
 assert.equal(result.observedToolCount,2);assert.equal(result.pageCount,1);assert.equal(result.toolCalls,0);assert.equal(result.executionAuthorized,false);
 assert.equal(result.authenticationVerified,false);assert.equal(result.runtimePortabilityVerified,false);assert.deepEqual(result.grants,[]);
 assert.ok(Object.isFrozen(result));assert.deepEqual(input,before);
 assert.equal('callTool' in h.adapter,false);assert.equal('request' in h.adapter,false);
 assert.ok(!JSON.stringify(result).includes('An annotation must never authorize'));
});
test('approval mismatch, invalid inputs, accessors and already-aborted signals cause zero opens',async()=>{
 const input=fixture(),h=harness(input);
 await assert.rejects(discoverMcpCatalog(input,{...h.options,approve:'yes'}),code('MCP_DISCOVERY_APPROVAL'));
 const changed=copy(input);changed.declaration.tools[0].permissionClass='destructive';await assert.rejects(discoverMcpCatalog(changed,h.options),code('MCP_DISCOVERY_APPROVAL'));
 let gets=0;const accessor=copy(input);Object.defineProperty(accessor.binding,'transport',{enumerable:true,get(){gets++;return {};}});
 await assert.rejects(discoverMcpCatalog(accessor,h.options),code('MCP_INPUT_FIELDS'));
 const opts={...h.options};Object.defineProperty(opts,'approve',{get(){gets++;return h.options.approve;}});await assert.rejects(discoverMcpCatalog(input,opts),code('MCP_DISCOVERY_OPTIONS'));
 const controller=new AbortController();controller.abort();await assert.rejects(discoverMcpCatalog(input,{...h.options,signal:controller.signal}),code('MCP_DISCOVERY_ABORTED'));
 assert.equal(gets,0);assert.equal(h.observed.opens,0);
});
test('factory binding and request objects are deeply frozen and detached from caller input',async()=>{
 const input=fixture(),h=harness(input),open=h.options.open;
 h.options.open=async context=>{
  assert.ok(Object.isFrozen(context));assert.ok(Object.isFrozen(context.binding));assert.ok(Object.isFrozen(context.binding.transport.secretReferences));
  assert.throws(()=>context.binding.transport.executable='/bad',TypeError);
  input.binding.transport.executable='/caller-changed';input.catalog.tools[0].description='caller mutation';
  return open(context);
 };
 const captured=fixture();h.adapter.listTools=async params=>{assert.ok(Object.isFrozen(params));return {tools:copy(captured.catalog.tools)};};
 h.adapter.initialize=async params=>{assert.ok(Object.isFrozen(params));assert.ok(Object.isFrozen(params.capabilities));assert.ok(Object.isFrozen(params.clientInfo));return {protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:copy(captured.binding.serverIdentity)};};
 const result=await discoverMcpCatalog(input,h.options);assert.equal(result.catalogMatched,true);assert.equal(h.observed.context.binding.transport.executable,captured.binding.transport.executable);
});
test('paginated tools preserve the complete catalog and acknowledge initialization before listing',async()=>{
 const input=fixture(),h=harness(input);let page=0,initialized=false;
 h.adapter.initialized=async()=>{initialized=true;};h.adapter.listTools=async params=>{assert.equal(initialized,true);page++;if(page===1){assert.deepEqual(params,{});return {tools:[copy(input.catalog.tools[0])],nextCursor:'page-two'};}assert.equal(params.cursor,'page-two');return {tools:[copy(input.catalog.tools[1])]};};
 const result=await discoverMcpCatalog(input,h.options);assert.equal(result.pageCount,2);assert.equal(result.catalogMatched,true);assert.equal(h.observed.closed,1);
});
for(const change of ['schema','description','unselected','annotation'])test(`${change} drift fails closed after discovery`,async()=>{
 const input=fixture(),h=harness(input);const tools=copy(input.catalog.tools);
 if(change==='schema')tools[0].inputSchema.properties.experimentId.maxLength=50;
 if(change==='description')tools[0].description='DO_NOT_ECHO changed instruction';
 if(change==='annotation')tools[0].annotations.readOnlyHint=false;
 if(change==='unselected')tools.push({name:'extra',inputSchema:{type:'object'}});
 h.adapter.listTools=async()=>({tools});await assert.rejects(discoverMcpCatalog(input,h.options),code('MCP_DISCOVERY_CATALOG_DRIFT'));assert.equal(h.observed.closed,1);
});
for(const method of ['notifications/tools/list_changed','notifications/message','server/unexpected'])test(`${method}: notification invalidates the session`,async()=>{
 const input=fixture(),h=harness(input);h.adapter.listTools=async()=>{h.observed.context.onNotification({jsonrpc:'2.0',method,params:{instruction:'DO_NOT_ECHO'}});return {tools:copy(input.catalog.tools)};};
 await assert.rejects(discoverMcpCatalog(input,h.options),code(method==='notifications/tools/list_changed'?'MCP_DISCOVERY_CATALOG_CHANGED':'MCP_DISCOVERY_NOTIFICATION'));
 assert.equal(h.observed.closed,1);assert.equal(h.observed.context.signal.aborted,true);
});
test('identity, protocol, missing tools and malformed capability prevent initialized and list calls',async()=>{
 for(const [change,expected]of [[v=>v.serverInfo.version='2.0.0','MCP_DISCOVERY_IDENTITY'],[v=>v.serverInfo.name='other','MCP_DISCOVERY_IDENTITY'],[v=>v.protocolVersion='future','MCP_DISCOVERY_PROTOCOL'],[v=>v.capabilities={resources:{}},'MCP_DISCOVERY_RESPONSE'],[v=>v.capabilities.tools.listChanged='true','MCP_DISCOVERY_CAPABILITY']]){
  const input=fixture(),h=harness(input);h.adapter.initialize=async()=>{const result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:copy(input.binding.serverIdentity)};change(result);return result;};
  await assert.rejects(discoverMcpCatalog(input,h.options),code(expected));assert.equal(h.observed.methods.length,0);assert.equal(h.observed.closed,1);
 }
});
test('cursor cycles, page bounds, duplicate tools, tool bounds and response bounds stop discovery',async()=>{
 for(const [kind,expected]of [['cycle','MCP_DISCOVERY_CURSOR_CYCLE'],['pages','MCP_DISCOVERY_PAGE_BOUND'],['duplicate','MCP_DISCOVERY_DUPLICATE_TOOL'],['tools','MCP_DISCOVERY_TOOL_BOUND'],['bytes','MCP_DISCOVERY_RESPONSE_BOUND']]){
  const input=fixture(),h=harness(input);let count=0;
  h.adapter.listTools=async()=>{count++;if(kind==='cycle')return {tools:[],nextCursor:'repeat'};if(kind==='pages')return {tools:[],nextCursor:String(count)};
   if(kind==='duplicate')return {tools:[input.catalog.tools[0],input.catalog.tools[0]]};if(kind==='tools')return {tools:Array.from({length:257},(_,i)=>({name:`tool${i}`,inputSchema:{type:'object'}}))};return {tools:[],_meta:{text:'x'.repeat(270000)}};};
  await assert.rejects(discoverMcpCatalog(input,h.options),code(expected));assert.equal(h.observed.closed,1);assert.ok(count<=8);
 }
});
test('response getters and raw adapter error payloads never escape',async()=>{
 let reads=0;
 for(const kind of ['getter','error','forged-error']){const input=fixture(),h=harness(input);h.adapter.listTools=async()=>{
  if(kind==='error')throw new Error('DO_NOT_ECHO');if(kind==='forged-error')throw new McpConnectionError('DO_NOT_ECHO');
  return {get tools(){reads++;return [];}};
 };await assert.rejects(discoverMcpCatalog(input,h.options),code(kind==='getter'?'MCP_DISCOVERY_RESPONSE':'MCP_DISCOVERY_ADAPTER'));assert.equal(h.observed.closed,1);}
 assert.equal(reads,0);
});
test('request timeout aborts and closes once even if the request ignores cancellation',async()=>{
 const input=fixture(),h=harness(input);h.adapter.listTools=()=>new Promise(()=>{});
 await assert.rejects(discoverMcpCatalog(input,{...h.options,timeoutMs:20}),code('MCP_DISCOVERY_TIMEOUT'));
 assert.equal(h.observed.context.signal.aborted,true);assert.equal(h.observed.closed,1);
});
test('caller abort closes once and does not treat partial discovery as success',async()=>{
 const input=fixture(),h=harness(input),controller=new AbortController();h.adapter.listTools=()=>{controller.abort();return new Promise(()=>{});};
 await assert.rejects(discoverMcpCatalog(input,{...h.options,signal:controller.signal}),code('MCP_DISCOVERY_ABORTED'));assert.equal(h.observed.closed,1);
});
test('unresolved factory times out, and a later returned adapter receives one close attempt',async()=>{
 const input=fixture(),h=harness(input);let resolveOpen,signal;
 const promise=discoverMcpCatalog(input,{...h.options,timeoutMs:20,open:context=>{signal=context.signal;return new Promise(resolve=>resolveOpen=resolve);}});
 await assert.rejects(promise,code('MCP_DISCOVERY_TIMEOUT'));assert.equal(signal.aborted,true);assert.equal(h.observed.closed,0);
 resolveOpen(h.adapter);await wait(0);assert.equal(h.observed.closed,1);await wait(0);assert.equal(h.observed.closed,1);
});
test('close rejection and close timeout prevent success after an exact match',async()=>{
 const input=fixture(),h=harness(input);h.adapter.close=async()=>{h.observed.closed++;throw Error('DO_NOT_ECHO cleanup');};
 await assert.rejects(discoverMcpCatalog(input,h.options),code('MCP_DISCOVERY_CLEANUP_FAILED'));assert.equal(h.observed.closed,1);
 const never=harness(input);never.adapter.close=()=>{never.observed.closed++;return new Promise(()=>{});};
 await assert.rejects(discoverMcpCatalog(input,never.options),code('MCP_DISCOVERY_CLEANUP_TIMEOUT'));assert.equal(never.observed.closed,1);
});
test('notification during cleanup still invalidates an otherwise matched catalog',async()=>{
 const input=fixture(),h=harness(input);h.adapter.close=async()=>{h.observed.closed++;h.observed.context.onNotification({method:'notifications/tools/list_changed'});};
 await assert.rejects(discoverMcpCatalog(input,h.options),code('MCP_DISCOVERY_CATALOG_CHANGED'));assert.equal(h.observed.closed,1);
});

for(const stage of ['open','initialize','listTools'])test(`${stage}: adapter errors with the engine error class stay fixed and private`,async()=>{
 const input=fixture(),h=harness(input),throwPrivate=async()=>{throw new McpConnectionError('SECRET_ADAPTER_PAYLOAD');};
 if(stage==='open')h.options.open=throwPrivate;else h.adapter[stage]=throwPrivate;
 await assert.rejects(discoverMcpCatalog(input,h.options),code('MCP_DISCOVERY_ADAPTER'));
 assert.equal(h.observed.closed,stage==='open'?0:1);
});

test('cleanup observation is bounded separately and does not add protocol work',async()=>{
 const input=fixture(),h=harness(input);let closed=false;
 h.adapter.close=async()=>{await wait(30);closed=true;};
 const result=await discoverMcpCatalog(input,{...h.options,cleanupTimeoutMs:100});assert.equal(result.cleanup,'closed');assert.equal(closed,true);
 assert.deepEqual(h.observed.methods.map(x=>x[0]),['initialize','notifications/initialized','tools/list']);
 const slow=harness(input,{close:async()=>new Promise(()=>{})});
 await assert.rejects(discoverMcpCatalog(input,{...slow.options,cleanupTimeoutMs:5}),code('MCP_DISCOVERY_CLEANUP_TIMEOUT'));
 for(const value of [0,15001,'100',NaN]){const refused=harness(input);await assert.rejects(discoverMcpCatalog(input,{...refused.options,cleanupTimeoutMs:value}),code('MCP_DISCOVERY_OPTIONS'));assert.equal(refused.observed.opens,0);}
});
