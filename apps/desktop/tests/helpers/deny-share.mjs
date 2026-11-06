// The preload of tests/helpers/deny.mjs, for a run that takes the project lock: the same denials, except that the lock may listen on and connect to the loopback address
// 127.0.0.1 (packages/project-context). Every other listen, connect, lookup, request, process start or fetch records a hit and throws. A worker thread inherits this preload.
import childProcess from 'node:child_process';
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import { appendFileSync } from 'node:fs';

const log = process.env.DENY_LOG;
const loopback = host => host === '127.0.0.1';
const hit = name => { appendFileSync(log, `${name}\n`); throw new Error(`denied: ${name}`); };
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = () => hit(`child_process.${name}`);
for (const name of ['lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveTxt', 'reverse']) dns[name] = () => hit(`dns.${name}`);
// `listen({ host: '127.0.0.1' })` asks dns.lookup about an address that is already a number: no name is looked up, so that one call goes on.
const lookup = dns.lookup;
dns.lookup = (host, ...rest) => (loopback(host) ? lookup(host, ...rest) : hit('dns.lookup'));
for (const name of ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveTxt', 'reverse']) dns.promises[name] = () => hit(`dns.promises.${name}`);
http.request = http.get = () => hit('http.request'); https.request = https.get = () => hit('https.request');
http2.connect = () => hit('http2.connect'); http2.createServer = http2.createSecureServer = () => hit('http2.server');
http.createServer = https.createServer = () => hit('http.createServer');
dgram.createSocket = () => hit('dgram.createSocket');
const connect = net.connect;
net.connect = net.createConnection = (...args) => (loopback(args[0]?.host) ? connect(...args) : hit('net.connect'));
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) { return loopback(args[0]?.host) ? listen.apply(this, args) : hit('net.listen'); };
tls.connect = () => hit('tls.connect');
globalThis.fetch = () => hit('fetch'); globalThis.WebSocket = class { constructor() { hit('WebSocket'); } };
syncBuiltinESMExports();
