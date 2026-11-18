// Shared helpers of the Electron-level tests: start the spike app with one scenario, read its result file, and check whether a process is alive.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPIKE = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = join(SPIKE, '..', '..');
export const DESKTOP = join(REPO, 'apps', 'desktop');
export const APP_DIR = join(SPIKE, 'app');
/** The Electron that runs the spike. By default the repo's own dev Electron. A packaged app is named by SPIKE_ELECTRON_EXE, and then no app folder is passed. */
export const PACKAGED = typeof process.env.SPIKE_ELECTRON_EXE === 'string' && process.env.SPIKE_ELECTRON_EXE !== '';
export const ELECTRON_EXE = PACKAGED ? process.env.SPIKE_ELECTRON_EXE : join(DESKTOP, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');

export function tempDir(t, prefix = 'stage1-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Resolves null after `ms`. Its timer does not keep the test process alive. */
export const giveUpAfter = ms => new Promise(resolve => { setTimeout(() => resolve(null), ms).unref(); });

export async function waitFor(check, ms, step = 25) {
  const until = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) return null;
    await sleep(step);
  }
}

/**
 * Starts the app with one scenario. The app has no window and no dock icon. It writes its result as JSON to `out`.
 * Returns the child process, a promise of how it ended, and a way to read the result file.
 */
export function launch(t, scenario, options = {}, { exe = ELECTRON_EXE, packaged = PACKAGED } = {}) {
  const work = tempDir(t, 'stage1-run-');
  const out = join(work, 'result.json');
  const args = [...(packaged ? [] : [APP_DIR]), `--scenario=${scenario}`, `--out=${out}`, `--user-data=${join(work, 'user-data')}`, `--options=${JSON.stringify(options)}`];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(exe, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const ended = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  t.after(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
  const result = () => (existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null);
  return { child, ended, out, result, stderr: () => stderr };
}

/** Runs a scenario to its end and returns its result. A run that ends with no result file is a failure that names the exit and the error text. */
export async function run(t, scenario, options = {}) {
  const started = launch(t, scenario, options);
  const end = await started.ended;
  const result = started.result();
  if (result === null) throw new Error(`scenario ${scenario} left no result (exit ${end.code} ${end.signal}): ${started.stderr().slice(0, 600)}`);
  if (result.error) throw new Error(`scenario ${scenario} failed: ${result.error}`);
  t.diagnostic(`${scenario}: ${JSON.stringify(result)}`);
  return { ...result, exit: end };
}
