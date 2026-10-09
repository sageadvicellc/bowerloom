import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {planManagedProjection,applyManagedProjection,planProjectionRemoval,removeManagedProjection,recoverManagedProjection} from '../../../dist/packages/harness-portability/src/index.js';
const childPath=fileURLToPath(new URL('./fixtures/managed-interruption.mjs',import.meta.url));
const code=name=>e=>e?.code===name;
function fixture(t,harness='codex'){
 const dir=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'bowerloom-managed-')));fs.chmodSync(dir,0o700);t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const original=harness==='codex'?'# café: preserve this original comment\r\nmodel = "o3"\r\n[features]\r\nother = false\r\n':'{\n\t"model" : "sonnet",\n\t"other" : false\n}\n';
 const file=join(dir,harness==='codex'?'config.toml':'settings.json');fs.writeFileSync(file,original,{mode:0o640});
 return{dir,original,input:{harness,file,synthetic:true,stateDir:join(dir,'private-state'),neutral:{format:'bowerloom/harness-preferences/v1beta1',preferences:{reasoningEffort:'high'},nativeModels:{},executionAuthorized:false}}};
}
function childRequest(f,operation,revision,mode){const value={operation,input:f.input,file:f.input.file,stateDir:f.input.stateDir,revision,mode,marker:join(f.dir,'paused')};const request=join(f.dir,'request-'+operation+'-'+mode+'.json');fs.writeFileSync(request,JSON.stringify(value),{mode:0o600});return{request,value};}
for(const harness of ['codex','claude'])test(harness+' exact install/removal approvals preserve unrelated bytes, source mode and private original backup',async t=>{
 const f=fixture(t,harness),before=fs.readdirSync(f.dir),plan=await planManagedProjection(f.input);assert.deepEqual(fs.readdirSync(f.dir),before);assert.equal(plan.executionAuthorized,false);assert.equal(plan.writesAuthorized,false);assert.deepEqual(plan,await planManagedProjection(f.input));
 await assert.rejects(applyManagedProjection(f.input,'yes'),code('EXACT_APPROVAL_REQUIRED'));assert.equal(fs.existsSync(f.input.stateDir),false);
 await assert.rejects(applyManagedProjection({...f.input,neutral:{...f.input.neutral,preferences:{reasoningEffort:'low'}}},plan.revision),code('STALE_APPROVAL'));
 const installed=await applyManagedProjection(f.input,plan.revision);assert.equal(installed.status,'installed');assert.equal(installed.executionAuthorized,false);assert.equal(fs.readFileSync(f.input.file,'utf8'),plan.projection.proposedText);assert.equal(fs.statSync(f.input.file).mode&0o777,0o640);
 assert.equal(fs.statSync(f.input.stateDir).mode&0o777,0o700);for(const name of fs.readdirSync(f.input.stateDir))assert.equal(fs.statSync(join(f.input.stateDir,name)).mode&0o777,0o600,name);assert.equal(fs.readFileSync(join(f.input.stateDir,'original.bin'),'utf8'),f.original);
 await assert.rejects(applyManagedProjection(f.input,plan.revision),code('STATE_EXISTS'));assert.equal((await recoverManagedProjection({stateDir:f.input.stateDir},plan.revision)).status,'already-complete');
 const removal=await planProjectionRemoval({stateDir:f.input.stateDir});assert.notEqual(removal.revision,plan.revision);await assert.rejects(removeManagedProjection({stateDir:f.input.stateDir},plan.revision),code('STALE_APPROVAL'));
 const removed=await removeManagedProjection({stateDir:f.input.stateDir},removal.revision);assert.equal(removed.status,'removed');assert.equal(fs.readFileSync(f.input.file,'utf8'),f.original);assert.equal(fs.statSync(f.input.file).mode&0o777,0o640);assert.equal((await recoverManagedProjection({stateDir:f.input.stateDir},removal.revision)).status,'already-complete');
 await assert.rejects(removeManagedProjection({stateDir:f.input.stateDir},removal.revision),code('ALREADY_REMOVED'));
});
test('source drift and parent replacement invalidate approvals and preserve the changed file',async t=>{
 const f=fixture(t),plan=await planManagedProjection(f.input);fs.appendFileSync(f.input.file,'# changed after review\n');await assert.rejects(applyManagedProjection(f.input,plan.revision),code('STALE_APPROVAL'));assert.ok(fs.readFileSync(f.input.file,'utf8').endsWith('# changed after review\n'));assert.equal(fs.existsSync(f.input.stateDir),false);
 const p=await planManagedProjection(f.input),stateParent=join(f.dir,'state-parent');fs.mkdirSync(stateParent,{mode:0o700});const input={...f.input,stateDir:join(stateParent,'state')},other=await planManagedProjection(input);fs.renameSync(stateParent,join(f.dir,'old-state-parent'));fs.mkdirSync(stateParent,{mode:0o700});await assert.rejects(applyManagedProjection(input,other.revision),code('STALE_APPROVAL'));assert.equal(fs.existsSync(input.stateDir),false);
 const installed=await applyManagedProjection(f.input,p.revision);fs.appendFileSync(f.input.file,'# unrelated change after install\n');await assert.rejects(planProjectionRemoval({stateDir:f.input.stateDir}),code('TARGET_DRIFT'));await assert.rejects(recoverManagedProjection({stateDir:f.input.stateDir},installed.operationRevision),code('TARGET_DRIFT'));assert.ok(fs.readFileSync(f.input.file,'utf8').includes('unrelated change after install'));
});
test('overlap, case aliases, symlinks, live paths, blocked input and state collision are refused',async t=>{
 const f=fixture(t);fs.symlinkSync(f.dir,join(f.dir,'linked'));await assert.rejects(planManagedProjection({...f.input,stateDir:join(f.dir,'linked','state')}),code('MANAGED_SYMLINK'));
 await assert.rejects(planManagedProjection({...f.input,stateDir:f.input.file}),code('MANAGED_OVERLAP'));await assert.rejects(planManagedProjection({...f.input,stateDir:join(f.dir,'.CoDeX','state')}),code('PROTECTED_PATH'));
 fs.mkdirSync(join(f.dir,'PRIVATE-STATE'),{mode:0o700});await assert.rejects(planManagedProjection(f.input),code('STATE_EXISTS'));fs.rmdirSync(join(f.dir,'PRIVATE-STATE'));
 fs.writeFileSync(f.input.file,'[env]\nTOKEN="synthetic-secret"\n');await assert.rejects(planManagedProjection(f.input),code('PROJECTION_NOT_ACTIONABLE'));assert.equal(fs.existsSync(f.input.stateDir),false);
});
for(const operation of ['install','remove'])for(const mode of ['before','after'])test('process interruption '+operation+' '+mode+' rename is recoverable only under the recorded exact approval',async t=>{
 const f=fixture(t),install=await planManagedProjection(f.input);let revision=install.revision;if(operation==='remove'){await applyManagedProjection(f.input,revision);revision=(await planProjectionRemoval({stateDir:f.input.stateDir})).revision;}
 const {request}=childRequest(f,operation,revision,mode),result=spawnSync(process.execPath,[childPath,request],{encoding:'utf8',timeout:10000});assert.equal(result.signal,'SIGKILL',result.stderr);
 const bytes=fs.readFileSync(f.input.file);await assert.rejects(recoverManagedProjection({stateDir:f.input.stateDir},'0'.repeat(64)));assert.deepEqual(fs.readFileSync(f.input.file),bytes);
 const recovered=await recoverManagedProjection({stateDir:f.input.stateDir},revision);assert.equal(recovered.status,'completed');assert.equal(recovered.receipt.status,operation==='install'?'installed':'removed');assert.equal(fs.readFileSync(f.input.file,'utf8'),operation==='install'?install.projection.proposedText:f.original);assert.equal((await recoverManagedProjection({stateDir:f.input.stateDir},revision)).status,'already-complete');
});
test('drift after interruption blocks recovery and preserves backup, journal, stage and unrelated bytes',async t=>{
 const f=fixture(t),plan=await planManagedProjection(f.input),{request}=childRequest(f,'install',plan.revision,'before');const crashed=spawnSync(process.execPath,[childPath,request],{encoding:'utf8',timeout:10000});assert.equal(crashed.signal,'SIGKILL',crashed.stderr);
 fs.writeFileSync(f.input.file,'# unrelated editor content\npreserve = true\n');const names=fs.readdirSync(f.input.stateDir),backup=fs.readFileSync(join(f.input.stateDir,'original.bin'));
 await assert.rejects(recoverManagedProjection({stateDir:f.input.stateDir},plan.revision),code('TARGET_DRIFT'));assert.equal(fs.readFileSync(f.input.file,'utf8'),'# unrelated editor content\npreserve = true\n');assert.deepEqual(fs.readFileSync(join(f.input.stateDir,'original.bin')),backup);assert.deepEqual(fs.readdirSync(f.input.stateDir),names);
});
test('corrupt or partial durable records never authorize recovery',async t=>{
 const f=fixture(t),plan=await planManagedProjection(f.input),{request}=childRequest(f,'install',plan.revision,'before');spawnSync(process.execPath,[childPath,request],{encoding:'utf8',timeout:10000});const before=fs.readFileSync(f.input.file),journal=join(f.input.stateDir,'install.json'),original=fs.readFileSync(journal);
 fs.writeFileSync(journal,'{"partial":');await assert.rejects(recoverManagedProjection({stateDir:f.input.stateDir},plan.revision));assert.deepEqual(fs.readFileSync(f.input.file),before);
 fs.writeFileSync(journal,original);const changed=JSON.parse(original);changed.plan.originalText='forged backup';fs.writeFileSync(journal,JSON.stringify(changed));await assert.rejects(recoverManagedProjection({stateDir:f.input.stateDir},plan.revision),code('JOURNAL_REVISION'));assert.deepEqual(fs.readFileSync(f.input.file),before);
 fs.writeFileSync(journal,original);fs.rmSync(join(f.input.stateDir,'install-stage.json'));await assert.rejects(recoverManagedProjection({stateDir:f.input.stateDir},plan.revision),code('RECOVERY_INCOMPLETE'));assert.deepEqual(fs.readFileSync(f.input.file),before);
});
test('immediate pre-rename check preserves an unrelated edit made after the durable stage marker',async t=>{
 const f=fixture(t),plan=await planManagedProjection(f.input),{request}=childRequest(f,'install',plan.revision,'edit-after-stamp'),result=spawnSync(process.execPath,[childPath,request],{encoding:'utf8',timeout:10000});assert.equal(result.status,2);assert.equal(result.stderr,'TARGET_DRIFT');assert.equal(fs.readFileSync(f.input.file,'utf8'),'# unrelated concurrent change\nchanged = true\n');assert.equal(fs.readFileSync(join(f.input.stateDir,'original.bin'),'utf8'),f.original);
});
test('cooperative lock prevents a second manager from writing the same canonical target',async t=>{
 const f=fixture(t),plan=await planManagedProjection(f.input),{request,value}=childRequest(f,'install',plan.revision,'pause');const child=spawn(process.execPath,[childPath,request],{stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 for(let i=0;i<100&&!fs.existsSync(value.marker);i++)await new Promise(r=>setTimeout(r,20));assert.ok(fs.existsSync(value.marker),stderr);
 const other={...f.input,stateDir:join(f.dir,'second-state')},proposal=await planManagedProjection(other);await assert.rejects(applyManagedProjection(other,proposal.revision),code('PROJECTION_LOCKED'));assert.equal(fs.existsSync(other.stateDir),false);
 const ended=once(child,'exit');child.kill('SIGKILL');await ended;assert.equal((await recoverManagedProjection({stateDir:f.input.stateDir},plan.revision)).status,'completed');
});

test('terminal receipts cannot relabel unrelated bytes or the opposite operation as complete',async t=>{
 for(const operation of ['install','remove']){
  const f=fixture(t),plan=await planManagedProjection(f.input);await applyManagedProjection(f.input,plan.revision);let revision=plan.revision;
  if(operation==='remove'){revision=(await planProjectionRemoval({stateDir:f.input.stateDir})).revision;await removeManagedProjection({stateDir:f.input.stateDir},revision);}
  const location=join(f.input.stateDir,operation==='install'?'installed.json':'removed.json'),saved=JSON.parse(fs.readFileSync(location,'utf8'));
  fs.writeFileSync(location,JSON.stringify({...saved,status:operation==='install'?'removed':'installed'}));
  await assert.rejects(recoverManagedProjection({stateDir:f.input.stateDir},revision),code('RECEIPT_CORRUPT'));
  const unrelated='# unrelated terminal edit\npreserve = true\n';fs.writeFileSync(f.input.file,unrelated);saved.target.sha256=createHash('sha256').update(unrelated).digest('hex');fs.writeFileSync(location,JSON.stringify(saved));
  await assert.rejects(recoverManagedProjection({stateDir:f.input.stateDir},revision),code('RECEIPT_CORRUPT'));assert.equal(fs.readFileSync(f.input.file,'utf8'),unrelated);
 }
});
