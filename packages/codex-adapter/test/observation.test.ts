import test from 'node:test';
import assert from 'node:assert/strict';
import { accountBindingDigest,bindingCopy,observationFromResponses,requireHeadroom,verifyModel,verifyProvenance } from '../src/observation.js';
import { CONTROLS,MODEL_ROUTE } from '../src/policy.js';
import { strictJson } from '../src/safe.js';
import type { AccountBinding } from '../src/types.js';
const now=1900000000000;
const binding:AccountBinding={canonicalAccountId:'canonical-synthetic',aliases:['synthetic'],providerAccountSha256:accountBindingDigest('provider-synthetic'),requiredWindows:['primary'],optionalWindows:['secondary']};
function fixture(){return {account:{account:{type:'chatgpt',planType:'pro',email:'never-retain@example.invalid'},workspaceRouting:null},usage:{accountId:'provider-synthetic',ordinaryUsageAllowed:true,
  rateLimitsByLimitId:{codex:{planType:'pro',spendControlReached:false,rateLimitReachedType:null,primary:{usedPercent:50,windowDurationMins:10080,resetsAt:now/1000+3600},secondary:null}}}};}
const observe=(f=fixture(),b=binding,start=now-10,end=now)=>observationFromResponses(f.account,f.usage,b,start,end);
test('authenticated canonical binding retains no provider identity and never invents accountedThrough',()=>{
  const out=observe();assert.equal(out.accountId,'canonical-synthetic');assert.equal(out.authentication,'subscription');assert.equal(out.windows.primary?.accountedThroughMs,null);
  assert.equal(out.windows.secondary,null);assert.deepEqual(out.routes[MODEL_ROUTE],{requiredWindows:['primary'],optionalWindows:['secondary']});
  assert.doesNotMatch(JSON.stringify(out),/provider-synthetic|never-retain/);
});
test('alias registry is explicit, copied and windows are fully classified',()=>{
  const copy=bindingCopy(binding);copy.aliases.push('new');assert.equal(binding.aliases.length,1);
  for(const b of [{...binding,requiredWindows:[]},{...binding,optionalWindows:[]},{...binding,aliases:['x','x']},{...binding,providerAccountSha256:'not-a-digest'}])assert.throws(()=>bindingCopy(b as AccountBinding));
});
test('changed account, API auth, unknown ordinary eligibility, and unknown buckets deny',()=>{
  const cases=Array.from({length:7},fixture);cases[0]!.usage.accountId='other';cases[1]!.account.account.type='apiKey';cases[2]!.account.account.planType='unknown';cases[3]!.usage.ordinaryUsageAllowed=false;
  delete (cases[4]!.usage as any).ordinaryUsageAllowed;(cases[5]!.usage.rateLimitsByLimitId as any).unknown={};delete (cases[6]!.usage as any).rateLimitsByLimitId;
  for(const f of cases)assert.throws(()=>observe(f));
});
test('required missing, malformed optional, expired and unbounded windows deny',()=>{
  const variants:unknown[]=[null,{usedPercent:NaN,windowDurationMins:1,resetsAt:now/1000+1},{usedPercent:50,windowDurationMins:0,resetsAt:now/1000+1},{usedPercent:50,windowDurationMins:Infinity,resetsAt:now/1000+1},{usedPercent:50,windowDurationMins:1,resetsAt:now/1000},{usedPercent:'50',windowDurationMins:1,resetsAt:now/1000+1},{usedPercent:50,windowDurationMins:1,resetsAt:now/1000+.5}];
  for(const w of variants){const f=fixture();(f.usage.rateLimitsByLimitId.codex as any).primary=w;assert.throws(()=>observe(f));}
  const f=fixture();(f.usage.rateLimitsByLimitId.codex as any).secondary={usedPercent:0};assert.throws(()=>observe(f));
});
test('stale, future and malformed observation timing denies',()=>{
  for(const [start,end] of [[now-30001,now],[now+1,now],[NaN,now],[now,Infinity]])assert.throws(()=>observe(fixture(),binding,start,end));
});
test('headroom is conservative and optional reported usage counts',()=>{
  for(const used of [64,65,75,100]){const f=fixture();f.usage.rateLimitsByLimitId.codex.primary.usedPercent=used;const out=observe(f);if(used<65)requireHeadroom(out);else assert.throws(()=>requireHeadroom(out));}
  const f=fixture();(f.usage.rateLimitsByLimitId.codex as any).secondary={...f.usage.rateLimitsByLimitId.codex.primary,usedPercent:80};assert.throws(()=>requireHeadroom(observe(f)));
});
function config(){return {config:{model_provider:'openai',forced_login_method:'chatgpt',suppress_unstable_features_warning:true,
  features:Object.fromEntries([...CONTROLS.flatMap((v,i)=>v==='--disable'?[[CONTROLS[i+1],false]]:[]),['skip_host_skill_discovery',true]])},
  layers:[{name:{type:'sessionFlags'},config:{}},{name:{type:'user'},config:{mcp_servers:{synthetic:{}}}},{name:{type:'system'},config:{}}]};}
test('configuration provenance refuses non-user injection and unexpected features',()=>{
  verifyProvenance(config(),{requirements:null});
  const c=config();c.layers[2]!.config={mcp_servers:{synthetic:{}}};assert.throws(()=>verifyProvenance(c,{requirements:null}));
  const d=config();d.config.features.plugins=true;assert.throws(()=>verifyProvenance(d,{requirements:null}));
  for(const r of [{modelProvider:'other'},{additionalDeveloperInstructions:'SECRET'},{featureRequirements:{plugins:true}},{allowedLoginMethods:['apiKey']}])assert.throws(()=>verifyProvenance(config(),{requirements:r}));
});
test('model route has no fallback and low effort is explicit',()=>{
  const m={model:'gpt-5.5',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'low'}],availabilityNux:null};verifyModel({nextCursor:null,data:[m]});
  for(const value of [{nextCursor:'more',data:[m]},{data:[{...m,model:'other'}]},{data:[{...m,supportedReasoningEfforts:[]}]},{data:[m,m]},{data:[{...m,availabilityNux:{}} ,{...m}]}])assert.throws(()=>verifyModel(value));
});
test('strict parser rejects duplicate, nonfinite, trailing and deeply nested data',()=>{
  assert.equal((strictJson('{"a":[1,true,null,"ok"]}') as any).a[0],1);
  for(const s of ['{"a":1,"a":2}','{"a":1e999}','[1,]','{} false','['.repeat(60)+'0'+']'.repeat(60)])assert.throws(()=>strictJson(s));
});

test('no-thread authenticated workflow only uses the seven reviewed RPC method types',async()=>{
  const {readAuthenticatedObservation}=await import('../src/reader.js');const f=fixture();const methods:string[]=[];let notifications=0;
  const rpc=async(method:string,params:unknown)=>{methods.push(method);
    switch(method){case 'initialize':return {};case 'config/read':return config();case 'configRequirements/read':return {requirements:null};case 'environment/status':return {status:'unknown'};
      case 'account/read':assert.deepEqual(params,{refreshToken:false});return f.account;
      case 'model/list':return {data:[{model:'gpt-5.5',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'low'}],availabilityNux:null}],nextCursor:null};
      case 'account/rateLimits/read':return f.usage;default:assert.fail('Unexpected RPC');}
  };
  const out=await readAuthenticatedObservation(rpc,()=>notifications++,binding,'/synthetic-owned',now-10,()=>now);
  assert.equal(out.accountId,binding.canonicalAccountId);assert.equal(notifications,1);
  assert.deepEqual(methods,['initialize','config/read','configRequirements/read','environment/status','environment/status','account/read','model/list','account/rateLimits/read']);
  assert.ok(methods.every(m=>!m.startsWith('thread/')&&!m.startsWith('turn/')&&!m.startsWith('fs/')&&!m.includes('token')));
});
test('no-thread workflow denies an available environment before auth/model reads',async()=>{
  const {readAuthenticatedObservation}=await import('../src/reader.js');const methods:string[]=[];
  await assert.rejects(readAuthenticatedObservation(async method=>{methods.push(method);if(method==='initialize')return {};if(method==='config/read')return config();if(method==='configRequirements/read')return {requirements:null};return {status:'ready'};},()=>{},binding,'/synthetic-owned',now,()=>now));
  assert.ok(!methods.includes('account/read'));assert.ok(!methods.includes('model/list'));
});
test('malformed eligibility, unknown spend control, and workspace routing mismatch deny',()=>{
  for(const key of ['ordinaryUsageAllowed','accountId']){const f=fixture();(f.usage as any)[key]=null;assert.throws(()=>observe(f));}
  for(const [key,value] of [['rateLimitReachedType',false],['spendControlReached',undefined],['spendControlReached',true]]){const f=fixture();(f.usage.rateLimitsByLimitId.codex as any)[key as string]=value;assert.throws(()=>observe(f));}
  const f=fixture();(f.account as any).workspaceRouting={chatgptAccountId:'other',backendOrigin:'https://chatgpt.com'};assert.throws(()=>observe(f));
  assert.throws(()=>strictJson('"\\ud800"'));
});
