// Separate limited claim. Requested effort is retained, never promoted to effective effort.
import { MODEL,NATIVE_VERSION,route,effort,inert,exact,demand,hex,id,digest } from './policy.js';
import { LIMITED_POLICY,LIMITED_PROFILE_REVISION } from './limited-policy.js';
export function validateLimitedResponse(value:unknown,expected:unknown):any{
 const v=inert(value),e=inert(expected);exact(e,['requestedRoute','requestRevision','parentOutputRevision','launchPlanRevision','qualificationRevision','ownerApprovalRevision']);const r=route(e.requestedRoute);
 for(const k of ['requestRevision','launchPlanRevision','qualificationRevision','ownerApprovalRevision'])demand(hex(e[k]),'PROTOCOL');demand(effort(r)==='high'?e.parentOutputRevision===null:hex(e.parentOutputRevision),'PROTOCOL');
 exact(v,['format','policyVersion','requestedRoute','requestRevision','parentOutputRevision','launchPlanRevision','qualificationRevision','ownerApprovalRevision','wireProfileRevision','requested','provider','output','appliedEffort','strictPolicyAccepted','ordinaryQualification','retainedChargesMustRemain','revision']);
 const {revision,...body}=v;demand(hex(revision)&&digest(body)===revision&&v.format==='bowerloom/claude-limited-response/v1'&&v.policyVersion===LIMITED_POLICY&&v.wireProfileRevision===LIMITED_PROFILE_REVISION,'PROTOCOL');
 for(const k of Object.keys(e))demand(v[k]===e[k],'PROTOCOL');
 exact(v.requested,['model','effort','nativeVersion']);demand(v.requested.model===MODEL&&v.requested.effort===effort(r)&&v.requested.nativeVersion===NATIVE_VERSION,'LOCAL_SELECTION');
 exact(v.provider,['model','sessionId','messageId','requestId','responseEvidenceSha256']);demand(v.provider.model===MODEL,'RESPONSE_ROUTE');for(const k of ['sessionId','messageId','requestId'])demand(id(v.provider[k]),'PROTOCOL');demand(hex(v.provider.responseEvidenceSha256),'PROTOCOL');
 demand(v.appliedEffort==='unknown'&&v.strictPolicyAccepted===false&&v.ordinaryQualification===false&&v.retainedChargesMustRemain===true,'PROTOCOL');
 if(effort(r)==='high'){exact(v.output,['kind','workerRole','task','requestedOutput']);demand(v.output.kind==='delegation-proposal'&&v.output.workerRole==='knowledge-library','PROTOCOL');for(const k of ['task','requestedOutput'])demand(typeof v.output[k]==='string'&&v.output[k].length>0&&Buffer.byteLength(v.output[k])<=4096,'PROTOCOL');}
 else{exact(v.output,['kind','parentOutputRevision','text']);demand(v.output.kind==='worker-result'&&v.output.parentOutputRevision===e.parentOutputRevision&&typeof v.output.text==='string'&&v.output.text.length>0&&Buffer.byteLength(v.output.text)<=16384,'PROTOCOL');}return v;
}
