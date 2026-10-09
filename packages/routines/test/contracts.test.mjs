import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {validateRoutine,parseRoutine,exportRoutine,routineDependencyDigest,planRoutine,RoutineError,ROUTINE_LIMITS} from '../../../dist/packages/routines/src/index.js';
import {scaffold} from '../../../dist/packages/startup/src/scaffold.js';
const clone=value=>structuredClone(value);
const hash=content=>routineDependencyDigest(content);
function fixture(){
  const files=scaffold({projectName:'Synthetic routine',goal:'Review a synthetic draft',assistantName:'Personal assistant',teamName:'Editorial',reviewMode:'milestones',profile:'engineer'}).files;
  const dependencies=[
    {kind:'recipe',ref:'recipes/labs-to-blog/recipe.json',content:JSON.stringify({format:'trellis/recipe/labs-to-blog/v1',id:'labs-blog',sourceRevision:'a'.repeat(40),github:{host:'github.com',owner:'synthetic-labs',repo:'synthetic-blog',baseBranch:'main',branchPrefix:'trellis/labs-blog/draft',draftPath:'blog/draft.md',evidencePrefix:'labs'}})},
    {kind:'team',ref:'teams/editorial/team.yaml',content:files.find(f=>f.path==='teams/first-team/team.yaml').text},
    {kind:'skill',ref:'skills/evidence-summary/SKILL.md',content:'# Evidence summary\nUse only the supplied synthetic evidence.\n'},
    {kind:'connection',ref:'connections/github-publication.json',content:JSON.stringify({format:'bowerloom/mcp-declaration/v1beta1',connectionId:'github-publication',protocolVersion:'2025-11-25',transport:'streamable-http',tools:[{name:'read_selected_record',permissionClass:'read-only'},{name:'propose_draft_pr',permissionClass:'external-write'}]})}
  ];
  const pin=kind=>{const d=dependencies.find(d=>d.kind===kind);return{ref:d.ref,digest:hash(d.content)}};
  const routine={format:'bowerloom/routine/v1beta1',id:'labs-to-blog',version:'1.0.0',inputs:{experiment:{type:'resource-reference'}},outputs:{draft:{type:'artifact',mediaType:'text/markdown'}},implementation:{kind:'registered-recipe',id:'labs-to-blog-v1',...pin('recipe')},team:pin('team'),skills:[pin('skill')],connections:[pin('connection')],review:{beforeEffects:'exact-action-approval',completion:'founder-review'},limits:{maxActiveWorkers:2,maxAttempts:1,deadlineSeconds:1800,paidFallback:false},invocation:'manual'};
  return{routine,dependencies,inputs:{experiment:{id:'synthetic-experiment',digest:'sha256:'+'b'.repeat(64)}}};
}
const rejects=(fn,code)=>assert.throws(fn,e=>e instanceof RoutineError && (code?e.code===code:/^ROUTINE_[A-Z_]+$/.test(e.code)) && e.message===e.code);
function repin(f,kind){const d=f.dependencies.find(d=>d.kind===kind);const pin=kind==='recipe'?f.routine.implementation:kind==='team'?f.routine.team:kind==='skill'?f.routine.skills[0]:f.routine.connections[0];pin.digest=hash(d.content);}
test('closed routine validation and deterministic export/import preserve semantic definition',()=>{
  const {routine}=fixture();const text=exportRoutine(routine);assert.equal(text,exportRoutine(parseRoutine(text)));
  assert.deepEqual(parseRoutine(text),validateRoutine(routine));assert.equal(text.endsWith('\n'),true);
  assert.deepEqual(parseRoutine(JSON.stringify(routine,null,4)),validateRoutine(routine));
});
test('plan pins every supplied direct dependency and input without granting authority or exporting contents',()=>{
  const f=fixture(),p=planRoutine(f);assert.equal(p.status,'planning-only');assert.equal(p.dependencyPins.length,4);
  for(const pin of p.dependencyPins){const source=f.dependencies.find(d=>d.kind===pin.kind&&d.ref===pin.ref);assert.equal(pin.digest,hash(source.content));assert.equal(pin.bytes,Buffer.byteLength(source.content));assert.equal('content'in pin,false);}
  for(const key of ['executionAuthorized','effectsAuthorized','authenticationVerified','runtimePortabilityVerified','transitiveClosureVerified'])assert.equal(p[key],false);
  assert.deepEqual(p.grants,[]);assert.equal(JSON.stringify(p).includes('synthetic-blog'),false);
  assert.equal(JSON.stringify(p).includes('# Evidence summary'),false);assert.match(p.revision,/^sha256:[a-f0-9]{64}$/);
});
test('object key and dependency ordering do not alter export or planning revision',()=>{
  const a=fixture(),b=clone(a);b.routine=Object.fromEntries(Object.entries(b.routine).reverse());b.dependencies.reverse();
  assert.equal(exportRoutine(a.routine),exportRoutine(b.routine));assert.deepEqual(planRoutine(a),planRoutine(b));
  const extra={kind:'skill',ref:'skills/draft-review/SKILL.md',content:'# Review\nSeparate assumptions from evidence.\n'};
  a.dependencies.push(extra);a.routine.skills.push({ref:extra.ref,digest:hash(extra.content)});const c=clone(a);c.routine.skills.reverse();c.dependencies.reverse();assert.deepEqual(planRoutine(a),planRoutine(c));
});
test('changed dependency bytes refuse stale pins; repinning changes plan revision',()=>{
  for(const kind of ['recipe','team','skill','connection']){
    const f=fixture(),prior=planRoutine(f).revision;f.dependencies.find(d=>d.kind===kind).content+='\n';
    rejects(()=>planRoutine(f),'ROUTINE_DEPENDENCY_DRIFT');repin(f,kind);assert.notEqual(planRoutine(f).revision,prior);
  }
});
test('changed input and bounded policy values change the plan revision',()=>{
  const f=fixture(),old=planRoutine(f).revision;f.inputs.experiment.digest='sha256:'+'c'.repeat(64);assert.notEqual(planRoutine(f).revision,old);
  const a=fixture();a.inputs.experiment.id='other-experiment';assert.notEqual(planRoutine(a).revision,old);
  for(const key of ['maxActiveWorkers','deadlineSeconds']){const b=fixture();b.routine.limits[key]=1;assert.notEqual(planRoutine(b).revision,old);}
});
test('missing, extra, duplicate and kind/ref collision records refuse before a plan exists',()=>{
  const f=fixture();for(const index of [0,1,2,3]){const x=clone(f);x.dependencies.splice(index,1);rejects(()=>planRoutine(x),'ROUTINE_DEPENDENCY_SET');}
  const duplicate=clone(f);duplicate.dependencies.push(clone(duplicate.dependencies[0]));rejects(()=>planRoutine(duplicate),'ROUTINE_DUPLICATE');
  const extra=clone(f);extra.dependencies.push({kind:'skill',ref:'skills/extra/SKILL.md',content:'Extra'});rejects(()=>planRoutine(extra),'ROUTINE_DEPENDENCY_SET');
  const collision=clone(f);collision.dependencies[1].kind='skill';rejects(()=>planRoutine(collision),'ROUTINE_REFERENCE');
  const refs=clone(f);refs.routine.skills.push(clone(refs.routine.skills[0]));rejects(()=>validateRoutine(refs.routine),'ROUTINE_DUPLICATE');
});
test('unsupported recipe, graph, automatic invocation, effects and installed fields are refused',()=>{
  const f=fixture();
  for(const field of ['schedule','trigger','run','state','approval','credentials','endpoint','token','command','bindings']){const x=clone(f.routine);x[field]='private-marker';rejects(()=>validateRoutine(x),'ROUTINE_SCHEMA');}
  for(const invocation of ['scheduled','event','automatic'])rejects(()=>validateRoutine({...f.routine,invocation}),'ROUTINE_UNSUPPORTED');
  for(const patch of [{kind:'compiled-crew'},{id:'arbitrary-recipe'},{command:'run'}])rejects(()=>validateRoutine({...f.routine,implementation:{...f.routine.implementation,...patch}}));
  rejects(()=>planRoutine({...f,executionAuthorized:true}),'ROUTINE_SCHEMA');
  rejects(()=>planRoutine({...f,inputs:{experiment:{...f.inputs.experiment,content:'raw private record'}}}),'ROUTINE_SCHEMA');
});
test('portable paths refuse absolute, escape, hidden, private, encoded and host-installed locations',()=>{
  const f=fixture();for(const ref of ['/tmp/team.yaml','../team.yaml','teams/../team.yaml','teams//team.yaml','teams/a/../../../team.yaml','~/.codex/config.toml','C:\\Users\\test\\team.yaml','teams/%2e%2e/team.yaml','.bowerloom/teams/a/team.yaml','teams/private/team.yaml','teams/credentials/team.yaml','teams/runtime/team.yaml','teams/a/installation-receipt.json']){
    rejects(()=>validateRoutine({...f.routine,team:{...f.routine.team,ref}}),'ROUTINE_REFERENCE');
  }
});
test('malformed or repinned private dependency content is refused',()=>{
  for(const kind of ['recipe','team','connection']){const f=fixture();f.dependencies.find(d=>d.kind===kind).content='{}';repin(f,kind);rejects(()=>planRoutine(f),'ROUTINE_DEPENDENCY_CONTENT');}
  const f=fixture();const d=f.dependencies.find(d=>d.kind==='connection');const c=JSON.parse(d.content);c.endpoint='https://private.example.test';d.content=JSON.stringify(c);repin(f,'connection');rejects(()=>planRoutine(f),'ROUTINE_DEPENDENCY_CONTENT');
  for(const content of ['password: private-marker','access_token=private-marker','Bearer syntheticToken1234','ghp_syntheticToken123456','-----BEGIN PRIVATE KEY-----','Use /tmp/private/installation.json','Use /Users/example/.codex/config.toml']){
    const x=fixture();x.dependencies.find(d=>d.kind==='skill').content=content;repin(x,'skill');rejects(()=>planRoutine(x),'ROUTINE_DEPENDENCY_CONTENT');
  }
});
test('strict JSON refuses duplicate fields, invalid Unicode, trailing data, depth and size attacks',()=>{
  const text=exportRoutine(fixture().routine);
  for(const bad of [text.replace('"id":"labs-to-blog"','"id":"labs-to-blog","id":"labs-to-blog"'),text+'{}','{"x":"\\ud800"}', '['.repeat(60)+']'.repeat(60),' '.repeat(ROUTINE_LIMITS.definitionBytes+1), '\ufeff'+text])rejects(()=>parseRoutine(bad),'ROUTINE_JSON');
});
test('getters, serialization hooks, custom prototypes, proxies, symbols, sparse arrays and cycles stay inert',()=>{
  let called=0;const x=fixture().routine;Object.defineProperty(x,'version',{get(){called++;throw Error('SECRET');},enumerable:true});rejects(()=>validateRoutine(x));assert.equal(called,0);
  const proxy=new Proxy({}, {getPrototypeOf(){called++;throw Error('SECRET');}});rejects(()=>validateRoutine(proxy));assert.equal(called,0);
  const f=fixture();f.dependencies[0]=proxy;rejects(()=>planRoutine(f));assert.equal(called,0);
  const hook=fixture().routine;hook.toJSON=()=>{called++;return {}};rejects(()=>exportRoutine(hook));assert.equal(called,0);
  const proto=Object.create({leak:'SECRET'});rejects(()=>validateRoutine(proto));
  const symbol=fixture().routine;symbol[Symbol('SECRET')]=1;rejects(()=>validateRoutine(symbol));
  const sparse=fixture().routine;sparse.skills=new Array(2);rejects(()=>validateRoutine(sparse));
  const cyclic=fixture().routine;cyclic.cycle=cyclic;rejects(()=>validateRoutine(cyclic));
});
test('bounds refuse excess concurrency, attempts, deadlines, text and dependency counts',()=>{
  const f=fixture();for(const patch of [{maxActiveWorkers:3},{maxActiveWorkers:0},{maxAttempts:3},{maxAttempts:NaN},{deadlineSeconds:1801},{deadlineSeconds:1.5},{paidFallback:true}])rejects(()=>validateRoutine({...f.routine,limits:{...f.routine.limits,...patch}}));
  rejects(()=>routineDependencyDigest('x'.repeat(ROUTINE_LIMITS.dependencyBytes+1)),'ROUTINE_BOUND');
  const x=clone(f);x.dependencies=Array.from({length:27},()=>f.dependencies[0]);rejects(()=>planRoutine(x),'ROUTINE_BOUND');
  for(const version of ['01.0.0','1.0','1.0.0-beta','10000.0.0'])rejects(()=>validateRoutine({...f.routine,version}),'ROUTINE_VERSION');
});
test('returned definitions and plans do not alias caller data',()=>{
  const f=fixture(),v=validateRoutine(f.routine),p=planRoutine(f),revision=p.revision;f.routine.skills[0].digest='sha256:'+'d'.repeat(64);f.inputs.experiment.id='mutated';
  assert.notEqual(v.skills[0].digest,f.routine.skills[0].digest);assert.equal(p.inputs.experiment.id,'synthetic-experiment');assert.equal(p.revision,revision);
  v.team.ref='mutated';assert.equal(p.routine.team.ref,'teams/editorial/team.yaml');
});
test('routine implementation has no filesystem/network/process APIs or execution method',async()=>{
  const source=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/from ['"]node:(?:fs|http|https|net|child_process)|\b(?:fetch|spawn|execFile|writeFile|readFile)\s*\(/);
  const api=await import('../../../dist/packages/routines/src/index.js');assert.deepEqual(Object.keys(api).sort(),['ROUTINE_FORMAT','ROUTINE_LIMITS','RoutineError','exportRoutine','parseRoutine','planRoutine','routineDependencyDigest','validateRoutine'].sort());
});

test('valid planning succeeds with filesystem, process and network effect APIs denied after import',()=>{
  const f=fixture();
  const source=`
    import {planRoutine} from './dist/packages/routines/src/index.js';
    import fs from 'node:fs'; import fsp from 'node:fs/promises'; import cp from 'node:child_process';
    import net from 'node:net'; import http from 'node:http'; import https from 'node:https';
    import {syncBuiltinESMExports} from 'node:module';
    const deny=()=>{throw new Error('UNEXPECTED_SIDE_EFFECT')};
    for(const mod of [fs,fsp,cp,net,http,https])for(const name of Object.keys(mod)){
      if(typeof mod[name]==='function' && /^(?:read|write|open|access|stat|lstat|realpath|mkdir|rm|unlink|rename|copy|append|watch|create|spawn|exec|fork|connect|request|get)/.test(name))mod[name]=deny;
    }
    globalThis.fetch=deny;syncBuiltinESMExports();
    const plan=planRoutine(${JSON.stringify(f)});
    if(plan.executionAuthorized!==false||plan.dependencyPins.length!==4)throw new Error('BAD_PLAN');
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',source],{cwd:new URL('../../../',import.meta.url),encoding:'utf8',env:{},timeout:10000});
  assert.equal(result.status,0,result.stderr);
});
