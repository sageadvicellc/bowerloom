import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path, { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { parseRoutineYaml, exportRoutineYaml, loadRoutineFiles, RoutineFilesError } from '../../../dist/packages/routines/src/files.js';
import { planRoutine, validateRoutine } from '../../../dist/packages/routines/src/index.js';
import { scaffold } from '../../../dist/packages/startup/src/scaffold.js';

const sha = x => 'sha256:' + createHash('sha256').update(x).digest('hex');
const routinePath = 'routines/labs-to-blog.yaml';
function data() {
  const files = scaffold({projectName:'Synthetic routine',goal:'Review a synthetic draft',assistantName:'Personal assistant',teamName:'Editorial',reviewMode:'milestones',profile:'engineer'}).files;
  const dependencies = [
    {kind:'recipe',ref:'recipes/labs-to-blog/recipe.json',content:JSON.stringify({format:'trellis/recipe/labs-to-blog/v1',id:'labs-blog',sourceRevision:'a'.repeat(40),github:{host:'github.com',owner:'synthetic-labs',repo:'synthetic-blog',baseBranch:'main',branchPrefix:'trellis/labs-blog/draft',draftPath:'blog/draft.md',evidencePrefix:'labs'}})},
    {kind:'team',ref:'teams/editorial/team.yaml',content:files.find(f=>f.path==='teams/first-team/team.yaml').text},
    {kind:'skill',ref:'skills/evidence-summary/SKILL.md',content:'# Evidence summary\nReview the supplied synthetic evidence. Café 🌱.\n'},
    {kind:'connection',ref:'connections/github-publication.json',content:JSON.stringify({format:'bowerloom/mcp-declaration/v1beta1',connectionId:'github-publication',protocolVersion:'2025-11-25',transport:'streamable-http',tools:[{name:'read_selected_record',permissionClass:'read-only'},{name:'propose_draft_pr',permissionClass:'external-write'}]})}
  ];
  const pin=kind=>{const d=dependencies.find(d=>d.kind===kind);return{ref:d.ref,digest:sha(d.content)}};
  const routine={format:'bowerloom/routine/v1beta1',id:'labs-to-blog',version:'1.0.0',inputs:{experiment:{type:'resource-reference'}},outputs:{draft:{type:'artifact',mediaType:'text/markdown'}},implementation:{kind:'registered-recipe',id:'labs-to-blog-v1',...pin('recipe')},team:pin('team'),skills:[pin('skill')],connections:[pin('connection')],review:{beforeEffects:'exact-action-approval',completion:'founder-review'},limits:{maxActiveWorkers:2,maxAttempts:1,deadlineSeconds:1800,paidFallback:false},invocation:'manual'};
  return {routine,dependencies,inputs:{experiment:{id:'synthetic-experiment',digest:'sha256:'+'b'.repeat(64)}}};
}
async function fixture(t, d=data()) {
  const fixtureBase=process.env.BOWERLOOM_ROUTINE_TEST_FIXTURES ?? tmpdir();
  const parent=await fs.mkdtemp(join(await fs.realpath(fixtureBase),'bowerloom-routine-files-'));
  const root=join(parent,'.bowerloom'); await fs.mkdir(root,{mode:0o700});
  // Retain synthetic fixture evidence; no cleanup of existing or newly created directories.
  const write=async(ref,content)=>{const p=join(root,ref);await fs.mkdir(dirname(p),{recursive:true,mode:0o755});await fs.writeFile(p,content,{mode:0o644});};
  await write(routinePath,exportRoutineYaml(d.routine));
  for(const f of d.dependencies)await write(f.ref,f.content);
  await write('ignored-private-file.txt','Unreferenced synthetic contents stay unread.');
  return {...d,root,parent,write};
}
async function snapshot(root) {
  const out=[];
  async function walk(dir,relative='') {
    for(const name of (await fs.readdir(dir)).sort()) {
      const path=join(dir,name),ref=relative?relative+'/'+name:name,s=await fs.lstat(path);
      out.push({ref,mode:s.mode,type:s.isDirectory()?'directory':s.isSymbolicLink()?'link':'file',...(s.isFile()?{digest:sha(await fs.readFile(path))}:s.isSymbolicLink()?{target:await fs.readlink(path)}:{})});
      if(s.isDirectory())await walk(path,ref);
    }
  }
  await walk(root);return out;
}
function refusal(code) { return e=>e instanceof RoutineFilesError&&e.code===`ROUTINE_FILES_${code}`&&e.message===e.code&&!e.stack.includes('PRIVATE_MESSAGE'); }
const rejects=(fn,code)=>assert.rejects(fn,refusal(code));
function patch(t,name,fn) { const old=fs[name];fs[name]=fn(old);syncBuiltinESMExports();t.after(()=>{fs[name]=old;syncBuiltinESMExports();});return old; }
function repin(d,kind) {const f=d.dependencies.find(v=>v.kind===kind);const p=kind==='recipe'?d.routine.implementation:kind==='team'?d.routine.team:kind==='skill'?d.routine.skills[0]:d.routine.connections[0];p.digest=sha(f.content);}

test('strict YAML is equivalent to unchanged JSON planner and export is deterministic',()=>{
  const d=data(),text=exportRoutineYaml(d.routine);
  assert.deepEqual(parseRoutineYaml(text),validateRoutine(d.routine));
  assert.equal(exportRoutineYaml(parseRoutineYaml(text)),text);
  assert.deepEqual(parseRoutineYaml(JSON.stringify(d.routine)),parseRoutineYaml(text));
  assert.equal(text.endsWith('\n'),true);
});
test('actual stable two-pass reads preserve all source files and authority limits',async t=>{
  const f=await fixture(t),before=await snapshot(f.root); let reads=0;
  patch(t,'open',old=>async(path,...args)=>{assert.notEqual(path,join(f.root,'ignored-private-file.txt'));reads++;assert.equal(args[0],constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);return old(path,...args);});
  const result=await loadRoutineFiles(f.root,f.inputs);
  assert.equal(reads,10);assert.deepEqual(result.plan,planRoutine({routine:f.routine,dependencies:f.dependencies,inputs:f.inputs}));
  assert.equal(result.files.length,5);assert.deepEqual(await snapshot(f.root),before);
  for(const entry of result.files){const bytes=await fs.readFile(join(f.root,entry.ref));assert.equal(entry.digest,sha(bytes));assert.equal(entry.bytes,bytes.length);}
  for(const key of ['executionAuthorized','effectsAuthorized','simultaneousSnapshotVerified','installedBindingVerified'])assert.equal(result[key],false);
  for(const key of ['executionAuthorized','effectsAuthorized','authenticationVerified','transitiveClosureVerified','runtimePortabilityVerified'])assert.equal(result.plan[key],false);
  assert.deepEqual(result.plan.grants,[]);assert.equal(JSON.stringify(result).includes(f.root),false);
  const first=result.revision;result.plan.routine.version='9.9.9';assert.equal((await loadRoutineFiles(f.root,f.inputs)).revision,first);
});
test('formatting changes byte identity but not semantic plan; dependency changes refuse',async t=>{
  const f=await fixture(t),a=await loadRoutineFiles(f.root,f.inputs);
  await fs.appendFile(join(f.root,routinePath),'# harmless layout comment\n');
  const b=await loadRoutineFiles(f.root,f.inputs);assert.equal(a.plan.revision,b.plan.revision);assert.notEqual(a.revision,b.revision);
  const changed=data();changed.dependencies[2].content+='changed\n'; // Deliberately preserve the old declared digest.
  const g=await fixture(t,changed),before=await snapshot(g.root);
  await rejects(()=>loadRoutineFiles(g.root,g.inputs),'DEPENDENCY');assert.deepEqual(await snapshot(g.root),before);
});
test('routine BOM preserves exact inventory; dependency BOM cannot silently change planner hashes',async t=>{
  const f=await fixture(t);const source=Buffer.from('\ufeff'+exportRoutineYaml(f.routine));await f.write(routinePath,source);
  const r=await loadRoutineFiles(f.root,f.inputs),entry=r.files.find(v=>v.kind==='routine');assert.equal(entry.digest,sha(source));assert.equal(entry.bytes,source.length);
  const d=data();d.dependencies[2].content='\ufeff'+d.dependencies[2].content;repin(d,'skill');const g=await fixture(t,d);
  // The unchanged planner refuses Cf/BOM in dependency content. Acceptance by normalization would be a defect.
  await rejects(()=>loadRoutineFiles(g.root,g.inputs),'DEPENDENCY');
});
test('invalid UTF-8 and nonroundtripping primitive strings refuse',async t=>{
  const f=await fixture(t);await f.write(f.dependencies[2].ref,Buffer.from([0xc3,0x28]));await rejects(()=>loadRoutineFiles(f.root,f.inputs),'INPUT');
  assert.throws(()=>parseRoutineYaml('\ud800'),refusal('INPUT'));assert.throws(()=>parseRoutineYaml({toString(){throw Error('PRIVATE_MESSAGE')}}),refusal('INPUT'));
});
test('multibyte byte bounds and inventory use UTF-8 bytes, not character count',async t=>{
  const d=data();d.dependencies[2].content='é'.repeat(131072);repin(d,'skill');const f=await fixture(t,d);
  const p=await loadRoutineFiles(f.root,f.inputs);const a=p.files.find(v=>v.kind==='skill'),b=p.plan.dependencyPins.find(v=>v.kind==='skill');assert.equal(a.bytes,262144);assert.equal(a.digest,b.digest);assert.equal(a.bytes,b.bytes);
  await fs.appendFile(join(f.root,f.dependencies[2].ref),'é');await rejects(()=>loadRoutineFiles(f.root,f.inputs),'BOUND');
  assert.throws(()=>parseRoutineYaml('#'+ 'é'.repeat(32768)),refusal('BOUND'));
});
for(const [name,suffix] of [
  ['duplicate keys','id: labs-to-blog\nid: labs-to-blog\n'], ['alias','a: &x hello\nb: *x\n'],
  ['tag','a: !!str hello\n'],['merge','a: {<<: {b: 1}}\n'],['multiple documents','---\na: 1\n---\nb: 2\n'],
  ['nonstring key','1: value\n'],['version','%YAML 1.1\n---\na: 1\n'],['tag directive','%TAG !e! tag:example.com,2000:app/\n---\na: 1\n'],
  ['redefined standard tag','%TAG !! tag:example.com,2000:app/\n---\na: 1\n'],['parse error','a: [\n']
])test(`YAML refuses ${name}`,()=>assert.throws(()=>parseRoutineYaml(suffix),refusal('YAML')));
test('AST depth, node and container bounds precede schema conversion',()=>{
  assert.throws(()=>parseRoutineYaml('a: '+ '['.repeat(25)+'0'+']'.repeat(25)),refusal('BOUND'));
  assert.throws(()=>parseRoutineYaml('a: ['+Array(129).fill('0').join(',')+']'),refusal('BOUND'));
  const many=Array(90).fill('['+Array(90).fill('0').join(',')+']').join(',');assert.throws(()=>parseRoutineYaml('a: ['+many+']'),refusal('BOUND'));
  assert.throws(()=>parseRoutineYaml(''),refusal('DEFINITION'));
});
test('closed definition rejects commands/unknown keys/forbidden references and malformed inputs',async t=>{
  const d=data();assert.throws(()=>exportRoutineYaml({...d.routine,command:'run'}),refusal('DEFINITION'));
  for(const ref of ['../outside','/private/file','teams/%2e%2e/team.yaml','teams/a/../b/team.yaml','teams/a\\team.yaml'])assert.throws(()=>exportRoutineYaml({...d.routine,team:{...d.routine.team,ref}}),refusal('DEFINITION'));
  const f=await fixture(t);for(const root of ['relative',f.root+'/',dirname(f.root),f.root+'/../.bowerloom'])await rejects(()=>loadRoutineFiles(root,f.inputs),'PATH');
  for(const inputs of [{...f.inputs,extra:true},{experiment:{id:'state',digest:'sha256:'+'a'.repeat(64)}},{experiment:{id:'ok',digest:'bad'}}])await rejects(()=>loadRoutineFiles(f.root,inputs),'INPUT');
});
test('Proxy/accessor inputs and export values do not execute traps',async t=>{
  const f=await fixture(t);let traps=0;const handler={get(){traps++;},getPrototypeOf(){traps++;},ownKeys(){traps++;},getOwnPropertyDescriptor(){traps++;}};
  for(const value of [new Proxy(f.inputs,handler),{experiment:new Proxy(f.inputs.experiment,handler)},{get experiment(){traps++;return f.inputs.experiment;}}])await rejects(()=>loadRoutineFiles(f.root,value),'INPUT');
  assert.throws(()=>exportRoutineYaml(new Proxy(f.routine,handler)),refusal('DEFINITION'));assert.equal(traps,0);
});
test('caller mutation during pending IO cannot change captured experiment',async t=>{
  const f=await fixture(t),original=structuredClone(f.inputs);let release,entered;const ready=new Promise(r=>entered=r),pending=new Promise(r=>release=r);let intercepted=false;
  patch(t,'lstat',old=>async(...args)=>{if(!intercepted){intercepted=true;entered();await pending;}return old(...args);});
  const loading=loadRoutineFiles(f.root,f.inputs);await ready;f.inputs.experiment.id='changed-after-call';f.inputs.experiment.digest='sha256:'+'c'.repeat(64);release();assert.deepEqual((await loading).plan.inputs,original);
});
for(const kind of ['missing','directory','hardlink','symlink-leaf','symlink-parent','mode','parent-mode'])test(`filesystem refuses ${kind} without writes`,async t=>{
  const f=await fixture(t),file=join(f.root,f.dependencies[2].ref);
  if(kind==='missing')await fs.unlink(file);
  if(kind==='directory'){await fs.unlink(file);await fs.mkdir(file);}
  if(kind==='hardlink')await fs.link(file,join(f.parent,'hardlink'));
  if(kind==='symlink-leaf'){await fs.rename(file,join(f.parent,'target'));await fs.symlink(join(f.parent,'target'),file);}
  if(kind==='symlink-parent'){const p=dirname(file);await fs.rename(p,join(f.parent,'targetdir'));await fs.symlink(join(f.parent,'targetdir'),p);}
  if(kind==='mode')await fs.chmod(file,0o666);
  if(kind==='parent-mode')await fs.chmod(dirname(file),0o777);
  const before=await snapshot(f.root);await rejects(()=>loadRoutineFiles(f.root,f.inputs),kind==='missing'?'UNAVAILABLE':'UNSAFE');assert.deepEqual(await snapshot(f.root),before);
});
test('root symlink is never normalized into authority',async t=>{
  const f=await fixture(t);await fs.mkdir(join(f.parent,'other'));const alias=join(f.parent,'other','.bowerloom');await fs.symlink(f.root,alias);await rejects(()=>loadRoutineFiles(alias,f.inputs),'UNSAFE');
});
test('aggregate dependency bound refuses even individually bounded files',async t=>{
  const d=data(),content='a'.repeat(262144);d.dependencies=d.dependencies.filter(v=>v.kind!=='skill');d.routine.skills=[];
  for(let i=0;i<4;i++){const ref=`skills/large-${i}/SKILL.md`;d.dependencies.push({kind:'skill',ref,content});d.routine.skills.push({ref,digest:sha(content)});}
  const f=await fixture(t,d);await rejects(()=>loadRoutineFiles(f.root,f.inputs),'BOUND');
});
test('file replacement at open cannot change the initial identity; all handles close',async t=>{
  const f=await fixture(t),path=join(f.root,routinePath);let opens=0,closes=0;
  patch(t,'open',old=>async(p,...args)=>{opens++;if(p===path){const content=await fs.readFile(p);await fs.rename(p,p+'.saved');await fs.writeFile(p,content,{mode:0o644});}const h=await old(p,...args);const close=h.close.bind(h);h.close=async()=>{closes++;return close();};return h;});
  await rejects(()=>loadRoutineFiles(f.root,f.inputs),'CHANGED');assert.equal(opens,1);assert.equal(closes,opens);
});
test('content mutation during read refuses and closes handle',async t=>{
  const f=await fixture(t);let closes=0;
  patch(t,'open',old=>async(...args)=>{const h=await old(...args);const read=h.read.bind(h),close=h.close.bind(h);let changed=false;h.read=async(...a)=>{const r=await read(...a);if(!changed){changed=true;await fs.appendFile(args[0],'# changed\n');}return r;};h.close=async()=>{closes++;return close();};return h;});
  await rejects(()=>loadRoutineFiles(f.root,f.inputs),'CHANGED');assert.equal(closes,1);
});
test('between-pass replacement cannot recapture baseline or change selected references',async t=>{
  const f=await fixture(t),target=join(f.root,routinePath);let opens=0,closes=0;
  patch(t,'open',old=>async(p,...args)=>{opens++;if(opens===6){await fs.appendFile(target,'# changed between passes\n');}const h=await old(p,...args),close=h.close.bind(h);h.close=async()=>{closes++;return close();};return h;});
  await rejects(()=>loadRoutineFiles(f.root,f.inputs),'CHANGED');assert.equal(opens,6);assert.equal(closes,opens);
});
test('final directory pin is not recaptured after last file closes',async t=>{
  const f=await fixture(t);let closed=0;
  patch(t,'open',old=>async(...a)=>{const h=await old(...a),close=h.close.bind(h);h.close=async()=>{await close();closed++;if(closed===10)await fs.chmod(f.root,0o755);};return h;});
  await rejects(()=>loadRoutineFiles(f.root,f.inputs),'CHANGED');assert.equal(closed,10);
});
test('invalid decoding closes handle and forged errors are sanitized',async t=>{
  const f=await fixture(t);await f.write(routinePath,Buffer.from([0xff]));let closes=0;
  patch(t,'open',old=>async(...args)=>{const h=await old(...args),close=h.close.bind(h);h.close=async()=>{closes++;return close();};return h;});
  await rejects(()=>loadRoutineFiles(f.root,f.inputs),'INPUT');assert.equal(closes,1);
  for(const error of [{code:'ROUTINE_FILES_CHANGED',message:'PRIVATE_MESSAGE'},new RoutineFilesError('ROUTINE_FILES_PATH'),Error('PRIVATE_MESSAGE')]){
    const prior=fs.lstat;fs.lstat=async()=>{throw error;};syncBuiltinESMExports();
    try{await rejects(()=>loadRoutineFiles(f.root,f.inputs),'UNAVAILABLE');}finally{fs.lstat=prior;syncBuiltinESMExports();}
  }
});
test('read IO failure and close refusal return no partial result',async t=>{
  const f=await fixture(t);let closes=0;
  patch(t,'open',old=>async(...args)=>{const h=await old(...args),close=h.close.bind(h);h.read=async()=>{throw Error('PRIVATE_MESSAGE')};h.close=async()=>{closes++;return close();};return h;});
  await rejects(()=>loadRoutineFiles(f.root,f.inputs),'UNAVAILABLE');assert.equal(closes,1);
});
test('close error is not treated as a successful read',async t=>{
  const f=await fixture(t);let closes=0;
  patch(t,'open',old=>async(...args)=>{const h=await old(...args),close=h.close.bind(h);h.close=async()=>{closes++;await close();throw Error('PRIVATE_MESSAGE')};return h;});
  await rejects(()=>loadRoutineFiles(f.root,f.inputs),'UNAVAILABLE');assert.equal(closes,1);
});
test('safe observation performs no filesystem mutation, process launch, or network call',async t=>{
  const f=await fixture(t);let observing=false,calls=0;const fail=()=>{calls++;throw Error('UNEXPECTED_EFFECT')};
  for(const name of ['writeFile','appendFile','mkdir','unlink','rename','chmod','rm'])patch(t,name,old=>(...args)=>observing?fail():old(...args));
  const cp=(await import('node:child_process')).default;const saved=new Map();
  for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']){saved.set(name,cp[name]);cp[name]=fail;}
  const fetch=globalThis.fetch;globalThis.fetch=fail;syncBuiltinESMExports();
  try{observing=true;await loadRoutineFiles(f.root,f.inputs);assert.equal(calls,0);}
  finally{observing=false;for(const [name,fn] of saved)cp[name]=fn;globalThis.fetch=fetch;syncBuiltinESMExports();}
});
test('synthetic wrong-owner and nonregular metadata are refused before open',async t=>{
  const f=await fixture(t),path=join(f.root,routinePath);let kind='owner',opens=0;
  patch(t,'lstat',old=>async(...args)=>{const s=await old(...args);if(args[0]===path){if(kind==='owner')s.uid=s.uid+1n;else s.isFile=()=>false;}return s;});
  patch(t,'open',old=>(...args)=>{opens++;return old(...args);});
  await rejects(()=>loadRoutineFiles(f.root,f.inputs),'UNSAFE');kind='nonregular';await rejects(()=>loadRoutineFiles(f.root,f.inputs),'UNSAFE');assert.equal(opens,0);
});

test('definition size refuses before allocation, including multibyte byte overflow',()=>{
  for(const [input,expectedByteChecks] of [['a'.repeat(65537),0],['é'.repeat(32769),1]]) {
    const from=Buffer.from,byteLength=Buffer.byteLength;let allocations=0,byteChecks=0;
    Buffer.from=function(value,...args){if(value===input){allocations++;throw Error('LATE_BOUND_ALLOCATION');}return from.call(this,value,...args);};
    Buffer.byteLength=function(value,...args){if(value===input)byteChecks++;return byteLength.call(this,value,...args);};
    try{assert.throws(()=>parseRoutineYaml(input),refusal('BOUND'));assert.equal(allocations,0);assert.equal(byteChecks,expectedByteChecks);}
    finally{Buffer.from=from;Buffer.byteLength=byteLength;}
  }
});
test('root size refuses before allocation or path processing, including multibyte byte overflow',async()=>{
  for(const [input,expectedByteChecks] of [['/'+ 'a'.repeat(2048)+'/.bowerloom',0],['/'+ 'é'.repeat(1024)+'/.bowerloom',1]]) {
    const from=Buffer.from,byteLength=Buffer.byteLength,normalize=String.prototype.normalize;
    const original={resolve:path.resolve,basename:path.basename,isAbsolute:path.isAbsolute};
    let allocations=0,byteChecks=0,pathCalls=0,normalizations=0;
    Buffer.from=function(value,...args){if(value===input){allocations++;throw Error('LATE_BOUND_ALLOCATION');}return from.call(this,value,...args);};
    Buffer.byteLength=function(value,...args){if(value===input)byteChecks++;return byteLength.call(this,value,...args);};
    String.prototype.normalize=function(...args){if(String(this)===input){normalizations++;throw Error('LATE_BOUND_NORMALIZATION');}return normalize.apply(this,args);};
    for(const name of Object.keys(original))path[name]=function(...args){if(args.includes(input)){pathCalls++;throw Error('LATE_BOUND_PATH');}return original[name](...args);};
    syncBuiltinESMExports();
    try{await rejects(()=>loadRoutineFiles(input,{experiment:{id:'synthetic',digest:'sha256:'+'b'.repeat(64)}}),'PATH');assert.equal(allocations,0);assert.equal(pathCalls,0);assert.equal(normalizations,0);assert.equal(byteChecks,expectedByteChecks);}
    finally{Buffer.from=from;Buffer.byteLength=byteLength;String.prototype.normalize=normalize;Object.assign(path,original);syncBuiltinESMExports();}
  }
});
