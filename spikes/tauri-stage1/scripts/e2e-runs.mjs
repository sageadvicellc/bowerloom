// Gate 3 flake count: runs the whole WebdriverIO slice N times (default 100) in a row, each run a fresh app start, and counts the runs that fail.
// A run is one pass of all 8 spec files and the `onComplete` check. Plan limits (proposals): 100 runs, at most 2 failed.
// Usage: node scripts/e2e-runs.mjs [runs]. It prints one line per run and a JSON summary.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { withoutLeaveSwitch } from '../e2e/leave-check.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const spike = join(dirname(fileURLToPath(import.meta.url)), '..');
const runs = Number(process.argv[2] ?? 100);
const results = [];
for (let i = 1; i <= runs; i += 1) {
  const began = Date.now();
  const run = spawnSync(join(spike, 'node_modules', '.bin', 'wdio'), ['run', join(spike, 'e2e', 'wdio.conf.mjs')], { cwd: spike, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: withoutLeaveSwitch(process.env) });
  const text = `${run.stdout}${run.stderr}`;
  const files = /Spec Files:\s+(\d+) passed(?:, (\d+) failed)?, (\d+) total/.exec(text);
  const left = spawnSync('pgrep', ['-f', 'target-e2e/release/bundle/macos'], { encoding: 'utf8' }).stdout.trim() !== '';
  const result = { run: i, ok: run.status === 0 && !left, status: run.status, passedFiles: files ? Number(files[1]) : null, failedFiles: files ? Number(files[2] ?? 0) : null, ms: Date.now() - began, leftover: left };
  // With E2E_KEEP=<folder>, the full output of each failed run is kept there, so a failure can be read afterwards.
  if (!result.ok && process.env.E2E_KEEP) { mkdirSync(process.env.E2E_KEEP, { recursive: true }); writeFileSync(join(process.env.E2E_KEEP, `run-${i}.log`), text); }
  results.push(result);
  console.log(JSON.stringify(result));
}
const failed = results.filter(r => !r.ok);
const times = results.map(r => r.ms).sort((a, b) => a - b);
console.log(JSON.stringify({ runs, passed: runs - failed.length, failed: failed.length, failedRuns: failed.map(r => r.run), medianMs: times[Math.floor(times.length / 2)], maxMs: times.at(-1) }));
process.exit(failed.length === 0 ? 0 : 1);
