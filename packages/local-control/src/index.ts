import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { constants, existsSync, lstatSync, mkdirSync, openSync, closeSync, fstatSync, readSync, renameSync, unlinkSync, writeFileSync, realpathSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalJson } from '../../contracts/src/index.js';
import { parseCrew } from '../../crew/src/index.js';
import { strictJson } from '../../codex-adapter/src/safe.js';
export class ControlError extends Error { constructor(readonly code: string) { super(code); this.name = 'ControlError'; } }
const fail = (code: string): never => { throw new ControlError(code); };
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
const validId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(v) && !['all','__proto__','constructor','prototype'].includes(v);
const isHash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export type AdapterKind = 'graph' | 'recipe';
interface Identity { dev: string; ino: string; birth: string; uid: number }
export interface ControlInput { root: string; team: string; spec: string; adapter?: AdapterKind; installation?: string; registry?: string }
interface Binding { root: string; rootIdentity: Identity; team: string; spec: string; specHash: string; installation: string | null; installationHash: string | null; adapter: AdapterKind | null }
export interface ControlPlan { format: 'bowerloom/control-plan/v1alpha1'; registry: string; registryRevision: string; registryAncestor: {path:string; identity:Identity}; binding: Binding; previousGeneration: number; executionAuthorized: false; revision: string }
interface Stop { id: string; at: number; scope: 'team' | 'registry' }
interface Execution { id: string; tokenHash: string; generation: number; epoch: number; startedAt: number; endedAt: number | null; status: 'ACTIVE' | 'FINISHED' | 'STOPPED' | 'UNCONFIRMED'; evidence: unknown }
interface Entry { binding: Binding; registrationRevision: string; generation: number; approvedEpoch: number; stop: Stop | null; executions: Execution[]; history: {generation:number; registrationRevision:string; stop:Stop|null}[] }
interface State { format: 'bowerloom/control-registry/v1alpha1'; epoch: number; allStop: Stop | null; entries: Record<string,Entry> }
const empty = (): State => ({format:'bowerloom/control-registry/v1alpha1',epoch:0,allStop:null,entries:{}});
export const defaultRegistry = (): string => join(homedir(),'.local','state','bowerloom');
function canonical(path: string): string {
  if (typeof path !== 'string' || !isAbsolute(path) || path !== resolve(path) || path !== path.normalize('NFC') || /[\p{Cc}\p{Cf}]/u.test(path) || Buffer.byteLength(path)>2048) fail('CONTROL_PATH');
  return path;
}
function identity(path:string):Identity { const s=lstatSync(path,{bigint:true}); if(!s.isDirectory()||s.isSymbolicLink()||Number(s.uid)!==process.getuid?.()||(Number(s.mode)&0o022))fail('CONTROL_DIRECTORY'); return{dev:s.dev.toString(),ino:s.ino.toString(),birth:s.birthtimeNs.toString(),uid:Number(s.uid)}; }
function ancestors(path:string,allowMissing=false):void {
  let current:string=sep;for(const part of canonical(path).split(sep).slice(1)){current=join(current,part);try{const s=lstatSync(current);if(s.isSymbolicLink()||!s.isDirectory())fail('CONTROL_PATH');}catch(e){if(allowMissing&&(e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}}
  if(realpathSync(path)!==path)fail('CONTROL_PATH');
}
function registryPath(path=defaultRegistry()):string {
  canonical(path);if(path===sep||path===homedir()||path.split(sep).some(p=>['.git','.codex','.claude','.ssh','node_modules'].includes(p.toLowerCase())))fail('CONTROL_REGISTRY_PATH');
  ancestors(path,true);if(existsSync(path)){identity(path);if((lstatSync(path).mode&0o077)!==0)fail('PRIVATE_REGISTRY_REQUIRED');}return path;
}
function registryAncestor(registry:string):ControlPlan['registryAncestor'] {let path=registry;while(!existsSync(path))path=dirname(path);return{path,identity:identity(path)};}
function readBytes(path:string,max=2*1024*1024,privateFile=false,replacementRetries=0):Buffer {
  ancestors(dirname(path));const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const s=fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid?.()||(s.mode&(privateFile?0o077:0o022))||s.size>max)fail('CONTROL_FILE');
    const buffer=Buffer.alloc(max+1);let length=0;while(length<buffer.length){const count=readSync(fd,buffer,length,buffer.length-length,null);if(!count)break;length+=count;}
    const after=fstatSync(fd),now=lstatSync(path);if(length>max||length!==s.size||after.size!==s.size||after.mtimeMs!==s.mtimeMs)fail('CONTROL_FILE_CHANGED');
    if(now.ino!==s.ino||now.dev!==s.dev){
      // Registry writers replace whole snapshots. Reopen and repeat every file check.
      if(replacementRetries>0)return readBytes(path,max,privateFile,replacementRetries-1);
      fail('CONTROL_FILE_CHANGED');
    }
    if(after.ctimeMs!==s.ctimeMs)fail('CONTROL_FILE_CHANGED');
    return buffer.subarray(0,length);
  }finally{closeSync(fd);}
}
function binding(input:ControlInput):Binding {
  const root=canonical(input.root);ancestors(root);const rootIdentity=identity(root);
  if(readdirSync(root).some(name=>name.normalize('NFC').toLowerCase()==='.bowerloom-revision.json'))fail('CONTROL_REVISION_PENDING');
  if(!validId(input.team)||typeof input.spec!=='string'||!input.spec||input.spec.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.'))||input.spec.includes('\\')||!input.spec.startsWith(`teams/${input.team}/`))fail('CONTROL_TEAM');
  const specPath=join(root,'.bowerloom',input.spec),specBytes=readBytes(specPath,262144),specHash=hash(specBytes);
  const definition=parseCrew(specBytes.toString('utf8'));if(definition.id!==input.team)fail('CONTROL_TEAM_BINDING');
  const paired=input.adapter!==undefined||input.installation!==undefined;
  if(paired&&(!['graph','recipe'].includes(input.adapter??'')||!input.installation))fail('CONTROL_INSTALLATION');
  const installation=paired?canonical(input.installation!):null;
  const installationBytes=installation?readBytes(installation,2*1024*1024,true):null;
  if(installationBytes){const v=strictJson(installationBytes.toString('utf8'),2*1024*1024) as Record<string,unknown>;
    if(v.format!==(input.adapter==='graph'?'trellis/local-installation/v0.7-alpha':'trellis/recipe-installation/v1'))fail('CONTROL_INSTALLATION');
    if(input.adapter==='graph'&&(v.workspaceRoot!==root||!same((v.graph as any)?.plan?.definition,definition)))fail('CONTROL_INSTALLATION_BINDING');
  }
  return{root,rootIdentity,team:input.team,spec:input.spec,specHash,installation,installationHash:installationBytes?hash(installationBytes):null,adapter:input.adapter??null};
}
function key(root:string,team:string):string{return hash(`${root}\0${team}`);}
const exactKeys=(value:unknown,keys:string[]):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.sort().join();
const natural=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
const validIdentity=(v:unknown):boolean=>exactKeys(v,['dev','ino','birth','uid'])&&['dev','ino','birth'].every(k=>typeof v[k]==='string'&&/^[0-9]{1,30}$/.test(v[k] as string))&&natural(v.uid);
const validStop=(v:unknown):boolean=>v===null||exactKeys(v,['id','at','scope'])&&isHash(v.id)&&natural(v.at)&&['team','registry'].includes(String(v.scope));
function validBinding(value:unknown):value is Binding {
  if(!exactKeys(value,['root','rootIdentity','team','spec','specHash','installation','installationHash','adapter'])||!validIdentity(value.rootIdentity)||!validId(value.team)||!isHash(value.specHash)||typeof value.root!=='string'||typeof value.spec!=='string')return false;
  try{canonical(value.root);}catch{return false;}
  if(!value.spec.startsWith(`teams/${value.team}/`)||value.spec.includes('\\')||value.spec.split('/').some(p=>!p||p.startsWith('.')))return false;
  if(value.adapter===null)return value.installation===null&&value.installationHash===null;
  if(!['graph','recipe'].includes(String(value.adapter))||typeof value.installation!=='string'||!isHash(value.installationHash))return false;
  try{canonical(value.installation);}catch{return false;}return true;
}
function state(registry:string):State {
  const file=join(registry,'registry.json');if(!existsSync(file))return empty();
  const v=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(readBytes(file,4*1024*1024,true,2)),4*1024*1024) as unknown as State;
  if(!exactKeys(v,['format','epoch','allStop','entries'])||v.format!=='bowerloom/control-registry/v1alpha1'||!natural(v.epoch)||!validStop(v.allStop)||v.allStop!==null&&v.allStop.scope!=='registry'||(v.epoch===0)!==(v.allStop===null)||!v.entries||typeof v.entries!=='object'||Array.isArray(v.entries)||Object.keys(v.entries).length>128)fail('CONTROL_REGISTRY');
  const ownerIds=new Set<string>();
  for(const[k,e]of Object.entries(v.entries)){
    if(!isHash(k)||!exactKeys(e,['binding','registrationRevision','generation','approvedEpoch','stop','executions','history'])||!validBinding(e.binding)||k!==key(e.binding.root,e.binding.team)||!isHash(e.registrationRevision)||!natural(e.generation)||e.generation<1||!natural(e.approvedEpoch)||e.approvedEpoch>v.epoch||!validStop(e.stop)||!Array.isArray(e.executions)||e.executions.length>256||!Array.isArray(e.history)||e.history.length>64||e.history.length!==e.generation-1)fail('CONTROL_REGISTRY');
    for(const[hIndex,h]of e.history.entries())if(!exactKeys(h,['generation','registrationRevision','stop'])||h.generation!==hIndex+1||!isHash(h.registrationRevision)||!validStop(h.stop))fail('CONTROL_REGISTRY');
    for(const x of e.executions){
      if(!exactKeys(x,['id','tokenHash','generation','epoch','startedAt','endedAt','status','evidence'])||!validId(x.id)||ownerIds.has(x.id)||!isHash(x.tokenHash)||!['ACTIVE','FINISHED','STOPPED','UNCONFIRMED'].includes(String(x.status))||!natural(x.generation)||x.generation<1||x.generation>e.generation||!natural(x.epoch)||x.epoch>v.epoch||x.generation===e.generation&&x.epoch!==e.approvedEpoch||!natural(x.startedAt)||(x.status==='ACTIVE'?(x.endedAt!==null||x.evidence!==null||x.generation!==e.generation):!natural(x.endedAt)||x.endedAt<x.startedAt))fail('CONTROL_REGISTRY');
      ownerIds.add(x.id);
    }
  }
  return v;
}
function save(registry:string,value:State):void {
  const text=canonicalJson(value)+'\n';if(Buffer.byteLength(text)>4*1024*1024)fail('CONTROL_LIMIT');
  const temp=join(registry,`write-${randomUUID()}.json`);writeFileSync(temp,text,{flag:'wx',mode:0o600});try{renameSync(temp,join(registry,'registry.json'));}finally{if(existsSync(temp))unlinkSync(temp);}
}
function mutate<T>(registry:string,body:(v:State)=>T):T {
  registryPath(registry);const lock=join(registry,'registry.lock');let fd:number;
  for(let attempt=0;;attempt++){try{fd=openSync(lock,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);break;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||attempt>=50)fail('CONTROL_BUSY');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}}
  const held=fstatSync(fd!);try{const v=state(registry),result=body(v);save(registry,v);return result;}
  finally{closeSync(fd!);const current=lstatSync(lock);if(current.ino===held.ino&&current.dev===held.dev&&!current.isSymbolicLink())unlinkSync(lock);}
}
export function planControl(input:ControlInput):ControlPlan {
  const registry=registryPath(input.registry),v=state(registry),b=binding(input),previous=v.entries[key(b.root,b.team)];
  if(previous?.executions.some(x=>x.status==='ACTIVE'||x.status==='UNCONFIRMED'))fail('CONTROL_OWNER_UNRESOLVED');
  const body={format:'bowerloom/control-plan/v1alpha1' as const,registry,registryRevision:hash(canonicalJson(v)),registryAncestor:registryAncestor(registry),binding:b,previousGeneration:previous?.generation??0,executionAuthorized:false as const};
  return{...body,revision:hash(canonicalJson(body))};
}
export function registerControl(input:ControlInput,approval:string):object {
  if(!isHash(approval))fail('CONTROL_APPROVAL_REQUIRED');const plan=planControl(input);if(plan.revision!==approval)fail('CONTROL_STALE_APPROVAL');
  // Directory creation is part of this explicit enrollment approval, not startup approval.
  if(!same(registryAncestor(plan.registry),plan.registryAncestor))fail('CONTROL_REGISTRY_CHANGED');
  mkdirSync(plan.registry,{recursive:true,mode:0o700});registryPath(plan.registry);
  return mutate(plan.registry,v=>{
    if(hash(canonicalJson(v))!==plan.registryRevision||!same(binding(input),plan.binding))fail('CONTROL_STALE_APPROVAL');
    const k=key(plan.binding.root,plan.binding.team),old=v.entries[k];
    if(old&&old.registrationRevision===approval)return{registered:true,registry:plan.registry,team:old.binding.team,generation:old.generation,executionAuthorized:false};
    if(old?.executions.some(x=>x.status==='ACTIVE'||x.status==='UNCONFIRMED'))fail('CONTROL_OWNER_UNRESOLVED');
    if(Object.values(v.entries).some(e=>e!==old&&plan.binding.installation&&e.binding.installation===plan.binding.installation))fail('CONTROL_INSTALLATION_ALREADY_BOUND');
    const history=old?[...old.history,{generation:old.generation,registrationRevision:old.registrationRevision,stop:old.stop}]:[];if(history.length>64)fail('CONTROL_LIMIT');
    v.entries[k]={binding:plan.binding,registrationRevision:approval,generation:(old?.generation??0)+1,approvedEpoch:v.epoch,stop:null,executions:old?.executions??[],history};
    return{registered:true,registry:plan.registry,root:plan.binding.root,team:plan.binding.team,generation:v.entries[k]!.generation,executionAuthorized:false};
  });
}
export interface StopResult { format:'bowerloom/stop-result/v1alpha1'; registry:string; scope:'one-local-registry'; selection:string; complete:boolean; teams:{root:string;team:string;generation:number;stop:Stop|null;status:'STOPPED'|'NOT_RUNNING'|'STOP_UNCONFIRMED';executions:Execution[]}[]; filesPreserved:true; backendStopped:false; unregisteredWorkIncluded:false }
export async function destruct(selection:{team:string;root?:string;registry?:string;timeoutMs?:number}):Promise<StopResult>{
  const registry=registryPath(selection.registry),timeout=selection.timeoutMs??10000;
  if(!Number.isInteger(timeout)||timeout<100||timeout>30000||selection.team!=='all'&&!validId(selection.team)||selection.team==='all'&&selection.root!==undefined||selection.team!=='all'&&!selection.root)fail('DESTRUCT_ARGUMENTS');
  if(selection.root)canonical(selection.root);
  if(!existsSync(registry))fail('CONTROL_REGISTRY_MISSING');
  const keys=mutate(registry,v=>{
    const selected=selection.team==='all'?Object.keys(v.entries):[key(selection.root!,selection.team)];
    if(selection.team!=='all'&&!v.entries[selected[0]!])fail('CONTROL_TEAM_UNKNOWN');
    const needsStop=selected.some(k=>!v.entries[k]!.stop);
    if(selection.team==='all'&&(needsStop||v.allStop===null)){v.epoch++;v.allStop={id:hash(randomBytes(32)),at:Date.now(),scope:'registry'};}
    for(const k of selected){const e=v.entries[k]!;e.stop??=selection.team==='all'?v.allStop!:{id:hash(randomBytes(32)),at:Date.now(),scope:'team'};}
    return selected.map(k=>({key:k,generation:v.entries[k]!.generation,stop:v.entries[k]!.stop}));
  });
  const started=Date.now();let result:StopResult;
  do{
    const v=state(registry);const teams=keys.map(selected=>{const e=v.entries[selected.key];if(!e)return fail('CONTROL_REGISTRY_CHANGED');
      const executions=e.executions.filter(x=>x.generation===selected.generation);const unresolved=executions.some(x=>x.status==='ACTIVE'||x.status==='UNCONFIRMED');
      return{root:e.binding.root,team:e.binding.team,generation:selected.generation,stop:selected.stop,status:unresolved?'STOP_UNCONFIRMED' as const:executions.some(x=>x.status==='STOPPED')?'STOPPED' as const:'NOT_RUNNING' as const,executions};});
    result={format:'bowerloom/stop-result/v1alpha1',registry,scope:'one-local-registry',selection:selection.team,complete:teams.every(t=>t.status!=='STOP_UNCONFIRMED'),teams,filesPreserved:true,backendStopped:false,unregisteredWorkIncluded:false};
    if(result.complete||Date.now()-started>=timeout)return structuredClone(result);await delay(25);
  }while(true);
}
export interface ControlOwner { readonly id:string; readonly signal:AbortSignal; guard():void; onStop(handler:()=>Promise<void>):void; finish(evidence:unknown,confirmed?:boolean):Promise<void> }
export function openControlOwner(installation:string,adapter:AdapterKind,registry=defaultRegistry(),expectedInstallation?:unknown):ControlOwner {
  registry=registryPath(registry);if(!existsSync(registry))fail('CONTROL_ENROLLMENT_REQUIRED');canonical(installation);const bytes=readBytes(installation,2*1024*1024,true),nonce=randomBytes(32).toString('hex'),id=`owner-${randomUUID()}`;
  if(expectedInstallation!==undefined&&!same(strictJson(bytes.toString('utf8'),2*1024*1024),expectedInstallation))fail('CONTROL_INSTALLATION_CHANGED');
  let entryKey='',generation=0,epoch=0;
  mutate(registry,v=>{
    const found=Object.entries(v.entries).filter(([,e])=>e.binding.installation===installation&&e.binding.adapter===adapter);if(found.length!==1)fail('CONTROL_ENROLLMENT_REQUIRED');
    [entryKey]=found[0]!;const e=found[0]![1];
    if(e.binding.installationHash!==hash(bytes)||!same(binding({root:e.binding.root,team:e.binding.team,spec:e.binding.spec,installation,adapter,registry}),e.binding))fail('CONTROL_BINDING_CHANGED');
    if(e.stop||e.approvedEpoch!==v.epoch)fail('TEAM_STOPPED');
    if(e.executions.some(x=>x.status==='ACTIVE'||x.status==='UNCONFIRMED'))fail('CONTROL_OWNER_UNRESOLVED');if(e.executions.length>=256)fail('CONTROL_LIMIT');
    generation=e.generation;epoch=v.epoch;e.executions.push({id,tokenHash:hash(nonce),generation,epoch,startedAt:Date.now(),endedAt:null,status:'ACTIVE',evidence:null});
  });
  const abort=new AbortController();let handler:(()=>Promise<void>)|undefined,handling:Promise<void>|undefined,finished=false;
  const stopped=()=>{abort.abort();if(handler&&!handling){handling=Promise.resolve().then(handler);void handling.catch(()=>{});}};
  const guard=()=>{if(finished)fail('CONTROL_OWNER_CLOSED');try{const v=state(registry),e=v.entries[entryKey];if(!e||e.generation!==generation||e.stop||v.epoch!==epoch||!e.executions.some(x=>x.id===id&&x.tokenHash===hash(nonce)&&x.status==='ACTIVE'))fail('TEAM_STOPPED');
    if(abort.signal.aborted)fail('TEAM_STOPPED');
    if(!same(binding({root:e!.binding.root,team:e!.binding.team,spec:e!.binding.spec,installation,adapter,registry}),e!.binding))fail('CONTROL_BINDING_CHANGED');
  }catch(e){stopped();throw e;}};
  const timer=setInterval(()=>{try{guard();}catch{/* Stop callback records cleanup, not this observation. */}},100);timer.unref();
  return{id,signal:abort.signal,guard,onStop(fn){if(handler)fail('CONTROL_HANDLER_EXISTS');handler=fn;if(abort.signal.aborted)stopped();},
    async finish(evidence,confirmed=true){if(finished)return;clearInterval(timer);
      const encoded=canonicalJson(evidence);if(Buffer.byteLength(encoded)>65536)fail('CONTROL_EVIDENCE_LIMIT');
      for(let attempt=0;;attempt++){try{mutate(registry,v=>{const e=v.entries[entryKey],x=e?.executions.find(x=>x.id===id&&x.tokenHash===hash(nonce));if(!e||!x||x.generation!==generation)return fail('CONTROL_OWNER_CHANGED');if(x.status!=='ACTIVE')return;
        x.status=confirmed?(e.stop||abort.signal.aborted?'STOPPED':'FINISHED'):'UNCONFIRMED';x.endedAt=Date.now();x.evidence=JSON.parse(encoded);});finished=true;return;
      }catch(e){if(!(e instanceof ControlError&&e.code==='CONTROL_BUSY')||attempt>=20)throw e;await delay(10);}}
    }};
}
export function controlBindingForInstallation(installation:string,adapter:AdapterKind,registry=defaultRegistry()):{root:string;team:string;registry:string}{
  registry=registryPath(registry);canonical(installation);const found=Object.values(state(registry).entries).filter(e=>e.binding.installation===installation&&e.binding.adapter===adapter);
  if(found.length!==1)fail('CONTROL_ENROLLMENT_REQUIRED');return{root:found[0]!.binding.root,team:found[0]!.binding.team,registry};
}
