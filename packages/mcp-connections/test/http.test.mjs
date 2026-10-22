import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import dns from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { createMcpHttpDiscoveryFactory, mcpBindingRevision, McpConnectionError } from '../../../dist/packages/mcp-connections/src/index.js';
import { isMcpPublicAddress } from '../../../dist/packages/mcp-connections/src/http.js';
const init={protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'bowerloom-discovery',version:'0.7.0-beta.2'}};
const clone=structuredClone;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const refused=error=>error instanceof McpConnectionError&&/^MCP_HTTP_[A-Z_]+$/.test(error.code)&&error.message===error.code&&!error.message.includes('PRIVATE');
function fixture(t,{endpoint='https://mcp.example.test/mcp',answers=[{address:'8.8.8.8',family:4}],respond}={}){
 const binding=JSON.parse(fs.readFileSync(new URL('./fixtures/streamable-http-binding.json',import.meta.url),'utf8'));binding.transport.endpoint=endpoint;
 const abort=new AbortController(),notifications=[],requests=[],lookups=[];
 const context={binding,effect:{kind:'streamable-http',endpoint,authBindingRevision:mcpBindingRevision(binding)},scope:{workspaceId:'test',runId:'test',taskId:'test'},operationKey:'sha256:'+'a'.repeat(64),signal:abort.signal,onNotification:value=>notifications.push(value)};
 const credential=request=>({...clone(request),token:'PRIVATE_OPAQUE_TOKEN',expiresAtMs:20000,revoked:false});
 const resolved=[];const options={nowMs:()=>1000,requestTimeoutMs:100,sessionTimeoutMs:2000,resolveCredential:async request=>{resolved.push(request);assert.ok(Object.isFrozen(request));assert.ok(Object.isFrozen(request.scopes));return credential(request);}};
 t.mock.method(dns,'lookup',async(host,opts)=>{lookups.push({host,opts});return answers;});
 t.mock.method(https,'request',(url,opts,callback)=>{
  const request=new EventEmitter();request.destroyed=false;request.destroy=()=>{if(!request.destroyed){request.destroyed=true;queueMicrotask(()=>request.emit('error',Error('PRIVATE_NETWORK')));}return request;};
  request.end=payload=>{
   const message=JSON.parse(payload);requests.push({url,opts,message,request});
   queueMicrotask(()=>{
    if(request.destroyed)return;
    const result=message.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:binding.serverIdentity}:{tools:[]};
    const selected=respond?.(message,requests.length)??{};
    if(selected.stall)return;
    const response=new EventEmitter();response.destroy=()=>{response.destroyed=true;};response.complete=selected.complete??true;
    response.statusCode=selected.status??(message.method==='notifications/initialized'?202:200);
    response.rawHeaders=selected.headers??(message.method==='notifications/initialized'?[]:['Content-Type','application/json','Mcp-Session-Id','session-one']);
    const body=selected.body??(message.method==='notifications/initialized'?'':JSON.stringify({jsonrpc:'2.0',id:message.id,result}));
    callback(response);
    if(!response.destroyed){for(const chunk of selected.chunks??[Buffer.from(body)])response.emit('data',chunk);if(!selected.neverEnd)response.emit('end');}
   });return request;
  };return request;
 });
 return {context,options,credential,abort,requests,lookups,notifications,resolved};
}

test('public address admission is conservative and rejects alternate, mapped and special-use addresses',()=>{
 for(const address of ['0.1.2.3','10.0.0.1','127.0.0.1','100.64.1.1','100.127.255.255','169.254.169.254','172.31.1.1','192.0.0.9','192.0.2.1','192.88.99.1','192.168.1.1','198.18.1.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','127.1','0177.0.0.1','0x7f000001','2130706433','::1','::ffff:127.0.0.1','::FFFF:7F00:1','2001:4860:4860::8888'])assert.equal(isMcpPublicAddress(address),false,address);
 for(const address of ['8.8.8.8','1.1.1.1','100.63.255.255','172.32.0.1'])assert.equal(isMcpPublicAddress(address),true,address);
});
test('JSON discovery pins DNS, verified TLS and approved endpoint with fresh opaque credentials per POST',async t=>{
 const f=fixture(t),transport=await createMcpHttpDiscoveryFactory(f.options)(f.context);
 await transport.initialize(init);await transport.initialized();await transport.listTools({});await transport.close();
 assert.deepEqual(f.requests.map(r=>r.message.method),['initialize','notifications/initialized','tools/list']);assert.equal(f.lookups.length,1);assert.equal(f.resolved.length,3);
 for(const {url,opts}of f.requests){assert.equal(url.href,f.context.effect.endpoint);assert.equal(opts.method,'POST');assert.equal(opts.rejectUnauthorized,true);assert.equal(opts.agent.options.keepAlive,false);assert.deepEqual(opts.agent.options.proxyEnv,{});assert.equal(opts.ca,undefined);assert.equal(opts.headers.Authorization,'Bearer PRIVATE_OPAQUE_TOKEN');assert.equal(opts.headers.Accept,'application/json, text/event-stream');assert.equal(opts.headers['Accept-Encoding'],'identity');await new Promise((resolve,reject)=>opts.lookup('changed.example.test',{all:true},(error,addresses)=>{if(error)reject(error);else{assert.deepEqual(addresses,[{address:'8.8.8.8',family:4}]);resolve();}}));}
 assert.equal(f.requests[0].opts.headers['MCP-Protocol-Version'],undefined);assert.equal(f.requests[1].opts.headers['MCP-Protocol-Version'],'2025-11-25');assert.equal(f.requests[1].opts.headers['MCP-Session-Id'],'session-one');assert.deepEqual(Object.keys(transport).sort(),['close','initialize','initialized','listTools']);
 await assert.rejects(transport.listTools({}),refused);assert.equal(f.requests.length,3);
});
test('finite SSE accepts comments and an empty priming event, without a resume or background request',async t=>{
 const f=fixture(t,{respond:message=>message.method==='initialize'?{headers:['Content-Type','text/event-stream; charset=utf-8'],body:': heartbeat\n\nid: one\ndata:\n\nevent: message\ndata: '+JSON.stringify({jsonrpc:'2.0',id:message.id,result:{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'labs-fixture',version:'1.0.0'}}})+'\n\n'}:undefined});
 const adapter=await createMcpHttpDiscoveryFactory(f.options)(f.context);await adapter.initialize(init);await adapter.initialized();await adapter.close();assert.equal(f.requests.length,2);
});
test('mixed DNS answers, private literals, IPv6, noncanonical URLs and endpoint drift fail before contact',async t=>{
 for(const endpoint of ['https://127.0.0.1/mcp','https://[::1]/mcp','https://mcp.example.test/mcp']){
  const f=fixture(t,{endpoint,answers:[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]});await assert.rejects(createMcpHttpDiscoveryFactory(f.options)(f.context),refused);assert.equal(f.requests.length,0);t.mock.restoreAll();
 }
 for(const endpoint of ['https://[::FFFF:7F00:1]/mcp','https://127.1/mcp','https://0x7f000001/mcp'])assert.throws(()=>fixture(t,{endpoint}),McpConnectionError);
 const f=fixture(t);f.context.effect.authBindingRevision='sha256:'+'0'.repeat(64);await assert.rejects(createMcpHttpDiscoveryFactory(f.options)(f.context),refused);assert.equal(f.lookups.length,0);
});
test('explicit loopback trust is restricted to the exact literal endpoint and keeps TLS verification enabled',async t=>{
 const f=fixture(t,{endpoint:'https://127.0.0.1:12345/mcp'});f.options.loopbackTls={endpoint:f.context.effect.endpoint,ca:'-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----'};
 const adapter=await createMcpHttpDiscoveryFactory(f.options)(f.context);await adapter.initialize(init);await adapter.close();assert.equal(f.lookups.length,0);assert.equal(f.requests[0].opts.rejectUnauthorized,true);assert.equal(f.requests[0].opts.ca,f.options.loopbackTls.ca);
 const bad={...f.options,loopbackTls:{...f.options.loopbackTls,endpoint:'https://127.0.0.1:12346/mcp'}};await assert.rejects(createMcpHttpDiscoveryFactory(bad)(f.context),refused);
});
test('credential metadata rejects wrong bindings, grants, expiry, revoked and unsafe token text before contact',async t=>{
 for(const mutate of [c=>c.bindingRevision='wrong',c=>c.credentialRef='other',c=>c.issuer='other',c=>c.audience='other',c=>c.scopes.push('admin'),c=>c.expiresAtMs=1000,c=>c.revoked=true,c=>c.token='token\r\nX-Evil: yes',c=>c.token='',c=>c.extra='PRIVATE']){
  const f=fixture(t);f.options.resolveCredential=async r=>{const c=f.credential(r);mutate(c);return c;};const adapter=await createMcpHttpDiscoveryFactory(f.options)(f.context);await assert.rejects(adapter.initialize(init),refused);assert.equal(f.requests.length,0);t.mock.restoreAll();
 }
});
test('credential getters and options accessors stay inert and typed resolver failures remain private',async t=>{
 const f=fixture(t);let reads=0;const bad={...f.options};Object.defineProperty(bad,'requestTimeoutMs',{get(){reads++;return 1;}});assert.throws(()=>createMcpHttpDiscoveryFactory(bad),refused);assert.equal(reads,0);
 f.options.resolveCredential=async r=>{const c=f.credential(r);Object.defineProperty(c,'token',{get(){reads++;return 'PRIVATE';},enumerable:true});return c;};const adapter=await createMcpHttpDiscoveryFactory(f.options)(f.context);await assert.rejects(adapter.initialize(init),refused);assert.equal(reads,0);assert.equal(f.requests.length,0);
});
test('credentials are rechecked after initialization and revocation prevents the next POST',async t=>{
 const f=fixture(t);let calls=0;f.options.resolveCredential=async r=>({...f.credential(r),revoked:++calls>1});const adapter=await createMcpHttpDiscoveryFactory(f.options)(f.context);await adapter.initialize(init);await assert.rejects(adapter.initialized(),refused);assert.equal(f.requests.length,1);
});
test('malformed bodies, status errors, redirects, compression, session drift and ambiguous headers never retry',async t=>{
 const cases=[{status:302,headers:['Location','https://elsewhere.example.test/mcp']},{status:401},{status:404},{status:500},{body:'{"jsonrpc":"2.0","id":1,"id":1,"result":{}}'},{body:'{"jsonrpc":"2.0","id":999,"result":{}}'},{body:'{"jsonrpc":"2.0","id":1,"result":{},"extra":true}'},{body:'{"jsonrpc":"2.0","id":1,"error":{"message":"PRIVATE"}}'},{body:'[]'},{chunks:[Buffer.from([0xff])]},{body:'x'.repeat(262145)},{headers:['Content-Type','application/json','Content-Encoding','gzip']},{headers:['Content-Type','application/json','Content-Type','application/json']},{headers:['Content-Type','application/json','Mcp-Session-Id','bad session']},{headers:['Content-Type','application/json','Mcp-Protocol-Version','2024-11-05']},{complete:false}];
 for(const response of cases){const f=fixture(t,{respond:()=>response});const adapter=await createMcpHttpDiscoveryFactory(f.options)(f.context);await assert.rejects(adapter.initialize(init),refused);await assert.rejects(adapter.initialize(init),refused);assert.equal(f.requests.length,1);t.mock.restoreAll();}
 const f=fixture(t,{respond:(m,n)=>n===3?{headers:['Content-Type','application/json','Mcp-Session-Id','changed']}:undefined});const adapter=await createMcpHttpDiscoveryFactory(f.options)(f.context);await adapter.initialize(init);await adapter.initialized();await assert.rejects(adapter.listTools({}),refused);assert.equal(f.requests.length,3);
});
test('server requests and notifications are refused through notification callback without execution',async t=>{
 for(const message of [{jsonrpc:'2.0',method:'notifications/tools/list_changed'},{jsonrpc:'2.0',id:999,method:'sampling/createMessage',params:{PRIVATE:'never forward'}}]){
  const f=fixture(t,{respond:()=>({body:JSON.stringify(message)})});const adapter=await createMcpHttpDiscoveryFactory(f.options)(f.context);await assert.rejects(adapter.initialize(init),refused);assert.equal(f.notifications.length,1);assert.equal(JSON.stringify(f.notifications).includes('PRIVATE'),false);assert.equal(f.requests.length,1);t.mock.restoreAll();
 }
});
test('SSE missing, multiple, malformed, retry and unclosed responses fail without replay',async t=>{
 const response='data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n';
 for(const body of ['',response+response,response.trimEnd(),'retry: 1\n\n'+response,'data: []\n\n','event: unknown\ndata: {}\n\n']){
  const f=fixture(t,{respond:()=>({headers:['Content-Type','text/event-stream'],body})});const adapter=await createMcpHttpDiscoveryFactory(f.options)(f.context);await assert.rejects(adapter.initialize(init),refused);assert.equal(f.requests.length,1);t.mock.restoreAll();
 }
});
test('notification acceptance must be empty 202 and operation order and request cap are strict',async t=>{
 const f=fixture(t,{respond:message=>message.method==='notifications/initialized'?{body:'PRIVATE'}:undefined});const adapter=await createMcpHttpDiscoveryFactory(f.options)(f.context);await adapter.initialize(init);await assert.rejects(adapter.initialized(),refused);assert.equal(f.requests.length,2);t.mock.restoreAll();
 const wrong=fixture(t),other=await createMcpHttpDiscoveryFactory(wrong.options)(wrong.context);await assert.rejects(other.listTools({}),refused);assert.equal(wrong.requests.length,0);t.mock.restoreAll();
 const cap=fixture(t),bounded=await createMcpHttpDiscoveryFactory(cap.options)(cap.context);await bounded.initialize(init);await bounded.initialized();for(let i=0;i<8;i++)await bounded.listTools({});await assert.rejects(bounded.listTools({}),refused);assert.equal(cap.requests.length,10);
});
test('deadline and abort destroy pending requests and late credentials cannot contact',async t=>{
 const f=fixture(t,{respond:()=>({stall:true})});f.options.requestTimeoutMs=10;const adapter=await createMcpHttpDiscoveryFactory(f.options)(f.context);await assert.rejects(adapter.initialize(init),refused);assert.equal(f.requests[0].request.destroyed,true);t.mock.restoreAll();
 const late=fixture(t);let release;late.options.resolveCredential=r=>new Promise(resolve=>{release=()=>resolve(late.credential(r));});const waiting=await createMcpHttpDiscoveryFactory(late.options)(late.context);const pending=waiting.initialize(init);await tick();late.abort.abort();await assert.rejects(pending,refused);release();await tick();assert.equal(late.requests.length,0);t.mock.restoreAll();
 const dnsLate=fixture(t);let resolved;t.mock.method(dns,'lookup',()=>new Promise(resolve=>{resolved=()=>resolve([{address:'8.8.8.8',family:4}]);}));const opening=createMcpHttpDiscoveryFactory(dnsLate.options)(dnsLate.context);await tick();dnsLate.abort.abort();await assert.rejects(opening,refused);resolved();await tick();assert.equal(dnsLate.requests.length,0);
});
test('concurrent operations stop the session and cannot send an extra request',async t=>{
 const f=fixture(t,{respond:()=>({stall:true})});const adapter=await createMcpHttpDiscoveryFactory(f.options)(f.context);const pending=adapter.initialize(init);await tick();await assert.rejects(adapter.initialize(init),refused);await assert.rejects(pending,refused);assert.equal(f.requests.length,1);assert.equal(f.requests[0].request.destroyed,true);
});


test('closing between bounded scheduling and its microtask prevents DNS and credential work',async t=>{
 const f=fixture(t);const opening=createMcpHttpDiscoveryFactory(f.options)(f.context);f.abort.abort();await assert.rejects(opening,refused);assert.equal(f.lookups.length,0);assert.equal(f.resolved.length,0);assert.equal(f.requests.length,0);t.mock.restoreAll();
 const next=fixture(t),adapter=await createMcpHttpDiscoveryFactory(next.options)(next.context);const pending=adapter.initialize(init);await adapter.close();await assert.rejects(pending,refused);assert.equal(next.resolved.length,0);assert.equal(next.requests.length,0);
});
