// A network stand-in for CLI tests, preloaded into a child process with `node --import <this file> main.js ...`.
// Not a test file, and not part of the product: the packed CLI holds only apps/*/src and packages/*/src.
//
// The test writes a JSON plan and passes its path in TEST_FAKE_NETWORK_PLAN:
//   { "log": "<absolute file>", "routes": { "<url>": "<absolute fixture file>" } }
// Every dns.lookup (except the callback lookup of the literal 127.0.0.1), https.request, https.get, http.request and http.get call is appended to the log as one JSON line.
// With no routes, each call throws. With routes, dns.lookup answers one public address and https.request serves the
// fixture bytes for an exact URL, or a 404 for any other.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';

// Spec 06: a route value can also be { "status": <n>, "headers": { "<name>": "<value>" }, "file": <path or null> }.
// Each https.request line of the log says whether an Authorization header was set, never its value. The header counts
// whether it came in the request options or through request.setHeader (spec 07 sets it there, review H1 of PR 97).
// The line is written when the request ends, after any setHeader call.
// This stub replaces https.request, so Node's own https and http code never runs here, and NODE_DEBUG prints none of
// its lines. tests/token-debug.test.ts runs the real transport for that.
type Route = string | { status: number; headers?: Record<string, string>; file: string | null };
// Round 3 of the reviews of PR 101: `address` replaces the public address every lookup answers, to test a name that
// resolves to an address that is not public.
interface Plan { log: string; routes?: Record<string, Route>; address?: string; lookupThrows?: string }
const planPath = process.env.TEST_FAKE_NETWORK_PLAN;
if (!planPath) throw new Error('fake-network: TEST_FAKE_NETWORK_PLAN is not set');
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')) as Plan;
const routes = plan.routes ?? null;
const record = (name: string, target: unknown, extra: Record<string, unknown> = {}): void => { fs.appendFileSync(plan.log, `${JSON.stringify({ name, target: String(target), ...extra })}\n`); };
const deny = (name: string) => (...args: unknown[]): never => { record(name, args[0]); throw new Error('TEST_NETWORK_DENIED'); };

type Callback = (response: EventEmitter) => void;
function serve(url: unknown, options: unknown, callback: Callback): EventEmitter {
  const headers = (options as { headers?: Record<string, unknown> } | null)?.headers ?? {};
  const names = new Set(Object.keys(headers).map(h => h.toLowerCase()));
  const req = Object.assign(new EventEmitter(), { destroyed: false, destroy() { req.destroyed = true; return req; }, setHeader(name: string) { names.add(String(name).toLowerCase()); }, end() {
    record('https.request', url, { authorization: names.has('authorization') });
    queueMicrotask(() => {
      if (req.destroyed) return;
      const route = routes![String(url)];
      const spec = route === undefined ? { status: 404, headers: {}, file: null } : typeof route === 'string' ? { status: 200, headers: {}, file: route } : { status: route.status, headers: route.headers ?? {}, file: route.file };
      const body = spec.file === null ? Buffer.from('{"message":"Not Found"}') : fs.readFileSync(spec.file);
      const extra = Object.entries(spec.headers);
      const res = Object.assign(new EventEmitter(), { destroyed: false, destroy() { res.destroyed = true; return res; }, statusCode: spec.status, complete: true, rawHeaders: ['Content-Length', String(body.length), ...extra.flat()], headers: Object.fromEntries([['content-length', String(body.length)], ...extra.map(([k, v]) => [k.toLowerCase(), v])]) });
      callback(res);
      if (!res.destroyed) res.emit('data', body);
      if (!res.destroyed) res.emit('end');
    });
    return req;
  } });
  return req;
}

if (routes === null) {
  (dnsPromises as { lookup: unknown }).lookup = deny('dns.promises.lookup');
  (https as { request: unknown }).request = deny('https.request');
} else {
  // Round 4: `lookupThrows` names a built-in error class that every lookup throws, for an error with no Bowerloom code.
  (dnsPromises as { lookup: unknown }).lookup = async (host: string) => { record('dns.promises.lookup', host); if (plan.lookupThrows === 'TypeError') throw new TypeError('fake-network: a lookup that throws'); return [{ address: plan.address ?? '104.16.25.34', family: 4 }]; };
  (https as { request: unknown }).request = serve;
}
// The project lock listens on the literal 127.0.0.1, and net.Server.listen passes even a literal through dns.lookup.
// That one literal goes to the real lookup, which answers it without any resolver. Every other name is denied.
const realLookup = dns.lookup, deniedLookup = deny('dns.lookup');
(dns as { lookup: unknown }).lookup = (host: string, ...rest: unknown[]) => host === '127.0.0.1' ? (realLookup as (...a: unknown[]) => unknown)(host, ...rest) : deniedLookup(host, ...rest);
(https as { get: unknown }).get = deny('https.get');
(http as { request: unknown }).request = deny('http.request');
(http as { get: unknown }).get = deny('http.get');
syncBuiltinESMExports();
