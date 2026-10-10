import https from 'node:https';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { canonicalJson } from '../../contracts/src/index.js';
import { data, fail, McpConnectionError, mcpBindingRevision, validateMcpBinding, MCP_PROTOCOL_VERSION, MAX_DOCUMENT_BYTES } from './model.js';
import type { DiscoveryAuthorityOpen, DiscoveryAuthorityContext } from './authority.js';
import type { McpDiscoveryTransport, McpInitializeRequest } from './discovery.js';

export interface McpHttpCredentialRequest { bindingRevision: string; credentialRef: string; issuer: string; audience: string; scopes: string[] }
export interface McpHttpCredential extends McpHttpCredentialRequest { token: string; expiresAtMs: number; revoked: boolean }
export interface McpHttpOptions {
  resolveCredential: (request: Readonly<McpHttpCredentialRequest>) => Promise<McpHttpCredential>;
  nowMs?: () => number; requestTimeoutMs?: number; sessionTimeoutMs?: number;
  /** Only for explicitly selected synthetic TLS loopback proof; never disables verification. */
  loopbackTls?: { endpoint: string; ca: string };
}
const fixed = (code: string): McpConnectionError => new McpConnectionError(code);
const freeze = <T>(value: T): T => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('MCP_HTTP_INPUT');
  return value as Record<string, unknown>;
}
function fields(value: unknown, required: string[], optional: string[]): Record<string, PropertyDescriptor> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('MCP_HTTP_INPUT');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (required.some(key => !descriptors[key]) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !required.concat(optional).includes(key) || !('value' in descriptors[key]!))) fail('MCP_HTTP_INPUT');
  return descriptors;
}
function duration(value: unknown, fallback: number): number {
  const n = value ?? fallback;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1 || n > 30000) fail('MCP_HTTP_INPUT');
  return n;
}
/** Conservative IPv4-only admission; special-use and all IPv6 addresses fail closed. */
export function isMcpPublicAddress(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number) as [number, number, number, number];
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
function parseJson(text: string): unknown {
  try { return data(strictJson(text)); } catch { return fail('MCP_HTTP_RESPONSE'); }
}
function envelope(value: unknown, id: number, notify: (value: unknown) => void): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'method')) {
    const method = (value as Record<string, unknown>).method === 'notifications/tools/list_changed' ? 'notifications/tools/list_changed' : 'unexpected/server-message';
    try { notify({ method }); } catch { /* The callback is trusted, but its errors remain private. */ }
    return fail('MCP_HTTP_SERVER_MESSAGE');
  }
  const v = record(value, ['jsonrpc', 'id', 'result']);
  if (v.jsonrpc !== '2.0' || v.id !== id || !v.result || typeof v.result !== 'object' || Array.isArray(v.result)) fail('MCP_HTTP_RESPONSE');
  return v.result;
}
function decoded(buffer: Buffer): string {
  try {
    if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) fail('MCP_HTTP_RESPONSE');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch { return fail('MCP_HTTP_RESPONSE'); }
}
function sse(text: string, id: number, notify: (value: unknown) => void): unknown {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.endsWith('\n\n')) fail('MCP_HTTP_SSE');
  const events = normalized.split('\n\n');
  if (events.length > 33) fail('MCP_HTTP_SSE');
  let result: unknown, responses = 0;
  for (const event of events) {
    if (!event) continue;
    const pieces: string[] = [];
    let type = '', eventId = false;
    for (const line of event.split('\n')) {
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':'); const name = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1); if (value.startsWith(' ')) value = value.slice(1);
      if (name === 'data') pieces.push(value);
      else if (name === 'event' && !type && value === 'message') type = value;
      else if (name === 'id' && !eventId && value.length <= 256 && /^[\x21-\x7e]*$/.test(value)) eventId = true;
      else fail('MCP_HTTP_SSE');
    }
    const body = pieces.join('\n');
    if (!body) continue; // Empty priming events are not replayed or resumed.
    const parsed = envelope(parseJson(body), id, notify);
    if (++responses !== 1) fail('MCP_HTTP_SSE'); result = parsed;
  }
  if (responses !== 1) fail('MCP_HTTP_SSE');
  return result;
}

/** Internal discovery-only adapter. Calling this factory is trusted host contact authority. */
export function createMcpHttpDiscoveryFactory(value: McpHttpOptions): DiscoveryAuthorityOpen {
  const options = fields(value, ['resolveCredential'], ['nowMs', 'requestTimeoutMs', 'sessionTimeoutMs', 'loopbackTls']);
  const resolveCredential = options.resolveCredential!.value as McpHttpOptions['resolveCredential'];
  const nowMs = (options.nowMs?.value ?? Date.now) as () => number;
  const requestTimeoutMs = duration(options.requestTimeoutMs?.value, 5000), sessionTimeoutMs = duration(options.sessionTimeoutMs?.value, 10000);
  if (typeof resolveCredential !== 'function' || typeof nowMs !== 'function') fail('MCP_HTTP_INPUT');
  const loopback = options.loopbackTls ? record(data(options.loopbackTls.value), ['endpoint', 'ca']) : undefined;
  if (loopback && (typeof loopback.endpoint !== 'string' || typeof loopback.ca !== 'string' || Buffer.byteLength(loopback.ca) > 32768 || !loopback.ca.includes('-----BEGIN CERTIFICATE-----'))) fail('MCP_HTTP_INPUT');
  return async (supplied: Readonly<DiscoveryAuthorityContext>): Promise<McpDiscoveryTransport> => {
    let binding, effect, signal: AbortSignal, notify: (value: unknown) => void;
    try {
      const context = fields(supplied, ['binding', 'effect', 'operationKey', 'scope', 'signal', 'onNotification'], []);
      binding = validateMcpBinding(context.binding!.value); effect = record(data(context.effect!.value), ['kind', 'endpoint', 'authBindingRevision']);
      signal = context.signal!.value; notify = context.onNotification!.value;
      if (!(signal instanceof AbortSignal) || typeof notify !== 'function' || binding.transport.kind !== 'streamable-http'
        || effect.kind !== 'streamable-http' || effect.endpoint !== binding.transport.endpoint || effect.authBindingRevision !== mcpBindingRevision(binding)) fail('MCP_HTTP_INPUT');
    } catch { return fail('MCP_HTTP_INPUT'); }
    if (binding.transport.kind !== 'streamable-http') fail('MCP_HTTP_INPUT');
    const endpoint = new URL(binding.transport.endpoint), auth = binding.transport.auth, revision = mcpBindingRevision(binding);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) fail('MCP_HTTP_INPUT');
    if (endpoint.hostname.includes(':') || endpoint.hostname.startsWith('[')) fail('MCP_HTTP_ADDRESS');
    if (loopback && (loopback.endpoint !== endpoint.href || endpoint.hostname !== '127.0.0.1')) fail('MCP_HTTP_ADDRESS');
    if (signal.aborted) fail('MCP_HTTP_ABORTED');
    let closed = false, fault: McpConnectionError | undefined, busy = false, phase: 'new' | 'initialized' | 'ready' = 'new', count = 0, session: string | undefined;
    const agent = new https.Agent({ keepAlive: false, maxSockets: 1, maxCachedSessions: 0, proxyEnv: {} });
    const requests = new Set<ClientRequest>();
    let rejectStopped!: (reason: McpConnectionError) => void;
    const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; }); void stopped.catch(() => undefined);
    const stop = (code: string): void => {
      if (closed) return; closed = true; fault = fixed(code); rejectStopped(fault);
      for (const request of requests) request.destroy(); agent.destroy();
      clearTimeout(sessionTimer); signal.removeEventListener('abort', abort);
    };
    const abort = () => stop('MCP_HTTP_ABORTED');
    const sessionTimer = setTimeout(() => stop('MCP_HTTP_TIMEOUT'), sessionTimeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    async function bounded<T>(operation: () => Promise<T>): Promise<T> {
      if (closed) throw fault ?? fixed('MCP_HTTP_CLOSED');
      return Promise.race([Promise.resolve().then(() => {
        if (closed) throw fault ?? fixed('MCP_HTTP_CLOSED');
        return operation();
      }), stopped]);
    }
    let address: string;
    try {
      if (loopback) address = '127.0.0.1';
      else if (isIP(endpoint.hostname)) {
        if (!isMcpPublicAddress(endpoint.hostname)) fail('MCP_HTTP_ADDRESS'); address = endpoint.hostname;
      } else {
        const answers = await bounded(() => dns.lookup(endpoint.hostname, { all: true, verbatim: true }));
        if (!answers.length || answers.length > 16 || answers.some(answer => answer.family !== 4 || !isMcpPublicAddress(answer.address))) fail('MCP_HTTP_ADDRESS');
        address = answers[0]!.address;
      }
    } catch { stop('MCP_HTTP_ADDRESS'); throw fault; }
    if (closed) throw fault ?? fixed('MCP_HTTP_CLOSED');
    const secretRequest: McpHttpCredentialRequest | undefined = auth.kind === 'oauth2' ? freeze({ bindingRevision: revision, credentialRef: auth.credentialRef, issuer: auth.issuer, audience: auth.audience, scopes: [...auth.scopes] }) : undefined;
    async function authorization(): Promise<string | undefined> {
      if (!secretRequest) return undefined;
      try {
        const c = record(data(await bounded(() => resolveCredential(secretRequest))), ['token', 'bindingRevision', 'credentialRef', 'issuer', 'audience', 'scopes', 'expiresAtMs', 'revoked']);
        const current = nowMs();
        if (!Number.isSafeInteger(current) || current < 0 || typeof c.token !== 'string' || c.token.length > 8192 || !/^[A-Za-z0-9\-._~+/]+=*$/.test(c.token)
          || c.bindingRevision !== revision || c.credentialRef !== secretRequest.credentialRef || c.issuer !== secretRequest.issuer || c.audience !== secretRequest.audience
          || canonicalJson(c.scopes) !== canonicalJson(secretRequest.scopes) || c.revoked !== false || !Number.isSafeInteger(c.expiresAtMs) || (c.expiresAtMs as number) <= current) fail('MCP_HTTP_CREDENTIAL');
        return `Bearer ${c.token}`;
      } catch { return fail('MCP_HTTP_CREDENTIAL'); }
    }
    function header(response: IncomingMessage, name: string): string | undefined {
      let found: string | undefined;
      for (let i = 0; i < response.rawHeaders.length; i += 2) if (response.rawHeaders[i]!.toLowerCase() === name) {
        if (found !== undefined) fail('MCP_HTTP_HEADERS'); found = response.rawHeaders[i + 1]!;
      }
      return found;
    }
    async function post(method: string, params: unknown, id?: number): Promise<unknown> {
      const authorizationValue = await authorization();
      if (closed) throw fault ?? fixed('MCP_HTTP_CLOSED');
      const payload = JSON.stringify(id === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', id, method, params });
      return bounded(() => new Promise<unknown>((resolve, reject) => {
        const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Accept-Encoding': 'identity', 'Content-Length': String(Buffer.byteLength(payload)) };
        if (authorizationValue) headers.Authorization = authorizationValue;
        if (method !== 'initialize') headers['MCP-Protocol-Version'] = MCP_PROTOCOL_VERSION;
        if (session) headers['MCP-Session-Id'] = session;
        let request: ClientRequest;
        let done = false;
        const finish = (error?: McpConnectionError, result?: unknown) => {
          if (done) return; done = true; clearTimeout(timer); requests.delete(request);
          if (error) { request.destroy(); reject(error); } else resolve(result);
        };
        const timer = setTimeout(() => finish(fixed('MCP_HTTP_TIMEOUT')), requestTimeoutMs);
        try {
          request = https.request(endpoint, {
            method: 'POST', headers, agent, rejectUnauthorized: true, minVersion: 'TLSv1.2', maxHeaderSize: 16384,
            ...(loopback ? { ca: loopback.ca as string } : {}),
            family: 4,
            lookup: (_hostname, options, callback) => {
              if (options.all) callback(null, [{ address, family: 4 }]); else callback(null, address, 4);
            },
          }, response => {
            try {
              const encoding = header(response, 'content-encoding');
              const protocol = header(response, 'mcp-protocol-version');
              const responseSession = header(response, 'mcp-session-id');
              if (encoding && encoding !== 'identity') fail('MCP_HTTP_ENCODING');
              if (protocol !== undefined && protocol !== MCP_PROTOCOL_VERSION) fail('MCP_HTTP_PROTOCOL');
              if (responseSession !== undefined && (!/^[\x21-\x7e]{1,256}$/.test(responseSession) || (method !== 'initialize' && responseSession !== session))) fail('MCP_HTTP_SESSION');
              if (method === 'initialize' && responseSession !== undefined) session = responseSession;
              if (response.statusCode !== (id === undefined ? 202 : 200)) fail('MCP_HTTP_STATUS');
              const contentType = header(response, 'content-type');
              if (id !== undefined && (!contentType || !/^(application\/json|text\/event-stream)(?:;\s*charset=utf-8)?$/i.test(contentType))) fail('MCP_HTTP_CONTENT_TYPE');
              const length = header(response, 'content-length');
              if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_DOCUMENT_BYTES)) fail('MCP_HTTP_RESPONSE_BOUND');
              let bytes = 0; const chunks: Buffer[] = [];
              response.on('data', (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > MAX_DOCUMENT_BYTES || (id === undefined && bytes > 0)) { response.destroy(); finish(fixed('MCP_HTTP_RESPONSE_BOUND')); } else chunks.push(chunk);
              });
              response.on('error', () => finish(fixed('MCP_HTTP_NETWORK')));
              response.on('aborted', () => finish(fixed('MCP_HTTP_NETWORK')));
              response.on('end', () => {
                if (done) return;
                try {
                  if (!response.complete) fail('MCP_HTTP_NETWORK');
                  if (id === undefined) { finish(); return; }
                  const body = decoded(Buffer.concat(chunks));
                  const result = contentType!.toLowerCase().startsWith('application/json') ? envelope(parseJson(body), id, notify) : sse(body, id, notify);
                  finish(undefined, result);
                } catch { finish(fixed('MCP_HTTP_RESPONSE')); }
              });
            } catch { response.destroy(); finish(fixed('MCP_HTTP_RESPONSE')); }
          });
          requests.add(request); request.maxHeadersCount = 64;
          request.on('error', () => finish(fixed('MCP_HTTP_NETWORK')));
          request.on('upgrade', (_response, socket) => { socket.destroy(); finish(fixed('MCP_HTTP_STATUS')); });
          request.end(payload);
        } catch { clearTimeout(timer); reject(fixed('MCP_HTTP_NETWORK')); }
      }));
    }
    async function run(method: 'initialize' | 'notifications/initialized' | 'tools/list', suppliedParams?: unknown): Promise<unknown> {
      try {
        if (closed) throw fault ?? fixed('MCP_HTTP_CLOSED');
        if (busy || count >= 10 || (method === 'initialize' ? phase !== 'new' : method === 'notifications/initialized' ? phase !== 'initialized' : phase !== 'ready')) fail('MCP_HTTP_ORDER');
        busy = true; count++;
        const params = data(suppliedParams ?? {});
        if (method === 'initialize') {
          if (canonicalJson(params) !== canonicalJson({ protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'bowerloom-discovery', version: '0.7.0-beta.2' } })) fail('MCP_HTTP_INPUT');
        } else if (method === 'tools/list') {
          if (!params || typeof params !== 'object' || Array.isArray(params) || Object.keys(params).some(key => key !== 'cursor')) fail('MCP_HTTP_INPUT');
          const cursor = (params as Record<string, unknown>).cursor;
          if (cursor !== undefined && (typeof cursor !== 'string' || !cursor || Buffer.byteLength(cursor) > 256 || /[\p{Cc}\p{Cf}]/u.test(cursor))) fail('MCP_HTTP_INPUT');
        }
        const result = await post(method, params, method === 'notifications/initialized' ? undefined : count);
        if (method === 'initialize') phase = 'initialized'; else if (method === 'notifications/initialized') phase = 'ready';
        return result;
      } catch { stop('MCP_HTTP_SESSION_FAILED'); throw fixed('MCP_HTTP_SESSION_FAILED'); }
      finally { busy = false; }
    }
    return Object.freeze({
      initialize: (params: Readonly<McpInitializeRequest>) => run('initialize', params),
      initialized: async () => { await run('notifications/initialized'); },
      listTools: (params: Readonly<{ cursor?: string }>) => run('tools/list', params),
      close: async () => { stop('MCP_HTTP_CLOSED'); },
    });
  };
}
