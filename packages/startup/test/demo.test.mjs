import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {syncBuiltinESMExports} from 'node:module';
import {planStartup, applyStartup, inspectStartup, planStartupDemo, verifyStartupDemoPlan, renderStartupDemoReview, planStartupRevision, applyStartupRevision} from '../../../dist/packages/startup/src/index.js';
import {canonicalJson, digest} from '../../../dist/packages/contracts/src/index.js';
import {DEMO_SOURCE_BYTES, DEMO_SCENARIO_DIGEST} from '../../../dist/packages/startup/src/demo-scenario.js';
import {compileAuthoring} from '../../../dist/packages/authoring/src/index.js';
import {serializeTestManifest} from '../../../dist/packages/controlled-tests/src/index.js';
import {parse, stringify} from 'yaml';
const code = expected => error => error?.code === expected;
const copy = value => JSON.parse(JSON.stringify(value));
const identity = path => { const s=fs.lstatSync(path,{bigint:true});return {device:String(s.dev),inode:String(s.ino),birthtimeNs:String(s.birthtimeNs),uid:Number(s.uid),mode:Number(s.mode)&0o777}; };
async function fixture(t,profile='engineer',historical) {
 const parent=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'bowerloom-demo-')));fs.chmodSync(parent,0o700);t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 const targetDir=join(parent,'project'),input={mode:'new',targetDir,brief:{projectName:'Private real project',goal:'A real goal that must not replace the synthetic inputs.',profile}};
 const plan=await planStartup(input);let receipt;
 if(!historical)receipt=await applyStartup(input,plan.revision);
 else {
  const h=JSON.parse(fs.readFileSync(new URL(`./fixtures/scaffold-${historical}.json`,import.meta.url),'utf8')),data=h.cases?.[0]??h;
  const body={format:plan.format,templateVersion:h.templateVersion,input:{...plan.input,brief:data.brief},binding:plan.binding,files:data.files,compiled:data.compiled,specReady:true,runtimeReady:false,executionAuthorized:false,reviewRequired:true};
  const root=join(targetDir,'.bowerloom');fs.mkdirSync(root,{recursive:true,mode:0o700});
  for(const file of data.files){fs.mkdirSync(dirname(join(root,file.path)),{recursive:true,mode:0o700});fs.writeFileSync(join(root,file.path),file.text,{mode:0o600});}
  receipt={format:'bowerloom/startup-receipt/v1alpha1',plan:{...body,revision:digest(canonicalJson(body)).slice(7)},installedTargetIdentity:identity(targetDir),installedBowerloomIdentity:identity(root),specReady:true,runtimeReady:false,executionAuthorized:false,reviewRequired:true};
  fs.writeFileSync(join(root,'installation-receipt.json'),JSON.stringify(receipt),{mode:0o600});
 }
 return {parent,targetDir,input,receipt,demoInput:{targetDir,expectedRevision:receipt.plan.revision}};
}
function snapshot(path){const out={};function walk(dir,base=''){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const name=base+entry.name;if(entry.isDirectory())walk(join(dir,entry.name),name+'/');else out[name]=fs.readFileSync(join(dir,entry.name)).toString('base64');}}walk(path);return out;}
for(const profile of ['engineer','founder','research'])test(`${profile}: optional exact installation handoff remains read-only and non-authorizing`,async t=>{
 const f=await fixture(t,profile);fs.writeFileSync(join(f.targetDir,'private.txt'),'unrelated secret');const before=snapshot(f.parent);
 const original=fs.openSync;fs.openSync=function(path,...args){assert.notEqual(String(path),join(f.targetDir,'private.txt'));return original.call(this,path,...args);};syncBuiltinESMExports();
 let plan;try{plan=await planStartupDemo(f.demoInput);assert.deepEqual(await verifyStartupDemoPlan(copy(plan)),plan);}finally{fs.openSync=original;syncBuiltinESMExports();}
 assert.deepEqual(snapshot(f.parent),before);assert.equal(plan.profile,profile);assert.equal(plan.binding.installedRevision,f.receipt.plan.revision);
 assert.equal(plan.binding.receiptSha256,digest(fs.readFileSync(join(f.targetDir,'.bowerloom/installation-receipt.json'))).slice(7));
 assert.deepEqual(await planStartupDemo(f.demoInput),plan);assert.ok(Object.isFrozen(plan.handoff.scenario.inputs));
 assert.equal(plan.executionAuthorized,false);assert.equal(plan.runtimeReady,false);assert.equal(plan.readOnly,true);
 assert.equal(plan.handoff.modelAuthored,false);assert.equal(plan.handoff.authoringComplete,false);assert.equal(plan.handoff.installedCrewIsDemoCrew,false);
 assert.equal(plan.handoff.liveAcceptance,'pending');assert.equal(plan.handoff.lens.measuredGain,null);assert.equal(plan.handoff.lens.comparison,'not-evaluated');
 assert.deepEqual(plan.handoff.requirements.grants,[]);assert.equal(plan.handoff.requirements.reservePercent,25);assert.equal(plan.handoff.requirements.paidFallback,false);
 assert.equal(plan.handoff.roles.filter(r=>r.participation==='proposed-demo-owner').length,2);assert.equal(plan.handoff.tasks.length,2);
 assert.ok(!plan.handoff.scenario.inputs.some(i=>i.text.includes(f.input.brief.goal)));assert.equal(plan.handoff.project.use,'discussion-context-only');
 const review=renderStartupDemoReview(plan);assert.ok(review.includes(f.input.brief.goal));assert.ok(review.includes(f.receipt.plan.revision));assert.match(review,/Neither setup nor this plan authorizes execution/);
});
test('packaged frozen scenario and all input bytes match the cleared monorepo scenario',()=>{
 const base='packages/workbench/scenarios/craft-shop-v1';const files={scenario:'scenario.json','project-brief':'brief.md',contract:'contract.md',orders:'orders.json'};
 for(const [key,file] of Object.entries(files))assert.equal(DEMO_SOURCE_BYTES[key],fs.readFileSync(join(base,file),'utf8'));
 assert.equal(digest(DEMO_SOURCE_BYTES.scenario),DEMO_SCENARIO_DIGEST);
 const scenario=JSON.parse(DEMO_SOURCE_BYTES.scenario);for(const pin of [scenario.brief,...scenario.inputs]){assert.equal(digest(DEMO_SOURCE_BYTES[pin.asset]),pin.digest);assert.equal(Buffer.byteLength(DEMO_SOURCE_BYTES[pin.asset]),pin.bytes);}
});
for(const historical of ['v1alpha1','v1alpha2','v1beta1','v1beta2'])test(`historical ${historical} receipt stays byte-identical`,async t=>{
 const f=await fixture(t,'engineer',historical),before=snapshot(f.targetDir);assert.equal((await inspectStartup(f.targetDir)).specReady,true);
 const p=await planStartupDemo(f.demoInput);assert.equal(p.profile,f.receipt.plan.input.brief.profile??'engineer');assert.deepEqual(snapshot(f.targetDir),before);
});
test('requires the exact live revision and refuses profile/scenario overrides',async t=>{
 const f=await fixture(t);await assert.rejects(planStartupDemo({...f.demoInput,expectedRevision:'yes'}),code('DEMO_EXACT_REVISION_REQUIRED'));
 await assert.rejects(planStartupDemo({...f.demoInput,expectedRevision:'0'.repeat(64)}),code('DEMO_STALE_REVISION'));
 for(const extra of [{profile:'research'},{scenario:'other'},{executionAuthorized:true}])await assert.rejects(planStartupDemo({...f.demoInput,...extra}));
 const plan=await planStartupDemo(f.demoInput),revisionInput={targetDir:f.targetDir,brief:{...f.input.brief,goal:'A revised real goal'}};
 const revision=await planStartupRevision(revisionInput);await applyStartupRevision(revisionInput,revision.fromRevision,revision.revision);
 await assert.rejects(verifyStartupDemoPlan(plan),code('DEMO_STALE_REVISION'));
});
test('drift, pending revision and symlinked managed input invalidate saved plans',async t=>{
 const f=await fixture(t),plan=await planStartupDemo(f.demoInput),brief=join(f.targetDir,'.bowerloom/brief.json'),before=fs.readFileSync(brief);
 fs.appendFileSync(brief,' ');await assert.rejects(verifyStartupDemoPlan(plan),code('DEMO_SETUP_NOT_READY'));fs.writeFileSync(brief,before);
 const marker=join(f.targetDir,'.bowerloom-revision.json');fs.writeFileSync(marker,'{}');await assert.rejects(verifyStartupDemoPlan(plan),code('DEMO_SETUP_NOT_READY'));fs.unlinkSync(marker);
 fs.unlinkSync(brief);fs.writeFileSync(join(f.targetDir,'outside.json'),before);fs.symlinkSync(join(f.targetDir,'outside.json'),brief);
 await assert.rejects(verifyStartupDemoPlan(plan),code('DEMO_SETUP_NOT_READY'));
});
test('tampered scenario, permissions, capacity, profile or binding fail even with recomputed hashes',async t=>{
 const f=await fixture(t),p=await planStartupDemo(f.demoInput);
 for(const edit of [v=>v.handoff.scenario.inputs[0].text+=' changed',v=>v.handoff.tasks[0].approval='none',v=>v.handoff.requirements.grants.push('workspace.write'),v=>v.handoff.requirements.reservePercent=0,v=>v.profile='founder',v=>v.binding.receiptSha256='0'.repeat(64),v=>v.executionAuthorized=true]){
  const v=copy(p);edit(v);v.handoffRevision=digest(canonicalJson(v.handoff));const {revision,...body}=v;v.revision=digest(canonicalJson(body));await assert.rejects(verifyStartupDemoPlan(v),code('DEMO_PLAN_CHANGED'));
 }
 let reads=0;await assert.rejects(verifyStartupDemoPlan({get binding(){reads++;return p.binding;}}),code('DEMO_PLAN_INVALID'));assert.equal(reads,0);
});
test('proposed two-owner task shape can be authored through the real offline validator',async t=>{
 const f=await fixture(t),p=await planStartupDemo(f.demoInput),project=join(f.parent,'separate-authoring');fs.cpSync('packages/workbench/reference-crews/craft-shop-control',project,{recursive:true});
 const tester=serializeTestManifest({format:'trellis/registered-test/v0.7-alpha',testId:'craft-shop-ui-v1',testerDigest:digest('synthetic fixture only; no live authority'),environmentDigest:digest('fixture environment'),criteria:['add-job','change-stage','reload','export'],limits:{timeoutMs:25000,outputBytes:16384,artifactBytes:65536}});
 fs.writeFileSync(join(project,'assets/test-manifest.json'),tester);
 const owner=id=>id==='emery'?'builder':'refiner',task=id=>id==='design'?'compose':'refine';
 const crew=parse(fs.readFileSync(join(project,'crew.yaml'),'utf8'));
 for(const o of crew.owners)o.id=owner(o.id);
 for(const item of crew.tasks){item.owner=owner(item.owner);item.id=task(item.id);item.dependsOn=item.dependsOn.map(task);for(const input of Object.values(item.inputs))if(input.source.task)input.source.task=task(input.source.task);}
 fs.writeFileSync(join(project,'crew.yaml'),stringify(crew));
 function edit(path,fn){const file=join(project,path),v=JSON.parse(fs.readFileSync(file,'utf8'));fn(v);fs.writeFileSync(file,JSON.stringify(v));}
 edit('skills/craft-ui.json',v=>v.owners=v.owners.map(owner));edit('maps/relay.json',v=>{v.participants=v.participants.map(owner);for(const r of v.routes){r.fromOwner=owner(r.fromOwner);r.toOwner=owner(r.toOwner);r.fromTask=task(r.fromTask);r.toTask=task(r.toTask);}});
 edit('maps/vines.json',v=>{for(const e of v.entries){e.owner=owner(e.owner);e.task=task(e.task);}});
 const bundle=await compileAuthoring(join(project,'authoring.json'),{scenarioFile:'packages/workbench/scenarios/craft-shop-v1/scenario.json'});
 assert.equal(bundle.scenarioDigest,p.handoff.scenario.digest);assert.deepEqual(bundle.plan.taskOrder,p.handoff.tasks.map(t=>t.id));
 for(const item of bundle.plan.definition.tasks){const proposed=p.handoff.tasks.find(t=>t.id===item.id);assert.equal(item.owner,proposed.owner);assert.equal(item.approval,proposed.approval);assert.equal(item.policy.maxAttempts,proposed.maxAttempts);assert.deepEqual(item.effects,proposed.requestedEffects);}
});
