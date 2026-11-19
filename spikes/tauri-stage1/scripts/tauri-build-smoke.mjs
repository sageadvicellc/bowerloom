// Builds the smoke build: the release shell with a visible window, in its own target folder. It builds nothing of the test feature.
// Run it only when nothing else uses the release build folder. It does not start the app.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}`, CARGO_TARGET_DIR: join(here, 'tauri', 'src-tauri', 'target-smoke') };
const page = spawnSync(process.execPath, [join(here, 'build.mjs'), '--tauri'], { stdio: 'inherit' });
if (page.status !== 0) process.exit(page.status ?? 1);
const prepare = spawnSync(process.execPath, [join(here, 'scripts', 'prepare-tauri.mjs')], { stdio: 'inherit' });
if (prepare.status !== 0) process.exit(prepare.status ?? 1);
const run = spawnSync(join(here, 'node_modules', '.bin', 'tauri'), ['build', '--bundles', 'app', '--ci', '--config', 'src-tauri/tauri.smoke.conf.json'], { cwd: join(here, 'tauri'), env, stdio: 'inherit' });
process.exit(run.status ?? 1);
