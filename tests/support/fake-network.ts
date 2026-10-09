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

interface Plan { log: string; routes?: Record<string, string> }
const planPath = process.env.TEST_FAKE_NETWORK_PLAN;
if (!planPath) throw new Error('fake-network: TEST_FAKE_NETWORK_PLAN is not set');
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')) as Plan;
const routes = plan.routes ?? null;
const record = (name: string, target: unknown): void => { fs.appendFileSync(plan.log, `${JSON.stringify({ name, target: String(target) })}\n`); };
const deny = (name: string) => (...args: unknown[]): never => { record(name, args[0]); throw new Error('TEST_NETWORK_DENIED'); };

type Callback = (response: EventEmitter) => void;
function serve(url: unknown, _options: unknown, callback: Callback): EventEmitter {
  record('https.request', url);
  const req = Object.assign(new EventEmitter(), { destroyed: false, destroy() { req.destroyed = true; return req; }, end() {
    queueMicrotask(() => {
      if (req.destroyed) return;
      const file = routes![String(url)];
      const body = file === undefined ? Buffer.from('{"message":"Not Found"}') : fs.readFileSync(file);
      const res = Object.assign(new EventEmitter(), { destroyed: false, destroy() { res.destroyed = true; return res; }, statusCode: file === undefined ? 404 : 200, complete: true, rawHeaders: ['Content-Length', String(body.length)] });
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
  (dnsPromises as { lookup: unknown }).lookup = async (host: string) => { record('dns.promises.lookup', host); return [{ address: '104.16.25.34', family: 4 }]; };
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
