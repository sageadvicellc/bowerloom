import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const { token } = JSON.parse(input);
  // One bounded same-group descendant intentionally outlives its direct parent.
  const descendant = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { env: {}, stdio: 'ignore' });
  descendant.unref();
  writeFileSync('leader-exit.json', JSON.stringify({ leader: process.pid, descendant: descendant.pid }));
  process.stdout.write(JSON.stringify({ token, proposal: 'synthetic-only' }), () => process.exit(0));
});
