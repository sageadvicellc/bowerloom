import { canonicalJson } from '../../contracts/src/index.js';
import { data, fail, MAX_DOCUMENT_BYTES, MCP_PROTOCOL_VERSION, McpConnectionError, planMcpConnection } from './model.js';
import type { McpBinding, McpPlanInput, ServerIdentity, TransportKind } from './model.js';

export interface McpInitializeRequest {
  protocolVersion: typeof MCP_PROTOCOL_VERSION; capabilities: Record<string, never>;
  clientInfo: { name: 'bowerloom-discovery'; version: '0.7.0-beta.0' };
}
export interface McpDiscoveryTransport {
  initialize(params: Readonly<McpInitializeRequest>): Promise<unknown>;
  initialized(): Promise<void>;
  listTools(params: Readonly<{ cursor?: string }>): Promise<unknown>;
  close(): Promise<void>;
}
export interface McpDiscoveryContext {
  binding: Readonly<McpBinding>; signal: AbortSignal; onNotification: (notification: unknown) => void;
}
export interface McpDiscoveryOptions {
  approve: string; open: (context: Readonly<McpDiscoveryContext>) => Promise<McpDiscoveryTransport>;
  timeoutMs?: number; signal?: AbortSignal; cleanupTimeoutMs?: number;
}
export interface McpDiscoveryResult {
  format: 'bowerloom/mcp-discovery-result/v1beta1'; contentScope: 'private-local-result';
  planRevision: string; bindingRevision: string; catalogRevision: string;
  protocolVersion: typeof MCP_PROTOCOL_VERSION; serverIdentity: ServerIdentity; transport: TransportKind;
  observedToolCount: number; pageCount: number; catalogMatched: true;
  discoveryEvidence: 'trusted-adapter-session'; authenticatedServerIdentity: false; authenticationVerified: false;
  runtimePortabilityVerified: false; toolCalls: 0; executionAuthorized: false; grants: []; cleanup: 'closed';
}
const MAX_PAGES = 8, MAX_TOOLS = 256, CLEANUP_MS = 1000;
const SESSION_CODES = new Set(['MCP_DISCOVERY_ABORTED', 'MCP_DISCOVERY_TIMEOUT', 'MCP_DISCOVERY_CATALOG_CHANGED',
  'MCP_DISCOVERY_NOTIFICATION', 'MCP_DISCOVERY_ADAPTER', 'MCP_DISCOVERY_RESPONSE', 'MCP_DISCOVERY_RESPONSE_BOUND',
  'MCP_DISCOVERY_PROTOCOL', 'MCP_DISCOVERY_IDENTITY', 'MCP_DISCOVERY_CAPABILITY', 'MCP_DISCOVERY_PAGE_BOUND',
  'MCP_DISCOVERY_TOOL_BOUND', 'MCP_DISCOVERY_DUPLICATE_TOOL', 'MCP_DISCOVERY_CURSOR', 'MCP_DISCOVERY_CURSOR_CYCLE',
  'MCP_DISCOVERY_CATALOG_INVALID', 'MCP_DISCOVERY_CATALOG_DRIFT']);
const frozen = <T>(value: T): T => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
};
function record(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('MCP_DISCOVERY_RESPONSE');
  const v = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(v, key)) || Object.keys(v).some(key => !required.includes(key) && !optional.includes(key))) fail('MCP_DISCOVERY_RESPONSE');
  return v;
}
function response(value: unknown): unknown {
  try {
    const cloned = data(value);
    if (Buffer.byteLength(canonicalJson(cloned)) > MAX_DOCUMENT_BYTES) fail('MCP_DISCOVERY_RESPONSE_BOUND');
    return cloned;
  } catch (error) {
    if (error instanceof McpConnectionError && error.code === 'MCP_DISCOVERY_RESPONSE_BOUND') throw error;
    return fail('MCP_DISCOVERY_RESPONSE');
  }
}
function options(value: McpDiscoveryOptions): Required<Pick<McpDiscoveryOptions, 'approve' | 'open' | 'timeoutMs' | 'cleanupTimeoutMs'>> & Pick<McpDiscoveryOptions, 'signal'> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('MCP_DISCOVERY_OPTIONS');
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || !['approve', 'open', 'timeoutMs', 'signal', 'cleanupTimeoutMs'].includes(key) || !('value' in descriptors[key]!))
    || !descriptors.approve || !descriptors.open) fail('MCP_DISCOVERY_OPTIONS');
  const approve = descriptors.approve.value, open = descriptors.open.value, timeoutMs = descriptors.timeoutMs?.value ?? 5000, signal = descriptors.signal?.value, cleanupTimeoutMs = descriptors.cleanupTimeoutMs?.value ?? CLEANUP_MS;
  if (typeof approve !== 'string' || typeof open !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000
    || !Number.isInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1 || cleanupTimeoutMs > 15000
    || (signal !== undefined && !(signal instanceof AbortSignal))) fail('MCP_DISCOVERY_OPTIONS');
  return { approve, open, timeoutMs, cleanupTimeoutMs, ...(signal ? { signal } : {}) };
}

/** The factory is trusted host code. This engine limits its own protocol operations, not that code's authority. */
export async function discoverMcpCatalog(input: McpPlanInput, supplied: McpDiscoveryOptions): Promise<McpDiscoveryResult> {
  // Capture all input before opening anything. Later caller mutations cannot change the approved session.
  const captured = data(input) as McpPlanInput, plan = planMcpConnection(captured), opts = options(supplied);
  if (opts.approve !== plan.revision) fail('MCP_DISCOVERY_APPROVAL');
  if (opts.signal?.aborted) fail('MCP_DISCOVERY_ABORTED');
  const controller = new AbortController();
  let fault: McpConnectionError | undefined, finished = false, closing = false;
  let transport: McpDiscoveryTransport | undefined, cleanup: Promise<void> | undefined;
  let rejectInterrupted!: (error: McpConnectionError) => void;
  const interrupted = new Promise<never>((_, reject) => { rejectInterrupted = reject; });
  void interrupted.catch(() => undefined);
  const stop = (code: string): void => {
    if (finished || fault) return;
    fault = new McpConnectionError(code); controller.abort(); rejectInterrupted(fault);
  };
  const abort = () => stop('MCP_DISCOVERY_ABORTED');
  opts.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => stop('MCP_DISCOVERY_TIMEOUT'), opts.timeoutMs);
  const onNotification = (value: unknown): void => {
    if (finished) return;
    let changed = false;
    try { const n = data(value); changed = !!n && typeof n === 'object' && !Array.isArray(n) && (n as Record<string, unknown>).method === 'notifications/tools/list_changed'; } catch { /* Do not expose notification data or getter errors. */ }
    stop(changed ? 'MCP_DISCOVERY_CATALOG_CHANGED' : 'MCP_DISCOVERY_NOTIFICATION');
  };
  function closeOnce(value: McpDiscoveryTransport): Promise<void> {
    if (!cleanup) cleanup = Promise.resolve().then(() => value.close()).then(() => undefined);
    return cleanup;
  }
  async function perform<T>(work: () => Promise<T>): Promise<T> {
    if (fault) throw fault;
    const operation = Promise.resolve().then(work).catch(() => { throw new McpConnectionError('MCP_DISCOVERY_ADAPTER'); });
    const result = await Promise.race([operation, interrupted]);
    if (fault) throw fault;
    return result;
  }
  let result: McpDiscoveryResult | undefined, failed: McpConnectionError | undefined;
  try {
    const opened = Promise.resolve().then(() => {
      if (fault) throw fault;
      return opts.open(Object.freeze({ binding: frozen(data(plan.binding) as McpBinding), signal: controller.signal, onNotification }));
    });
    // A late factory result must never become a success or escape a cleanup attempt.
    void opened.then(value => { transport = value; if (closing || finished) void closeOnce(value).catch(() => undefined); }, () => undefined);
    transport = await perform(() => opened);
    if (!transport || typeof transport.initialize !== 'function' || typeof transport.initialized !== 'function'
      || typeof transport.listTools !== 'function' || typeof transport.close !== 'function') fail('MCP_DISCOVERY_ADAPTER');
    const init = record(response(await perform(() => transport!.initialize(frozen({ protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'bowerloom-discovery', version: '0.7.0-beta.0' } })))), ['protocolVersion', 'capabilities', 'serverInfo'], ['instructions', '_meta']);
    if (init.instructions !== undefined && typeof init.instructions !== 'string') fail('MCP_DISCOVERY_RESPONSE');
    if (init.protocolVersion !== MCP_PROTOCOL_VERSION) fail('MCP_DISCOVERY_PROTOCOL');
    const server = record(init.serverInfo, ['name', 'version'], ['title', 'websiteUrl', 'icons']);
    if (server.name !== plan.binding.serverIdentity.name || server.version !== plan.binding.serverIdentity.version) fail('MCP_DISCOVERY_IDENTITY');
    const capabilities = record(init.capabilities, ['tools'], ['logging', 'resources', 'prompts', 'completions', 'experimental']);
    const toolsCapability = record(capabilities.tools, [], ['listChanged']);
    if (toolsCapability.listChanged !== undefined && typeof toolsCapability.listChanged !== 'boolean') fail('MCP_DISCOVERY_CAPABILITY');
    await perform(() => transport!.initialized());
    let cursor: string | undefined, pageCount = 0, totalBytes = 0;
    const cursors = new Set<string>(), names = new Set<string>(), tools: unknown[] = [];
    for (;;) {
      if (++pageCount > MAX_PAGES) fail('MCP_DISCOVERY_PAGE_BOUND');
      const page = record(response(await perform(() => transport!.listTools(frozen(cursor ? { cursor } : {})))), ['tools'], ['nextCursor', '_meta']);
      totalBytes += Buffer.byteLength(canonicalJson(page));
      if (totalBytes > MAX_DOCUMENT_BYTES) fail('MCP_DISCOVERY_RESPONSE_BOUND');
      if (!Array.isArray(page.tools) || page.tools.length > MAX_TOOLS || tools.length + page.tools.length > MAX_TOOLS) fail('MCP_DISCOVERY_TOOL_BOUND');
      for (const tool of page.tools) {
        const named = record(tool, ['name', 'inputSchema'], ['description', 'outputSchema', 'annotations']);
        if (typeof named.name !== 'string' || names.has(named.name)) fail('MCP_DISCOVERY_DUPLICATE_TOOL');
        names.add(named.name); tools.push(tool);
      }
      if (page.nextCursor === undefined) break;
      if (typeof page.nextCursor !== 'string' || !page.nextCursor || Buffer.byteLength(page.nextCursor) > 256 || /[\p{Cc}\p{Cf}]/u.test(page.nextCursor)) fail('MCP_DISCOVERY_CURSOR');
      if (cursors.has(page.nextCursor)) fail('MCP_DISCOVERY_CURSOR_CYCLE');
      cursors.add(page.nextCursor); cursor = page.nextCursor;
    }
    let discovered;
    try {
      discovered = planMcpConnection({ declaration: plan.declaration, binding: plan.binding,
        catalog: { ...(captured.catalog as Record<string, unknown>), tools }, synthetic: true });
    } catch { return fail('MCP_DISCOVERY_CATALOG_INVALID'); }
    if (discovered.catalogRevision !== plan.catalogRevision) fail('MCP_DISCOVERY_CATALOG_DRIFT');
    if (fault) throw fault;
    result = { format: 'bowerloom/mcp-discovery-result/v1beta1', contentScope: 'private-local-result',
      planRevision: plan.revision, bindingRevision: plan.bindingRevision, catalogRevision: plan.catalogRevision,
      protocolVersion: MCP_PROTOCOL_VERSION, serverIdentity: plan.binding.serverIdentity, transport: plan.binding.transport.kind,
      observedToolCount: tools.length, pageCount, catalogMatched: true, discoveryEvidence: 'trusted-adapter-session',
      authenticatedServerIdentity: false, authenticationVerified: false, runtimePortabilityVerified: false,
      toolCalls: 0, executionAuthorized: false, grants: [], cleanup: 'closed' };
  } catch (error) {
    failed = new McpConnectionError(error instanceof McpConnectionError && SESSION_CODES.has(error.code) ? error.code : 'MCP_DISCOVERY_ADAPTER');
  } finally {
    closing = true; controller.abort(); clearTimeout(timer);
    if (transport) {
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([closeOnce(transport), new Promise<never>((_, reject) => { closeTimer = setTimeout(() => reject(new McpConnectionError('MCP_DISCOVERY_CLEANUP_TIMEOUT')), opts.cleanupTimeoutMs); })]);
      } catch (error) {
        failed = new McpConnectionError(error instanceof McpConnectionError && error.code === 'MCP_DISCOVERY_CLEANUP_TIMEOUT' ? 'MCP_DISCOVERY_CLEANUP_TIMEOUT' : 'MCP_DISCOVERY_CLEANUP_FAILED');
      } finally { clearTimeout(closeTimer); }
    }
    opts.signal?.removeEventListener('abort', abort); finished = true;
  }
  if (failed) throw failed;
  if (fault) throw fault;
  if (!result) fail('MCP_DISCOVERY_ADAPTER');
  return frozen(result);
}
