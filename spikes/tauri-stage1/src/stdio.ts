// The Node core as the Tauri sidecar. The channel is its own stdin and stdout: one JSON message per line each way. Only the shell holds the other end of the pipe,
// and no port is opened. When stdin closes, the shell is gone, and the core ends.
import { createInterface } from 'node:readline';
import { createCore } from './core.js';

// Anything printed with console.log would break the framing of stdout. Send it to stderr.
console.log = (...args: unknown[]): void => { console.error(...args); };

const core = createCore(message => { process.stdout.write(`${JSON.stringify(message)}\n`); });
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', line => {
  let data: unknown;
  try { data = JSON.parse(line); } catch { return; }
  core.handle(data);
});
process.stdin.on('end', () => { process.exit(0); });
process.stdin.on('error', () => { process.exit(0); });
core.ready();
