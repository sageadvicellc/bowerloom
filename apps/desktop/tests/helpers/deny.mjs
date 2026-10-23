// Preload for the child process: every way to start a process, open a connection, or listen records a hit and throws.
import childProcess from 'node:child_process';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { appendFileSync } from 'node:fs';

const log = process.env.DENY_LOG;
const hit = name => { appendFileSync(log, `${name}\n`); throw new Error(`denied: ${name}`); };
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = () => hit(`child_process.${name}`);
for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6']) dns[name] = () => hit(`dns.${name}`);
http.request = http.get = () => hit('http.request'); https.request = https.get = () => hit('https.request');
net.Socket.prototype.connect = () => hit('net.connect'); net.connect = net.createConnection = () => hit('net.connect');
net.Server.prototype.listen = () => hit('net.listen'); tls.connect = () => hit('tls.connect');
globalThis.fetch = () => hit('fetch'); globalThis.WebSocket = class { constructor() { hit('WebSocket'); } };
