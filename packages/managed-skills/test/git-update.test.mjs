import '../../../dist/tests/support/isolate-home.js';
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { planGitAcquisition } from '../../../dist/packages/skill-sources/src/git.js';
import { observeSkillCacheRoot,openGitCacheOperation,inspectSkillCache } from '../../../dist/packages/skill-sources/src/cache.js';
import { planObservedManagedSkill,inspectObservedManagedSkill } from '../../../dist/packages/managed-skills/src/observed.js';
import { applyObservedManagedSkill,planObservedManagedSkillRecovery,recoverObservedManagedSkill } from '../../../dist/packages/managed-skills/src/transaction.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
const oid=(kind,b)=>createHash('sha1').update(kind+' '+b.length+'\0').update(b).digest('hex');
// Synthetic independent Git object writer. No git process, network or vendor object fixture.
// One listing per walked directory, then the recursive skill tree, as the v1beta2 Git payload stores them.
function gitRepository(items){
  const dirs=new Map([['',[]]]),parentOf=p=>{const d=path.posix.dirname(p);return d==='.'?'':d;};
  const ensure=d=>{if(dirs.has(d))return;dirs.set(d,[]);const parent=parentOf(d);ensure(parent);dirs.get(parent).push({name:path.posix.basename(d),type:'tree',mode:'040000',dir:d});};
  for(const item of items){const parent=parentOf(item.path);ensure(parent);const bytes=Buffer.from(item.text);dirs.get(parent).push({name:path.posix.basename(item.path),type:'blob',mode:'100644',sha:oid('blob',bytes),size:bytes.length});}
  const order=(a,b)=>Buffer.compare(Buffer.from(a.name+(a.type==='tree'?'/':'')),Buffer.from(b.name+(b.type==='tree'?'/':'')));
  const trees=new Map();
  const build=dir=>{const rows=dirs.get(dir).map(e=>e.type==='tree'?{...e,sha:build(e.dir)}:e).sort(order);
    const sha=oid('tree',Buffer.concat(rows.flatMap(e=>[Buffer.from((e.type==='tree'?'40000':e.mode)+' '+e.name+'\0'),Buffer.from(e.sha,'hex')])));trees.set(dir,{sha,rows});return sha;};
  build('');
  const row=(e,p)=>({path:p,mode:e.mode,type:e.type,sha:e.sha,...(e.type==='blob'?{size:e.size}:{})});
  const listing=dir=>({sha:trees.get(dir).sha,tree:trees.get(dir).rows.map(e=>row(e,e.name)),truncated:false});
  const recursive=dir=>{const out=[];const walk=(d,prefix)=>{for(const e of trees.get(d).rows){out.push(row(e,prefix+e.name));if(e.type==='tree')walk(e.dir,prefix+e.name+'/');}};walk(dir,'');return {sha:trees.get(dir).sha,tree:out,truncated:false};};
  return {listing,recursive,sha:dir=>trees.get(dir).sha};
}
function objectFixture(version='one',repository='synthetic/example'){
  const sourceRoot='skills/example';
  const files=[{path:'SKILL.md',sourcePath:'skills/example/SKILL.md',text:'---\nname: example\ndescription: Synthetic Git fixture.\nlicense: MIT\n---\nRead [guide](references/guide.md).\n'},
    {path:'references/guide.md',sourcePath:'skills/example/references/guide.md',text:'# Guide\nVersion '+version+'\n'},
    {path:'LICENSE.txt',sourcePath:'LICENSE',text:'MIT License\nSynthetic notice.\n'}];
  const repo=gitRepository(files.map(f=>({path:f.sourcePath,text:f.text})));
  const segments=sourceRoot.split('/'),pathTrees=segments.map((_,i)=>repo.sha(segments.slice(0,i+1).join('/')));
  const commit=createHash('sha1').update('synthetic-commit-'+version).digest('hex'),tree=repo.sha('');
  const metadata=Buffer.from(JSON.stringify({sha:commit,tree:{sha:tree},message:'Synthetic only'}));
  const listings=[...segments.map((_,i)=>repo.listing(segments.slice(0,i).join('/'))),repo.recursive(sourceRoot)].map(v=>Buffer.from(JSON.stringify(v)));
  const blobBodies=new Map(files.map(f=>{const b=Buffer.from(f.text),sha=oid('blob',b);return [sha,Buffer.from(JSON.stringify({sha,encoding:'base64',size:b.length,content:b.toString('base64')+'\n'}))];}));
  const payload=Buffer.from(JSON.stringify({trees:listings.map(b=>b.toString('base64')),blobs:[...blobBodies].map(([sha,b])=>({sha,body:b.toString('base64')}))}));
  const request={repository,commit,tree,pathTrees,metadataSha256:hash(metadata),declaredLicense:'MIT',skill:{id:'example',name:'example',sourceRoot},files:files.map(f=>({path:f.path,sourcePath:f.sourcePath,sha256:hash(f.text),bytes:Buffer.byteLength(f.text),mode:420})),references:[{from:'SKILL.md',to:'references/guide.md'}],license:{spdx:'MIT',origin:'included',files:['LICENSE.txt']}};
  return {files,metadata,listings,blobBodies,payload,request};
}

function dirs(t){const base=fs.mkdtempSync(path.join(fs.realpathSync(os.homedir()),'bowerloom-git-managed-'));fs.chmodSync(base,0o700);t.after(()=>fs.rmSync(base,{recursive:true,force:true}));const projectDir=path.join(base,'project'),stateDir=path.join(base,'state'),root=path.join(base,'cache');for(const p of [projectDir,stateDir,root])fs.mkdirSync(p,{mode:0o700});fs.writeFileSync(path.join(projectDir,'AGENTS.md'),'Preserve governance.\n');return {base,projectDir,stateDir,root};}
async function cached(f,version,operationId,repository,mutate=()=>{}){const x=objectFixture(version,repository);mutate(x);const binding=observeSkillCacheRoot(f.root,operationId,33554432),plan=planGitAcquisition(x.request,binding),a=new AbortController(),op=openGitCacheOperation(plan,plan.revision,a.signal);op.receiving();await op.stage(x.metadata,x.payload,a.signal);await op.complete(a.signal);assert.equal(op.release(),true);const seen=await inspectSkillCache({root:f.root,operationId});return {root:f.root,operationId,expectedSnapshotRevision:seen.snapshotRevision,expectedReceiptRevision:seen.receipt.revision};}
function request(f,cache,harness='codex'){return {operation:'install',projectDir:f.projectDir,stateDir:f.stateDir,harness,cache,expectedPreviousRevision:null,minFreeBytes:33554432};}
async function installed(t,harness='codex'){const f=dirs(t),cache=await cached(f,'one','a'.repeat(32)),input=request(f,cache,harness),p=await planObservedManagedSkill(input),receipt=await applyObservedManagedSkill(input,p.revision,null);assert.equal(receipt.state,'committed');return {...f,input,receipt};}
function inventory(root){const rows=[];const walk=p=>{const s=fs.lstatSync(p);rows.push({path:path.relative(root,p),mode:s.mode&0o7777,sha:s.isFile()?hash(fs.readFileSync(p)):null});if(s.isDirectory())for(const n of fs.readdirSync(p).sort())walk(path.join(p,n));};walk(root);return rows;}
for(const harness of ['codex','claude'])test(harness+': immutable Git update requires exact prior and new approvals, then reports up-to-date',async t=>{
 const f=await installed(t,harness),root=path.join(f.projectDir,harness==='codex'?'.agents':'.claude','skills/example'),before=inventory(f.projectDir);
 const next=await cached(f,'two','b'.repeat(32)),update={...f.input,operation:'update',cache:next,expectedPreviousRevision:f.receipt.revision},plan=await planObservedManagedSkill(update);
 await assert.rejects(applyObservedManagedSkill(update,'0'.repeat(64),f.receipt.revision));assert.deepEqual(inventory(f.projectDir),before);
 const second=await applyObservedManagedSkill(update,plan.revision,f.receipt.revision);assert.equal(second.state,'committed');assert.match(fs.readFileSync(path.join(root,'references/guide.md'),'utf8'),/Version two/);assert.equal(fs.readFileSync(path.join(f.projectDir,'AGENTS.md'),'utf8'),'Preserve governance.\n');
 const current={...update,expectedPreviousRevision:second.revision};assert.equal((await planObservedManagedSkill(current)).status,'up-to-date');await assert.rejects(planObservedManagedSkill(update));
 const catalog=JSON.parse(fs.readFileSync(path.join(f.projectDir,'.bowerloom-skills/catalog.json')));assert.equal(catalog.source.kind,'git');assert.equal(catalog.source.repository,'synthetic/example');assert.equal(catalog.source.version,undefined);
});
test('Git local edits refuse both update planning and a previously approved stale plan',async t=>{
 const f=await installed(t),cache=await cached(f,'two','b'.repeat(32)),update={...f.input,operation:'update',cache,expectedPreviousRevision:f.receipt.revision},plan=await planObservedManagedSkill(update);
 const file=path.join(f.projectDir,'.agents/skills/example/references/guide.md');fs.writeFileSync(file,'My local change.\n');const before=inventory(f.projectDir);
 await assert.rejects(planObservedManagedSkill(update));await assert.rejects(applyObservedManagedSkill(update,plan.revision,f.receipt.revision));assert.deepEqual(inventory(f.projectDir),before);
});
test('a Git update cannot switch repository or skill identity',async t=>{
 const f=await installed(t),foreign=await cached(f,'two','b'.repeat(32),'other/example');const before=inventory(f.projectDir);
 await assert.rejects(planObservedManagedSkill({...f.input,operation:'update',cache:foreign,expectedPreviousRevision:f.receipt.revision}));assert.deepEqual(inventory(f.projectDir),before);
 const otherSkill=await cached(f,'two','c'.repeat(32),undefined,x=>{x.request.skill.id='other';});await assert.rejects(planObservedManagedSkill({...f.input,operation:'update',cache:otherSkill,expectedPreviousRevision:f.receipt.revision}));assert.deepEqual(inventory(f.projectDir),before);
});
test('pre-cancelled Git install leaves targets intact and cannot manufacture recovery authority',async t=>{
 const f=dirs(t),cache=await cached(f,'one','a'.repeat(32)),input=request(f,cache),p=await planObservedManagedSkill(input),a=new AbortController();a.abort();const before=inventory(f.projectDir);
 await assert.rejects(applyObservedManagedSkill(input,p.revision,null,{signal:a.signal}));assert.deepEqual(inventory(f.projectDir),before);
 await assert.rejects(planObservedManagedSkillRecovery({projectDir:f.projectDir,stateDir:f.stateDir,operationKey:p.operationKey,action:'rollback'}));assert.equal((await inspectObservedManagedSkill({projectDir:f.projectDir,stateDir:f.stateDir})).status,'absent');
});

for(const action of ['resume','rollback'])test('Git interrupted update requires exact '+action+' recovery approval',async t=>{
 const f=await installed(t),before=inventory(f.projectDir),cache=await cached(f,'two','b'.repeat(32)),input={...f.input,operation:'update',cache,expectedPreviousRevision:f.receipt.revision},plan=await planObservedManagedSkill(input),rename=fs.renameSync;let hit=false;
 t.mock.method(fs,'renameSync',(from,to)=>{rename(from,to);if(!hit&&String(from)===path.join(f.stateDir,'op-'+plan.operationKey,'new-projection')){hit=true;throw Error('PRIVATE_AFTER_GIT_PROJECTION');}});
 await assert.rejects(applyObservedManagedSkill(input,plan.revision,f.receipt.revision),e=>e.code==='MANAGED_SKILL_RECOVERY_REQUIRED'&&!e.message.includes('PRIVATE'));t.mock.restoreAll();assert.equal(hit,true);
 const request={projectDir:f.projectDir,stateDir:f.stateDir,operationKey:plan.operationKey,action},recovery=await planObservedManagedSkillRecovery(request),pending=inventory(f.projectDir);
 await assert.rejects(recoverObservedManagedSkill(recovery,'0'.repeat(64)));assert.deepEqual(inventory(f.projectDir),pending);
 const result=await recoverObservedManagedSkill(recovery,recovery.revision);assert.equal(result.executionAuthorized,false);assert.equal(fs.existsSync(path.join(f.projectDir,'.bowerloom-skills-pending.json')),false);
 if(action==='rollback'){assert.equal(result.state,'rolled-back');assert.deepEqual(inventory(f.projectDir),before);}else{assert.equal(result.state,'committed');assert.match(fs.readFileSync(path.join(f.projectDir,'.agents/skills/example/references/guide.md'),'utf8'),/Version two/);}
});

test('same immutable commit cannot be relabeled as an update through changed metadata',async t=>{
 const f=await installed(t),before=inventory(f.projectDir),changed=await cached(f,'one','b'.repeat(32),undefined,x=>{const m=JSON.parse(x.metadata);m.message='Another metadata representation';x.metadata=Buffer.from(JSON.stringify(m));x.request.metadataSha256=hash(x.metadata);});
 await assert.rejects(planObservedManagedSkill({...f.input,operation:'update',cache:changed,expectedPreviousRevision:f.receipt.revision}));assert.deepEqual(inventory(f.projectDir),before);
});
