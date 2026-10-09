// Private guardian process. Only its original IPC channel can supply one approved synthetic launch.
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { userInfo } from 'node:os';
import { randomBytes, randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { canonicalJson } from '../../contracts/src/index.js';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { data, sha256, MCP_PROTOCOL_VERSION } from './model.js';
import { planMcpContainerDiscoveryLaunch } from './container-policy.js';
import { readDarwinBootSession } from './darwin-boot-session.js';
import { guardianTerminalPayload, terminalDeclaration } from './container-guardian-checkpoint.js';
import { guardianSignaturePayload } from './container-guardian-provenance.js';
import type { ContainerGuardianJob } from './container-supervisor.js';

let signingKey: ReturnType<typeof generateKeyPairSync>['privateKey'] | undefined, bindingRevision: string | undefined, signedSnapshot: unknown, snapshotSequence = 0, helloSent = false;
const requireValue = (value: unknown): void => { if (!value) throw Error('REFUSED'); };
const env: NodeJS.ProcessEnv = { HOME: userInfo().homedir, PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', NODE_V8_COVERAGE: undefined };
type Journal = { format: 'bowerloom/mcp-container-journal/v1beta1'; operationKey: string; launchOperationKey: string; launchRevision: string; name: string; cid: string | null; stage: string; deadlineMs: number; guardianPid: number; attachPid: number | null; reason: string | null; lease: LeaseObservation };
// Challenge age is measured here, never with a controller-supplied clock or TTL.
const LEASE_MS = 2000, RENEW_MS = 500;
type LeaseObservation = { sequence: number; lastRenewedAtMs: number | null; expiresMonotonicMs: number; stopRequestedAtMs: number | null; containerAbsentAtMs: number | null; attachReapedAtMs: number | null };
const leaseObservation: LeaseObservation = { sequence: 0, lastRenewedAtMs: null, expiresMonotonicMs: 0, stopRequestedAtMs: null, containerAbsentAtMs: null, attachReapedAtMs: null };
let absoluteMonotonicMs = 0, leaseExpiry = 0, challengeSequence = 0;
let challenge: { token: string; sequence: number; expires: number } | undefined;
let leaseTimer: ReturnType<typeof setTimeout> | undefined, renewalTimer: ReturnType<typeof setTimeout> | undefined;
function armLease(): void {
  clearTimeout(leaseTimer);
  leaseTimer = setTimeout(() => {
    if (performance.now() >= leaseExpiry) stop('AUTHORITY_LEASE_EXPIRED'); else armLease();
  }, Math.max(1, leaseExpiry - performance.now()));
}
function requestLease(): void {
  if (sealed || stopping || challenge) return;
  const now = performance.now();
  if (now >= leaseExpiry || Date.now() >= job!.deadlineMs) { stop('AUTHORITY_LEASE_EXPIRED'); return; }
  challenge = { token: randomBytes(32).toString('hex'), sequence: ++challengeSequence, expires: Math.min(now + LEASE_MS, absoluteMonotonicMs) };
  send({ type: 'lease-challenge', nonce: startNonce, operationKey: job!.operationKey, sequence: challenge.sequence, challenge: challenge.token });
}
let job: ContainerGuardianJob | undefined, plan: ReturnType<typeof planMcpContainerDiscoveryLaunch> | undefined, journal: Journal | undefined, directory: string | undefined;
let sealed = false, stopGeneration = 0;
let stageWrites: Promise<void> = Promise.resolve();
let pendingCheckpoint: {sequence:number;hash:string;resolve:()=>void;reject:()=>void}|undefined;
let started = false, stopping = false, ended = false, broken = false, creationAttempted = false, reason: string | null = null;
let creation: Promise<void> | undefined, cleanup: Promise<void> | undefined, attach: ChildProcessWithoutNullStreams | undefined, attachReaped = true;
let resolveAttach!: () => void; const attachClosed = new Promise<void>(resolve => { resolveAttach = resolve; });
let timer = setTimeout(() => stop('NO_START'), 5000), stderrBytes = 0, stdoutBytes = 0, inputBytes = 0, inputCount = 0;
let phase = 'new', sentStarted = false; const earlyChunks: Buffer[] = [];
const send = (value: unknown): void => { if (broken || !process.connected) return; try { process.send?.(value, error => { if (error) { broken = true; stop('CONTROLLER_LOST'); } }); } catch { broken = true; stop('CONTROLLER_LOST'); } };
async function privateDirectory(path: string): Promise<void> {
  requireValue(path.startsWith('/') && resolve(path) === path && await realpath(path) === path);
  const s = await lstat(path); requireValue(s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid?.() && (s.mode & 0o777) === 0o700);
}
async function synced(path: string, value: unknown): Promise<void> {
  await privateDirectory(dirname(path)); const temp = path + '.' + randomUUID();
  const file = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(canonicalJson(value)); await file.sync(); } finally { await file.close(); }
  await rename(temp, path); const dir = await open(dirname(path), 'r'); try { await dir.sync(); } finally { await dir.close(); }
}
async function savedJournal(): Promise<void> {
  requireValue(journal && directory); await privateDirectory(directory!);
  const file = await open(join(directory!, 'journal.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat({ bigint: true }); requireValue(before.isFile() && before.nlink === 1n && before.uid === BigInt(process.getuid!()) && (before.mode & 0o777n) === 0o600n && before.size <= 12288n);
    const buffer = Buffer.alloc(12289); let length = 0; for (;;) { const { bytesRead } = await file.read(buffer, length, buffer.length - length, null); if (!bytesRead) break; length += bytesRead; requireValue(length <= 12288); } const bytes = buffer.subarray(0, length); const after = await file.stat({ bigint: true }), named = await lstat(join(directory!, 'journal.json'), { bigint: true });
    for (const key of ['ino', 'dev', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'nlink'] as const) requireValue(before[key] === after[key] && before[key] === named[key]);
    requireValue(canonicalJson(strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), 12288)) === canonicalJson(signedSnapshot));
  } finally { await file.close(); }
}
async function saveSnapshot(body: Journal): Promise<void> {
  requireValue(!sealed && signingKey && bindingRevision && directory);
  const payload = { format: 'bowerloom/mcp-container-journal/v1beta2', bindingRevision, sequence: ++snapshotSequence, body };
  const envelope = { ...payload, signature: sign(null, guardianSignaturePayload(payload), signingKey!).toString('base64') };
  requireValue(Buffer.byteLength(canonicalJson(envelope)) <= 12288);
  await synced(join(directory!, 'journal.json'), envelope); signedSnapshot = envelope;
}
async function stage(value: string, change: Partial<Journal> = {}, normal = false): Promise<void> {
  const generation = stopGeneration;
  const write = stageWrites.then(async()=>{
    requireValue(!sealed && journal && directory && (!normal || !stopping && generation === stopGeneration)); await savedJournal();
    requireValue(!sealed && (!normal || !stopping && generation === stopGeneration));
    const next = { ...journal!, ...change, stage: value, lease: { ...leaseObservation } }; await saveSnapshot(next); journal = next;
  });
  stageWrites=write.catch(()=>undefined); await write;
}
async function checkpoint(): Promise<void> {
  live(); requireValue(!pendingCheckpoint && signedSnapshot);
  const envelope=canonicalJson(signedSnapshot), value=signedSnapshot as {sequence:number};
  const promise=new Promise<void>((resolve,reject)=>{pendingCheckpoint={sequence:value.sequence,hash:'sha256:'+sha256(envelope),resolve,reject:()=>reject(Error('CHECKPOINT_CANCELLED'))};});
  void promise.catch(()=>undefined);
  send({type:'checkpoint',nonce:startNonce,envelope});
  await promise; live();
}

function docker(args: string[], timeoutMs = 2000): Promise<{ code: number | null; out: string }> {
  requireValue(!sealed);
  return new Promise((resolveResult, reject) => {
    const child = spawn('/usr/local/bin/docker', ['--context', 'desktop-linux', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = Buffer.alloc(0), bytes = 0, failed = false;
    const stopChild = () => { failed = true; child.kill('SIGKILL'); };
    const limit = setTimeout(stopChild, timeoutMs);
    child.once('error', stopChild);
    for (const stream of [child.stdout, child.stderr]) { stream.on('error', stopChild); stream.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 65536) stopChild(); else if (stream === child.stdout) out = Buffer.concat([out, chunk]); }); }
    child.once('close', code => { clearTimeout(limit); if (failed) reject(Error('DOCKER_UNCERTAIN')); else { try { resolveResult({ code, out: new TextDecoder('utf-8', { fatal: true }).decode(out) }); } catch { reject(Error('DOCKER_UNCERTAIN')); } } });
  });
}
async function present(id: string, byName = false): Promise<boolean> {
  const result = await docker(['container', 'ls', '--all', '--no-trunc', '--filter', byName ? 'name=^/' + id + '$' : 'id=' + id, '--format', '{{.ID}}']);
  requireValue(result.code === 0); const ids = result.out.trim() ? result.out.trim().split('\n') : [];
  requireValue(ids.every(value => /^[a-f0-9]{64}$/.test(value))); return byName ? ids.length !== 0 : ids.includes(id);
}
async function inspectOwned(): Promise<Record<string, any>> {
  await savedJournal(); requireValue(journal?.cid && plan);
  const result = await docker(['container', 'inspect', journal!.cid!]); requireValue(result.code === 0);
  const list = data(strictJson(result.out, 65536)) as Record<string, any>[]; requireValue(Array.isArray(list) && list.length === 1);
  const value = list[0]!, c = value.Config, h = value.HostConfig, s = plan!.spec, l = s.limits;
  const original = strictJson(job!.launch.imageConfigJson) as Record<string, any>;
  const labels = { ...(original.config.Labels ?? {}), 'ai.bowerloom.mcp.operation': s.operationKey };
  const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
  requireValue(value.Id === journal!.cid && value.Name === '/' + journal!.name && c.Image === s.imageIndexDigest && same(c.Labels, labels));
  requireValue(c.User === `${s.user.uid}:${s.user.gid}` && c.WorkingDir === s.workingDirectory && same(c.Entrypoint, [s.entrypoint]) && same(c.Cmd, s.args) && same(c.Env, s.imageEnvironment) && c.OpenStdin === true && c.Tty === false);
  requireValue(h.NetworkMode === 'none' && h.IpcMode === 'private' && h.PidMode === '' && h.UTSMode === '' && h.CgroupnsMode === 'private' && h.ReadonlyRootfs === true && h.Privileged === false && h.Init === true);
  requireValue(same(h.CapDrop, ['ALL']) && !(h.CapAdd?.length) && same(h.SecurityOpt, ['no-new-privileges=true', 'seccomp=builtin']));
  requireValue(h.Memory === l.memoryBytes && h.MemorySwap === l.memoryBytes && h.NanoCpus === l.cpuMillis * 1000000 && h.PidsLimit === l.pids && h.ShmSize === l.shmBytes);
  requireValue(h.RestartPolicy.Name === 'no' && h.LogConfig.Type === 'none' && !(h.Binds?.length) && !(h.Mounts?.length) && !(h.Devices?.length) && !(h.DeviceRequests?.length) && h.PublishAllPorts === false && Object.keys(h.PortBindings ?? {}).length === 0);
  requireValue(same(h.Tmpfs, { '/scratch': `rw,noexec,nosuid,nodev,size=${l.scratchBytes},mode=0700,uid=${s.user.uid},gid=${s.user.gid}` }));
  requireValue(same(h.Ulimits, [{ Name: 'core', Hard: 0, Soft: 0 }, { Name: 'nofile', Hard: 64, Soft: 64 }]));
  requireValue((value.Mounts ?? []).every((mount: Record<string, unknown>) => mount.Type === 'tmpfs' && mount.Destination === '/scratch'));
  requireValue(typeof value.State.Running === 'boolean'); return value;
}
function live(): void { requireValue(!sealed && !stopping && bindingRevision && job && leaseObservation.sequence > 0 && performance.now() < leaseExpiry && Date.now() < job.deadlineMs && process.connected); }
async function create(): Promise<void> {
  live(); await privateDirectory(job!.stateRoot); live();
  directory = join(job!.stateRoot, job!.operationKey.slice(7)); await mkdir(directory, { mode: 0o700 }); await privateDirectory(directory);
  const parent = await open(job!.stateRoot, 'r'); try { await parent.sync(); } finally { await parent.close(); }
  journal = { format: 'bowerloom/mcp-container-journal/v1beta1', operationKey: job!.operationKey, launchOperationKey: plan!.spec.operationKey, launchRevision: plan!.revision, name: 'bowerloom-mcp-' + plan!.spec.operationKey.slice(7), cid: null, stage: 'PREPARED', deadlineMs: job!.deadlineMs, guardianPid: process.pid, attachPid: null, reason: null, lease: { ...leaseObservation } };
  await saveSnapshot(journal); live();
  requireValue(!await present(journal.name, true)); live();
  await stage('CREATING',{},true); await checkpoint(); live(); creationAttempted = true;
  const created = await docker(plan!.argv, 5000);
  requireValue(created.code === 0 && /^[a-f0-9]{64}\s*$/.test(created.out));
  await stage('CREATED', { cid: created.out.trim() });
  if (stopping) return;
  await checkpoint(); live();
  await inspectOwned(); live();
  attachReaped = false;
  attach = spawn('/usr/local/bin/docker', ['--context', 'desktop-linux', 'container', 'start', '--attach', '--interactive', journal.cid!], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  attach.once('close', () => { attachReaped = true; leaseObservation.attachReapedAtMs = Date.now(); resolveAttach(); if (!stopping) stop('ATTACH_ENDED'); });
  attach.once('error', () => stop('ATTACH_FAILED'));
  attach.stdin.on('error', () => stop('ATTACH_FAILED'));
  attach.stderr.on('error', () => stop('ATTACH_FAILED')); attach.stdout.on('error', () => stop('ATTACH_FAILED'));
  attach.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 16384) stop('OUTPUT_BOUND'); });
  attach.stdout.on('data', (chunk: Buffer) => { stdoutBytes += chunk.length; if (stdoutBytes > 512 * 1024) { stop('OUTPUT_BOUND'); return; } if (stopping) return; if (!sentStarted) earlyChunks.push(chunk); else send({ type: 'chunk', data: chunk.toString('base64') }); });
  await stage('STARTED', { attachPid: attach.pid ?? null });
  if (stopping) return;
  await checkpoint(); live();
  sentStarted = true; send({ type: 'started', nonce: startNonce, guardianPid: process.pid });
  for (const chunk of earlyChunks) send({ type: 'chunk', data: chunk.toString('base64') }); earlyChunks.length = 0;
}
let startNonce: string | undefined;
function stop(code: string): void {
  if (sealed) return;
  reason ??= code; if (!stopping) stopGeneration++; stopping = true;
  pendingCheckpoint?.reject(); pendingCheckpoint=undefined; leaseObservation.stopRequestedAtMs ??= Date.now(); clearTimeout(timer); clearTimeout(leaseTimer); clearTimeout(renewalTimer);
  if (cleanup) return;
  cleanup = (async () => {
    let absent = false;
    try {
      await creation?.catch(() => undefined);
      await stageWrites;
      if (journal?.cid) {
        const found = await inspectOwned();
        if (found.State.Running) { const stopped = await docker(['container', 'stop', '--time', '1', journal.cid], 3000); requireValue(stopped.code === 0); }
        await inspectOwned();
        const removed = await docker(['container', 'rm', '--force', journal.cid], 2000); requireValue(removed.code === 0);
        absent = !await present(journal.cid); requireValue(absent); leaseObservation.containerAbsentAtMs = Date.now();
      } else requireValue(!creationAttempted);
      if (attach && !attachReaped) { attach.kill('SIGTERM'); const bound = setTimeout(() => attach?.kill('SIGKILL'), 250); let end: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([attachClosed, new Promise<never>((_, reject) => { end = setTimeout(() => reject(Error('ATTACH_UNCERTAIN')), 1000); })]); } finally { clearTimeout(bound); clearTimeout(end); } }
      requireValue(attachReaped);
      if (journal) await stage(journal.cid ? 'REAPED' : 'CANCELLED', { reason });
    } catch {
      reason = 'CLEANUP_UNCERTAIN';
      if (attach && !attachReaped) attach.kill('SIGKILL');
      if (journal) { try { await stage('UNCERTAIN', { reason }); } catch { /* Never rewrite a corrupt or replaced journal. */ } }
    }
    if (ended) return;
    await stageWrites;
    let terminal: {type:string;nonce:string|undefined;envelope:string;seal:string}|undefined;
    if (journal && reason !== 'CLEANUP_UNCERTAIN' && signingKey && bindingRevision && attachReaped) {
      const envelope=canonicalJson(signedSnapshot), body=terminalDeclaration(bindingRevision,envelope);
      const seal=canonicalJson({...body,signature:sign(null,guardianTerminalPayload(body),signingKey).toString('base64')});
      terminal={type:'terminal',nonce:startNonce,envelope,seal};
    }
    // No continuation can sign, write, renew, forward, or touch Docker after this point.
    sealed=true; signingKey=undefined; challenge=undefined; ended = true;
    if (terminal) send(terminal);
    const result = { type: 'done', containerAbsent: absent, noContainerCreated: !creationAttempted, attachReaped, stage: reason === 'CLEANUP_UNCERTAIN' ? 'UNCERTAIN' : journal?.stage ?? 'CANCELLED', reason };
    if (!broken && process.connected) { try { process.send?.(result, () => { if (process.connected) process.disconnect(); process.exit(0); }); } catch { process.exit(0); } } else process.exit(0);
  })();
  void cleanup.catch(() => process.exit(1));
}
process.on('disconnect', () => stop('CONTROLLER_LOST')); process.on('SIGTERM', () => stop('GUARDIAN_TERMINATED')); process.on('SIGINT', () => stop('GUARDIAN_TERMINATED'));
process.on('uncaughtException', () => stop('GUARDIAN_ERROR')); process.on('unhandledRejection', () => stop('GUARDIAN_ERROR'));
process.on('message', supplied => {
  try {
    const message = data(supplied) as Record<string, unknown>;
    if (sealed) return;
    if (message.type === 'checkpoint-ack') {
      requireValue(!stopping && pendingCheckpoint && message.nonce === startNonce && Object.keys(message).length === 4 && message.sequence === pendingCheckpoint!.sequence && message.envelopeSha256 === pendingCheckpoint!.hash);
      live(); const pending=pendingCheckpoint!;pendingCheckpoint=undefined;pending.resolve();return;
    }
    if (message.type === 'cancel' && message.nonce === startNonce && Object.keys(message).length === 2) { stop('CANCELLED'); return; }
    if (message.type === 'guardian-bound') {
      requireValue(started && helloSent && !bindingRevision && !stopping && job && message.nonce === startNonce && Object.keys(message).length === 3
        && typeof message.bindingRevision === 'string' && /^sha256:[a-f0-9]{64}$/.test(message.bindingRevision) && Date.now() < job!.deadlineMs);
      bindingRevision = message.bindingRevision as string;
      leaseExpiry = Math.min(performance.now() + LEASE_MS, absoluteMonotonicMs); armLease(); requestLease(); return;
    }
    if (message.type === 'lease-renewal') {
      requireValue(started && bindingRevision && !stopping && process.connected && job && message.nonce === startNonce && message.operationKey === job!.operationKey
        && Object.keys(message).length === 5 && challenge && message.sequence === challenge!.sequence && message.challenge === challenge!.token
        && performance.now() < leaseExpiry && performance.now() < challenge!.expires && Date.now() < job!.deadlineMs);
      leaseExpiry = challenge!.expires; leaseObservation.sequence = challenge!.sequence;
      leaseObservation.lastRenewedAtMs = Date.now(); leaseObservation.expiresMonotonicMs = leaseExpiry;
      challenge = undefined; armLease(); renewalTimer = setTimeout(requestLease, RENEW_MS);
      if (!creation) { creation = create(); void creation.catch(() => stop('CREATION_UNCERTAIN')); }
      return;
    }
    if (message.type === 'write') {
      requireValue(Object.keys(message).length === 3 && message.nonce === startNonce && !stopping && attach && sentStarted && typeof message.data === 'string' && Buffer.byteLength(message.data as string) <= 2048 && (message.data as string).endsWith('\n'));
      const wire = message.data as string; requireValue((inputBytes += Buffer.byteLength(wire)) <= 16384 && ++inputCount <= 10);
      const value = data(strictJson(wire, 2048)) as Record<string, unknown>;
      requireValue(value.jsonrpc === '2.0');
      const notification = value.method === 'notifications/initialized';
      requireValue(Object.keys(value).sort().join(',') === (notification ? 'jsonrpc,method' : 'id,jsonrpc,method,params'));
      if (value.method === 'initialize') requireValue(canonicalJson(value.params) === canonicalJson({ protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'bowerloom-discovery', version: '0.7.0-beta.1' } }));
      if (value.method === 'tools/list') { const params = value.params as Record<string, unknown>; requireValue(params && typeof params === 'object' && !Array.isArray(params) && Object.keys(params).every(key => key === 'cursor')); if (params.cursor !== undefined) requireValue(typeof params.cursor === 'string' && params.cursor.length > 0 && Buffer.byteLength(params.cursor) <= 256 && !/[\p{Cc}\p{Cf}]/u.test(params.cursor)); }
      if (phase === 'new') { requireValue(value.method === 'initialize' && value.id === inputCount); phase = 'initialized'; }
      else if (phase === 'initialized') { requireValue(value.method === 'notifications/initialized' && value.id === undefined); phase = 'ready'; }
      else requireValue(value.method === 'tools/list' && value.id === inputCount);
      live();
      attach!.stdin.write(wire, error => { if (error) stop('ATTACH_FAILED'); }); return;
    }
    requireValue(!started && !stopping && message.type === 'start' && Object.keys(message).length === 3 && typeof message.nonce === 'string' && /^[a-f0-9]{64}$/.test(message.nonce)); started = true;
    const value = data(message.job) as ContainerGuardianJob;
    requireValue(Object.keys(value).sort().join(',') === 'deadlineMs,launch,launchRevision,operationKey,stateRoot' && typeof value.stateRoot === 'string' && /^[a-f0-9]{64}$/.test(value.operationKey.slice(7)) && value.operationKey.startsWith('sha256:'));
    requireValue(process.platform === 'darwin' && process.permission === undefined && Number.isSafeInteger(value.deadlineMs) && value.deadlineMs > Date.now() && value.deadlineMs <= Date.now() + 30000);
    plan = planMcpContainerDiscoveryLaunch(value.launch); requireValue(plan.revision === value.launchRevision);
    job = value; startNonce = message.nonce as string; clearTimeout(timer); timer = setTimeout(() => stop('DEADLINE'), Math.max(1, job.deadlineMs - Date.now()));
    absoluteMonotonicMs = performance.now() + Math.max(0, job.deadlineMs - Date.now());
    void (async () => {
      const keys = generateKeyPairSync('ed25519'); signingKey = keys.privateKey;
      const bootSessionId = await readDarwinBootSession();
      requireValue(!stopping && process.connected && Date.now() < job!.deadlineMs);
      helloSent = true;
      send({ type: 'guardian-hello', nonce: startNonce, operationKey: job!.operationKey, launchRevision: job!.launchRevision,
        descriptor: { guardianPid: process.pid, bootSessionId, guardianSessionId: randomBytes(32).toString('hex'), publicKey: keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') } });
    })().catch(() => stop('GUARDIAN_BINDING_FAILED'));
  } catch { stop('GUARDIAN_PROTOCOL'); }
});
