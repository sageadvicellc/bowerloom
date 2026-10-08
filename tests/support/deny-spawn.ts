// A preload for CLI tests: `node --import <this file> main.js ...`. Not a test file, and not part of the product.
// Every way to start a process or a thread, and every network call that is not to the loopback address, is appended to
// the file in DENY_SPAWN_LOG as one line and throws (review M6 finding 2, after the reviewer's probe P0):
// the 7 child_process functions, ChildProcess.prototype.spawn, process.execve, worker_threads.Worker, cluster.fork,
// net.connect and net.createConnection, tls.connect, http and https request and get, dns lookups, and fetch.
import childProcess from 'node:child_process';
import cluster from 'node:cluster';
import dns from 'node:dns';
import { appendFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import workerThreads from 'node:worker_threads';

const log = process.env.DENY_SPAWN_LOG;
if (!log) throw new Error('deny-spawn: DENY_SPAWN_LOG is not set');
const deny = (name: string) => function denied(...args: unknown[]): never { appendFileSync(log, `${name} ${String(args[0]).slice(0, 120)}\n`); throw new Error(`TEST_DENIED ${name}`); };
const set = (target: object, name: string, value: unknown): void => { Object.defineProperty(target, name, { value, writable: true, configurable: true }); };

for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) set(childProcess, name, deny(`child_process.${name}`));
set(childProcess.ChildProcess.prototype, 'spawn', deny('ChildProcess.prototype.spawn'));
set(process, 'execve', deny('process.execve'));
set(workerThreads, 'Worker', class DeniedWorker { constructor(file: unknown) { deny('worker_threads.Worker')(file); } });
set(cluster, 'fork', deny('cluster.fork'));
const loopback = (host: unknown): boolean => host === '127.0.0.1' || host === '::1' || host === 'localhost';
const guarded = (name: string, real: (...args: unknown[]) => unknown) => function connect(this: unknown, ...args: unknown[]): unknown {
  const first = args[0], host = typeof first === 'object' && first !== null ? (first as { host?: unknown; path?: unknown }).path !== undefined ? 'localhost' : (first as { host?: unknown }).host ?? 'localhost' : typeof args[1] === 'string' ? args[1] : 'localhost';
  return loopback(host) ? real.apply(this, args) : deny(name)(JSON.stringify(first));
};
set(net, 'connect', guarded('net.connect', net.connect as never)); set(net, 'createConnection', guarded('net.createConnection', net.createConnection as never));
set(tls, 'connect', deny('tls.connect'));
for (const [mod, name] of [[http, 'http'], [https, 'https']] as const) { set(mod, 'request', deny(`${name}.request`)); set(mod, 'get', deny(`${name}.get`)); }
const realLookup = dns.lookup;
set(dns, 'lookup', (host: string, ...rest: unknown[]) => loopback(host) ? (realLookup as (...a: unknown[]) => unknown)(host, ...rest) : deny('dns.lookup')(host));
set(dns.promises, 'lookup', deny('dns.promises.lookup'));
set(globalThis, 'fetch', deny('fetch'));
syncBuiltinESMExports();
