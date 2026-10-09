// Normalized evidence contract ONLY; deliberately not a vendor wire/JSON decoder or qualification.
import { MODEL,NATIVE_VERSION,route,effort,inert,exact,demand,hex,digest } from './policy.js';
/** A trusted later response reader must bind effective evidence to the response bytes.
 * Local selection alone and a requested CLI flag are never effective provider evidence.
 * Refusal never refunds a request; existing admission owns every retained charge.
 */
export function validateResponseEvidence(value:unknown,expected:unknown):any {
  const v=inert(value),e=inert(expected);
  exact(e,['requestedRoute','requestRevision','responseEvidenceSha256','parentOutputRevision']);const r=route(e.requestedRoute);
  demand(hex(e.requestRevision)&&hex(e.responseEvidenceSha256)&&(effort(r)==='high'?e.parentOutputRevision===null:hex(e.parentOutputRevision)),'PROTOCOL');
  exact(v,['format','requestedRoute','requestRevision','responseEvidenceSha256','localSelection','effective','toolEvents','output']);
  demand(v.format==='bowerloom/claude-response-evidence/v1'&&v.requestedRoute===r&&v.requestRevision===e.requestRevision&&v.responseEvidenceSha256===e.responseEvidenceSha256,'PROTOCOL');
  exact(v.localSelection,['model','effort','nativeVersion']);
  demand(v.localSelection.model===MODEL&&v.localSelection.effort===effort(r)&&v.localSelection.nativeVersion===NATIVE_VERSION,'LOCAL_SELECTION');
  demand(v.effective!==null,'EFFECTIVE_EVIDENCE');exact(v.effective,['model','effort','evidenceSha256'],'EFFECTIVE_EVIDENCE');
  demand(typeof v.effective.model==='string'&&typeof v.effective.effort==='string'&&hex(v.effective.evidenceSha256),'EFFECTIVE_EVIDENCE');
  demand(v.effective.model===MODEL&&v.effective.effort===effort(r),'RESPONSE_ROUTE');
  demand(Array.isArray(v.toolEvents)&&v.toolEvents.length===0,'PROTOCOL');
  if(effort(r)==='high') {
    exact(v.output,['kind','workerRole','task','requestedOutput']);
    demand(v.output.kind==='delegation-proposal'&&v.output.workerRole==='knowledge-library','PROTOCOL');
    for(const key of ['task','requestedOutput'])demand(typeof v.output[key]==='string'&&v.output[key].length>0&&Buffer.byteLength(v.output[key])<=4096,'PROTOCOL');
  } else {
    exact(v.output,['kind','parentOutputRevision','text']);
    demand(v.output.kind==='worker-result'&&v.output.parentOutputRevision===e.parentOutputRevision&&typeof v.output.text==='string'&&v.output.text.length>0&&Buffer.byteLength(v.output.text)<=16384,'PROTOCOL');
  }
  return inert({evidence:v,revision:digest(v),effectiveRoute:r,originIndependentlyVerified:false,retainedChargesMustRemain:true,qualificationAccepted:false,executionAuthorized:false});
}
