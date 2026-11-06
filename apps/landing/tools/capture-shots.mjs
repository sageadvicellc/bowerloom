#!/usr/bin/env node
/**
 * Takes the landing page screenshots again, after a change to the app screens or the command line output.
 *   npm run shots --prefix apps/landing
 * It builds the root packages (the command line shot runs the built CLI), waits for the machine-wide e2e lock, runs `apps/desktop/e2e/landing-shots.spec.ts`
 * hidden (no window shows), and writes `<id>-light.webp` and `<id>-dark.webp` to `apps/landing/public/shots`.
 * The spec fails when a picture would show this computer's user name, home folder, host name or temp folder. Read each new picture yourself before you commit it.
 * Set LANDING_SHOTS_DIR to write somewhere else.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const desktop = fileURLToPath(new URL('../../desktop', import.meta.url));
const lock = '/tmp/bowerloom-test.lock';
const run = (command, args, cwd, env = {}) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run('npm', ['run', 'build'], root);
// Take the lock that every e2e run takes, so two runs never share the machine.
for (;;) {
  try { mkdirSync(lock); break; } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    spawnSync('sleep', ['5']);
  }
}
try {
  run('npx', ['playwright', 'test', '--config', 'playwright.config.ts', 'e2e/landing-shots.spec.ts'], desktop, { LANDING_SHOTS: '1' });
} finally {
  rmSync(lock, { recursive: true, force: true });
}
