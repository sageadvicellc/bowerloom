// Builds the Tauri test app: the same shell with the `e2e` feature on (the WebdriverIO plugin, the embedded WebDriver server, the test-only folder answer), a test page,
// and a capability that names the plugin permissions. It builds into its own target folder, so the release build is never touched.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const home = process.env.HOME;
const env = { ...process.env, PATH: `${home}/.cargo/bin:${process.env.PATH}`, CARGO_TARGET_DIR: join(here, 'tauri', 'src-tauri', 'target-e2e') };
const registry = join(home, '.cargo', 'registry');
const sizeKb = () => (existsSync(registry) ? Number(spawnSync('du', ['-sk', registry], { encoding: 'utf8' }).stdout.split('\t')[0]) : 0);
const crates = () => { const cache = join(registry, 'cache'); return existsSync(cache) ? readdirSync(cache).reduce((n, dir) => n + readdirSync(join(cache, dir)).length, 0) : 0; };

const page = spawnSync(process.execPath, [join(here, 'build.mjs'), '--e2e'], { stdio: 'inherit' });
if (page.status !== 0) process.exit(page.status ?? 1);
console.log(`registry before: ${sizeKb()} KB, ${crates()} crates`);
const began = Date.now();
const run = spawnSync(join(here, 'node_modules', '.bin', 'tauri'), ['build', '--bundles', 'app', '--ci', '--features', 'e2e', '--config', 'src-tauri/tauri.e2e.conf.json'], { cwd: join(here, 'tauri'), env, stdio: 'inherit' });
console.log(`tauri build (e2e): exit ${run.status}, ${((Date.now() - began) / 1000).toFixed(0)} s`);
console.log(`registry after: ${sizeKb()} KB, ${crates()} crates`);
process.exit(run.status ?? 1);
