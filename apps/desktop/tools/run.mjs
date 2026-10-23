#!/usr/bin/env node
// One command to open the viewer, from any folder:
//   npm --prefix <repo> run desktop           (your own Bowerloom)
//   npm --prefix <repo> run desktop:sample    (made-up sample data)
// It installs what is missing, builds the app, and opens the window. Pass --build-only to stop before the window.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(desktop, '..', '..');
const args = process.argv.slice(2);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function step(text, command, argv, cwd) {
  console.log(`\n${text}`);
  const r = spawnSync(command, argv, { cwd, stdio: 'inherit', env: process.env });
  if (r.status !== 0) { console.error(`\nThat step failed: ${text}`); process.exit(r.status ?? 1); }
}

if (!existsSync(join(repo, 'node_modules', 'tar'))) step('Installing Bowerloom (first time only)...', npm, ['ci', '--no-audit', '--no-fund'], repo);
if (!existsSync(join(desktop, 'node_modules', 'electron'))) step('Installing the viewer (first time only)...', npm, ['ci', '--no-audit', '--no-fund'], desktop);
if (!existsSync(join(desktop, 'node_modules', 'electron', 'path.txt'))) step('Downloading the app window (first time only)...', process.execPath, [join(desktop, 'node_modules', 'electron', 'install.js')], desktop);
step('Building the viewer...', process.execPath, [join(desktop, 'tools', 'bundle.mjs')], desktop);
if (args.includes('--build-only')) process.exit(0);

console.log('\nOpening the viewer...');
const electron = join(desktop, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const flags = args.filter(a => a === '--sample-data' || a === '--real-data');
const child = spawn(electron, [desktop, ...flags], { stdio: 'inherit', env: { ...process.env, ELECTRON_ENABLE_LOGGING: '' } });
child.on('exit', code => process.exit(code ?? 0));
