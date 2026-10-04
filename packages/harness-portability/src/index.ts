import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, parse } from 'node:path';
import { createHash } from 'node:crypto';
import { parseDocument, isMap, isScalar } from 'yaml';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { canonicalJson } from '../../contracts/src/index.js';

export type Harness = 'codex' | 'claude';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh';
export interface NeutralConfig {
  format: 'bowerloom/harness-preferences/v1beta1';
  preferences: { reasoningEffort?: Effort };
  nativeModels: { codex?: 'gpt-6.1-sol' | 'o3'; claude?: 'opus' | 'sonnet' | 'fable' };
  executionAuthorized: false;
}
export interface ImportInput { harness: Harness; file: string; synthetic: true }
export interface ProjectionInput extends ImportInput { neutral: NeutralConfig }
export interface Finding { field: string; code: string }
export interface ImportReport {
  mapped: Finding[]; unsupported: Finding[]; conflicts: Finding[]; secretReferences: Finding[];
  skippedHistory: true; importedCredentials: false; runtimePortabilityVerified: false;
}
export interface SourceBinding {
  file: string; sha256: string; bytes: number;
  identity: { device: string; inode: string; birthtimeNs: string; uid: number };
}
export interface ImportResult {
  format: 'bowerloom/harness-import/v1beta1'; adapterVersion: '1'; syntaxVersion: string;
  source: SourceBinding; neutral: NeutralConfig; report: ImportReport; revision: string;
  executionAuthorized: false;
}
export interface ByteEdit { startByte: number; endByte: number; replacement: string }
export interface ProjectionPlan {
  format: 'bowerloom/harness-projection/v1beta1'; adapterVersion: '1'; syntaxVersion: string;
  source: SourceBinding; neutral: NeutralConfig; report: ImportReport;
  status: 'blocked' | 'unchanged' | 'review-required'; edits: ByteEdit[];
  /** Private local review content. Never include this in portable exports. Null if blocked. */
  proposedText: string | null; proposedSha256: string | null;
  contentScope: 'private-local-plan'; writesAuthorized: false; executionAuthorized: false; revision: string;
}
export class HarnessPortabilityError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'HarnessPortabilityError'; }
}
const MAX_BYTES = 64 * 1024;
const EFFORTS = ['low','medium','high','xhigh'] as const;
const MODELS = { codex: ['gpt-6.1-sol','o3'], claude: ['opus','sonnet','fable'] } as const;
const VERSIONS = { codex: '0.157.0', claude: '2.1.288' } as const;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function fail(code: string): never { throw new HarnessPortabilityError(code); }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) fail('INPUT_OBJECT');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key)) || Object.values(descriptors).some(d => !('value' in d))) fail('INPUT_FIELDS');
  return value as Record<string, unknown>;
}
function input(value: ImportInput | ProjectionInput, projection = false): ImportInput {
  const v = record(value, projection ? ['harness','file','synthetic','neutral'] : ['harness','file','synthetic']);
  if (!['codex','claude'].includes(v.harness as string) || v.synthetic !== true || typeof v.file !== 'string') fail('SYNTHETIC_INPUT_REQUIRED');
  const file = v.file as string;
  if (!isAbsolute(file) || resolve(file) !== file || file !== file.normalize('NFC') || Buffer.byteLength(file) > 2048 || /[\p{Cc}\p{Cf}]/u.test(file)) fail('INPUT_PATH');
  const parts = file.normalize('NFC').toLowerCase().split('/');
  if (parts.some(p => ['.codex','.claude','.ssh','.config','library','.git'].includes(p) || p.includes('nmaahc-sm')) || /^\/(?:etc|var\/root|usr|bin|sbin|system)(?:\/|$)/i.test(file) || /\.(?:jsonl|sqlite|db)$/i.test(file) || ['.claude.json','auth.json','.credentials.json','managed-settings.json'].includes(parts.at(-1)!)) fail('PROTECTED_PATH');
  if (v.harness === 'codex' ? !file.endsWith('.toml') : !file.endsWith('.json')) fail('CONFIG_EXTENSION');
  return { harness: v.harness as Harness, file, synthetic: true };
}
function neutralConfig(value: unknown): NeutralConfig {
  const v = record(value,['format','preferences','nativeModels','executionAuthorized']);
  if (v.format !== 'bowerloom/harness-preferences/v1beta1' || v.executionAuthorized !== false) fail('NEUTRAL_FORMAT');
  const preferences = record(v.preferences,['reasoningEffort']), models = record(v.nativeModels,['codex','claude']);
  if (preferences.reasoningEffort !== undefined && !EFFORTS.includes(preferences.reasoningEffort as Effort)) fail('NEUTRAL_EFFORT');
  for (const h of ['codex','claude'] as const) if(models[h] !== undefined && !(MODELS[h] as readonly unknown[]).includes(models[h])) fail('NEUTRAL_MODEL');
  return { format: 'bowerloom/harness-preferences/v1beta1', preferences: preferences.reasoningEffort === undefined ? {} : {reasoningEffort: preferences.reasoningEffort as Effort}, nativeModels: {...models} as NeutralConfig['nativeModels'], executionAuthorized: false };
}
async function directory(path: string): Promise<void> {
  if (await realpath(path) !== path) fail('SOURCE_SYMLINK');
  for(let at=path;;at=dirname(at)) { const s=await lstat(at); if(!s.isDirectory() || s.isSymbolicLink()) fail('SOURCE_DIRECTORY'); if(at===parse(at).root) break; }
  const s=await lstat(path); if(s.uid!==process.getuid?.() || s.mode & 0o022) fail('SOURCE_OWNER');
}
async function readSource(file: string): Promise<{text:string;source:SourceBinding}> {
  await directory(dirname(file));
  const named=await lstat(file); if(named.isSymbolicLink()) fail('SOURCE_SYMLINK');
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await handle.stat({bigint:true});
    if(!before.isFile() || before.nlink!==1n || Number(before.uid)!==process.getuid?.() || Number(before.mode)&0o022 || before.size>BigInt(MAX_BYTES)) fail('SOURCE_UNSAFE');
    const bytes=Buffer.alloc(MAX_BYTES+1); let size=0;
    for(;;) { const r=await handle.read(bytes,size,bytes.length-size,null); if(!r.bytesRead) break;size+=r.bytesRead;if(size>MAX_BYTES) fail('SOURCE_BOUND'); }
    const after=await handle.stat({bigint:true}),current=await lstat(file,{bigint:true});
    if(BigInt(size)!==before.size || before.dev!==after.dev || before.ino!==after.ino || before.mtimeNs!==after.mtimeNs || before.ctimeNs!==after.ctimeNs || before.ino!==current.ino || before.dev!==current.dev || current.isSymbolicLink()) fail('SOURCE_CHANGED');
    await directory(dirname(file));
    const selected=bytes.subarray(0,size);let text:string;
    try {text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(selected);}catch{return fail('SOURCE_UTF8');}
    if (text.startsWith('\uFEFF') || /[\p{Cc}\p{Cf}]/u.test(text.replace(/[\r\n\t]/g,''))) fail('SOURCE_TEXT');
    return {text,source:{file,sha256:hash(selected),bytes:size,identity:{device:String(before.dev),inode:String(before.ino),birthtimeNs:String(before.birthtimeNs),uid:Number(before.uid)}}};
  } finally {await handle.close();}
}
type Entry = { field:string;value:unknown };
type Parsed = { entries:Entry[]; insertion:number; hasFields:boolean; comments:string[] };
function fieldName(value: string): string {
  if(!/^[A-Za-z_$][A-Za-z0-9_$-]{0,63}$/.test(value) || ['__proto__','prototype','constructor'].includes(value)) fail('UNSUPPORTED_KEY');
  return value;
}
function parseJson(text:string): Parsed {
  let root:unknown;try {root=strictJson(text,MAX_BYTES);}catch{return fail('JSON_INVALID_OR_DUPLICATE');}
  if(!root || typeof root!=='object' || Array.isArray(root)) fail('JSON_ROOT');
  const entries:Entry[]=[];
  function visit(value:unknown,prefix:string) {
    if(value && typeof value==='object' && !Array.isArray(value)) {
      const pairs=Object.entries(value);if(!pairs.length && prefix)entries.push({field:prefix,value:{}});
      for(const [key,item] of pairs)visit(item,prefix?prefix+'.'+fieldName(key):fieldName(key));
    } else if(Array.isArray(value)) { if(!value.length)entries.push({field:prefix,value:[]}); for(let i=0;i<value.length;i++)visit(value[i],prefix+'['+i+']'); } else entries.push({field:prefix,value});
  }
  visit(root,'');if(entries.length>1024)fail('SOURCE_COMPLEXITY');
  const doc=parseDocument(text,{schema:'json',uniqueKeys:true});if(doc.errors.length || !isMap(doc.contents))fail('JSON_INVALID');
  // YAML supplies source positions only after the existing strict JSON parser has accepted syntax.
  for(const pair of doc.contents.items)if(!isScalar(pair.key) || typeof pair.key.value!=='string')fail('JSON_KEY');
  return {entries,insertion:text.lastIndexOf('}'),hasFields:Object.keys(root).length>0,comments:[]};
}
function parseToml(text:string):Parsed {
  const entries:Entry[]=[],comments:string[]=[],seen=new Set<string>(),tables=new Set<string>(),dottedTables=new Set<string>();let section='',offset=0,insertion=text.length;
  for(const full of text.match(/[^\n]*\n|[^\n]+$/g)??[]) {
    const line=full.replace(/\r?\n$/,'');let quote='',escaped=false,comment=line.length;
    for(let i=0;i<line.length;i++){const c=line[i]!;if(quote){if(quote==='"' && !escaped && c==='\\'){escaped=true;continue;}if(!escaped&&c===quote)quote='';escaped=false;}else if(c==='"'||c==="'")quote=c;else if(c==='#'){comment=i;break;}}
    const code=line.slice(0,comment).trim();if(comment<line.length)comments.push(line.slice(comment+1));
    if(!code){offset+=full.length;continue;}
    const table=/^\[([A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*)\]$/.exec(code);
    if(table){section=table[1]!;section.split('.').forEach(fieldName);if(tables.has(section)||dottedTables.has(section)||seen.has(section)||[...seen].some(prior=>section.startsWith(prior+'.')))fail('TOML_DUPLICATE');tables.add(section);entries.push({field:section,value:{}});insertion=Math.min(insertion,offset);offset+=full.length;continue;}
    const assignment=/^([A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*)\s*=\s*(.+)$/.exec(code);
    if(!assignment)fail('TOML_UNSUPPORTED_SYNTAX');
    const key=assignment[1]!;key.split('.').forEach(fieldName);const field=section?section+'.'+key:key;
    if(seen.has(field)||tables.has(field)||[...seen].some(prior=>prior.startsWith(field+'.')||field.startsWith(prior+'.'))||[...tables].some(prior=>prior.startsWith(field+'.')))fail('TOML_DUPLICATE');
    const raw=assignment[2]!;let value:unknown;
    if(/^'[^'\r\n]*'$/.test(raw))value=raw.slice(1,-1);
    else {
      try{value=strictJson(raw,MAX_BYTES);}catch{return fail('TOML_UNSUPPORTED_SYNTAX');}
      // JSON's escaped slash and surrogate code-unit escapes are not TOML strings.
      for(let at=0;at<raw.length;at++)if(raw[at]==='\\') {
        const escape=raw[++at];if(escape==='/')fail('TOML_UNSUPPORTED_SYNTAX');
        if(escape==='u'){const point=Number.parseInt(raw.slice(at+1,at+5),16);if(point>=0xD800&&point<=0xDFFF)fail('TOML_UNSUPPORTED_SYNTAX');at+=4;}
      }
    }
    if(value===null || typeof value==='object'&&!Array.isArray(value) || Array.isArray(value)&&value.some(v=>v===null||typeof v==='object'))fail('TOML_UNSUPPORTED_SYNTAX');
    // Dotted assignments define their parent tables. Header-created implicit
    // supertables remain distinct: [a.b] may still be followed by [a].
    const keyParts=key.split('.');for(let i=1;i<keyParts.length;i++){const parent=(section?section+'.':'')+keyParts.slice(0,i).join('.');if(tables.has(parent))fail('TOML_DUPLICATE');dottedTables.add(parent);}
    entries.push({field,value});if(entries.length>1024)fail('SOURCE_COMPLEXITY');seen.add(field);offset+=full.length;
  }
  return {entries,insertion,hasFields:entries.length>0,comments};
}
const blankReport = ():ImportReport => ({mapped:[],unsupported:[],conflicts:[],secretReferences:[],skippedHistory:true,importedCredentials:false,runtimePortabilityVerified:false});
const sensitiveKey=/(?:^|\.)(?:env|headers|http_headers|apiKeyHelper|auth|authorization|credentials?|password|secrets?|tokens?|api[_-]?key|apiKeys|bearer_token|bearer_token_env_var|url|base_url|endpoint|history|sessions?)(?:\.|$)/i;
const sensitiveText=/(?:https?:\/\/|wss?:\/\/|Bearer\s+|sk-[A-Za-z0-9_-]+|(?:api[_-]?key|password|secret|token)\s*[:=]|\/Users\/|\/home\/)/i;
const benign:Record<string,readonly unknown[]>={approval_policy:['on-request','never'],sandbox_mode:['read-only','workspace-write','danger-full-access'],web_search:['disabled','cached','live'],personality:['friendly','pragmatic','none'],'permissions.defaultMode':['manual','plan','auto','acceptEdits','bypassPermissions','dontAsk']};
function strings(value:unknown):string[]{if(typeof value==='string')return [value];if(Array.isArray(value))return value.flatMap(strings);return [];}
function analyze(harness:Harness,parsed:Parsed):{neutral:NeutralConfig;report:ImportReport} {
  const neutral:NeutralConfig={format:'bowerloom/harness-preferences/v1beta1',preferences:{},nativeModels:{},executionAuthorized:false},report=blankReport();
  const effort=harness==='codex'?'model_reasoning_effort':'effortLevel';
  for(const entry of parsed.entries) {
    const {field,value}=entry;
    if(sensitiveKey.test(field.replace(/\[\d+\]/g,''))||strings(value).some(v=>sensitiveText.test(v))){report.secretReferences.push({field,code:'SENSITIVE_REFERENCE_NOT_IMPORTED'});continue;}
    if(field==='model' && (MODELS[harness] as readonly unknown[]).includes(value)){Object.assign(neutral.nativeModels,{[harness]:value});report.mapped.push({field,code:'NATIVE_MODEL_EXPLICIT_ONLY'});continue;}
    if(field===effort && EFFORTS.includes(value as Effort)){neutral.preferences.reasoningEffort=value as Effort;report.mapped.push({field,code:'PREFERENCE_NOT_CAPABILITY_GUARANTEE'});continue;}
    report.unsupported.push({field,code:field==='model'||field===effort?'VALUE_OUTSIDE_VERIFIED_SUBSET':'FIELD_NOT_MAPPED'});
    if(strings(value).length && !(benign[field]??[]).includes(value))report.secretReferences.push({field,code:'OPAQUE_STRING_REQUIRES_LOCAL_REVIEW'});
  }
  if(parsed.comments.some(c=>sensitiveText.test(c)))report.secretReferences.push({field:'$comments',code:'SENSITIVE_COMMENT_NOT_EXPORTED'});
  if(parsed.entries.some(e=>e.field==='default_permissions') && parsed.entries.some(e=>e.field==='sandbox_mode'))report.conflicts.push({field:'default_permissions',code:'NATIVE_PERMISSION_SYSTEMS_REQUIRE_REVIEW'});
  return {neutral,report};
}
function sorted(report:ImportReport):ImportReport {for(const field of ['mapped','unsupported','conflicts','secretReferences'] as const)report[field].sort((a,b)=>a.field.localeCompare(b.field)||a.code.localeCompare(b.code));return report;}
async function load(value:ImportInput|ProjectionInput,projection=false) {
  const selected=input(value,projection),loaded=await readSource(selected.file),parsed=selected.harness==='codex'?parseToml(loaded.text):parseJson(loaded.text);
  return {...loaded,parsed,selected,...analyze(selected.harness,parsed)};
}
export async function importHarnessConfig(value:ImportInput):Promise<ImportResult> {
  const loaded=await load(value),body={format:'bowerloom/harness-import/v1beta1' as const,adapterVersion:'1' as const,syntaxVersion:VERSIONS[loaded.selected.harness],source:loaded.source,neutral:loaded.neutral,report:sorted(loaded.report),executionAuthorized:false as const};
  return {...body,revision:hash(canonicalJson(body))};
}
export async function planHarnessProjection(value:ProjectionInput):Promise<ProjectionPlan> {
  const loaded=await load(value,true),neutral=neutralConfig(value.neutral),{selected,parsed,report,text,source}=loaded;
  const requested:Record<string,string>={};if(neutral.nativeModels[selected.harness])requested.model=neutral.nativeModels[selected.harness]!;
  if(neutral.preferences.reasoningEffort)requested[selected.harness==='codex'?'model_reasoning_effort':'effortLevel']=neutral.preferences.reasoningEffort;
  const other=selected.harness==='codex'?'claude':'codex';if(neutral.nativeModels[other])report.unsupported.push({field:'nativeModels.'+other,code:'NO_AUTOMATIC_MODEL_EQUIVALENCE'});
  const additions:Record<string,string>={};
  for(const [field,wanted] of Object.entries(requested)) { const current=parsed.entries.find(e=>e.field===field);if(!current&&parsed.entries.some(e=>e.field.startsWith(field+'.')||e.field.startsWith(field+'['))){report.conflicts.push({field,code:'STRUCTURAL_FIELD_CONFLICT'});continue;}if(current && current.value!==wanted)report.conflicts.push({field,code:'EXISTING_VALUE_DIFFERS'});else if(!current)additions[field]=wanted; }
  const blocked=report.conflicts.length>0||report.secretReferences.length>0;const edits:ByteEdit[]=[];let proposedText:string|null=blocked?null:text;
  if(!blocked && Object.keys(additions).length) {
    const eol=text.includes('\r\n')?'\r\n':'\n';let insertion:string;
    if(selected.harness==='codex')insertion=(parsed.insertion>0&&!text.slice(0,parsed.insertion).endsWith('\n')?eol:'')+Object.entries(additions).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+' = '+JSON.stringify(v)).join(eol)+eol;
    else insertion=(parsed.hasFields?',':'')+eol+Object.entries(additions).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>'  '+JSON.stringify(k)+': '+JSON.stringify(v)).join(','+eol)+eol;
    const byte=Buffer.byteLength(text.slice(0,parsed.insertion));edits.push({startByte:byte,endByte:byte,replacement:insertion});proposedText=text.slice(0,parsed.insertion)+insertion+text.slice(parsed.insertion);
    if(Buffer.byteLength(proposedText)>MAX_BYTES)fail('PROJECTION_BOUND');
    const check=selected.harness==='codex'?parseToml(proposedText):parseJson(proposedText);
    for(const [field,wanted] of Object.entries(requested))if(check.entries.find(e=>e.field===field)?.value!==wanted)fail('PROJECTION_INVALID');
  }
  const body={format:'bowerloom/harness-projection/v1beta1' as const,adapterVersion:'1' as const,syntaxVersion:VERSIONS[selected.harness],source,neutral,report:sorted(report),status:blocked?'blocked' as const:edits.length?'review-required' as const:'unchanged' as const,edits,proposedText,proposedSha256:proposedText===null?null:hash(proposedText),contentScope:'private-local-plan' as const,writesAuthorized:false as const,executionAuthorized:false as const};
  return {...body,revision:hash(canonicalJson(body))};
}
