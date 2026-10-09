// Pure comparison of trusted host measurements. Performs no filesystem reads or software installation.
import { posix } from 'node:path';
import { candidateArgv,CANDIDATE_ENV,SETTINGS_BYTES,MCP_BYTES,LIMITS,NATIVE_VERSION,POLICY_VERSION,route,digest,byteDigest,inert,exact,demand,hex,time,canonical } from './policy.js';
function path(v:unknown):void { demand(typeof v==='string'&&v.length<=512&&v.startsWith('/')&&posix.normalize(v)===v&&!v.includes('\0'),'INSTALLATION'); }
function measurement(value:unknown):any {
  const v=inert(value);exact(v,['format','nativePath','nativeSha256','nativeVersion','artifactRevision','inventory','measuredAtMs']);
  demand(v.format==='bowerloom/claude-measurement/v1','INSTALLATION');path(v.nativePath);
  demand(hex(v.nativeSha256)&&v.nativeVersion===NATIVE_VERSION&&hex(v.artifactRevision)&&time(v.measuredAtMs),'INSTALLATION');
  demand(Array.isArray(v.inventory)&&v.inventory.length>0&&v.inventory.length<=64,'INSTALLATION');
  const seen=new Set<string>();let prior='';
  for(const row of v.inventory) {
    exact(row,['path','sha256','bytes']);demand(typeof row.path==='string'&&/^[A-Za-z0-9_./-]{1,240}$/.test(row.path)&&!row.path.startsWith('/')&&!row.path.split('/').some((x:string)=>!x||x==='.'||x==='..')&&!seen.has(row.path)&&row.path>prior&&hex(row.sha256)&&time(row.bytes)&&row.bytes<=2**24,'INSTALLATION');
    seen.add(row.path);prior=row.path;
  }
  demand(digest(v.inventory)===v.artifactRevision,'INSTALLATION');return v;
}
/** Expected pins must come from independently reviewed host custody, never model/caller assertions. */
export function prepareInstallation(measured:unknown,expected:unknown,request:unknown,nowMs:number):any {
  const m=measurement(measured),e=inert(expected),r=inert(request);
  exact(e,['nativePath','nativeSha256','nativeVersion','artifactRevision']);
  demand(canonical(e)===canonical({nativePath:m.nativePath,nativeSha256:m.nativeSha256,nativeVersion:m.nativeVersion,artifactRevision:m.artifactRevision}),'DRIFT');
  exact(r,['route','promptSchema','prompt','issuedAtMs','expiresAtMs']);const modelRoute=route(r.route);
  demand(r.promptSchema==='bowerloom/claude-finite-request/v1'&&typeof r.prompt==='string'&&r.prompt.length>0&&Buffer.byteLength(r.prompt)<=LIMITS.inputBytes,'INSTALLATION');
  demand(time(nowMs)&&time(r.issuedAtMs)&&time(r.expiresAtMs)&&r.issuedAtMs<=m.measuredAtMs&&m.measuredAtMs<=nowMs&&nowMs-m.measuredAtMs<=LIMITS.observationAgeMs&&nowMs<r.expiresAtMs&&r.expiresAtMs-r.issuedAtMs<=LIMITS.operationMs,'STALE');
  const body={format:'bowerloom/claude-launch-contract/v1',policyVersion:POLICY_VERSION,modelRoute,installation:m,argv:candidateArgv(modelRoute),environment:CANDIDATE_ENV,
    settingsBytes:SETTINGS_BYTES,mcpBytes:MCP_BYTES,promptSchema:r.promptSchema,promptSha256:byteDigest(r.prompt),promptBytes:Buffer.byteLength(r.prompt),issuedAtMs:r.issuedAtMs,expiresAtMs:r.expiresAtMs,limits:LIMITS,
    measurementOriginVerified:false,controlsQualified:false,paidFallback:false,executionAuthorized:false};
  return inert({...body,revision:digest(body)});
}
/** Every compared byte must be remeasured by a later host seam. No remeasure occurs here. */
export function assertSameInstallationPlan(value:unknown,expectedRevision:unknown):void {
  const v=inert(value);demand(v&&typeof v==='object'&&!Array.isArray(v)&&hex(v.revision)&&hex(expectedRevision),'DRIFT');
  const {revision,...body}=v;demand(digest(body)===revision&&revision===expectedRevision,'DRIFT');
}
