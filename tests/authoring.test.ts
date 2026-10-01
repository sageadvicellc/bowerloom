import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, link, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
import { canonicalJson, digest } from '../packages/contracts/src/index.js';
import { authoredGraph, compileAuthoring, parseJson, validateAuthoredCrew } from '../packages/authoring/src/index.js';
import { serializeTestManifest } from '../packages/controlled-tests/src/index.js';

const reference = resolve('packages/workbench/reference-crews/craft-shop-control');
const scenarioFile = resolve('packages/workbench/scenarios/craft-shop-v1/scenario.json');
const tester = serializeTestManifest({ format:'trellis/registered-test/v0.7-alpha',testId:'craft-shop-ui-v1',
  testerDigest:digest('synthetic authoring tester; never real acceptance'),environmentDigest:digest('synthetic environment'),
  criteria:['add-job','change-stage','reload','export'],limits:{timeoutMs:25000,outputBytes:16384,artifactBytes:65536} });
async function fixture(body:(root:string,project:string)=>Promise<void>) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'trellis-authoring-'))),project=join(root,'project');
  try { await cp(reference,project,{recursive:true}); await writeFile(join(project,'assets/test-manifest.json'),tester);
    await body(root,project);
  } finally { await rm(root,{recursive:true,force:true}); }
}
const compile=(project:string)=>compileAuthoring(join(project,'authoring.json'),{scenarioFile});
async function jsonEdit(project:string,path:string,mutate:(v:any)=>void) {
  const target=join(project,path),value=JSON.parse(await readFile(target,'utf8'));mutate(value);await writeFile(target,JSON.stringify(value,null,2)+'\n');
}
async function crewEdit(project:string,mutate:(v:any)=>void) {
  const target=join(project,'crew.yaml'),value=parse(await readFile(target,'utf8'));mutate(value);await writeFile(target,stringify(value));
}

test('authored export binds source bytes, all maps, skills, scenario, and the existing crew candidate without runtime identity',async()=>fixture(async(root,project)=>{
  const a=await compile(project),b=await compile(project),scenario=await readFile(scenarioFile,'utf8');
  assert.deepEqual(a,b);assert.equal(Object.isFrozen(a),true);assert.equal(Object.isFrozen(a.assets),true);
  assert.deepEqual(Object.keys(a).sort(),['assets','authoringRevision','format','manifestAsset','plan','scenarioDigest']);
  assert.equal(a.scenarioDigest,digest(scenario));assert.equal(a.assets.scenario,scenario);
  const roundtrip=validateAuthoredCrew(JSON.parse(JSON.stringify(a)),scenario);assert.deepEqual(roundtrip,a);
  const graph=authoredGraph(a,scenario,{workspaceId:'operator-workspace',runId:'fresh-run',owners:{emery:{subject:'owner:a',epoch:4},coda:{subject:'owner:b',epoch:9}}});
  assert.equal(graph.plan.candidateRevision,a.plan.candidateRevision);assert.deepEqual(graph.owners,{emery:{subject:'owner:a',epoch:4},coda:{subject:'owner:b',epoch:9}});
  const relocated=join(root,'relocated');await cp(project,relocated,{recursive:true});assert.deepEqual(await compile(relocated),a);
  await writeFile(join(project,'skills/craft-ui.md'),a.assets['craft-ui']+'\nA literal source instruction: touch /outside/never-executed\n');
  const changed=await compile(project);assert.notEqual(changed.authoringRevision,a.authoringRevision);assert.notEqual(changed.plan.candidateRevision,a.plan.candidateRevision);
}));

test('reference names are optional: different role and task identities validate with matching declared maps',async()=>fixture(async(_root,project)=>{
  await crewEdit(project,value=>{value.id='personal-store';for(const owner of value.owners)owner.id=owner.id==='emery'?'maker':'reviewer';
    for(const task of value.tasks){task.owner=task.owner==='emery'?'maker':'reviewer';task.id=task.id==='design'?'compose':'polish';task.dependsOn=task.dependsOn.map(()=> 'compose');
      for(const input of Object.values(task.inputs) as any[])if(input.source.task)input.source.task='compose';}});
  await jsonEdit(project,'authoring.json',v=>{v.id='personal-store';});
  await jsonEdit(project,'skills/craft-ui.json',v=>{v.owners=['maker','reviewer'];});
  await jsonEdit(project,'maps/relay.json',v=>{v.participants=['maker','reviewer'];Object.assign(v.routes[0],{fromOwner:'maker',fromTask:'compose',toOwner:'reviewer',toTask:'polish'});});
  await jsonEdit(project,'maps/vines.json',v=>{for(const entry of v.entries){entry.owner=entry.owner==='emery'?'maker':'reviewer';entry.task=entry.task==='design'?'compose':'polish';}});
  const bundle=await compile(project);assert.deepEqual(bundle.plan.taskOrder,['compose','polish']);
}));

test('one authored owner can perform both tasks without dropping the accepted HTML handoff',async()=>fixture(async(_root,project)=>{
  await crewEdit(project,v=>{v.owners[0].permissions.push(v.owners[1].permissions[0]);v.owners=[v.owners[0]];v.tasks[1].owner='emery';});
  await jsonEdit(project,'skills/craft-ui.json',v=>{v.owners=['emery'];});
  await jsonEdit(project,'maps/relay.json',v=>{v.participants=['emery'];v.routes[0].toOwner='emery';});
  await jsonEdit(project,'maps/vines.json',v=>{v.entries[1].owner='emery';});
  const bundle=await compile(project);assert.equal(bundle.plan.definition.owners.length,1);
  assert.deepEqual(bundle.plan.definition.tasks[1]!.inputs.draft!.source,{task:'design',output:'draft'});
}));

const failures: [string,string,(v:any)=>void,string][]=[
  ['unknown authoring version','authoring.json',v=>{v.format='trellis/authoring/v99';},'AUTHORING_AUTHORING_SCHEMA'],
  ['unknown installation authority','authoring.json',v=>{v.credentials='worker-supplied';},'AUTHORING_AUTHORING_SCHEMA'],
  ['escaping crew path','authoring.json',v=>{v.crew='../crew.yaml';},'UNSAFE_PATH'],
  ['missing skill asset','authoring.json',v=>{v.skills=['missing'];},'AUTHORING_ASSET'],
  ['aliased role documents','authoring.json',v=>{v.vines=v.relay;},'AUTHORING_ASSET_ALIAS'],
  ['unknown skill owner','skills/craft-ui.json',v=>{v.owners.push('stranger');},'AUTHORING_SKILL_OWNERS'],
  ['missing declared skill owner','skills/craft-ui.json',v=>{v.owners=['coda'];},'AUTHORING_SKILL_OWNERS'],
  ['unsupported skill capability','skills/craft-ui.json',v=>{v.requiredCapabilities.push('workspace.read');},'AUTHORING_SKILL_SCHEMA'],
  ['missing skill instructions','skills/craft-ui.json',v=>{v.instructions='missing';},'AUTHORING_SKILL_BINDING'],
  ['unknown relay participant','maps/relay.json',v=>{v.participants.push('stranger');},'AUTHORING_RELAY_PARTICIPANTS'],
  ['unauthorized relay owner','maps/relay.json',v=>{v.routes[0].fromOwner='coda';},'AUTHORING_RELAY_ROUTE'],
  ['undeclared task endpoint','maps/relay.json',v=>{v.routes[0].toTask='missing';},'AUTHORING_RELAY_ROUTE'],
  ['undeclared output endpoint','maps/relay.json',v=>{v.routes[0].bindings[0].output='missing';},'AUTHORING_RELAY_ROUTE'],
  ['missing handoff route','maps/relay.json',v=>{v.routes=[];},'AUTHORING_RELAY_ROUTE'],
  ['arbitrary socket transport','maps/relay.json',v=>{v.routes[0].socket='/tmp/worker.sock';},'AUTHORING_RELAY_SCHEMA'],
  ['vines remote sink','maps/vines.json',v=>{v.entries[0].sink='https://example.test';},'AUTHORING_VINES_SCHEMA'],
  ['vines unsupported logging channel','maps/vines.json',v=>{v.entries[0].evidence[0]='provider.tokens';},'AUTHORING_VINES_SCHEMA'],
  ['vines hidden task','maps/vines.json',v=>{v.entries[0].task='missing';},'AUTHORING_VINES_ROUTE'],
  ['vines owner mismatch','maps/vines.json',v=>{v.entries[0].owner='coda';},'AUTHORING_VINES_ROUTE'],
  ['vines self-improvement','maps/vines.json',v=>{v.purpose='self-improvement';},'AUTHORING_VINES_SCHEMA'],
  ['vines missing task log','maps/vines.json',v=>{v.entries.pop();},'AUTHORING_VINES_ROUTE'],
];
for(const[name,path,mutate,code]of failures)test(`authoring refuses ${name} before export`,async()=>fixture(async(_root,project)=>{
  await jsonEdit(project,path,mutate);await assert.rejects(compile(project),{code});
}));

test('duplicate JSON keys, reserved prototype keys, getters, excessive depth, and oversized map bytes are rejected',()=>{
  for(const bytes of ['{"format":"old","format":"new"}','{"__proto__":{}}','{"x":'+ '['.repeat(50)+'0'+']'.repeat(50)+'}', '{"x":"'+ 'a'.repeat(32768)+'"}'])assert.throws(()=>parseJson(bytes));
  let reads=0;const bad={get format(){reads++;return 'trellis/authored-crew/v0.7-alpha';}};
  assert.throws(()=>validateAuthoredCrew(bad,'{}'));assert.equal(reads,0);
});

test('altered snapshot bytes, forged export digest, extra fields, or runtime bindings cannot survive export revalidation',async()=>fixture(async(_root,project)=>{
  const bundle=await compile(project),scenario=await readFile(scenarioFile,'utf8');
  for(const mutate of [v=>{v.assets.orders+=' ';},v=>{v.scenarioDigest=digest('other');},v=>{v.authoringRevision=digest('forged');},v=>{v.runtimeIdentity='worker';} ] as ((v:any)=>void)[]){
    const copy=JSON.parse(JSON.stringify(bundle));mutate(copy);assert.throws(()=>validateAuthoredCrew(copy,scenario));
  }
  const forged=JSON.parse(JSON.stringify(bundle));forged.assets.orders+=' ';const{authoringRevision,...body}=forged;
  forged.authoringRevision=digest(canonicalJson(body));assert.throws(()=>validateAuthoredCrew(forged,scenario),{code:'ASSET_MISMATCH'});
  assert.throws(()=>authoredGraph(bundle,scenario,{workspaceId:'w',runId:'r',owners:{emery:{subject:'e',epoch:1}}}),{code:'INVALID_INPUT'});
  for(const malformed of [null,{},[],{definition:null},{definition:{owners:[]}}]) {
    const invalid=JSON.parse(JSON.stringify(bundle));invalid.plan=malformed;const{authoringRevision,...data}=invalid;
    invalid.authoringRevision=digest(canonicalJson(data));assert.throws(()=>validateAuthoredCrew(invalid,scenario),error=>error instanceof Error && !(error instanceof TypeError));
  }
}));

test('the independently selected frozen scenario prevents changed brief/data, constraints, or tester substitution',async()=>fixture(async(_root,project)=>{
  const original=await compile(project);await writeFile(join(project,'assets/project-brief.md'),'A different project.');
  await assert.rejects(compile(project),{code:'AUTHORING_SCENARIO_INPUT'});
  await jsonEdit(project,'assets/scenario.json',v=>{v.brief.digest=digest('A different project.');v.brief.bytes=20;});
  await assert.rejects(compile(project),{code:'AUTHORING_SCENARIO_BINDING'});
  assert.equal(original.assets['test-manifest'],tester);
  await writeFile(join(project,'assets/scenario.json'),await readFile(scenarioFile));
  await writeFile(join(project,'assets/project-brief.md'),original.assets['project-brief']!);
  await writeFile(join(project,'assets/test-manifest.json'),tester+'\n');await assert.rejects(compile(project),{code:'INVALID_MANIFEST'});
}));

test('execution shapes still require registered acceptance, exact approval, bounded attempts, and pinned scenario inputs',async()=>{
  for(const mutate of [
    (v:any)=>{v.tasks[0].policy.maxAttempts=2;v.tasks[0].policy.deadlineSeconds=1800;},
    (v:any)=>{v.tasks[0].approval='none';},
    (v:any)=>{v.tasks[0].effects=v.tasks[0].effects.filter((e:any)=>e.operation!=='command.test');v.tasks[0].requires=v.tasks[0].requires.filter((c:any)=>c!=='command.test');},
    (v:any)=>{delete v.tasks[0].inputs.brief;},
    (v:any)=>{v.requiredCapabilities.push('native.shell');},
    (v:any)=>{delete v.tasks[1].inputs.draft;},
    (v:any)=>{delete v.tasks[1].inputs.draft;v.tasks[1].dependsOn=[];},
    (v:any)=>{v.tasks=[v.tasks[0]];},
    (v:any)=>{v.tasks.push({...structuredClone(v.tasks[1]),id:'third'});},
    (v:any)=>{v.tasks[0].effects[0].path='output/another/index.html';v.owners[0].permissions[0].path='output/another/index.html';v.scope[0].path='output/another/index.html';},
    (v:any)=>{v.tasks[1].effects[0].path=v.tasks[0].effects[0].path;v.owners[1].permissions[0].path=v.tasks[0].effects[0].path;},
  ])await fixture(async(_root,project)=>{await crewEdit(project,mutate);await assert.rejects(compile(project));});
});

test('missing, symlinked, hard-linked, escaping, oversized and binary source assets never export',async()=>{
  await fixture(async(_root,project)=>{await rm(join(project,'skills/craft-ui.md'));await assert.rejects(compile(project));});
  await fixture(async(root,project)=>{await writeFile(join(root,'outside'),'outside');await rm(join(project,'skills/craft-ui.md'));await symlink(join(root,'outside'),join(project,'skills/craft-ui.md'));await assert.rejects(compile(project));});
  await fixture(async(root,project)=>{await writeFile(join(root,'outside'),'outside');await rm(join(project,'skills/craft-ui.md'));await link(join(root,'outside'),join(project,'skills/craft-ui.md'));await assert.rejects(compile(project),{code:'AUTHORING_FILE_TYPE'});});
  await fixture(async(_root,project)=>{await crewEdit(project,v=>{v.assets['craft-ui'].path='../outside';});await assert.rejects(compile(project),{code:'UNSAFE_PATH'});});
  await fixture(async(_root,project)=>{await writeFile(join(project,'skills/craft-ui.md'),'x'.repeat(65537));await assert.rejects(compile(project),{code:'AUTHORING_LIMIT'});});
  await fixture(async(_root,project)=>{await writeFile(join(project,'maps/relay.json'),Buffer.from([0xff]));await assert.rejects(compile(project),{code:'AUTHORING_ENCODING'});});
});

test('offline CLI validates and exports portable bytes and rejects execution flags',async()=>fixture(async(_root,project)=>{
  const cli=resolve('dist/apps/cli/src/main.js'),args=[join(project,'authoring.json'),'--scenario',scenarioFile];
  const run=(command:string,extra:string[]=[])=>spawnSync(process.execPath,[cli,'authoring',command,...args,...extra],{encoding:'utf8',timeout:10000,maxBuffer:2*1024*1024});
  const checked=run('validate');assert.equal(checked.status,0,checked.stderr);const summary=JSON.parse(checked.stdout);
  assert.equal(summary.executionAuthorized,false);assert.equal(summary.tasks,2);
  const exported=run('export');assert.equal(exported.status,0,exported.stderr);
  const bundle=validateAuthoredCrew(JSON.parse(exported.stdout),await readFile(scenarioFile,'utf8'));
  assert.equal(bundle.authoringRevision,summary.authoringRevision);
  for(const extra of [['--installation','/never-read'],['--root',project,'--root',project],['--paid-fallback']]){
    const denied=run('export',extra);assert.equal(denied.status,2);assert.equal(JSON.parse(denied.stderr).error.code,'USAGE');
  }
}));
