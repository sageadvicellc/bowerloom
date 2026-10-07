import https from 'node:https';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { types } from 'node:util';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { AdapterError, strictJson } from '../../codex-adapter/src/safe.js';
import { SkillSourceError, captureSkillData, closed, boundedText, relativeSkillPath, hashValue, revisionOf, freezeSkillData, validateSkillSource } from './validation.js';
import type { SkillTextFile, SkillLicense, GitSkillSource } from './types.js';
import { validateCacheBinding, openGitCacheOperation, gitCacheCode, gitCacheName, secondaryCodes, strictUtf8, GIT_CODES, GIT_PLAN_CODES, GIT_SECONDARY_CODES } from './cache.js';
import type { SkillCacheBinding, AcquiredSkillCacheReceipt } from './cache.js';
import type { ExpectedSkillFile } from './npm.js';
import { guardedResponseHeaders } from './response-headers.js';

export const GIT_ACQUISITION_POLICY = 'bowerloom/github-git-acquisition/v1beta2';
const GIT_PLAN_FORMAT = 'bowerloom/git-acquisition-plan/v1beta2';
// A v1beta1 plan read the whole repository recursively. It is retired and refuses closed.
const RETIRED_PLAN_FORMAT = 'bowerloom/git-acquisition-plan/v1beta1';
export const GIT_LIMITS = Object.freeze({ pathDepth:8, planBytes:196608, metadataBytes:524288, treeBytes:524288, blobResponseBytes:131072, payloadBytes:8388608, responseBytes:8388608, records:1024, files:128, directories:128, fileBytes:65536, selectedBytes:2097152, headerBytes:16384, requests:130, durationMs:30000, requestMs:10000, storageBytes:12582912 });
export interface GitAcquisitionRequest {
  repository:string; commit:string; tree:string; pathTrees:string[]; metadataSha256:string; declaredLicense:SkillLicense;
  skill:{id:string;name:string;sourceRoot:string}; files:ExpectedSkillFile[];
  references:{from:string;to:string}[]; license:{spdx:SkillLicense;origin:'included';files:string[]};
}
export interface GitAcquisitionPlan {
  format:typeof GIT_PLAN_FORMAT; policy:typeof GIT_ACQUISITION_POLICY;
  request:GitAcquisitionRequest; cache:SkillCacheBinding; metadataUrl:string;
  /** The root listing, each walked path tree, then the skill tree with ?recursive=1. */
  treeUrls:string[]; requestBudget:number; limits:typeof GIT_LIMITS; revision:string;
}
export interface ObservedGitPayload {
  source:GitSkillSource; skill:GitAcquisitionRequest['skill']; files:SkillTextFile[];
  references:GitAcquisitionRequest['references']; license:GitAcquisitionRequest['license'];
  contentRevision:string; inventoryRevision:string; recordCount:number;
}
// Fixed diagnostic code of each error this module constructed. GIT_CODES, in cache.ts, is the shared list.
const errors=new WeakMap<object,string>();
export class GitAcquisitionError extends Error {
  /** Fixed secondary codes only. Each reports cleanup that the refusal could not confirm. */
  readonly secondary:readonly string[];
  constructor(readonly code:string,secondary:readonly string[]=[]){super(code);this.name='GitAcquisitionError';errors.set(this,GIT_CODES.includes(code)?code:'GIT_ACQUISITION_FAILED');this.secondary=Object.freeze(secondary.filter(value=>GIT_SECONDARY_CODES.includes(value)));}
}
function refuse(code:string,secondary:readonly string[]=[]):never{throw new GitAcquisitionError(code,secondary);}
/** The listed fixed code of an error this module constructed, or null for any other error. */
export function listedGitCode(error:unknown):string|null{const code=gitFixedCode(error);return code==='GIT_ACQUISITION_FAILED'?null:code;}
/** The fixed code of an error this module constructed, including the GIT_ACQUISITION_FAILED fallback, or null. */
export function gitFixedCode(error:unknown):string|null{if(error===null||typeof error!=='object')return null;return errors.get(error)??null;}
// One mapping path: a listed Git code, or a cache refusal under its explicit Git name. Anything else gets the fallback.
function gitCode(error:unknown,listed:readonly string[],fallback:string):string{const code=listedGitCode(error)??gitCacheCode(error);return code!==null&&listed.includes(code)?code:fallback;}
function requireGit(ok:unknown,code:string):asserts ok{if(!ok)refuse(code);}
const sha256=(b:string|Uint8Array)=>createHash('sha256').update(b).digest('hex');
const objectId=(kind:'blob'|'tree',b:Buffer)=>createHash('sha1').update(`${kind} ${b.length}\0`).update(b).digest('hex');
// Only a validation refusal becomes GIT_INPUT. A TypeError or another fault reaches the boundary's fixed fallback.
function exact<T>(v:unknown,keys:string[]):T{try{return closed(v,keys) as T;}catch(error){if(error instanceof SkillSourceError)return refuse('GIT_INPUT');throw error;}}
function safe<T>(work:()=>T):T{try{return work();}catch(error){if(error instanceof SkillSourceError)return refuse('GIT_INPUT');throw error;}}
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const oid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const parentOf=(p:string)=>{const at=p.lastIndexOf('/');return at<0?'':p.slice(0,at);};
/** Pure exact proposal: no branch lookup, network or cache writes. */
export function planGitAcquisition(value:unknown,bindingValue:unknown):Readonly<GitAcquisitionPlan>{
  try{return planRequest(value,bindingValue);}catch(error){return refuse(gitCode(error,GIT_PLAN_CODES,'GIT_PLAN_REFUSED'));}
}
function planRequest(value:unknown,bindingValue:unknown):Readonly<GitAcquisitionPlan>{
  const request=exact<GitAcquisitionRequest>(value,['repository','commit','tree','pathTrees','metadataSha256','declaredLicense','skill','files','references','license']);
  safe(()=>{boundedText(request.repository,200);hashValue(request.metadataSha256);});
  requireGit(/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/.test(request.repository)&&!request.repository.endsWith('.git')&&oid(request.commit)&&oid(request.tree),'GIT_INPUT');
  requireGit(['MIT','Apache-2.0'].includes(request.declaredLicense),'GIT_INPUT');
  request.skill = exact(request.skill, ['id', 'name', 'sourceRoot']);
  safe(() => { for (const value of [request.skill.id, request.skill.name]) { boundedText(value, 64); requireGit(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value), 'GIT_INPUT'); } relativeSkillPath(request.skill.sourceRoot); });
  // One pinned tree per source root segment. The last one is the skill tree.
  const segments = request.skill.sourceRoot.split('/'), walked = new Set(segments.map((_, i) => segments.slice(0, i).join('/')));
  requireGit(segments.length <= GIT_LIMITS.pathDepth, 'GIT_PATH_DEPTH');
  requireGit(Array.isArray(request.pathTrees) && request.pathTrees.length === segments.length && request.pathTrees.every(oid), 'GIT_INPUT');
  request.license = exact(request.license, ['spdx', 'origin', 'files']);
  requireGit(request.license.spdx === request.declaredLicense && request.license.origin === 'included' && Array.isArray(request.license.files) && request.license.files.length > 0 && request.license.files.length <= 8 && new Set(request.license.files).size === request.license.files.length, 'GIT_INPUT');
  safe(() => request.license.files.forEach(relativeSkillPath));
  requireGit(Array.isArray(request.files) && request.files.length > 0 && request.files.length <= GIT_LIMITS.files, 'GIT_INPUT');
  let bytes = 0; const paths = new Set<string>(), sources = new Set<string>();
  request.files = request.files.map(raw => {
    const file = exact<ExpectedSkillFile>(raw, ['path', 'sourcePath', 'sha256', 'bytes', 'mode']);
    safe(() => { relativeSkillPath(file.path); relativeSkillPath(file.sourcePath); hashValue(file.sha256); });
    requireGit(Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= GIT_LIMITS.fileBytes && (bytes += file.bytes) <= GIT_LIMITS.selectedBytes && file.mode === 420, 'GIT_INPUT');
    requireGit(!paths.has(file.path.toLowerCase()) && !sources.has(file.sourcePath.toLowerCase()), 'GIT_INPUT'); paths.add(file.path.toLowerCase()); sources.add(file.sourcePath.toLowerCase());
    const license = request.license.files.includes(file.path);
    requireGit(license ? /(?:^|\/)(?:LICENSE|NOTICE)(?:[._-][A-Za-z0-9._-]+)?$/.test(file.path) : file.sourcePath === `${request.skill.sourceRoot}/${file.path}`, 'GIT_INPUT');
    // A license outside the skill tree must be a direct child of a tree on the walked path.
    if (license && !file.sourcePath.startsWith(request.skill.sourceRoot + '/')) requireGit(walked.has(parentOf(file.sourcePath)), 'GIT_OUTSIDE_PATH');
    return file;
  }).sort((a, b) => compare(a.path, b.path));
  const directoryNames = new Set<string>(['files']); for (const file of request.files) { const parts = file.path.split('/'); for (let i = 1; i < parts.length; i++) directoryNames.add('files/' + parts.slice(0, i).join('/')); }
  requireGit(directoryNames.size <= GIT_LIMITS.directories, 'GIT_INPUT');
  requireGit(paths.has('skill.md') && request.license.files.every(p => request.files.some(f => f.path === p)), 'GIT_INPUT');
  requireGit(request.files.every(f => !request.files.some(g => g.path !== f.path && g.path.startsWith(f.path + '/'))), 'GIT_INPUT');
  // The commit, each listing, and at most one blob per selected file.
  const requestBudget = 2 + segments.length + request.files.length; requireGit(requestBudget <= GIT_LIMITS.requests, 'GIT_REQUEST_BOUND');
  requireGit(Array.isArray(request.references) && request.references.length <= 1024, 'GIT_INPUT');
  const edges = new Set<string>();
  request.references = request.references.map(raw => {
    const edge = exact<{ from: string; to: string }>(raw, ['from', 'to']); safe(() => { relativeSkillPath(edge.from); relativeSkillPath(edge.to); });
    const key = `${edge.from}\0${edge.to}`; requireGit(!edges.has(key) && request.files.some(f => f.path === edge.from) && request.files.some(f => f.path === edge.to), 'GIT_INPUT'); edges.add(key); return edge;
  }).sort((a, b) => compare(`${a.from}\0${a.to}`, `${b.from}\0${b.to}`));
  request.license.files.sort(compare);
  const cache = validateCacheBinding(bindingValue);
  const prefix=`https://api.github.com/repos/${request.repository}/git`;
  // The root and every walked path tree are listed without recursion. Only the skill tree is recursive.
  const treeUrls=[request.tree,...request.pathTrees.slice(0,-1)].map(sha=>`${prefix}/trees/${sha}`).concat(`${prefix}/trees/${request.pathTrees.at(-1)}?recursive=1`);
  const body: Omit<GitAcquisitionPlan, 'revision'> = {format:GIT_PLAN_FORMAT,policy:GIT_ACQUISITION_POLICY,request,cache,metadataUrl:`${prefix}/commits/${request.commit}`,treeUrls,requestBudget,limits:GIT_LIMITS};
  requireGit(Buffer.byteLength(JSON.stringify(body))<=GIT_LIMITS.planBytes,'GIT_INPUT');return freezeSkillData({...body,revision:revisionOf(body)});
}
export function validateGitPlan(value:unknown):Readonly<GitAcquisitionPlan>{
  try{
    const raw=safe(()=>captureSkillData(value)) as Record<string,unknown>|null;
    requireGit(!(raw!==null&&typeof raw==='object'&&!Array.isArray(raw)&&raw.format===RETIRED_PLAN_FORMAT),'GIT_PLAN_CHANGED');
    const v=exact<GitAcquisitionPlan>(raw,['format','policy','request','cache','metadataUrl','treeUrls','requestBudget','limits','revision']);
    const plan=planRequest(v.request,v.cache);requireGit(revisionOf(v)===revisionOf(plan),'GIT_PLAN_CHANGED');return plan;
  }catch(error){return refuse(gitCode(error,GIT_PLAN_CODES,'GIT_PLAN_REFUSED'));}
}
function decode(b:Buffer):string{
  requireGit(!b.subarray(0,3).equals(Buffer.from([239,187,191])),'GIT_ENCODING');const s=strictUtf8(b);requireGit(s!==null&&Buffer.from(s).equals(b),'GIT_ENCODING');return s;
}
function parsed(b:Buffer,max:number):any{requireGit(Buffer.isBuffer(b)&&b.length>0&&b.length<=max,'GIT_BOUND');try{return captureSkillData(strictJson(decode(b),max));}catch(error){if(error instanceof GitAcquisitionError||error instanceof AdapterError||error instanceof SkillSourceError)return refuse('GIT_RESPONSE');throw error;}}
function metadata(plan:GitAcquisitionPlan,b:Buffer):void{
  requireGit(Buffer.isBuffer(b)&&b.length>0&&b.length<=GIT_LIMITS.metadataBytes&&sha256(b)===plan.request.metadataSha256,'GIT_METADATA');
  const v=parsed(b,GIT_LIMITS.metadataBytes);requireGit(v&&v.sha===plan.request.commit&&v.tree?.sha===plan.request.tree,'GIT_METADATA');
}
interface TreeEntry {path:string;mode:string;type:string;sha:string;size?:number}
// Git object modes and the API type that each one must carry.
const GIT_MODES:Readonly<Record<string,string>>=Object.freeze({'100644':'blob','100755':'blob','120000':'blob','040000':'tree','160000':'commit'});
// Git tree order: raw name bytes, with a tree compared as if its name ended in '/'.
const objectOrder=(a:{name:string;type:string},b:{name:string;type:string})=>Buffer.compare(Buffer.from(a.name+(a.type==='tree'?'/':'')),Buffer.from(b.name+(b.type==='tree'?'/':'')));
function treeObjectId(rows:{name:string;mode:string;type:string;sha:string}[]):string{
  return objectId('tree',Buffer.concat([...rows].sort(objectOrder).flatMap(e=>[Buffer.from(`${e.type==='tree'?'40000':e.mode} ${e.name}\0`),Buffer.from(e.sha,'hex')])));
}
function listing(b:Buffer,sha:string):unknown[]{
  const v=parsed(b,GIT_LIMITS.treeBytes);requireGit(v&&v.sha===sha&&v.truncated===false&&Array.isArray(v.tree)&&v.tree.length>0,'GIT_TREE');
  // The entry limit has its own code, so it never reads as a wrong or truncated listing.
  requireGit(v.tree.length<=GIT_LIMITS.records,'GIT_TREE_BOUND');return v.tree;
}
// A symlink or a submodule is refused wherever Bowerloom follows a path, reads the skill tree, or takes a license.
function plainEntry(e:TreeEntry):void{requireGit(e.mode!=='120000','GIT_SYMLINK');requireGit(e.mode!=='160000'&&e.type!=='commit','GIT_SUBMODULE');}
/**
 * One non-recursive listing on the walked path. Every entry is hashed, in any mode and under any name, so the listing
 * rebuilds to its pinned tree SHA. Only the next segment and a license here must be plain, strict entries.
 */
function pathLevel(plan:GitAcquisitionPlan,level:number,b:Buffer,live:()=>void,licenses:Map<string,string>):void{
  const segments=plan.request.skill.sourceRoot.split('/'),dir=segments.slice(0,level).join('/');
  const expected=level===0?plan.request.tree:plan.request.pathTrees[level-1]!;
  const byName=new Map<string,TreeEntry>();
  for(const raw of listing(b,expected)){live();const e=raw as TreeEntry;
    requireGit(e&&typeof e==='object'&&typeof e.path==='string'&&e.path.length>0&&Buffer.byteLength(e.path)<=1024&&!e.path.includes('/')&&!e.path.includes('\0')&&e.path!=='.'&&e.path!=='..'&&oid(e.sha)&&typeof e.mode==='string'&&Object.hasOwn(GIT_MODES,e.mode)&&GIT_MODES[e.mode]===e.type&&(e.type==='blob'?Number.isSafeInteger(e.size)&&e.size!>=0:e.size===undefined),'GIT_TREE');
    requireGit(!byName.has(e.path),'GIT_TREE');byName.set(e.path,e);
  }
  requireGit(treeObjectId([...byName.values()].map(e=>({name:e.path,mode:e.mode,type:e.type,sha:e.sha})))===expected,'GIT_TREE_DIGEST');
  const next=byName.get(segments[level]!);requireGit(next,'GIT_PATH_MISSING');plainEntry(next);
  requireGit(next.type==='tree'&&next.mode==='040000','GIT_PATH_TYPE');requireGit(next.sha===plan.request.pathTrees[level],'GIT_PATH_DIGEST');
  for(const f of plan.request.files)if(!f.sourcePath.startsWith(plan.request.skill.sourceRoot+'/')&&parentOf(f.sourcePath)===dir){
    const e=byName.get(f.sourcePath.slice(dir?dir.length+1:0));requireGit(e,'GIT_SELECTED_INVENTORY');plainEntry(e);
    requireGit(e.type==='blob'&&e.mode==='100644'&&e.size===f.bytes,'GIT_SELECTED_INVENTORY');licenses.set(f.sourcePath,e.sha);
  }
}
/** The recursive skill tree, with paths relative to the skill. Every tree SHA is rebuilt, not trusted. */
function skillTree(plan:GitAcquisitionPlan,b:Buffer,live:()=>void):Map<string,TreeEntry>{
  const root=plan.request.pathTrees.at(-1)!,prefix=plan.request.skill.sourceRoot+'/';
  const entries=new Map<string,TreeEntry>(),names=new Set<string>();
  for(const raw of listing(b,root)){live();const e=raw as TreeEntry;requireGit(e&&typeof e==='object','GIT_TREE');
    // Skill paths may contain dotfiles, but never aliases, controls, traversal or separators in components.
    requireGit(typeof e.path==='string'&&e.path.length<=512&&/^[A-Za-z0-9._/-]+$/.test(e.path)&&e.path.split('/').every(p=>p!==''&&p!=='.'&&p!=='..')&&oid(e.sha),'GIT_TREE');
    requireGit(!names.has(e.path.toLowerCase()),'GIT_TREE');names.add(e.path.toLowerCase());
    requireGit(typeof e.mode==='string'&&Object.hasOwn(GIT_MODES,e.mode)&&GIT_MODES[e.mode]===e.type&&(e.type==='blob'?Number.isSafeInteger(e.size)&&e.size!>=0:e.size===undefined),'GIT_TREE');entries.set(e.path,e);
  }
  const children=new Map<string,TreeEntry[]>();children.set('',[]);
  for(const e of entries.values()){const parent=parentOf(e.path);requireGit(parent===''||entries.get(parent)?.type==='tree','GIT_TREE');const rows=children.get(parent)??[];rows.push(e);children.set(parent,rows);if(e.type==='tree'&&!children.has(e.path))children.set(e.path,[]);}
  for(const [parent,rows] of children){live();requireGit(treeObjectId(rows.map(e=>({name:e.path.slice(parent?parent.length+1:0),mode:e.mode,type:e.type,sha:e.sha})))===(parent?entries.get(parent)!.sha:root),'GIT_TREE_DIGEST');}
  // As on the walked path, the SHA is proved first. Only then does an entry's kind name the refusal.
  for(const e of entries.values()){plainEntry(e);requireGit(e.type==='tree'?e.mode==='040000':e.mode==='100644'||e.mode==='100755','GIT_TREE');}
  const selected=new Map(plan.request.files.filter(f=>f.sourcePath.startsWith(prefix)).map(f=>[f.sourcePath.slice(prefix.length),f]));
  for(const e of entries.values())if(e.type==='blob')requireGit(selected.has(e.path),'GIT_SELECTED_INVENTORY');
  for(const [path,f] of selected){const e=entries.get(path);requireGit(e&&e.type==='blob'&&e.mode==='100644'&&e.size===f.bytes,'GIT_SELECTED_INVENTORY');}
  return entries;
}
/** The blob SHA of each selected file, from the skill tree or from the walked listing that holds its license. */
function selectedBlobs(plan:GitAcquisitionPlan,entries:Map<string,TreeEntry>,licenses:Map<string,string>):Map<string,string>{
  const prefix=plan.request.skill.sourceRoot+'/';
  return new Map(plan.request.files.map(f=>[f.sourcePath,f.sourcePath.startsWith(prefix)?entries.get(f.sourcePath.slice(prefix.length))!.sha:licenses.get(f.sourcePath)!]));
}
function base64(value:unknown,max:number):Buffer{
  requireGit(typeof value==='string'&&value.length<=Math.ceil(max/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),'GIT_BASE64');
  const b=Buffer.from(value,'base64');requireGit(b.length<=max&&b.toString('base64')===value,'GIT_BASE64');return b;
}
function blob(b:Buffer,id:string):Buffer{
  const v=parsed(b,GIT_LIMITS.blobResponseBytes);requireGit(v&&v.sha===id&&v.encoding==='base64'&&Number.isSafeInteger(v.size)&&v.size>0&&v.size<=GIT_LIMITS.fileBytes&&typeof v.content==='string','GIT_BLOB');
  // GitHub wraps base64 with LF; only complete canonical base64 plus LF is admitted.
  requireGit(v.content.length<=GIT_LIMITS.blobResponseBytes,'GIT_BLOB');const bytes=base64(v.content.replace(/\n/g,''),GIT_LIMITS.fileBytes);
  requireGit(bytes.length===v.size&&objectId('blob',bytes)===id,'GIT_BLOB_DIGEST');return bytes;
}
/**
 * Real bounded retained response bytes are rechecked on every cache inspection.
 * Contract: this helper has no fallback of its own. A raw error from `live` passes through unchanged, and the calling boundary gives its fixed fallback.
 */
export async function verifyGitPayload(planValue:unknown,metadataBytes:Buffer,payloadBytes:Buffer,signal:AbortSignal,live:()=>void):Promise<Readonly<ObservedGitPayload>>{
  const plan=validateGitPlan(planValue);const active=()=>{live();requireGit(!signal.aborted,'GIT_ABORTED');};active();
  requireGit(Buffer.isBuffer(metadataBytes)&&metadataBytes.length>0&&metadataBytes.length<=GIT_LIMITS.metadataBytes&&Buffer.isBuffer(payloadBytes)&&payloadBytes.length>0&&payloadBytes.length<=GIT_LIMITS.payloadBytes,'GIT_BOUND');
  const meta=Buffer.from(metadataBytes),payload=Buffer.from(payloadBytes);metadata(plan,meta);
  // The whole chain is checked offline: each walked listing, then the skill tree, then each blob.
  const bundle=exact<{trees:string[];blobs:{sha:string;body:string}[]}>(parsed(payload,GIT_LIMITS.payloadBytes),['trees','blobs']);
  const depth=plan.request.pathTrees.length;requireGit(Array.isArray(bundle.trees)&&bundle.trees.length===depth+1,'GIT_TREE');
  const licenses=new Map<string,string>();for(let level=0;level<depth;level++)pathLevel(plan,level,base64(bundle.trees[level],GIT_LIMITS.treeBytes),active,licenses);
  const entries=skillTree(plan,base64(bundle.trees[depth],GIT_LIMITS.treeBytes),active),shas=selectedBlobs(plan,entries,licenses);
  requireGit(Array.isArray(bundle.blobs)&&bundle.blobs.length>0&&bundle.blobs.length<=GIT_LIMITS.files,'GIT_BLOB');const blobs=new Map<string,Buffer>();
  const expected=new Set(shas.values());
  for(const raw of bundle.blobs){active();const b=exact<{sha:string;body:string}>(raw,['sha','body']);requireGit(oid(b.sha)&&expected.has(b.sha)&&!blobs.has(b.sha),'GIT_BLOB');blobs.set(b.sha,blob(base64(b.body,GIT_LIMITS.blobResponseBytes),b.sha));}
  requireGit(blobs.size===expected.size,'GIT_BLOB');
  const files=plan.request.files.map(f=>{active();const bytes=blobs.get(shas.get(f.sourcePath)!)!;requireGit(bytes.length===f.bytes&&sha256(bytes)===f.sha256,'GIT_SELECTED_INVENTORY');const text=decode(bytes);requireGit(!text.startsWith('version https://git-lfs.github.com/spec/v1'),'GIT_CONTENT');return {path:f.path,sourcePath:f.sourcePath,text,sha256:f.sha256,mode:420 as const};});
  const source:GitSkillSource={kind:'git',host:'github.com',repository:plan.request.repository,commit:plan.request.commit,tree:plan.request.tree,pathTrees:[...plan.request.pathTrees],metadataSha256:sha256(meta),declaredLicense:plan.request.declaredLicense};
  let contentRevision:string;try{contentRevision=validateSkillSource({format:'bowerloom/synthetic-skill-source/v1beta1',synthetic:true,source,skill:plan.request.skill,files,references:plan.request.references,license:plan.request.license}).revision;}catch(error){if(error instanceof SkillSourceError)return refuse('GIT_CONTENT');throw error;}
  active();return freezeSkillData({source,skill:plan.request.skill,files,references:plan.request.references,license:plan.request.license,contentRevision,inventoryRevision:revisionOf(plan.request.files),recordCount:entries.size});
}
function publicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number) as [number, number, number];
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 100 && b >= 64 && b <= 127 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 88 && c === 99) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}
// Plan, options and cache admission. A refusal here is certain, unless it carries GIT_CACHE_OPEN_PARTIAL or
// GIT_CACHE_RELEASE_UNCERTAIN. Those mean the operation folder or its owner lock was left behind.
function admit(planValue:unknown,options:unknown):{plan:Readonly<GitAcquisitionPlan>;signal:AbortSignal;operation:ReturnType<typeof openGitCacheOperation>}{
  try{
    const plan = validateGitPlan(planValue);
    requireGit(options && typeof options === 'object' && !types.isProxy(options) && [Object.prototype, null].includes(Object.getPrototypeOf(options)), 'GIT_INPUT');
    const ds = Object.getOwnPropertyDescriptors(options) as { approvalRevision?: PropertyDescriptor; signal?: PropertyDescriptor };
    requireGit(Reflect.ownKeys(ds).length === 2 && ds.approvalRevision && 'value' in ds.approvalRevision && ds.signal && 'value' in ds.signal && ds.signal.value instanceof AbortSignal, 'GIT_INPUT');
    const signal = ds.signal.value as AbortSignal; requireGit(ds.approvalRevision.value === plan.revision, 'GIT_APPROVAL');
    return { plan, signal, operation: openGitCacheOperation(plan, plan.revision, signal) };
  }catch(error){return refuse(gitCode(error,GIT_CODES,'GIT_ACQUISITION_FAILED'),secondaryCodes(error,true));}
}
/** Exact consent permits bounded immutable GitHub reads and this private cache only. */
export async function acquireGitSkill(planValue: unknown, options: { approvalRevision: string; signal: AbortSignal }): Promise<Readonly<AcquiredSkillCacheReceipt>> {
  const { plan, signal, operation } = admit(planValue, options);
  const requests = new Set<ClientRequest>(); const responses = new Set<IncomingMessage>(); const pendingClosers = new Set<(code: string) => void>();
  const controller = new AbortController(); const agent = new https.Agent({ keepAlive: false, maxSockets: 1, maxCachedSessions: 0, proxyEnv: {} } as https.AgentOptions);
  let stopped = false, timedOut = false, requestCount = 0, totalBytes = 0;
  const deadline = performance.now() + GIT_LIMITS.durationMs;
  let rejectStop!: (reason: Error) => void;
  const stoppedPromise = new Promise<never>((_, reject) => { rejectStop = reject; }); void stoppedPromise.catch(() => {});
  const stop = (timeout = false) => { if (stopped) return; stopped = true; timedOut = timeout; controller.abort(); for (const finish of [...pendingClosers]) finish(timeout ? 'GIT_TIMEOUT' : 'GIT_ABORTED'); for (const req of requests) req.destroy(); for (const response of responses) response.destroy(); agent.destroy(); rejectStop(new GitAcquisitionError(timeout ? 'GIT_TIMEOUT' : 'GIT_ABORTED')); };
  const onAbort = () => stop(); signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => stop(true), GIT_LIMITS.durationMs); timer.unref();
  const check = () => { if (signal.aborted || stopped) refuse(timedOut ? 'GIT_TIMEOUT' : 'GIT_ABORTED'); if (performance.now() >= deadline) { stop(true); refuse('GIT_TIMEOUT'); } operation.check(); };
  async function bounded<T>(work: () => Promise<T>): Promise<T> { check(); const pending = Promise.resolve().then(() => { check(); return work(); }); void pending.catch(() => {}); const result = await Promise.race([pending, stoppedPromise]); check(); return result; }
  function get(url: string, address: string, maximum: number): Promise<Buffer> {
    check(); requireGit(++requestCount <= plan.requestBudget, 'GIT_REQUEST_BOUND');
    return new Promise((resolve, reject) => {
      let done = false, response: IncomingMessage | undefined, request: ClientRequest | undefined; let bytes = 0; const chunks: Buffer[] = [];
      const requestDeadline = performance.now() + GIT_LIMITS.requestMs;
      const timeout = setTimeout(() => finish('GIT_TIMEOUT'), GIT_LIMITS.requestMs); timeout.unref();
      // A refusal from check or guard keeps its own code. A transport event gets a fixed transport code.
      const settle = (failure?: unknown) => { if (done) return; done = true; clearTimeout(timeout); pendingClosers.delete(finish); if (request) { requests.delete(request); request.destroy(); } if (response) { responses.delete(response); response.destroy(); } failure === undefined ? resolve(Buffer.concat(chunks, bytes)) : reject(failure); };
      const finish = (code?: string) => settle(code === undefined ? undefined : new GitAcquisitionError(code));
      pendingClosers.add(finish);
      try {
        check(); request = https.request(url, { method: 'GET', agent, rejectUnauthorized: true, minVersion: 'TLSv1.2', maxHeaderSize: GIT_LIMITS.headerBytes, headers: { Accept: 'application/vnd.github+json', 'Accept-Encoding': 'identity', 'User-Agent': 'bowerloom-skill-acquisition/1', 'X-GitHub-Api-Version':'2026-03-10' }, lookup: (_host, lookupOptions, callback) => { try { check(); if (lookupOptions.all) callback(null, [{ address, family: 4 }]); else callback(null, address, 4); } catch (error) { settle(error); callback(new Error('GIT_ABORTED'), '', 4); } } }, incoming => {
          if (done || stopped || signal.aborted) { incoming.destroy(); return; }
          response = incoming; responses.add(incoming);
          const guard = () => { check(); requireGit(performance.now() < requestDeadline, 'GIT_TIMEOUT'); };
          try {
            // A repeated guarded header refuses. Repeats of headers nothing reads, such as set-cookie, are ignored (D11).
            guard(); const headers = guardedResponseHeaders(incoming.rawHeaders); requireGit(headers !== null, 'GIT_RESPONSE');
            const length = headers.get('content-length'); requireGit(incoming.statusCode === 200 && !headers.has('location') && (!headers.has('content-encoding') || headers.get('content-encoding') === 'identity') && (length === undefined || /^(0|[1-9]\d*)$/.test(length)), 'GIT_RESPONSE');
            // A declared length over the limit is a bound refusal, the same code as an oversized body.
            requireGit(length === undefined || Number(length) <= maximum, 'GIT_RESPONSE_BOUND');
            incoming.on('data', (chunk: Buffer) => { try { guard(); requireGit(Buffer.isBuffer(chunk) && (bytes += chunk.length) <= maximum && (totalBytes += chunk.length) <= GIT_LIMITS.responseBytes, 'GIT_RESPONSE_BOUND'); chunks.push(chunk); } catch (error) { settle(error); } });
            incoming.on('end', () => { try { guard(); requireGit(incoming.complete && (length === undefined || bytes === Number(length)), 'GIT_RESPONSE'); finish(); } catch (error) { settle(error); } });
            incoming.on('error', () => finish('GIT_RESPONSE')); incoming.on('aborted', () => finish('GIT_RESPONSE')); incoming.on('close', () => { if (!done) finish('GIT_RESPONSE'); });
          } catch (error) { settle(error); }
        });
        requests.add(request); request.on('error', () => finish('GIT_NETWORK')); request.on('close', () => { if (!done) finish('GIT_NETWORK'); }); check(); request.end();
      } catch (error) { settle(error); }
    });
  }
  let receipt: Readonly<AcquiredSkillCacheReceipt> | undefined, failure: string | undefined, hold: string | null = null, released = false;
  try {
    check(); operation.receiving();
    // The resolver is a transport boundary. Any resolver failure, even an error with a forged domain class, is GIT_DNS.
    const addresses = await bounded(async () => { try { return await dns.lookup('api.github.com', { all: true, verbatim: true }); } catch { return refuse('GIT_DNS'); } });
    requireGit(addresses.length > 0 && addresses.length <= 16 && addresses.every(a => a.family === 4 && isIP(a.address) === 4), 'GIT_DNS');
    // A private IPv4 answer can be a rebinding attempt, so it has its own code.
    requireGit(addresses.every(a => publicIPv4(a.address)), 'GIT_NONPUBLIC_ADDRESS');
    const address = addresses[0]!.address;
    const metadataBytes = await bounded(() => get(plan.metadataUrl, address, GIT_LIMITS.metadataBytes)); metadata(plan, metadataBytes);
    // Each listing is proved before the next GET, so a wrong pin stops the walk before any blob is read.
    const listings: Buffer[] = [], licenses = new Map<string, string>(), depth = plan.request.pathTrees.length;
    for (let level = 0; level < depth; level++) { const url = plan.treeUrls[level]!; const bytes = await bounded(() => get(url, address, GIT_LIMITS.treeBytes)); pathLevel(plan, level, bytes, check, licenses); listings.push(bytes); }
    const skillBytes = await bounded(() => get(plan.treeUrls[depth]!, address, GIT_LIMITS.treeBytes)); listings.push(skillBytes);
    const entries=skillTree(plan,skillBytes,check), shas=selectedBlobs(plan,entries,licenses), blobs:{sha:string;body:string}[]=[];
    const ids=[...new Set(shas.values())].sort();
    for(const id of ids){const bytes=await bounded(()=>get(`https://api.github.com/repos/${plan.request.repository}/git/blobs/${id}`,address,GIT_LIMITS.blobResponseBytes));blob(bytes,id);blobs.push({sha:id,body:bytes.toString('base64')});}
    const payload=Buffer.from(JSON.stringify({trees:listings.map(b=>b.toString('base64')),blobs}));requireGit(payload.length<=GIT_LIMITS.payloadBytes,'GIT_BOUND');
    await bounded(() => operation.stage(metadataBytes, payload, controller.signal)); check();
    receipt = await bounded(() => operation.complete(controller.signal));
  } catch (error) {
    // Only a listed Git code, or a cache refusal under its explicit Git name, survives.
    // After the completion marker write begins, any stop, timeout or fault is uncertain.
    failure = operation.completionBegun() ? 'GIT_CACHE_COMPLETE_UNCERTAIN' : gitCode(error, GIT_CODES, 'GIT_ACQUISITION_FAILED');
    hold = operation.hold();
  } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); stop(); released = operation.release(); }
  const held = hold === null ? null : gitCacheName(hold);
  if (failure !== undefined) return refuse(failure, [...(held === null ? [] : [held]), ...(released ? [] : ['GIT_CACHE_RELEASE_UNCERTAIN'])]);
  requireGit(released && receipt, 'GIT_CACHE_RELEASE_UNCERTAIN'); return receipt;
}
