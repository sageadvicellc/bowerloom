import { canonicalJson, digest, PLAN_FORMAT, COMPILER_VERSION, validateDefinition, graphOrder } from '../../contracts/src/index.js';
import type { Scope, TaskState, Principal, Receipt } from '../../broker/src/index.js';
import type { RunInput } from '../../runtime/src/types.js';
import { assertPortablePath } from '../../contracts/src/index.js';
import { TestError, CRITERIA } from './types.js';
import type { TestManifest, TestRequest, TestReport, TestRecord, TestEvidence } from './types.js';
export function fail(code:string):never{throw new TestError(code);}
export const same=(a:unknown,b:unknown):boolean=>canonicalJson(a)===canonicalJson(b);
export const sha=(v:unknown):v is string=>typeof v==='string'&&/^sha256:[a-f0-9]{64}$/.test(v);
export const time=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
export const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9@._:-]{0,127}$/.test(v)&&!['constructor','prototype','__proto__'].includes(v);
export const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&same(Object.keys(v).sort(),[...keys].sort());
export function copy<T>(v:T,max=2*1024*1024):T {
  let nodes=0;
  const visit=(value:unknown,depth:number):void=>{
    if(++nodes>100000||depth>40)fail('DATA_LIMIT');
    if(value===null||typeof value==='boolean')return;
    if(typeof value==='string'){if(Buffer.byteLength(value)>max||Buffer.from(value).toString('utf8')!==value||value.includes('\0'))fail('INVALID_DATA');return;}
    if(typeof value==='number'){if(!Number.isFinite(value)||(Number.isInteger(value)&&!Number.isSafeInteger(value)))fail('INVALID_DATA');return;}
    if(!value||typeof value!=='object'||(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype))fail('INVALID_DATA');
    const keys=Reflect.ownKeys(value);if(keys.length>1025||(Array.isArray(value)&&keys.length!==value.length+1))fail('DATA_LIMIT');
    for(const key of keys){if(Array.isArray(value)&&key==='length')continue;const d=Object.getOwnPropertyDescriptor(value,key)!;
      if(typeof key!=='string'||['constructor','prototype','__proto__'].includes(key)||!d.enumerable||!('value'in d))fail('INVALID_DATA');visit(d.value,depth+1);}
  };
  visit(v,0);if(Buffer.byteLength(canonicalJson(v))>max)fail('DATA_LIMIT');return structuredClone(v);
}
export function frozen<T>(value:T):T {if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;}
export function scope(value:Scope):Scope {const v=copy(value,1024);if(!exact(v,['workspaceId','runId','taskId'])||!Object.values(v).every(id))fail('INVALID_SCOPE');return v;}
export function manifest(value:string):TestManifest {
  if(typeof value!=='string'||Buffer.byteLength(value)>4096)fail('INVALID_MANIFEST');let parsed:unknown;
  try{parsed=JSON.parse(value);}catch{fail('INVALID_MANIFEST');}
  const v=copy(parsed,4096);
  if(canonicalJson(v)!==value||!exact(v,['format','testId','testerDigest','environmentDigest','criteria','limits'])
    ||v.format!=='trellis/registered-test/v0.7-alpha'||v.testId!=='craft-shop-ui-v1'||!sha(v.testerDigest)||!sha(v.environmentDigest)||!same(v.criteria,CRITERIA)
    ||!exact(v.limits,['timeoutMs','outputBytes','artifactBytes'])||!time(v.limits.timeoutMs)||v.limits.timeoutMs<1||v.limits.timeoutMs>30000
    ||!time(v.limits.outputBytes)||v.limits.outputBytes<1||v.limits.outputBytes>16384||!time(v.limits.artifactBytes)||v.limits.artifactBytes<1||v.limits.artifactBytes>65536)fail('INVALID_MANIFEST');
  return v as unknown as TestManifest;
}
export function owner(authority:TaskState,principal:Principal,at:number):void {
  if(!exact(principal,['subject','proofRef','expiresAtMs'])||!id(principal.subject)||typeof principal.proofRef!=='string'||!principal.proofRef.length||principal.proofRef.length>256||!time(principal.expiresAtMs)||principal.expiresAtMs<=at)fail('UNAUTHENTICATED');
  if(principal.subject!==authority.ownerSubject)fail('FORBIDDEN');
}
export function validateTestManifestPlan(planValue:RunInput['plan'],bytes:string):TestManifest {
  const registered=manifest(bytes);
  const plan=copy(planValue);
  if(!exact(plan,['format','compilerVersion','definition','assets','taskOrder','layers','candidateRevision'])||plan.format!==PLAN_FORMAT||plan.compilerVersion!==COMPILER_VERSION||!sha(plan.candidateRevision))fail('INVALID_PLAN');
  const {candidateRevision,...body}=plan;if(digest(canonicalJson(body))!==candidateRevision)fail('INVALID_PLAN');
  validateDefinition(plan.definition);const ordered=graphOrder(plan.definition);if(!same(plan.taskOrder,ordered.taskOrder)||!same(plan.layers,ordered.layers))fail('INVALID_PLAN');
  const names=Object.keys(plan.definition.assets);if(!exact(plan.assets,names))fail('INVALID_PLAN');
  for(const name of names){const a=plan.assets[name]!,d=plan.definition.assets[name]!;if(!exact(a,['path','mediaType','bytes','digest'])||a.path!==d.path||a.mediaType!==d.mediaType||!time(a.bytes)||!sha(a.digest))fail('INVALID_PLAN');}
  const pinned=plan.assets['test-manifest'];
  if(!pinned||pinned.mediaType!=='application/json'||pinned.digest!==digest(bytes)||pinned.bytes!==Buffer.byteLength(bytes))fail('TEST_MANIFEST_MISMATCH');
  return registered;
}
export function request(input:RunInput,receipt:Receipt,authority:TaskState,principal:Principal,registry:TestManifest,at:number):{request:TestRequest;approvalDigest:string;expiresAtMs:number} {
  owner(authority,principal,at);
  const plan=input.plan;validateTestManifestPlan(plan,canonicalJson(registry));const candidateRevision=plan.candidateRevision;
  const task=plan.definition.tasks.find(t=>t.id===authority.scope.taskId);if(!task||!same(task,authority.task)||candidateRevision!==authority.candidateRevision
    ||!same(scope({workspaceId:input.task.workspaceId,runId:input.task.runId,taskId:input.task.taskId}),authority.scope)||input.task.ownerEpoch!==authority.ownerEpoch||input.task.ownerSubject!==authority.ownerSubject)fail('STALE_AUTHORITY');
  if(authority.cancelRequested)fail('CANCELLED');
  if(at<authority.readyAtMs||task.dependsOn.some(t=>!authority.completedDependencies.includes(t)))fail('TASK_NOT_READY');
  if(at>=authority.leaseExpiresAtMs||at>=authority.readyAtMs+task.policy.deadlineSeconds*1000)fail('AUTHORITY_EXPIRED');
  const writes=task.effects.filter(e=>e.operation==='workspace.write'),commands=task.effects.filter(e=>e.operation==='command.test');
  if(task.approval!=='required'||task.effects.length!==2||writes.length!==1||commands.length!==1||commands[0]!.operation!=='command.test'||commands[0]!.command!==registry.testId
    ||!same([...task.requires].sort(),['approval.exact-revision','command.test','workspace.write'])||task.policy.maxAttempts!==1||task.policy.backoffSeconds!==0)fail('UNSUPPORTED_TEST_TASK');
  const serialized=canonicalJson(registry);
  const action=Object.values(authority.actions).find(a=>a.operationKey===receipt.operationKey);
  if(!action||action.status!=='COMPLETED'||!action.receipt||!same(action.receipt,receipt))fail('WRITE_RECEIPT_REQUIRED');
  const p=action.proposal,approval=action.approval;
  if(p.candidateRevision!==candidateRevision||p.ownerEpoch!==authority.ownerEpoch||!same(p.scope,authority.scope)||writes[0]!.operation!=='workspace.write'||writes[0]!.path!==p.edit.path)fail('WRITE_BINDING');
  if(!approval||!authority.approverSubjects.includes(approval.subject)||approval.expiresAtMs<=at||approval.candidateRevision!==candidateRevision||approval.ownerEpoch!==authority.ownerEpoch
    ||approval.actionDigest!==action.actionDigest||!same(approval.scope,authority.scope)||approval.requestId!==p.requestId)fail('APPROVAL_REQUIRED');
  if(action.actionDigest!==digest(canonicalJson(p))||action.operationKey!==digest(canonicalJson({scope:p.scope,requestId:p.requestId,actionDigest:action.actionDigest})))fail('WRITE_BINDING');
  if(receipt.afterDigest!==digest(p.edit.content)||receipt.bytes!==Buffer.byteLength(p.edit.content)||receipt.bytes>registry.limits.artifactBytes||receipt.appliedAtMs>at)fail('ARTIFACT_BINDING');
  const operationId=digest(canonicalJson({scope:authority.scope,writeOperationKey:receipt.operationKey}));
  return{request:{format:'trellis/test-request/v0.7-alpha',operationId,scope:authority.scope,candidateRevision,ownerEpoch:authority.ownerEpoch,
    writeRequestId:p.requestId,writeOperationKey:action.operationKey,writeActionDigest:action.actionDigest,manifest:registry,manifestDigest:digest(serialized),
    artifact:{path:p.edit.path,content:p.edit.content,digest:receipt.afterDigest,bytes:receipt.bytes}},approvalDigest:digest(canonicalJson(approval)),
    expiresAtMs:Math.min(authority.leaseExpiresAtMs,authority.readyAtMs+task.policy.deadlineSeconds*1000,approval.expiresAtMs,principal.expiresAtMs)};
}
export function report(value:TestReport,record:TestRecord):TestReport {
  const r=copy(value,record.request.manifest.limits.outputBytes);
  if(!exact(r,['format','operationId','requestDigest','manifestDigest','artifactDigest','checks','exported','exitCode','stdout','stderr','scratchBytesPeak','scratchRemoved'])
    ||r.format!=='trellis/test-report/v0.7-alpha'||r.operationId!==record.id||r.requestDigest!==record.request.requestDigest||r.manifestDigest!==record.request.manifestDigest||r.artifactDigest!==record.request.artifact.digest
    ||!Array.isArray(r.checks)||r.checks.length!==4||!r.checks.every((check,i)=>exact(check,['id','passed','observation'])&&check.id===CRITERIA[i]&&typeof check.passed==='boolean'&&typeof check.observation==='string'&&Buffer.byteLength(check.observation)<=1024)
    ||!time(r.scratchBytesPeak)||r.scratchRemoved!==true)fail('INVALID_TEST_REPORT');
  for(const stream of [r.stdout,r.stderr])if(!exact(stream,['digest','bytes'])||!sha(stream.digest)||!time(stream.bytes)||stream.bytes>record.request.manifest.limits.outputBytes)fail('TEST_OUTPUT_LIMIT');
  if(r.stdout.bytes+r.stderr.bytes>record.request.manifest.limits.outputBytes)fail('TEST_OUTPUT_LIMIT');
  const passed=r.checks.every(c=>c.passed);if(r.exitCode!==(passed?0:1))fail('INVALID_TEST_REPORT');
  if(r.exported!==null&&(!exact(r.exported,['digest','bytes'])||!sha(r.exported.digest)||!time(r.exported.bytes)||r.exported.bytes>65536))fail('INVALID_TEST_REPORT');
  if(r.checks[3]!.passed&&!r.exported)fail('MISSING_EXPORT_EVIDENCE');return r;
}
export function record(value:TestRecord):TestRecord {
  const r=copy(value);if(!exact(r,['version','id','request','approvalDigest','status','reason','evidence','evidenceRef'])||r.version!==1||!sha(r.id)||!sha(r.approvalDigest)
    ||!['CLAIMED','PASSED','FAILED','HOLD','CANCELLED'].includes(r.status)||!(r.reason===null||typeof r.reason==='string'&&/^[A-Z_]{1,100}$/.test(r.reason)))fail('CORRUPT_TEST');
  const req=r.request;if(!exact(req,['format','operationId','scope','candidateRevision','ownerEpoch','writeRequestId','writeOperationKey','writeActionDigest','manifest','manifestDigest','artifact','requestDigest','launcherId','startedAtMs','deadlineMs']))fail('CORRUPT_TEST');
  const {requestDigest,launcherId,startedAtMs,deadlineMs,...body}=req;scope(req.scope);manifest(canonicalJson(req.manifest));
  if(req.format!=='trellis/test-request/v0.7-alpha'||req.operationId!==r.id||r.id!==digest(canonicalJson({scope:req.scope,writeOperationKey:req.writeOperationKey}))
    ||requestDigest!==digest(canonicalJson(body))||!id(launcherId)||!time(startedAtMs)||!time(deadlineMs)||deadlineMs<=startedAtMs||deadlineMs-startedAtMs>req.manifest.limits.timeoutMs
    ||!sha(req.candidateRevision)||!time(req.ownerEpoch)||req.ownerEpoch<1||!id(req.writeRequestId)||!sha(req.writeOperationKey)||!sha(req.writeActionDigest)||req.manifestDigest!==digest(canonicalJson(req.manifest)))fail('CORRUPT_TEST');
  const a=req.artifact;if(!exact(a,['path','content','digest','bytes'])||typeof a.path!=='string'||typeof a.content!=='string'||a.digest!==digest(a.content)||a.bytes!==Buffer.byteLength(a.content)||a.bytes>req.manifest.limits.artifactBytes)fail('CORRUPT_TEST');assertPortablePath(a.path);
  if(r.evidence!==null){const e=r.evidence;if(!exact(e,['format','request','approvalDigest','finishedAtMs','report','accepted','processesReaped'])||e.format!=='trellis/test-evidence/v0.7-alpha'||!same(e.request,req)||e.approvalDigest!==r.approvalDigest||!time(e.finishedAtMs)||e.finishedAtMs<startedAtMs||e.finishedAtMs>deadlineMs||e.processesReaped!==true)fail('CORRUPT_TEST');
    report(e.report,r);if(e.accepted!==e.report.checks.every(c=>c.passed)||r.evidenceRef!==digest(canonicalJson(e)))fail('CORRUPT_TEST');
  }else if(r.evidenceRef!==null)fail('CORRUPT_TEST');
  if(['PASSED','FAILED'].includes(r.status)?(!r.evidence||r.status!==(r.evidence.accepted?'PASSED':'FAILED')||r.reason!==null):r.evidence!==null)fail('CORRUPT_TEST');
  if(r.status==='CLAIMED'?r.reason!==null:!['PASSED','FAILED'].includes(r.status)&&r.reason===null)fail('CORRUPT_TEST');return r;
}
