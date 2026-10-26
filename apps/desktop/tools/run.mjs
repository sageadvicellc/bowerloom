#!/usr/bin/env node
// One command to open the viewer, from any folder:
//   npm --prefix <repo> run desktop           (your own Bowerloom)
//   npm --prefix <repo> run desktop:sample    (made-up sample data)
//   npm --prefix <repo> run desktop:prototype (the Bowerloom 0.8 clickable prototype: all in memory, with a temporary data folder)
//   npm --prefix <repo> run desktop:prototype:v2 (the 0.8 home app, agents first: the same promises)
//   npm --prefix <repo> run desktop:prototype:real (the 0.8 preview on YOUR setup: it reads your tool folders and changes nothing; needs a real HOME)
// It installs what is missing, builds the app, and opens the window. Pass --build-only to stop before the window.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { constants } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePrototypeDataDir, removeAndReport, removePrototypeDataDir } from '../main/prototype-dir.mjs';

// The data folder rules (how the folder is made, and the checks before it is removed) live in main/prototype-dir.mjs, which the app shares.
export { makePrototypeDataDir, removePrototypeDataDir };
// The launcher removes through removeAndReport, so a folder it cannot remove is named on stderr: "Could not remove <dir>. Delete it yourself."

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(desktop, '..', '..');
const KNOWN = new Set(['--sample-data', '--real-data', '--sandbox', '--prototype', '--prototype-v2', '--prototype-real', '--build-only']);
const MODES = new Set(['--sample-data', '--real-data', '--sandbox', '--prototype', '--prototype-v2', '--prototype-real']);
// Both prototypes start with a fresh temporary data folder and write nothing else.
const PROTOTYPES = ['--prototype', '--prototype-v2'];
// The real-setup preview has the same lock (a fresh temporary data folder, nothing written to the real app data) and adds a read-only bridge. It needs a real home folder.
export const REAL_FLAG = '--prototype-real';
/** What the real-setup preview says on the terminal before it opens its window. Tests hold this to shared/real/types.ts. */
export const REAL_PROMISE = 'Reads: names, descriptions, structure and key names. Writes: nothing.';

/** The home folder the real-setup preview will read, or null when HOME is not set to a folder that exists. Only the home variable is looked at. */
export function realHome(env = process.env, exists = path => existsSync(path)) {
  const home = process.platform === 'win32' ? env.USERPROFILE : env.HOME;
  return typeof home === 'string' && isAbsolute(home) && home.length > 1 && !home.includes('\0') && exists(home) ? home : null;
}

/**
 * The only environment an install script gets: where to find programs and the person's home, the network settings npm
 * needs, and nothing else. A secret in the person's environment (BOWERLOOM_GITHUB_TOKEN, NPM_TOKEN, ...) never reaches a
 * script that a dependency runs while it installs.
 */
export function installEnv(source = process.env) {
  // Names are compared in lower case, because Windows spells them Path, SystemRoot, ComSpec and PathExt. The name is kept as it is.
  const keep = new Set(['path', 'home', 'tmpdir', 'temp', 'tmp', 'userprofile', 'appdata', 'localappdata', 'systemroot', 'comspec', 'pathext', 'lang',
    'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy', 'node_extra_ca_certs', 'ssl_cert_file', 'xdg_config_home', 'electron_mirror', 'electron_custom_dir', 'electron_skip_binary_download', 'electron_get_use_proxy']);
  // A setting that holds a credential is never passed on, whatever its prefix.
  const secret = /(token|auth|password|passwd|_pass\b|secret|credential|cert|key)/;
  const out = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (lower.startsWith('npm_config_')) { if (!secret.test(lower) || lower === 'npm_config_cafile') out[name] = value; continue; }
    if (lower.startsWith('global_agent_')) { if (!secret.test(lower)) out[name] = value; continue; }
    if (keep.has(lower)) out[name] = value;
  }
  return out;
}

/**
 * How to run npm without a shell. When this was started through npm, `npm_execpath` is npm's own script. Otherwise npm sits beside
 * Node. Both run as `node <npm-cli.js> ...`, so no `.cmd` shim and no shell is needed on any system.
 */
export function npmCommand(env = process.env, node = process.execPath, platform = process.platform) {
  const exec = env.npm_execpath;
  if (typeof exec === 'string' && /npm-cli\.js$/.test(exec)) return { command: node, prefix: [exec] };
  const beside = platform === 'win32' ? join(dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js') : join(dirname(node), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return { command: node, prefix: [beside] };
}

/** The app binary that Electron's installer recorded in path.txt, run directly (no `.bin` shim, no shell). Null when not installed. */
export function electronBinary(desktop = join(dirname(fileURLToPath(import.meta.url)), '..'), platform = process.platform) {
  const base = join(desktop, 'node_modules', 'electron');
  try {
    const name = readFileSync(join(base, 'path.txt'), 'utf8').trim();
    if (!name || name.includes('..')) return null;
    const file = join(base, 'dist', platform === 'win32' ? name.replace(/\//g, '\\') : name);
    return existsSync(file) ? file : null;
  } catch { return null; }
}

/** The exit code a shell shows for a process that a signal ended: 128 plus the signal number (SIGINT 130, SIGTERM 143, SIGHUP 129). 1 for a signal we do not know. */
export function exitCodeFor(signal) {
  const n = signal ? constants.signals[signal] : undefined;
  return typeof n === 'number' ? 128 + n : 1;
}

const PASSED_ON = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * Looks after the app window until it is gone. A stop signal (SIGINT, SIGTERM, SIGHUP) is passed on to the window, and the launcher WAITS: it exits
 * only when the window has, so the window is never left running with its folder pulled away. The data folder is removed in the window's `exit`
 * handler, which runs on every way the window can end. What cannot be caught: SIGKILL of the launcher leaves the window running (it removes its own
 * folder when it quits, see main/main.ts), and SIGKILL of the window or a crash of the machine leaves the folder in the temporary folder, where
 * the system clears it. That leftover holds only the browser's cache, and the next run uses a fresh folder.
 * `proc`, `remove` and `fail` are there so a test can stand in for the process.
 */
export function superviseChild(child, { dataDir = null, proc = process, remove = dir => removeAndReport(dir), fail: failWith = fail } = {}) {
  let passedOn = null;
  const cleanUp = () => { if (dataDir !== null) remove(dataDir); };
  for (const signal of PASSED_ON) proc.on(signal, () => { passedOn ??= signal; child.kill(signal); });
  proc.once('exit', cleanUp);
  child.on('error', error => { cleanUp(); failWith(`The app window could not start.\n${error.message}`, 1); });
  child.on('exit', (code, signal) => {
    cleanUp();
    if (signal && signal === passedOn) proc.exit(exitCodeFor(signal));
    else if (signal) failWith(`The app window stopped suddenly (${signal}).`, 1);
    else proc.exit(code ?? 0);
  });
}

/** What the app window is started with: the app folder, the data folder when there is one, then the mode flags. */
export function electronArgs(desktop, flags, userDataDir = null) { return [desktop, ...(userDataDir === null ? [] : [`--user-data-dir=${userDataDir}`]), ...flags]; }

/** The marker a finished install leaves. A folder that exists after a stopped install does not count. */
export const marker = dir => join(dir, 'node_modules', '.bowerloom-install-ok');

function fail(text, code = 1) { console.error(`\n${text}`); process.exit(code); }

function step(text, command, argv, cwd, env) {
  console.log(`\n${text}`);
  const r = spawnSync(command, argv, { cwd, stdio: 'inherit', env });
  if (r.error) fail(`That step could not start: ${text}\n${r.error.message}`, 1);
  if (r.signal) fail(`That step was stopped (${r.signal}): ${text}`, 1);
  if (r.status !== 0) fail(`That step failed: ${text}`, r.status ?? 1);
}

function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter(a => !KNOWN.has(a));
  if (unknown.length) fail(`I do not know ${unknown.map(a => `"${a}"`).join(', ')}. Use --sample-data to open the sample, --real-data to open your own Bowerloom, --prototype or --prototype-v2 to open a clickable prototype, --prototype-real to open the preview on your own setup (read-only), or --build-only to only build.`, 2);
  if (args.filter(a => MODES.has(a)).length > 1) fail('Choose one of --sample-data, --real-data, --sandbox, --prototype, --prototype-v2 and --prototype-real, not more.', 2);
  if (args.includes(REAL_FLAG) && realHome() === null) fail('The real setup preview needs a home folder, and HOME is not set to a folder that exists. Nothing was read.', 2);

  const npm = npmCommand();
  const clean = installEnv();
  if (!existsSync(marker(repo))) { step('Installing Bowerloom (first time only)...', npm.command, [...npm.prefix, 'ci', '--no-audit', '--no-fund'], repo, clean); mkdirSync(join(repo, 'node_modules'), { recursive: true }); writeFileSync(marker(repo), 'ok\n'); }
  if (!existsSync(marker(desktop))) { step('Installing the viewer (first time only)...', npm.command, [...npm.prefix, 'ci', '--no-audit', '--no-fund'], desktop, clean); }
  if (!existsSync(join(desktop, 'node_modules', 'electron', 'path.txt'))) step('Downloading the app window (first time only)...', process.execPath, [join(desktop, 'node_modules', 'electron', 'install.js')], desktop, clean);
  if (!existsSync(marker(desktop))) writeFileSync(marker(desktop), 'ok\n');
  step('Building the viewer...', process.execPath, [join(desktop, 'tools', 'bundle.mjs')], desktop, process.env);
  if (args.includes('--build-only')) process.exit(0);

  // The sandbox is made once if it is missing. Its own tool checks everything before it writes.
  if (args.includes('--sandbox')) step('Making the sandbox if it is missing...', process.execPath, [join(desktop, 'tools', 'make-sandbox.mjs')], desktop, process.env);
  console.log('\nOpening the viewer...');
  const electron = electronBinary(desktop);
  if (electron === null) fail('The app window is not installed. Run the command again.', 1);
  const flags = args.filter(a => MODES.has(a));
  // The prototype starts with a fresh, empty data folder and removes it when the window closes, so it leaves nothing in the real app data.
  const dataDir = PROTOTYPES.some(flag => args.includes(flag)) || args.includes(REAL_FLAG) ? makePrototypeDataDir() : null;
  if (args.includes(REAL_FLAG)) console.log(`\n${REAL_PROMISE}\nHome folder: ${realHome()}`);
  const child = spawn(electron, electronArgs(desktop, flags, dataDir), { stdio: 'inherit', env: process.env });
  superviseChild(child, { dataDir });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
