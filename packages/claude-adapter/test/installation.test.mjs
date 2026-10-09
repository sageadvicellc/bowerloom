import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareInstallation,assertSameInstallationPlan } from '../../../dist/packages/claude-adapter/src/installation.js';
import { digest,ROUTES } from '../../../dist/packages/claude-adapter/src/policy.js';
// All paths/digests/times are synthetic host measurements. No file or executable is accessed.
const H='a'.repeat(64),NOW=1800000000000;
const fixture=()=>{const inventory=[{path:'dist/entry.js',sha256:H,bytes:20}];const measured={format:'bowerloom/claude-measurement/v1',nativePath:'/synthetic/native/claude',nativeSha256:H,nativeVersion:'2.1.292',artifactRevision:digest(inventory),inventory,measuredAtMs:NOW};return {measured,expected:{nativePath:measured.nativePath,nativeSha256:H,nativeVersion:'2.1.292',artifactRevision:measured.artifactRevision},request:{route:ROUTES[0],promptSchema:'bowerloom/claude-finite-request/v1',prompt:'Synthetic review only.',issuedAtMs:NOW-100,expiresAtMs:NOW+100000}};};
test('host-pinned bytes produce immutable inert plan with all controls and no authority',()=>{
  const f=fixture(),p=prepareInstallation(f.measured,f.expected,f.request,NOW);assertSameInstallationPlan(p,p.revision);assert.equal(p.executionAuthorized,false);assert.equal(p.controlsQualified,false);assert.equal(p.measurementOriginVerified,false);assert.equal(p.paidFallback,false);
  f.measured.inventory[0].sha256='b'.repeat(64);f.request.prompt='mutated';assert.equal(p.installation.inventory[0].sha256,H);assert.equal(p.promptBytes,22);assert.ok(Object.isFrozen(p.argv));
  const medium=fixture();medium.request.route=ROUTES[1];assert.notEqual(prepareInstallation(medium.measured,medium.expected,medium.request,NOW).revision,p.revision);
});
test('wrong native path/version/hash/artifact and unqualified extra configuration refuse',()=>{
  for(const [k,value] of [['nativePath','/other/claude'],['nativeSha256','b'.repeat(64)],['nativeVersion','2.1.288'],['artifactRevision','c'.repeat(64)]]){const f=fixture();f.expected[k]=value;assert.throws(()=>prepareInstallation(f.measured,f.expected,f.request,NOW),{code:'DRIFT'});}
  for(const mutate of [f=>f.measured.nativePath='/a/../claude',f=>f.measured.inventory.push({...f.measured.inventory[0]}),f=>f.measured.inventory[0].bytes=2**24+1,f=>f.measured.inventory[0].sha256='b'.repeat(64),f=>f.request.environment={API_KEY:'secret'},f=>f.request.argv=['--dangerously-skip-permissions'],f=>f.request.prompt='é'.repeat(16385)]){const f=fixture();mutate(f);assert.throws(()=>prepareInstallation(f.measured,f.expected,f.request,NOW));}
});
test('freshness, expiry and old measurements cannot extend finite installation lifetime',()=>{
  for(const mutate of [f=>f.measured.measuredAtMs=NOW+1,f=>f.request.expiresAtMs=NOW,f=>f.request.expiresAtMs=NOW+180001,f=>f.measured.measuredAtMs=NOW-30001]){const f=fixture();mutate(f);assert.throws(()=>prepareInstallation(f.measured,f.expected,f.request,NOW),{code:'STALE'});}
});
test('exact revision comparison refuses settings, argv, environment, prompt and inventory drift even with recomputed digest',()=>{
  const f=fixture(),p=prepareInstallation(f.measured,f.expected,f.request,NOW);
  for(const mutate of [v=>v.argv.push('--bare'),v=>v.settingsBytes='{}',v=>v.environment.DISABLE_UPDATES='0',v=>v.promptSha256='b'.repeat(64),v=>v.installation.inventory[0].bytes++]){const changed=structuredClone(p);mutate(changed);assert.throws(()=>assertSameInstallationPlan(changed,p.revision),{code:'DRIFT'});const {revision,...body}=changed;changed.revision=digest(body);assert.throws(()=>assertSameInstallationPlan(changed,p.revision),{code:'DRIFT'});}
});
