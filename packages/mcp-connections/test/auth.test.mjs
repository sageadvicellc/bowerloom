import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { validateMcpAccessToken, mcpRevocationRevision, mcpBindingRevision, McpConnectionError } from '../../../dist/packages/mcp-connections/src/index.js';
const copy=value=>JSON.parse(JSON.stringify(value));
const code=expected=>error=>error instanceof McpConnectionError&&error.code===expected&&error.message===expected;
const binding=JSON.parse(fs.readFileSync(new URL('./fixtures/streamable-http-binding.json',import.meta.url),'utf8'));
const nowMs=Date.UTC(2026,9,4,12),now=nowMs/1000;
const keys=generateKeyPair('RS256',{modulusLength:2048,extractable:true});
const otherKeys=generateKeyPair('RS256',{modulusLength:2048,extractable:true});
const claims=()=>({iss:binding.transport.auth.issuer,aud:binding.transport.auth.audience,sub:'coda@example.test',client_id:'bowerloom-synthetic-client',scope:binding.transport.auth.scopes.join(' '),iat:now-5,nbf:now-5,exp:now+300,jti:'synthetic-token-01'});
async function token(payload=claims(),header={alg:'RS256',typ:'at+jwt',kid:'test-key'},keyPair){const selected=keyPair??await keys;return new SignJWT(payload).setProtectedHeader(header).sign(selected.privateKey);}
async function fixture(){
 const publicKey={...await exportJWK((await keys).publicKey),kid:'test-key',alg:'RS256',use:'sig'};
 const revocation={format:'bowerloom/mcp-revocation-snapshot/v1beta1',bindingRevision:mcpBindingRevision(binding),issuer:binding.transport.auth.issuer,subject:'coda@example.test',revocationEpoch:1,issuedAtMs:nowMs-1000,validUntilMs:nowMs+59000,revokedTokenIds:[],revokedSubjects:[],revokedKeyIds:[]};
 const policy={format:'bowerloom/mcp-token-policy/v1beta1',bindingRevision:mcpBindingRevision(binding),subject:'coda@example.test',clientId:'bowerloom-synthetic-client',issuer:binding.transport.auth.issuer,audience:binding.transport.auth.audience,publicKeys:[publicKey],maxTokenLifetimeSeconds:600,maxTokenAgeSeconds:600,maxRevocationAgeSeconds:60,revocationEpoch:1,revocationRevision:mcpRevocationRevision(revocation)};
 return {token:await token(),binding:copy(binding),policy,revocation,nowMs,synthetic:true};
}
function repin(f){f.policy.revocationRevision=mcpRevocationRevision(f.revocation);f.policy.revocationEpoch=f.revocation.revocationEpoch;return f;}
function segmentJson(value){return Buffer.from(JSON.stringify(value)).toString('base64url');}
function rawToken(header,payload){return `${Buffer.from(header).toString('base64url')}.${Buffer.from(payload).toString('base64url')}.${Buffer.alloc(256).toString('base64url')}`;}
test('valid synthetic RS256 token returns a private revision-bound receipt without token, raw key or jti',async()=>{
 const f=await fixture(),before=copy(f),receipt=await validateMcpAccessToken(f),serialized=JSON.stringify(receipt);
 assert.equal(receipt.signatureVerified,true);assert.equal(receipt.executionAuthorized,false);assert.equal(receipt.realIdentityVerified,false);assert.deepEqual(receipt.grants,[]);
 assert.equal(receipt.contentScope,'private-local-validation');assert.equal(receipt.bindingRevision,f.policy.bindingRevision);assert.equal(receipt.revocationRevision,f.policy.revocationRevision);
 assert.equal(receipt.subject,f.policy.subject);assert.equal(receipt.kid,'test-key');assert.equal(receipt.expiresAtMs,(now+300)*1000);assert.equal(receipt.validatedAtMs,nowMs);
 assert.ok(!serialized.includes(f.token));assert.ok(!serialized.includes(f.policy.publicKeys[0].n));assert.ok(!serialized.includes(claims().jti));
 assert.ok(Object.isFrozen(receipt));assert.ok(Object.isFrozen(receipt.grants));assert.deepEqual(f,before);assert.deepEqual(await validateMcpAccessToken(copy(f)),receipt);
});
test('wrong issuer, audience, user and client fail even with valid signatures',async()=>{
 for(const patch of [{iss:'https://other.example.test/'},{aud:'https://other.example.test/'},{aud:[binding.transport.auth.audience]},{aud:[binding.transport.auth.audience,'https://other.example.test/']},{sub:'miki@example.test'},{client_id:'other-client'}]){
  const f=await fixture();f.token=await token({...claims(),...patch});await assert.rejects(validateMcpAccessToken(f),code('MCP_AUTH_CLAIM_BINDING'));
 }
});
test('missing, excess, duplicate and malformed scopes are refused; exact scope order is immaterial',async()=>{
 for(const scope of ['experiments:read','experiments:read drafts:write admin:all','experiments:read experiments:read','experiments:read  drafts:write',' experiments:read drafts:write','experiments:read\tdrafts:write',[],null]){
  const f=await fixture();f.token=await token({...claims(),scope});await assert.rejects(validateMcpAccessToken(f),code('MCP_AUTH_SCOPE'));
 }
 const f=await fixture();f.token=await token({...claims(),scope:'drafts:write experiments:read'});assert.equal((await validateMcpAccessToken(f)).signatureVerified,true);
});
test('expired, future, too-old and excessive-lifetime claims are refused without clock tolerance',async()=>{
 for(const patch of [{exp:now},{exp:now-1},{nbf:now+1},{iat:now+1,nbf:now+1},{iat:now-601,nbf:now-601,exp:now+1},{exp:now+601},{nbf:now-6},{exp:now-5},{exp:now+0.5},{iat:-1},{nbf:'now'}]){
  const f=await fixture();f.token=await token({...claims(),...patch});await assert.rejects(validateMcpAccessToken(f),error=>error instanceof McpConnectionError&&['MCP_AUTH_TOKEN_TIME','MCP_AUTH_NUMBER'].includes(error.code));
 }
 const old=await fixture();old.policy.maxTokenAgeSeconds=60;old.token=await token({...claims(),iat:now-61,nbf:now-61,exp:now+100});await assert.rejects(validateMcpAccessToken(old),code('MCP_AUTH_TOKEN_TIME'));
 const f=await fixture();f.nowMs=(now+300)*1000;f.revocation.issuedAtMs=f.nowMs-1000;f.revocation.validUntilMs=f.nowMs+59000;repin(f);await assert.rejects(validateMcpAccessToken(f),code('MCP_AUTH_TOKEN_TIME'));
});
test('every profile claim is required and unknown claims fail closed',async()=>{
 for(const field of Object.keys(claims())){const f=await fixture(),payload=claims();delete payload[field];f.token=await token(payload);await assert.rejects(validateMcpAccessToken(f),code('MCP_AUTH_CLAIM_FIELDS'));}
 const f=await fixture();f.token=await token({...claims(),unknown:'DO_NOT_ECHO'});await assert.rejects(validateMcpAccessToken(f),code('MCP_AUTH_CLAIM_FIELDS'));
});
test('revoked token, user or key fails on the next validation with current policy and snapshot',async()=>{
 for(const [field,value]of [['revokedTokenIds',claims().jti],['revokedSubjects',claims().sub],['revokedKeyIds','test-key']]){
  const f=await fixture();await validateMcpAccessToken(f);const old=copy(f.revocation);f.revocation.revocationEpoch=2;f.revocation[field].push(value);repin(f);
  await assert.rejects(validateMcpAccessToken(f),code('MCP_AUTH_REVOKED'));
  await assert.rejects(validateMcpAccessToken({...f,revocation:old}),code('MCP_AUTH_REVOCATION_REVISION'));
 }
});
test('stale, missing, future, wrong-identity, wrong-epoch and unpinned snapshots fail closed',async()=>{
 for(const change of [f=>f.revocation.issuedAtMs=nowMs-61000,f=>f.revocation.validUntilMs=nowMs,f=>f.revocation.issuedAtMs=nowMs+1,f=>f.revocation.validUntilMs=nowMs+61000]){
  const f=await fixture();change(f);repin(f);await assert.rejects(validateMcpAccessToken(f),code('MCP_AUTH_REVOCATION_STALE'));
 }
 for(const change of [f=>f.revocation.subject='miki@example.test',f=>f.revocation.issuer='https://other.example.test/',f=>f.revocation.bindingRevision='sha256:'+'0'.repeat(64)]){
  const f=await fixture();change(f);repin(f);await assert.rejects(validateMcpAccessToken(f),code('MCP_AUTH_BINDING_MISMATCH'));
 }
 const unpinned=await fixture();unpinned.revocation.revokedTokenIds.push('new-id');await assert.rejects(validateMcpAccessToken(unpinned),code('MCP_AUTH_REVOCATION_REVISION'));
 const epoch=await fixture();epoch.policy.revocationEpoch=9;await assert.rejects(validateMcpAccessToken(epoch),code('MCP_AUTH_REVOCATION_REVISION'));
 const missing=await fixture();delete missing.revocation;await assert.rejects(validateMcpAccessToken(missing),code('MCP_AUTH_INPUT'));
});
test('binding changes and policy issuer, audience or revision mismatches fail before key validation',async()=>{
 for(const change of [f=>f.binding.transport.endpoint='https://other.example.test/mcp',f=>f.policy.issuer='https://other.example.test/',f=>f.policy.audience='https://other.example.test/',f=>f.policy.bindingRevision='sha256:'+'0'.repeat(64)]){
  const f=await fixture();change(f);await assert.rejects(validateMcpAccessToken(f),code('MCP_AUTH_BINDING_MISMATCH'));
 }
 const f=await fixture();f.binding.transport.auth={kind:'none'};await assert.rejects(validateMcpAccessToken(f),code('MCP_AUTH_OAUTH_BINDING_REQUIRED'));
});
test('bad signatures, wrong key and unknown kid fail without diagnostics from jose',async()=>{
 const f=await fixture(),parts=f.token.split('.'),sig=Buffer.from(parts[2],'base64url');sig[0]^=1;parts[2]=sig.toString('base64url');
 await assert.rejects(validateMcpAccessToken({...f,token:parts.join('.')}),code('MCP_AUTH_SIGNATURE'));
 await assert.rejects(validateMcpAccessToken({...f,token:await token(claims(),{alg:'RS256',typ:'at+jwt',kid:'test-key'},await otherKeys)}),code('MCP_AUTH_SIGNATURE'));
 await assert.rejects(validateMcpAccessToken({...f,token:await token(claims(),{alg:'RS256',typ:'at+jwt',kid:'unknown'})}),code('MCP_AUTH_KEY_UNKNOWN'));
});
test('only RS256 and exact at+jwt with kid are accepted; remote-key and extension headers are refused',async()=>{
 for(const patch of [{alg:'none'},{alg:'HS256'},{alg:'RS512'},{typ:'JWT'},{typ:'application/at+jwt'},{typ:'AT+JWT'}]){
  const f=await fixture();f.token=rawToken(JSON.stringify({alg:'RS256',typ:'at+jwt',kid:'test-key',...patch}),JSON.stringify(claims()));await assert.rejects(validateMcpAccessToken(f),code('MCP_AUTH_HEADER_PROFILE'));
 }
 for(const [field,value]of [['jku','https://private.example.test/keys'],['x5u','https://private.example.test/cert'],['crit',['b64']],['b64',false],['jwk',{}],['secret','DO_NOT_ECHO']]){
  const f=await fixture();f.token=rawToken(JSON.stringify({alg:'RS256',typ:'at+jwt',kid:'test-key',[field]:value}),JSON.stringify(claims()));await assert.rejects(validateMcpAccessToken(f),code('MCP_AUTH_HEADER_FIELDS'));
 }
 const f=await fixture();f.token=rawToken(JSON.stringify({alg:'RS256',typ:'at+jwt'}),JSON.stringify(claims()));await assert.rejects(validateMcpAccessToken(f),code('MCP_AUTH_HEADER_FIELDS'));
});
test('duplicate JSON keys including escaped spellings are rejected before signature handling',async()=>{
 const header='{"alg":"RS256","typ":"at+jwt","kid":"test-key"}',payload=JSON.stringify(claims());
 for(const [h,p]of [[header.slice(0,-1)+',"alg":"RS256"}',payload],[header,payload.slice(0,-1)+',"scope":"DO_NOT_ECHO"}'],[header,payload.slice(0,-1)+',"\\u0073ub":"coda@example.test"}']]){
  const f=await fixture();f.token=rawToken(h,p);await assert.rejects(validateMcpAccessToken(f),code('MCP_AUTH_TOKEN_JSON'));
 }
});
test('malformed compact encoding, UTF8, size and depth bounds are refused',async()=>{
 const f=await fixture(),parts=f.token.split('.');
 for(const token of ['',f.token+'.extra',parts.slice(0,2).join('.'),parts[0]+'=.'+parts.slice(1).join('.'),' '+f.token,parts[0]+'.'+Buffer.from([255]).toString('base64url')+'.'+parts[2],rawToken('x'.repeat(3000),JSON.stringify(claims())),'x'.repeat(17000)])await assert.rejects(validateMcpAccessToken({...f,token}),McpConnectionError);
 const deep='['.repeat(60)+'0'+']'.repeat(60);await assert.rejects(validateMcpAccessToken({...f,token:rawToken(JSON.stringify({alg:'RS256',typ:'at+jwt',kid:'test-key'}),deep)}),code('MCP_AUTH_TOKEN_JSON'));
});
test('private, symmetric, short, huge, duplicate and malformed public keys are refused',async()=>{
 for(const field of ['d','p','q','dp','dq','qi','k','secret','x5u']){const f=await fixture();f.policy.publicKeys[0][field]='DO_NOT_ECHO';await assert.rejects(validateMcpAccessToken(f),code('MCP_AUTH_KEY_FIELDS'));}
 for(const change of [k=>k.kty='oct',k=>k.alg='HS256',k=>k.use='enc',k=>k.n=Buffer.alloc(128,255).toString('base64url'),k=>k.n=Buffer.alloc(1024,255).toString('base64url'),k=>k.n='AA'+k.n,k=>k.e=Buffer.from([2]).toString('base64url'),k=>k.e='AAEAAQ',k=>k.n+='=']){
  const f=await fixture();change(f.policy.publicKeys[0]);await assert.rejects(validateMcpAccessToken(f),McpConnectionError);
 }
 const f=await fixture();f.policy.publicKeys.push(copy(f.policy.publicKeys[0]));await assert.rejects(validateMcpAccessToken(f),code('MCP_AUTH_DUPLICATE_KEY'));
});
test('closed policy and revocation schemas reject unknown fields and excessive lists or budgets',async()=>{
 for(const change of [f=>f.policy.secret='DO_NOT_ECHO',f=>f.revocation.extra='DO_NOT_ECHO',f=>f.policy.maxTokenLifetimeSeconds=3601,f=>f.policy.maxRevocationAgeSeconds=301,f=>f.policy.publicKeys=Array(9).fill(f.policy.publicKeys[0]),f=>f.revocation.revokedTokenIds=Array.from({length:257},(_,i)=>`id-${i}`)]){
  const f=await fixture();change(f);await assert.rejects(validateMcpAccessToken(f),McpConnectionError);
 }
});
test('input getters and serialization hooks stay inert and caller mutation cannot change captured validation',async()=>{
 let reads=0;const f=await fixture(),getter={...f};Object.defineProperty(getter,'token',{enumerable:true,get(){reads++;return f.token;}});
 await assert.rejects(validateMcpAccessToken(getter),code('MCP_AUTH_INPUT'));
 const hook=copy(f);hook.policy.publicKeys[0].toJSON=()=>{reads++;return {};};await assert.rejects(validateMcpAccessToken(hook),code('MCP_AUTH_INPUT'));assert.equal(reads,0);
 const subject=f.policy.subject,revision=f.policy.revocationRevision,pending=validateMcpAccessToken(f);f.token='changed';f.policy.subject='changed';f.policy.publicKeys[0].n='changed';f.revocation.revokedSubjects.push(subject);
 const receipt=await pending;assert.equal(receipt.subject,subject);assert.equal(receipt.revocationRevision,revision);
});
test('validation reaches no process, file, network or secret resolution APIs',async()=>{
 const f=await fixture(),modules=await Promise.all([import('node:child_process'),import('node:http'),import('node:https'),import('node:net')]);
 const changed=[],oldFetch=globalThis.fetch;let effects=0;const deny=()=>{effects++;throw Error('Unexpected external effect');};
 for(const [module,names]of [[modules[0].default,['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']],[modules[1].default,['request','get']],[modules[2].default,['request','get']],[modules[3].default,['connect','createConnection']],[fs,['open','openSync','readFile','readFileSync','writeFile','writeFileSync']],[fsp,['open','readFile','writeFile']]])for(const name of names){changed.push([module,name,module[name]]);module[name]=deny;}
 globalThis.fetch=deny;syncBuiltinESMExports();
 try{assert.equal((await validateMcpAccessToken(f)).signatureVerified,true);assert.equal(effects,0);}finally{for(const [module,name,original]of changed)module[name]=original;globalThis.fetch=oldFetch;syncBuiltinESMExports();}
});
