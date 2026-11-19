// The Node core as the Tauri sidecar. The channel is its own stdin and stdout: one JSON message per line each way. Only the shell holds the other end of the pipe,
// and no port is opened.
//
// The watchdog: a worker thread reads stdin (the main thread does not touch it) and polls the parent process id. When stdin ends, or the parent process id changes
// (the shell is gone), it tells the main thread to exit. If the main thread is stuck and has not exited after a grace period, the worker ends the whole process with SIGKILL.
// A worker has its own event loop, so a busy loop in the main thread does not stop it. Node only, no package.
import { Worker } from 'node:worker_threads';
import { createCore } from './core.js';

/** How long the main thread has to exit by itself before the watchdog kills the process, and how often the parent process id is read. */
const GRACE_MS = 1000;
const POLL_MS = 250;

const WATCHDOG = `
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
let ending = false;
const end = why => {
  if (ending) return;
  ending = true;
  parentPort.postMessage({ type: why });
  setTimeout(() => process.kill(workerData.pid, 'SIGKILL'), workerData.graceMs);
};
setInterval(() => { if (process.ppid !== workerData.ppid) end('parent-changed'); }, workerData.pollMs);
const input = fs.createReadStream(null, { fd: 0, autoClose: false });
input.on('data', chunk => parentPort.postMessage({ type: 'data', chunk }));
input.on('end', () => end('eof'));
input.on('error', () => end('eof'));
`;

// Anything printed with console.log would break the framing of stdout. Send it to stderr.
console.log = (...args: unknown[]): void => { console.error(...args); };

const core = createCore(message => { process.stdout.write(`${JSON.stringify(message)}\n`); });

let pending = '';
const decoder = new TextDecoder();
const feed = (chunk: Uint8Array): void => {
  pending += decoder.decode(chunk, { stream: true });
  for (let at = pending.indexOf('\n'); at >= 0; at = pending.indexOf('\n')) {
    const line = pending.slice(0, at);
    pending = pending.slice(at + 1);
    let data: unknown;
    try { data = JSON.parse(line); } catch { continue; }
    core.handle(data);
  }
};

const watchdog = new Worker(WATCHDOG, { eval: true, workerData: { pid: process.pid, ppid: process.ppid, graceMs: GRACE_MS, pollMs: POLL_MS } });
watchdog.on('message', (message: { type: string; chunk?: Uint8Array }) => {
  if (message.type === 'data' && message.chunk !== undefined) feed(message.chunk);
  else if (message.type === 'eof' || message.type === 'parent-changed') process.exit(0);
});
watchdog.on('error', () => { process.exit(1); });
core.ready();
