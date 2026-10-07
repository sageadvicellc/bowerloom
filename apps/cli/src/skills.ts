import fs from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { types } from 'node:util';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { strictJson } from '../../../packages/codex-adapter/src/safe.js';

const ownErrors = new WeakSet<object>();
// `codes` holds only fixed codes from the skill-sources shared list. No raw message is ever included.
function refuse(code: 'USAGE'|'SKILLS_RECORD'|'SKILLS_CHANGED'|'SKILLS_REFUSED'|'SKILLS_INTERRUPTED_UNCERTAIN'|'SKILLS_UNCERTAIN'|'SKILLS_OUTPUT', codes: readonly string[] = []): never {
  const error = new DefinitionError(code, code === 'USAGE'
    ? 'Use the exact skills source, plan, apply, inspect, update plan, or recover command shown in help. Explicit records and approvals are required.'
    : code === 'SKILLS_UNCERTAIN' && codes.some(c => c.endsWith('_CACHE_OPEN_PARTIAL'))
      ? `The skills cache operation folder is partial (${codes.join(', ')}). Recovery cannot read this folder. Start again with a new SOURCE_OPERATION; no native execution authority is granted.`
    : code === 'SKILLS_UNCERTAIN'
      ? `The skills cache state is uncertain (${codes.join(', ')}). Run bowerloom skills source inspect, then bowerloom skills source recover plan, before another action; no native execution authority is granted.`
      : `The skills command stopped${codes.length ? ` (${codes.join(', ')})` : ''}. Inspect the exact local cache and operation records before another action; no native execution authority is granted.`);
  ownErrors.add(error); throw error;
}
const forms: Record<string, readonly string[]> = Object.freeze({
  'source plan':['--request','--state','--operation','--min-free-bytes'],
  'source git plan':['--request','--state','--operation','--min-free-bytes'], 'source git acquire':['--plan','--approve'],
  'source acquire':['--plan','--approve'], 'source inspect':['--request'],
  'source recover plan':['--request'], 'source recover apply':['--plan','--approve'],
  plan:['--request'], 'update plan':['--request'], apply:['--plan','--approve','--previous'],
  inspect:['--request'], 'recover plan':['--request'], 'recover apply':['--plan','--approve'],
});
function capture(args: string[]): { command: string; flags: Map<string,string> } {
  if (!Array.isArray(args) || types.isProxy(args) || args.length < 4 || args.length > 24) refuse('USAGE');
  const tokens: string[] = [];
  for (let i=0;i<args.length;i++) {
    const d=Object.getOwnPropertyDescriptor(args,String(i));
    if (!d || !('value' in d) || typeof d.value !== 'string' || !d.value || d.value.length>2048 || Buffer.byteLength(d.value)>2048 || /[\p{Cc}\p{Cf}]/u.test(d.value)) refuse('USAGE');
    tokens.push(d.value);
  }
  if (tokens.shift() !== 'skills') refuse('USAGE');
  const at=tokens.findIndex(x=>x.startsWith('--')); if(at<1)refuse('USAGE');
  const command=tokens.slice(0,at).join(' ');
  if (!Object.hasOwn(forms,command)) refuse('USAGE');
  const required=forms[command]!, tail=tokens.slice(at),flags=new Map<string,string>();
  if(tail.length!==required.length*2)refuse('USAGE');
  for(let i=0;i<tail.length;i+=2){const k=tail[i]!,v=tail[i+1]!;if(!required.includes(k)||flags.has(k)||v.startsWith('-'))refuse('USAGE');flags.set(k,v);}
  if(required.some(k=>!flags.has(k)))refuse('USAGE');
  for(const k of ['--approve','--previous'])if(flags.has(k)&&!(k==='--previous'&&flags.get(k)==='none')&&!/^[a-f0-9]{64}$/.test(flags.get(k)!))refuse('USAGE');
  return {command,flags};
}
// A managed refusal names only a code from the managed-skills list. A foreign, raw or unlisted error names none.
function managedCodes(error: unknown, listed: unknown, kind: unknown): string[] {
  if (error === null || typeof error !== 'object' || types.isProxy(error) || !Array.isArray(listed) || typeof kind !== 'function') return [];
  try { if (!(error instanceof (kind as abstract new (...args: never[]) => unknown))) return []; const code: unknown = (error as { code?: unknown }).code; return typeof code === 'string' && listed.includes(code) ? [code] : []; } catch { return []; }
}
function canonicalPath(value: string): void {
  if(!isAbsolute(value)||value==='/'||resolve(value)!==value||value!==value.normalize('NFC')||value.includes('\\')||value.length>2048||Buffer.byteLength(value)>2048)refuse('SKILLS_RECORD');
}
function stamp(s: fs.BigIntStats): string {
  return [s.dev,s.ino,s.uid,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs,s.birthtimeNs].join(':');
}
function readRecord(file: string, limit: number, check:()=>void): { value: any; verify:()=>void } {
  canonicalPath(file);const parents:string[]=[];for(let p=dirname(file);;p=dirname(p)){parents.unshift(p);if(p==='/')break;}
  const uid=BigInt(process.getuid!());
  const ancestorPins=parents.map(p=>{check();const s=fs.lstatSync(p,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||(s.uid!==uid&&s.uid!==0n)||(s.mode&0o7022n)!==0n)refuse('SKILLS_RECORD');return {path:p,stamp:stamp(s)};});
  const verifyAncestors=()=>{for(const p of ancestorPins){check();if(stamp(fs.lstatSync(p.path,{bigint:true}))!==p.stamp)refuse('SKILLS_CHANGED');}};
  let original='';let hash='';
  const read=()=>{
    check();verifyAncestors();const before=fs.lstatSync(file,{bigint:true});
    if(!before.isFile()||before.isSymbolicLink()||before.uid!==uid||before.nlink!==1n||(before.mode&0o7777n)!==0o600n||before.size<=0n||before.size>BigInt(limit))refuse('SKILLS_RECORD');
    let fd:number|undefined;
    try {
      check();fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);if(stamp(fs.fstatSync(fd,{bigint:true}))!==stamp(before))refuse('SKILLS_CHANGED');
      const bytes=Buffer.alloc(Number(before.size)+1);let n=0;
      while(n<bytes.length){check();const count=fs.readSync(fd,bytes,n,bytes.length-n,null);if(!count)break;n+=count;}
      if(n!==Number(before.size)||stamp(fs.fstatSync(fd,{bigint:true}))!==stamp(before)||stamp(fs.lstatSync(file,{bigint:true}))!==stamp(before))refuse('SKILLS_CHANGED');
      verifyAncestors();check();const content=bytes.subarray(0,n),digest=createHash('sha256').update(content).digest('hex');
      if(original&&(stamp(before)!==original||digest!==hash))refuse('SKILLS_CHANGED');original=stamp(before);hash=digest;return content;
    }finally{if(fd!==undefined)fs.closeSync(fd);}
  };
  const bytes=read(),text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  if(!Buffer.from(text).equals(bytes))refuse('SKILLS_RECORD');
  const value=strictJson(text,limit);if(!value||typeof value!=='object'||Array.isArray(value))refuse('SKILLS_RECORD');
  return {value,verify:()=>{read();}};
}
/** CLI-owned single operation. No runtime registration or model authority. */
export async function runSkillsCommand(args:string[]):Promise<unknown>{
  let controller:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined,hold:ReturnType<typeof setInterval>|undefined;
  let summarize:((error:unknown)=>Readonly<{uncertain:boolean;codes:readonly string[]}>)|undefined,managed:((error:unknown)=>string[])|undefined;
  const interrupt=()=>controller?.abort();
  try {
    const {command,flags}=capture(args);controller=new AbortController();const signal=controller.signal,deadline=performance.now()+35000;
    const check=()=>{if(performance.now()>=deadline)controller!.abort();if(signal.aborted)refuse('SKILLS_INTERRUPTED_UNCERTAIN');};
    process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);timer=setTimeout(interrupt,35000);
    // Retain process ownership while a signal-less cache operation settles. No race abandons it.
    hold=setInterval(()=>{},1000);
    const source=command.startsWith('source '),record=readRecord(flags.get('--request')??flags.get('--plan')!,source?196608:8388608,check);
    const invoke=async():Promise<unknown>=>{
      if(source){
        const cache=await import('../../../packages/skill-sources/src/cache.js');summarize=cache.refusalSummary;check();
        if(command==='source git plan'||command==='source git acquire'){
          const git=await import('../../../packages/skill-sources/src/git.js');check();
          if(command==='source git plan'){
            const text=flags.get('--min-free-bytes')!;if(!/^[1-9][0-9]{0,15}$/.test(text)||!Number.isSafeInteger(Number(text)))refuse('USAGE');
            const binding=cache.observeSkillCacheRoot(flags.get('--state')!,flags.get('--operation')!,Number(text));record.verify();check();return git.planGitAcquisition(record.value,binding);
          }
          record.verify();check();return git.acquireGitSkill(record.value,{approvalRevision:flags.get('--approve')!,signal});
        }
        if(command==='source plan'){
          const npm=await import('../../../packages/skill-sources/src/npm.js');check();
          const text=flags.get('--min-free-bytes')!;if(!/^[1-9][0-9]{0,15}$/.test(text)||!Number.isSafeInteger(Number(text)))refuse('USAGE');
          const binding=cache.observeSkillCacheRoot(flags.get('--state')!,flags.get('--operation')!,Number(text));record.verify();check();return npm.planNpmAcquisition(record.value,binding);
        }
        if(command==='source acquire'){const npm=await import('../../../packages/skill-sources/src/npm.js');record.verify();check();return npm.acquireNpmSkill(record.value,{approvalRevision:flags.get('--approve')!,signal});}
        record.verify();check();
        if(command==='source inspect')return cache.inspectSkillCache(record.value);
        if(command==='source recover plan')return cache.planSkillCacheRecovery(record.value);
        return cache.recoverSkillCache(record.value,flags.get('--approve')!);
      }
      const observed=await import('../../../packages/managed-skills/src/observed.js');managed=error=>managedCodes(error,observed.MANAGED_SKILL_CODES,observed.ManagedSkillError);check();
      if(command==='plan'||command==='update plan'){
        if(record.value.operation!==(command==='plan'?'install':'update'))refuse('USAGE');record.verify();check();return observed.planObservedManagedSkill(record.value,{signal});
      }
      if(command==='inspect'){record.verify();check();return observed.inspectObservedManagedSkill(record.value);}
      const tx=await import('../../../packages/managed-skills/src/transaction.js');record.verify();check();
      if(command==='apply')return tx.applyObservedManagedSkill(record.value,flags.get('--approve')!,flags.get('--previous')==='none'?null:flags.get('--previous')!,{signal});
      if(command==='recover plan')return tx.planObservedManagedSkillRecovery(record.value,{signal});
      return tx.recoverObservedManagedSkill(record.value,flags.get('--approve')!,{signal});
    };
    const result=await invoke();
    if(performance.now()>=deadline)controller.abort();
    const output=signal.aborted?{status:'completed-after-interruption',result,inspectionRequired:true,executionAuthorized:false}:result;
    // Existing modules return bounded inert results; no foreign exception or provider body is logged.
    if(Buffer.byteLength(JSON.stringify(output)??'')>16777216)refuse('SKILLS_OUTPUT');return output;
  }catch(error){
    if(error&&typeof error==='object'&&ownErrors.has(error))throw error;
    if(controller?.signal.aborted)refuse('SKILLS_INTERRUPTED_UNCERTAIN');
    // An uncertain or secondary-bearing source refusal names the recovery path. A certain refusal keeps SKILLS_REFUSED.
    const summary=summarize?.(error);if(summary?.uncertain)refuse('SKILLS_UNCERTAIN',summary.codes);
    // A certain refusal names its listed fixed code. An unlisted, raw or foreign error names none.
    refuse('SKILLS_REFUSED',summary?.codes??managed?.(error)??[]);
  }finally{clearTimeout(timer);clearInterval(hold);process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);controller?.abort();}
}
