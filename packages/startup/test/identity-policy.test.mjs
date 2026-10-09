import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import {INSTALLATION_IDENTITY_POLICY as policy,parseInstallationIdentityPolicy,canonicalBirthtimeNs,comparePersistentIdentity as compare} from '../../../dist/packages/startup/src/identity-policy.js';
const id=birthtimeNs=>({device:'16777229',inode:'123',uid:501,mode:448,birthtimeNs});
const pairs=[['1791182645709844779','1791182645709844827'],['1791182645709939570','1791182645709939479'],['1791182647023412086','1791182647023411989'],['1791182647023518585','1791182647023518562'],['1791182648351638335','1791182648351638317'],['1791182648351734959','1791182648351734876']];
test('fixed policy parsing is closed, inert and platform restricted',()=>{assert.equal(parseInstallationIdentityPolicy(structuredClone(policy),'darwin'),policy);for(const platform of ['linux','win32','Darwin'])assert.equal(parseInstallationIdentityPolicy(policy,platform),undefined);for(const key of Object.keys(policy)){const v=structuredClone(policy);delete v[key];assert.equal(parseInstallationIdentityPolicy(v,'darwin'),undefined);}assert.equal(parseInstallationIdentityPolicy({...policy,extra:true},'darwin'),undefined);let calls=0;const p={...policy};Object.defineProperty(p,'algorithm',{enumerable:true,get(){calls++;return policy.algorithm;}});assert.equal(parseInstallationIdentityPolicy(p,'darwin'),undefined);assert.equal(calls,0);const q=structuredClone(policy);Object.defineProperty(q.scope,'0',{get(){calls++;return 'installed-target';}});assert.equal(parseInstallationIdentityPolicy(q,'darwin'),undefined);assert.equal(calls,0);});
test('exact and six directional alternatives require all other raw identity fields',()=>{for(const [raw,converted]of pairs){assert.equal(compare(id(raw),id(raw),policy,'darwin'),'exact');assert.equal(compare(id(raw),id(converted),policy,'darwin'),'approved-timestamp-alternate');assert.equal(compare(id(converted),id(raw),policy,'darwin'),undefined);for(const field of ['device','inode','uid','mode']){const b=id(converted);b[field]=typeof b[field]==='number'?b[field]+1:b[field]+'1';assert.equal(compare(id(raw),b,policy,'darwin'),undefined);}}});
test('range, malformed decimals, precision boundaries and asymmetric buckets',()=>{for(const raw of ['946684799999999999','4102444800000000000','-1','0','01','1e18','1'.repeat(100)])assert.equal(canonicalBirthtimeNs(raw),undefined);for(const raw of ['946684800000000000','4102444799999999999','1073741824000000000','2147483648000000000'])assert.equal(typeof canonicalBirthtimeNs(raw),'string');for(const [raw]of pairs)assert.equal(canonicalBirthtimeNs(canonicalBirthtimeNs(raw)),canonicalBirthtimeNs(raw));assert.equal(compare(id(pairs[0][0]),id(String(BigInt(pairs[0][0])+1n)),policy,'darwin'),undefined);assert.equal(compare(id('1791182645709844946'),id('1791182645709845066'),policy,'darwin'),undefined);});

import fs from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';
import {planStartup,applyStartup,inspectStartup,planStartupRevision,applyStartupRevision,recoverStartupRevision,startupInternals as io,renderStartupReview} from '../../../dist/packages/startup/src/index.js';
const darwin={skip:process.platform!=='darwin'};
const hash=v=>createHash('sha256').update(v).digest('hex');
async function fixture(t,mode='new',profile='engineer'){
 const parent=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'bowerloom-v2-')));fs.chmodSync(parent,0o700);t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 const target=join(parent,'project');if(mode==='existing')fs.mkdirSync(target,{mode:0o700});
 const input={mode,targetDir:target,brief:{projectName:'Synthetic policy project',goal:'Draft supplied synthetic notes.',profile}};
 const plan=await planStartup(input),receipt=await applyStartup(input,plan.revision);
 return {parent,target,input,plan,receipt,root:join(target,'.bowerloom'),receiptPath:join(target,'.bowerloom/installation-receipt.json')};
}
function raw(path){return io.identity(path);}
function overrides(){
 const births=new Map(),original=fs.lstatSync;
 fs.lstatSync=function(path,options){const s=original.call(this,path,options);if(options?.bigint&&s.isDirectory()&&births.has(String(s.ino))){const v=Object.assign(Object.create(Object.getPrototypeOf(s)),s);v.birthtimeNs=BigInt(births.get(String(s.ino)));return v;}return s;};syncBuiltinESMExports();
 return {births,restore(){fs.lstatSync=original;syncBuiltinESMExports();},alternate(path,baseline=raw(path)){births.set(baseline.inode,canonicalBirthtimeNs(baseline.birthtimeNs));},change(path){const a=raw(path);births.set(a.inode,String(BigInt(a.birthtimeNs)+1n));}};
}
async function interrupted(f,p,point){const original=fs.renameSync;fs.renameSync=function(from,to){const result=original.call(this,from,to);if(point==='old-moved'&&String(from)===f.root||point==='new-moved'&&String(to)===f.root)throw Error('synthetic interruption');return result;};syncBuiltinESMExports();try{await assert.rejects(applyStartupRevision({targetDir:f.target,brief:p.after.input.brief},p.fromRevision,p.revision));}finally{fs.renameSync=original;syncBuiltinESMExports();}}
for(const mode of ['new','existing'])for(const profile of ['engineer','founder','research'])test(`v2 ${mode}/${profile} records approved policy and exact installer origin`,darwin,async t=>{
 const f=await fixture(t,mode,profile);assert.equal(f.plan.format,'bowerloom/startup-plan/v1beta2');assert.equal(f.plan.purpose,'first-install');assert.equal(f.plan.continuity,null);assert.equal(f.receipt.format,'bowerloom/startup-receipt/v1beta2');assert.equal(f.plan.files.length,20);assert.match(renderStartupReview(f.plan),/directional floating-point conversion/);
 if(mode==='existing')assert.deepEqual(f.receipt.installedTargetIdentity,f.plan.binding.target);
 assert.deepEqual(f.receipt.derivedBirthtimeNs,{target:canonicalBirthtimeNs(f.receipt.installedTargetIdentity.birthtimeNs),bowerloom:canonicalBirthtimeNs(f.receipt.installedBowerloomIdentity.birthtimeNs)});
 const bytes=fs.readFileSync(f.receiptPath),o=overrides();try{o.alternate(f.target,f.receipt.installedTargetIdentity);o.alternate(f.root,f.receipt.installedBowerloomIdentity);const r=await inspectStartup(f.target);assert.equal(r.specReady,true);assert.equal(r.runtimeReady,false);assert.equal(r.executionAuthorized,false);assert.deepEqual(r.drift,[]);assert.equal(r.identityPolicy.algorithm,policy.algorithm);assert.match(r.identityPolicy.limitation,/existing enrollment and links/);assert.deepEqual(fs.readFileSync(f.receiptPath),bytes);}finally{o.restore();}
});
test('receipt/plan policy and origin schemas reject inconsistent derived values and mixed formats',darwin,async t=>{
 const f=await fixture(t,'existing'),original=fs.readFileSync(f.receiptPath),r=f.receipt;
 const mutations=[v=>{v.derivedBirthtimeNs.target='0';},v=>{delete v.plan.installationIdentityPolicy;},v=>{v.format='bowerloom/startup-receipt/v1alpha1';},v=>{v.plan.format='bowerloom/startup-plan/v1alpha1';},v=>{v.plan.purpose='revision';},v=>{v.plan.installationIdentityPolicy.scope.reverse();},v=>{v.installedTargetIdentity.birthtimeNs=String(BigInt(v.installedTargetIdentity.birthtimeNs)+1000n);v.derivedBirthtimeNs.target=canonicalBirthtimeNs(v.installedTargetIdentity.birthtimeNs);},v=>{v.plan.extra=true;}];
 for(const mutate of mutations){const v=structuredClone(r);mutate(v);fs.writeFileSync(f.receiptPath,JSON.stringify(v));const s=await inspectStartup(f.target);assert.equal(s.specReady,false);assert.ok(s.drift.some(d=>d.kind==='invalid-receipt'));}fs.writeFileSync(f.receiptPath,original);
 assert.equal((await inspectStartup(f.target)).specReady,true);
});
test('raw review/apply change invalidates approval even when policy could accept persistence',darwin,async t=>{
 const f=await fixture(t),other=join(f.parent,'other');fs.mkdirSync(other,{mode:0o700});const input={...f.input,mode:'existing',targetDir:other};const plan=await planStartup(input),o=overrides();try{o.change(other);await assert.rejects(applyStartup(input,plan.revision),{code:'STALE_APPROVAL'});assert.equal(fs.existsSync(join(other,'.bowerloom')),false);}finally{o.restore();}
});
test('two revisions after accepted drift retain predecessor target baseline and exact operation pins',darwin,async t=>{
 const f=await fixture(t),baseline=structuredClone(f.receipt.installedTargetIdentity),o=overrides();try{
  o.alternate(f.target,baseline);o.alternate(f.root,f.receipt.installedBowerloomIdentity);
  for(let n=1;n<=2;n++){const beforeBytes=fs.readFileSync(f.receiptPath),before=JSON.parse(beforeBytes);const input={targetDir:f.target,brief:{...f.input.brief,goal:`Revision ${n} of synthetic notes.`}};const p=await planStartupRevision(input);
   assert.equal(p.format,'bowerloom/startup-revision-plan/v1beta2');assert.equal(p.after.purpose,'revision');assert.equal(p.after.continuity.predecessorReceiptSha256,hash(beforeBytes));assert.deepEqual(p.after.continuity.retainedTargetBaseline,baseline);assert.deepEqual(p.operationBinding.target,raw(f.target));assert.deepEqual(p.operationBinding.sourceBowerloom,raw(f.root));
   const r=await applyStartupRevision(input,p.fromRevision,p.revision);assert.deepEqual(r.installedTargetIdentity,baseline);assert.deepEqual(r.plan.continuity.predecessorPolicy,before.plan.installationIdentityPolicy);const history=join(f.target,`.bowerloom-revision-${p.revision}`),stamp=JSON.parse(fs.readFileSync(join(history,'stage.json')));assert.equal(stamp.format,'bowerloom/startup-revision-stage/v1beta2');assert.deepEqual(r.installedBowerloomIdentity,stamp.identity);assert.deepEqual(fs.readFileSync(join(history,'previous/installation-receipt.json')),beforeBytes);assert.equal((await recoverStartupRevision(f.target,p.revision,'resume')).state,'committed');o.alternate(f.root,r.installedBowerloomIdentity);
  }
  assert.equal((await inspectStartup(f.target)).specReady,true);
 }finally{o.restore();}
});
for(const point of ['old-moved','new-moved'])for(const action of ['resume','rollback'])test(`accepted historical drift, ${point}, ${action} uses exact owned stages`,darwin,async t=>{
 const f=await fixture(t),old=fs.readFileSync(f.receiptPath),o=overrides();try{o.alternate(f.target,f.receipt.installedTargetIdentity);o.alternate(f.root,f.receipt.installedBowerloomIdentity);const input={targetDir:f.target,brief:{...f.input.brief,goal:'Changed synthetic notes.'}},p=await planStartupRevision(input);await interrupted(f,p,point);assert.equal((await inspectStartup(f.target)).status,'revision-pending');const result=await recoverStartupRevision(f.target,p.revision,action);assert.equal(result.state,action==='resume'?'committed':'rolled-back');assert.equal(result.inspection.specReady,true);if(action==='rollback')assert.deepEqual(fs.readFileSync(f.receiptPath),old);else assert.deepEqual(fs.readFileSync(join(f.target,`.bowerloom-revision-${p.revision}`,'previous/installation-receipt.json')),old);}finally{o.restore();}
});
test('raw changes to pending source and stage refuse recovery without moving either',darwin,async t=>{
 for(const selected of ['target','previous','new-root']){const f=await fixture(t),input={targetDir:f.target,brief:{...f.input.brief,goal:'Pending test.'}},p=await planStartupRevision(input);await interrupted(f,p,'new-moved');const history=join(f.target,`.bowerloom-revision-${p.revision}`),path=selected==='target'?f.target:selected==='previous'?join(history,'previous'):f.root,marker=fs.readFileSync(join(f.target,'.bowerloom-revision.json')),o=overrides();try{o.change(path);await assert.rejects(recoverStartupRevision(f.target,p.revision,'resume'));await assert.rejects(recoverStartupRevision(f.target,p.revision,'rollback'));assert.deepEqual(fs.readFileSync(join(f.target,'.bowerloom-revision.json')),marker);assert.ok(fs.existsSync(join(history,'previous')));assert.ok(fs.existsSync(f.root));}finally{o.restore();}}
});
test('journal history, stage and result mixtures cannot authorize recovery',darwin,async t=>{
 for(const fault of ['journal-version','operation','continuity','predecessor-hash','stage-version','stage-identity']){const f=await fixture(t),p=await planStartupRevision({targetDir:f.target,brief:{...f.input.brief,goal:'Mixed history test.'}});await interrupted(f,p,'old-moved');const history=join(f.target,`.bowerloom-revision-${p.revision}`),marker=join(f.target,'.bowerloom-revision.json'),j=JSON.parse(fs.readFileSync(marker));if(fault==='journal-version')j.format='bowerloom/startup-revision-journal/v1beta1';if(fault==='operation')j.plan.operationBinding.target.inode+='1';if(fault==='continuity')j.plan.after.continuity.retainedTargetBaseline.birthtimeNs=String(BigInt(j.plan.after.continuity.retainedTargetBaseline.birthtimeNs)+1n);if(fault==='predecessor-hash')j.plan.beforeReceiptSha256='0'.repeat(64);if(fault.startsWith('stage')){const path=join(history,'stage.json'),stamp=JSON.parse(fs.readFileSync(path));if(fault==='stage-version')delete stamp.format;else stamp.identity.inode+='1';fs.writeFileSync(path,JSON.stringify(stamp));}else fs.writeFileSync(marker,JSON.stringify(j));await assert.rejects(recoverStartupRevision(f.target,p.revision,'resume'));assert.ok(fs.existsSync(marker));assert.ok(fs.existsSync(join(history,'previous')));}
});

test('rehashed inconsistent predecessor continuity still refuses journal authority',darwin,async t=>{
 const f=await fixture(t),input={targetDir:f.target,brief:{...f.input.brief,goal:'Continuity attempt.'}},p=await planStartupRevision(input);await interrupted(f,p,'old-moved');const marker=join(f.target,'.bowerloom-revision.json'),j=JSON.parse(fs.readFileSync(marker));j.plan.after.continuity.retainedTargetBaseline.inode+='1';
 let {revision,...body}=j.plan.after;
 j.plan.after.revision=io.hash((await import('../../../dist/packages/contracts/src/index.js')).canonicalJson(body));j.plan.toRevision=j.plan.after.revision;
 ({revision,...body}=j.plan);j.plan.revision=io.hash((await import('../../../dist/packages/contracts/src/index.js')).canonicalJson(body));fs.writeFileSync(marker,JSON.stringify(j));
 await assert.rejects(recoverStartupRevision(f.target,j.plan.revision,'resume'));assert.equal(fs.existsSync(f.root),false);assert.ok(fs.existsSync(join(f.target,`.bowerloom-revision-${p.revision}`,'previous')));
});
test('versioned stage/result formats refuse field stripping after completed revision',darwin,async t=>{
 for(const fault of ['stage','result']){const f=await fixture(t),input={targetDir:f.target,brief:{...f.input.brief,goal:'Terminal format test.'}},p=await planStartupRevision(input);await applyStartupRevision(input,p.fromRevision,p.revision);const path=join(f.target,`.bowerloom-revision-${p.revision}`,fault==='stage'?'stage.json':'result.json'),v=JSON.parse(fs.readFileSync(path));delete v.format;fs.writeFileSync(path,JSON.stringify(v));await assert.rejects(recoverStartupRevision(f.target,p.revision,'resume'));assert.equal((await inspectStartup(f.target)).specReady,true);}
});
test('v2 inspection refuses exact-byte receipt or raw observation changes at closing',darwin,async t=>{
 for(const fault of ['bytes','identity']){const f=await fixture(t),originalOpen=fs.openSync,originalRead=fs.readSync,o=overrides();let opens=0,closing=-1;fs.openSync=function(path,...args){const fd=originalOpen.call(this,path,...args);if(String(path)===f.receiptPath&&++opens===2){closing=fd;if(fault==='identity')o.change(f.target);}return fd;};fs.readSync=function(fd,buf,...args){const n=originalRead.call(this,fd,buf,...args);if(fault==='bytes'&&fd===closing&&n){const i=buf.indexOf(32);if(i>=0&&i<n)buf[i]=9;}return n;};syncBuiltinESMExports();try{assert.equal((await inspectStartup(f.target)).specReady,false);}finally{fs.openSync=originalOpen;fs.readSync=originalRead;o.restore();syncBuiltinESMExports();}}
});
test('post-creation stage timestamp changes cannot be recaptured as first-install success',darwin,async t=>{
 const f=await fixture(t),input={...f.input,targetDir:join(f.parent,'fresh')},p=await planStartup(input),o=overrides(),original=fs.writeFileSync;let altered=false;
 fs.writeFileSync=function(path,...args){const r=original.call(this,path,...args);if(!altered&&String(path).endsWith('/installation-receipt.json')&&String(path).includes('.bowerloom-startup-stage-')){altered=true;o.change(dirname(String(path)));}return r;};syncBuiltinESMExports();
 try{await assert.rejects(applyStartup(input,p.revision),{code:'STARTUP_STAGE_CHANGED'});assert.equal(altered,true);assert.equal(fs.existsSync(input.targetDir),false);}finally{fs.writeFileSync=original;o.restore();syncBuiltinESMExports();}
});

// Only mocked observations in fresh owned fixtures change; real timestamps stay untouched.
import fsp from 'node:fs/promises';
for (const selected of ['target', 'parent']) test(`revision ${selected} changes during final planning compile refuse before journal writes`, darwin, async t => {
 const f = await fixture(t), input = {targetDir:f.target, brief:{...f.input.brief, goal:'Reviewed revision.'}}, p = await planStartupRevision(input);
 const original = fsp.realpath, o = overrides(), before = fs.readFileSync(f.receiptPath); let compiles = 0, changed = false;
 fsp.realpath = async function(path, ...args) {
  const result = await original.call(this, path, ...args);
  if (String(path) === join(f.root,'teams/first-team') && ++compiles === 2) { o.change(selected === 'target' ? f.target : f.parent); changed = true; }
  return result;
 }; syncBuiltinESMExports();
 try {
  await assert.rejects(applyStartupRevision(input, p.fromRevision, p.revision), {code:'REVISION_BINDING_CHANGED'});
  assert.equal(changed,true); assert.equal(fs.existsSync(join(f.target,'.bowerloom-revision.json')),false);
  assert.equal(fs.readdirSync(f.target).some(name=>name.startsWith('.bowerloom-revision-')),false);
  assert.deepEqual(fs.readFileSync(f.receiptPath),before);
 } finally { fsp.realpath=original; o.restore(); syncBuiltinESMExports(); }
});
for (const selected of ['stage', 'bowerloom', 'parent', 'target']) test(`first-install ${selected} changes during compile refuse before receipt write`, darwin, async t => {
 const f = await fixture(t), target=join(f.parent,'fresh-boundary'); fs.mkdirSync(target,{mode:0o700});
 const input={...f.input,mode:'existing',targetDir:target}, p=await planStartup(input), original=fsp.realpath, originalWrite=fs.writeFileSync, o=overrides();let changed=false, receipts=0;
 fsp.realpath=async function(path,...args) {
  const result=await original.call(this,path,...args), text=String(path), marker='/.bowerloom/';
  if(!changed&&text.includes('.bowerloom-startup-stage-')) {const end=text.indexOf(marker), stage=end<0?dirname(text):text.slice(0,end);o.change(selected==='stage'?stage:selected==='bowerloom'?join(stage,'.bowerloom'):selected==='parent'?f.parent:target);changed=true;}
  return result;
 };
 fs.writeFileSync=function(path,...args){if(String(path).endsWith('/installation-receipt.json'))receipts++;return originalWrite.call(this,path,...args);};syncBuiltinESMExports();
 try {await assert.rejects(applyStartup(input,p.revision),{code:selected==='stage'||selected==='bowerloom'?'STARTUP_STAGE_CHANGED':'STALE_APPROVAL'});assert.equal(changed,true);assert.equal(receipts,0);assert.equal(fs.existsSync(join(target,'.bowerloom')),false);}
 finally {fsp.realpath=original;fs.writeFileSync=originalWrite;o.restore();syncBuiltinESMExports();}
});

for(const selected of ['target','bowerloom']) test(`initial receipt read ${selected} change to approved alternate still refuses unstable inspection`,darwin,async t=>{
 const f=await fixture(t),original=fs.openSync,o=overrides();let changed=false;
 // Pin a non-idempotent baseline on the fresh synthetic receipt before the observation starts.
 const receipt=JSON.parse(fs.readFileSync(f.receiptPath)),key=selected==='target'?'installedTargetIdentity':'installedBowerloomIdentity';
 receipt[key].birthtimeNs=pairs[0][0];receipt.derivedBirthtimeNs[selected==='target'?'target':'bowerloom']=pairs[0][1];
 fs.writeFileSync(f.receiptPath,io.json(receipt));o.births.set(receipt[key].inode,pairs[0][0]);
 const before=fs.readFileSync(f.receiptPath);
 fs.openSync=function(path,...args){const fd=original.call(this,path,...args);if(!changed&&String(path)===f.receiptPath){o.alternate(selected==='target'?f.target:f.root,receipt[key]);changed=true;}return fd;};syncBuiltinESMExports();
 try{const r=await inspectStartup(f.target);assert.equal(changed,true);assert.equal(r.specReady,false);assert.ok(r.drift.some(d=>d.kind==='installation-binding-changed'));assert.deepEqual(fs.readFileSync(f.receiptPath),before);}
 finally{fs.openSync=original;o.restore();syncBuiltinESMExports();}
});
