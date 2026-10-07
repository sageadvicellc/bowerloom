// Private startup contract. No authority is issued here; the trusted host supplies a consumed claim.
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { readDarwinBootSession, validBootSession } from '../../mcp-connections/src/darwin-boot-session.js';
import type { AdmissionDispatchEnvelope } from '../../admission/src/types.js';
import { AdapterError, check, id, sha, time } from './safe.js';
import { MODEL_ROUTE } from './policy.js';

export const STARTUP_CLOCK = 'darwin-node24.11.0-libuv1.51.0-hrtime-v1' as const;
export interface StartupRuntime { executable: string; sha256: string; nodeVersion: 'v24.11.0'; uvVersion: '1.51.0'; platform: 'darwin'; arch: 'arm64' }
export interface StartupAuthorization {
  format: 'bowerloom/codex-startup/v1' | 'bowerloom/claude-startup/v1'; clock: typeof STARTUP_CLOCK;
  admission: Readonly<AdmissionDispatchEnvelope>; runtime: StartupRuntime;
  accountBindingDigest: string; promptDigest: string; modelRoute: string; proposalPlanRevision: string; launchPlanRevision: string;
}
export interface StartupPreparation { launcherId: string; accountBindingDigest: string; promptDigest: string; modelRoute: string; launchPlanRevision: string }
const MAX_HR = (1n << 64n) - 1n;
const hex = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function inert(value: unknown, depth = 0): any {
  check(depth <= 5, 'STARTUP_INPUT');
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    check(typeof value !== 'string' || Buffer.byteLength(value) <= 4096, 'STARTUP_INPUT'); return value;
  }
  if (Array.isArray(value)) {
    check(Object.getPrototypeOf(value) === Array.prototype && value.length <= 256, 'STARTUP_INPUT');
    const d = Object.getOwnPropertyDescriptors(value); check(Reflect.ownKeys(value).length === value.length + 1, 'STARTUP_INPUT');
    return Object.freeze(Array.from({length:value.length},(_,i)=>{const item=d[String(i)];check(item && Object.hasOwn(item,'value') && item.enumerable,'STARTUP_INPUT');return inert(item.value,depth+1);}));
  }
  check(value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'STARTUP_INPUT');
  const d = Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(value).length === Object.keys(d).length && Object.keys(d).length <= 16, 'STARTUP_INPUT');
  const result: Record<string, unknown> = Object.create(null);
  for (const name of Object.keys(d).sort()) {
    check(d[name]!.enumerable && Object.hasOwn(d[name]!, 'value'), 'STARTUP_INPUT'); result[name] = inert(d[name]!.value, depth + 1);
  }
  return Object.freeze(result);
}
function exact(v: any, keys: string[]) { check(v && typeof v === 'object' && Object.keys(v).sort().join() === [...keys].sort().join(), 'STARTUP_SCHEMA'); }
export function startupHr(v: unknown): bigint {
  check(typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v), 'STARTUP_CLOCK');
  const n = BigInt(v); check(n <= MAX_HR, 'STARTUP_CLOCK'); return n;
}
export function startupCopy(input: unknown): Readonly<StartupAuthorization> {
  const v = inert(input);
  exact(v, ['format', 'clock', 'admission', 'runtime', 'accountBindingDigest', 'promptDigest', 'modelRoute', 'proposalPlanRevision', 'launchPlanRevision']);
  const claude=v.format==='bowerloom/claude-startup/v1';
  check(v.clock===STARTUP_CLOCK && (claude ? ['claude:claude-sonnet-5-5:high','claude:claude-sonnet-5-5:medium'].includes(v.modelRoute) : v.format==='bowerloom/codex-startup/v1'&&v.modelRoute===MODEL_ROUTE),'STARTUP_CONTRACT');
  for (const name of ['accountBindingDigest', 'promptDigest', 'proposalPlanRevision', 'launchPlanRevision']) check(hex(v[name]), 'STARTUP_BINDING');
  const r = v.runtime; exact(r, ['executable','sha256','nodeVersion','uvVersion','platform','arch']);
  check(typeof r.executable === 'string' && resolve(r.executable) === r.executable && hex(r.sha256)
    && r.nodeVersion === 'v24.11.0' && r.uvVersion === '1.51.0' && r.platform === 'darwin' && r.arch === 'arm64', 'STARTUP_RUNTIME');
  check(v.launchPlanRevision === (claude ? claudeStartupLaunchRevision(v.proposalPlanRevision,r,v.modelRoute) : startupLaunchRevision(v.proposalPlanRevision,r)), 'STARTUP_BINDING');
  const a = v.admission; exact(a, ['format','binding','reservationId','requestDigest','claimedAtMs','notAfterWallMs','notAfterHrNs','parentWallMs','parentHrNs']);
  check(a.format === 'bowerloom/admission-dispatch/v1', 'STARTUP_CONTRACT');
  const b = a.binding; exact(b, ['installationId','databaseName','admissionSchema','launcherId','accountId','accountAlias','requestDigest','authorizationRevision','expiresAtMs']);
  for (const name of ['installationId','databaseName','admissionSchema','launcherId','accountId','accountAlias']) id(b[name]);
  id(a.reservationId);
  check(typeof a.requestDigest === 'string' && /^sha256:[a-f0-9]{64}$/.test(a.requestDigest) && a.requestDigest === b.requestDigest && hex(b.authorizationRevision), 'STARTUP_BINDING');
  check([a.claimedAtMs,a.notAfterWallMs,a.parentWallMs,b.expiresAtMs].every(time)
    && a.claimedAtMs <= a.parentWallMs && a.parentWallMs < a.notAfterWallMs && a.notAfterWallMs <= b.expiresAtMs, 'STARTUP_CLOCK');
  check(startupHr(a.parentHrNs) < startupHr(a.notAfterHrNs), 'STARTUP_CLOCK');
  return v;
}
/** Runtime bytes/path are part of the controlled launch-plan revision, not just IPC metadata. */
export function startupLaunchRevision(proposalPlanRevision: string, runtime: StartupRuntime): string {
  check(hex(proposalPlanRevision),'STARTUP_BINDING');
  return sha(JSON.stringify({format:'bowerloom/codex-controlled-plan/v1',proposalPlanRevision,clock:STARTUP_CLOCK,runtime:inert(runtime)}));
}
/** Separate closed namespace: original Codex revision bytes above remain unchanged. */
export function claudeStartupLaunchRevision(plan:string,runtime:StartupRuntime,modelRoute:string):string {
  check(hex(plan)&&['claude:claude-sonnet-5-5:high','claude:claude-sonnet-5-5:medium'].includes(modelRoute),'STARTUP_BINDING');
  return sha(JSON.stringify({format:'bowerloom/claude-controlled-plan/v1',proposalPlanRevision:plan,clock:STARTUP_CLOCK,runtime:inert(runtime),modelRoute}));
}
/** Claude-only run cutoff: no reset after IPC delay; four seconds are reserved for cleanup. */
export class ClaudeRunDeadline {
  #wall:number;#hr:bigint;#closed=false;readonly notAfterWallMs:number;readonly notAfterHrNs:bigint;
  constructor(input:unknown,seconds:number,hr=process.hrtime.bigint(),wall=Date.now()) {
    const a=startupCopy(input);check(a.format==='bowerloom/claude-startup/v1'&&Number.isInteger(seconds)&&seconds>0&&seconds<=60,'STARTUP_CONTRACT');
    const start=new StartupDeadline(a);start.checkSample(hr,wall);
    this.#wall=wall;this.#hr=hr;
    this.notAfterWallMs=Math.min(a.admission.notAfterWallMs-4000,wall+seconds*1000);
    const original=startupHr(a.admission.notAfterHrNs)-4_000_000_000n,relative=hr+BigInt(seconds)*1_000_000_000n;
    this.notAfterHrNs=original<relative?original:relative;this.checkSample(hr,wall);
  }
  close():void{this.#closed=true;}
  checkSample(hr:bigint,wall:number):void {
    try {check(!this.#closed&&typeof hr==='bigint'&&hr>=this.#hr&&time(wall)&&wall>=this.#wall&&hr<this.notAfterHrNs&&wall<this.notAfterWallMs,'CLAUDE_RUN_EXPIRED');this.#hr=hr;this.#wall=wall;}
    catch {this.close();throw new AdapterError('CLAUDE_RUN_EXPIRED');}
  }
  check():void{this.checkSample(process.hrtime.bigint(),Date.now());}
  remainingMs():number{this.check();return Math.min(this.notAfterWallMs-this.#wall,Number((this.notAfterHrNs-this.#hr)/1_000_000n));}
}
export function assertStartupPreparation(input: unknown, binding: StartupPreparation): Readonly<StartupAuthorization> {
  const v = startupCopy(input);
  check(v.admission.binding.launcherId === binding.launcherId && v.accountBindingDigest === binding.accountBindingDigest
    && v.promptDigest === binding.promptDigest && v.modelRoute === binding.modelRoute && v.proposalPlanRevision === binding.launchPlanRevision, 'STARTUP_BINDING');
  return v;
}
/** State is local to one original-channel job; a later sample never extends either deadline. */
export class StartupDeadline {
  readonly authorization: Readonly<StartupAuthorization>;
  #wall: number; #hr: bigint; #closed = false;
  constructor(input: unknown) { this.authorization = startupCopy(input); this.#wall = this.authorization.admission.parentWallMs; this.#hr = startupHr(this.authorization.admission.parentHrNs); }
  close(): void { this.#closed = true; }
  checkSample(hr: bigint, wall: number): void {
    try {
      const a = this.authorization.admission;
      check(!this.#closed && typeof hr === 'bigint' && hr >= this.#hr && hr <= MAX_HR && time(wall) && wall >= this.#wall
        && hr < startupHr(a.notAfterHrNs) && wall < a.notAfterWallMs, 'STARTUP_EXPIRED');
      this.#hr = hr; this.#wall = wall;
    } catch { this.#closed = true; throw new AdapterError('STARTUP_EXPIRED'); }
  }
  check(): void { const hr = process.hrtime.bigint(); const wall = Date.now(); this.checkSample(hr, wall); }
  /** Snapshot the latest verified samples; never alter the consumed claim or its original deadlines. */
  transferSnapshot(): Readonly<StartupAuthorization> {
    check(!this.#closed,'STARTUP_EXPIRED');
    return startupCopy({...this.authorization,admission:{...this.authorization.admission,parentWallMs:this.#wall,parentHrNs:this.#hr.toString()}});
  }
}
const same = (a: Awaited<ReturnType<typeof lstat>>, b: Awaited<ReturnType<typeof lstat>>) =>
  a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid && a.nlink === b.nlink && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
async function verifyRuntime(runtime: StartupRuntime, active: () => void): Promise<void> {
  check(runtime.executable === process.execPath && runtime.nodeVersion === process.version && runtime.uvVersion === process.versions.uv
    && runtime.platform === process.platform && runtime.arch === process.arch, 'STARTUP_RUNTIME');
  check(await realpath(runtime.executable) === runtime.executable, 'STARTUP_RUNTIME'); active();
  const before = await lstat(runtime.executable); active();
  check(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size > 0 && before.size <= 256 * 1024 * 1024
    && (before.uid === 0 || before.uid === process.getuid?.()) && (before.mode & 0o022) === 0, 'STARTUP_RUNTIME');
  const fd = await open(runtime.executable, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    active(); check(same(before, await fd.stat()), 'STARTUP_RUNTIME'); active();
    const hash = createHash('sha256'), chunk = Buffer.alloc(128 * 1024); let total = 0;
    for (;;) { active(); const {bytesRead} = await fd.read(chunk, 0, chunk.length, null); active(); if (!bytesRead) break; total += bytesRead; check(total <= before.size, 'STARTUP_RUNTIME'); hash.update(chunk.subarray(0,bytesRead)); }
    check(total === before.size && hash.digest('hex') === runtime.sha256 && same(before, await fd.stat()), 'STARTUP_RUNTIME'); active();
    check(same(before, await lstat(runtime.executable)), 'STARTUP_RUNTIME'); active();
  } finally { await fd.close(); }
}
/** Fixed real runtime and kernel reads, bounded and without observation overrides. */
export async function verifyStartupHost(deadline: StartupDeadline, active: () => void): Promise<string> {
  let closed = false; const phaseEnd=process.hrtime.bigint()+2_000_000_000n;
  const guard = () => { check(!closed, 'STARTUP_VALIDATION'); active(); check(!closed && process.hrtime.bigint()<phaseEnd, 'STARTUP_VALIDATION'); deadline.check(); };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => { guard(); await verifyRuntime(deadline.authorization.runtime,guard); guard(); const boot = await readDarwinBootSession(); guard(); return boot; })();
  try { return await Promise.race([work, new Promise<never>((_,reject) => { timer = setTimeout(() => { closed = true; deadline.close(); reject(new AdapterError('STARTUP_VALIDATION')); },2000); })]); }
  catch { deadline.close(); throw new AdapterError('STARTUP_VALIDATION'); }
  finally { closed = true; clearTimeout(timer); }
}
export function validStartupBoot(v: unknown): asserts v is string { check(validBootSession(v), 'STARTUP_BOOT'); }
export function startupMessageDigest(job: unknown, startup: unknown, bootSession: string): string {
  // Caller job is already inert JSON copied by supervisor / received over Node IPC.
  return sha(JSON.stringify({ job, startup: startupCopy(startup), bootSession }));
}

export interface StartupJob { executable:string; argv:string[]; cwd:string; env:Record<string,string>; seconds:number; stdoutBytes:number; stderrBytes:number; nonce:string }
export function startupJobCopy(input:unknown): Readonly<StartupJob> {
  const v=inert(input); exact(v,['executable','argv','cwd','env','seconds','stdoutBytes','stderrBytes','nonce']);
  check(typeof v.executable==='string' && resolve(v.executable)===v.executable && typeof v.cwd==='string' && resolve(v.cwd)===v.cwd
    && Array.isArray(v.argv) && v.argv.every((x:unknown)=>typeof x==='string') && hex(v.nonce), 'STARTUP_JOB');
  check(v.env && typeof v.env==='object' && !Array.isArray(v.env) && Object.values(v.env).every(x=>typeof x==='string'), 'STARTUP_JOB');
  check(Number.isInteger(v.seconds)&&v.seconds>0&&v.seconds<=60 && Number.isInteger(v.stdoutBytes)&&v.stdoutBytes>0&&v.stdoutBytes<=2097152
    && Number.isInteger(v.stderrBytes)&&v.stderrBytes>0&&v.stderrBytes<=32768,'STARTUP_JOB');
  return v;
}
export function startupPacket(input:unknown): {job:Readonly<StartupJob>;startup:Readonly<StartupAuthorization>;bootSession:string;bindingDigest:string} {
  const v=inert(input); exact(v,['type','job','startup','bootSession','bindingDigest']);
  check(v.type==='start-v2','STARTUP_SCHEMA'); const job=startupJobCopy(v.job),startup=startupCopy(v.startup); validStartupBoot(v.bootSession);
  check(hex(v.bindingDigest)&&v.bindingDigest===startupMessageDigest(job,startup,v.bootSession),'STARTUP_BINDING');
  return {job,startup,bootSession:v.bootSession,bindingDigest:v.bindingDigest};
}
