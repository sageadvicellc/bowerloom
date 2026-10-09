// Actual local measurements, private workspace and fixed candidate environment. No auth/config reader.
import { constants } from 'node:fs';
import { lstat,open,realpath,mkdtemp,mkdir,readdir,statfs } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join,resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANDIDATE_ENV,NATIVE_VERSION,inert,exact,hex,digest } from './policy.js';
import { requireLaunch,LaunchError } from './boundary.js';
export interface HostConfig {nativePath:string;nativeSha256:string;nativeVersion:string;artifactRoot:string;inventory:{path:string;sha256:string;bytes:number}[];artifactRevision:string;workRoot:string}
const ownPrefix='dist/packages/claude-adapter/src/';
const REQUIRED=['policy','observation','protocol','installation','boundary','host','wire','adapter-core','controlled-exchange','limited-policy','limited-protocol','limited-wire'].map(n=>`${ownPrefix}${n}.js`).concat(['startup-deadline','supervisor','guardian','safe','policy'].map(n=>`dist/packages/codex-adapter/src/${n}.js`),['dist/packages/mcp-connections/src/darwin-boot-session.js','dist/packages/mcp-connections/src/model.js','dist/packages/contracts/src/index.js']);
const same=(a:any,b:any)=>['dev','ino','mode','uid','nlink','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
export function captureHost(value:unknown):Readonly<HostConfig>{const v=inert(value);exact(v,['nativePath','nativeSha256','nativeVersion','artifactRoot','inventory','artifactRevision','workRoot']);
  for(const k of ['nativePath','artifactRoot','workRoot'])requireLaunch(typeof v[k]==='string'&&resolve(v[k])===v[k]);requireLaunch(hex(v.nativeSha256)&&v.nativeVersion===NATIVE_VERSION&&hex(v.artifactRevision));
  requireLaunch(Array.isArray(v.inventory)&&v.inventory.length>=REQUIRED.length&&v.inventory.length<=64);const paths=new Set<string>();let prior='';
  for(const row of v.inventory){exact(row,['path','sha256','bytes']);requireLaunch(typeof row.path==='string'&&/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(row.path)&&!row.path.split('/').some((p:string)=>p==='.'||p==='..')&&row.path>prior&&!paths.has(row.path)&&hex(row.sha256)&&Number.isSafeInteger(row.bytes)&&row.bytes>0&&row.bytes<=16*1024*1024);paths.add(row.path);prior=row.path;}
  requireLaunch(REQUIRED.every(p=>paths.has(p))&&digest(v.inventory)===v.artifactRevision);return v;
}
async function ancestry(path:string,active:()=>void,privateLeaf=false):Promise<void>{
  requireLaunch(await realpath(path)===path);active();let current=path;
  for(let depth=0;;depth++){requireLaunch(depth<64);const s=await lstat(current);active();requireLaunch(s.isDirectory()&&!s.isSymbolicLink()&&(s.uid===0||s.uid===process.getuid?.())&&(s.mode&0o022)===0);if(depth===0&&privateLeaf)requireLaunch(s.uid===process.getuid?.()&&(s.mode&0o077)===0);if(current==='/')break;current=dirname(current);}
}
async function measuredFile(path:string,expected:string,max:number,active:()=>void):Promise<number>{
  active();requireLaunch(await realpath(path)===path);active();await ancestry(dirname(path),active);const before=await lstat(path);active();requireLaunch(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1&&(before.uid===0||before.uid===process.getuid?.())&&(before.mode&0o022)===0&&before.size>0&&before.size<=max);
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{active();requireLaunch(same(before,await fd.stat()));active();const h=createHash('sha256'),b=Buffer.alloc(128*1024);let total=0;
    for(;;){active();const {bytesRead}=await fd.read(b,0,b.length,null);active();if(!bytesRead)break;total+=bytesRead;requireLaunch(total<=before.size);h.update(b.subarray(0,bytesRead));}
    requireLaunch(total===before.size&&h.digest('hex')===expected&&same(before,await fd.stat()));active();requireLaunch(same(before,await lstat(path)));active();return total;
  }finally{await fd.close();}
}
export async function measureHost(input:HostConfig,signal:AbortSignal):Promise<any>{
  const c=captureHost(input),active=()=>requireLaunch(!signal.aborted);
  try{active();requireLaunch(process.platform==='darwin'&&process.arch==='arm64');await ancestry(c.artifactRoot,active);await ancestry(c.workRoot,active,true);
    requireLaunch(fileURLToPath(import.meta.url)===join(c.artifactRoot,`${ownPrefix}host.js`));
    const fs=await statfs(c.workRoot);active();requireLaunch(fs.bavail*fs.bsize>12*1024**3);
    await measuredFile(c.nativePath,c.nativeSha256,512*1024*1024,active);
    let total=0;for(const f of c.inventory){total+=f.bytes;requireLaunch(total<=128*1024*1024);requireLaunch(await measuredFile(join(c.artifactRoot,f.path),f.sha256,16*1024*1024,active)===f.bytes);}
    active();return inert({format:'bowerloom/claude-measurement/v1',nativePath:c.nativePath,nativeSha256:c.nativeSha256,nativeVersion:c.nativeVersion,artifactRevision:c.artifactRevision,inventory:c.inventory,measuredAtMs:Date.now()});
  }catch{throw new LaunchError();}
}
export const candidateEnvironment=()=>({...CANDIDATE_ENV});
export const environmentRevision=()=>digest({format:'bowerloom/claude-candidate-environment/v1',environment:CANDIDATE_ENV,subscriptionQualified:false});
export interface PrivateWorkspace {cwd:string;verify():Promise<void>;close():Promise<void>}
/** Empty directory is retained as evidence; no broad cleanup or user-file deletion. */
export async function privateWorkspace(root:string,signal:AbortSignal):Promise<PrivateWorkspace>{
  const active=()=>requireLaunch(!signal.aborted);active();await ancestry(root,active,true);active();
  const directory=await mkdtemp(join(root,'claude-'));const d=await lstat(directory);active();
  const cwd=join(directory,'work');await mkdir(cwd,{mode:0o700});const w=await lstat(cwd);active();
  const verify=async()=>{const [a,b]=await Promise.all([lstat(directory),lstat(cwd)]);requireLaunch(a.isDirectory()&&b.isDirectory()&&!a.isSymbolicLink()&&!b.isSymbolicLink()&&a.dev===d.dev&&a.ino===d.ino&&b.dev===w.dev&&b.ino===w.ino&&(a.mode&0o077)===0&&(b.mode&0o077)===0);requireLaunch(JSON.stringify(await readdir(directory))==='["work"]'&&(await readdir(cwd)).length===0);};
  await verify();return {cwd,verify,close:verify};
}
