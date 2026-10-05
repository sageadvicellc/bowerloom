import { lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { canonicalJson } from '../../contracts/src/index.js';
import { data, fail, McpConnectionError, validateMcpBinding, MCP_PROTOCOL_VERSION, MAX_DOCUMENT_BYTES } from './model.js';
import { planMcpContainerDiscoveryLaunch } from './container-policy.js';
import { startContainerGuardian } from './container-supervisor.js';
import type { GuardianDescriptor, GuardianBinding } from './container-guardian-provenance.js';
import type { OwnedContainerGuardian } from './container-supervisor.js';
import type { DiscoveryAuthorityOpen, DiscoveryEffect } from './authority.js';
import type { McpDiscoveryTransport, McpInitializeRequest } from './discovery.js';
export interface McpContainerOptions { stateRoot: string; trustedDockerDesktop: true; requestTimeoutMs?: number; sessionTimeoutMs?: number; cleanupTimeoutMs?: number }
type ContainerEffect = Extract<DiscoveryEffect, { kind: 'container-stdio' }>;
const safe = (code: string): McpConnectionError => new McpConnectionError(code);
function fields(value: unknown, required: string[], optional: string[] = []): Record<string, PropertyDescriptor> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('MCP_CONTAINER_INPUT');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (required.some(key => !descriptors[key]) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !required.concat(optional).includes(key) || !('value' in descriptors[key]!))) fail('MCP_CONTAINER_INPUT');
  return descriptors;
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('MCP_CONTAINER_INPUT');
  return value as Record<string, unknown>;
}
function duration(value: unknown, fallback: number, max = 30000): number {
  const n = value ?? fallback; if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1 || n > max) fail('MCP_CONTAINER_INPUT'); return n;
}
/** Internal synthetic discovery. The caller supplies exact authority through the discovery controller. */
export function createMcpContainerDiscoveryFactory(value: McpContainerOptions): DiscoveryAuthorityOpen {
  const options = fields(value, ['stateRoot', 'trustedDockerDesktop'], ['requestTimeoutMs', 'sessionTimeoutMs', 'cleanupTimeoutMs']);
  const stateRoot = options.stateRoot!.value;
  if (options.trustedDockerDesktop!.value !== true || typeof stateRoot !== 'string' || !stateRoot.startsWith('/') || resolve(stateRoot) !== stateRoot || /[\p{Cc}\p{Cf}]/u.test(stateRoot)) fail('MCP_CONTAINER_TRUST_REQUIRED');
  const requestTimeoutMs = duration(options.requestTimeoutMs?.value, 5000), sessionTimeoutMs = duration(options.sessionTimeoutMs?.value, 10000), cleanupTimeoutMs = duration(options.cleanupTimeoutMs?.value, 9000, 15000);
  return async supplied => {
    if (process.platform !== 'darwin' || process.permission !== undefined) fail('MCP_CONTAINER_PLATFORM');
    let selected: ContainerEffect, signal: AbortSignal, notify: (value: unknown) => void, operationKey: string, deadlineMs: number, renewAuthority: () => Promise<void>, bindGuardian: (descriptor: GuardianDescriptor) => Promise<GuardianBinding>;
    try {
      const context = fields(supplied, ['binding', 'effect', 'scope', 'operationKey', 'signal', 'onNotification', 'deadlineMs', 'renewAuthority', 'bindGuardian']);
      const effect = record(data(context.effect!.value), ['kind', 'launch', 'launchRevision']);
      if (effect.kind !== 'container-stdio') fail('MCP_CONTAINER_INPUT');
      selected = effect as unknown as ContainerEffect;
      const plan = planMcpContainerDiscoveryLaunch(selected.launch), binding = validateMcpBinding(context.binding!.value);
      if (plan.revision !== selected.launchRevision || binding.transport.kind !== 'stdio' || binding.transport.secretReferences.length !== 0 || binding.transport.executable !== plan.spec.entrypoint || binding.transport.workingDirectory !== plan.spec.workingDirectory) fail('MCP_CONTAINER_BINDING');
      operationKey = context.operationKey!.value;
      if (typeof operationKey !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(operationKey)) fail('MCP_CONTAINER_INPUT');
      const authorizedDeadline = context.deadlineMs!.value;
      if (!Number.isSafeInteger(authorizedDeadline) || authorizedDeadline <= Date.now() || authorizedDeadline > Date.now() + 30000) fail('MCP_CONTAINER_DEADLINE');
      deadlineMs = Math.min(authorizedDeadline, Date.now() + sessionTimeoutMs);
      signal = context.signal!.value; notify = context.onNotification!.value; renewAuthority = context.renewAuthority!.value; bindGuardian = context.bindGuardian!.value;
      if (!(signal instanceof AbortSignal) || typeof notify !== 'function' || typeof renewAuthority !== 'function' || typeof bindGuardian !== 'function') fail('MCP_CONTAINER_INPUT');
    } catch { return fail('MCP_CONTAINER_INPUT'); }
    let guardian: OwnedContainerGuardian | undefined, opening: Promise<OwnedContainerGuardian> | undefined, closing = false, closed = false;
    let failure: McpConnectionError | undefined, cleanup: Promise<void> | undefined;
    
    let rejectStopped!: (error: McpConnectionError) => void;
    const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; }); void stopped.catch(() => undefined);
    let pending: { id: number; resolve: (value: unknown) => void; reject: (error: McpConnectionError) => void } | undefined;
    let busy = false, count = 0, phase: 'new' | 'initialized' | 'ready' = 'new', stdoutBytes = 0, messages = 0, buffer = Buffer.alloc(0);
    function check(): void { if (closed || signal.aborted || Date.now() >= deadlineMs) throw failure ?? safe('MCP_CONTAINER_ABORTED'); }
    function cleanupOnce(): Promise<void> {
      if (cleanup) return cleanup;
      closing = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const observe = async (): Promise<void> => {
        const owned = guardian ?? (opening ? await opening : undefined);
        if (!owned) return;
        await owned.terminate();
        const result = await owned.done;
        if (!result.attachReaped || !(result.containerAbsent || result.noContainerCreated)) fail('MCP_CONTAINER_CLEANUP_UNCERTAIN');
      };
      cleanup = Promise.race([observe(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(safe('MCP_CONTAINER_CLEANUP_UNCERTAIN')), cleanupTimeoutMs);
      })]).catch(() => { throw safe('MCP_CONTAINER_CLEANUP_UNCERTAIN'); }).finally(() => clearTimeout(timer));
      void cleanup.catch(() => undefined); return cleanup;
    }
    function stop(code: string): void {
      if (!closed) {
        closed = true; failure = safe(code); rejectStopped(failure); pending?.reject(failure); pending = undefined;
        clearTimeout(sessionTimer); signal.removeEventListener('abort', abort);
      }
      void cleanupOnce();
    }
    const abort = () => stop('MCP_CONTAINER_ABORTED');
    const sessionTimer = setTimeout(() => stop('MCP_CONTAINER_TIMEOUT'), Math.max(1, deadlineMs - Date.now()));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    async function bounded<T>(operation: () => Promise<T>): Promise<T> {
      check(); return Promise.race([Promise.resolve().then(() => { check(); return operation(); }), stopped]);
    }
    function incoming(line: Buffer): void {
      if (closed) return;
      try {
        if (++messages > 16 || line.length > MAX_DOCUMENT_BYTES || !line.length || line.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) fail('MCP_CONTAINER_RESPONSE');
        const message = data(strictJson(new TextDecoder('utf-8', { fatal: true }).decode(line), MAX_DOCUMENT_BYTES));
        if (message && typeof message === 'object' && !Array.isArray(message) && Object.hasOwn(message, 'method')) {
          const method = (message as Record<string, unknown>).method === 'notifications/tools/list_changed' ? 'notifications/tools/list_changed' : 'unexpected/server-message';
          try { notify({ method }); } catch { /* No untrusted message or callback diagnostic is exposed. */ }
          fail('MCP_CONTAINER_SERVER_MESSAGE');
        }
        const v = record(message, ['jsonrpc', 'id', 'result']);
        if (!pending || v.jsonrpc !== '2.0' || v.id !== pending.id || !v.result || typeof v.result !== 'object' || Array.isArray(v.result)) fail('MCP_CONTAINER_RESPONSE');
        const request = pending; pending = undefined; request.resolve(v.result);
      } catch { stop('MCP_CONTAINER_RESPONSE'); }
    }
    try {
      await bounded(async () => {
        if (await realpath(stateRoot) !== stateRoot) fail('MCP_CONTAINER_STATE_ROOT');
        const stat = await lstat(stateRoot); check();
        if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700) fail('MCP_CONTAINER_STATE_ROOT');
      });
      check();
      opening = startContainerGuardian({ stateRoot, operationKey, launch: selected.launch, launchRevision: selected.launchRevision, deadlineMs }, signal, chunk => {
        if (closed) return;
        stdoutBytes += chunk.length;
        if (stdoutBytes > 512 * 1024) { stop('MCP_CONTAINER_OUTPUT_BOUND'); return; }
        buffer = Buffer.concat([buffer, chunk]);
        for (;;) { const newline = buffer.indexOf(10); if (newline < 0) break; const line = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1); incoming(line); if (closed) return; }
        if (buffer.length > MAX_DOCUMENT_BYTES) stop('MCP_CONTAINER_OUTPUT_BOUND');
      }, renewAuthority, bindGuardian);
      void opening.then(owned => {
        guardian = owned;
        void owned.done.then(() => { if (!closing) stop('MCP_CONTAINER_EXIT'); }, () => stop('MCP_CONTAINER_PROCESS'));
        if (closed) void owned.terminate().catch(() => undefined);
      }, () => undefined);
      guardian = await bounded(() => opening!); check();
    } catch {
      stop('MCP_CONTAINER_OPEN_FAILED');
      try { await cleanupOnce(); } catch { return fail('MCP_CONTAINER_CLEANUP_UNCERTAIN'); }
      return fail('MCP_CONTAINER_OPEN_FAILED');
    }
    async function run(method: 'initialize' | 'notifications/initialized' | 'tools/list', suppliedParams?: unknown): Promise<unknown> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        check();
        if (busy || count >= 10 || (method === 'initialize' ? phase !== 'new' : method === 'notifications/initialized' ? phase !== 'initialized' : phase !== 'ready')) fail('MCP_CONTAINER_ORDER');
        busy = true; count++;
        const params = data(suppliedParams ?? {});
        if (method === 'initialize') {
          if (canonicalJson(params) !== canonicalJson({ protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'bowerloom-discovery', version: '0.7.0-beta.0' } })) fail('MCP_CONTAINER_INPUT');
        } else if (method === 'tools/list') {
          if (!params || typeof params !== 'object' || Array.isArray(params) || Object.keys(params).some(key => key !== 'cursor')) fail('MCP_CONTAINER_INPUT');
          const cursor = (params as Record<string, unknown>).cursor;
          if (cursor !== undefined && (typeof cursor !== 'string' || !cursor || Buffer.byteLength(cursor) > 256 || /[\p{Cc}\p{Cf}]/u.test(cursor))) fail('MCP_CONTAINER_INPUT');
        }
        const id = method === 'notifications/initialized' ? undefined : count;
        const payload = JSON.stringify(id === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, id, params }) + '\n';
        timer = setTimeout(() => stop('MCP_CONTAINER_TIMEOUT'), requestTimeoutMs);
        const result = await bounded(() => new Promise<unknown>((resolve, reject) => {
          check();
          if (id !== undefined) pending = { id, resolve, reject };
          guardian!.write(payload);
          if (id === undefined) resolve(undefined);
        }));
        check();
        if (method === 'initialize') phase = 'initialized'; else if (method === 'notifications/initialized') phase = 'ready';
        return result;
      } catch { stop('MCP_CONTAINER_SESSION_FAILED'); throw safe('MCP_CONTAINER_SESSION_FAILED'); }
      finally { clearTimeout(timer); busy = false; }
    }
    return Object.freeze({
      initialize: (params: Readonly<McpInitializeRequest>) => run('initialize', params),
      initialized: async () => { await run('notifications/initialized'); },
      listTools: (params: Readonly<{ cursor?: string }>) => run('tools/list', params),
      close: async () => { stop('MCP_CONTAINER_CLOSED'); await cleanupOnce(); },
    } satisfies McpDiscoveryTransport);
  };
}
