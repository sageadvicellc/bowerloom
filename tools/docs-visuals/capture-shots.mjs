#!/usr/bin/env node
/**
 * Takes the desktop screenshots of the documentation again, after a change to the app screens.
 *   node tools/docs-visuals/capture-shots.mjs
 * It builds the root packages, waits for the machine-wide e2e lock, runs `apps/desktop/e2e/docs-shots.spec.ts` hidden (no window shows), and writes `<id>-light.webp` and `<id>-dark.webp`
 * to `apps/docs/public/visuals`. Then it writes the `shots` half of `apps/docs/src/visuals/manifest.json`. Set DOCS_SHOTS_ONLY to a comma list of ids to take only those.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withLock } from './lock.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const desktop = fileURLToPath(new URL('../../apps/desktop', import.meta.url));
const lock = '/tmp/bowerloom-test.lock';
/** Runs a command and returns its exit status. It never exits the process, so the lock is always released. */
const run = (command, args, cwd, env = {}) => spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } }).status ?? 1;

// Ctrl-C or SIGTERM reaches the child process too. The handlers keep this process alive until the child stops, so the lock is released in `finally` before the exit.
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true; });

let status = run('npm', ['run', 'build'], root);
if (status === 0) {
  try {
    status = withLock(lock, () => run('npx', ['playwright', 'test', '--config', 'playwright.config.ts', 'e2e/docs-shots.spec.ts'], desktop, { DOCS_SHOTS: '1' }));
  } catch (error) {
    console.error(error.message);
    status = 1;
  }
}
if (interrupted) status = 130;
if (status === 0) status = run(process.execPath, [fileURLToPath(new URL('./manifest-shots.mjs', import.meta.url))], root);
process.exit(status);
