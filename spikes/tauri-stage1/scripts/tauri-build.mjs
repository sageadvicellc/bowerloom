// Builds the Tauri spike app bundle (unsigned: no signing identity is set) with the pinned @tauri-apps/cli, and prints the build time, the cargo registry size and the crate count.
// Rust comes from ~/.cargo/bin (rustc and cargo 1.100.0). Nothing is installed globally.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const home = process.env.HOME;
const env = { ...process.env, PATH: `${home}/.cargo/bin:${process.env.PATH}` };
const registry = join(home, '.cargo', 'registry');
const sizeKb = () => (existsSync(registry) ? Number(spawnSync('du', ['-sk', registry], { encoding: 'utf8' }).stdout.split('\t')[0]) : 0);
const crates = () => {
  const cache = join(registry, 'cache');
  return existsSync(cache) ? readdirSync(cache).reduce((n, dir) => n + readdirSync(join(cache, dir)).length, 0) : 0;
};

console.log(`registry before: ${sizeKb()} KB, ${crates()} crates`);
const began = Date.now();
const run = spawnSync(join(here, 'node_modules', '.bin', 'tauri'), ['build', '--bundles', 'app', '--ci'], { cwd: join(here, 'tauri'), env, stdio: 'inherit' });
console.log(`tauri build: exit ${run.status}, ${((Date.now() - began) / 1000).toFixed(0)} s`);
console.log(`registry after: ${sizeKb()} KB, ${crates()} crates`);
process.exit(run.status ?? 1);
