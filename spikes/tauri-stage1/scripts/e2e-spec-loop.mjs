// Runs each spec file of the Gate 3 slice alone, N times in a row (default 20), to find which spec is flaky.
// With E2E_KEEP=<folder>, the full output of each failed run is kept there. Usage: node scripts/e2e-spec-loop.mjs [runs] [spec number ...]
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const spike = join(dirname(fileURLToPath(import.meta.url)), '..');
const runs = Number(process.argv[2] ?? 20);
const wanted = process.argv.slice(3);
const specs = readdirSync(join(spike, 'e2e', 'specs')).filter(f => f.endsWith('.spec.mjs')).filter(f => wanted.length === 0 || wanted.some(w => f.startsWith(w.padStart(2, '0'))));
const summary = [];
for (const spec of specs) {
  let failed = 0;
  const times = [];
  for (let i = 1; i <= runs; i += 1) {
    const began = Date.now();
    const run = spawnSync(join(spike, 'node_modules', '.bin', 'wdio'), ['run', join(spike, 'e2e', 'wdio.conf.mjs'), '--spec', join(spike, 'e2e', 'specs', spec)], { cwd: spike, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...(spec.startsWith('08') ? {} : { E2E_LEAVE_CHECK: 'off' }) } });
    times.push(Date.now() - began);
    if (run.status !== 0) {
      failed += 1;
      if (process.env.E2E_KEEP) { mkdirSync(process.env.E2E_KEEP, { recursive: true }); writeFileSync(join(process.env.E2E_KEEP, `${spec}-run-${i}.log`), `${run.stdout}${run.stderr}`); }
    }
  }
  times.sort((a, b) => a - b);
  const line = { spec, runs, passed: runs - failed, failed, medianMs: times[Math.floor(times.length / 2)], maxMs: times.at(-1) };
  summary.push(line);
  console.log(JSON.stringify(line));
}
process.exit(summary.some(s => s.failed > 0) ? 1 : 0);
