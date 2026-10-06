import test from 'node:test';
import assert from 'node:assert/strict';
import { accountBindingDigest,bindingCopy,observationFromResponses,requireHeadroom,capacityCeiling,provisionalMargin,verifyModel,verifyProvenance } from '../src/observation.js';
import { CONTROLS,MODEL_ROUTE,MODEL,EFFORT } from '../src/policy.js';
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
test('selected Sol route is exact and does not follow catalog default or other eligible revisions',()=>{
  assert.equal(MODEL,'gpt-6-sol');assert.equal(MODEL_ROUTE,'codex:gpt-6-sol:low');assert.equal(EFFORT,'low');
  const chosen={model:MODEL,hidden:false,supportedReasoningEfforts:[{reasoningEffort:EFFORT}],availabilityNux:null};
  const other={...chosen,model:'gpt-5.6-sol'},blockedDefault={...chosen,model:'gpt-6.1-sol',isDefault:true,availabilityNux:{}};
  verifyModel({nextCursor:null,data:[blockedDefault,other,chosen]});
  for(const model of ['gpt-5.5','gpt-5.6-sol','gpt-6.1-sol','gpt-6-astra'])
    assert.throws(()=>verifyModel({nextCursor:null,data:[{...chosen,model}]}),{code:'MODEL_UNAVAILABLE'});
  for(const value of [
    {nextCursor:'more',data:[chosen]}, {nextCursor:null,data:[]}, {nextCursor:null,data:[chosen,chosen]},
    {nextCursor:null,data:[{...chosen,hidden:true}]}, {nextCursor:null,data:[{...chosen,supportedReasoningEfforts:[{reasoningEffort:'medium'}]}]},
    ...['notice',{},false,undefined].map(availabilityNux=>({nextCursor:null,data:[{...chosen,availabilityNux}]})), {nextCursor:null,data:Array(101).fill(other)},
    {nextCursor:null,data:[null]}, {nextCursor:null,data:'invalid'},
  ])assert.throws(()=>verifyModel(value));
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
      case 'model/list':return {data:[{model:MODEL,hidden:false,supportedReasoningEfforts:[{reasoningEffort:'low'}],availabilityNux:null}],nextCursor:null};
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

test('explicit capacity ceiling preserves ten points and the default remains seventy-five',()=>{
  assert.equal(capacityCeiling(),75);
  for(const invalid of [0,10,95.01,100,NaN,Infinity])assert.throws(()=>capacityCeiling(invalid));
  for(const used of [74,84,85,95]){
    const f=fixture();f.usage.rateLimitsByLimitId.codex.primary.usedPercent=used;
    const out=observe(f);
    assert.throws(()=>requireHeadroom(out));
    if(used<85)requireHeadroom(out,95);else assert.throws(()=>requireHeadroom(out,95));
  }
  const f=fixture();(f.usage.rateLimitsByLimitId.codex as any).secondary={...f.usage.rateLimitsByLimitId.codex.primary,usedPercent:85};
  assert.throws(()=>requireHeadroom(observe(f),95));
});
test('invalid observer ceiling is refused before any native request',async()=>{
  const {readAuthenticatedObservation}=await import('../src/reader.js');let calls=0;
  await assert.rejects(readAuthenticatedObservation(async()=>{calls++;return {};},()=>{},binding,'/synthetic',now,()=>now,96));
  assert.equal(calls,0);
});

test('explicit provisional margin changes no default and retains the configured hard stop',()=>{
 for(const bad of [0,1,11,NaN,Infinity])assert.throws(()=>provisionalMargin(bad),{code:'CAPACITY_POLICY'});
 for(const used of [84,85,89.99,90,95]){const f=fixture();f.usage.rateLimitsByLimitId.codex.primary.usedPercent=used;const out=observe(f);
 if(used<90)requireHeadroom(out,95,5);else assert.throws(()=>requireHeadroom(out,95,5),{code:'RESERVE_AND_PROVISIONAL_HOLD'});
 if(used>=85)assert.throws(()=>requireHeadroom(out,95));
 }
});
test('invalid explicit margin fails before authenticated observer RPC',async()=>{
 const {readAuthenticatedObservation}=await import('../src/reader.js');let calls=0;
 await assert.rejects(readAuthenticatedObservation(async()=>{calls++;return {};},()=>{},binding,'/synthetic',now,()=>now,95,1),{code:'CAPACITY_POLICY'});assert.equal(calls,0);
});

test('explicit Pro Max subscription requires matching authenticated account and usage plans',()=>{
  const f=fixture();f.account.account.planType='promax';f.usage.rateLimitsByLimitId.codex.planType='promax';assert.equal(observe(f).authentication,'subscription');
  for(const plan of ['unknown','free','plus','prolite','future','']){const g=fixture();g.account.account.planType=plan;g.usage.rateLimitsByLimitId.codex.planType=plan;assert.throws(()=>observe(g),{code:'SUBSCRIPTION_REQUIRED'});}
  f.usage.rateLimitsByLimitId.codex.planType='pro';assert.throws(()=>observe(f),{code:'USAGE_RESTRICTED_OR_UNKNOWN'});
});
test('only exact supported native version and hash pairs pass',async()=>{
  const {requireNativePin}=await import('../src/installation.js');
  const {SUPPORTED_NATIVE_BINARIES,CODEX_VERSION,SUPPORTED_NATIVE_SHA256}=await import('../src/policy.js');
  const expected={
    '0.157.0':'ad0be20d04e2ba6146ecdb51d7f8b7b0fe15420a15dc9b0057518d858f1f3714',
    '0.159.2':'50ac633af64851511f9bbc71032cdae7f1ba20b3234c189687d61ba846c354c5',
    '0.160.0':'6b582e8813ce7e8ed4c52814ee5cf230dba647bf2292df747a4003f2657ef201',
  };
  assert.deepEqual(SUPPORTED_NATIVE_BINARIES,expected);
  assert.equal(CODEX_VERSION,'0.157.0');assert.equal(SUPPORTED_NATIVE_SHA256,expected['0.157.0']);
  for(const [version,hash] of Object.entries(expected)){
    requireNativePin(version,hash);
    // All six cross-version pairings must refuse, even though each hash is supported elsewhere.
    for(const [otherVersion,otherHash] of Object.entries(expected))if(otherVersion!==version)
      assert.throws(()=>requireNativePin(version,otherHash),{code:'UNSUPPORTED_BINARY'});
    const wrapperHash='50ab38ba21d0d9f8346f32f41848382f15b556190f3c7a07e885a4fb73e379c8';
    for(const wrong of [wrapperHash,(hash[0]==='0'?'1':'0')+hash.slice(1),'changed'])
      assert.throws(()=>requireNativePin(version,wrong),{code:'UNSUPPORTED_BINARY'});
  }
  for(const version of ['0.159.3','0.160.1','constructor'])
    assert.throws(()=>requireNativePin(version,expected['0.160.0']),{code:'UNSUPPORTED_BINARY'});
});
test('valid candidate declaration cannot admit different on-disk native bytes',{
  skip:process.platform!=='darwin'||process.arch!=='arm64'
},async()=>{
  const {mkdtemp,realpath,writeFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {installationChecks}=await import('../src/installation.js');
  const root=await mkdtemp(join(await realpath(tmpdir()),'bowerloom-pin-drift-'));
  try{
    const nativePath=join(root,'native-fixture');await writeFile(nativePath,'synthetic altered bytes; never executed',{mode:0o600});
    const install:import('../src/types.js').Installation={nativePath,nativeSha256:'6b582e8813ce7e8ed4c52814ee5cf230dba647bf2292df747a4003f2657ef201',version:'0.160.0',workRoot:root};
    await assert.rejects(installationChecks(install),{code:'BINARY_CHANGED'});
  }finally{await rm(root,{recursive:true,force:true});}
});
