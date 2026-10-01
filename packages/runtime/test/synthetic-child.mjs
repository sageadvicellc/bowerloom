// Synthetic fixture owns its group and self-terminates if its controller disappears.
const controllerPid = process.ppid;
const orphanCheck = setInterval(() => { if (process.ppid !== controllerPid) process.kill(-process.pid, 'SIGKILL'); }, 50);
orphanCheck.unref();
setTimeout(() => process.kill(-process.pid, 'SIGKILL'), 20000).unref();
import { spawn } from 'node:child_process';
let input = '';
process.stdin.on('data', chunk => { input += chunk; if (Buffer.byteLength(input) > 70000) process.exit(2); });
process.stdin.on('end', () => {
  const packet = JSON.parse(input); const task = JSON.parse(packet.taskInput);
  if (task.mode === 'hang' || task.mode === 'group') {
    if (task.mode === 'group') spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { env: {}, stdio: 'ignore' });
    setInterval(() => {}, 1000); return;
  }
  if (task.mode === 'oversize') { process.stdout.write('x'.repeat(200000)); return; }
  process.stdout.write(JSON.stringify({ token: packet.token, proposal: JSON.stringify(task.proposal) }));
});
