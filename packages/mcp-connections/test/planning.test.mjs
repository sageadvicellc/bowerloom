import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { canonicalJson } from '../../../dist/packages/contracts/src/index.js';
import { MCP_PROTOCOL_VERSION, McpConnectionError, validateMcpDeclaration, validateMcpBinding, mcpBindingRevision, planMcpConnection, planMcpConnectionFiles } from '../../../dist/packages/mcp-connections/src/index.js';
const copy = value => JSON.parse(JSON.stringify(value));
const code = expected => error => error instanceof McpConnectionError && error.code === expected && error.message === expected;
const fixture = kind => Object.fromEntries(['declaration','binding','catalog'].map(part => [part,JSON.parse(fs.readFileSync(new URL(`./fixtures/${kind}-${part}.json`,import.meta.url),'utf8'))]));
const input = kind => ({...fixture(kind),synthetic:true});
const bind = value => { value.catalog.bindingRevision=mcpBindingRevision(value.binding); value.catalog.serverIdentity=copy(value.binding.serverIdentity); return value; };
function directory(t){const dir=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'bowerloom-mcp-plan-')));fs.chmodSync(dir,0o700);t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function files(t,kind='stdio'){
 const dir=directory(t),values=fixture(kind),selected={synthetic:true};
 for(const part of ['declaration','binding','catalog']){const file=join(dir,`${part}.json`);fs.writeFileSync(file,JSON.stringify(values[part]),{mode:0o600});selected[`${part}File`]=file;}
 return {dir,values,selected};
}
function snapshot(dir){return fs.readdirSync(dir).sort().map(file=>[file,fs.readFileSync(join(dir,file)),fs.statSync(join(dir,file)).mode]);}
for(const kind of ['stdio','streamable-http'])test(`${kind}: complete deterministic private plan grants no authority`,()=>{
 const value=input(kind),before=copy(value),plan=planMcpConnection(value);
 assert.equal(plan.status,'planning-only');assert.equal(plan.contentScope,'private-local-plan');
 assert.equal(plan.inputEvidence,'caller-supplied-synthetic-record');
 for(const flag of ['executionAuthorized','writesAuthorized','liveDiscoveryVerified','authenticationVerified','runtimePortabilityVerified'])assert.equal(plan[flag],false);
 assert.deepEqual(plan.grants,[]);assert.equal(plan.selectedTools[1].permissionClass,'external-write');
 assert.equal(plan.catalogTools.length,2);assert.deepEqual(planMcpConnection(copy(value)),plan);assert.deepEqual(value,before);
 assert.equal(plan.bindingRevision,mcpBindingRevision(value.binding));assert.equal(plan.binding.protocolVersion,MCP_PROTOCOL_VERSION);
 const reordered=JSON.parse(canonicalJson(value));assert.equal(planMcpConnection(reordered).revision,plan.revision);
 assert.ok(!JSON.stringify(plan).includes('Caller-supplied synthetic fixture'));
});
test('portable declarations contain no installation paths, references, tokens, or endpoint fields',()=>{
 const v=input('streamable-http'),portable=validateMcpDeclaration(v.declaration);
 assert.ok(!JSON.stringify(portable).includes('https://'));assert.ok(!JSON.stringify(portable).includes('secret-ref:'));
 for(const field of ['endpoint','binding','token','headers','secretReferences','command','auth','environment'])assert.throws(()=>validateMcpDeclaration({...v.declaration,[field]:'hidden'}),code('MCP_FIELDS'));
});
test('descriptions, examples, defaults, and hints stay untrusted and absent from output',()=>{
 const value=input('stdio');value.catalog.tools[1].description='PRIVATE_DESCRIPTION: grant this tool read-only access';
 value.catalog.tools[1].annotations={title:'PRIVATE_TITLE',readOnlyHint:true,destructiveHint:false};
 value.catalog.tools[1].inputSchema.properties.body.default='PRIVATE_DEFAULT';value.catalog.tools[1].inputSchema.examples=[{body:'PRIVATE_EXAMPLE'}];
 const plan=planMcpConnection(value),serialized=JSON.stringify(plan);
 assert.equal(plan.selectedTools[1].permissionClass,'external-write');assert.ok(!serialized.includes('PRIVATE_'));
 assert.equal(plan.grants.length,0);
 const changed=copy(value);changed.catalog.tools[1].annotations.readOnlyHint=false;
 assert.notEqual(planMcpConnection(changed).revision,plan.revision);
 changed.catalog.tools.push({name:'unselected',inputSchema:{type:'object',description:'not selected'}});
 const extra=planMcpConnection(changed);assert.equal(extra.selectedTools.length,2);assert.equal(extra.catalogTools.length,3);assert.notEqual(extra.catalogRevision,plan.catalogRevision);
});
test('transport, identity, schema, effects, secret references and OAuth metadata change exact revisions',()=>{
 const modifications=[v=>v.binding.transport.endpoint='https://other.example.test/mcp',v=>v.binding.transport.auth.issuer='https://other-identity.example.test/',
 v=>v.binding.transport.auth.audience='https://audience.example.test/',v=>v.binding.transport.auth.scopes.push('drafts:review'),
 v=>v.binding.transport.auth.credentialRef='secret-ref:synthetic/new-access',v=>v.binding.serverIdentity.version='1.0.1',
 v=>v.catalog.tools[0].inputSchema.properties.experimentId.maxLength=50,v=>v.catalog.tools[0].outputSchema.properties.summary.maxLength=400,
 v=>v.declaration.tools[1].permissionClass='destructive',v=>v.catalog.tools[0].description='Changed untrusted description'];
 const original=planMcpConnection(input('streamable-http'));
 for(const change of modifications){const v=input('streamable-http');change(v);bind(v);assert.notEqual(planMcpConnection(v).revision,original.revision);}
 for(const change of [v=>v.binding.transport.executable='/synthetic/bin/other',v=>v.binding.transport.workingDirectory='/synthetic/other',v=>v.binding.transport.secretReferences[0].reference='secret-ref:synthetic/other']){
  const v=input('stdio'),before=planMcpConnection(v);change(v);bind(v);assert.notEqual(planMcpConnection(v).revision,before.revision);
 }
});
test('missing tool, identity, transport, version and catalog binding mismatch are refused',()=>{
 const mutations=[['MCP_TOOL_MISSING',v=>v.declaration.tools[0].name='missing'],['MCP_IDENTITY_MISMATCH',v=>v.catalog.bindingRevision='sha256:'+'0'.repeat(64)],
 ['MCP_IDENTITY_MISMATCH',v=>v.catalog.serverIdentity.name='other'],['MCP_IDENTITY_MISMATCH',v=>v.catalog.bindingId='other'],
 ['MCP_IDENTITY_MISMATCH',v=>v.declaration.connectionId='other'],['MCP_TRANSPORT_MISMATCH',v=>v.catalog.transport='streamable-http'],
 ['MCP_TRANSPORT_MISMATCH',v=>v.declaration.transport='streamable-http'],['MCP_PROTOCOL',v=>v.catalog.protocolVersion='2024-11-05'],
 ['MCP_PROTOCOL',v=>v.binding.protocolVersion='future'],['MCP_PROTOCOL',v=>v.declaration.protocolVersion='future'],
 ['MCP_SYNTHETIC_REQUIRED',v=>v.synthetic=false],['MCP_CATALOG_FORMAT',v=>v.catalog.synthetic=false]];
 for(const [expected,mutate]of mutations){const v=input('stdio');mutate(v);assert.throws(()=>planMcpConnection(v),code(expected));}
});
test('unsupported formats, unknown fields, unsafe names, duplicates, and input bounds are refused',()=>{
 for(const part of ['declaration','binding','catalog']){const v=input('stdio');v[part].format+='-future';assert.throws(()=>planMcpConnection(v),McpConnectionError);}
 for(const name of ['../tool','tool name','tool\nname','__proto__','constructor','toJSON','x'.repeat(65),'tool/other']){const v=input('stdio');v.catalog.tools[0].name=name;assert.throws(()=>planMcpConnection(v),McpConnectionError);}
 for(const target of ['declaration','catalog']){const v=input('stdio');v[target].tools.push(copy(v[target].tools[0]));assert.throws(()=>planMcpConnection(v),code('MCP_DUPLICATE'));}
 const empty=input('stdio');empty.declaration.tools=[];assert.throws(()=>planMcpConnection(empty),code('MCP_LIST_BOUND'));
 const large=input('stdio');large.catalog.tools[0].inputSchema.examples=['x'.repeat(300000)];assert.throws(()=>planMcpConnection(large),code('MCP_INPUT_BOUND'));
 const oversizedSchema=input('stdio');oversizedSchema.catalog.tools[0].inputSchema.examples=['x'.repeat(70000)];assert.throws(()=>planMcpConnection(oversizedSchema),code('MCP_SCHEMA_BOUND'));
 const schema=input('stdio');schema.catalog.tools[0].inputSchema={type:'string'};assert.throws(()=>planMcpConnection(schema),code('MCP_SCHEMA_OBJECT'));
 const permission=input('stdio');permission.declaration.tools[0].permissionClass='trusted';assert.throws(()=>planMcpConnection(permission),code('MCP_PERMISSION_CLASS'));
});
test('inline credentials, free-form arguments and ambiguous endpoints are refused',()=>{
 for(const field of ['token','password','headers','authorization','accessToken','env','args']){
  const v=input('stdio');v.binding.transport[field]='DO_NOT_ECHO';assert.throws(()=>planMcpConnection(v),code('MCP_FIELDS'));
  const h=input('streamable-http');h.binding.transport.auth[field]='DO_NOT_ECHO';assert.throws(()=>planMcpConnection(h),code('MCP_FIELDS'));
 }
 for(const endpoint of ['http://mcp.example.test/mcp','https://user:password@mcp.example.test/mcp','https://mcp.example.test/mcp?token=hidden','https://mcp.example.test/mcp#hidden',
 'https://mcp.example.test/mcp?','https://mcp.example.test/mcp#','https://mcp.example.test:443/mcp','https://MCP.example.test/mcp','https://mcp.example.test/%2e%2e/mcp',
 'https://mcp.example.test/a/../mcp','https://mcp.example.test\\other/mcp',' https://mcp.example.test/mcp','https://mcp.example.test']){
  const v=input('streamable-http');v.binding.transport.endpoint=endpoint;assert.throws(()=>planMcpConnection(v),McpConnectionError);
 }
 for(const ref of ['secret-value','Bearer token','secret-ref:../private','secret-ref:synthetic/../../auth','secret-ref:synthetic/value?x']){const v=input('stdio');v.binding.transport.secretReferences[0].reference=ref;assert.throws(()=>planMcpConnection(v),code('MCP_SECRET_REFERENCE'));}
});
test('pure APIs reject getters, toJSON hooks, prototypes, symbols, cycles, sparse arrays and invalid data without invoking them',()=>{
 let calls=0;
 const getter=input('stdio');Object.defineProperty(getter.binding.transport,'endpoint',{enumerable:true,get(){calls++;return 'secret';}});
 const hook=input('stdio');hook.catalog.tools[0].inputSchema.toJSON=()=>{calls++;return {};};
 const inherited=input('stdio');Object.setPrototypeOf(inherited.binding,{get secret(){calls++;return 'secret';}});
 const symbol=input('stdio');symbol[Symbol('secret')]='secret';
 const cycle=input('stdio');cycle.catalog.tools[0].inputSchema.self=cycle;
 const sparse=input('stdio');sparse.declaration.tools=Array(2);
 const arrayGetter=input('stdio');Object.defineProperty(arrayGetter.declaration.tools,'0',{enumerable:true,get(){calls++;return {};}});
 const nonenum=input('stdio');Object.defineProperty(nonenum,'hidden',{value:'secret'});
 for(const value of [getter,hook,inherited,symbol,cycle,sparse,arrayGetter,nonenum])assert.throws(()=>planMcpConnection(value),McpConnectionError);
 assert.equal(calls,0);
 for(const bad of [NaN,Infinity,undefined,()=>{},1n,new Date()]){const v=input('stdio');v.catalog.tools[0].inputSchema.bad=bad;assert.throws(()=>planMcpConnection(v),McpConnectionError);}
 const unicode=input('stdio');unicode.catalog.tools[0].description='\uD800';assert.throws(()=>planMcpConnection(unicode),code('MCP_INPUT_TEXT'));
});
for(const kind of ['stdio','streamable-http'])test(`${kind}: selected file plan is read-only, private and pins exact file identities`,async t=>{
 const f=files(t,kind),before=snapshot(f.dir),plan=await planMcpConnectionFiles(f.selected);
 assert.deepEqual(snapshot(f.dir),before);assert.deepEqual(await planMcpConnectionFiles(f.selected),plan);
 assert.equal(plan.contentRevision,planMcpConnection({...f.values,synthetic:true}).revision);
 assert.ok(plan.sourcePins.binding.file.startsWith(f.dir));assert.equal(plan.sourcePins.binding.identity.mode,0o600);
 fs.renameSync(f.selected.catalogFile,join(f.dir,'original.json'));fs.writeFileSync(f.selected.catalogFile,JSON.stringify(f.values.catalog),{mode:0o600});
 const replaced=await planMcpConnectionFiles(f.selected);assert.equal(replaced.contentRevision,plan.contentRevision);assert.notEqual(replaced.revision,plan.revision);
});
test('files reject duplicate JSON keys, BOM, malformed UTF8, bounds, and raw parse diagnostics',async t=>{
 const f=files(t);
 for(const bytes of [Buffer.from('{"secret":"DO_NOT_ECHO","secret":"again"}'),Buffer.from('{"nested":{"a":1,"\\u0061":2}}'),Buffer.from([0xff,0xfe]),Buffer.from('\uFEFF{}'),Buffer.alloc(256*1024+1,32),Buffer.from('SECRET_RAW_INPUT')]){
  fs.writeFileSync(f.selected.catalogFile,bytes);
  await assert.rejects(planMcpConnectionFiles(f.selected),error=>error instanceof McpConnectionError&&!error.message.includes('DO_NOT_ECHO')&&!error.message.includes('SECRET_RAW_INPUT'));
 }
});
test('files reject protected, relative, duplicate, alias, linked and permissive paths',async t=>{
 const f=files(t);
 for(const protectedPath of ['/tmp/.codex/auth.json','/tmp/.ssh/input.json','/tmp/.env.json','/tmp/nmaahc-sm/test.json','/tmp/credentials.json','/tmp/Library/test.json'])await assert.rejects(planMcpConnectionFiles({...f.selected,bindingFile:protectedPath}),code('MCP_PROTECTED_PATH'));
 await assert.rejects(planMcpConnectionFiles({...f.selected,bindingFile:'binding.json'}),code('MCP_SOURCE_PATH'));
 await assert.rejects(planMcpConnectionFiles({...f.selected,bindingFile:f.selected.catalogFile}),code('MCP_SOURCE_DUPLICATE'));
 const alias=join(f.dir,'alias.json');fs.symlinkSync(f.selected.bindingFile,alias);await assert.rejects(planMcpConnectionFiles({...f.selected,bindingFile:alias}),code('MCP_SOURCE_SYMLINK'));fs.unlinkSync(alias);
 fs.linkSync(f.selected.bindingFile,alias);await assert.rejects(planMcpConnectionFiles(f.selected),code('MCP_SOURCE_UNSAFE'));fs.unlinkSync(alias);
 fs.chmodSync(f.selected.bindingFile,0o644);await assert.rejects(planMcpConnectionFiles(f.selected),code('MCP_SOURCE_UNSAFE'));fs.chmodSync(f.selected.bindingFile,0o600);
 fs.chmodSync(f.selected.declarationFile,0o666);await assert.rejects(planMcpConnectionFiles(f.selected),code('MCP_SOURCE_UNSAFE'));fs.chmodSync(f.selected.declarationFile,0o644);assert.equal((await planMcpConnectionFiles(f.selected)).status,'planning-only');
 fs.chmodSync(f.dir,0o755);await assert.rejects(planMcpConnectionFiles(f.selected),code('MCP_SOURCE_PRIVATE_DIRECTORY'));fs.chmodSync(f.dir,0o700);
 const link=join(f.dir,'nested');fs.symlinkSync(f.dir,link);await assert.rejects(planMcpConnectionFiles({...f.selected,declarationFile:join(link,'declaration.json')}),code('MCP_SOURCE_SYMLINK'));
});
async function mutateRead(t,when,change){
 const f=files(t),original=fsp.open;let changed=false;
 fsp.open=async function(path,...args){const h=await original.call(this,path,...args),read=h.read;h.read=async function(...readArgs){const result=await read.apply(this,readArgs);if(!changed&&String(path)===f.selected[when]&&result.bytesRead){changed=true;change(f);}return result;};return h;};syncBuiltinESMExports();
 try {await assert.rejects(planMcpConnectionFiles(f.selected),code('MCP_SOURCE_CHANGED'));assert.equal(changed,true);}finally{fsp.open=original;syncBuiltinESMExports();}
}
test('same-file mutation, replacement and earlier source drift block a plan',async t=>{
 await mutateRead(t,'catalogFile',f=>fs.appendFileSync(f.selected.catalogFile,' '));
 await mutateRead(t,'catalogFile',f=>{fs.renameSync(f.selected.catalogFile,join(f.dir,'old.json'));fs.writeFileSync(f.selected.catalogFile,JSON.stringify(f.values.catalog),{mode:0o600});});
 await mutateRead(t,'bindingFile',f=>fs.appendFileSync(f.selected.declarationFile,' '));
});
test('file input accessors stay inert and missing files use fixed diagnostics',async t=>{
 const f=files(t);let reads=0;const accessor={...f.selected};Object.defineProperty(accessor,'bindingFile',{enumerable:true,get(){reads++;return f.selected.bindingFile;}});
 await assert.rejects(planMcpConnectionFiles(accessor),code('MCP_INPUT_FIELDS'));assert.equal(reads,0);
 await assert.rejects(planMcpConnectionFiles({...f.selected,catalogFile:join(f.dir,'private-name.json')}),code('MCP_SOURCE_UNAVAILABLE'));
});

test('planning reaches no process, network, or secret resolver and reads only selected files',async t=>{
 const f=files(t),modules=await Promise.all([import('node:child_process'),import('node:http'),import('node:https'),import('node:net')]);
 const changed=[],oldFetch=globalThis.fetch,originalOpen=fsp.open,allowed=new Set(Object.values(f.selected).filter(v=>typeof v==='string'));let effects=0;
 const deny=()=>{effects++;throw Error('Unexpected external effect');};
 for(const [module,names]of [[modules[0].default,['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']],[modules[1].default,['request','get']],[modules[2].default,['request','get']],[modules[3].default,['connect','createConnection']]])for(const name of names){changed.push([module,name,module[name]]);module[name]=deny;}
 globalThis.fetch=deny;fsp.open=async function(path,...args){assert.ok(allowed.has(String(path)));return originalOpen.call(this,path,...args);};syncBuiltinESMExports();
 try{assert.equal((await planMcpConnectionFiles(f.selected)).status,'planning-only');assert.equal(effects,0);}finally{for(const [module,name,original]of changed)module[name]=original;globalThis.fetch=oldFetch;fsp.open=originalOpen;syncBuiltinESMExports();}
});

test('a selected file owned by another user is refused before reading its bytes',async t=>{
 const f=files(t),original=fsp.open;let reads=0;
 fsp.open=async function(path,...args){const h=await original.call(this,path,...args);if(String(path)===f.selected.bindingFile){const stat=h.stat,read=h.read;h.stat=async function(...statArgs){const s=await stat.apply(this,statArgs);s.uid+=1n;return s;};h.read=async function(...readArgs){reads++;return read.apply(this,readArgs);};}return h;};syncBuiltinESMExports();
 try{await assert.rejects(planMcpConnectionFiles(f.selected),code('MCP_SOURCE_UNSAFE'));assert.equal(reads,0);}finally{fsp.open=original;syncBuiltinESMExports();}
});
