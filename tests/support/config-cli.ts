// Helpers for the spec 06 CLI tests: a world with its own HOME and XDG_STATE_HOME, the real binary, approvals, and the
// fake network of tests/support/fake-network.ts. Not a test file, and not part of the product.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TestContext } from 'node:test';
import { buildFakeRepo } from './fake-github-repo.js';
import type { FakeRepo } from './fake-github-repo.js';

export const cli = fileURLToPath(new URL('../../apps/cli/src/main.js', import.meta.url));
export const preload = pathToFileURL(fileURLToPath(new URL('./fake-network.js', import.meta.url))).href;
export const STORE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
export interface World { base: string; home: string; work: string; store: string; state: string; env: Record<string, string> }
/**
 * Removes a sandbox even when a test stopped part way and left a part of it without owner rights, such as the `locked` folder of a
 * cache prune test or the read-only record folders of a harness test. Every folder gets owner read, write and search rights (u+rwx)
 * and every file owner read and write (u+rw), then the whole tree goes. A link is never followed. Safe to call on a missing path.
 */
export function removeAll(base: string): void {
  try { rmSync(base, { recursive: true, force: true }); return; } catch { /* a part without owner rights: open it, then try again */ }
  const open = (at: string): void => {
    let stat; try { stat = lstatSync(at); } catch { return; }
    if (stat.isSymbolicLink()) return;
    if (!stat.isDirectory()) { try { chmodSync(at, stat.mode | 0o600); } catch { /* gone */ } return; }
    try { chmodSync(at, stat.mode | 0o700); } catch { return; }
    let names: string[] = []; try { names = readdirSync(at); } catch { return; }
    for (const n of names) open(join(at, n));
  };
  open(base);
  rmSync(base, { recursive: true, force: true });
}
export function world(t: TestContext, prefix = 'bowerloom-config-cli-'): World {
  const base = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => { try { chmodSync(join(base, 'home'), 0o700); } catch { /* gone */ } removeAll(base); });
  const home = join(base, 'home'); mkdirSync(home, { mode: 0o700 });
  const work = join(base, 'work'); mkdirSync(work, { mode: 0o755 });
  return { base, home, work, store: join(home, '.bowerloom'), state: join(base, 'state'), env: { HOME: home, XDG_STATE_HOME: join(base, 'state') } };
}
/** The environment of this test process without the GitHub token variables (spec 07). A test passes a canary in `env`. */
export function baseEnv(): Record<string, string | undefined> {
  const { BOWERLOOM_GITHUB_TOKEN: _b, GH_TOKEN: _h, GITHUB_TOKEN: _g, ...rest } = process.env; return rest;
}
export function run(cwd: string, args: string[], env: Record<string, string>, node: string[] = []) {
  const r = spawnSync(process.execPath, [...node, cli, ...args], { cwd, encoding: 'utf8', timeout: 120000, env: { ...baseEnv(), ...env } });
  assert.equal(r.error, undefined); return r;
}
/** Runs git in `cwd` with the world's HOME and no system config. For a test fixture only: Bowerloom never runs git. */
export function git(cwd: string, args: string[], w: World) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', env: { ...baseEnv(), ...w.env, GIT_CONFIG_NOSYSTEM: '1' } });
  assert.equal(r.status, 0, r.stderr); return r;
}
/** Runs git and returns the result whatever its exit code (git check-ignore exits 1 for a path it does not ignore). */
export function gitRaw(cwd: string, args: string[], w: World) {
  return spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', env: { ...baseEnv(), ...w.env, GIT_CONFIG_NOSYSTEM: '1' } });
}
/** Runs one shell command line in `cwd`, as a person would paste it. For a test fixture only. */
export function shell(cwd: string, command: string, w: World) {
  const r = spawnSync('/bin/sh', ['-c', command], { cwd, encoding: 'utf8', env: { ...baseEnv(), ...w.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' } });
  assert.equal(r.status, 0, `${command}: ${r.stderr}`); return r;
}
export const errorCode = (stderr: string): string => (JSON.parse(stderr) as { error: { code: string } }).error.code;
export const errorMessage = (stderr: string): string => (JSON.parse(stderr) as { error: { message: string } }).error.message;
/** Plans a command (exit 3), then applies it with its revision. Both runs are returned. */
export function approve(cwd: string, args: string[], env: Record<string, string>, node: string[] = []) {
  const planned = run(cwd, [...args, '--json'], env, node); assert.equal(planned.status, 3, planned.stderr + planned.stdout);
  const body = JSON.parse(planned.stdout) as { revision: string; plan: Record<string, unknown> };
  return { body, planned, applied: run(cwd, [...args, '--approve', body.revision], env, node) };
}
export function mustApprove(cwd: string, args: string[], env: Record<string, string>, node: string[] = []) {
  const r = approve(cwd, args, env, node); assert.equal(r.applied.status, 0, r.applied.stderr + r.applied.stdout); return r;
}
/** Every file of the store, by path relative to it. */
export function storeTree(store: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => { for (const n of readdirSync(join(store, rel)).sort()) { if (rel === '' && n === '.git') continue; const r = rel ? `${rel}/${n}` : n; if (statSync(join(store, r)).isDirectory()) walk(r); else out[r] = readFileSync(join(store, r), 'utf8'); } };
  walk(''); return out;
}
/** Pushes the store to a fake github.com repository and gives the store the git files of that push. */
export function pushStore(w: World, { head }: { head?: string } = {}): FakeRepo {
  const dir = mkdtempSync(join(w.base, 'repo-')), repo = buildFakeRepo('sageadvicellc', 'store', storeTree(w.store), STORE_COMMIT, dir);
  const git = join(w.store, '.git'); rmSync(git, { recursive: true, force: true });
  mkdirSync(join(git, 'refs', 'remotes', 'origin'), { recursive: true, mode: 0o755 }); mkdirSync(join(git, 'refs', 'heads'), { recursive: true, mode: 0o755 });
  writeFileSync(join(git, 'config'), '[remote "origin"]\n\turl = git@github.com:SageAdviceLLC/store.git\n'); writeFileSync(join(git, 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(join(git, 'refs', 'remotes', 'origin', 'main'), `${STORE_COMMIT}\n`); writeFileSync(join(git, 'refs', 'heads', 'main'), `${head ?? STORE_COMMIT}\n`);
  return repo;
}
/** A fake network plan for the CLI: the routes of `repo` and any extra route, and a log of every call. */
export function network(w: World, routes: Record<string, string | { status: number; headers?: Record<string, string>; file: string | null }> = {}): { env: Record<string, string>; log: string } {
  const log = join(w.base, `network-${Date.now()}-${Math.random().toString(16).slice(2)}.log`), plan = `${log}.json`;
  writeFileSync(plan, JSON.stringify({ log, routes })); writeFileSync(log, '');
  return { env: { ...w.env, TEST_FAKE_NETWORK_PLAN: plan }, log };
}
export const NETWORK = ['--import', preload];
export const loggedHosts = (log: string): string[] => [...new Set(readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => (JSON.parse(l) as { target: string }).target).filter(t => t.startsWith('https://')).map(t => new URL(t).hostname))].sort();
/** Makes `dir` a work tree with an origin, so the project is shared. */
export function shared(dir: string): void { mkdirSync(join(dir, '.git'), { mode: 0o755 }); writeFileSync(join(dir, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/o/app.git\n'); }
export function project(w: World, name = 'app', config?: unknown): string {
  const dir = join(w.work, name); mkdirSync(dir, { recursive: true, mode: 0o755 });
  if (config !== undefined) writeFileSync(join(dir, 'bowerloom.json'), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o644 });
  return dir;
}
export const EMPTY_CONFIG = { format: 'bowerloom/project/v1beta1', harnesses: ['claude', 'codex'], skills: [], prompts: [], teams: [] };
