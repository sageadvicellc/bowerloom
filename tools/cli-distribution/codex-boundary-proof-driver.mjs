#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { inspectInstalledCodex } from './installed-codex-guard.mjs';

// Read-only proof: all adapter starts use missing/replaced authority and a nonexistent native path.
// It cannot qualify a native session or issue a trusted qualification receipt.
export async function proveInstalledCodexBoundary({ root, artifactPath, tarballSha256, distributionSha256 }) {
  assert.match(tarballSha256,/^[a-f0-9]{64}$/);
  assert.equal(createHash('sha256').update(readFileSync(artifactPath)).digest('hex'),tarballSha256);
  const measured=inspectInstalledCodex({root,distributionSha256,tarballSha256});
  const artifact={root,tarballSha256,files:measured.files.map(file=>({...file}))};
  const moduleUrl=pathToFileURL(join(root,'dist/packages/codex-adapter/src/index.js')).href;
  const api=await import(moduleUrl);
  const plan=api.planCodexProposalLaunch({version:api.CODEX_VERSION,nativeSha256:api.SUPPORTED_NATIVE_SHA256});
  assert.equal(plan.effectsAuthorized,false);
  const identity=await api.measureCodexInstalledArtifact(artifact,new AbortController().signal);
  assert.equal(identity,api.codexArtifactRevision(artifact));
  const binding={canonicalAccountId:'synthetic-account',aliases:['fixture'],providerAccountSha256:'b'.repeat(64),requiredWindows:['primary'],optionalWindows:['secondary']};
  const installation={nativePath:join(root,'DOES_NOT_EXIST_NATIVE'),nativeSha256:api.SUPPORTED_NATIVE_SHA256,version:api.CODEX_VERSION,workRoot:join(root,'DOES_NOT_EXIST_WORKSPACE')};
  let lookups=0;
  const make=lookup=>new api.CodexBetaAdapter({installation,binding,accountAlias:'fixture',boundary:{receiptId:'synthetic-review',receiptRevision:'c'.repeat(64),artifact,lookupQualification:async id=>{lookups++;assert.equal(id,'synthetic-review');return lookup();}}});
  const input={launcherId:'synthetic-launch',taskInput:'Return a proposal only.',modelRoute:api.MODEL_ROUTE};
  await assert.rejects(make(()=>null).start(input,new AbortController().signal),error=>/BOUNDARY_/.test(error.code));
  assert.equal(lookups,1);
  await assert.rejects(make(()=>({format:'forged',revision:'c'.repeat(64)})).start(input,new AbortController().signal),error=>/BOUNDARY_/.test(error.code));
  assert.equal(lookups,2);
  const abort=new AbortController();abort.abort();
  await assert.rejects(make(()=>null).start(input,abort.signal),error=>error.code==='CANCELLED');
  assert.equal(lookups,2);
  const pendingAbort=new AbortController();
  let release, pending=true;
  const waiting=make(()=>pending?new Promise(resolve=>{release=resolve;}):null);
  const stopped=waiting.start(input,pendingAbort.signal);
  await Promise.resolve();pendingAbort.abort();
  await assert.rejects(stopped,error=>error.code==='CANCELLED');
  assert.equal(typeof release,'function');release(null);pending=false;
  await assert.rejects(waiting.start(input,new AbortController().signal),error=>/BOUNDARY_/.test(error.code));
  assert.throws(()=>api.refuseCodexQualificationProbe(),error=>/PROBE/.test(error.code));
  return {mode:'installed-model-free-boundary-proof',moduleUrl,artifactSha256:tarballSha256,distributionSha256,installedEntries:artifact.files.length,artifactRevision:identity,launchPlanRevision:plan.revision,checks:{installedIdentity:true,missingAuthorityRefused:true,forgedAuthorityRefused:true,cancelledBeforeLookup:true,pendingLookupCancelled:true,busyReleasedAfterCancellation:true,probeUnavailable:true},nativeSessions:0,liveQualification:false,qualifiedBetaReady:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try { assert.equal(process.argv.length,3); const input=JSON.parse(readFileSync(process.argv[2],'utf8')); console.log(JSON.stringify(await proveInstalledCodexBoundary(input),null,2)); }
  catch { console.error('INSTALLED_CODEX_BOUNDARY_PROOF_FAILED');process.exitCode=1; }
}
