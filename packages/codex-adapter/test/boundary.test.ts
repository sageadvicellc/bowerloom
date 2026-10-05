import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { getEventListeners } from 'node:events';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm, symlink, link, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { CodexProposalBoundary, planCodexProposalLaunch, codexArtifactRevision, measureCodexInstalledArtifact, codexQualificationRevision, codexBoundaryAccountRevision, refuseCodexQualificationProbe } from '../src/boundary.js';
import { CodexAdapterCore } from '../src/adapter-core.js';
import { CodexBetaAdapter, CodexAdapter } from '../src/index.js';
import { SUPPORTED_NATIVE_SHA256, MODEL_ROUTE } from '../src/policy.js';
import { CodexObservationReader } from '../src/reader.js';
import type { CodexArtifactBinding, CodexBetaBoundaryOptions } from '../src/boundary.js';
import type { Installation, AccountBinding } from '../src/types.js';
const hash = (v: Buffer | string) => createHash('sha256').update(v).digest('hex');
const root = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const native = { version: '0.157.0' as const, nativeSha256: SUPPORTED_NATIVE_SHA256 };
const installation: Installation = { ...native, nativePath: '/does-not-exist-native-boundary-test', workRoot: '/does-not-exist-work-root' };
const binding: AccountBinding = { canonicalAccountId: 'synthetic', aliases: ['synthetic'], providerAccountSha256: 'a'.repeat(64), requiredWindows: ['primary'], optionalWindows: ['secondary'] };
const paths = ['boundary','index','adapter-core','startup-deadline','installation','policy','protocol','reader','observation','safe','supervisor','guardian'].map(n => `dist/packages/codex-adapter/src/${n}.js`).concat(['dist/packages/broker/src/index.js','dist/packages/contracts/src/index.js','dist/packages/mcp-connections/src/darwin-boot-session.js','dist/packages/mcp-connections/src/model.js']);
async function setup() {
  const artifact: CodexArtifactBinding = { root, tarballSha256: 'b'.repeat(64), files: await Promise.all(paths.map(async path => ({ path, sha256: hash(await readFile(join(root,path))) }))) };
  const body = { format: 'bowerloom/codex-boundary-qualification/v1beta1' as const, receiptId: 'review-01', status: 'active' as const, launchPlanRevision: planCodexProposalLaunch(native).revision, artifactRevision: codexArtifactRevision(artifact), ...{ nativeSha256: native.nativeSha256, nativeVersion: native.version }, accountBindingDigest: codexBoundaryAccountRevision(binding,'synthetic'), issuedAtMs: Date.now()-1000, expiresAtMs: Date.now()+60000, reviewRevision: 'c'.repeat(64), probeSuiteRevision: 'd'.repeat(64) };
  const receipt = { ...body, revision: codexQualificationRevision(body) };
  const options: CodexBetaBoundaryOptions = { receiptId: receipt.receiptId, receiptRevision: receipt.revision, artifact, lookupQualification: async () => receipt };
  return { artifact, receipt, options };
}
const signal = () => new AbortController().signal;

test('plan pins exact controls, schema, binary and ordering without invoking getters', () => {
  const plan = planCodexProposalLaunch(native);
  assert.deepEqual(plan, planCodexProposalLaunch({ nativeSha256: native.nativeSha256, version: native.version }));
  assert.equal(plan.effectsAuthorized,false); assert.equal(plan.nativeInvocationDenialProved,false);
  assert.ok(plan.argvTemplate.includes('--ignore-user-config')); assert.ok(plan.argvTemplate.includes('approval_policy="never"'));
  assert.throws(() => (plan.controls as string[]).push('bad'));
  let reads=0; assert.throws(() => planCodexProposalLaunch(Object.defineProperty({},'version',{get(){reads++;return native.version;}}) as any)); assert.equal(reads,0);
  assert.throws(() => planCodexProposalLaunch({...native, extra:true} as any));
  assert.throws(() => planCodexProposalLaunch({...native,nativeSha256:'0'.repeat(64)}));
});
test('gate measures actual module closure and accepts only the pinned trusted lookup', async () => {
  const {options,artifact}=await setup(); const gate=new CodexProposalBoundary(options,installation,binding,'synthetic');
  await gate.check(signal()); gate.assertCurrent(signal());
  assert.equal(await measureCodexInstalledArtifact(artifact,signal()),codexArtifactRevision(artifact));
  assert.equal(codexArtifactRevision({...artifact,files:[...artifact.files].reverse()}),codexArtifactRevision(artifact));
  assert.notEqual(codexArtifactRevision({...artifact,tarballSha256:'e'.repeat(64)}),codexArtifactRevision(artifact));
  const incomplete={...artifact,files:artifact.files.filter(f=>!f.path.endsWith('/guardian.js'))}; assert.throws(()=>codexArtifactRevision(incomplete));
});
test('well-formed self-authored receipt, revocation, scope drift and expiry refuse', async () => {
  const {options,receipt}=await setup();
  for(const patch of [{reviewRevision:'f'.repeat(64)},{status:'revoked'},{accountBindingDigest:'f'.repeat(64)},{launchPlanRevision:'f'.repeat(64)},{artifactRevision:'f'.repeat(64)},{expiresAtMs:Date.now()-1}]) {
    const {revision:_,...body}={...receipt,...patch}; const forged={...body,revision:codexQualificationRevision(body as any)};
    const gate=new CodexProposalBoundary({...options,receiptRevision:('reviewRevision' in patch)?options.receiptRevision:forged.revision,lookupQualification:async()=>forged},installation,binding,'synthetic');
    await assert.rejects(gate.check(signal()));
  }
  await assert.rejects(new CodexProposalBoundary({...options,lookupQualification:async()=>null},installation,binding,'synthetic').check(signal()));
});
test('registry and receipt accessors cannot leak private errors or execute', async () => {
  const {options}=await setup(); let reads=0;
  const malicious=Object.defineProperty({},'format',{get(){reads++;throw Error('PRIVATE');},enumerable:true});
  await assert.rejects(new CodexProposalBoundary({...options,lookupQualification:async()=>malicious},installation,binding,'synthetic').check(signal()),e=>e instanceof Error&&!e.message.includes('PRIVATE'));
  assert.equal(reads,0);
  await assert.rejects(new CodexProposalBoundary({...options,lookupQualification:async()=>{throw Error('PRIVATE');}},installation,binding,'synthetic').check(signal()),{message:'BOUNDARY_LOOKUP_REFUSED'});
  const poisoned=Object.defineProperty({...options},'artifact',{get(){reads++;return options.artifact;}});
  assert.throws(()=>new CodexProposalBoundary(poisoned,installation,binding,'synthetic'));assert.equal(reads,0);
});
test('artifact hash mismatch, unsafe files and wrong installed root refuse', async () => {
  const {artifact}=await setup();
  await assert.rejects(measureCodexInstalledArtifact({...artifact,files:artifact.files.map((f,i)=>i?f:{...f,sha256:'0'.repeat(64)})},signal()));
  await assert.rejects(measureCodexInstalledArtifact({...artifact,root:'/does-not-exist-private-artifact'},signal()),e=>e instanceof Error&&!e.message.includes('does-not-exist'));
  const dir=await mkdtemp(join(root,'boundary-test-'));
  try {
    const target=join(dir,'extra.txt');await writeFile(target,'synthetic');const rel=target.slice(root.length+1);
    const added=(path:string)=>({...artifact,files:[...artifact.files,{path,sha256:hash('synthetic')}]});
    await measureCodexInstalledArtifact(added(rel),signal());
    await chmod(target,0o666);await assert.rejects(measureCodexInstalledArtifact(added(rel),signal()));await chmod(target,0o600);
    await link(target,join(dir,'hard.txt'));await assert.rejects(measureCodexInstalledArtifact(added(rel),signal()));await rm(join(dir,'hard.txt'));
    await symlink(target,join(dir,'soft.txt'));await assert.rejects(measureCodexInstalledArtifact(added(rel.replace('extra.txt','soft.txt')),signal()));
  } finally { await rm(dir,{recursive:true}); }
});
test('explicit beta start refuses before account/native launch; no alpha fallback', async () => {
  const {options}=await setup();let lookups=0,readers=0;
  const old=CodexObservationReader.prototype.read;CodexObservationReader.prototype.read=async()=>{readers++;throw Error('must-not-run');};
  try {
    const adapter=new CodexBetaAdapter({installation,binding,accountAlias:'synthetic',boundary:{...options,lookupQualification:async()=>{lookups++;return null;}}});
    await assert.rejects(adapter.start({launcherId:'synthetic',taskInput:'brief',modelRoute:MODEL_ROUTE},signal()),{message:'BOUNDARY_SCHEMA'});
    assert.equal(lookups,1);assert.equal(readers,0);
    const alpha=new CodexAdapter({installation,binding,accountAlias:'synthetic'});
    await assert.rejects(alpha.start({launcherId:'synthetic',taskInput:'brief',modelRoute:MODEL_ROUTE},signal()),e=>e instanceof Error&&!e.message.startsWith('BOUNDARY_'));
    assert.equal(lookups,1);assert.equal(readers,0);
  }finally{CodexObservationReader.prototype.read=old;}
});
test('late registry completion after cancellation never reaches native/account work', async () => {
  const {options,receipt}=await setup();let resolveLookup!:(v:unknown)=>void,reads=0;
  const old=CodexObservationReader.prototype.read;CodexObservationReader.prototype.read=async()=>{reads++;throw Error('must-not-run');};
  try {
    const controller=new AbortController();
    const adapter=new CodexBetaAdapter({installation,binding,accountAlias:'synthetic',boundary:{...options,lookupQualification:()=>new Promise(r=>{resolveLookup=r;})}});
    const pending=adapter.start({launcherId:'synthetic',taskInput:'brief',modelRoute:MODEL_ROUTE},controller.signal);const rejected=assert.rejects(pending,{message:'CANCELLED'});
    await new Promise<void>(resolve=>setImmediate(resolve));controller.abort();resolveLookup(receipt);await rejected;assert.equal(reads,0);
  }finally{CodexObservationReader.prototype.read=old;}
});
test('host configuration is detached; probe bootstrap always unavailable', async () => {
  const {options}=await setup();const gate=new CodexProposalBoundary(options,installation,binding,'synthetic');
  options.artifact.files[0]!.sha256='0'.repeat(64);options.receiptRevision='0'.repeat(64);await gate.check(signal());
  assert.throws(()=>refuseCodexQualificationProbe(),{message:'BOUNDARY_PROBE_UNAVAILABLE'});
  const controller=new AbortController();controller.abort();await assert.rejects(gate.check(controller.signal),{message:'CANCELLED'});
});

test('never-settling lookup cancels immediately, releases busy state, and ignores late resolution', async () => {
  const {options}=await setup(); let calls=0, reads=0, inspectLate=0, resolveLate!:(value:unknown)=>void;
  const old=CodexObservationReader.prototype.read; CodexObservationReader.prototype.read=async()=>{reads++;throw Error('must-not-run');};
  try {
    const adapter=new CodexBetaAdapter({installation,binding,accountAlias:'synthetic',boundary:{...options,lookupQualification:()=>{
      calls++; return calls===1?new Promise(resolve=>{resolveLate=resolve;}):Promise.resolve(null);
    }}});
    const controller=new AbortController();
    const pending=adapter.start({launcherId:'synthetic',taskInput:'brief',modelRoute:MODEL_ROUTE},controller.signal);
    const result=assert.rejects(pending,{message:'CANCELLED'});
    await new Promise<void>(resolve=>setImmediate(resolve));
    controller.abort(); await result;assert.equal(getEventListeners(controller.signal,'abort').length,0);
    // A second start reaches the registry instead of reporting ADAPTER_BUSY.
    await assert.rejects(adapter.start({launcherId:'synthetic',taskInput:'brief',modelRoute:MODEL_ROUTE},signal()),{message:'BOUNDARY_SCHEMA'});
    const hostile=Object.defineProperty({},'format',{enumerable:true,get(){inspectLate++;throw Error('PRIVATE');}});
    resolveLate(hostile); await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(calls,2);assert.equal(reads,0);assert.equal(inspectLate,0);
  }finally{CodexObservationReader.prototype.read=old;}
});

test('fixed lookup timeout releases busy state and observes a late rejection without continuing', async () => {
  const {options}=await setup();let calls=0, reads=0, rejectLate!:(error:Error)=>void;
  assert.equal(planCodexProposalLaunch(native).qualificationLookupTimeoutMs,1000);
  const old=CodexObservationReader.prototype.read;CodexObservationReader.prototype.read=async()=>{reads++;throw Error('must-not-run');};
  try {
    const adapter=new CodexBetaAdapter({installation,binding,accountAlias:'synthetic',boundary:{...options,lookupQualification:()=>{
      calls++;return calls===1?new Promise((_resolve,reject)=>{rejectLate=reject;}):Promise.resolve(null);
    }}});
    const started=Date.now(), timeoutSignal=signal();
    await assert.rejects(adapter.start({launcherId:'synthetic',taskInput:'brief',modelRoute:MODEL_ROUTE},timeoutSignal),{message:'BOUNDARY_LOOKUP_TIMEOUT'});
    assert.equal(getEventListeners(timeoutSignal,'abort').length,0);
    assert.ok(Date.now()-started>=900);
    await assert.rejects(adapter.start({launcherId:'synthetic',taskInput:'brief',modelRoute:MODEL_ROUTE},signal()),{message:'BOUNDARY_SCHEMA'});
    rejectLate(Error('PRIVATE LATE REJECTION')); await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(calls,2);assert.equal(reads,0);
  }finally{CodexObservationReader.prototype.read=old;}
});

test('cancellation before lookup microtask prevents invoking the registry', async () => {
  const {options}=await setup();let calls=0;const controller=new AbortController();
  const adapter=new CodexBetaAdapter({installation,binding,accountAlias:'synthetic',boundary:{...options,lookupQualification:async()=>{calls++;return null;}}});
  const pending=adapter.start({launcherId:'synthetic',taskInput:'brief',modelRoute:MODEL_ROUTE},controller.signal);
  const rejected=assert.rejects(pending,{message:'CANCELLED'});controller.abort();await rejected;assert.equal(calls,0);
});


test('overdue fulfillment refuses even when a blocked event loop delays the timeout callback', async () => {
  const {options,receipt}=await setup();let reads=0;
  const old=CodexObservationReader.prototype.read;CodexObservationReader.prototype.read=async()=>{reads++;throw Error('must-not-run');};
  try {
    const adapter=new CodexBetaAdapter({installation,binding,accountAlias:'synthetic',boundary:{...options,lookupQualification:async()=>{
      // An uncooperative host blocks timers, then fulfills in the microtask queue.
      const started=performance.now();while(performance.now()-started<1050) { /* finite timer-delay fixture */ }
      return receipt;
    }}});
    await assert.rejects(adapter.start({launcherId:'synthetic',taskInput:'brief',modelRoute:MODEL_ROUTE},signal()),{message:'BOUNDARY_LOOKUP_TIMEOUT'});
    assert.equal(reads,0);
  }finally{CodexObservationReader.prototype.read=old;}
});


test('private constructor captures gate methods; public constructors do not accept a mutable gate',async()=>{
 let checks=0,changed=0;const gate={async check():Promise<void>{checks++;throw Error('initial-private-refusal');},assertCurrent(){},consume(){throw Error('unavailable');}};
 const core=new CodexAdapterCore({installation,binding,accountAlias:'synthetic'},gate);
 gate.check=async()=>{changed++;};
 await assert.rejects(core.start({launcherId:'synthetic',taskInput:'task',modelRoute:MODEL_ROUTE},signal()));
 assert.equal(checks,1);assert.equal(changed,0);
 const {options}=await setup();const beta=new CodexBetaAdapter({installation,binding,accountAlias:'synthetic',boundary:{...options,lookupQualification:async()=>null},gate} as any);
 await assert.rejects(beta.start({launcherId:'synthetic',taskInput:'task',modelRoute:MODEL_ROUTE},signal()),{message:'BOUNDARY_SCHEMA'});assert.equal(checks,1);
});
