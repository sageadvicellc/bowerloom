import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TestContext } from 'node:test';

// `.bowerloom/authoring/` (the authoring receipt and its records) is committed with the project. It must hold no
// machine-specific data in clear (no absolute path, device, inode, uid, birthtime or private-state path), and a second
// machine, here a git clone at another path under another HOME, must read it and append to it.
const cli = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
const preload = pathToFileURL(fileURLToPath(new URL('./support/fake-network.js', import.meta.url))).href;

function folder(t: TestContext) { const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-authoring-portable-'))); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
function machine(t: TestContext) {
  const home = folder(t), log = join(home, 'network.log'), plan = join(home, 'network.json');
  writeFileSync(plan, JSON.stringify({ log })); writeFileSync(log, '');
  return { home, env: { HOME: home, XDG_STATE_HOME: join(home, 'state'), TEST_FAKE_NETWORK_PLAN: plan }, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}
function run(cwd: string, args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, ['--import', preload, cli, ...args], { cwd, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...env } });
  assert.equal(r.error, undefined); return r;
}
function approve(cwd: string, args: string[], env: Record<string, string>) {
  const planned = run(cwd, [...args, '--json'], env); assert.equal(planned.status, 3, `${args.join(' ')}\n${planned.stderr}`);
  const applied = run(cwd, [...args, '--approve', JSON.parse(planned.stdout).revision], env); assert.equal(applied.status, 0, applied.stderr);
}
function git(cwd: string, args: string[]) {
  const r = spawnSync('git', ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', timeout: 60000, env: { PATH: process.env.PATH ?? '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', HOME: cwd } });
  assert.equal(r.status, 0, r.stderr); return r.stdout;
}
const files = (dir: string): string[] => readdirSync(dir, { recursive: true }).map(String).filter(rel => lstatSync(join(dir, rel)).isFile()).sort();
const KEYS = new Set(['format', 'items', 'revision', 'kind', 'id', 'teams', 'files', 'path', 'sha256', 'bytes', 'planRevision', 'item']);
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach(v => keysOf(v, out));
  else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.add(k); keysOf(v, out); }
  return out;
}
function leaves(value: unknown, out: (string | number)[] = []): (string | number)[] {
  if (Array.isArray(value)) value.forEach(v => leaves(v, out));
  else if (value !== null && typeof value === 'object') Object.values(value).forEach(v => leaves(v, out));
  else if (typeof value === 'string' || typeof value === 'number') out.push(value);
  return out;
}

test('.bowerloom/authoring holds no machine-specific data, and a git clone at another path under another HOME reads and extends it', t => {
  const a = machine(t), dir = join(a.home, 'studio'); mkdirSync(dir);
  const init = ['--mode', 'existing', '--target', dir, '--name', 'Studio handbook', '--goal', 'Prepare a fictional onboarding kit for an independent design studio.'];
  const planned = run(a.home, ['init', 'plan', ...init, '--json'], a.env); assert.equal(planned.status, 0, planned.stderr);
  assert.equal(run(a.home, ['init', 'apply', ...init, '--approve', JSON.parse(planned.stdout).revision], a.env).status, 0);
  approve(dir, ['team', 'create', 'writers'], a.env);
  approve(dir, ['skill', 'create', 'house-style', '--team', 'writers'], a.env);
  approve(dir, ['prompt', 'create', 'weekly-review'], a.env);

  const authoring = join(dir, '.bowerloom', 'authoring');
  assert.deepEqual(files(authoring), ['receipt.json'], 'after finished creates only the receipt remains: no pending record, no stage');
  const text = readFileSync(join(authoring, 'receipt.json'), 'utf8'), receipt = JSON.parse(text) as { items: { kind: string; id: string }[] };
  assert.deepEqual(receipt.items.map(i => `${i.kind}:${i.id}`), ['prompt:weekly-review', 'skill:house-style', 'team:writers']);
  // Only the fixed keys of the receipt format; none names a device, inode, uid, time, or a path outside the project.
  assert.deepEqual([...keysOf(receipt)].filter(k => !KEYS.has(k)), []);
  for (const k of ['device', 'dev', 'inode', 'ino', 'uid', 'gid', 'birthtime', 'birthtimeMs', 'mtime', 'ctime', 'project', 'home', 'state']) assert.ok(!keysOf(receipt).has(k), k);
  // No absolute path, no private-state path, no time stamp in any value.
  for (const needle of [dir, a.home, realpathSync(tmpdir()), tmpdir(), join(a.home, 'state'), '/Users/', '/private/', '/var/folders/', '/home/', 'bowerloom/state', '.local/state']) assert.ok(!text.includes(needle), needle);
  assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'no ISO time');
  // No device, inode, uid or birth time number of this machine, as a number or a decimal string.
  const bowerloom = lstatSync(join(dir, '.bowerloom'), { bigint: true }), stat = lstatSync(join(authoring, 'receipt.json'), { bigint: true });
  const machineNumbers = new Set([bowerloom.dev, bowerloom.ino, stat.dev, stat.ino, BigInt(process.getuid!()), BigInt(process.getgid!()), bowerloom.birthtimeMs, stat.birthtimeMs, stat.mtimeMs, stat.ctimeMs].map(String));
  for (const leaf of leaves(receipt)) assert.ok(!machineNumbers.has(String(leaf)), `machine number ${String(leaf)}`);
  // Every file path is relative to .bowerloom and inside the item it pins.
  const paths = (receipt.items as unknown as { files: { path: string }[] }[]).flatMap(i => i.files.map(f => f.path));
  assert.ok(paths.length >= 3);
  for (const path of paths) assert.match(path, /^(?:teams|skills)\/[a-z0-9-]+\/[^/].*$|^prompts\/[a-z0-9-]+\.md$/, path);
  for (const leaf of leaves(receipt)) if (typeof leaf === 'string' && leaf.includes('/')) assert.ok(paths.includes(leaf) || leaf === 'bowerloom/authoring-receipt/v1beta1', leaf);

  // Commit the project and clone it to another path under another HOME: a second machine.
  git(dir, ['init', '-q', '-b', 'main']); git(dir, ['add', '-A']); git(dir, ['commit', '-q', '-m', 'Synthetic project']);
  assert.ok(git(dir, ['ls-files']).split('\n').includes('.bowerloom/authoring/receipt.json'), 'the receipt is committed');
  const b = machine(t), clone = join(b.home, 'elsewhere', 'studio-copy'); mkdirSync(join(b.home, 'elsewhere'));
  git(b.home, ['clone', '-q', '--no-hardlinks', dir, clone]);
  assert.equal(readFileSync(join(clone, '.bowerloom', 'authoring', 'receipt.json'), 'utf8'), text, 'the clone holds the same bytes');
  const ls = run(clone, ['ls', 'prompts'], b.env); assert.equal(ls.status, 0, ls.stderr); assert.match(ls.stdout, /weekly-review/);
  const teams = run(clone, ['ls', 'teams'], b.env); assert.equal(teams.status, 0, teams.stderr); assert.match(teams.stdout, /writers/);
  approve(clone, ['prompt', 'create', 'standup-notes'], b.env);
  const extended = JSON.parse(readFileSync(join(clone, '.bowerloom', 'authoring', 'receipt.json'), 'utf8')) as { items: { kind: string; id: string }[] };
  assert.deepEqual(extended.items.map(i => `${i.kind}:${i.id}`), ['prompt:standup-notes', 'prompt:weekly-review', 'skill:house-style', 'team:writers']);
  assert.ok(!readFileSync(join(clone, '.bowerloom', 'authoring', 'receipt.json'), 'utf8').includes(b.home));
  assert.deepEqual([...a.calls(), ...b.calls()], [], 'no network');
});
