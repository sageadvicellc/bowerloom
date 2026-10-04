import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, realpath, statfs, mkdtemp, mkdir, readdir, unlink, rmdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { check, sha } from './safe.js';
import { CONTROLS, LIMITS, SUPPORTED_NATIVE_BINARIES } from './policy.js';
import type { Installation } from './types.js';
export function childEnvironment(): Record<string,string> {
  const env: Record<string,string>={};
  for(const key of ['HOME','CODEX_HOME','TMPDIR','LANG','LC_ALL'])if(process.env[key]!==undefined)env[key]=process.env[key]!;
  check(Boolean(env.HOME),'HOME_UNAVAILABLE');
  env.PATH='/usr/bin:/bin:/usr/sbin:/sbin';env.CODEX_EXEC_SERVER_URL='none';env.CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED='1';
  return env;
}
async function absent(path:string) {try{await lstat(path);return false;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return true;throw e;}}
export function requireNativePin(version:string,sha256:string):void {
  check(Object.hasOwn(SUPPORTED_NATIVE_BINARIES,version)&&SUPPORTED_NATIVE_BINARIES[version]===sha256,'UNSUPPORTED_BINARY');
}
export async function installationChecks(install:Installation):Promise<Record<string,string>> {
  check(process.platform==='darwin'&&process.arch==='arm64','UNSUPPORTED_PLATFORM');
  requireNativePin(install.version,install.nativeSha256);
  check(resolve(install.nativePath)===install.nativePath&&(await realpath(install.nativePath))===install.nativePath,'BINARY_PATH');
  const meta=await lstat(install.nativePath);check(meta.isFile()&&meta.size>0&&meta.size<512*1024*1024,'BINARY_TYPE');
  const hash=createHash('sha256');for await(const chunk of createReadStream(install.nativePath))hash.update(chunk);
  check(hash.digest('hex')===install.nativeSha256,'BINARY_CHANGED');
  check(resolve(install.workRoot)===install.workRoot&&(await realpath(install.workRoot))===install.workRoot,'WORK_ROOT_PATH');
  const root=await lstat(install.workRoot);check(root.isDirectory()&&root.uid===process.getuid?.()&&(root.mode&0o077)===0,'WORK_ROOT_PERMISSIONS');
  const fs=await statfs(install.workRoot);check(fs.bavail*fs.bsize>=LIMITS.reserveBytes,'DISK_RESERVE');
  const env=childEnvironment(),home=env.CODEX_HOME??join(env.HOME!,'.codex');
  for(const name of ['AGENTS.md','AGENTS.override.md','environments.toml'])check(await absent(join(home,name)),'AMBIENT_INPUT_PRESENT');
  return env;
}
export interface Workspace {directory:string;cwd:string;schema:string;close():Promise<void>;verify():Promise<void>}
export async function workspace(root:string,schemaValue:unknown):Promise<Workspace> {
  const directory=await mkdtemp(join(root,'codex-'));const cwd=join(directory,'work'),schema=join(directory,'schema.json');
  await mkdir(cwd,{mode:0o700});const data=JSON.stringify(schemaValue);await writeFile(schema,data,{mode:0o600,flag:'wx'});
  const verify=async()=>{
    const [parent,work]=await Promise.all([lstat(directory),lstat(cwd)]);
    check(parent.isDirectory()&&!parent.isSymbolicLink()&&work.isDirectory()&&!work.isSymbolicLink(),'WORKSPACE_REPLACED');
    check(JSON.stringify((await readdir(directory)).sort())===JSON.stringify(['schema.json','work'])&&(await readdir(cwd)).length===0,'WORKSPACE_CHANGED');
    const s=await lstat(schema);check(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.size===Buffer.byteLength(data),'SCHEMA_REPLACED');
    check(sha(await readFile(schema))===sha(data),'SCHEMA_CHANGED');
  };
  return {directory,cwd,schema,verify,async close(){await verify();await unlink(schema);await rmdir(cwd);await rmdir(directory);}};
}
export function execArgs(cwd:string,schema:string):string[] {
  const profile='trellis_proposal_only';
  return [...CONTROLS,'-c','approval_policy="never"','-c',`default_permissions="${profile}"`,
    '-c',`permissions.${profile}={filesystem={":root"="deny",":minimal"="read"},network={enabled=false}}`,
    '-c','model_reasoning_effort="low"','exec','--strict-config','--ignore-user-config','--ignore-rules','--ephemeral',
    '--skip-git-repo-check','--json','--output-schema',schema,'-C',cwd,'-m','gpt-5.5','-'];
}
