// Preload for the child process: every way to start a process, open a connection, listen, or look up a name records a hit and throws.
// The patches are made on the modules' export objects, then syncBuiltinESMExports() copies them to the live bindings, so that a
// NAMED import (`import { spawn } from 'node:child_process'`) is denied as well as a default import or a require.
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
const hit = name => { appendFileSync(log, `${name}\n`); throw new Error(`denied: ${name}`); };
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = () => hit(`child_process.${name}`);
for (const name of ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveTxt', 'reverse']) dns[name] = () => hit(`dns.${name}`);
for (const name of ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveTxt', 'reverse']) dns.promises[name] = () => hit(`dns.promises.${name}`);
http.request = http.get = () => hit('http.request'); https.request = https.get = () => hit('https.request');
http2.connect = () => hit('http2.connect'); http2.createServer = http2.createSecureServer = () => hit('http2.server');
http.createServer = https.createServer = () => hit('http.createServer');
dgram.createSocket = () => hit('dgram.createSocket');
net.Socket.prototype.connect = () => hit('net.connect'); net.connect = net.createConnection = () => hit('net.connect');
net.Server.prototype.listen = () => hit('net.listen'); net.createServer = () => hit('net.createServer'); tls.connect = () => hit('tls.connect');
globalThis.fetch = () => hit('fetch'); globalThis.WebSocket = class { constructor() { hit('WebSocket'); } };
syncBuiltinESMExports();
