/**
 * The one network read of `skills add`: bounded public GETs to registry.npmjs.org and api.github.com.
 *
 * Why a second transport: the guarded GET in skill-sources (npm.ts and git.ts) is a closure inside acquireNpmSkill and
 * acquireGitSkill. It runs only for an approved acquisition plan, with an open cache operation. That plan already
 * needs the metadata sha256, the integrity and every file hash, which are exactly what `skills add` has to find out.
 * So `skills add` cannot fetch through it. Extracting it would change both reviewed acquisition modules.
 *
 * This transport carries every gate of that GET, and shares the code that it can:
 * - Hosts: registry.npmjs.org and api.github.com only, over https on the default port, with no user information,
 *   fragment or query (except GitHub's `?recursive=1`), and a URL that is already in canonical form.
 * - Addresses: one dns.lookup per host, all answers IPv4 and public (the same table as npm.ts and git.ts), at most 16;
 *   the request connects only to the first answer, through a pinned lookup.
 * - TLS: certificate checks on, TLS 1.2 or later. No proxy (proxyEnv is empty), no keep-alive, no session reuse,
 *   no Authorization or cookie header, no credentials from the environment.
 * - Response: status 200 only, so a 3xx is never followed; the D11 header gate from skill-sources/response-headers.ts
 *   (a repeated guarded header, more than 128 header pairs, or framing other than chunked refuses); no Location; no
 *   content encoding but identity; a declared and an actual length within the caller's bound; a complete body.
 * - Bounds: at most 16 KiB of headers, the caller's bound per body (at most 8 MiB), 16 MiB in all, 140 requests,
 *   10 seconds per request and 30 seconds per transport, and the caller's abort signal.
 * Every refusal is a fixed code with a fixed message. No header value, body, address or URL is ever reported.
 */
import https from 'node:https';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { guardedResponseHeaders } from '../../skill-sources/src/response-headers.js';
import { isManifestRefusal, manifestRefusal, requireManifest } from './refusal.js';
import type { ManifestRefusalCode } from './refusal.js';

export const PUBLIC_HOSTS: readonly string[] = Object.freeze(['registry.npmjs.org', 'api.github.com']);
export const PUBLIC_GET_LIMITS = Object.freeze({ requests: 140, durationMs: 30000, requestMs: 10000, headerBytes: 16384, responseBytes: 8388608, totalBytes: 16777216, addresses: 16 });
export interface PublicTransport { get(url: string, maxBytes: number, signal: AbortSignal): Promise<Buffer> }
export interface PublicGetOptions { requests?: number; durationMs?: number; requestMs?: number }

const URL_SHAPE = /^https:\/\/(registry\.npmjs\.org|api\.github\.com)\/[A-Za-z0-9._~@%/-]+(\?recursive=1)?$/;
/** The public IPv4 test of skill-sources npm.ts and git.ts, the same table line for line. */
export function publicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number) as [number, number, number];
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 100 && b >= 64 && b <= 127 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 88 && c === 99) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}
/** The host of an allowed URL, or a refusal. */
export function allowedHost(url: unknown): string {
  requireManifest(typeof url === 'string' && url.length <= 2048, 'SKILLS_ADD_HOST_REFUSED');
  const match = URL_SHAPE.exec(url); requireManifest(match, 'SKILLS_ADD_HOST_REFUSED');
  let parsed: URL; try { parsed = new URL(url); } catch { throw manifestRefusal('SKILLS_ADD_HOST_REFUSED'); }
  requireManifest(parsed.href === url && parsed.protocol === 'https:' && parsed.port === '' && parsed.username === '' && parsed.password === '' && parsed.hostname === match[1] && PUBLIC_HOSTS.includes(parsed.hostname), 'SKILLS_ADD_HOST_REFUSED');
  requireManifest(match[2] === undefined || parsed.hostname === 'api.github.com', 'SKILLS_ADD_HOST_REFUSED');
  return parsed.hostname;
}
const bounded = (value: unknown, max: number): value is number => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= max;

/** A transport for one `skills add`. Call close() when done. */
export function createPublicTransport(options: PublicGetOptions = {}): PublicTransport & { close(): void } {
  requireManifest(options !== null && typeof options === 'object' && Object.keys(options).every(k => ['requests', 'durationMs', 'requestMs'].includes(k)), 'SKILLS_ADD_NETWORK');
  const limit = { requests: options.requests ?? PUBLIC_GET_LIMITS.requests, durationMs: options.durationMs ?? PUBLIC_GET_LIMITS.durationMs, requestMs: options.requestMs ?? PUBLIC_GET_LIMITS.requestMs };
  requireManifest(bounded(limit.requests, PUBLIC_GET_LIMITS.requests) && bounded(limit.durationMs, PUBLIC_GET_LIMITS.durationMs) && bounded(limit.requestMs, PUBLIC_GET_LIMITS.requestMs), 'SKILLS_ADD_NETWORK');
  const agent = new https.Agent({ keepAlive: false, maxSockets: 1, maxCachedSessions: 0, proxyEnv: {} } as https.AgentOptions);
  const deadline = performance.now() + limit.durationMs, addresses = new Map<string, Promise<string>>();
  const live = new Set<() => void>();
  let closed = false, count = 0, total = 0;
  const timer = setTimeout(() => close(), limit.durationMs); timer.unref();
  function close(): void { if (closed) return; closed = true; clearTimeout(timer); for (const stop of [...live]) stop(); agent.destroy(); }
  const usable = (signal: AbortSignal) => { requireManifest(!closed && !signal.aborted && performance.now() < deadline, 'SKILLS_ADD_NETWORK'); };

  async function lookup(host: string): Promise<string> {
    let answers: { address: string; family: number }[];
    try { answers = await dns.lookup(host, { all: true, verbatim: true }); } catch { throw manifestRefusal('SKILLS_ADD_NETWORK'); }
    requireManifest(Array.isArray(answers) && answers.length > 0 && answers.length <= PUBLIC_GET_LIMITS.addresses, 'SKILLS_ADD_NETWORK');
    // An IPv6 or private answer can be a rebinding attempt. It refuses before any connection.
    requireManifest(answers.every(a => a !== null && typeof a === 'object' && a.family === 4 && typeof a.address === 'string' && publicIPv4(a.address)), 'SKILLS_ADD_HOST_REFUSED');
    return answers[0]!.address;
  }
  function headersFor(host: string, url: string): Record<string, string> {
    const common = { 'Accept-Encoding': 'identity', 'User-Agent': 'bowerloom-skills-add/1' };
    if (host === 'api.github.com') return { Accept: 'application/vnd.github+json', ...common, 'X-GitHub-Api-Version': '2026-03-10' };
    return { Accept: url.endsWith('.tgz') ? 'application/octet-stream' : 'application/json', ...common };
  }

  async function get(url: string, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
    const host = allowedHost(url);
    requireManifest(bounded(maxBytes, PUBLIC_GET_LIMITS.responseBytes), 'SKILLS_ADD_UNSAFE_CONTENT');
    requireManifest(signal instanceof AbortSignal, 'SKILLS_ADD_NETWORK');
    usable(signal);
    requireManifest(++count <= limit.requests, 'SKILLS_ADD_UNSAFE_CONTENT');
    if (!addresses.has(host)) { const pending = lookup(host); pending.catch(() => {}); addresses.set(host, pending); }
    const address = await addresses.get(host)!;
    usable(signal);
    return new Promise<Buffer>((resolve, reject) => {
      let done = false, request: ClientRequest | undefined, response: IncomingMessage | undefined, bytes = 0;
      const chunks: Buffer[] = [], requestDeadline = performance.now() + limit.requestMs;
      const settle = (failure?: ManifestRefusalCode | Error) => {
        if (done) return; done = true; clearTimeout(timeout); live.delete(stop); signal.removeEventListener('abort', stop);
        request?.destroy(); response?.destroy();
        if (failure === undefined) resolve(Buffer.concat(chunks, bytes));
        else reject(typeof failure === 'string' ? manifestRefusal(failure) : isManifestRefusal(failure) ? failure : manifestRefusal('SKILLS_ADD_NETWORK'));
      };
      const stop = () => settle('SKILLS_ADD_NETWORK');
      const timeout = setTimeout(stop, limit.requestMs); timeout.unref();
      live.add(stop); signal.addEventListener('abort', stop, { once: true });
      const guard = () => { usable(signal); requireManifest(performance.now() < requestDeadline, 'SKILLS_ADD_NETWORK'); };
      try {
        request = https.request(url, {
          method: 'GET', agent, rejectUnauthorized: true, minVersion: 'TLSv1.2', maxHeaderSize: PUBLIC_GET_LIMITS.headerBytes, headers: headersFor(host, url),
          lookup: (_host, lookupOptions, callback) => {
            try { guard(); if (lookupOptions.all) callback(null, [{ address, family: 4 }]); else callback(null, address, 4); }
            catch (error) { settle(error as Error); callback(new Error('SKILLS_ADD_NETWORK'), '', 4); }
          },
        }, incoming => {
          if (done) { incoming.destroy(); return; }
          response = incoming;
          try {
            guard();
            const headers = guardedResponseHeaders(incoming.rawHeaders); requireManifest(headers !== null, 'SKILLS_ADD_NETWORK');
            if (incoming.statusCode === 404 || incoming.statusCode === 410 || incoming.statusCode === 422 && host === 'api.github.com') { settle('SKILLS_ADD_NOT_FOUND'); return; }
            const length = headers.get('content-length');
            requireManifest(incoming.statusCode === 200 && !headers.has('location') && (!headers.has('content-encoding') || headers.get('content-encoding') === 'identity') && (length === undefined || /^(0|[1-9]\d*)$/.test(length)), 'SKILLS_ADD_NETWORK');
            requireManifest(length === undefined || Number(length) <= maxBytes, 'SKILLS_ADD_UNSAFE_CONTENT');
            incoming.on('data', (chunk: Buffer) => {
              try { guard(); requireManifest(Buffer.isBuffer(chunk) && (bytes += chunk.length) <= maxBytes && (total += chunk.length) <= PUBLIC_GET_LIMITS.totalBytes, 'SKILLS_ADD_UNSAFE_CONTENT'); chunks.push(chunk); }
              catch (error) { settle(error as Error); }
            });
            incoming.on('end', () => { try { guard(); requireManifest(incoming.complete && (length === undefined || bytes === Number(length)), 'SKILLS_ADD_NETWORK'); settle(); } catch (error) { settle(error as Error); } });
            incoming.on('error', stop); incoming.on('aborted', stop); incoming.on('close', () => { if (!done) stop(); });
          } catch (error) { settle(error as Error); }
        });
        request.on('error', stop); request.on('close', () => { if (!done) stop(); });
        guard(); request.end();
      } catch (error) { settle(error as Error); }
    });
  }
  return { get, close };
}
