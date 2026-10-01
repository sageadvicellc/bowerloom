import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pinGraph,GraphDriver} from '../../../dist/packages/graph/src/index.js';
import {RuntimeTaskBridge,renderTask,pinBridgePolicy} from '../../../dist/packages/runtime-bridge/src/index.js';
import {taskRequest} from '../../../dist/packages/graph/src/validation.js';
import {MODEL_ROUTE} from '../../../dist/packages/codex-adapter/src/index.js';
import {input,seal,TestStore,canonicalJson,digest} from '../../graph/test/fixtures.mjs';
const manifest=canonicalJson({format:'trellis/registered-test/v0.7-alpha',testId:'craft-shop-ui-v1',testerDigest:digest('tester'),environmentDigest:digest('environment'),criteria:['add-job','change-stage','reload','export'],limits:{timeoutMs:25000,outputBytes:16384,artifactBytes:65536}});
async function gated(){const v=await input('gated');v.plan.definition.tasks=v.plan.definition.tasks.slice(0,1);const t=v.plan.definition.tasks[0];
 t.outputs={application:{kind:'artifact',mediaType:'text/html'}};t.effects=[{operation:'command.test',command:'craft-shop-ui-v1'},{operation:'workspace.write',path:'output/design/index.html'}];t.requires.push('command.test');
 v.plan.definition.requiredCapabilities=['workspace.write','approval.exact-revision','command.test'];
 v.plan.definition.scope.push({operation:'command.test',command:'craft-shop-ui-v1'});
 v.plan.definition.owners.find(o=>o.id==='emery').permissions.push({operation:'command.test',command:'craft-shop-ui-v1'});
 v.plan.definition.assets['test-manifest']={path:'test-manifest.json',mediaType:'application/json'};
 v.plan.assets['test-manifest']={...v.plan.definition.assets['test-manifest'],bytes:Buffer.byteLength(manifest),digest:digest(manifest)};v.assets['test-manifest']=manifest;v.plan=seal(v.plan);return v;}
const policy={accountAlias:'synthetic',modelRoute:MODEL_ROUTE,allowancePercent:{primary:2},approverSubjects:['founder:reviewer'],readyAtMs:100,leaseExpiresAtMs:100000};
test('registered browser gate survives graph pinning and write selection is independent of effect order',async()=>{
 const v=await gated();pinGraph(v);const store=new TestStore();const driver=new GraphDriver(store,{async submit(){},async inspect(){return null;}});const state=(await driver.submit(v)).state;
 const rendered=JSON.parse(renderTask(taskRequest(state,'design')));assert.equal(rendered.proposal.edit.path,'output/design/index.html');
 assert.doesNotThrow(()=>new RuntimeTaskBridge(v,policy,store,{},manifest));
});
test('gate requires exact pinned manifest bytes before a runtime bridge can exist',async()=>{
 const v=await gated(),store=new TestStore();assert.throws(()=>new RuntimeTaskBridge(v,policy,store,{}),{code:'TEST_MANIFEST_REQUIRED'});
 const changed=JSON.parse(manifest);changed.testerDigest=digest('changed');
 assert.throws(()=>new RuntimeTaskBridge(v,policy,store,{},canonicalJson(changed)),{code:'TEST_MANIFEST_MISMATCH'});
});
test('unknown tests, duplicate tests, non-HTML outputs and missing approval are rejected before dispatch',async()=>{
 for(const change of [t=>{t.effects[0].command='arbitrary-shell';},t=>{t.effects.push({...t.effects[0]});},t=>{t.outputs.application.mediaType='text/plain';},t=>{t.approval='none';}]){
  const v=await gated();change(v.plan.definition.tasks[0]);
  assert.throws(()=>{v.plan=seal(v.plan);pinGraph(v);});
 }
});

test('invalid bridge policy is rejected by the pre-start validator',()=>{
 assert.throws(()=>pinBridgePolicy({...policy,modelRoute:'paid-api'}),{code:'INVALID_POLICY'});
 const copied=pinBridgePolicy(policy);copied.approverSubjects.push('other');assert.deepEqual(policy.approverSubjects,['founder:reviewer']);
});
