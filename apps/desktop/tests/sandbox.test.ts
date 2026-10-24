// The sandbox: made by the tool from Bowerloom's own commands, read by the viewer like any other data, and deleted only when it is exactly the sandbox.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SENTINEL_NAME, SENTINEL_TEXT, BoundaryError, createBoundary } from '../main/boundary.js';
import { deleteSandbox, ensureSandbox, escapingLink, sandboxExists, sandboxPaths } from '../main/sandbox.js';
import { createController } from '../main/controller.js';
import { markdownFiles } from '../main/roles.js';
import { DESKTOP, SAMPLE_DIR, tempDir } from './support.js';

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-sandbox-test-')));
process.once('exit', () => rmSync(tmp, { recursive: true, force: true }));
const ROOT = join(tmp, 'Test Sandbox');
const tool = (env: Record<string, string>, ...args: string[]) => spawnSync(process.execPath, [join(DESKTOP, 'tools', 'make-sandbox.mjs'), ...args], { encoding: 'utf8', timeout: 240000, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env } });
const refused = (code: string) => (e: unknown) => e instanceof BoundaryError && e.code === code;

before(() => { const r = tool({ BOWERLOOM_VIEWER_SANDBOX: ROOT }); assert.equal(r.status, 0, r.stderr + r.stdout); }, { timeout: 300000 });

test('the tool makes the sandbox with its mark, its own pretend home, and the shape of the real setup', () => {
  const p = sandboxPaths(ROOT);
  assert.equal(readFileSync(join(ROOT, SENTINEL_NAME), 'utf8'), SENTINEL_TEXT); assert.ok(sandboxExists(ROOT));
  for (const dir of [join(p.home, '.bowerloom'), join(p.workspace, '.bowerloom'), join(p.workspace, 'code', '.bowerloom'), join(p.workspace, 'knowledge-base', '.bowerloom'), join(p.workspace, 'site-app', 'bowerloom.json'), join(p.workspace, 'archive-app', 'bowerloom.lock.json')]) assert.ok(existsSync(dir), dir);
  const store = join(p.home, '.bowerloom');
  assert.deepEqual(readdirSync(join(store, 'skills')).sort(), ['house-style', 'meeting-notes']); assert.ok(JSON.stringify(JSON.parse(readFileSync(join(store, 'skills.json'), 'utf8')).skills.map((s: { id: string }) => s.id)) === '["brand-voice","house-style","meeting-notes"]');
  assert.deepEqual(readdirSync(join(store, 'prompts')).sort(), ['launch-checklist.md', 'weekly-update.md']); assert.deepEqual(readdirSync(join(store, 'teams')).sort(), ['research-desk', 'studio']);
  assert.match(readFileSync(join(store, 'teams', 'studio', 'agents', 'publisher.md'), 'utf8'), /bypassPermissions/);
  assert.equal(escapingLink(ROOT), null, 'no link leaves the sandbox');
});

test('the invented wiki has 40 to 60 pages, links between them, tags, an index, a hub, broken links, and orphans', () => {
  const kb = join(sandboxPaths(ROOT).workspace, 'knowledge-base'), wiki = markdownFiles(join(kb, 'wiki')).files;
  assert.ok(wiki.length >= 40 && wiki.length <= 60, String(wiki.length));
  const texts = new Map(wiki.map(f => [f.slice(kb.length), readFileSync(f, 'utf8')])); const all = [...texts.values()].join('\n');
  assert.ok(/\[\[[a-z]+-\d\d\]\]/.test(all)); assert.ok(/#[a-z]+/.test(all)); assert.ok(texts.has('/wiki/index.md') && texts.has('/wiki/hub.md')); assert.ok(all.includes('[[a-page-that-is-not-there]]'));
  const linked = new Set([...all.matchAll(/\[\[([^\]]+)\]\]|\]\(([^)]+)\)/g)].map(m => (m[1] ?? m[2]!).replace(/.*\//, '').replace(/\.md$/, '')));
  const orphans = [...texts.keys()].filter(k => !['/wiki/index.md', '/wiki/hub.md'].includes(k) && !linked.has(k.replace(/.*\//, '').replace(/\.md$/, '')));
  assert.ok(orphans.length >= 3, `orphans: ${orphans.length}`);
});

test('the viewer reads the sandbox in its own mode: roles, the shared library, a drifted project, a held reading list, an invalid lock, and powerful settings', async t => {
  const c = createController({ appDir: join(tempDir(t), 'app'), sampleDir: SAMPLE_DIR, version: 't', platform: 't', forcedMode: 'sandbox', sandboxDir: ROOT, pickFolder: async () => null, openExternal: async () => undefined });
  const info = await c.getInfo(); assert.equal(info.mode, 'sandbox'); assert.deepEqual(info.sandbox, { path: ROOT, exists: true });
  const s = await c.getSnapshot(), by = (n: string) => s.projects.find(p => p.name.endsWith(n))!;
  assert.equal(s.mode, 'sandbox'); assert.ok(s.store.path.startsWith(ROOT), 'its own pretend home, not the real one'); assert.equal(s.store.state, 'ready');
  assert.deepEqual([s.library.skills.length, s.library.prompts.length, s.library.teams.length], [3, 2, 2]);
  assert.equal(by('workspace').role, 'workspace'); assert.equal(by('knowledge-base').role, 'context-store'); assert.equal(by('code').role, 'project'); assert.equal(by('site-app').role, 'project');
  assert.ok(by('knowledge-base').pages! >= 40); assert.ok(by('knowledge-base').readBy.some(r => r.name === 'site-app'));
  assert.equal(by('site-app').status, 'drifted'); assert.equal(by('archive-app').status, 'lock-problem'); assert.equal(by('archive-app').lockCode, 'LOCK_INVALID');
  const held = by('site-app').slices.find(x => x.id === 'kb-titles')!; assert.ok(held.hold !== null); assert.equal(by('site-app').slices.find(x => x.id === 'kb-index')!.hold, null);
  assert.ok(by('site-app').agents.some(a => a.notices.includes('permissionMode:bypassPermissions')));
  assert.equal(s.folders.length, 1); assert.equal(s.folders[0]!.name, 'knowledge-base'); assert.equal(s.folders[0]!.allowed.length, 1);
  assert.deepEqual(by('workspace').layout, 'older'); assert.deepEqual(by('code').layout, 'older');
});

test('a controller refuses the sandbox mode when the sandbox has not been made', async t => {
  const c = createController({ appDir: join(tempDir(t), 'app'), sampleDir: SAMPLE_DIR, version: 't', platform: 't', forcedMode: null, sandboxDir: join(tempDir(t), 'None Sandbox'), pickFolder: async () => null, openExternal: async () => undefined });
  await assert.rejects(() => c.chooseMode('sandbox'), /has not been made yet/);
});

test('reset deletes nothing unless the path equals the constant AND the mark is there AND no link leaves', t => {
  const home = tempDir(t), real = createBoundary({ roots: [], home });
  const make = (name: string, mark = true) => { const r = join(home, name); mkdirSync(r); writeFileSync(join(r, 'precious.txt'), 'keep'); if (mark) writeFileSync(join(r, SENTINEL_NAME), SENTINEL_TEXT); return r; };
  const unmarked = make('Plain Sandbox', false), marked = make('Marked Sandbox');
  const b = (root: string) => createBoundary({ roots: [root], home });
  // Not the constant: a marked sandbox is still not deleted when it is not the expected path.
  assert.throws(() => deleteSandbox({ root: marked, expected: join(home, 'Other Sandbox'), boundary: b(marked) }), refused('NOT_THE_SANDBOX')); assert.ok(existsSync(join(marked, 'precious.txt')));
  // No mark: refused, files stay.
  assert.throws(() => deleteSandbox({ root: unmarked, expected: unmarked, boundary: b(unmarked) }), refused('NO_SENTINEL')); assert.ok(existsSync(join(unmarked, 'precious.txt')));
  // A link that leads outside: refused.
  const outside = tempDir(t); writeFileSync(join(outside, 'f'), 'x'); symlinkSync(outside, join(marked, 'leaves'));
  assert.throws(() => deleteSandbox({ root: marked, expected: marked, boundary: b(marked) }), refused('LINK')); assert.ok(existsSync(join(marked, 'precious.txt'))); assert.ok(existsSync(join(outside, 'f')));
  unlinkSync(join(marked, 'leaves'));
  // A link that stays inside is fine, and then the delete happens, and only inside.
  symlinkSync(join(marked, 'precious.txt'), join(marked, 'stays')); assert.equal(escapingLink(marked), null);
  assert.equal(deleteSandbox({ root: marked, expected: marked, boundary: b(marked) }), marked); assert.equal(existsSync(marked), false); assert.ok(existsSync(join(outside, 'f')));
  // The folder that holds real work is never a sandbox.
  const real2 = join(home, 'Real Sandbox'); mkdirSync(join(real2, '.bowerloom'), { recursive: true }); writeFileSync(join(real2, SENTINEL_NAME), SENTINEL_TEXT);
  assert.throws(() => deleteSandbox({ root: real2, expected: real2, boundary: b(real2) }), refused('ROOT_IS_REAL')); assert.ok(existsSync(join(real2, '.bowerloom')));
  void real;
});

test('making the sandbox refuses a folder that is not the constant, one that is already there with other things in it, and a link', t => {
  const home = tempDir(t);
  assert.throws(() => ensureSandbox({ root: join(home, 'A Sandbox'), expected: join(home, 'B Sandbox') }), refused('NOT_THE_SANDBOX'));
  const taken = join(home, 'Taken Sandbox'); mkdirSync(taken); writeFileSync(join(taken, 'mine.txt'), 'mine'); assert.throws(() => ensureSandbox({ root: taken, expected: taken, boundary: createBoundary({ roots: [taken], home }) }), refused('NO_SENTINEL')); assert.equal(readFileSync(join(taken, 'mine.txt'), 'utf8'), 'mine'); assert.equal(existsSync(join(taken, SENTINEL_NAME)), false);
  const linked = join(home, 'Linked Sandbox'); symlinkSync(tempDir(t), linked); assert.throws(() => ensureSandbox({ root: linked, expected: linked }), refused('ROOT_NOT_FOLDER'));
  assert.throws(() => ensureSandbox({ root: join(home, 'Playground'), expected: join(home, 'Playground') }), refused('ROOT_NAME'));
});

test('the tool\'s reset on a folder with no mark, or with a name that is not a sandbox, leaves it exactly as it was', t => {
  const home = tempDir(t), plain = join(home, 'Fake Sandbox'); mkdirSync(plain); writeFileSync(join(plain, 'precious.txt'), 'keep');
  const r = tool({ BOWERLOOM_VIEWER_SANDBOX: plain }, '--reset'); assert.notEqual(r.status, 0); assert.equal(readFileSync(join(plain, 'precious.txt'), 'utf8'), 'keep'); assert.deepEqual(readdirSync(plain), ['precious.txt']);
  const named = join(home, 'Documents'); mkdirSync(named); writeFileSync(join(named, 'precious.txt'), 'keep'); writeFileSync(join(named, SENTINEL_NAME), SENTINEL_TEXT);
  const r2 = tool({ BOWERLOOM_VIEWER_SANDBOX: named }, '--reset'); assert.notEqual(r2.status, 0); assert.equal(readFileSync(join(named, 'precious.txt'), 'utf8'), 'keep');
  assert.equal(tool({}, '--nope').status, 2);
});

test('the tool\'s reset rebuilds the sandbox from scratch and takes away what was added', { timeout: 300000 }, () => {
  writeFileSync(join(ROOT, 'junk.txt'), 'junk'); assert.ok(existsSync(join(ROOT, 'junk.txt')));
  const r = tool({ BOWERLOOM_VIEWER_SANDBOX: ROOT }, '--reset'); assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /The old sandbox was deleted/);
  assert.equal(existsSync(join(ROOT, 'junk.txt')), false); assert.ok(sandboxExists(ROOT)); assert.ok(existsSync(join(sandboxPaths(ROOT).workspace, 'knowledge-base', 'wiki', 'hub.md')));
  const again = tool({ BOWERLOOM_VIEWER_SANDBOX: ROOT }); assert.equal(again.status, 0); assert.match(again.stdout, /already there/);
});
