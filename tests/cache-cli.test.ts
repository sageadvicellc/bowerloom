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
import { renderCacheList, renderCachePrune, renderNothingToPrune, renderPruneResult, renderStopped } from '../apps/cli/src/cache.js';
import { cacheLockSlot, lockHolder } from '../packages/project-context/src/index.js';
import { spawn } from 'node:child_process';
import { cli, baseEnv } from './support/config-cli.js';
import type { CacheList, CachePrunePlan, PickedEntry } from '../packages/project-sync/src/index.js';
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
  assert.deepEqual(Object.keys(j), ['format', 'stateRoot', 'entries', 'totals', 'unlisted', 'truncated', 'unreadableSources', 'unlistedNames', 'unreadable']);
  assert.deepEqual(j.unlistedNames, []); assert.deepEqual(j.unreadable, []);
  assert.equal(j.format, 'bowerloom/cache-list/v1beta1'); assert.equal(j.stateRoot, stateOf(w));
  assert.equal(j.unlisted, 0); assert.equal(j.truncated, false); assert.deepEqual(j.unreadableSources, []);
  const [e] = j.entries as unknown as Record<string, unknown>[];
  assert.deepEqual(Object.keys(e!), ['scope', 'id', 'projectId', 'status', 'name', 'active', 'stale', 'kind', 'label', 'skillName', 'files', 'bytes', 'key', 'references', 'partialReason', 'next']);
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
  // Review L1 and L3: an inspection that fails is an unreadable entry, and an unknown size never prints as 0 B.
  assert.equal(list.stdout, `Earlier per-project caches: 1 entries in 1 projects\n  ${pid.slice(0, 8)}/${op.slice(0, 8)}  partial    unreadable entry  (size unknown)\nTotal: 1 entries, size unknown\n`);
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

// --- Round 2 of the reviews of PR 99 ---

/** Many unreadable operation folders, each with a few files, so a prune takes a while. */
function manyEntries(w: World, n: number): string {
  const cache = join(stateOf(w), 'cache');
  for (const p of [w.state, stateOf(w), cache]) { mkdirSync(p, { mode: 0o700 }); chmodSync(p, 0o700); }
  for (let i = 0; i < n; i++) {
    const op = join(cache, `op-${i.toString(16).padStart(32, '0')}`); mkdirSync(op, { mode: 0o700 }); chmodSync(op, 0o700);
    for (let f = 0; f < 8; f++) writeFileSync(join(op, `f${f}.md`), 'x\n', { mode: 0o600 });
  }
  return cache;
}
function runAsync(cwd: string, args: string[], env: Record<string, string>, onSpawn: (child: ReturnType<typeof spawn>) => void): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...baseEnv(), ...env } as NodeJS.ProcessEnv });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    child.on('close', status => resolve({ status, stdout, stderr }));
    onSpawn(child);
  });
}
/** Starts an approved prune of every entry, waits until it has deleted some, checks the lock answers, then sends SIGINT. */
async function interrupted(w: World, json: boolean) {
  const n = 2500, cache = manyEntries(w, n);
  const planned = run(w.work, ['cache', 'prune', '--partial', '--json'], w.env); assert.equal(planned.status, 3, planned.stderr);
  const revision = (JSON.parse(planned.stdout) as { revision: string }).revision;
  let holder = '';
  const result = await runAsync(w.work, ['cache', 'prune', '--partial', '--approve', revision, ...(json ? ['--json'] : [])], w.env, child => {
    const poll = async (): Promise<void> => {
      for (;;) {
        await new Promise(r => setTimeout(r, 5));
        const left = readdirSync(cache).length;
        if (left < n - 20) { holder = await lockHolder(cacheLockSlot(cache), 1000); child.kill('SIGINT'); return; }
      }
    };
    void poll();
  });
  return { result, n, left: readdirSync(cache).length, holder };
}

test('H1. Ctrl-C stops a long prune between two deletes with exit 130, and the lock is served while it runs', async t => {
  const w = world(t), { result, n, left, holder } = await interrupted(w, false);
  assert.equal(holder, 'this', 'the cache lock answered during the prune');
  assert.equal(result.status, 130, result.stderr);
  const m = /^Stopped\. Deleted (\d+) of (\d+) entries\. It stopped at cache [a-f0-9]{8}\.(?: Its folder \S+ is partly deleted, and bowerloom cache prune --partial finishes it\.)? Run bowerloom cache list to see what is left\.\n$/.exec(result.stdout);
  assert.ok(m, result.stdout); assert.equal(Number(m![2]), n); assert.ok(Number(m![1]) > 0 && Number(m![1]) < n);
  assert.equal(left, n - Number(m![1]), 'it deleted exactly what it reported');
});

test('L7. exit 130 keeps --json', async t => {
  const w = world(t), { result, n } = await interrupted(w, true);
  assert.equal(result.status, 130, result.stderr);
  const body = JSON.parse(result.stdout) as { stopped: boolean; deleted: number; of: number; stoppedAt: string };
  assert.equal(body.stopped, true); assert.equal(body.of, n); assert.ok(body.deleted > 0 && body.deleted < n); assert.match(body.stoppedAt, /^cache [a-f0-9]{8}$/);
});

test('E (tech lead). inside ~/.bowerloom or in a home folder with bowerloom.json, the project counts as none, not unknown', t => {
  const w = world(t); mustApprove(w.work, ['team', 'create', 'studio', '--global'], w.env);
  for (const cwd of [w.store, join(w.store, 'teams')]) assert.deepEqual(listJson(w, cwd).unreadableSources, [], cwd);
  writeFileSync(join(w.home, 'bowerloom.json'), '{}\n', { mode: 0o644 });
  assert.deepEqual(listJson(w, w.home).unreadableSources, [], 'PROJECT_ROOT_REFUSED');
});

const entry = (over: Partial<CacheList['entries'][number]>): CacheList['entries'][number] => ({ scope: 'machine', id: 'a'.repeat(32), projectId: null, status: 'completed', name: `op-${'a'.repeat(32)}`, active: false, stale: false, kind: 'npm', label: '@s/x@1.0.0:skills/x', skillName: 'x', files: 3, bytes: 2048, key: null, references: { store: false, project: false }, partialReason: null, next: null, ...over });
const list = (over: Partial<CacheList>): CacheList => ({ format: 'bowerloom/cache-list/v1beta1', stateRoot: '/s', entries: [], totals: { entries: 0, bytes: 0 }, unlisted: 0, truncated: false, unreadableSources: [], unlistedNames: [], unreadable: [], ...over });
const plan = (over: Partial<CachePrunePlan>): CachePrunePlan => ({ format: 'bowerloom/cache-prune-plan/v1beta1', stateRoot: '/s', selectors: { unreferenced: false, partial: false, legacy: false, all: true, entries: [] }, picked: [], skipped: [], freed: 0, projectChecked: true, truncated: false, unreadableSources: [], unreadable: [], unlisted: 0, writesAuthorized: false, executionAuthorized: false, revision: 'f'.repeat(64), ...over });

test('M3, L1 and M1. cache list words: unlisted names, unknown sizes, the truncation, and the cause of an unread source', () => {
  assert.equal(renderCacheList(list({})), 'The cache is empty.\n');
  assert.equal(renderCacheList(list({ unlisted: 1, unlistedNames: [{ place: 'cache', name: 'op-x', reason: 'its mode is 0755, not 0700', next: null }] })),
    'The cache holds no entries.\nNot listed: 1 names that cache prune never deletes.\n  cache/op-x: its mode is 0755, not 0700\n');
  const partial = entry({ id: 'b'.repeat(32), name: `op-${'b'.repeat(32)}`, status: 'partial', label: null, files: null, bytes: null, kind: null, partialReason: 'unfinished-fetch' });
  const text = renderCacheList(list({ entries: [entry({}), partial], totals: { entries: 2, bytes: 2048 }, truncated: true, unreadableSources: ['store'], unreadable: [{ source: 'store', code: 'MANIFEST_INVALID', item: 'skills.json' }] }));
  assert.equal(text, [
    'Skills cache: /s/cache',
    '  aaaaaaaa  completed  @s/x@1.0.0:skills/x  (3 files, 2.0 KiB)',
    '  bbbbbbbb  partial    unfinished fetch  (size unknown)',
    'Total: 2 entries, 2.0 KiB and 1 of unknown size',
    'More entries exist. Only the first 4096 are shown.',
    'Some references were not checked: store (MANIFEST_INVALID, skills.json). Next: bowerloom store status',
    '',
  ].join('\n'));
  const labels = [['changed', 'skill x, changed since it was written'], ['unreadable', 'unreadable entry'], ['prune-leftover', 'left by a stopped prune'], ['write-leftover', 'left by a stopped write']] as const;
  for (const [reason, words] of labels) assert.match(renderCacheList(list({ entries: [entry({ status: 'partial', partialReason: reason, label: reason === 'changed' ? 'skill x' : null, files: null, bytes: null })], totals: { entries: 1, bytes: 0 } })), new RegExp(`  partial    ${words}  \\(size unknown\\)\\n`), reason);
});

test('M3, L1, L4 and L9. prune words: the notes on every path, unknown sizes, and store-remote entries', () => {
  const unread = { unreadableSources: ['project' as const], unreadable: [{ source: 'project' as const, code: 'LOCK_INVALID', item: 'bowerloom.lock.json' }] };
  const unreferenced = { unreferenced: true, partial: false, legacy: false, all: false, entries: [] };
  assert.equal(renderNothingToPrune(plan({ ...unread, selectors: unreferenced, truncated: true, skipped: [{ scope: 'machine', id: 'c'.repeat(32), projectId: null, reason: 'active', label: null }] })), [
    'Some references were not checked: project (LOCK_INVALID, bowerloom.lock.json). --unreferenced picks nothing. Next: bowerloom status',
    'More entries exist. Only the first 4096 are listed. Run the command again after this one.',
    'Skipped 1 entries that another command is using.',
    'Nothing to prune.', '',
  ].join('\n'));
  assert.equal(renderNothingToPrune(plan({ ...unread })), 'Nothing to prune.\n', 'L4: the note only with --unreferenced');
  const store = { scope: 'store' as const, id: 'd'.repeat(64), name: `skill-x-${'d'.repeat(64)}`, projectId: null, status: 'completed' as const, label: 'skill x', files: 1, bytes: 10, references: { store: false, project: null }, stale: false, partialReason: null as PickedEntry['partialReason'], bound: { snapshotRevision: null, receiptRevision: null, contentHash: 'd'.repeat(64) } };
  const unknown = { ...store, scope: 'machine' as const, id: 'e'.repeat(32), name: `op-${'e'.repeat(32)}`, status: 'partial' as const, label: null, files: null, bytes: null, partialReason: 'unreadable' as const, bound: { snapshotRevision: null, receiptRevision: null, contentHash: null } };
  const words = renderCachePrune(plan({ picked: [unknown, store], freed: 10, selectors: unreferenced, projectChecked: false }));
  assert.equal(words, [
    'Prune the skills cache',
    '  delete  unreadable entry  cache eeeeeeee',
    '  delete  skill x  (1 files, 10 B)  store-cache dddddddd',
    'Frees about 10 B, plus 1 entries of unknown size.',
    'Store cache entries come from your store remote. Fetching one again needs the network, and a private store needs BOWERLOOM_GITHUB_TOKEN.',
    'Other projects on this machine are not checked.',
    'This deletes cached skill bytes only. It deletes no project file and no installed copy.',
  ].join('\n'));
  assert.match(renderCachePrune(plan({ picked: [unknown], selectors: unreferenced })), /\nFrees an unknown amount: 1 entries of unknown size\.\n/);
  assert.equal(renderPruneResult({ format: 'bowerloom/cache-prune-result/v1beta1', planRevision: 'f'.repeat(64), deleted: [{ scope: 'machine', id: 'e'.repeat(32), projectId: null }, { scope: 'store', id: 'd'.repeat(64), projectId: null }], skipped: [], freed: 10, executionAuthorized: false }, plan({ picked: [unknown, store], freed: 10 })),
    'Deleted 2 entries, about 10 B, plus 1 of unknown size.\n');
  assert.equal(renderStopped({ deleted: 0, of: 3, stoppedAt: 'cache eeeeeeee' }), 'Stopped. Deleted 0 of 3 entries. It stopped at cache eeeeeeee. Run bowerloom cache list to see what is left.\n');
});

// --- Round 3 of the reviews of PR 99 ---

test('M-A, M-C and L-b. the words name the fix for a leftover, and count the names that are never pruned', () => {
  const left = entry({ id: '.prune-op-x-01234567', name: '.prune-op-x-01234567', status: 'partial', label: null, files: null, bytes: null, kind: null, partialReason: 'prune-leftover', next: 'chmod -R u+rwx /s/cache/.prune-op-x-01234567' });
  assert.equal(renderCacheList(list({ entries: [left], totals: { entries: 1, bytes: 0 }, unlisted: 1, unlistedNames: [{ place: 'cache', name: '.tmp-y', reason: 'it is not a folder', next: 'rm /s/cache/.tmp-y' }] })), [
    'Skills cache: /s/cache',
    '  .prune-op-x-01234567  partial    left by a stopped prune  (size unknown)',
    '    Next: chmod -R u+rwx /s/cache/.prune-op-x-01234567',
    'Total: 1 entries, size unknown',
    'Not listed: 1 names that cache prune never deletes.',
    '  cache/.tmp-y: it is not a folder. Next: rm /s/cache/.tmp-y',
    '',
  ].join('\n'));
  const one = { scope: 'machine' as const, id: 'e'.repeat(32), name: `op-${'e'.repeat(32)}`, projectId: null, status: 'completed' as const, label: 'x', files: 1, bytes: 10, references: { store: false, project: false }, stale: false, partialReason: null, bound: { snapshotRevision: null, receiptRevision: null, contentHash: null } };
  assert.match(renderCachePrune(plan({ picked: [one], freed: 10, unlisted: 7 })), /\n7 names are not listed and are never pruned\. bowerloom cache list shows why\.\nFrees about 10 B\.\n/);
  assert.equal(renderNothingToPrune(plan({ unlisted: 2 })), '2 names are not listed and are never pruned. bowerloom cache list shows why.\nNothing to prune.\n');
  assert.equal(renderPruneResult({ format: 'bowerloom/cache-prune-result/v1beta1', planRevision: 'f'.repeat(64), deleted: [{ scope: 'machine', id: 'e'.repeat(32), projectId: null }], skipped: [], freed: 10, executionAuthorized: false }, plan({ picked: [one], freed: 10, unlisted: 7 })),
    'Deleted 1 entries, about 10 B.\n7 names are not listed and are never pruned. bowerloom cache list shows why.\n');
  assert.equal(renderStopped({ deleted: 0, of: 1, stoppedAt: 'cache eeeeeeee', leftover: '/s/cache/.prune-op-e-01234567' }),
    'Stopped. Deleted 0 of 1 entries. It stopped at cache eeeeeeee. Its folder /s/cache/.prune-op-e-01234567 is partly deleted, and bowerloom cache prune --partial finishes it. Run bowerloom cache list to see what is left.\n');
});

test('L-a. Ctrl-C stops inside one large entry; the lock answers while it is deleted', async t => {
  const w = world(t), cache = manyEntries(w, 0), op = join(cache, `op-${'0'.repeat(32)}`);
  mkdirSync(op, { mode: 0o700 }); chmodSync(op, 0o700);
  for (let f = 0; f < 20000; f++) writeFileSync(join(op, `f${f}.md`), 'x\n', { mode: 0o600 });
  const planned = run(w.work, ['cache', 'prune', '--partial', '--json'], w.env); assert.equal(planned.status, 3, planned.stderr);
  const revision = (JSON.parse(planned.stdout) as { revision: string }).revision;
  let holder = '';
  const result = await runAsync(w.work, ['cache', 'prune', '--partial', '--approve', revision], w.env, child => {
    void (async () => {
      for (;;) {
        await new Promise(r => setTimeout(r, 5));
        const renamed = readdirSync(cache).find(n => n.startsWith('.prune-'));
        if (renamed && readdirSync(join(cache, renamed)).length < 19900) { holder = await lockHolder(cacheLockSlot(cache), 1000); child.kill('SIGINT'); return; }
      }
    })();
  });
  assert.equal(holder, 'this', 'the cache lock answered during one entry');
  assert.equal(result.status, 130, result.stderr);
  assert.match(result.stdout, new RegExp(`^Stopped\\. Deleted 0 of 1 entries\\. It stopped at cache 00000000\\. Its folder ${escape(cache)}/\\.prune-op-0{32}-[a-f0-9]{8} is partly deleted, and bowerloom cache prune --partial finishes it\\. Run bowerloom cache list to see what is left\\.\\n$`));
  const finish = run(w.work, ['cache', 'prune', '--partial', '--json'], w.env); assert.equal(finish.status, 3);
  const done = run(w.work, ['cache', 'prune', '--partial', '--approve', (JSON.parse(finish.stdout) as { revision: string }).revision], w.env);
  assert.equal(done.status, 0, done.stderr); assert.deepEqual(readdirSync(cache), []);
});
