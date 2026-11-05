#!/usr/bin/env node
/**
 * Takes the desktop screenshots of the documentation again, after a change to the app screens.
 *   node tools/docs-visuals/capture-shots.mjs
 * It builds the root packages, waits for the machine-wide e2e lock, runs `apps/desktop/e2e/docs-shots.spec.ts` hidden (no window shows), and writes `<id>-light.webp` and `<id>-dark.webp`
 * to `apps/docs/public/visuals`. Then it writes the `shots` half of `apps/docs/src/visuals/manifest.json`. Set DOCS_SHOTS_ONLY to a comma list of ids to take only those.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const desktop = fileURLToPath(new URL('../../apps/desktop', import.meta.url));
const lock = '/tmp/bowerloom-test.lock';
const run = (command, args, cwd, env = {}) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run('npm', ['run', 'build'], root);
for (;;) {
  try { mkdirSync(lock); break; } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    spawnSync('sleep', ['5']);
  }
}
try {
  run('npx', ['playwright', 'test', '--config', 'playwright.config.ts', 'e2e/docs-shots.spec.ts'], desktop, { DOCS_SHOTS: '1' });
} finally {
  rmdirSync(lock);
}
run(process.execPath, [fileURLToPath(new URL('./manifest-shots.mjs', import.meta.url))], root);
