/**
 * The one place in the package that opens a connection. It makes a GET to 127.0.0.1 and a port, with a total time limit, a size limit by path, and no redirect followed.
 * The agent is built here with no proxy option, so HTTP_PROXY, HTTPS_PROXY, ALL_PROXY and NODE_USE_ENV_PROXY never apply to a probe.
 * The host is the constant of the guard, so no setting and no provider can name another one. A path is checked against a short list of safe characters first.
 */
import { Agent, request } from 'node:http';
import { LOOPBACK_HOST, parsePort } from './guard.js';
import type { BoundGet, GetResult } from './provider.js';

/** The time limit for one GET, start to end of the body. A server that sends a byte at a time is cut off at this limit too. */
export const DEFAULT_TIMEOUT_MS = 800;

const KIB = 1024;
/** The largest body read, by path. A path not listed here is read up to DEFAULT_CAP. */
const CAPS: Readonly<Record<string, number>> = Object.freeze({
  '/health': 16 * KIB, '/props': 1024 * KIB, '/slots': 1024 * KIB, '/metrics': 256 * KIB, '/v1/models': 2048 * KIB,
});
export const DEFAULT_CAP = 64 * KIB;

/** The size limit of a path, in bytes. */
export function capFor(path: string): number {
  return Object.hasOwn(CAPS, path) ? (CAPS[path] as number) : DEFAULT_CAP;
}

/** A path is a slash, then letters, digits and . _ ~ - /. No query, no space, no host, no `..`, no empty segment. */
const SAFE_PATH = /^\/[A-Za-z0-9._~/-]{0,200}$/;
const isSafePath = (path: unknown): path is string => typeof path === 'string' && SAFE_PATH.test(path) && !path.includes('//') && !path.split('/').includes('..');

export interface GetOptions {
  /** Test use: a shorter total time limit. */
  readonly timeoutMs?: number;
}

/** A `get` bound to 127.0.0.1 and one port. A bad port or a bad path answers a failure at once and opens no connection. It never rejects. */
export function createGet(port: number, options: GetOptions = {}): BoundGet {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return (path: string): Promise<GetResult> => new Promise<GetResult>(resolve => {
    if (parsePort(port) === null) { resolve({ ok: false, code: 'BAD_PORT' }); return; }
    if (!isSafePath(path)) { resolve({ ok: false, code: 'BAD_PATH' }); return; }
    const cap = capFor(path);
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    const finish = (result: GetResult, stop?: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
      stop?.();
    };
    const req = request({ host: LOOPBACK_HOST, port, path, method: 'GET', agent: new Agent({ keepAlive: false }), headers: { accept: 'application/json, text/plain' } }, res => {
      const status = res.statusCode ?? 0;
      const stop = (): void => { req.destroy(); };
      if (status >= 300 && status < 400) { finish({ ok: false, code: 'REDIRECT' }, stop); return; }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > cap) { finish({ ok: false, code: 'TOO_LARGE' }, stop); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > cap) { finish({ ok: false, code: 'TOO_LARGE' }, stop); return; }
        chunks.push(chunk);
      });
      res.on('end', () => { finish({ ok: true, status, body: Buffer.concat(chunks).toString('utf8') }); });
      res.on('error', () => { finish({ ok: false, code: 'CONNECTION_FAILED' }); });
      res.on('close', () => { finish({ ok: false, code: 'CONNECTION_FAILED' }); });
    });
    req.on('error', (error: NodeJS.ErrnoException) => {
      finish({ ok: false, code: error.code === 'ECONNREFUSED' ? 'CONNECTION_REFUSED' : 'CONNECTION_FAILED' });
    });
    timer = setTimeout(() => { finish({ ok: false, code: 'TIMEOUT' }, () => { req.destroy(); }); }, timeoutMs);
    req.end();
  });
}
