import { spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { digest } from '../../contracts/src/index.js';
import { RuntimeError } from './types.js';
import type { ModelAdapter, ModelProcess } from './types.js';
// This adapter owns trusted synthetic child groups. It is not an OS sandbox or a production model harness.
export class SyntheticProcessAdapter implements ModelAdapter {
  readonly #command: string[]; readonly #cwd: string; readonly #timeout: number; readonly #outputLimit: number;
  constructor(options: { command: string[]; cwd: string; timeoutMs: number; outputBytes: number }) {
    if (!Array.isArray(options.command) || !options.command.length || options.command.length > 16 || !isAbsolute(options.command[0]!)
      || options.command.some(value => typeof value !== 'string' || value.includes('\0') || value.length > 2048)
      || !isAbsolute(options.cwd) || !Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 30000
      || !Number.isInteger(options.outputBytes) || options.outputBytes < 1 || options.outputBytes > 2 * 1024 * 1024) throw new RuntimeError('INVALID_PROCESS_POLICY');
    this.#command = [...options.command]; this.#cwd = options.cwd; this.#timeout = options.timeoutMs; this.#outputLimit = options.outputBytes;
  }
  async start(input: { launcherId: string; taskInput: string; modelRoute: string }, signal: AbortSignal): Promise<ModelProcess> {
    if (signal.aborted || Buffer.byteLength(input.taskInput) > 65536) throw new RuntimeError('PROCESS_REFUSED');
    const token = randomBytes(32).toString('hex'); const processRef = `process-${randomUUID()}`;
    const child = spawn(this.#command[0]!, this.#command.slice(1), { cwd: this.#cwd, env: {}, shell: false, detached: true,
      stdio: ['pipe','pipe','pipe'] });
    let groupAbsent = false; let failed = false; let bytes = 0; const chunks: Buffer[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let exitResolve!: (value: number | null) => void; const exited = new Promise<number | null>(resolve => { exitResolve = resolve; });
    child.on('error', () => { failed = true; });
    child.once('close', exitResolve);
    const finishOwnership = (): void => {
      groupAbsent = true; clearTimeout(timer); signal.removeEventListener('abort', stop);
    };
    const stop = (): void => {
      failed = true;
      // A leader's close event does not end ownership of its surviving group.
      // Once absence is observed, never signal or inspect that identifier again.
      if (!groupAbsent && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') finishOwnership(); }
      }
    };
    timer = setTimeout(stop, this.#timeout); timer.unref();
    signal.addEventListener('abort', stop, { once: true });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (buffer: Buffer) => {
      bytes += buffer.length; if (bytes > this.#outputLimit) stop();
      else if (stream === child.stdout) chunks.push(buffer);
    });
    child.stdin.on('error', () => { failed = true; });
    const groupGone = async (): Promise<void> => {
      if (groupAbsent) return;
      if (!child.pid) { finishOwnership(); return; }
      for (let attempt = 0; attempt < 100; attempt++) {
        if (groupAbsent) return;
        try { process.kill(-child.pid, 0); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') { finishOwnership(); return; }
          // macOS can briefly report EPERM while a killed orphan is being reaped.
          // It is not absence evidence: retry within the same bounded ownership interval.
          if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw new RuntimeError('TERMINATION_UNKNOWN');
        }
        await delay(10);
      }
      throw new RuntimeError('TERMINATION_UNKNOWN');
    };
    const waitForClose = async (): Promise<void> => {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([exited, new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new RuntimeError('TERMINATION_UNKNOWN')), 1000);
        })]);
      } finally { clearTimeout(deadline); }
    };
    const result = (async () => {
      const code = await exited;
      await groupGone();
      if (failed || code !== 0 || signal.aborted) throw new RuntimeError('PROCESS_STOPPED');
      let packet; try { packet = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RuntimeError('INVALID_WORKER_OUTPUT'); }
      if (!packet || packet.token !== token || typeof packet.proposal !== 'string' || Object.keys(packet).sort().join() !== 'proposal,token') throw new RuntimeError('INVALID_WORKER_OUTPUT');
      return packet.proposal as string;
    })();
    void result.catch(() => {});
    try {
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new RuntimeError('PROCESS_START_FAILED'))); });
      if (signal.aborted) stop();
      child.stdin.end(JSON.stringify({ token, taskInput: input.taskInput, modelRoute: input.modelRoute }));
      return { identity: { processRef, ownershipDigest: digest(token), pid: child.pid!, groupId: child.pid!, launcherId: input.launcherId }, result,
        async terminate() { stop(); await waitForClose(); await groupGone(); } };
    } catch (error) { stop(); await waitForClose(); await groupGone(); throw error; }
  }
}
