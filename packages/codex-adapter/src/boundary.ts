import { constants } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { lstat, open, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROLS, LIMITS, MODEL_ROUTE, POLICY_VERSION } from './policy.js';
import { execArgs, requireNativePin } from './installation.js';
import { PROPOSAL_SCHEMA } from './protocol.js';
import { AdapterError, check, sha } from './safe.js';
import type { StartupAuthorization, StartupPreparation } from './startup-deadline.js';
import { STARTUP_CLOCK } from './startup-deadline.js';
import type { AccountBinding, Installation } from './types.js';

export interface CodexArtifactBinding {
  root: string;
  tarballSha256: string;
  files: { path: string; sha256: string }[];
}
export interface CodexBetaBoundaryOptions {
  receiptId: string;
  receiptRevision: string;
  artifact: CodexArtifactBinding;
  /** Trusted host registry, never a task-supplied record or model callback. */
  lookupQualification(receiptId: string): Promise<unknown>;
}
const FORMAT = 'bowerloom/codex-proposal-launch/v1beta2';
/** Private constructor capability; no mutable setter and no public bootstrap export. */
export interface AdapterBoundaryGate {
  check(signal: AbortSignal, observation?: unknown): Promise<void>;
  assertCurrent(signal: AbortSignal): void;
  consume?(preparation: Readonly<StartupPreparation>, signal: AbortSignal): Readonly<StartupAuthorization>;
}
const QUALIFICATION_LOOKUP_TIMEOUT_MS = 1000;
const RECEIPT = 'bowerloom/codex-boundary-qualification/v1beta1';
const DIGEST = /^[a-f0-9]{64}$/;
const PREFIX = 'dist/packages/codex-adapter/src/';
const REQUIRED = ['boundary', 'index', 'adapter-core', 'startup-deadline', 'installation', 'policy', 'protocol', 'reader', 'observation', 'safe', 'supervisor', 'guardian'].map(n => `${PREFIX}${n}.js`).concat(['dist/packages/broker/src/index.js', 'dist/packages/contracts/src/index.js', 'dist/packages/mcp-connections/src/darwin-boot-session.js', 'dist/packages/mcp-connections/src/model.js']);

// Read only data descriptors. Neither JSON serialization nor validation invokes getters.
function data(input: unknown, depth = 0, count = { n: 0 }): any {
  check(depth <= 16 && ++count.n <= 20000, 'BOUNDARY_INPUT');
  if (input === null || typeof input === 'boolean') return input;
  if (typeof input === 'string') { check(Buffer.byteLength(input) <= 8192 && Buffer.from(input).toString('utf8') === input, 'BOUNDARY_INPUT'); return input; }
  if (typeof input === 'number') { check(Number.isSafeInteger(input), 'BOUNDARY_INPUT'); return input; }
  check(typeof input === 'object' && input !== null, 'BOUNDARY_INPUT');
  const proto = Object.getPrototypeOf(input);
  check(Array.isArray(input) ? proto === Array.prototype : proto === Object.prototype || proto === null, 'BOUNDARY_INPUT');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  check(Reflect.ownKeys(input).length === Object.keys(descriptors).length, 'BOUNDARY_INPUT');
  if (Array.isArray(input)) {
    check(input.length <= 4096, 'BOUNDARY_INPUT');
    check(Object.keys(descriptors).length === input.length + 1, 'BOUNDARY_INPUT');
    return Array.from({ length: input.length }, (_, i) => {
      const d = descriptors[String(i)]; check(d && Object.hasOwn(d, 'value') && d.enumerable, 'BOUNDARY_INPUT');
      return data(d.value, depth + 1, count);
    });
  }
  const out: Record<string, unknown> = Object.create(null);
  for (const name of Object.keys(descriptors).sort()) {
    const d = descriptors[name]!;
    check(!['__proto__', 'prototype', 'constructor'].includes(name) && d.enumerable && Object.hasOwn(d, 'value'), 'BOUNDARY_INPUT');
    out[name] = data(d.value, depth + 1, count);
  }
  return out;
}
function exact(input: any, keys: string[]): void {
  check(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).sort().join('\0') === [...keys].sort().join('\0'), 'BOUNDARY_SCHEMA');
}
function digest(v: unknown): asserts v is string { check(typeof v === 'string' && DIGEST.test(v), 'BOUNDARY_DIGEST'); }
function identifier(v: unknown): asserts v is string { check(typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(v), 'BOUNDARY_ID'); }
function revision(value: unknown): string { return sha(JSON.stringify(data(value))); }
function freeze<T>(v: T): Readonly<T> { if (v && typeof v === 'object') { for (const child of Object.values(v)) freeze(child); Object.freeze(v); } return v; }
function active(signal: AbortSignal): void { check(!signal.aborted, 'CANCELLED'); }

// A trusted registry can still stall or fail. Never leave adapter admission busy
// indefinitely, and keep an observer attached after cancellation or timeout.
function lookupBounded(lookup: CodexBetaBoundaryOptions['lookupQualification'], receiptId: string, signal: AbortSignal): Promise<unknown> {
  active(signal);
  const deadline = performance.now() + QUALIFICATION_LOOKUP_TIMEOUT_MS;
  return new Promise((resolveLookup, rejectLookup) => {
    let settled = false;
    const finish = (error: AdapterError | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancelled);
      if (error) rejectLookup(error); else resolveLookup(value);
    };
    const cancelled = () => finish(new AdapterError('CANCELLED'));
    const timer = setTimeout(() => finish(new AdapterError('BOUNDARY_LOOKUP_TIMEOUT')), QUALIFICATION_LOOKUP_TIMEOUT_MS);
    signal.addEventListener('abort', cancelled, { once: true });
    if (signal.aborted) { cancelled(); return; }
    const pending = Promise.resolve().then(() => {
      // Cancellation can occur between queuing and running this microtask.
      if (settled || signal.aborted) throw new AdapterError('CANCELLED');
      if (performance.now() >= deadline) { finish(new AdapterError('BOUNDARY_LOOKUP_TIMEOUT')); return; }
      return lookup(receiptId);
    });
    void pending.then(
      value => { if (signal.aborted) cancelled(); else if (performance.now() >= deadline) finish(new AdapterError('BOUNDARY_LOOKUP_TIMEOUT')); else finish(null, value); },
      () => { if (signal.aborted) cancelled(); else finish(new AdapterError('BOUNDARY_LOOKUP_REFUSED')); },
    );
  });
}

export function planCodexProposalLaunch(input: { version: string; nativeSha256: string }) {
  const v = data(input); exact(v, ['version', 'nativeSha256']); requireNativePin(v.version, v.nativeSha256);
  const body = { format: FORMAT, platform: 'darwin-arm64', nativeVersion: v.version as string, nativeSha256: v.nativeSha256 as string,
    startupProtocol: 'bowerloom/codex-startup/v1', startupClock: STARTUP_CLOCK, startupValidationTimeoutMs: 2000,
    policyVersion: POLICY_VERSION, modelRoute: MODEL_ROUTE, qualificationLookupTimeoutMs: QUALIFICATION_LOOKUP_TIMEOUT_MS, controls: [...CONTROLS],
    argvTemplate: execArgs('/BOWERLOOM_PRIVATE_WORKSPACE', '/BOWERLOOM_PRIVATE_SCHEMA'),
    environmentPolicy: { inherited: ['HOME', 'CODEX_HOME', 'TMPDIR', 'LANG', 'LC_ALL'], fixed: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', CODEX_EXEC_SERVER_URL: 'none', CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: '1' } },
    workspacePolicy: 'private-empty-workspace-and-exact-schema', schemaRevision: revision(PROPOSAL_SCHEMA), limits: { ...LIMITS },
    effectsAuthorized: false, nativeInvocationDenialProved: false, totalEgressDenialProved: false };
  return freeze({ ...body, revision: revision(body) });
}
export function codexBoundaryAccountRevision(binding: AccountBinding, accountAlias: string): string {
  const b = data(binding); exact(b, ['canonicalAccountId', 'aliases', 'providerAccountSha256', 'requiredWindows', 'optionalWindows']);
  identifier(accountAlias); check(Array.isArray(b.aliases) && b.aliases.includes(accountAlias), 'BOUNDARY_ACCOUNT');
  return revision({ binding: b, accountAlias });
}
function artifactCopy(input: unknown): CodexArtifactBinding {
  const v = data(input); exact(v, ['root', 'tarballSha256', 'files']); digest(v.tarballSha256);
  check(typeof v.root === 'string' && resolve(v.root) === v.root, 'BOUNDARY_ARTIFACT');
  check(Array.isArray(v.files) && v.files.length >= REQUIRED.length && v.files.length <= 1024, 'BOUNDARY_ARTIFACT');
  const seen = new Set<string>();
  for (const file of v.files) {
    exact(file, ['path', 'sha256']); digest(file.sha256);
    check(typeof file.path === 'string' && file.path.length <= 512 && /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(file.path)
      && !file.path.split('/').some((s: string) => s === '.' || s === '..') && !seen.has(file.path), 'BOUNDARY_ARTIFACT');
    seen.add(file.path);
  }
  check(REQUIRED.every(p => seen.has(p)), 'BOUNDARY_ARTIFACT_INCOMPLETE');
  v.files.sort((a: { path: string }, b: { path: string }) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return v;
}
export function codexArtifactRevision(input: CodexArtifactBinding): string {
  const v = artifactCopy(input); return revision({ format: 'bowerloom/codex-installed-identity/v1beta1', tarballSha256: v.tarballSha256, files: v.files });
}
function sameStat(a: Awaited<ReturnType<typeof lstat>>, b: Awaited<ReturnType<typeof lstat>>): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.mode === b.mode && a.nlink === b.nlink;
}
/** Measures trusted inventory claims, and binds the actual executing module to that installed root. */
export async function measureCodexInstalledArtifact(input: CodexArtifactBinding, signal: AbortSignal): Promise<string> {
  const v = artifactCopy(input); active(signal);
  try {
    const root = await lstat(v.root); active(signal);
    check(root.isDirectory() && !root.isSymbolicLink() && root.uid === process.getuid?.() && (root.mode & 0o022) === 0, 'BOUNDARY_ARTIFACT');
    check(await realpath(v.root) === v.root, 'BOUNDARY_ARTIFACT'); active(signal);
    check(fileURLToPath(import.meta.url) === join(v.root, `${PREFIX}boundary.js`), 'BOUNDARY_ARTIFACT_LOCATION');
    let total = 0;
    for (const file of v.files) {
      active(signal); const path = join(v.root, file.path);
      check(await realpath(path) === path, 'BOUNDARY_ARTIFACT'); active(signal);
      const before = await lstat(path); active(signal);
      check(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.uid === process.getuid?.()
        && (before.mode & 0o022) === 0 && before.size <= 16 * 1024 * 1024 && (total += before.size) <= 128 * 1024 * 1024, 'BOUNDARY_ARTIFACT');
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        active(signal); check(sameStat(before, await handle.stat()), 'BOUNDARY_ARTIFACT_DRIFT'); active(signal);
        const bytes = await handle.readFile(); active(signal);
        check(bytes.length === before.size && sha(bytes) === file.sha256 && sameStat(before, await handle.stat()), 'BOUNDARY_ARTIFACT_DRIFT'); active(signal);
        check(sameStat(before, await lstat(path)), 'BOUNDARY_ARTIFACT_DRIFT'); active(signal);
      } finally { await handle.close(); }
    }
    const after = await lstat(v.root); active(signal);
    check(root.dev === after.dev && root.ino === after.ino && root.mode === after.mode, 'BOUNDARY_ARTIFACT_DRIFT');
    return codexArtifactRevision(v);
  } catch (error) {
    if (signal.aborted) throw new AdapterError('CANCELLED');
    // Native filesystem errors contain private paths; do not expose them.
    if (error instanceof AdapterError && ['BOUNDARY_ARTIFACT', 'BOUNDARY_ARTIFACT_LOCATION', 'BOUNDARY_ARTIFACT_DRIFT'].includes(error.code)) throw error;
    throw new AdapterError('BOUNDARY_ARTIFACT');
  }
}
export interface CodexBoundaryQualification {
  format: 'bowerloom/codex-boundary-qualification/v1beta1'; receiptId: string; revision: string; status: 'active';
  launchPlanRevision: string; artifactRevision: string; nativeSha256: string; nativeVersion: string;
  accountBindingDigest: string; issuedAtMs: number; expiresAtMs: number; reviewRevision: string; probeSuiteRevision: string;
}
export function codexQualificationRevision(input: Omit<CodexBoundaryQualification, 'revision'>): string { return revision(input); }
/** Internal gate: configuration and lookup are trusted host dependencies, not request inputs. */
export class CodexProposalBoundary {
  readonly #config: Readonly<{ receiptId: string; receiptRevision: string; artifact: CodexArtifactBinding }>;
  readonly #lookup: CodexBetaBoundaryOptions['lookupQualification'];
  readonly #plan: ReturnType<typeof planCodexProposalLaunch>;
  readonly #account: string;
  #expiresAtMs = 0;
  constructor(options: CodexBetaBoundaryOptions, installation: Installation, binding: AccountBinding, accountAlias: string) {
    // The sole function is a host capability. Capture it without invoking accessors.
    const descriptors = Object.getOwnPropertyDescriptors(options);
    check(Object.keys(descriptors).sort().join() === 'artifact,lookupQualification,receiptId,receiptRevision'
      && Reflect.ownKeys(options).length === 4 && Object.values(descriptors).every(d => Object.hasOwn(d, 'value')), 'BOUNDARY_OPTIONS');
    check(typeof descriptors.lookupQualification!.value === 'function', 'BOUNDARY_OPTIONS');
    this.#lookup = descriptors.lookupQualification!.value;
    const id = data(descriptors.receiptId!.value), pin = data(descriptors.receiptRevision!.value); identifier(id); digest(pin);
    this.#config = freeze({ receiptId: id, receiptRevision: pin, artifact: artifactCopy(descriptors.artifact!.value) });
    const install = data(installation);
    this.#plan = planCodexProposalLaunch({ version: install.version, nativeSha256: install.nativeSha256 });
    this.#account = codexBoundaryAccountRevision(binding, accountAlias);
  }
  async check(signal: AbortSignal): Promise<void> {
    active(signal);
    const response = await lookupBounded(this.#lookup, this.#config.receiptId, signal);
    active(signal);
    const r = data(response);
    exact(r, ['format', 'receiptId', 'revision', 'status', 'launchPlanRevision', 'artifactRevision', 'nativeSha256', 'nativeVersion', 'accountBindingDigest', 'issuedAtMs', 'expiresAtMs', 'reviewRevision', 'probeSuiteRevision']);
    const { revision: pin, ...body } = r;
    check(r.format === RECEIPT && r.status === 'active' && r.receiptId === this.#config.receiptId && pin === this.#config.receiptRevision && revision(body) === pin, 'BOUNDARY_QUALIFICATION');
    for (const field of ['launchPlanRevision', 'artifactRevision', 'nativeSha256', 'accountBindingDigest', 'reviewRevision', 'probeSuiteRevision']) digest(r[field]);
    check(r.launchPlanRevision === this.#plan.revision && r.nativeVersion === this.#plan.nativeVersion && r.nativeSha256 === this.#plan.nativeSha256 && r.accountBindingDigest === this.#account, 'BOUNDARY_QUALIFICATION');
    const now = Date.now(); check(Number.isSafeInteger(r.issuedAtMs) && Number.isSafeInteger(r.expiresAtMs) && r.issuedAtMs <= now && now < r.expiresAtMs && r.issuedAtMs >= 0, 'BOUNDARY_QUALIFICATION_EXPIRED');
    const measured = await measureCodexInstalledArtifact(this.#config.artifact, signal); active(signal);
    check(measured === r.artifactRevision, 'BOUNDARY_QUALIFICATION');
    check(Date.now() < r.expiresAtMs, 'BOUNDARY_QUALIFICATION_EXPIRED');
    this.#expiresAtMs = r.expiresAtMs;
  }
  assertCurrent(signal: AbortSignal): void { active(signal); check(Date.now() < this.#expiresAtMs, 'BOUNDARY_QUALIFICATION_EXPIRED'); }
}
/** Bootstrap stays unavailable until its finite grant consumes the existing durable admission claim. */
export function refuseCodexQualificationProbe(): never { throw new AdapterError('BOUNDARY_PROBE_UNAVAILABLE'); }
