import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, readdir, readlink, realpath, rename, rm, statfs } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestExecution, TestReport, TestRecord } from '../../controlled-tests/src/types.js';
import { copy, exact, frozen, record as validateRecord, report as validateReport } from '../../controlled-tests/src/validation.js';
import { canonicalJson, digest } from '../../contracts/src/index.js';

const IMAGE='node@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4';
const ASSETS=fileURLToPath(new URL('../../../../packages/linux-browser/assets/',import.meta.url));
const FORMAT='trellis/linux-browser-installation/v0.7-alpha';
const LABEL='ai.sagetrellis.linux-browser';
const ID=/^sha256:[a-f0-9]{64}$/;
type Installation={format:typeof FORMAT;stateRoot:string;browserRoot:string;librariesRoot:string};
type Pin={path:string;digest:string;bytes:number};
type Runtime={browserFiles:Pin[];libraries:Pin[];libraryLinks:{file:string;target:string}[];[key:string]:unknown};
type Journal={version:1;id:string;requestDigest:string;nonce:string;cid:string|null;stage:'PREPARED'|'CREATING'|'CREATED'|'REAPED'};
type Active={creation:Promise<void>;reap?:Promise<void>};
export class BrowserError extends Error {constructor(readonly code:string){super(code);this.name='BrowserError';}}
function check(v:unknown,c:string):asserts v {if(!v)throw new BrowserError(c);}
const safeId=(id:string):string=>{check(ID.test(id),'INVALID_OPERATION');return id.slice(7);};
function unchanged(a:import('node:fs').Stats,b:import('node:fs').Stats):boolean {
 return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&b.isFile()&&b.nlink===1;
}
async function readBounded(path:string,max:number,consume:(bytes:Buffer)=>void):Promise<void>{
 const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const before=await h.stat();check(before.isFile()&&before.nlink===1&&before.size<=max,'INVALID_FILE');
  const buffer=Buffer.alloc(Math.min(65536,max+1));let total=0;
  for(;;){const r=await h.read(buffer,0,Math.min(buffer.length,max+1-total),total);if(r.bytesRead===0)break;total+=r.bytesRead;check(total<=max,'FILE_GREW');consume(buffer.subarray(0,r.bytesRead));}
  const after=await h.stat(),named=await lstat(path);check(total===before.size&&unchanged(before,after)&&unchanged(before,named)&&!named.isSymbolicLink(),'FILE_CHANGED');
 }finally{await h.close();}
}
async function hashFile(path:string,max:number):Promise<string>{const hash=createHash('sha256');await readBounded(path,max,b=>{hash.update(b);});return 'sha256:'+hash.digest('hex');}
async function regular(path:string,max:number):Promise<Buffer>{const chunks:Buffer[]=[];await readBounded(path,max,b=>chunks.push(Buffer.from(b)));return Buffer.concat(chunks);}
async function absent(path:string):Promise<boolean>{try{await lstat(path);return false;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return true;throw e;}}
async function privateDirectory(path:string):Promise<void>{const s=await lstat(path);check(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid?.()&&(s.mode&0o777)===0o700&&await realpath(path)===path,'PRIVATE_DIRECTORY_REQUIRED');}
async function atomic(path:string,value:unknown):Promise<void>{const temp=path+'.'+randomUUID();const h=await open(temp,'wx',0o600);try{await h.writeFile(canonicalJson(value));await h.sync();}finally{await h.close();}await rename(temp,path);const d=await open(dirname(path),'r');try{await d.sync();}finally{await d.close();}}
async function durableMarker(path:string):Promise<void>{try{const h=await open(path,'wx',0o600);try{await h.writeFile('fenced');await h.sync();}finally{await h.close();}}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}const d=await open(dirname(path),'r');try{await d.sync();}finally{await d.close();}}
export type DockerResult={code:number|null;out:string;err:string};
/** Internal fixed transport. Exported for isolated transport tests, not installation configuration. */
export async function docker(args:string[],timeout=5000,signal?:AbortSignal):Promise<DockerResult>{
 return new Promise((res,rej)=>{const child=spawn('/usr/local/bin/docker',['--context','desktop-linux',...args],{env:{HOME:process.env.HOME,PATH:'/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',...(process.env.CODEX_HOME===undefined?{}:{CODEX_HOME:process.env.CODEX_HOME})},stdio:['ignore','pipe','pipe']});let out=Buffer.alloc(0),err=Buffer.alloc(0),failure:string|null=null;
 const stop=(code:string)=>{failure??=code;child.kill('SIGKILL');},timer=setTimeout(()=>stop('DOCKER_TIMEOUT'),timeout),abort=()=>stop('CANCELLED');signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 for(const [stream,key] of [[child.stdout,'out'],[child.stderr,'err']] as const){stream.on('error',()=>stop('DOCKER_PIPE'));stream.on('data',(b:Buffer)=>{if(key==='out')out=Buffer.concat([out,b.subarray(0,Math.max(0,16385-out.length))]);else err=Buffer.concat([err,b.subarray(0,Math.max(0,16385-err.length))]);if(out.length+err.length>16384)stop('OUTPUT_BOUND');});}
 child.once('error',()=>{failure??='DOCKER_SPAWN';});child.once('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);failure?rej(new BrowserError(failure)):res({code,out:out.toString(),err:err.toString()});});});
}

export class LinuxBrowserExecutor {
 readonly #manifest:string;
 get manifest():string{return this.#manifest;}
 readonly #installation:Installation;readonly #runtime:Runtime;readonly #runner:Buffer;readonly #seccomp:Buffer;readonly #active=new Map<string,Active>();
 private constructor(i:Installation,runtime:Runtime,runner:Buffer,seccomp:Buffer,manifest:string){this.#installation=i;this.#runtime=runtime;this.#runner=runner;this.#seccomp=seccomp;this.#manifest=manifest;}
 static async open(value:unknown):Promise<LinuxBrowserExecutor>{
  const i=copy(value,4096);check(exact(i,['format','stateRoot','browserRoot','librariesRoot'])&&i.format===FORMAT,'INVALID_INSTALLATION');
  for(const k of ['stateRoot','browserRoot','librariesRoot']){const p=i[k];check(typeof p==='string'&&isAbsolute(p)&&resolve(p)===p&&!p.includes(',')&&!p.includes('\n')&&await realpath(p)===p,'INVALID_INSTALLATION_PATH');}
  const installation=i as Installation;check(new Set([installation.stateRoot,installation.browserRoot,installation.librariesRoot]).size===3,'OVERLAPPING_PATHS');
  for(const a of Object.values(installation).filter(x=>x.startsWith('/')))for(const b of Object.values(installation).filter(x=>x.startsWith('/')))if(a!==b)check(!a.startsWith(b+sep),'OVERLAPPING_PATHS');
  await privateDirectory(installation.stateRoot);
  const runner=await regular(join(ASSETS,'runner.cjs'),32768),seccomp=await regular(join(ASSETS,'seccomp.json'),32768),runtime=JSON.parse((await regular(join(ASSETS,'runtime-manifest.json'),262144)).toString()) as Runtime;
  check(digest(seccomp)===runtime.seccomp,'PACKAGE_POLICY_CHANGED');
  const contract=await regular(join(ASSETS,'craft-shop-contract.md'),16384),implementation=await regular(fileURLToPath(import.meta.url),65536);
  const manifest=canonicalJson({format:'trellis/registered-test/v0.7-alpha',testId:'craft-shop-ui-v1',testerDigest:digest(canonicalJson({runner:digest(runner),contract:digest(contract),executor:digest(implementation)})),environmentDigest:digest(canonicalJson(runtime)),criteria:['add-job','change-stage','reload','export'],limits:{timeoutMs:25000,outputBytes:16384,artifactBytes:65536}});
  const e=new LinuxBrowserExecutor(frozen(installation),runtime,runner,seccomp,manifest);await e.#verifyAssets();return e;
 }
 async #verifyAssets():Promise<void>{
  const i=this.#installation;await privateDirectory(i.stateRoot);check(await realpath(i.browserRoot)===i.browserRoot&&await realpath(i.librariesRoot)===i.librariesRoot,'ASSET_ROOT_CHANGED');
  const verify=async(root:string,pins:Pin[],links:{file:string;target:string}[])=>{
   const expected=new Set([...pins.map(p=>p.path),...links.map(p=>p.file)]),seen=new Set<string>();
   const walk=async(path:string,prefix=''):Promise<void>=>{for(const name of await readdir(path)){const rel=prefix+name,s=await lstat(join(path,name));if(s.isDirectory()){check(!s.isSymbolicLink(),'ASSET_TYPE');await walk(join(path,name),rel+'/');}else{check(expected.has(rel),'UNPINNED_ASSET');seen.add(rel);const link=links.find(x=>x.file===rel);if(link){check(s.isSymbolicLink()&&await readlink(join(root,rel))===link.target&&!link.target.includes('/')&&await realpath(join(root,rel))===join(root,link.target),'ASSET_LINK');}else{const pin=pins.find(x=>x.path===rel)!;check(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.size===pin.bytes,'ASSET_TYPE');check(await hashFile(join(root,rel),pin.bytes)===pin.digest,'ASSET_HASH');}}}};
   await walk(root);check(seen.size===expected.size,'MISSING_ASSET');
  };
  await verify(i.browserRoot,this.#runtime.browserFiles,[]);await verify(i.librariesRoot,this.#runtime.libraries,this.#runtime.libraryLinks);
 }
 #directory(id:string):string{return join(this.#installation.stateRoot,safeId(id));}
 async #journal(id:string):Promise<Journal>{const dir=this.#directory(id);await privateDirectory(dir);const j=JSON.parse((await regular(join(dir,'journal.json'),4096)).toString());check(exact(j,['version','id','requestDigest','nonce','cid','stage'])&&j.version===1&&j.id===id&&typeof j.requestDigest==='string'&&ID.test(j.requestDigest)&&typeof j.nonce==='string'&&/^[a-f0-9-]{36}$/.test(j.nonce)&&(j.cid===null||(typeof j.cid==='string'&&/^[a-f0-9]{64}$/.test(j.cid)))&&['PREPARED','CREATING','CREATED','REAPED'].includes(j.stage as string),'CORRUPT_JOURNAL');check(j.stage!=='REAPED'||j.cid!==null,'CORRUPT_JOURNAL');return j as Journal;}
 async #inspect(cid:string):Promise<{id:string;label:string;image:string;running:boolean}|null>{const r=await docker(['container','inspect','--format',`{"id":{{json .Id}},"label":{{json (index .Config.Labels "${LABEL}")}},"image":{{json .Config.Image}},"running":{{json .State.Running}}}`,cid]);if(r.code!==0){if(/No such (object|container)/.test(r.err))return null;throw new BrowserError('INSPECT_FAILED');}return JSON.parse(r.out);}
 #argv(dir:string,nonce:string):string[]{const i=this.#installation;return ['container','create','--pull=never','--name','trellis-browser-'+nonce,'--label',LABEL+'='+nonce,'--init','--user','1000:1000','--network','none','--ipc','private','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges=true','--security-opt','seccomp='+join(dir,'seccomp.json'),'--memory','1g','--memory-swap','1g','--pids-limit','256','--cpus','1','--shm-size','128m','--restart','no','--tmpfs','/scratch:rw,noexec,nosuid,nodev,size=67108864,mode=0700,uid=1000,gid=1000','--workdir','/input',...[[join(dir,'input'),'/input'],[i.browserRoot,'/browser'],[i.librariesRoot,'/libraries']].flatMap(([a,b])=>['--mount',`type=bind,source=${a},target=${b},readonly`]),'--env','HOME='+process.env.HOME,...(process.env.CODEX_HOME===undefined?[]:['--env','CODEX_HOME='+process.env.CODEX_HOME]),'--env','TMPDIR=/scratch/tmp','--env','LD_LIBRARY_PATH=/libraries','--env','LANG=C.UTF-8','--entrypoint','/usr/local/bin/node',IMAGE,'/input/runner.cjs'];}
 async reap(id:string):Promise<void>{
  const dir=this.#directory(id);check(!await absent(dir),'UNKNOWN_OPERATION');await privateDirectory(dir);await durableMarker(join(dir,'fence'));const active=this.#active.get(id);if(active?.reap)return active.reap;
  const cleanup=(async()=>{if(active)await active.creation.catch(()=>{});const j=await this.#journal(id);if(j.stage==='REAPED')return;if(!j.cid)throw new BrowserError('CREATION_UNCERTAIN');
   const info=await this.#inspect(j.cid);if(info){check(info.id===j.cid&&info.label===j.nonce&&info.image===IMAGE,'OWNERSHIP_MISMATCH');if(info.running){const r=await docker(['container','stop','--time','1',j.cid]);check(r.code===0,'STOP_FAILED');}const r=await docker(['container','rm','--force',j.cid]);check(r.code===0,'REMOVE_FAILED');}check(await this.#inspect(j.cid)===null,'CONTAINER_REMAINS');
   await rm(join(dir,'input'),{recursive:true,force:true});await atomic(join(dir,'journal.json'),{...j,stage:'REAPED'});
  })();if(active)active.reap=cleanup;return cleanup;
 }
 async execute(value:TestExecution,signal:AbortSignal):Promise<TestReport>{
  const request=copy(value,100000);const bound:TestRecord={version:1,id:request.operationId,request,approvalDigest:digest('controller-bound'),status:'CLAIMED',reason:null,evidence:null,evidenceRef:null};validateRecord(bound);check(canonicalJson(request.manifest)===this.manifest,'MANIFEST_BINDING');check(!signal.aborted&&Date.now()<request.deadlineMs&&request.startedAtMs<=Date.now(),'CANCELLED_OR_EXPIRED');
  const dir=this.#directory(request.operationId);await privateDirectory(this.#installation.stateRoot);const disk=await statfs(this.#installation.stateRoot);check(disk.bavail*disk.bsize>12.1*2**30,'DISK_RESERVE');await mkdir(dir,{mode:0o700});await chmod(dir,0o700);
  const journal:Journal={version:1,id:request.operationId,requestDigest:request.requestDigest,nonce:randomUUID(),cid:null,stage:'PREPARED'};
  const active:Active={creation:Promise.resolve()};this.#active.set(request.operationId,active);
  const live=async()=>{check(await absent(join(dir,'fence'))&&!signal.aborted&&Date.now()<request.deadlineMs,'CANCELLED_OR_EXPIRED');};
  active.creation=(async()=>{await atomic(join(dir,'journal.json'),journal);const canary=await open(join(dir,'outside-canary'),'wx',0o600);try{await canary.writeFile('synthetic-host-canary');}finally{await canary.close();}await this.#verifyAssets();await live();await mkdir(join(dir,'input'),{mode:0o755});await chmod(join(dir,'input'),0o755);
   for(const [name,bytes] of [['index.html',request.artifact.content],['request.json',JSON.stringify({...request,outsideCanaryPath:join(dir,'outside-canary')})],['runner.cjs',this.#runner]] as const){const f=await open(join(dir,'input',name),'wx',0o444);try{await f.writeFile(bytes);}finally{await f.close();}await chmod(join(dir,'input',name),0o444);}
   const policy=await open(join(dir,'seccomp.json'),'wx',0o600);try{await policy.writeFile(this.#seccomp);await policy.sync();}finally{await policy.close();}
   await atomic(join(dir,'journal.json'),{...journal,stage:'CREATING'});await live();const created=await docker(this.#argv(dir,journal.nonce));check(created.code===0&&/^[a-f0-9]{64}\s*$/.test(created.out),'CREATION_UNCERTAIN');journal.cid=created.out.trim();journal.stage='CREATED';await atomic(join(dir,'journal.json'),journal);
  })();let report:TestReport;
  try{await active.creation;await live();const info=await this.#inspect(journal.cid!);check(info?.id===journal.cid&&info?.label===journal.nonce&&info?.image===IMAGE,'OWNERSHIP_MISMATCH');await live();const r=await docker(['container','start','--attach',journal.cid!],Math.max(1,request.deadlineMs-Date.now()),signal);await atomic(join(dir,'bounded-output.json'),r);const envelope=JSON.parse(r.out);check(envelope.evidence?.groupGone===true,'GROUP_REMAINS');const e=envelope.evidence;check(Object.values(e.boundary??{}).length===7&&Object.values(e.boundary).every(x=>x===true),'BOUNDARY_FAILED');check(e.browserSandbox?.some((s:{Seccomp:string;Seccomp_filters:string;NoNewPrivs:string})=>s.Seccomp==='2'&&Number(s.Seccomp_filters)>Number(e.containerSelf?.Seccomp_filters)&&s.NoNewPrivs==='1'),'SANDBOX_UNVERIFIED');check(r.code===envelope.report?.exitCode,'EXIT_BINDING');check((await regular(join(dir,'outside-canary'),64)).toString()==='synthetic-host-canary','HOST_CANARY_CHANGED');report={...envelope.report,scratchRemoved:true};await atomic(join(dir,'evidence.json'),e);
  }finally{await this.reap(request.operationId);}
  return copy(validateReport(report,bound),16384);
 }
}
