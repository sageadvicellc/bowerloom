import { randomUUID } from 'node:crypto';
import type { AccountObservation, UsageWindow } from '../../admission/src/types.js';
import { AdapterError, check, finite, id, object, sha, time } from './safe.js';
import { CONTROLS, INPUT_KEYS, ROUTE_KEYS, MODEL_ROUTE, LIMITS } from './policy.js';
import type { AccountBinding } from './types.js';
export function accountBindingDigest(providerAccountId:string):string {
  check(typeof providerAccountId==='string'&&providerAccountId.length>0&&providerAccountId.length<=512,'ACCOUNT_ID_UNAVAILABLE');
  return sha('codex-chatgpt-account:v1\0'+providerAccountId);
}
export function bindingCopy(input:AccountBinding):AccountBinding {
  const value=structuredClone(input);id(value.canonicalAccountId);
  check(Array.isArray(value.aliases)&&value.aliases.length>0&&value.aliases.length<=16,'ALIASES');value.aliases.forEach(id);
  check(new Set(value.aliases).size===value.aliases.length&&/^[a-f0-9]{64}$/.test(value.providerAccountSha256),'ACCOUNT_BINDING');
  check(Array.isArray(value.requiredWindows)&&Array.isArray(value.optionalWindows)&&value.requiredWindows.length>0,'WINDOW_BINDING');
  const all=[...value.requiredWindows,...value.optionalWindows];
  check(all.length===2&&new Set(all).size===2&&all.every(v=>v==='primary'||v==='secondary'),'WINDOW_BINDING');return value;
}
const active=(v:unknown)=>v!==undefined&&v!==null&&v!==''&&(!Array.isArray(v)||v.length>0)&&(typeof v!=='object'||Array.isArray(v)||Object.keys(v).length>0);
export function verifyProvenance(body:unknown,requirementsBody:unknown):void {
  const b=object(body),cfg=object(b.config),features=object(cfg.features);
  check(cfg.model_provider==='openai'&&cfg.forced_login_method==='chatgpt'&&cfg.suppress_unstable_features_warning===true,'ROUTE_OR_NOTICE_POLICY');
  const disabled=CONTROLS.flatMap((v,i)=>v==='--disable'?[CONTROLS[i+1]!]:[]);
  check(disabled.every(k=>k==='unified_exec'||features[k]===false)&&features.skip_host_skill_discovery===true,'FEATURE_POLICY');
  check(Array.isArray(b.layers)&&b.layers.length>0&&b.layers.length<=32,'CONFIG_PROVENANCE');
  for(const entry of b.layers){const layer=object(entry),kind=object(layer.name).type,values=object(layer.config);
    check(['sessionFlags','user','system','packagedDefaults','project','mdm','enterpriseManaged','legacyManagedConfigTomlFromFile','legacyManagedConfigTomlFromMdm'].includes(kind),'UNKNOWN_CONFIG_SOURCE');
    if(kind!=='user')check([...ROUTE_KEYS,...INPUT_KEYS,'mcp_servers'].every(k=>!active(values[k])),'NON_USER_AMBIENT_INPUT');
  }
  check(!active((cfg.model_providers??{}).openai)&&!active(cfg.model_catalog_json)&&!active(cfg.forced_chatgpt_workspace_id),'CUSTOM_PROVIDER_OR_CATALOG');
  check([undefined,null,'','https://api.openai.com/v1'].includes(cfg.openai_base_url),'CUSTOM_ENDPOINT');
  check([undefined,null,'','https://chatgpt.com/backend-api','https://chatgpt.com/backend-api/'].includes(cfg.chatgpt_base_url),'CUSTOM_ENDPOINT');
  const req=object(requirementsBody).requirements;if(req===null||req===undefined)return;const r=object(req);
  check([undefined,null,'openai'].includes(r.modelProvider)&&!active(r.modelProviders),'MANAGED_PROVIDER');
  check([undefined,null,'','https://chatgpt.com/backend-api','https://chatgpt.com/backend-api/'].includes(r.chatgptBaseUrl),'MANAGED_ENDPOINT');
  check(['additionalDeveloperInstructions','modelCatalogJson','models','hooks'].every(k=>!active(r[k])),'MANAGED_INPUT');
  check(r.allowedLoginMethods==null||JSON.stringify(r.allowedLoginMethods)==='["chatgpt"]','MANAGED_LOGIN');
  const managed=object(r.featureRequirements??{});
  check(Object.entries(managed).every(([k,v])=>v===false||(['unified_exec','skip_host_skill_discovery'].includes(k)&&v===true))&&managed.skip_host_skill_discovery!==false,'MANAGED_FEATURE');
}
export function verifyModel(body:unknown):void {
  const b=object(body);check(b.nextCursor==null&&Array.isArray(b.data)&&b.data.length>0&&b.data.length<=100,'MODEL_CATALOG');
  const candidates=b.data.filter((m:unknown)=>object(m).model==='gpt-5.5');check(candidates.length===1,'MODEL_UNAVAILABLE');
  const m=object(candidates[0]);check(m.hidden===false&&Array.isArray(m.supportedReasoningEfforts)&&m.supportedReasoningEfforts.some((e:unknown)=>object(e).reasoningEffort==='low')&&!active(m.availabilityNux),'MODEL_CAPABILITY');
}
export function supportedSubscriptionPlan(value:unknown):value is 'pro'|'promax' {return value==='pro'||value==='promax';}
export function observationFromResponses(accountBody:unknown,usageBody:unknown,binding:AccountBinding,startedAtMs:number,nowMs:number):AccountObservation {
  const b=bindingCopy(binding);check(time(startedAtMs)&&time(nowMs)&&nowMs>=startedAtMs&&nowMs-startedAtMs<=LIMITS.observationAgeMs,'STALE_OBSERVATION');
  const accountResponse=object(accountBody),account=object(accountResponse.account),usage=object(usageBody);
  check(account.type==='chatgpt'&&supportedSubscriptionPlan(account.planType),'SUBSCRIPTION_REQUIRED');
  check(accountBindingDigest(usage.accountId)===b.providerAccountSha256,'ACCOUNT_MISMATCH');
  if(accountResponse.workspaceRouting!=null){const route=object(accountResponse.workspaceRouting);
    check(accountBindingDigest(route.chatgptAccountId)===b.providerAccountSha256,'ACCOUNT_MISMATCH');
    check(['https://chatgpt.com','https://chatgpt.com/','https://chatgpt.com/backend-api','https://chatgpt.com/backend-api/'].includes(route.backendOrigin),'AUTHENTICATED_ENDPOINT');
  }
  check(usage.ordinaryUsageAllowed===true,'ORDINARY_USAGE_UNKNOWN_OR_DENIED');
  const buckets=object(usage.rateLimitsByLimitId);check(Object.keys(buckets).length===1&&Object.hasOwn(buckets,'codex'),'UNKNOWN_USAGE_BUCKETS');
  const bucket=object(buckets.codex);check(bucket.planType===account.planType&&bucket.rateLimitReachedType===null&&bucket.spendControlReached===false,'USAGE_RESTRICTED_OR_UNKNOWN');
  const windows:Record<string,UsageWindow|null>={};
  for(const name of ['primary','secondary'] as const){const raw=bucket[name];
    if(raw==null){check(b.optionalWindows.includes(name),'REQUIRED_WINDOW_UNAVAILABLE');windows[name]=null;continue;}
    const w=object(raw);check(finite(w.usedPercent)&&w.usedPercent>=0&&w.usedPercent<=100,'INVALID_USED_PERCENT');
    check(finite(w.windowDurationMins)&&w.windowDurationMins>0&&Number.isSafeInteger(w.windowDurationMins*60000),'INVALID_WINDOW_DURATION');
    check(time(w.resetsAt)&&Number.isSafeInteger(w.resetsAt*1000)&&w.resetsAt*1000>nowMs,'INVALID_OR_EXPIRED_RESET');
    windows[name]={usedPercent:w.usedPercent,durationMs:w.windowDurationMins*60000,resetAtMs:w.resetsAt*1000,accountedThroughMs:null};
  }
  return {observationId:randomUUID(),accountId:b.canonicalAccountId,observedAtMs:nowMs,authentication:'subscription',ordinaryUsageAllowed:true,
    windows,routes:{[MODEL_ROUTE]:{requiredWindows:b.requiredWindows,optionalWindows:b.optionalWindows}}};
}
export function capacityCeiling(value:number=75):number {
  check(Number.isFinite(value)&&value>10&&value<=95,'CAPACITY_POLICY');return value;
}
export function provisionalMargin(value:number=10):number {
  check(Number.isFinite(value)&&value>=2&&value<=10,'CAPACITY_POLICY');return value;
}
export function requireHeadroom(observation:AccountObservation,stopUsedPercent:number=75,provisionalPercent:number=10):void {
  const ceiling=capacityCeiling(stopUsedPercent),margin=provisionalMargin(provisionalPercent);
  check(Object.values(observation.windows).every(w=>w===null||w.usedPercent+margin<ceiling),'RESERVE_AND_PROVISIONAL_HOLD');
}
export function sanitized(error:unknown):AdapterError {return error instanceof AdapterError?error:new AdapterError('ADAPTER_FAILURE');}
