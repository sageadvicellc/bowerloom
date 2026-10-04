import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {planStartup,applyStartup,inspectStartup,planStartupRevision,applyStartupRevision,recoverStartupRevision,renderStartupRevisionReview} from '../../../dist/packages/startup/src/index.js';
import {canonicalJson} from '../../../dist/packages/contracts/src/index.js';
import {planLink,applyLink,readLink} from '../../../dist/packages/connections/src/index.js';
import {planControl,registerControl,openControlOwner} from '../../../dist/packages/local-control/src/index.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
const code=expected=>error=>error?.code===expected;
const identity=path=>{const s=fs.lstatSync(path,{bigint:true});return {device:String(s.dev),inode:String(s.ino),birthtimeNs:String(s.birthtimeNs),uid:Number(s.uid),mode:Number(s.mode)&0o777};};
async function fixture(t,historical){
 const parent=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'bowerloom-revision-')));fs.chmodSync(parent,0o700);t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 const targetDir=join(parent,'project'),brief={projectName:'Revision project',goal:'Draft the first weekly note',profile:'engineer'};
 const input={mode:'new',targetDir,brief},initial=await planStartup(input);
 let receipt;
 if(!historical)receipt=await applyStartup(input,initial.revision);
 else {
  const h=JSON.parse(fs.readFileSync(new URL(`./fixtures/scaffold-${historical}.json`,import.meta.url),'utf8')),data=h.cases?.[0]??h;
  const body={format:initial.format,templateVersion:h.templateVersion,input:{...initial.input,brief:data.brief},binding:initial.binding,files:data.files,compiled:data.compiled,specReady:true,runtimeReady:false,executionAuthorized:false,reviewRequired:true};
  const root=join(targetDir,'.bowerloom');fs.mkdirSync(root,{recursive:true,mode:0o700});
  for(const file of data.files){fs.mkdirSync(dirname(join(root,file.path)),{recursive:true,mode:0o700});fs.writeFileSync(join(root,file.path),file.text,{mode:0o600});}
  receipt={format:'bowerloom/startup-receipt/v1alpha1',plan:{...body,revision:hash(canonicalJson(body))},installedTargetIdentity:identity(targetDir),installedBowerloomIdentity:identity(root),specReady:true,runtimeReady:false,executionAuthorized:false,reviewRequired:true};
  fs.writeFileSync(join(root,'installation-receipt.json'),JSON.stringify(receipt),{mode:0o600});
 }
 fs.writeFileSync(join(targetDir,'unrelated.txt'),'keep exact unrelated bytes');
 return {parent,targetDir,receipt,input:{targetDir,brief:{...receipt.plan.input.brief,goal:'Draft the revised monthly note'}}};
}
async function interrupt(f,plan,checkpoint,action){
 const inputPath=join(f.parent,'revision-input.json');fs.writeFileSync(inputPath,JSON.stringify(f.input),{mode:0o600});
 const child=spawn(process.execPath,['packages/startup/test/fixtures/revision-crash.mjs',inputPath,plan.fromRevision,plan.revision,checkpoint,...(action?[action]:[])],{stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
 const status=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});assert.equal(status,86,output);
}
for(const historical of ['v1alpha1','v1alpha2','v1beta1',null])test(`exact revision preserves ${historical??'current'} backup and unrelated files`,async t=>{
 const f=await fixture(t,historical);const before=fs.readFileSync(join(f.targetDir,'.bowerloom/installation-receipt.json'));
 const plan=await planStartupRevision(f.input);assert.equal(plan.fromRevision,f.receipt.plan.revision);assert.notEqual(plan.toRevision,plan.fromRevision);
 assert.equal(plan.executionAuthorized,false);assert.ok(renderStartupRevisionReview(plan).includes(f.input.brief.goal));
 const result=await applyStartupRevision(f.input,plan.fromRevision,plan.revision);assert.equal(result.plan.revision,plan.toRevision);
 const history=join(f.targetDir,`.bowerloom-revision-${plan.revision}`);
 assert.deepEqual(fs.readFileSync(join(history,'previous/installation-receipt.json')),before);
 assert.equal(fs.readFileSync(join(f.targetDir,'unrelated.txt'),'utf8'),'keep exact unrelated bytes');
 assert.equal((await inspectStartup(f.targetDir)).specReady,true);
 assert.equal((await recoverStartupRevision(f.targetDir,plan.revision,'resume')).state,'committed');
});
test('changed old/new approval, managed drift, unexpected files and symlink paths are refused',async t=>{
 const f=await fixture(t);const p=await planStartupRevision(f.input);
 await assert.rejects(applyStartupRevision(f.input,'0'.repeat(64),p.revision),code('STALE_APPROVAL'));
 await assert.rejects(applyStartupRevision({...f.input,brief:{...f.input.brief,goal:'Changed again'}},p.fromRevision,p.revision),code('STALE_APPROVAL'));
 const file=join(f.targetDir,'.bowerloom/brief.json'),original=fs.readFileSync(file);fs.appendFileSync(file,' ');
 await assert.rejects(planStartupRevision(f.input),code('REVISION_DRIFT'));fs.writeFileSync(file,original);
 const extra=join(f.targetDir,'.bowerloom/custom.txt');fs.writeFileSync(extra,'custom');await assert.rejects(planStartupRevision(f.input),code('REVISION_DRIFT'));fs.unlinkSync(extra);
 fs.unlinkSync(file);fs.symlinkSync(join(f.targetDir,'unrelated.txt'),file);await assert.rejects(planStartupRevision(f.input),code('REVISION_DRIFT'));
});
for(const checkpoint of ['journal','stage','file','prepared','old-moved','new-moved','result','archived'])for(const action of checkpoint==='result'||checkpoint==='archived'?['resume']:['resume','rollback'])test(`crash after ${checkpoint}: ${action} is deterministic and pending never ready`,async t=>{
 const f=await fixture(t),p=await planStartupRevision(f.input);await interrupt(f,p,checkpoint);
 const status=await inspectStartup(f.targetDir);assert.equal(status.status,checkpoint==='archived'?'ready-for-review':'revision-pending');
 if(checkpoint!=='archived'){ assert.equal(status.specReady,false); await assert.rejects(planStartup({mode:'existing',targetDir:f.targetDir,brief:f.input.brief}),code('REVISION_PENDING')); }
 const result=await recoverStartupRevision(f.targetDir,p.revision,action);assert.equal(result.state,action==='resume'?'committed':'rolled-back');
 assert.equal(result.inspection.specReady,true);assert.equal(result.installedRevision,action==='resume'?p.toRevision:p.fromRevision);
 assert.deepEqual(await recoverStartupRevision(f.targetDir,p.revision,action),result);
 assert.equal(fs.readFileSync(join(f.targetDir,'unrelated.txt'),'utf8'),'keep exact unrelated bytes');
});
test('modified journal, staged bytes and unsafe transaction paths remain pending and untouched',async t=>{
 const f=await fixture(t),p=await planStartupRevision(f.input);await interrupt(f,p,'file');
 const stage=join(f.targetDir,`.bowerloom-revision-${p.revision}`,'next/START-HERE.md');fs.appendFileSync(stage,'tampered');
 await assert.rejects(recoverStartupRevision(f.targetDir,p.revision,'resume'));await assert.rejects(recoverStartupRevision(f.targetDir,p.revision,'rollback'));
 assert.equal((await inspectStartup(f.targetDir)).status,'revision-pending');assert.match(fs.readFileSync(stage,'utf8'),/tampered$/);
});
test('journal approval and directory replacement cannot acquire recovery authority',async t=>{
 const f=await fixture(t),p=await planStartupRevision(f.input);await interrupt(f,p,'journal');
 await assert.rejects(recoverStartupRevision(f.targetDir,'0'.repeat(64),'resume'));
 const marker=join(f.targetDir,'.bowerloom-revision.json'),bytes=fs.readFileSync(marker);const value=JSON.parse(bytes);value.plan.after.input.brief.goal='Tampered';fs.writeFileSync(marker,JSON.stringify(value));
 await assert.rejects(recoverStartupRevision(f.targetDir,p.revision,'resume'));fs.writeFileSync(marker,bytes);
 const history=join(f.targetDir,`.bowerloom-revision-${p.revision}`);fs.symlinkSync(f.parent,history);
 await assert.rejects(recoverStartupRevision(f.targetDir,p.revision,'resume'));assert.equal((await inspectStartup(f.targetDir)).status,'revision-pending');
});
test('concurrent revisions and occupied local lock ports refuse a second writer',async t=>{
 const f=await fixture(t),p=await planStartupRevision(f.input);
 const port=20000+(parseInt(hash(f.targetDir).slice(0,8),16)%30000),server=createServer(socket=>socket.destroy());await new Promise(resolve=>server.listen({host:'127.0.0.1',port,exclusive:true},resolve));
 try{await assert.rejects(applyStartupRevision(f.input,p.fromRevision,p.revision),code('REVISION_LOCK_UNAVAILABLE'));}finally{await new Promise(resolve=>server.close(resolve));}
 const outcomes=await Promise.allSettled([applyStartupRevision(f.input,p.fromRevision,p.revision),applyStartupRevision(f.input,p.fromRevision,p.revision)]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
});
test('old connection and registry enrollment cannot authorize the revised goal',async t=>{
 const f=await fixture(t),other=await fixture(t);const links=join(f.parent,'links');fs.mkdirSync(links,{mode:0o700});
 const linkInput={from:f.targetDir,to:other.targetDir,file:'working-agreement.md',output:join(links,'link.json')};const linkPlan=await planLink(linkInput);await applyLink(linkInput,linkPlan.revision);
 const installation=join(f.parent,'recipe-installation.json');fs.writeFileSync(installation,JSON.stringify({format:'trellis/recipe-installation/v1'}),{mode:0o600});
 const registry=join(f.parent,'registry'),control={root:f.targetDir,team:'first-team',spec:'teams/first-team/team.yaml',registry,adapter:'recipe',installation};const cp=planControl(control);registerControl(control,cp.revision);
 const oldSpec=fs.readFileSync(join(f.targetDir,'.bowerloom/teams/first-team/team.yaml'));const p=await planStartupRevision(f.input);await applyStartupRevision(f.input,p.fromRevision,p.revision);
 assert.notDeepEqual(fs.readFileSync(join(f.targetDir,'.bowerloom/teams/first-team/team.yaml')),oldSpec);
 await assert.rejects(readLink(linkInput.output,other.targetDir));
 assert.throws(()=>openControlOwner(installation,'recipe',registry),code('CONTROL_BINDING_CHANGED'));
 assert.throws(()=>registerControl(control,cp.revision),code('CONTROL_STALE_APPROVAL'));
});

for(const checkpoint of ['rollback','rollback-new-moved','rollback-old-restored','result'])test(`rollback interrupted after ${checkpoint} stays latched and resumes only rollback`,async t=>{
 const f=await fixture(t),p=await planStartupRevision(f.input);await interrupt(f,p,'new-moved');await interrupt(f,p,checkpoint,'rollback');
 assert.equal((await inspectStartup(f.targetDir)).status,'revision-pending');
 await assert.rejects(recoverStartupRevision(f.targetDir,p.revision,'resume'));
 const result=await recoverStartupRevision(f.targetDir,p.revision,'rollback');assert.equal(result.state,'rolled-back');assert.equal(result.installedRevision,p.fromRevision);assert.equal(result.inspection.specReady,true);
});
test('archived backup modification is refused rather than silently accepted by repeat recovery',async t=>{
 const f=await fixture(t),p=await planStartupRevision(f.input);await applyStartupRevision(f.input,p.fromRevision,p.revision);
 const backup=join(f.targetDir,`.bowerloom-revision-${p.revision}`,'previous/brief.json');fs.appendFileSync(backup,'changed backup');
 await assert.rejects(recoverStartupRevision(f.targetDir,p.revision,'resume'));
 assert.match(fs.readFileSync(backup,'utf8'),/changed backup$/);
});
