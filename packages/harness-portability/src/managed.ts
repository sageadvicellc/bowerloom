import fs from 'node:fs';
import { dirname, isAbsolute, join, resolve, parse } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from '../../contracts/src/index.js';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { HarnessPortabilityError, planHarnessProjection } from './index.js';
import type { ProjectionInput, ProjectionPlan, SourceBinding } from './index.js';

type Identity = SourceBinding['identity'];
type Target = { sha256:string;identity:Identity;mode:number };
type Binding = { targetParent:Identity;stateParent:Identity };
export interface ManagedProjectionInput extends ProjectionInput { stateDir:string }
export interface RemovalInput { stateDir:string }
export interface ManagedProjectionPlan {
  format:'bowerloom/managed-projection-plan/v1beta1';input:ManagedProjectionInput;
  projection:ProjectionPlan;originalText:string;originalMode:number;binding:Binding;
  contentScope:'private-local-plan';writesAuthorized:false;executionAuthorized:false;revision:string;
}
export interface ManagedProjectionReceipt {
  format:'bowerloom/managed-projection-receipt/v1beta1';status:'installed'|'removed';
  stateDir:string;file:string;installRevision:string;operationRevision:string;
  target:Target;executionAuthorized:false;
}
export interface RemovalPlan {
  format:'bowerloom/projection-removal-plan/v1beta1';stateDir:string;file:string;
  installRevision:string;installedReceiptSha256:string;target:Target;binding:Binding;
  originalSha256:string;executionAuthorized:false;revision:string;
}
export interface RecoveryResult { status:'completed'|'already-complete';receipt:ManagedProjectionReceipt }
type InstallJournal={format:'bowerloom/projection-journal/v1beta1';kind:'install';approvalRevision:string;plan:ManagedProjectionPlan;stateIdentity:Identity};
type RemoveJournal={format:'bowerloom/projection-journal/v1beta1';kind:'remove';approvalRevision:string;plan:RemovalPlan;stateIdentity:Identity};
type Lock={format:'bowerloom/projection-lock/v1beta1';file:string;stateDir:string;revision:string;pid:number;token:string};
const MAX=512*1024,hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function fail(code:string):never{throw new HarnessPortabilityError(code);}
function check(value:unknown,code:string):asserts value{if(!value)fail(code);}
function exact(value:unknown,keys:string[]):Record<string,unknown>{check(value!==null&&typeof value==='object'&&!Array.isArray(value)&&[null,Object.prototype].includes(Object.getPrototypeOf(value)),'MANAGED_SCHEMA');const descriptors=Object.getOwnPropertyDescriptors(value);check(Reflect.ownKeys(value).length===keys.length&&keys.every(k=>Object.hasOwn(descriptors,k))&&Object.values(descriptors).every(d=>'value'in d),'MANAGED_SCHEMA');return value as Record<string,unknown>;}
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
function approved(value:string):void{check(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'EXACT_APPROVAL_REQUIRED');}
function path(value:string):string{
  check(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&value===value.normalize('NFC')&&Buffer.byteLength(value)<=2048&&!/[\p{Cc}\p{Cf}]/u.test(value),'MANAGED_PATH');
  const parts=value.toLowerCase().split('/');check(!parts.some(p=>['.codex','.claude','.ssh','.config','library','.git'].includes(p)||p.includes('nmaahc-sm'))&&!/^\/(?:etc|var\/root|usr|bin|sbin|system)(?:\/|$)/i.test(value)&&!['.claude.json','auth.json','.credentials.json','managed-settings.json'].includes(parts.at(-1)!),'PROTECTED_PATH');return value;
}
function identity(value:fs.BigIntStats):Identity{return{device:String(value.dev),inode:String(value.ino),birthtimeNs:String(value.birthtimeNs),uid:Number(value.uid)};}
function id(value:unknown):Identity{const v=exact(value,['device','inode','birthtimeNs','uid']);check(['device','inode','birthtimeNs'].every(k=>typeof v[k]==='string'&&/^\d+$/.test(v[k] as string))&&Number.isSafeInteger(v.uid),'MANAGED_IDENTITY');return v as unknown as Identity;}
function directory(value:string,privateMode=false):Identity{
  path(value);check(fs.realpathSync(value)===value,'MANAGED_SYMLINK');for(let at=value;;at=dirname(at)){const s=fs.lstatSync(at);check(s.isDirectory()&&!s.isSymbolicLink(),'MANAGED_DIRECTORY');if(at===parse(at).root)break;}
  const s=fs.lstatSync(value,{bigint:true});check(Number(s.uid)===process.getuid?.()&&!(Number(s.mode)&0o022)&&(!privateMode||(Number(s.mode)&0o777)===0o700),'MANAGED_OWNER');return identity(s);
}
function absent(value:string):boolean{try{fs.lstatSync(value);return false;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return true;throw e;}}
function newPath(value:string):void{path(value);directory(dirname(value));const folded=value.split('/').at(-1)!.normalize('NFC').toLowerCase();check(!fs.readdirSync(dirname(value)).some(n=>n.normalize('NFC').toLowerCase()===folded),'STATE_EXISTS');}
function read(value:string,max=MAX,privateMode=false):{bytes:Buffer;target:Target}{
  directory(dirname(value),privateMode);check(fs.realpathSync(value)===value,'MANAGED_SYMLINK');const fd=fs.openSync(value,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{const before=fs.fstatSync(fd,{bigint:true});check(before.isFile()&&before.nlink===1n&&before.size<=BigInt(max)&&Number(before.uid)===process.getuid?.()&&!(Number(before.mode)&0o022)&&(!privateMode||(Number(before.mode)&0o777)===0o600),'MANAGED_FILE');
    const buffer=Buffer.alloc(max+1);let size=0;for(;;){const n=fs.readSync(fd,buffer,size,buffer.length-size,null);if(!n)break;size+=n;check(size<=max,'MANAGED_BOUND');}
    const after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(value,{bigint:true});check(before.size===BigInt(size)&&same(identity(before),identity(after))&&same(identity(before),identity(named))&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs&&!named.isSymbolicLink(),'SOURCE_CHANGED');directory(dirname(value),privateMode);
    const bytes=buffer.subarray(0,size);return{bytes,target:{sha256:hash(bytes),identity:identity(before),mode:Number(before.mode)&0o777}};
  }finally{fs.closeSync(fd);}
}
function syncDir(value:string):void{const fd=fs.openSync(value,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function durable(value:string,bytes:string|Buffer,mode=0o600):void{const fd=fs.openSync(value,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fchmodSync(fd,mode);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDir(dirname(value));}
function save(value:string,data:unknown):void{durable(value,canonicalJson(data)+'\n');}
function parsed(value:string):unknown{try{return strictJson(read(value,MAX,true).bytes.toString('utf8'),MAX);}catch(e){if(e instanceof HarnessPortabilityError)throw e;return fail('JOURNAL_CORRUPT');}}
function disjoint(file:string,state:string):void{check(file!==state&&!file.startsWith(state+'/')&&!state.startsWith(file+'/'),'MANAGED_OVERLAP');}
function bindings(plan:ManagedProjectionPlan):void{check(same(directory(dirname(plan.input.file)),plan.binding.targetParent)&&same(directory(dirname(plan.input.stateDir)),plan.binding.stateParent),'ANCESTOR_CHANGED');check(fs.realpathSync(plan.input.file)===plan.input.file,'MANAGED_SYMLINK');}
function targetMatches(file:string,wanted:Target):void{check(same(read(file,65536).target,wanted),'TARGET_DRIFT');}
function projectionInput(value:ManagedProjectionInput):ProjectionInput{exact(value,['harness','file','synthetic','neutral','stateDir']);path(value.stateDir);path(value.file);check(value.synthetic===true&&['codex','claude'].includes(value.harness)&&(value.harness==='codex'?value.file.endsWith('.toml'):value.file.endsWith('.json')),'SYNTHETIC_INPUT_REQUIRED');disjoint(value.file,value.stateDir);return{harness:value.harness,file:value.file,synthetic:value.synthetic,neutral:value.neutral};}
function bodyHash(value:Record<string,unknown>):void{const{revision,...body}=value;approved(revision as string);check(hash(canonicalJson(body))===revision,'JOURNAL_REVISION');}
export async function planManagedProjection(value:ManagedProjectionInput):Promise<ManagedProjectionPlan>{
  const selected=projectionInput(value);newPath(value.stateDir);const projection=await planHarnessProjection(selected);check(projection.status==='review-required'&&projection.proposedText!==null,'PROJECTION_NOT_ACTIONABLE');
  const binding={targetParent:directory(dirname(value.file)),stateParent:directory(dirname(value.stateDir))};const original=read(value.file,65536);check(original.target.sha256===projection.source.sha256&&same(original.target.identity,projection.source.identity),'SOURCE_CHANGED');
  const input:ManagedProjectionInput={...selected,neutral:projection.neutral,stateDir:value.stateDir};const body={format:'bowerloom/managed-projection-plan/v1beta1' as const,input,projection,originalText:original.bytes.toString('utf8'),originalMode:original.target.mode,binding,contentScope:'private-local-plan' as const,writesAuthorized:false as const,executionAuthorized:false as const};return{...body,revision:hash(canonicalJson(body))};
}
function validatePlan(value:unknown,state:string):ManagedProjectionPlan{
  const v=exact(value,['format','input','projection','originalText','originalMode','binding','contentScope','writesAuthorized','executionAuthorized','revision']);bodyHash(v);check(v.format==='bowerloom/managed-projection-plan/v1beta1'&&v.contentScope==='private-local-plan'&&v.writesAuthorized===false&&v.executionAuthorized===false,'JOURNAL_SCHEMA');
  const plan=v as unknown as ManagedProjectionPlan;projectionInput(plan.input);check(plan.input.synthetic===true&&['codex','claude'].includes(plan.input.harness)&&plan.input.stateDir===state,'JOURNAL_BINDING');path(plan.input.file);
  const p=exact(plan.projection,['format','adapterVersion','syntaxVersion','source','neutral','report','status','edits','proposedText','proposedSha256','contentScope','writesAuthorized','executionAuthorized','revision']);bodyHash(p);
  check(p.format==='bowerloom/harness-projection/v1beta1'&&p.status==='review-required'&&p.executionAuthorized===false&&p.writesAuthorized===false&&typeof p.proposedText==='string'&&Buffer.byteLength(p.proposedText)<=65536&&hash(p.proposedText)===p.proposedSha256,'JOURNAL_PROJECTION');
  exact(plan.projection.source,['file','sha256','bytes','identity']);id(plan.projection.source.identity);check(plan.projection.source.file===plan.input.file&&same(plan.projection.neutral,plan.input.neutral),'JOURNAL_BINDING');
  check(typeof plan.originalText==='string'&&Buffer.byteLength(plan.originalText)<=65536&&hash(plan.originalText)===plan.projection.source.sha256&&Number.isInteger(plan.originalMode)&&plan.originalMode>=0&&plan.originalMode<=0o777&&!(plan.originalMode&0o022),'JOURNAL_ORIGINAL');
  exact(plan.binding,['targetParent','stateParent']);id(plan.binding.targetParent);id(plan.binding.stateParent);bindings(plan);return plan;
}
function installJournal(state:string):InstallJournal{
  directory(state,true);const v=exact(parsed(join(state,'install.json')),['format','kind','approvalRevision','plan','stateIdentity']);check(v.format==='bowerloom/projection-journal/v1beta1'&&v.kind==='install','JOURNAL_SCHEMA');const plan=validatePlan(v.plan,state);check(v.approvalRevision===plan.revision&&same(id(v.stateIdentity),directory(state,true)),'JOURNAL_BINDING');check(hash(read(join(state,'original.bin'),65536,true).bytes)===plan.projection.source.sha256,'BACKUP_CHANGED');return v as unknown as InstallJournal;
}
function receipt(state:string,name:string,install:InstallJournal):ManagedProjectionReceipt{
  const v=exact(parsed(join(state,name)),['format','status','stateDir','file','installRevision','operationRevision','target','executionAuthorized']);check(v.format==='bowerloom/managed-projection-receipt/v1beta1'&&['installed','removed'].includes(v.status as string)&&v.stateDir===state&&v.file===install.plan.input.file&&v.installRevision===install.approvalRevision&&v.executionAuthorized===false,'RECEIPT_CORRUPT');approved(v.operationRevision as string);exact(v.target,['sha256','identity','mode']);const target=v.target as Target;id(target.identity);approved(target.sha256);check(target.mode===install.plan.originalMode&&v.status===(name==='installed.json'?'installed':'removed')&&target.sha256===(name==='installed.json'?install.plan.projection.proposedSha256:install.plan.projection.source.sha256),'RECEIPT_CORRUPT');return v as unknown as ManagedProjectionReceipt;
}
const lockPath=(file:string)=>join(dirname(file),'.bowerloom-projection-'+hash(file.normalize('NFC').toLowerCase()).slice(0,24)+'.lock');
function alive(pid:number):boolean{try{process.kill(pid,0);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')return false;return true;}}
async function locked<T>(file:string,stateDir:string,revision:string,recovery:boolean,work:()=>Promise<T>|T):Promise<T>{
  const location=lockPath(file);directory(dirname(file));
  if(!absent(location)){
    check(recovery,'PROJECTION_LOCKED');const saved=read(location,4096);const old=exact(strictJson(saved.bytes.toString('utf8')),['format','file','stateDir','revision','pid','token']);check(old.format==='bowerloom/projection-lock/v1beta1'&&old.file===file&&old.stateDir===stateDir&&old.revision===revision&&Number.isSafeInteger(old.pid)&&(old.pid as number)>0,'LOCK_MISMATCH');check(!alive(old.pid as number),'PROJECTION_LOCKED');check(same(read(location,4096).target,saved.target),'LOCK_CHANGED');fs.unlinkSync(location);syncDir(dirname(location));
  }
  const token=randomUUID();save(location,{format:'bowerloom/projection-lock/v1beta1',file,stateDir,revision,pid:process.pid,token} satisfies Lock);const own=read(location,4096).target;
  try{return await work();}finally{
    if(!absent(location)){const current=read(location,4096);check(same(current.target,own),'LOCK_CHANGED');const held=exact(strictJson(current.bytes.toString('utf8')),['format','file','stateDir','revision','pid','token']);check(held.token===token,'LOCK_CHANGED');fs.unlinkSync(location);syncDir(dirname(location));}
  }
}
const stagePath=(plan:ManagedProjectionPlan,revision:string)=>join(dirname(plan.input.file),'.bowerloom-projection-'+revision+'.stage');
function stage(plan:ManagedProjectionPlan,state:string,revision:string,kind:'install'|'remove',text:string):Target{
  const file=stagePath(plan,revision);check(absent(file),'STAGE_EXISTS');durable(file,text,plan.originalMode);const pin=read(file,65536).target;save(join(state,kind+'-stage.json'),{revision,target:pin});return pin;
}
function stagePin(plan:ManagedProjectionPlan,state:string,revision:string,kind:'install'|'remove',desiredHash:string):Target{
  check(!absent(join(state,kind+'-stage.json')),'RECOVERY_INCOMPLETE');const v=exact(parsed(join(state,kind+'-stage.json')),['revision','target']);exact(v.target,['sha256','identity','mode']);const target=v.target as Target;id(target.identity);check(v.revision===revision&&target.sha256===desiredHash&&target.mode===plan.originalMode,'STAGE_CORRUPT');return target;
}
function finish(plan:ManagedProjectionPlan,state:string,revision:string,kind:'install'|'remove',pin:Target):ManagedProjectionReceipt{
  bindings(plan);targetMatches(plan.input.file,pin);const result:ManagedProjectionReceipt={format:'bowerloom/managed-projection-receipt/v1beta1',status:kind==='install'?'installed':'removed',stateDir:state,file:plan.input.file,installRevision:plan.revision,operationRevision:revision,target:pin,executionAuthorized:false};save(join(state,kind==='install'?'installed.json':'removed.json'),result);return result;
}
function commit(plan:ManagedProjectionPlan,state:string,revision:string,kind:'install'|'remove',expected:Target,pin:Target):ManagedProjectionReceipt{
  bindings(plan);targetMatches(stagePath(plan,revision),pin);targetMatches(plan.input.file,expected);
  // This is an optimistic same-user guard plus a cooperative lock, not filesystem CAS.
  fs.renameSync(stagePath(plan,revision),plan.input.file);syncDir(dirname(plan.input.file));return finish(plan,state,revision,kind,pin);
}
export async function applyManagedProjection(value:ManagedProjectionInput,approvalRevision:string):Promise<ManagedProjectionReceipt>{
  approved(approvalRevision);const planned=await planManagedProjection(value);check(planned.revision===approvalRevision,'STALE_APPROVAL');return locked(value.file,value.stateDir,approvalRevision,false,async()=>{
    const plan=await planManagedProjection(value);check(plan.revision===approvalRevision,'STALE_APPROVAL');bindings(plan);newPath(value.stateDir);fs.mkdirSync(value.stateDir,{mode:0o700});syncDir(dirname(value.stateDir));const stateIdentity=directory(value.stateDir,true);
    durable(join(value.stateDir,'original.bin'),plan.originalText);save(join(value.stateDir,'install.json'),{format:'bowerloom/projection-journal/v1beta1',kind:'install',approvalRevision,plan,stateIdentity} satisfies InstallJournal);
    const pin=stage(plan,value.stateDir,approvalRevision,'install',plan.projection.proposedText!);return commit(plan,value.stateDir,approvalRevision,'install',{sha256:plan.projection.source.sha256,identity:plan.projection.source.identity,mode:plan.originalMode},pin);
  });
}
function removalInput(value:RemovalInput):string{exact(value,['stateDir']);return path(value.stateDir);}
export async function planProjectionRemoval(value:RemovalInput):Promise<RemovalPlan>{
  const state=removalInput(value),journal=installJournal(state),plan=journal.plan;check(absent(join(state,'removed.json')),'ALREADY_REMOVED');check(absent(join(state,'remove.json')),'RECOVERY_REQUIRED');const installed=receipt(state,'installed.json',journal);check(installed.status==='installed'&&installed.operationRevision===plan.revision&&installed.target.sha256===plan.projection.proposedSha256,'RECEIPT_CORRUPT');targetMatches(plan.input.file,installed.target);
  const body={format:'bowerloom/projection-removal-plan/v1beta1' as const,stateDir:state,file:plan.input.file,installRevision:plan.revision,installedReceiptSha256:hash(read(join(state,'installed.json'),MAX,true).bytes),target:installed.target,binding:plan.binding,originalSha256:plan.projection.source.sha256,executionAuthorized:false as const};return{...body,revision:hash(canonicalJson(body))};
}
function removalJournal(state:string,install:InstallJournal):RemoveJournal{
  const v=exact(parsed(join(state,'remove.json')),['format','kind','approvalRevision','plan','stateIdentity']);check(v.format==='bowerloom/projection-journal/v1beta1'&&v.kind==='remove'&&same(id(v.stateIdentity),install.stateIdentity),'JOURNAL_SCHEMA');const p=exact(v.plan,['format','stateDir','file','installRevision','installedReceiptSha256','target','binding','originalSha256','executionAuthorized','revision']);bodyHash(p);check(p.format==='bowerloom/projection-removal-plan/v1beta1'&&p.stateDir===state&&p.file===install.plan.input.file&&p.installRevision===install.approvalRevision&&p.originalSha256===install.plan.projection.source.sha256&&p.executionAuthorized===false&&v.approvalRevision===p.revision&&same(p.binding,install.plan.binding),'JOURNAL_BINDING');check(p.installedReceiptSha256===hash(read(join(state,'installed.json'),MAX,true).bytes),'RECEIPT_CHANGED');const installed=receipt(state,'installed.json',install);check(same(p.target,installed.target),'JOURNAL_BINDING');return v as unknown as RemoveJournal;
}
export async function removeManagedProjection(value:RemovalInput,approvalRevision:string):Promise<ManagedProjectionReceipt>{
  approved(approvalRevision);const first=await planProjectionRemoval(value);check(first.revision===approvalRevision,'STALE_APPROVAL');return locked(first.file,first.stateDir,approvalRevision,false,async()=>{
    const removal=await planProjectionRemoval(value);check(removal.revision===approvalRevision,'STALE_APPROVAL');const install=installJournal(value.stateDir),plan=install.plan;save(join(value.stateDir,'remove.json'),{format:'bowerloom/projection-journal/v1beta1',kind:'remove',approvalRevision,plan:removal,stateIdentity:install.stateIdentity} satisfies RemoveJournal);
    const pin=stage(plan,value.stateDir,approvalRevision,'remove',plan.originalText);return commit(plan,value.stateDir,approvalRevision,'remove',removal.target,pin);
  });
}
export async function recoverManagedProjection(value:RemovalInput,approvalRevision:string):Promise<RecoveryResult>{
  approved(approvalRevision);const state=removalInput(value),initial=installJournal(state);const kind=approvalRevision===initial.approvalRevision?'install':'remove';if(kind==='remove'){check(!absent(join(state,'remove.json')),'STALE_APPROVAL');check(removalJournal(state,initial).approvalRevision===approvalRevision,'STALE_APPROVAL');}
  return locked(initial.plan.input.file,state,approvalRevision,true,()=>{
    const install=installJournal(state),plan=install.plan;const removal=kind==='remove'?removalJournal(state,install):null;check((removal?.approvalRevision??install.approvalRevision)===approvalRevision,'STALE_APPROVAL');
    const terminal=kind==='install'?'installed.json':'removed.json';check(kind==='remove'||absent(join(state,'remove.json')),'REMOVAL_SUPERSEDES_INSTALL');
    if(!absent(join(state,terminal))){const done=receipt(state,terminal,install);check(done.operationRevision===approvalRevision,'RECEIPT_CORRUPT');targetMatches(plan.input.file,done.target);return{status:'already-complete',receipt:done};}
    const desired=kind==='install'?plan.projection.proposedSha256!:plan.projection.source.sha256,pin=stagePin(plan,state,approvalRevision,kind,desired);const current=read(plan.input.file,65536).target;
    if(same(current,pin)){check(absent(stagePath(plan,approvalRevision)),'STAGE_CHANGED');return{status:'completed',receipt:finish(plan,state,approvalRevision,kind,pin)};}
    const expected=removal?.plan.target??{sha256:plan.projection.source.sha256,identity:plan.projection.source.identity,mode:plan.originalMode};check(same(current,expected),'TARGET_DRIFT');return{status:'completed',receipt:commit(plan,state,approvalRevision,kind,expected,pin)};
  });
}
