import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,realpathSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import https from 'node:https';
import {mcpBindingRevision,planMcpConnection,discoverMcpCatalog} from '../../../dist/packages/mcp-connections/src/index.js';
import {strictJson} from '../../../dist/packages/codex-adapter/src/safe.js';
const fixture=kind=>Object.fromEntries(['declaration','binding','catalog'].map(part=>[part,JSON.parse(readFileSync(new URL(`./fixtures/${kind}-${part}.json`,import.meta.url),'utf8'))]));
const serverPath=fileURLToPath(new URL('./support/discovery-server.mjs',import.meta.url));
const bound=values=>({...values,catalog:{...values.catalog,bindingRevision:mcpBindingRevision(values.binding)},synthetic:true});
const parse=bytes=>strictJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes),256*1024);
function stdioAdapter(t,trace){
 return async({binding,signal,onNotification})=>{
  assert.equal(binding.transport.executable,process.execPath);assert.equal(binding.transport.workingDirectory,dirname(serverPath));
  assert.deepEqual(binding.transport.secretReferences,[]);
  const child=spawn(process.execPath,[serverPath],{cwd:binding.transport.workingDirectory,env:{},stdio:['pipe','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  let id=0,buffer=Buffer.alloc(0),failed=false;const pending=new Map();
  const rejectAll=()=>{failed=true;for(const value of pending.values())value.reject(Error('Synthetic transport failed'));pending.clear();};
  const abort=()=>{rejectAll();child.kill('SIGTERM');};signal.addEventListener('abort',abort,{once:true});
  child.on('error',rejectAll);child.on('exit',rejectAll);child.stdin.on('error',rejectAll);
  child.stderr.resume();
  child.stdout.on('data',chunk=>{
   try{
    buffer=Buffer.concat([buffer,chunk]);if(buffer.length>256*1024)throw Error('Bound');
    let end;while((end=buffer.indexOf(10))!==-1){const message=parse(buffer.subarray(0,end));buffer=buffer.subarray(end+1);
     if(message.jsonrpc!=='2.0')throw Error('Envelope');
     if(!Object.hasOwn(message,'id')){onNotification(message);continue;}
     const item=pending.get(message.id);if(!item||Object.hasOwn(message,'error')||!Object.hasOwn(message,'result'))throw Error('Response');
     pending.delete(message.id);item.resolve(message.result);
    }
   }catch{rejectAll();child.kill('SIGTERM');}
  });
  const request=(method,params)=>new Promise((resolve,reject)=>{
   if(failed||signal.aborted)return reject(Error('Closed'));
   const current=++id;pending.set(current,{resolve,reject});trace.push(method);
   child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:current,method,params})+'\n');
  });
  return {
   initialize:params=>request('initialize',params),
   initialized:async()=>{trace.push('notifications/initialized');child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');},
   listTools:params=>request('tools/list',params),
   close:async()=>{
    signal.removeEventListener('abort',abort);rejectAll();
    if(child.exitCode!==null||child.signalCode!==null)return;
    const exited=once(child,'exit');child.stdin.end();
    const timer=setTimeout(()=>child.kill('SIGKILL'),500);try{await exited;}finally{clearTimeout(timer);}
   }
  };
 };
}
test('real stdio discovery negotiates with SDK 1.31.0, follows two pages, and closes without tool calls',{timeout:10000},async t=>{
 const values=fixture('stdio');values.binding.transport={kind:'stdio',executable:process.execPath,workingDirectory:dirname(serverPath),secretReferences:[]};
 const input=bound(values),plan=planMcpConnection(input),trace=[];
 const result=await discoverMcpCatalog(input,{approve:plan.revision,open:stdioAdapter(t,trace),timeoutMs:5000});
 assert.equal(result.catalogMatched,true);assert.equal(result.pageCount,2);assert.equal(result.observedToolCount,2);assert.equal(result.cleanup,'closed');assert.equal(result.executionAuthorized,false);assert.equal(result.authenticationVerified,false);assert.deepEqual(trace,['initialize','notifications/initialized','tools/list','tools/list']);
 assert.ok(!JSON.stringify(result).includes('Caller-supplied synthetic fixture'));
 console.log(JSON.stringify({proof:'stdio-sdk-synthetic-discovery',sdk:'1.31.0',trace,toolCalls:0,result}));
});

function certificate(t){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'bowerloom-test-tls-')));chmodSync(root,0o700);t.after(()=>rmSync(root,{recursive:true,force:true}));
 const key=join(root,'test-key.pem'),cert=join(root,'test-cert.pem');
 const generated=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{encoding:'utf8',timeout:15000});
 assert.equal(generated.status,0,'OpenSSL fixture certificate generation failed');chmodSync(key,0o600);
 return {key:readFileSync(key),cert:readFileSync(cert)};
}
async function httpFixture(t,mode){
 const keys=certificate(t),values=fixture('streamable-http'),trace=[];let initialized=false;
 const server=https.createServer(keys,(req,res)=>{
  assert.equal(req.url,'/mcp');assert.equal(req.method,'POST');assert.equal(req.headers.authorization,undefined);
  assert.match(req.headers.accept,/application\/json/);assert.match(req.headers.accept,/text\/event-stream/);
  let body=Buffer.alloc(0);req.on('data',chunk=>{body=Buffer.concat([body,chunk]);if(body.length>8192)req.destroy();});
  req.on('end',()=>{
   const message=parse(body);trace.push(message.method);
   if(mode==='redirect'){res.writeHead(307,{location:'https://unselected.example.test/mcp'}).end();return;}
   let result;
   if(message.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:values.catalog.serverIdentity};
   else{
    assert.equal(req.headers['mcp-protocol-version'],'2025-11-25');
    if(message.method==='notifications/initialized'){initialized=true;res.writeHead(202).end();return;}
    assert.equal(initialized,true);assert.equal(message.method,'tools/list');
    const tools=structuredClone(values.catalog.tools);
    if(mode==='drift')tools[0].inputSchema.properties.experimentId.minLength=1;
    result=message.params?.cursor==='second'?{tools:tools.slice(1)}:{tools:tools.slice(0,1),nextCursor:'second'};
   }
   res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const endpoint=`https://127.0.0.1:${server.address().port}/mcp`;
 values.binding.transport={kind:'streamable-http',endpoint,auth:{kind:'none'}};
 return {input:bound(values),trace,endpoint,cert:keys.cert};
}
function httpAdapter(fixture){return async({binding,signal})=>{
 assert.equal(binding.transport.endpoint,fixture.endpoint);assert.equal(binding.transport.auth.kind,'none');
 let id=0,ready=false;const active=new Set();
 const send=(method,params,notification=false)=>new Promise((resolve,reject)=>{
  const current=++id;
  const request=https.request(binding.transport.endpoint,{method:'POST',ca:fixture.cert,signal,headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(ready?{'MCP-Protocol-Version':'2025-11-25'}:{})}},response=>{
   if(notification&&response.statusCode===202){response.resume();resolve();return;}
   if(response.statusCode!==200||response.headers['content-type']!=='application/json'){response.resume();reject(Error('Rejected HTTP response'));return;}
   let bytes=Buffer.alloc(0);response.on('data',chunk=>{bytes=Buffer.concat([bytes,chunk]);if(bytes.length>256*1024){response.destroy();reject(Error('Response bound'));}});
   response.on('error',()=>reject(Error('Response interrupted')));
   response.on('end',()=>{try{const message=parse(bytes);if(message.jsonrpc!=='2.0'||message.id!==current||Object.hasOwn(message,'error')||!Object.hasOwn(message,'result'))throw Error('Envelope');resolve(message.result);}catch{reject(Error('Invalid response'));}});
  });
  active.add(request);request.on('close',()=>active.delete(request));request.on('error',()=>reject(Error('Request failed')));
  request.end(JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id:current}),method,...(params?{params}:{})}));
 });
 return {initialize:async params=>{const result=await send('initialize',params);ready=true;return result;},initialized:()=>send('notifications/initialized',undefined,true),listTools:params=>send('tools/list',params),close:async()=>{for(const request of active)request.destroy();active.clear();}};
};}
for(const mode of ['match','drift','redirect'])test(`real loopback TLS JSON discovery ${mode}; no OAuth or remote service claim`,{timeout:15000},async t=>{
 const fixture=await httpFixture(t,mode),plan=planMcpConnection(fixture.input);
 const run=discoverMcpCatalog(fixture.input,{approve:plan.revision,open:httpAdapter(fixture),timeoutMs:5000});
 if(mode==='match'){const result=await run;assert.equal(result.catalogMatched,true);assert.equal(result.pageCount,2);assert.equal(result.executionAuthorized,false);assert.equal(result.authenticationVerified,false);assert.deepEqual(fixture.trace,['initialize','notifications/initialized','tools/list','tools/list']);}
 else await assert.rejects(run);
 assert.ok(!fixture.trace.includes('tools/call'));
 if(mode==='redirect')assert.deepEqual(fixture.trace,['initialize']);
 console.log(JSON.stringify({proof:'loopback-tls-json-discovery',mode,trace:fixture.trace,oauthVerified:false,toolCalls:0}));
});
