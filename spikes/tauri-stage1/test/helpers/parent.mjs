// A stand-in for the shell, for the watchdog test. It starts the core with a pipe, optionally sends the call that makes the core busy for good, prints the core's
// process id, and then waits. The test ends this process with SIGKILL and checks that the core ends too.
import { spawn } from 'node:child_process';

const [core, mode] = process.argv.slice(2);
const child = spawn(process.execPath, [core], { stdio: ['pipe', 'pipe', 'inherit'] });
let buffer = '';
child.stdout.on('data', chunk => {
  buffer += chunk;
  if (buffer.includes('"type":"ready"')) {
    buffer = '';
    if (mode === 'busy') child.stdin.write(`${JSON.stringify({ type: 'call', id: 1, method: 'spin', args: [] })}\n`);
    process.stdout.write(`${child.pid}\n`);
  }
});
setInterval(() => {}, 1000);
