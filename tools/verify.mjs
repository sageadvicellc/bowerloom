#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve('.trellis/verification');
await mkdir(directory, { recursive: true });
const report = { sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
  startedAt: new Date().toISOString(), scope: 'Offline regressions, landing build, and production dependency audit. Live services are separate.',
  checks: [], passed: false };
const commands = [
  ['typecheck', ['run', 'typecheck']],
  ['regressions', ['test']],
  ['landing', ['run', 'build', '--workspace', 'apps/landing']],
  ['dependencies', ['audit', '--omit=dev', '--audit-level=high', '--json']],
];
for (const [name, args] of commands) {
  const started = performance.now();
  const result = await new Promise((done) => {
    const child = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const chunks = []; let bytes = 0; let reason = null;
    const kill = signal => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* The process group already stopped. */ }
    };
    const abort = (why) => { reason ??= why; kill('SIGTERM'); killTimer ??= setTimeout(() => kill('SIGKILL'), 2000); };
    let killTimer;
    const timer = setTimeout(() => abort('TIME_LIMIT'), 15 * 60 * 1000);
    const collect = chunk => {
      bytes += chunk.length;
      if (bytes <= 2 * 1024 * 1024) chunks.push(chunk);
      else abort('LOG_LIMIT');
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', () => { reason = 'PROCESS_START_FAILED'; });
    child.once('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(killTimer);
      done({ code, signal, reason, log: Buffer.concat(chunks).toString('utf8') });
    });
  });
  await writeFile(resolve(directory, `${name}.log`), result.log, { mode: 0o600 });
  const record = { name, command: ['npm', ...args], exitCode: result.code, signal: result.signal,
    reason: result.reason, elapsedMs: Math.round(performance.now() - started), log: `${name}.log`,
    passed: result.code === 0 && result.reason === null };
  if (name === 'dependencies') {
    try { record.vulnerabilities = JSON.parse(result.log).metadata.vulnerabilities; } catch { record.passed = false; record.reason = 'AUDIT_RESULT_UNREADABLE'; }
  }
  report.checks.push(record);
  process.stdout.write(JSON.stringify(record) + '\n');
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  if (!record.passed) break;
}
report.passed = report.checks.length === commands.length && report.checks.every(check => check.passed);
report.completedAt = new Date().toISOString();
await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
if (!report.passed) process.exitCode = 1;
