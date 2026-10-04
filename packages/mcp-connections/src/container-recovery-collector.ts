import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { userInfo } from 'node:os';
import type { Scope } from '../../broker/src/types.js';
import { canonicalJson } from '../../contracts/src/index.js';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { validateDiscoveryAuthorityState } from './authority.js';
import type { DiscoveryAuthorityState, DiscoveryAuthorityStore } from './authority.js';
import { planMcpContainerDiscoveryLaunch } from './container-policy.js';
import { planMcpContainerRecovery } from './container-recovery.js';
import type { McpContainerRecoveryReport } from './container-recovery.js';
import type { RecoveryReceiptStore, McpContainerRecoveryReceipt } from './container-recovery-receipt.js';
import { createMcpContainerRecoveryReceipt, validateMcpContainerRecoveryReceipt } from './container-recovery-receipt.js';
import { data, fail, sha256 } from './model.js';

export interface McpContainerRecoveryCollectorDependencies { store: DiscoveryAuthorityStore; stateRoot: string; trustedDockerDesktop: true }
type Presence = { pid: number | null; state: 'present' | 'absent' | 'unknown' | 'not-recorded'; observedAtMs: number };
type ContainerObservation = { requestedCid: string | null; returnedCid: string | null; state: 'present' | 'absent' | 'unknown' | 'not-queried'; observedAtMs: number; commandClosed: boolean | null };
export interface McpContainerRecoveryCollection {
  format: 'bowerloom/mcp-container-recovery-collection/v1beta1'; evidenceScope: 'local-read-only-observations';
  operationKey: string; authorityRevision: string; journalOrigin: 'unverified-local-user-file';
  journal: { status: 'stable-private-file' | 'missing'; sha256: string | null; bytes: number };
  observations: { guardian: Presence; attach: Presence; container: ContainerObservation };
  planner: McpContainerRecoveryReport; authorityUnchangedAtFinalCheck: true; journalUnchangedAtFinalCheck: true;
  localUserTrustRequired: true; cleanupAuthorized: false; retryAuthorized: false; executionAuthorized: false;
  hostRestartSafetyVerified: false; revision: string;
}
function requireValue(value: unknown, code = 'INPUT'): asserts value { if (!value) fail('MCP_RECOVERY_COLLECTOR_' + code); }
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  requireValue(value && typeof value === 'object' && !Array.isArray(value)); const v = value as Record<string, unknown>;
  requireValue(Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))); return v;
}
const pin = (s: BigIntStats) => ({ dev: String(s.dev), ino: String(s.ino), uid: String(s.uid), gid: String(s.gid), mode: String(s.mode), nlink: String(s.nlink), size: String(s.size), mtime: String(s.mtimeNs), ctime: String(s.ctimeNs) });
const directoryPin = (s: BigIntStats) => ({ dev: String(s.dev), ino: String(s.ino), uid: String(s.uid), gid: String(s.gid), mode: String(s.mode) });
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
type Snapshot = { text: string | null; sha256: string | null; bytes: number; pins: unknown };
async function ancestors(path: string, privateRoot: string): Promise<Record<string, unknown>> {
  requireValue(await realpath(path) === path, 'FILESYSTEM');
  const result: Record<string, unknown> = {}, uid = BigInt(process.getuid!());
  for (let p = path; ; p = dirname(p)) {
    const stat = await lstat(p, { bigint: true });
    requireValue(stat.isDirectory() && !stat.isSymbolicLink() && (stat.uid === uid || stat.uid === 0n) && (stat.mode & 0o022n) === 0n, 'FILESYSTEM');
    if (p === privateRoot || p.startsWith(privateRoot + '/')) requireValue(stat.uid === uid && (stat.mode & 0o7777n) === 0o700n, 'FILESYSTEM');
    result[p] = directoryPin(stat); if (p === '/') break;
  }
  return result;
}
async function snapshot(root: string, operationKey: string): Promise<Snapshot> {
  const rootPins = await ancestors(root, root), directory = join(root, operationKey.slice(7)), path = join(directory, 'journal.json');
  try {
    const directoryStat = await lstat(directory, { bigint: true });
    requireValue(directoryStat.isDirectory() && !directoryStat.isSymbolicLink(), 'FILESYSTEM');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    requireValue(same(rootPins, await ancestors(root, root)), 'FILESYSTEM_CHANGED');
    return { text: null, sha256: null, bytes: 0, pins: { rootPins, missing: 'operation-directory' } };
  }
  const before = await ancestors(directory, root);
  requireValue(Object.entries(rootPins).every(([p, value]) => same(value, before[p])), 'FILESYSTEM_CHANGED');
  let named: BigIntStats;
  try { named = await lstat(path, { bigint: true }); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    requireValue(same(before, await ancestors(directory, root)), 'FILESYSTEM_CHANGED');
    return { text: null, sha256: null, bytes: 0, pins: { before, missing: 'journal' } };
  }
  function file(s: BigIntStats): void {
    requireValue(s.isFile() && !s.isSymbolicLink() && s.nlink === 1n && s.uid === BigInt(process.getuid!()) && (s.mode & 0o7777n) === 0o600n && s.size > 0n && s.size <= 8192n, 'FILESYSTEM');
  }
  file(named);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const first = await handle.stat({ bigint: true }); file(first); requireValue(same(pin(named), pin(first)), 'FILESYSTEM_CHANGED');
    const buffer = Buffer.alloc(8193); let size = 0;
    for (;;) { const chunk = await handle.read(buffer, size, buffer.length - size, null); if (!chunk.bytesRead) break; size += chunk.bytesRead; requireValue(size <= 8192, 'FILESYSTEM'); }
    const after = await handle.stat({ bigint: true }), finalNamed = await lstat(path, { bigint: true }); file(after); file(finalNamed);
    requireValue(same(pin(first), pin(after)) && same(pin(first), pin(finalNamed)) && same(before, await ancestors(directory, root)), 'FILESYSTEM_CHANGED');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
    return { text, sha256: 'sha256:' + sha256(text), bytes: size, pins: { before, file: pin(first) } };
  } finally { await handle.close(); }
}
function journal(text: string, authority: DiscoveryAuthorityState): { cid: string | null; guardianPid: number; attachPid: number | null; deadlineMs: number } {
  const effect = authority.proposal.effect; requireValue(effect.kind === 'container-stdio' && authority.intent, 'AUTHORITY');
  const plan = planMcpContainerDiscoveryLaunch(effect.launch);
  const j = exact(data(strictJson(text, 8192)), ['format', 'operationKey', 'launchOperationKey', 'launchRevision', 'name', 'cid', 'stage', 'deadlineMs', 'guardianPid', 'attachPid', 'reason', 'lease']);
  requireValue(canonicalJson(j) === text && j.format === 'bowerloom/mcp-container-journal/v1beta1' && j.operationKey === authority.operationKey
    && j.launchOperationKey === plan.spec.operationKey && j.launchRevision === effect.launchRevision && plan.revision === effect.launchRevision
    && j.name === 'bowerloom-mcp-' + plan.spec.operationKey.slice(7), 'JOURNAL');
  const pid = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= 2147483647;
  requireValue(pid(j.guardianPid) && (j.attachPid === null || pid(j.attachPid)) && Number.isSafeInteger(j.deadlineMs)
    && (j.deadlineMs as number) > authority.intent.startedAtMs && (j.deadlineMs as number) <= authority.intent.deadlineMs, 'JOURNAL');
  requireValue(j.cid === null || typeof j.cid === 'string' && /^[a-f0-9]{64}$/.test(j.cid), 'JOURNAL');
  requireValue(['PREPARED', 'CREATING', 'CREATED', 'STARTED', 'REAPED', 'CANCELLED', 'UNCERTAIN'].includes(j.stage as string)
    && (j.reason === null || typeof j.reason === 'string' && /^[A-Z_]{1,64}$/.test(j.reason)), 'JOURNAL');
  requireValue(!(['CREATED', 'STARTED', 'REAPED'].includes(j.stage as string) && j.cid === null)
    && !(['PREPARED', 'CREATING', 'CANCELLED'].includes(j.stage as string) && j.cid !== null)
    && !(j.stage === 'STARTED' && j.attachPid === null), 'JOURNAL');
  const lease = exact(j.lease, ['sequence', 'lastRenewedAtMs', 'expiresMonotonicMs', 'stopRequestedAtMs', 'containerAbsentAtMs', 'attachReapedAtMs']);
  requireValue(Number.isSafeInteger(lease.sequence) && (lease.sequence as number) > 0 && typeof lease.expiresMonotonicMs === 'number' && lease.expiresMonotonicMs > 0 && lease.lastRenewedAtMs !== null, 'JOURNAL');
  for (const key of ['lastRenewedAtMs', 'stopRequestedAtMs', 'containerAbsentAtMs', 'attachReapedAtMs']) requireValue(lease[key] === null || Number.isSafeInteger(lease[key]) && (lease[key] as number) > 0, 'JOURNAL');
  return { cid: j.cid as string | null, guardianPid: j.guardianPid, attachPid: j.attachPid as number | null, deadlineMs: j.deadlineMs as number };
}
async function command(executable: '/bin/ps' | '/usr/local/bin/docker', args: string[]): Promise<{ ok: boolean; code: number | null; out: string; closed: boolean; stderrPresent: boolean; at: number }> {
  return new Promise(resolveResult => {
    const env = { HOME: userInfo().homedir, PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', NODE_V8_COVERAGE: undefined };
    let child: ReturnType<typeof spawn>;
    try { child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'], shell: false }); } catch { resolveResult({ ok: false, code: null, out: '', closed: true, stderrPresent: false, at: Date.now() }); return; }
    let bytes = 0, stdout = Buffer.alloc(0), failed = false, finished = false, stderrPresent = false, fallback: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number | null, closed: boolean) => {
      if (finished) return; finished = true; clearTimeout(timeout); clearTimeout(fallback);
      let out = ''; try { out = new TextDecoder('utf-8', { fatal: true }).decode(stdout); } catch { failed = true; }
      if (!closed) { child.stdout?.destroy(); child.stderr?.destroy(); child.unref(); }
      resolveResult({ ok: !failed && closed, code, out: failed ? '' : out, closed, stderrPresent, at: Date.now() });
    };
    const stopOwned = () => {
      if (finished || failed) return; failed = true; fallback = setTimeout(() => finish(null, false), 250);
      try { child.kill('SIGKILL'); } catch { /* Only this newly spawned read-command child is addressed. */ }
    };
    const timeout = setTimeout(stopOwned, 2000);
    child.on('error', stopOwned);
    for (const stream of [child.stdout, child.stderr]) { stream?.on('error', stopOwned); stream?.on('data', (chunk: Buffer) => {
      if (finished) return; if (stream === child.stderr && chunk.length) stderrPresent = true; bytes += chunk.length; if (bytes > 65536) stopOwned(); else if (stream === child.stdout) stdout = Buffer.concat([stdout, chunk]);
    }); }
    child.once('close', code => finish(code, true));
  });
}
/** Trusted-host read-only collector. There is deliberately no observation/clock/executable override argument. */
export async function collectMcpContainerRecovery(dependencies: McpContainerRecoveryCollectorDependencies, selected: Scope): Promise<McpContainerRecoveryCollection> {
  return collect(dependencies, selected, false) as Promise<McpContainerRecoveryCollection>;
}
export interface PersistedMcpContainerRecoveryCollection { collection: McpContainerRecoveryCollection; receipt: McpContainerRecoveryReceipt; persistence: 'commit-acknowledged' }
/** Fresh collector-owned entry point. No report, digest or observation argument is accepted. */
export async function collectAndPersistMcpContainerRecovery(dependencies: McpContainerRecoveryCollectorDependencies & { store: RecoveryReceiptStore }, selected: Scope): Promise<PersistedMcpContainerRecoveryCollection> {
  return collect(dependencies, selected, true) as Promise<PersistedMcpContainerRecoveryCollection>;
}
async function collect(dependencies: McpContainerRecoveryCollectorDependencies, selected: Scope, persist: boolean): Promise<McpContainerRecoveryCollection | PersistedMcpContainerRecoveryCollection> {
  let active = true, timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => requireValue(active, 'TIMEOUT');
  try {
    const descriptors = Object.getOwnPropertyDescriptors(dependencies);
    requireValue(Reflect.ownKeys(dependencies).length === 3 && ['store', 'stateRoot', 'trustedDockerDesktop'].every(k => descriptors[k] && 'value' in descriptors[k]!));
    const { store, stateRoot, trustedDockerDesktop } = dependencies;
    requireValue(process.platform === 'darwin' && process.permission === undefined && process.getuid && trustedDockerDesktop === true
      && typeof stateRoot === 'string' && stateRoot.startsWith('/') && resolve(stateRoot) === stateRoot && !/[\p{Cc}\p{Cf}]/u.test(stateRoot), 'TRUST');
    requireValue(store && typeof store.transaction === 'function');
    if (persist) requireValue(typeof (store as RecoveryReceiptStore).recordRecoveryReceipt === 'function');
    const scope = exact(data(selected), ['workspaceId', 'runId', 'taskId']);
    requireValue(Object.values(scope).every(v => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9@._:-]{0,127}$/.test(v)));
    const run = async (): Promise<McpContainerRecoveryCollection | PersistedMcpContainerRecoveryCollection> => {
      const authority = await store.transaction(scope as unknown as Scope, raw => {
        check(); const state = validateDiscoveryAuthorityState(raw, scope as unknown as Scope);
        requireValue(state.status === 'NEEDS_RECONCILIATION' && state.intent && state.proposal.effect.kind === 'container-stdio', 'AUTHORITY'); return state;
      }); check();
      const originalAuthority = canonicalJson(validateDiscoveryAuthorityState(authority));
      const effect = authority.proposal.effect; requireValue(effect.kind === 'container-stdio' && authority.intent, 'AUTHORITY');
      const first = await snapshot(stateRoot, authority.operationKey); check();
      const known = first.text === null ? null : journal(first.text, authority);
      let guardian: Presence = { pid: known?.guardianPid ?? null, state: 'not-recorded', observedAtMs: Date.now() };
      let attach: Presence = { pid: known?.attachPid ?? null, state: 'not-recorded', observedAtMs: Date.now() };
      if (known) {
        const ids = [...new Set([known.guardianPid, known.attachPid].filter((p): p is number => p !== null))];
        check(); const observed = await command('/bin/ps', ['-p', ids.join(','), '-o', 'pid=']); check();
        const values = observed.out.trim() ? observed.out.trim().split(/\s+/) : [];
        const valid = observed.ok && !observed.stderrPresent && (observed.code === 0 || observed.code === 1 && !values.length)
          && values.every(p => /^[1-9][0-9]*$/.test(p) && ids.includes(Number(p))) && new Set(values).size === values.length;
        const presence = (pid: number | null): Presence => ({ pid, state: pid === null ? 'not-recorded' : !valid ? 'unknown' : values.includes(String(pid)) ? 'present' : 'absent', observedAtMs: observed.at });
        guardian = presence(known.guardianPid); attach = presence(known.attachPid);
      }
      let container: ContainerObservation = { requestedCid: known?.cid ?? null, returnedCid: null, state: 'not-queried', observedAtMs: Date.now(), commandClosed: null };
      if (known?.cid) {
        check(); const observed = await command('/usr/local/bin/docker', ['--context', 'desktop-linux', 'container', 'ls', '--all', '--no-trunc', '--filter', 'id=' + known.cid, '--format', '{{.ID}}']); check();
        const values = observed.out.trim() ? observed.out.trim().split('\n') : [];
        const valid = observed.ok && !observed.stderrPresent && observed.code === 0 && values.length <= 1 && values.every(value => value === known.cid);
        container = { requestedCid: known.cid, returnedCid: valid && values.length ? known.cid : null, state: !valid ? 'unknown' : values.length ? 'present' : 'absent', observedAtMs: observed.at, commandClosed: observed.closed };
      }
      requireValue(same(first, await snapshot(stateRoot, authority.operationKey)), 'JOURNAL_CHANGED'); check();
      await store.transaction(scope as unknown as Scope, raw => {
        check(); requireValue(canonicalJson(validateDiscoveryAuthorityState(raw, scope as unknown as Scope)) === originalAuthority, 'AUTHORITY_CHANGED'); return null;
      }); check();
      requireValue(same(first, await snapshot(stateRoot, authority.operationKey)), 'JOURNAL_CHANGED'); check();
      const at = Math.min(guardian.observedAtMs, attach.observedAtMs, container.observedAtMs);
      const planner = planMcpContainerRecovery({ format: 'bowerloom/mcp-container-recovery-input/v1beta1', synthetic: true, authority,
        expectedJob: { operationKey: authority.operationKey, launchRevision: effect.launchRevision, deadlineMs: known?.deadlineMs ?? authority.intent.deadlineMs },
        // Local file integrity is not independent journal provenance or host-session evidence.
        journal: { status: first.text === null ? 'missing' : 'untrusted', text: first.text, expectedSha256: null },
        observations: { observedAtMs: at, hostSession: 'unknown-or-restarted', guardian: { pid: guardian.pid, state: guardian.state }, attach: { pid: attach.pid, state: attach.state }, container: { requestedCid: container.requestedCid, returnedCid: container.returnedCid, state: container.state } }, nowMs: Date.now() });
      const result = { format: 'bowerloom/mcp-container-recovery-collection/v1beta1' as const, evidenceScope: 'local-read-only-observations' as const,
        operationKey: authority.operationKey, authorityRevision: 'sha256:' + sha256(originalAuthority), journalOrigin: 'unverified-local-user-file' as const,
        journal: { status: first.text === null ? 'missing' as const : 'stable-private-file' as const, sha256: first.sha256, bytes: first.bytes },
        observations: { guardian, attach, container }, planner, authorityUnchangedAtFinalCheck: true as const, journalUnchangedAtFinalCheck: true as const,
        localUserTrustRequired: true as const, cleanupAuthorized: false as const, retryAuthorized: false as const, executionAuthorized: false as const, hostRestartSafetyVerified: false as const };
      const collection = { ...result, revision: 'sha256:' + sha256(canonicalJson(result)) };
      if (!persist) return collection;
      const expectedReceipt = createMcpContainerRecoveryReceipt(authority, collection);
      check();
      const receipt = validateMcpContainerRecoveryReceipt(await (store as RecoveryReceiptStore).recordRecoveryReceipt(authority, collection, check), authority.scope); check();
      requireValue(same(receipt, expectedReceipt), 'RECEIPT_CHANGED');
      requireValue(same(first, await snapshot(stateRoot, authority.operationKey)), 'JOURNAL_CHANGED'); check();
      return { collection, receipt, persistence: 'commit-acknowledged' };

    };
    return await Promise.race([run(), new Promise<never>((_, reject) => { timer = setTimeout(() => { active = false; reject(Error('TIMEOUT')); }, 15000); })]);
  } catch { return fail('MCP_RECOVERY_COLLECTOR_UNCERTAIN'); } finally { active = false; clearTimeout(timer); }
}
