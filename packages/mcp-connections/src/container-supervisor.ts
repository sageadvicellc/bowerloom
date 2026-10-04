import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { data, fail, McpConnectionError } from './model.js';
import type { McpContainerPlanInput } from './container-policy.js';
export interface ContainerGuardianJob { stateRoot: string; operationKey: string; launch: McpContainerPlanInput; launchRevision: string; deadlineMs: number }
export interface ContainerGuardianDone { containerAbsent: boolean; noContainerCreated: boolean; attachReaped: boolean; stage: string; reason: string | null }
export interface OwnedContainerGuardian { guardianPid: number; done: Promise<ContainerGuardianDone>; write(data: string): void; terminate(): Promise<void> }
export async function startContainerGuardian(value: ContainerGuardianJob, signal: AbortSignal, onChunk: (data: Buffer) => void, renewAuthority: () => Promise<void>): Promise<OwnedContainerGuardian> {
  const job = data(value) as unknown as ContainerGuardianJob;
  if (typeof renewAuthority !== 'function' || signal.aborted || process.permission !== undefined || !Number.isSafeInteger(job.deadlineMs) || job.deadlineMs <= Date.now() || job.deadlineMs > Date.now() + 30000) fail('MCP_CONTAINER_GUARDIAN_INPUT');
  const nonce = randomBytes(32).toString('hex');
  const processOwned = fork(new URL('./container-guardian.js', import.meta.url), [], { execArgv: [], env: { NODE_V8_COVERAGE: undefined }, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  let started = false, ended = false, cancelSent = false, broken = false, receipt: ContainerGuardianDone | undefined, leaseSequence = 0, renewing = false;
  let resolveStart!: () => void, rejectStart!: (error: McpConnectionError) => void, resolveDone!: (value: ContainerGuardianDone) => void, rejectDone!: (error: McpConnectionError) => void;
  const start = new Promise<void>((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
  const done = new Promise<ContainerGuardianDone>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  void start.catch(() => undefined); void done.catch(() => undefined);
  const error = () => new McpConnectionError('MCP_CONTAINER_GUARDIAN_UNCERTAIN');
  const failedChannel = () => { if (broken || ended) return; broken = true; try { processOwned.kill('SIGTERM'); } catch { /* Completion still needs the owned guardian's receipt. */ } };
  const send = (message: unknown) => { if (broken || ended) return; if (!processOwned.connected) { failedChannel(); return; } try { processOwned.send(message as never, err => { if (err) failedChannel(); }); } catch { failedChannel(); } };
  const cancel = () => { if (cancelSent || ended) return; cancelSent = true; send({ type: 'cancel', nonce }); };
  signal.addEventListener('abort', cancel, { once: true });
  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  const watchdog = setTimeout(() => { failedChannel(); hardTimer = setTimeout(() => { if (!ended) processOwned.kill('SIGKILL'); }, 3000); }, Math.max(0, job.deadlineMs - Date.now()) + 15000);
  processOwned.on('error', failedChannel);
  processOwned.on('message', supplied => {
    try {
      const message = data(supplied) as Record<string, unknown>;
      if (message.type === 'lease-challenge') {
        if (ended || broken || cancelSent || renewing || message.nonce !== nonce || message.operationKey !== job.operationKey || Object.keys(message).length !== 5
          || message.sequence !== leaseSequence + 1 || typeof message.challenge !== 'string' || !/^[a-f0-9]{64}$/.test(message.challenge)) throw error();
        leaseSequence++; renewing = true;
        void Promise.resolve().then(() => renewAuthority()).then(() => {
          renewing = false;
          if (!ended && !broken && !cancelSent && !signal.aborted) send({ type: 'lease-renewal', nonce, operationKey: job.operationKey, sequence: message.sequence, challenge: message.challenge });
        }, () => { renewing = false; cancel(); });
      } else if (message.type === 'started') {
        if (started || message.nonce !== nonce || message.guardianPid !== processOwned.pid || Object.keys(message).length !== 3) throw error(); started = true; resolveStart();
      } else if (message.type === 'chunk') {
        if (!started || Object.keys(message).length !== 2 || typeof message.data !== 'string' || message.data.length > 90000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(message.data)) throw error();
        const bytes = Buffer.from(message.data, 'base64'); if (bytes.toString('base64') !== message.data) throw error();
        try { onChunk(bytes); } catch { cancel(); }
      } else if (message.type === 'done') {
        if (receipt || Object.keys(message).length !== 6 || typeof message.containerAbsent !== 'boolean' || typeof message.noContainerCreated !== 'boolean' || typeof message.attachReaped !== 'boolean'
          || !['REAPED', 'CANCELLED', 'UNCERTAIN'].includes(message.stage as string) || !(message.reason === null || (typeof message.reason === 'string' && /^[A-Z_]{1,64}$/.test(message.reason)))) throw error();
        receipt = { containerAbsent: message.containerAbsent, noContainerCreated: message.noContainerCreated, attachReaped: message.attachReaped, stage: message.stage as string, reason: message.reason as string | null };
      } else throw error();
    } catch { failedChannel(); }
  });
  processOwned.once('close', () => {
    ended = true; clearTimeout(watchdog); clearTimeout(hardTimer); signal.removeEventListener('abort', cancel);
    if (!started) rejectStart(error());
    if (receipt?.attachReaped && (receipt.containerAbsent || receipt.noContainerCreated) && receipt.stage !== 'UNCERTAIN') resolveDone(receipt); else rejectDone(error());
  });
  if (signal.aborted) cancel(); else send({ type: 'start', nonce, job });
  await start;
  return { guardianPid: processOwned.pid!, done,
    write(message) { if (ended || broken || cancelSent || Buffer.byteLength(message) > 2048) fail('MCP_CONTAINER_GUARDIAN_CLOSED'); send({ type: 'write', nonce, data: message }); },
    async terminate() { cancel(); await done; } };
}
