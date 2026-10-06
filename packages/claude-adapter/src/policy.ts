// Private, unwired contracts. Hashes bind data; no policy here grants native execution.
import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';
export const POLICY_VERSION = 'claude-subscription-contract/v0.7-beta.1';
export const NATIVE_VERSION = '2.1.292';
export const MODEL = 'claude-sonnet-5-5';
export const ROUTES = Object.freeze(['claude:claude-sonnet-5-5:high', 'claude:claude-sonnet-5-5:medium'] as const);
export type Route = typeof ROUTES[number];
export const LIMITS = Object.freeze({ inputBytes:32768, stdoutBytes:65536, stderrBytes:32768, events:64, processMs:60000, operationMs:180000, observationAgeMs:30000 });
export type Code = 'INPUT'|'ROUTE'|'INSTALLATION'|'DRIFT'|'CLOCK'|'STALE'|'LOOKUP'|'ACCOUNT_BINDING'|'AUTH'|'CREDITS'|'ROUNDING'|'DURATION'|'RESET'|'TIMEZONE'|'APPLICABILITY'|'MAPPING'|'COVERAGE'|'LOCAL_SELECTION'|'EFFECTIVE_EVIDENCE'|'RESPONSE_ROUTE'|'PROTOCOL';
export class ClaudeContractError extends Error {
  constructor(readonly code: Code) { super(`CLAUDE_${code}`); this.name = 'ClaudeContractError'; }
}
export function refuse(code: Code): never { throw new ClaudeContractError(code); }
export function demand(ok: unknown, code: Code): asserts ok { if(!ok) refuse(code); }
/** Trap-free descriptor capture; no JSON strings accepted, so duplicate-key decoding is not hidden here. */
export function inert(value: unknown, depth=0, budget={nodes:0,bytes:0}): any {
  demand(depth<=10 && ++budget.nodes<=2048,'INPUT');
  if(value===null || typeof value==='boolean') return value;
  if(typeof value==='number') { demand(Number.isFinite(value) && (!Number.isInteger(value)||Number.isSafeInteger(value)),'INPUT'); return value; }
  if(typeof value==='string') {
    demand(value.length<=32768,'INPUT'); const n=Buffer.byteLength(value);budget.bytes+=n;
    demand(n<=32768 && budget.bytes<=131072 && !value.includes('\0'),'INPUT');
    demand(Buffer.from(value).toString('utf8')===value,'INPUT');return value;
  }
  demand(value && typeof value==='object' && !isProxy(value),'INPUT');
  const array=Array.isArray(value),proto=Object.getPrototypeOf(value);
  demand(array?proto===Array.prototype:proto===Object.prototype||proto===null,'INPUT');
  const keys=Reflect.ownKeys(value); demand(keys.length<=129,'INPUT');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(array) {
    const n=descriptors.length?.value;
    demand(Number.isSafeInteger(n)&&n>=0&&n<=128&&keys.length===n+1,'INPUT');
    return Object.freeze(Array.from({length:n},(_,i)=>{const d=descriptors[String(i)];demand(d&&Object.hasOwn(d,'value')&&d.enumerable,'INPUT');return inert(d.value,depth+1,budget);}));
  }
  const out:Record<string,unknown>={};
  for(const key of keys) {
    demand(typeof key==='string'&&key.length<=128&&!['__proto__','prototype','constructor'].includes(key),'INPUT');
    const d=descriptors[key]!;demand(Object.hasOwn(d,'value')&&d.enumerable,'INPUT');out[key]=inert(d.value,depth+1,budget);
  }
  return Object.freeze(out);
}
export function exact(v:any,keys:readonly string[],code:Code='INPUT'):void {
  demand(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)),code);
}
export const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(v)&&!['__proto__','prototype','constructor'].includes(v);
export const time=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
export function canonical(v:any):string { return Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v); }
export const digest=(v:unknown):string=>createHash('sha256').update(canonical(inert(v))).digest('hex');
export const byteDigest=(v:string):string=>createHash('sha256').update(v).digest('hex');
export function route(value:unknown):Route { demand(typeof value==='string'&&ROUTES.some(r=>r===value),'ROUTE');return value as Route; }
export const effort=(r:Route):'medium'|'high'=>r===ROUTES[0]?'high':'medium';
export const SETTINGS_BYTES = '{"availableModels":["claude-sonnet-5-5"]}\n';
export const MCP_BYTES = '{"mcpServers":{}}\n';
/** Candidate controls only. Parser/effect enforcement and managed settings remain UNQUALIFIED. */
export function candidateArgv(value:unknown):readonly string[] {
  const r=route(value);
  return Object.freeze(['--print','--model',MODEL,'--effort',effort(r),'--output-format','json','--safe-mode','--restricted',
    '--tools','','--disallowedTools','*','--permission-mode','dontAsk','--permission-prompts','none',
    '--strict-mcp-config','--mcp-config',MCP_BYTES,'--setting-sources','','--settings',SETTINGS_BYTES,
    '--max-turns','1','--no-session-persistence']);
}
export const CANDIDATE_ENV = Object.freeze({DISABLE_UPDATES:'1',LANG:'C'});
