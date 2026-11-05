#!/usr/bin/env node
/**
 * Takes the desktop screenshots of the documentation again, after a change to the app screens.
 *   node tools/docs-visuals/capture-shots.mjs
 * It builds the root packages, waits for the machine-wide e2e lock, runs `apps/desktop/e2e/docs-shots.spec.ts` hidden (no window shows), and writes `<id>-light.webp` and `<id>-dark.webp`
 * to `apps/docs/public/visuals`. Then it writes the `shots` half of `apps/docs/src/visuals/manifest.json`. Set DOCS_SHOTS_ONLY to a comma list of ids to take only those.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requestedIds, staleShots } from './checks.mjs';
import { withLock } from './lock.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const desktop = fileURLToPath(new URL('../../apps/desktop', import.meta.url));
const lock = '/tmp/bowerloom-test.lock';
/** Runs a command and returns its exit status. It never exits the process, so the lock is always released. A run that goes past `timeout` is stopped and counts as a failure. */
const run = (command, args, cwd, timeout, env = {}) => {
  const ran = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env }, timeout });
  if (ran.error) console.error(`${command} ${args[0] ?? ''}: ${ran.error.message}`);
  return ran.status ?? 1;
};
const MINUTE = 60_000;
const plan = JSON.parse(readFileSync(new URL('./plan.json', import.meta.url), 'utf8'));
const pictures = fileURLToPath(new URL('../../apps/docs/public/visuals', import.meta.url));

// This script is synchronous, so a signal ends it at once and leaves the lock folder; the next run's timeout message names it (see lock.mjs).
let status = 0, ids = [];
try { ids = requestedIds(plan, process.env.DOCS_SHOTS_ONLY ?? ''); } catch (error) { console.error(error.message); status = 1; }
const started = Date.now();
if (status === 0) status = run('npm', ['run', 'build'], root, 10 * MINUTE);
if (status === 0) {
  try {
    status = withLock(lock, () => run('npx', ['playwright', 'test', '--config', 'playwright.config.ts', 'e2e/docs-shots.spec.ts'], desktop, 20 * MINUTE, { DOCS_SHOTS: '1' }));
  } catch (error) {
    console.error(error.message);
    status = 1;
  }
}
// Playwright exits 0 when every test skips (no DOCS_SHOTS, a missing git program), so the pictures themselves must prove the run.
if (status === 0) {
  const problems = staleShots(ids, pictures, started);
  if (problems.length > 0) { console.error(`The run wrote no new picture for:\n  ${problems.join('\n  ')}`); status = 1; }
}
if (status === 0) status = run(process.execPath, [fileURLToPath(new URL('./manifest-shots.mjs', import.meta.url))], root, MINUTE);
process.exit(status);
