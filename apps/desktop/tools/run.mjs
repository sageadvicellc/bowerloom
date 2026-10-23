#!/usr/bin/env node
// One command to open the viewer, from any folder:
//   npm --prefix <repo> run desktop           (your own Bowerloom)
//   npm --prefix <repo> run desktop:sample    (made-up sample data)
// It installs what is missing, builds the app, and opens the window. Pass --build-only to stop before the window.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(desktop, '..', '..');
const windows = process.platform === 'win32';
const KNOWN = new Set(['--sample-data', '--real-data', '--build-only']);

/**
 * The only environment an install script gets: where to find programs and the person's home, the network settings npm
 * needs, and nothing else. A secret in the person's environment (BOWERLOOM_GITHUB_TOKEN, NPM_TOKEN, ...) never reaches a
 * script that a dependency runs while it installs.
 */
export function installEnv(source = process.env) {
  const keep = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'LANG', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'ELECTRON_MIRROR', 'ELECTRON_CUSTOM_DIR'];
  const out = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    // npm settings are named npm_config_<name>. Settings that hold a credential are left out.
    if (lower.startsWith('npm_config_')) { if (!/(token|auth|password|_pass|cert|key)/.test(lower)) out[name] = value; continue; }
    if (keep.includes(name)) out[name] = value;
  }
  return out;
}

/** The marker a finished install leaves. A folder that exists after a stopped install does not count. */
export const marker = dir => join(dir, 'node_modules', '.bowerloom-install-ok');

function fail(text, code = 1) { console.error(`\n${text}`); process.exit(code); }

function step(text, command, argv, cwd, env) {
  console.log(`\n${text}`);
  const r = spawnSync(command, argv, { cwd, stdio: 'inherit', env, ...(windows && command.endsWith('.cmd') ? { shell: true } : {}) });
  if (r.error) fail(`That step could not start: ${text}\n${r.error.message}`, 1);
  if (r.signal) fail(`That step was stopped (${r.signal}): ${text}`, 1);
  if (r.status !== 0) fail(`That step failed: ${text}`, r.status ?? 1);
}

function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter(a => !KNOWN.has(a));
  if (unknown.length) fail(`I do not know ${unknown.map(a => `"${a}"`).join(', ')}. Use --sample-data to open the sample, --real-data to open your own Bowerloom, or --build-only to only build.`, 2);
  if (args.includes('--sample-data') && args.includes('--real-data')) fail('Choose --sample-data or --real-data, not both.', 2);

  const npm = windows ? 'npm.cmd' : 'npm';
  const clean = installEnv();
  if (!existsSync(marker(repo))) { step('Installing Bowerloom (first time only)...', npm, ['ci', '--no-audit', '--no-fund'], repo, clean); mkdirSync(join(repo, 'node_modules'), { recursive: true }); writeFileSync(marker(repo), 'ok\n'); }
  if (!existsSync(marker(desktop))) { step('Installing the viewer (first time only)...', npm, ['ci', '--no-audit', '--no-fund'], desktop, clean); }
  if (!existsSync(join(desktop, 'node_modules', 'electron', 'path.txt'))) step('Downloading the app window (first time only)...', process.execPath, [join(desktop, 'node_modules', 'electron', 'install.js')], desktop, clean);
  if (!existsSync(marker(desktop))) writeFileSync(marker(desktop), 'ok\n');
  step('Building the viewer...', process.execPath, [join(desktop, 'tools', 'bundle.mjs')], desktop, process.env);
  if (args.includes('--build-only')) process.exit(0);

  console.log('\nOpening the viewer...');
  const electron = join(desktop, 'node_modules', '.bin', windows ? 'electron.cmd' : 'electron');
  const flags = args.filter(a => a === '--sample-data' || a === '--real-data');
  const child = spawn(electron, [desktop, ...flags], { stdio: 'inherit', env: process.env, ...(windows ? { shell: true } : {}) });
  child.on('error', error => fail(`The app window could not start.\n${error.message}`, 1));
  child.on('exit', (code, signal) => {
    if (signal) fail(`The app window stopped suddenly (${signal}).`, 1);
    process.exit(code ?? 0);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
