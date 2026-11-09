// A runtime spy for "no port": while it is installed, every route that opens a listening socket, an outgoing connection, a datagram socket or a name lookup throws and
// is recorded. The list of routes is the one of the repository's own deny list (tests/helpers/deny.mjs) without the routes that start a program, because a program is not
// a port. The test that installs the spy checks `hits` is empty at the end, so code that catches the error and goes on is still caught.
//
// The routes are patched on the export objects of the modules. A named import (`import { createServer } from 'node:http'`) reads a live binding that only
// `syncBuiltinESMExports()` updates, so the spy calls it after it patches and after it restores. NAMED_IMPORT_ROUTES holds named imports and the self-tests use them.
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import { createServer as namedHttpCreateServer, get as namedHttpGet, request as namedHttpRequest } from 'node:http';
import http2 from 'node:http2';
import { connect as namedHttp2Connect } from 'node:http2';
import https from 'node:https';
import { createServer as namedHttpsCreateServer } from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import { connect as namedNetConnect, createConnection as namedNetCreateConnection, createServer as namedNetCreateServer } from 'node:net';
import { createSocket as namedDgramCreateSocket } from 'node:dgram';
import { lookup as namedDnsLookup } from 'node:dns';
import tls from 'node:tls';
import { connect as namedTlsConnect } from 'node:tls';

export interface PortSpy { readonly hits: string[]; restore(): void }

interface Target { readonly label: string; readonly holder: object; readonly key: string }

const DNS_NAMES = ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveTxt', 'reverse'] as const;

/** Every route the spy wraps, with the label a hit records. */
function targets(): Target[] {
  const out: Target[] = [
    { label: 'net.Server.prototype.listen', holder: net.Server.prototype, key: 'listen' },
    { label: 'net.Socket.prototype.connect', holder: net.Socket.prototype, key: 'connect' },
    { label: 'net.connect', holder: net, key: 'connect' },
    { label: 'net.createConnection', holder: net, key: 'createConnection' },
    { label: 'net.createServer', holder: net, key: 'createServer' },
    { label: 'tls.connect', holder: tls, key: 'connect' },
    { label: 'http.createServer', holder: http, key: 'createServer' },
    { label: 'http.request', holder: http, key: 'request' },
    { label: 'http.get', holder: http, key: 'get' },
    { label: 'https.createServer', holder: https, key: 'createServer' },
    { label: 'https.request', holder: https, key: 'request' },
    { label: 'https.get', holder: https, key: 'get' },
    { label: 'http2.connect', holder: http2, key: 'connect' },
    { label: 'http2.createServer', holder: http2, key: 'createServer' },
    { label: 'http2.createSecureServer', holder: http2, key: 'createSecureServer' },
    { label: 'dgram.createSocket', holder: dgram, key: 'createSocket' },
    { label: 'dgram.Socket.prototype.bind', holder: dgram.Socket.prototype, key: 'bind' },
    { label: 'dgram.Socket.prototype.send', holder: dgram.Socket.prototype, key: 'send' },
    { label: 'dgram.Socket.prototype.connect', holder: dgram.Socket.prototype, key: 'connect' },
    { label: 'fetch', holder: globalThis, key: 'fetch' },
    { label: 'WebSocket', holder: globalThis, key: 'WebSocket' },
  ];
  for (const name of DNS_NAMES) {
    out.push({ label: `dns.${name}`, holder: dns, key: name });
    out.push({ label: `dns.promises.${name}`, holder: dns.promises, key: name });
  }
  return out;
}

/** The labels of every wrapped route, in a fixed order. A self-test names each one. */
export const SPIED_LABELS: readonly string[] = Object.freeze(targets().map(t => t.label));

/**
 * Wraps every route in SPIED_LABELS. The wrappers throw and never reach the real function, so a call opens nothing even in the test that proves the spy fires. Every target is
 * checked before the first one is patched, so a route that is missing never leaves the others wrapped.
 */
export function installPortSpy(): PortSpy {
  const hits: string[] = [];
  const found = targets().map(t => {
    const descriptor = Object.getOwnPropertyDescriptor(t.holder, t.key);
    const original = descriptor === undefined ? undefined : 'value' in descriptor ? descriptor.value : descriptor.get?.call(t.holder);
    if (descriptor === undefined || typeof original !== 'function') throw new Error(`the spy cannot find ${t.label}`);
    return { ...t, descriptor };
  });
  const restores: (() => void)[] = [];
  for (const t of found) {
    const spied = function spied(): never { hits.push(t.label); throw new Error(`NO_PORT: ${t.label} was called`); };
    Object.defineProperty(t.holder, t.key, { value: spied, writable: true, configurable: true, enumerable: t.descriptor.enumerable ?? false });
    restores.push(() => { Object.defineProperty(t.holder, t.key, t.descriptor); });
  }
  syncBuiltinESMExports();
  let restored = false;
  return {
    hits,
    restore(): void {
      if (restored) return;
      restored = true;
      for (const undo of restores.reverse()) undo();
      syncBuiltinESMExports();
    },
  };
}

/** Routes that reach a port through a NAMED import, so the self-tests can show the spy sees them. Each key is the label the route records. */
export const NAMED_IMPORT_ROUTES: Readonly<Record<string, () => unknown>> = Object.freeze({
  'http.createServer': () => namedHttpCreateServer(),
  'http.request': () => namedHttpRequest('http://localhost:9/'),
  'http.get': () => namedHttpGet('http://localhost:9/'),
  'https.createServer': () => namedHttpsCreateServer(),
  'http2.connect': () => namedHttp2Connect('http://localhost:9'),
  'net.connect': () => namedNetConnect(9),
  'net.createConnection': () => namedNetCreateConnection(9),
  'net.createServer': () => namedNetCreateServer(),
  'tls.connect': () => namedTlsConnect(9),
  'dgram.createSocket': () => namedDgramCreateSocket('udp4'),
  'dns.lookup': () => namedDnsLookup('localhost', () => undefined),
});

/** What each named import is bound to right now. Read it while the spy is installed and after it is restored to see the binding follow. */
export function namedBindings(): Readonly<Record<string, unknown>> {
  return {
    httpCreateServer: namedHttpCreateServer, httpRequest: namedHttpRequest, httpGet: namedHttpGet, httpsCreateServer: namedHttpsCreateServer, http2Connect: namedHttp2Connect,
    netConnect: namedNetConnect, netCreateConnection: namedNetCreateConnection, netCreateServer: namedNetCreateServer, tlsConnect: namedTlsConnect, dgramCreateSocket: namedDgramCreateSocket,
    dnsLookup: namedDnsLookup,
  };
}
