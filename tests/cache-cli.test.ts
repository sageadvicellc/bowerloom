// Spec 09, through the real binary: `cache list` and `cache prune`. Every run gets its own HOME and XDG_STATE_HOME under
// a temporary folder, and the GitHub token variables are unset. The only network is the fake one of
// tests/support/fake-network.ts. Nothing here touches the real home folder or the real cache.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { world, run, approve, mustApprove, errorCode, errorMessage, network, NETWORK, project } from './support/config-cli.js';
import type { World } from './support/config-cli.js';
import { TOPICS } from '../apps/cli/src/human.js';
import { readInstalledRelease } from '../apps/cli/src/release.js';
import { STORE_MANIFEST_LIMITS, serializeManifest, validateManifest } from '../packages/skill-manifest/src/schema.js';

const heading = `Bowerloom ${readInstalledRelease().version}: open beta\n${readInstalledRelease().execution}\n\n`;
const fixtures = fileURLToPath(new URL('../../packages/skill-manifest/test/fixtures/', import.meta.url));
const NPM_SPEC = 'npm:@synthetic/db-skills@0.0.1:skills/synthetic-db/collections';
const NPM_ROUTES = {
  'https://registry.npmjs.org/@synthetic/db-skills/0.0.1': join(fixtures, 'npm-db-skills', 'metadata.json'),
  'https://registry.npmjs.org/@synthetic/db-skills/-/db-skills-0.0.1.tgz': join(fixtures, 'npm-db-skills', 'archive.tgz'),
};
const USAGE_TEXT = 'Use bowerloom cache list [--json] or bowerloom cache prune with a selector. See bowerloom help cache.';
const stateOf = (w: World): string => join(w.state, 'bowerloom');
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A store skill pinned through `skills add --global`, which keeps the checked bytes in the machine cache. */
function pinnedInStore(w: World): void {
  const net = network(w, NPM_ROUTES);
  mustApprove(w.work, ['skills', 'add', NPM_SPEC, '--global'], net.env, NETWORK);
}
/** The store skills.json with its pins removed. */
function dropStorePins(w: World): void {
  writeFileSync(join(w.store, 'skills.json'), serializeManifest(validateManifest({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: [] }, STORE_MANIFEST_LIMITS), STORE_MANIFEST_LIMITS), { mode: 0o600 });
}
/** Every file and folder under a root, with inode, mode, mtime and content hash. */
function snapshot(root: string): string {
  if (!existsSync(root)) return 'absent';
  const rows: string[] = [];
  const visit = (p: string): void => {
    const s = lstatSync(p, { bigint: true });
    rows.push([relative(root, p), String(s.ino), (Number(s.mode) & 0o7777).toString(8), String(s.mtimeNs), s.isFile() ? createHash('sha256').update(readFileSync(p)).digest('hex') : s.isSymbolicLink() ? 'link' : 'dir'].join(' '));
    if (s.isDirectory()) for (const n of readdirSync(p).sort()) visit(join(p, n));
  };
  visit(root); return rows.join('\n');
}
const listJson = (w: World, cwd = w.work) => { const r = run(cwd, ['cache', 'list', '--json'], w.env); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout) as { entries: { id: string; name: string; scope: string }[] } & Record<string, unknown>; };

test('1. cache list in an empty home prints The cache is empty. and exits 0', t => {
  const w = world(t), r = run(w.work, ['cache', 'list'], w.env);
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, 'The cache is empty.\n'); assert.equal(r.stderr, '');
  assert.equal(existsSync(w.state), false, 'list creates nothing');
  const all = run(w.work, ['cache', 'prune', '--all'], w.env);
  assert.equal(all.status, 0, all.stderr); assert.equal(all.stdout, 'Nothing to prune.\n');
});

test('2. after skills add --global, cache list shows one entry with [store]', t => {
  const w = world(t); pinnedInStore(w);
  const r = run(w.work, ['cache', 'list'], w.env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^Skills cache: ${escape(join(stateOf(w), 'cache'))}\\n {2}[a-f0-9]{8} {2}completed {2}@synthetic/db-skills@0\\.0\\.1:skills/synthetic-db/collections {2}\\(\\d+ files, [\\d.]+ (?:B|KiB)\\) {2}\\[store\\]\\nTotal: 1 entries, [\\d.]+ (?:B|KiB)\\n$`));
});

test('3. cache list --json matches 4.1 field by field', t => {
  const w = world(t); pinnedInStore(w);
  const j = listJson(w);
  assert.deepEqual(Object.keys(j), ['format', 'stateRoot', 'entries', 'totals', 'unlisted', 'truncated', 'unreadableSources']);
  assert.equal(j.format, 'bowerloom/cache-list/v1beta1'); assert.equal(j.stateRoot, stateOf(w));
  assert.equal(j.unlisted, 0); assert.equal(j.truncated, false); assert.deepEqual(j.unreadableSources, []);
  const [e] = j.entries as unknown as Record<string, unknown>[];
  assert.deepEqual(Object.keys(e!), ['scope', 'id', 'projectId', 'status', 'name', 'active', 'stale', 'kind', 'label', 'skillName', 'files', 'bytes', 'key', 'references']);
  assert.equal(e!.scope, 'machine'); assert.match(String(e!.id), /^[a-f0-9]{32}$/); assert.equal(e!.projectId, null); assert.equal(e!.status, 'completed');
  assert.equal(e!.name, `op-${String(e!.id)}`); assert.equal(e!.active, false); assert.equal(e!.stale, false); assert.equal(e!.kind, 'npm');
  assert.equal(e!.label, '@synthetic/db-skills@0.0.1:skills/synthetic-db/collections'); assert.equal(typeof e!.skillName, 'string');
  assert.equal(typeof e!.files, 'number'); assert.equal(typeof e!.bytes, 'number'); assert.match(String(e!.key), /^[a-f0-9]{64}$/);
  assert.deepEqual(e!.references, { store: true, project: null });
  assert.deepEqual(j.totals, { entries: 1, bytes: e!.bytes });
});

test('4. prune --unreferenced after the store pin is removed: plan, exit 3, approve, Deleted 1 entries, then the cache is empty', t => {
  const w = world(t); pinnedInStore(w);
  const kept = run(w.work, ['cache', 'prune', '--unreferenced'], w.env);
  assert.equal(kept.status, 0, kept.stderr); assert.equal(kept.stdout, 'Nothing to prune.\n', 'the store still lists it');
  dropStorePins(w);
  const planned = run(w.work, ['cache', 'prune', '--unreferenced'], w.env);
  assert.equal(planned.status, 3, planned.stderr);
  assert.match(planned.stdout, /^Prune the skills cache\n {2}delete {2}@synthetic\/db-skills@0\.0\.1:skills\/synthetic-db\/collections {2}\(\d+ files, [\d.]+ (?:B|KiB)\) {2}cache [a-f0-9]{8}\nFrees about [\d.]+ (?:B|KiB)\.\nOther projects on this machine are not checked\.\nThis deletes cached skill bytes only\. It deletes no project file and no installed copy\.\nRevision: [a-f0-9]{64}\nApproval required\./);
  const revision = /^Revision: ([a-f0-9]{64})$/m.exec(planned.stdout)![1]!;
  const applied = run(w.work, ['cache', 'prune', '--unreferenced', '--approve', revision], w.env);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, new RegExp(`^Applied plan ${revision}\\.\\nDeleted 1 entries, about [\\d.]+ (?:B|KiB)\\.\\n$`));
  assert.equal(run(w.work, ['cache', 'list'], w.env).stdout, 'The cache is empty.\n');
  assert.deepEqual(JSON.parse(readFileSync(join(w.store, 'skills.json'), 'utf8')).skills, [], 'the store is not touched');
});

test('5, 6 and 7. prune with no selector, --all with --partial, and --entry abc exit 2 with the usage words', t => {
  const w = world(t);
  for (const args of [['cache', 'prune'], ['cache', 'prune', '--all', '--partial'], ['cache', 'prune', '--entry', 'abc'], ['cache'], ['cache', 'purge'], ['cache', 'list', '--all'], ['cache', 'list', '--approve', 'f'.repeat(64)], ['cache', 'prune', '--partial', '--partial'], ['cache', 'prune', '--entry']]) {
    const r = run(w.work, args, w.env);
    assert.equal(r.status, 2, args.join(' ')); assert.equal(errorCode(r.stderr), 'USAGE', args.join(' ')); assert.equal(errorMessage(r.stderr), USAGE_TEXT, args.join(' '));
  }
});

test('8. prune --entry <id8> picks that entry', t => {
  const w = world(t); pinnedInStore(w);
  const id = listJson(w).entries[0]!.id;
  const r = run(w.work, ['cache', 'prune', '--entry', id.slice(0, 8)], w.env);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stdout, new RegExp(` {2}delete {2}@synthetic/db-skills@0\\.0\\.1:skills/synthetic-db/collections {2}\\(\\d+ files, [\\d.]+ (?:B|KiB)\\) {2}cache ${id.slice(0, 8)} {2}\\[store\\]\\n`));
  assert.match(r.stdout, /\nWhen a command needs an entry that this project or your store still lists, Bowerloom fetches it again\.\n/);
  const missing = run(w.work, ['cache', 'prune', '--entry', '0123abcd0123abcd'], w.env);
  assert.equal(missing.status, 1); assert.equal(errorCode(missing.stderr), 'CACHE_ENTRY_NOT_FOUND');
});

test('9. prune --legacy deletes a hand-made legacy cache entry and leaves the project folder', t => {
  const w = world(t), pid = 'a'.repeat(32), op = 'b'.repeat(32);
  for (const p of [w.state, stateOf(w), join(stateOf(w), pid), join(stateOf(w), pid, 'cache'), join(stateOf(w), pid, 'cache', `op-${op}`), join(stateOf(w), pid, 'items')]) { mkdirSync(p, { mode: 0o700 }); chmodSync(p, 0o700); }
  writeFileSync(join(stateOf(w), pid, 'cache', `op-${op}`, 'leftover.json'), '{}\n', { mode: 0o600 });
  const list = run(w.work, ['cache', 'list'], w.env);
  assert.match(list.stdout, new RegExp(`^Earlier per-project caches: 1 entries in 1 projects\\n {2}${pid.slice(0, 8)}/${op.slice(0, 8)} {2}partial {4}unfinished fetch\\nTotal: 1 entries, 0 B\\n$`));
  const { planned, applied } = approve(w.work, ['cache', 'prune', '--legacy'], w.env);
  assert.match(JSON.parse(planned.stdout).revision, /^[a-f0-9]{64}$/);
  assert.equal(applied.status, 0, applied.stderr);
  assert.deepEqual(readdirSync(join(stateOf(w), pid)).sort(), ['cache', 'items']); assert.deepEqual(readdirSync(join(stateOf(w), pid, 'cache')), []);
});

test('10. prune run twice with the same approval: the second prints Nothing to prune. and exits 0', t => {
  const w = world(t); pinnedInStore(w); dropStorePins(w);
  const { body, applied } = approve(w.work, ['cache', 'prune', '--unreferenced'], w.env);
  assert.equal(applied.status, 0, applied.stderr);
  const again = run(w.work, ['cache', 'prune', '--unreferenced', '--approve', body.revision], w.env);
  assert.equal(again.status, 0, again.stderr); assert.equal(again.stdout, 'Nothing to prune.\n');
  const json = run(w.work, ['cache', 'prune', '--unreferenced', '--json'], w.env);
  assert.equal(json.status, 0); assert.equal((JSON.parse(json.stdout) as { nothingToDo: boolean }).nothingToDo, true);
});

test('11. help cache, cache --help, cache list --help and cache prune --help print the topic', t => {
  const w = world(t);
  for (const args of [['help', 'cache'], ['cache', '--help'], ['cache', 'list', '--help'], ['cache', 'prune', '--help']]) {
    const r = run(w.work, args, w.env); assert.equal(r.status, 0, args.join(' ')); assert.equal(r.stdout, heading + TOPICS.cache, args.join(' '));
  }
  assert.match(TOPICS.cache!, /^Usage:\n {2}bowerloom cache list \[--json\]\n {2}bowerloom cache prune \[--unreferenced\] \[--partial\] \[--legacy\] \[--all\] \[--entry <id-prefix>\]\.\.\. \[--approve <revision>\] \[--json\]\n\nBowerloom keeps the skill bytes/);
  assert.match(TOPICS.store!, /\n {2}bowerloom receipt clean \[--global\] \[--approve <revision>\] \[--json\]\n {2}bowerloom cache list \[--json\]\n {2}bowerloom cache prune /);
  assert.match(TOPICS.store!, /\n\ncache list shows the bytes that Bowerloom downloaded and kept on this machine\. cache prune deletes them after you approve a plan\.\n$/);
  assert.equal(TOPICS.store!.match(/Usage:/g)!.length, 1);
});

test('12. cache list and cache prune without --approve write nothing', t => {
  const w = world(t); pinnedInStore(w); dropStorePins(w);
  const dir = project(w, 'app'); mkdirSync(join(dir, '.bowerloom'), { mode: 0o755 });
  const before = { state: snapshot(w.state), store: snapshot(w.store), project: snapshot(dir) };
  for (const cwd of [w.work, dir]) {
    assert.equal(run(cwd, ['cache', 'list'], w.env).status, 0);
    assert.equal(run(cwd, ['cache', 'list', '--json'], w.env).status, 0);
    assert.equal(run(cwd, ['cache', 'prune', '--all'], w.env).status, 3);
    assert.equal(run(cwd, ['cache', 'prune', '--unreferenced', '--json'], w.env).status, 3);
  }
  assert.deepEqual({ state: snapshot(w.state), store: snapshot(w.store), project: snapshot(dir) }, before);
});

test('a state folder inside the store refuses STORE_STATE_NESTED; a state folder others can write refuses SKILLS_STATE_UNSAFE', t => {
  const w = world(t); mustApprove(w.work, ['team', 'create', 'studio', '--global'], w.env);
  const nested = run(w.work, ['cache', 'list'], { ...w.env, XDG_STATE_HOME: join(w.store, 'state') });
  assert.equal(nested.status, 1); assert.equal(errorCode(nested.stderr), 'STORE_STATE_NESTED');
  mkdirSync(w.state, { mode: 0o700 }); mkdirSync(stateOf(w), { mode: 0o700 }); mkdirSync(join(stateOf(w), 'cache'), { mode: 0o700 }); chmodSync(join(stateOf(w), 'cache'), 0o755);
  const unsafe = run(w.work, ['cache', 'prune', '--all'], w.env);
  assert.equal(unsafe.status, 1); assert.equal(errorCode(unsafe.stderr), 'SKILLS_STATE_UNSAFE');
});
