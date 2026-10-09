import { startGuardian } from '../../codex-adapter/src/supervisor.js';
import type { OwnedGuardian } from '../../codex-adapter/src/supervisor.js';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { canonicalJson } from '../../contracts/src/index.js';
import { data, fail, McpConnectionError, validateMcpBinding, MCP_PROTOCOL_VERSION, MAX_DOCUMENT_BYTES } from './model.js';
import type { DiscoveryAuthorityOpen, DiscoveryEffect } from './authority.js';
import type { McpDiscoveryTransport, McpInitializeRequest } from './discovery.js';

export interface McpStdioSecretReference { environmentVariable: string; reference: string }
export interface McpStdioOptions {
  /** The host explicitly accepts that this is trusted local code, not a sandbox. */
  trustedLocalServerOnly: true;
  resolveSecret: (reference: Readonly<McpStdioSecretReference>) => Promise<string>;
  requestTimeoutMs?: number; sessionTimeoutMs?: number; cleanupTimeoutMs?: number;
}
type StdioEffect = Extract<DiscoveryEffect, { kind: 'stdio' }>;
const safe = (code: string): McpConnectionError => new McpConnectionError(code);
function fields(value: unknown, required: string[], optional: string[] = []): Record<string, PropertyDescriptor> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('MCP_STDIO_INPUT');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (required.some(key => !descriptors[key]) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !required.concat(optional).includes(key) || !('value' in descriptors[key]!))) fail('MCP_STDIO_INPUT');
  return descriptors;
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('MCP_STDIO_INPUT');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 2048): string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > max || /[\p{Cc}\p{Cf}]/u.test(value)) fail('MCP_STDIO_INPUT'); return value;
}
function path(value: unknown): string {
  const v = text(value);
  if (!v.startsWith('/') || resolve(v) !== v || v.endsWith('/') || v.includes('//') || v.includes('\\') || v !== v.normalize('NFC')) fail('MCP_STDIO_PATH'); return v;
}
function pinned(value: unknown): { path: string; digest: string } {
  const v = record(value, ['path', 'digest']);
  if (typeof v.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(v.digest)) fail('MCP_STDIO_INPUT');
  return { path: path(v.path), digest: v.digest };
}
function duration(value: unknown, fallback: number, max = 30000): number {
  const n = value ?? fallback; if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1 || n > max) fail('MCP_STDIO_INPUT'); return n;
}
const blockedEnvironment = /^(?:PATH|HOME|SHELL|ENV|BASH_ENV|IFS|CDPATH|NODE_OPTIONS|NODE_V8_COVERAGE|NODE_PATH|NODE_EXTRA_CA_CERTS|NODE_USE_ENV_PROXY|NODE_REPL_EXTERNAL_MODULE|OPENSSL_CONF|OPENSSL_MODULES|SSL_CERT_FILE|SSL_CERT_DIR|PYTHON.*|PERL.*|RUBY.*|GEM_.*|JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS|CLASSPATH|LD_.*|DYLD_.*)$/;
function effect(value: unknown, binding: ReturnType<typeof validateMcpBinding>): StdioEffect {
  const v = record(data(value), ['kind', 'executable', 'entrypoints', 'args', 'cwd', 'environment']);
  const environment = record(v.environment, ['inherit', 'secretReferences']);
  if (v.kind !== 'stdio' || binding.transport.kind !== 'stdio' || environment.inherit !== false
    || canonicalJson(environment.secretReferences) !== canonicalJson(binding.transport.secretReferences)) fail('MCP_STDIO_BINDING');
  const executable = pinned(v.executable), cwd = path(v.cwd);
  if (executable.path !== binding.transport.executable || cwd !== binding.transport.workingDirectory) fail('MCP_STDIO_BINDING');
  if (!Array.isArray(v.entrypoints) || v.entrypoints.length > 16 || !Array.isArray(v.args) || v.args.length > 32) fail('MCP_STDIO_INPUT');
  const entrypoints = v.entrypoints.map(pinned), args = v.args.map(item => text(item));
  if (new Set(entrypoints.map(item => item.path)).size !== entrypoints.length || entrypoints.some(item => !args.includes(item.path))) fail('MCP_STDIO_INPUT');
  for (const reference of binding.transport.secretReferences) if (blockedEnvironment.test(reference.environmentVariable)) fail('MCP_STDIO_ENVIRONMENT');
  return { kind: 'stdio', executable, entrypoints, args, cwd, environment: { inherit: false, secretReferences: binding.transport.secretReferences } };
}
async function checkedPath(value: string, directory: boolean): Promise<void> {
  if (await realpath(value) !== value) fail('MCP_STDIO_PATH');
  let current = value;
  for (;;) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (current === value && !directory ? !stat.isFile() : !stat.isDirectory())) fail('MCP_STDIO_PATH');
    if (current === '/') break; current = dirname(current);
  }
}
async function measured(file: { path: string; digest: string }, executable: boolean, check: () => void): Promise<void> {
  check(); await checkedPath(file.path, false); check();
  const handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true }); check();
    if (!before.isFile() || before.nlink !== 1n || before.size > (executable ? 128n * 1024n * 1024n : 4n * 1024n * 1024n)
      || (before.mode & 0o022n) !== 0n || (executable && (before.mode & 0o111n) === 0n)) fail('MCP_STDIO_FILE');
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(65536);
    let bytes = 0;
    for (;;) { check(); const { bytesRead } = await handle.read(buffer, 0, buffer.length, null); if (!bytesRead) break; bytes += bytesRead; if (BigInt(bytes) > before.size) fail('MCP_STDIO_DRIFT'); hash.update(buffer.subarray(0, bytesRead)); }
    const after = await handle.stat({ bigint: true }), named = await lstat(file.path, { bigint: true }); check();
    for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'nlink'] as const) if (before[key] !== after[key] || before[key] !== named[key]) fail('MCP_STDIO_DRIFT');
    if (bytes !== Number(before.size) || 'sha256:' + hash.digest('hex') !== file.digest) fail('MCP_STDIO_DRIFT');
  } finally { await handle.close(); }
}

/** Trusted local discovery prerequisite. Preflight is not atomic execution or native containment. */
export function createMcpStdioDiscoveryFactory(value: McpStdioOptions): DiscoveryAuthorityOpen {
  const options = fields(value, ['trustedLocalServerOnly', 'resolveSecret'], ['requestTimeoutMs', 'sessionTimeoutMs', 'cleanupTimeoutMs']);
  if (options.trustedLocalServerOnly!.value !== true || typeof options.resolveSecret!.value !== 'function') fail('MCP_STDIO_TRUST_REQUIRED');
  const resolveSecret = options.resolveSecret!.value as McpStdioOptions['resolveSecret'];
  const requestTimeoutMs = duration(options.requestTimeoutMs?.value, 5000), sessionTimeoutMs = duration(options.sessionTimeoutMs?.value, 10000), cleanupTimeoutMs = duration(options.cleanupTimeoutMs?.value, 3000, 3000);
  return async supplied => {
    if (!['darwin', 'linux'].includes(process.platform) || process.permission !== undefined) fail('MCP_STDIO_PLATFORM');
    let selected: StdioEffect, signal: AbortSignal, notify: (value: unknown) => void;
    try {
      const context = fields(supplied, ['binding', 'effect', 'scope', 'operationKey', 'signal', 'onNotification']);
      selected = effect(context.effect!.value, validateMcpBinding(context.binding!.value)); signal = context.signal!.value; notify = context.onNotification!.value;
      if (!(signal instanceof AbortSignal) || typeof notify !== 'function') fail('MCP_STDIO_INPUT');
    } catch { return fail('MCP_STDIO_INPUT'); }
    let guardian: OwnedGuardian | undefined, opening: Promise<OwnedGuardian> | undefined, closing = false, closed = false;
    let failure: McpConnectionError | undefined, cleanup: Promise<void> | undefined;
    const sessionDeadline = performance.now() + sessionTimeoutMs;
    let rejectStopped!: (error: McpConnectionError) => void;
    const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; }); void stopped.catch(() => undefined);
    let pending: { id: number; resolve: (value: unknown) => void; reject: (error: McpConnectionError) => void } | undefined;
    let busy = false, count = 0, phase: 'new' | 'initialized' | 'ready' = 'new', stdoutBytes = 0, stderrBytes = 0, messages = 0, buffer = Buffer.alloc(0);
    function check(): void { if (closed || signal.aborted) throw failure ?? safe('MCP_STDIO_ABORTED'); }
    function cleanupOnce(): Promise<void> {
      if (cleanup) return cleanup;
      closing = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const observe = async (): Promise<void> => {
        const owned = guardian ?? (opening ? await opening : undefined);
        if (!owned) return;
        await owned.terminate();
        const result = await owned.done;
        if (!result.leaderReaped || !result.groupGone) fail('MCP_STDIO_CLEANUP_UNCERTAIN');
      };
      cleanup = Promise.race([observe(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(safe('MCP_STDIO_CLEANUP_UNCERTAIN')), cleanupTimeoutMs);
      })]).catch(() => { throw safe('MCP_STDIO_CLEANUP_UNCERTAIN'); }).finally(() => clearTimeout(timer));
      void cleanup.catch(() => undefined); return cleanup;
    }
    function stop(code: string): void {
      if (!closed) {
        closed = true; failure = safe(code); rejectStopped(failure); pending?.reject(failure); pending = undefined;
        clearTimeout(sessionTimer); signal.removeEventListener('abort', abort);
      }
      void cleanupOnce();
    }
    const abort = () => stop('MCP_STDIO_ABORTED');
    const sessionTimer = setTimeout(() => stop('MCP_STDIO_TIMEOUT'), sessionTimeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    async function bounded<T>(operation: () => Promise<T>): Promise<T> {
      check(); return Promise.race([Promise.resolve().then(() => { check(); return operation(); }), stopped]);
    }
    function incoming(line: Buffer): void {
      if (closed) return;
      try {
        if (++messages > 16 || line.length > MAX_DOCUMENT_BYTES || !line.length || line.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) fail('MCP_STDIO_RESPONSE');
        const message = data(strictJson(new TextDecoder('utf-8', { fatal: true }).decode(line), MAX_DOCUMENT_BYTES));
        if (message && typeof message === 'object' && !Array.isArray(message) && Object.hasOwn(message, 'method')) {
          const method = (message as Record<string, unknown>).method === 'notifications/tools/list_changed' ? 'notifications/tools/list_changed' : 'unexpected/server-message';
          try { notify({ method }); } catch { /* No untrusted message or callback diagnostic is exposed. */ }
          fail('MCP_STDIO_SERVER_MESSAGE');
        }
        const v = record(message, ['jsonrpc', 'id', 'result']);
        if (!pending || v.jsonrpc !== '2.0' || v.id !== pending.id || !v.result || typeof v.result !== 'object' || Array.isArray(v.result)) fail('MCP_STDIO_RESPONSE');
        const request = pending; pending = undefined; request.resolve(v.result);
      } catch { stop('MCP_STDIO_RESPONSE'); }
    }
    try {
      const environment: Record<string, string> = Object.create(null);
      let environmentBytes = 0;
      for (const reference of selected.environment.secretReferences) {
        const secret = await bounded(() => resolveSecret(Object.freeze({ ...reference })));
        check();
        if (typeof secret !== 'string' || secret.includes('\0') || Buffer.byteLength(secret) > 8192 || (environmentBytes += Buffer.byteLength(secret)) > 32768) fail('MCP_STDIO_SECRET');
        environment[reference.environmentVariable] = secret;
      }
      // Resolve every secret first, then remeasure immediately before spawn. This is not an atomic exec pin.
      await bounded(async () => {
        await checkedPath(selected.cwd, true); check();
        for (const entrypoint of selected.entrypoints) await measured(entrypoint, false, check);
        await measured(selected.executable, true, check); check();
        await checkedPath(selected.cwd, true); check();
      });
      check();
      const remaining = sessionDeadline - performance.now();
      if (remaining <= 0) fail('MCP_STDIO_TIMEOUT');
      opening = startGuardian({ executable: selected.executable.path, argv: [...selected.args], cwd: selected.cwd,
        env: environment, seconds: Math.max(1, Math.ceil(remaining / 1000)), stdoutBytes: 512 * 1024, stderrBytes: 16384 }, signal, (stream, chunk) => {
        if (closed) return;
        if (stream === 'stderr') { stderrBytes += chunk.length; if (stderrBytes > 16384) stop('MCP_STDIO_OUTPUT_BOUND'); return; }
        stdoutBytes += chunk.length;
        if (stdoutBytes > 512 * 1024) { stop('MCP_STDIO_OUTPUT_BOUND'); return; }
        buffer = Buffer.concat([buffer, chunk]);
        for (;;) { const newline = buffer.indexOf(10); if (newline < 0) break; const line = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1); incoming(line); if (closed) return; }
        if (buffer.length > MAX_DOCUMENT_BYTES) stop('MCP_STDIO_OUTPUT_BOUND');
      });
      // Observe immediately: the factory can reject or finish after local cancellation.
      void opening.then(owned => {
        guardian = owned;
        void owned.done.then(() => { if (!closing) stop('MCP_STDIO_EXIT'); }, () => stop('MCP_STDIO_PROCESS'));
        if (closed) void owned.terminate().catch(() => undefined);
      }, () => undefined);
      guardian = await bounded(() => opening!);
      check();
    } catch {
      stop('MCP_STDIO_OPEN_FAILED');
      try { await cleanupOnce(); } catch { return fail('MCP_STDIO_CLEANUP_UNCERTAIN'); }
      return fail('MCP_STDIO_OPEN_FAILED');
    }
    async function run(method: 'initialize' | 'notifications/initialized' | 'tools/list', suppliedParams?: unknown): Promise<unknown> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        check();
        if (busy || count >= 10 || (method === 'initialize' ? phase !== 'new' : method === 'notifications/initialized' ? phase !== 'initialized' : phase !== 'ready')) fail('MCP_STDIO_ORDER');
        busy = true; count++;
        const params = data(suppliedParams ?? {});
        if (method === 'initialize') {
          if (canonicalJson(params) !== canonicalJson({ protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'bowerloom-discovery', version: '0.7.0-beta.1' } })) fail('MCP_STDIO_INPUT');
        } else if (method === 'tools/list') {
          if (!params || typeof params !== 'object' || Array.isArray(params) || Object.keys(params).some(key => key !== 'cursor')) fail('MCP_STDIO_INPUT');
          const cursor = (params as Record<string, unknown>).cursor;
          if (cursor !== undefined && (typeof cursor !== 'string' || !cursor || Buffer.byteLength(cursor) > 256 || /[\p{Cc}\p{Cf}]/u.test(cursor))) fail('MCP_STDIO_INPUT');
        }
        const id = method === 'notifications/initialized' ? undefined : count;
        const payload = JSON.stringify(id === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, id, params }) + '\n';
        timer = setTimeout(() => stop('MCP_STDIO_TIMEOUT'), requestTimeoutMs);
        const result = await bounded(() => new Promise<unknown>((resolve, reject) => {
          check();
          if (id !== undefined) pending = { id, resolve, reject };
          guardian!.write(payload);
          if (id === undefined) resolve(undefined);
        }));
        check();
        if (method === 'initialize') phase = 'initialized'; else if (method === 'notifications/initialized') phase = 'ready';
        return result;
      } catch { stop('MCP_STDIO_SESSION_FAILED'); throw safe('MCP_STDIO_SESSION_FAILED'); }
      finally { clearTimeout(timer); busy = false; }
    }
    return Object.freeze({
      initialize: (params: Readonly<McpInitializeRequest>) => run('initialize', params),
      initialized: async () => { await run('notifications/initialized'); },
      listTools: (params: Readonly<{ cursor?: string }>) => run('tools/list', params),
      close: async () => { stop('MCP_STDIO_CLOSED'); await cleanupOnce(); },
    } satisfies McpDiscoveryTransport);
  };
}
