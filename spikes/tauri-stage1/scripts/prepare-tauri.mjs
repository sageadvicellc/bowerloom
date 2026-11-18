// Puts the Node runtime where Tauri's `externalBin` expects it: tauri/src-tauri/binaries/node-<target triple>.
// The sidecar is "a runtime plus the JavaScript as a resource" (the plan's second way). The runtime is a copy of the Node that runs this script, which the repository
// already requires (>=24.11.0 <25). Nothing is downloaded. The copy is ignored by git.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const rustc = execFileSync('rustc', ['-vV'], { encoding: 'utf8', env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` } });
const triple = /^host: (.+)$/m.exec(rustc)?.[1];
if (!triple) throw new Error('rustc did not name its host target');
const target = join(here, 'tauri', 'src-tauri', 'binaries', `node-${triple}`);
mkdirSync(dirname(target), { recursive: true });
copyFileSync(process.execPath, target);
chmodSync(target, 0o755);
// Tauri's build needs a square RGBA icon.png. The spike uses the desktop app's own icon, copied, and ignored by git.
mkdirSync(join(here, 'tauri', 'src-tauri', 'icons'), { recursive: true });
copyFileSync(join(here, '..', '..', 'apps', 'desktop', 'build', 'icon.png'), join(here, 'tauri', 'src-tauri', 'icons', 'icon.png'));
console.log(`sidecar runtime: ${target} (${(statSync(target).size / 1048576).toFixed(1)} MiB, Node ${process.version})`);
