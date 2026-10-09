import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, realpath, readFile, writeFile, copyFile, rm, stat, chmod, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMcpStdioDiscoveryFactory, McpConnectionError } from '../../../dist/packages/mcp-connections/src/index.js';
const fixtureSource=new URL('./fixtures/stdio-adapter-server.mjs',import.meta.url);
const executable=await realpath(process.execPath);
const digest=async file=>{const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return 'sha256:'+hash.digest('hex');};
const executableDigest=await digest(executable);
const initial={protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'bowerloom-discovery',version:'0.7.0-beta.1'}};
const refused=error=>error instanceof McpConnectionError&&/^MCP_STDIO_[A-Z_]+$/.test(error.code)&&error.code===error.message&&!error.message.includes('PRIVATE');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function setup(t,mode='normal'){
 const directory=await mkdtemp(path.join(await realpath(tmpdir()),'bowerloom-stdio-unit-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const script=path.join(directory,'server.mjs'),log=path.join(directory,'events.jsonl');await copyFile(fixtureSource,script);await chmod(script,0o600);
 const refs=[{environmentVariable:'SYNTHETIC_LOG',reference:'secret-ref:synthetic/log'},{environmentVariable:'SYNTHETIC_SECRET',reference:'secret-ref:synthetic/secret'}];
 const binding={format:'bowerloom/mcp-binding/v1beta1',connectionId:'labs',bindingId:'synthetic',protocolVersion:'2025-11-25',serverIdentity:{name:'labs-fixture',version:'1.0.0'},transport:{kind:'stdio',executable,workingDirectory:directory,secretReferences:refs}};
 const effect={kind:'stdio',executable:{path:executable,digest:executableDigest},entrypoints:[{path:script,digest:await digest(script)}],args:[script,mode],cwd:directory,environment:{inherit:false,secretReferences:structuredClone(refs)}};
 const signal=new AbortController(),notifications=[];let resolves=0;
 const context={binding,effect,operationKey:'sha256:'+'a'.repeat(64),scope:{workspaceId:'test',runId:'test',taskId:'test'},signal:signal.signal,onNotification:n=>notifications.push(n)};
 const options={trustedLocalServerOnly:true,requestTimeoutMs:1000,sessionTimeoutMs:5000,cleanupTimeoutMs:1000,resolveSecret:async reference=>{assert.ok(Object.isFrozen(reference));resolves++;return reference.environmentVariable==='SYNTHETIC_LOG'?log:'PRIVATE_SYNTHETIC_VALUE';}};
 const events=async()=>{try{return(await readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(error){if(error.code==='ENOENT')return[];throw error;}};
 const started=async()=>{for(let i=0;i<200;i++){const values=await events();if(values.length)return values[0];await wait(5);}throw Error('synthetic fixture did not start');};
 return{directory,script,log,context,options,signal,notifications,events,started,get resolves(){return resolves;}};
}
const dead=pid=>assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH');

test('trusted local stdio executes only frozen exact argv and explicit env, supports pages and closes its child',async t=>{
 const f=await setup(t,'literal-$HOME-$(echo nope)');const previous=process.env.SYNTHETIC_AMBIENT;process.env.SYNTHETIC_AMBIENT='PRIVATE_AMBIENT';t.after(()=>{if(previous===undefined)delete process.env.SYNTHETIC_AMBIENT;else process.env.SYNTHETIC_AMBIENT=previous;});
 const adapter=await createMcpStdioDiscoveryFactory(f.options)(f.context);t.after(()=>adapter.close());
 assert.equal((await adapter.initialize(initial)).protocolVersion,'2025-11-25');await adapter.initialized();const first=await adapter.listTools({});assert.equal(first.nextCursor,'second');assert.deepEqual((await adapter.listTools({cursor:'second'})).tools,[]);await adapter.close();
 const events=await f.events(),start=events[0];assert.deepEqual(start.environment.filter(key=>!(process.platform==='darwin'&&key==='__CF_USER_TEXT_ENCODING')),['SYNTHETIC_LOG','SYNTHETIC_SECRET']);assert.equal(start.secretPresent,true);assert.equal(start.cwd,f.directory);assert.deepEqual(start.argv,['literal-$HOME-$(echo nope)']);assert.deepEqual(events.slice(1).map(x=>x.method),['initialize','notifications/initialized','tools/list','tools/list']);dead(start.pid);dead(start.guardianPid);assert.equal(f.resolves,2);assert.deepEqual(Object.keys(adapter).sort(),['close','initialize','initialized','listTools']);await assert.rejects(adapter.listTools({}),refused);
});
test('trust acknowledgement and inert option/input fields are required',async t=>{
 const f=await setup(t);assert.throws(()=>createMcpStdioDiscoveryFactory({...f.options,trustedLocalServerOnly:false}),refused);const {trustedLocalServerOnly,...missing}=f.options;assert.throws(()=>createMcpStdioDiscoveryFactory(missing),refused);
 let reads=0;Object.defineProperty(f.context,'effect',{get(){reads++;return {};},enumerable:true});await assert.rejects(createMcpStdioDiscoveryFactory(f.options)(f.context),refused);assert.equal(reads,0);assert.deepEqual(await f.events(),[]);
});
test('binding, executable, cwd, argument and environment drift fail before spawn',async t=>{
 for(const change of [f=>f.context.effect.executable.path='/different',f=>f.context.effect.cwd='/different',f=>f.context.effect.args=['--eval','PRIVATE'],f=>f.context.effect.args.push('nul\0arg'),f=>f.context.effect.environment.inherit=true,f=>f.context.effect.environment.secretReferences=[],f=>f.context.effect.entrypoints.push(f.context.effect.entrypoints[0])]){
  const f=await setup(t);change(f);await assert.rejects(createMcpStdioDiscoveryFactory(f.options)(f.context),refused);assert.deepEqual(await f.events(),[]);assert.equal(f.resolves,0);
 }
});
test('loader-control and ambient environment names including NODE_OPTIONS are refused',async t=>{
 for(const name of ['NODE_OPTIONS','NODE_V8_COVERAGE','NODE_PATH','PATH','HOME','LD_PRELOAD','DYLD_INSERT_LIBRARIES','PYTHONPATH','OPENSSL_CONF','JAVA_TOOL_OPTIONS']){
  const f=await setup(t);f.context.binding.transport.secretReferences[0].environmentVariable=name;f.context.effect.environment.secretReferences[0].environmentVariable=name;await assert.rejects(createMcpStdioDiscoveryFactory(f.options)(f.context),refused);assert.deepEqual(await f.events(),[]);
 }
});
test('digests are remeasured after async secret resolution and changed script or executable never starts',async t=>{
 const f=await setup(t),resolver=f.options.resolveSecret;let changed=false;f.options.resolveSecret=async ref=>{const value=await resolver(ref);if(!changed){changed=true;await writeFile(f.script,'// modified after proposal\n');}return value;};await assert.rejects(createMcpStdioDiscoveryFactory(f.options)(f.context),refused);assert.equal(f.resolves,2);assert.deepEqual(await f.events(),[]);
 const other=await setup(t);other.context.effect.executable.digest='sha256:'+'0'.repeat(64);await assert.rejects(createMcpStdioDiscoveryFactory(other.options)(other.context),refused);assert.deepEqual(await other.events(),[]);
});
test('symlink files and ancestors, hardlinks, directories and writable scripts fail preflight',async t=>{
 for(const kind of ['symlink','ancestor','hardlink','directory','writable']){
  const f=await setup(t);if(kind==='symlink'){const alias=path.join(f.directory,'alias.mjs');await symlink(f.script,alias);f.context.effect.entrypoints[0].path=alias;f.context.effect.args[0]=alias;}
  else if(kind==='ancestor'){const alias=path.join(f.directory,'alias');await symlink(f.directory,alias);f.context.effect.entrypoints[0].path=path.join(alias,'server.mjs');f.context.effect.args[0]=path.join(alias,'server.mjs');}
  else if(kind==='hardlink')await link(f.script,path.join(f.directory,'linked.mjs'));
  else if(kind==='directory'){f.context.effect.entrypoints[0].path=f.directory;f.context.effect.args[0]=f.directory;}
  else await chmod(f.script,0o666);
  await assert.rejects(createMcpStdioDiscoveryFactory(f.options)(f.context),refused);assert.deepEqual(await f.events(),[]);
 }
});
test('secrets are bounded, private on failure and cancelled resolvers cannot spawn late',async t=>{
 for(const value of ['x\0y','x'.repeat(8193),42]){const f=await setup(t);f.options.resolveSecret=async()=>value;await assert.rejects(createMcpStdioDiscoveryFactory(f.options)(f.context),refused);assert.deepEqual(await f.events(),[]);}
 const late=await setup(t);let release;late.options.resolveSecret=()=>new Promise(resolve=>{release=()=>resolve('PRIVATE_SECRET');});const pending=createMcpStdioDiscoveryFactory(late.options)(late.context);await wait(5);late.signal.abort();await assert.rejects(pending,refused);release();await wait(10);assert.deepEqual(await late.events(),[]);
 const queued=await setup(t);const opening=createMcpStdioDiscoveryFactory(queued.options)(queued.context);queued.signal.abort();await assert.rejects(opening,refused);assert.equal(queued.resolves,0);assert.deepEqual(await queued.events(),[]);
});
test('strict newline JSON refuses malformed UTF8, duplicates, wrong IDs, extras and output floods without raw errors',async t=>{
 for(const mode of ['utf8','duplicate','wrong-id','extra','flood','stderr','partial','exit']){
  const f=await setup(t,mode),adapter=await createMcpStdioDiscoveryFactory(f.options)(f.context);await assert.rejects(adapter.initialize(initial),refused);await adapter.close();const start=(await f.events())[0];assert.ok(start);dead(start.pid);await assert.rejects(adapter.initialize(initial),refused);
 }
});
test('server notifications and requests are sanitized and refused without answering',async t=>{
 for(const mode of ['notification','server-request']){const f=await setup(t,mode),adapter=await createMcpStdioDiscoveryFactory(f.options)(f.context);await assert.rejects(adapter.initialize(initial),refused);await adapter.close();assert.equal(f.notifications.length,1);assert.equal(JSON.stringify(f.notifications).includes('PRIVATE'),false);assert.deepEqual((await f.events()).slice(1).map(x=>x.method),['initialize']);}
});
test('unsolicited startup messages abort the session before any protocol invocation',async t=>{
 const f=await setup(t,'startup-message'),adapter=await createMcpStdioDiscoveryFactory(f.options)(f.context);await f.started();await wait(20);await assert.rejects(adapter.initialize(initial),refused);await adapter.close();assert.equal(f.notifications.length,1);assert.equal((await f.events()).length,1);
});
test('timeouts, abort and close reap the owned child, escalating an ignored SIGTERM',async t=>{
 for(const action of ['timeout','abort','close']){const f=await setup(t,'ignore-term');f.options.requestTimeoutMs=30;const adapter=await createMcpStdioDiscoveryFactory(f.options)(f.context);const start=await f.started();const pending=assert.rejects(adapter.initialize(initial),refused);if(action==='abort')f.signal.abort();if(action==='close')await adapter.close();await pending;await adapter.close();dead(start.pid);}
});
test('invalid method order, parallel requests and request bounds never invoke tools or retry',async t=>{
 const f=await setup(t),adapter=await createMcpStdioDiscoveryFactory(f.options)(f.context);await assert.rejects(adapter.listTools({}),refused);await adapter.close();
 const parallel=await setup(t,'stall'),active=await createMcpStdioDiscoveryFactory(parallel.options)(parallel.context);const pending=active.initialize(initial);await assert.rejects(active.initialize(initial),refused);await assert.rejects(pending,refused);await active.close();
 const capped=await setup(t),bounded=await createMcpStdioDiscoveryFactory(capped.options)(capped.context);await bounded.initialize(initial);await bounded.initialized();for(let i=0;i<8;i++)await bounded.listTools({});await assert.rejects(bounded.listTools({}),refused);await bounded.close();assert.equal((await capped.events()).filter(x=>x.method).length,10);
});
test('short cleanup observation can report uncertainty while guardian independently finishes cleanup',async t=>{
 const f=await setup(t,'ignore-term');f.options.cleanupTimeoutMs=1;const adapter=await createMcpStdioDiscoveryFactory(f.options)(f.context);const start=await f.started();
 await assert.rejects(adapter.close(),error=>error.code==='MCP_STDIO_CLEANUP_UNCERTAIN');
 for(let i=0;i<400;i++){let running=false;for(const pid of [start.pid,start.guardianPid]){try{process.kill(pid,0);running=true;}catch(error){if(error.code!=='ESRCH')throw error;}}if(!running)break;await wait(5);}
 dead(start.pid);dead(start.guardianPid);
});

test('Node coverage environment propagation is suppressed without an effective child setting or files',async t=>{
 const f=await setup(t),previous=process.env.NODE_V8_COVERAGE,coverage=path.join(f.directory,'ambient-coverage');process.env.NODE_V8_COVERAGE=coverage;
 t.after(()=>{if(previous===undefined)delete process.env.NODE_V8_COVERAGE;else process.env.NODE_V8_COVERAGE=previous;});
 const adapter=await createMcpStdioDiscoveryFactory(f.options)(f.context);t.after(()=>adapter.close());await adapter.initialize(initial);await adapter.close();
 const start=(await f.events())[0];assert.equal(start.environment.includes('NODE_V8_COVERAGE'),false);await assert.rejects(stat(coverage),error=>error.code==='ENOENT');dead(start.pid);
});
