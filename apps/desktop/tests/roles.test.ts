// What kind of folder each one is: the guess, the person's choice, and the counting of pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { guessRole, looksLikeWiki, markdownFiles, pageCount, PAGE_LIMITS } from '../main/roles.js';
import { createController } from '../main/controller.js';
import { loadSettings, parseSettings } from '../main/config.js';
import { readSnapshot } from '../main/reader.js';
import { SAMPLE_DIR, tempDir } from './support.js';

const put = (path: string, text: string): void => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); };

test('a folder named knowledge-base, a wiki, or a registered knowledge folder is a context store; a folder holding others is a workspace; the rest are projects', t => {
  const base = tempDir(t), all = [join(base, 'Work'), join(base, 'Work', 'code'), join(base, 'Work', 'knowledge-base'), join(base, 'Wiki'), join(base, 'Reg'), join(base, 'Reg', 'sub'), join(base, 'Plain')];
  put(join(base, 'Wiki', 'wiki', 'a.md'), 'See [[b]].\n'); put(join(base, 'Plain', 'wiki', 'a.md'), 'No links here.\n');
  const role = (dir: string, registered: string[] = []) => guessRole({ dir, allDirs: all, registeredDirs: registered });
  assert.equal(role(join(base, 'Work', 'knowledge-base')), 'context-store'); assert.equal(role(join(base, 'Wiki')), 'context-store'); assert.equal(role(join(base, 'Reg'), [join(base, 'Reg')]), 'context-store'); assert.equal(role(join(base, 'Reg', 'sub'), [join(base, 'Reg')]), 'context-store');
  assert.equal(role(join(base, 'Work')), 'workspace'); assert.equal(role(join(base, 'Work', 'code')), 'project'); assert.equal(role(join(base, 'Plain')), 'project', 'a wiki folder with no [[links]] is not a wiki');
  assert.equal(looksLikeWiki(join(base, 'Wiki')), true); assert.equal(looksLikeWiki(join(base, 'Plain')), false);
  put(join(base, 'RawOnly', 'raw', 'n.md'), 'x [[y]]'); assert.equal(looksLikeWiki(join(base, 'RawOnly')), true);
});

test('pages are counted without following links, without hidden folders, and with a cap', t => {
  const base = tempDir(t); put(join(base, 'a.md'), '#a'); put(join(base, 'sub', 'b.MD'), '#b'); put(join(base, '.hidden', 'c.md'), '#c'); put(join(base, 'node_modules', 'd.md'), '#d'); put(join(base, 'e.txt'), 'no');
  const outside = tempDir(t); put(join(outside, 'secret.md'), 's'); symlinkSync(outside, join(base, 'link')); symlinkSync(join(outside, 'secret.md'), join(base, 'file-link.md'));
  assert.equal(pageCount(base), 2); assert.equal(markdownFiles(base, 1).capped, true); assert.ok(PAGE_LIMITS.files >= 5000);
});

test('a role the person chose wins over the guess, is remembered by the viewer only, can be cleared, and only for known folders', async t => {
  const app = join(tempDir(t), 'appdata'), controller = createController({ appDir: app, sampleDir: SAMPLE_DIR, version: 't', platform: 't', forcedMode: 'sample', pickFolder: async () => null, openExternal: async () => undefined });
  const first = await controller.getSnapshot(), p = first.projects.find(x => x.name === 'newsletter')!;
  assert.equal(p.role, 'project'); assert.equal(p.roleChosen, false);
  assert.match((await controller.setRole('/etc', 'workspace')).message!, /not in the list/); assert.match((await controller.setRole(p.key, 'bogus' as never)).message!, /not in the list/);
  assert.equal((await controller.setRole(p.key, 'context-store')).message, null);
  const second = (await controller.getSnapshot()).projects.find(x => x.name === 'newsletter')!; assert.equal(second.role, 'context-store'); assert.equal(second.roleGuess, 'project'); assert.equal(second.roleChosen, true); assert.equal(typeof second.pages, 'number');
  assert.deepEqual(loadSettings(app).settings.roles, { [p.key]: 'context-store' });
  assert.equal((await controller.setRole(p.key, null)).message, null); assert.equal((await controller.getSnapshot()).projects.find(x => x.name === 'newsletter')!.role, 'project'); assert.deepEqual(loadSettings(app).settings.roles, {});
});

test('the settings file keeps only valid roles for full paths', () => {
  const s = parseSettings(JSON.stringify({ roles: { '/a': 'workspace', '/b': 'nonsense', 'relative': 'project', '/c': 'context-store' } }))!;
  assert.deepEqual(s.roles, { '/a': 'workspace', '/c': 'context-store' });
  assert.deepEqual(parseSettings(JSON.stringify({ roles: ['project'] }))!.roles, {});
});

test('a registered knowledge folder that is the store makes it a context store, with who reads it', async t => {
  const { sampleWorld } = await import('./support.js'); const { world, ctx } = sampleWorld(t);
  // The sample registers ~/Notes/team-notes: make that folder a Bowerloom folder, and it is a context store read by the two projects with a grant.
  mkdirSync(join(world.home, 'Notes', 'team-notes', '.bowerloom'), { recursive: true });
  const { snapshot } = await readSnapshot({ ...ctx, roots: [world.projects, join(world.home, 'Notes', 'team-notes')] });
  const store = snapshot.projects.find(x => x.name === 'team-notes')!;
  assert.equal(store.role, 'context-store'); assert.ok(store.pages! >= 4); assert.deepEqual([...new Set(store.readBy.map(r => r.name))].sort(), ['newsletter', 'studio-site']);
  assert.deepEqual(store.readBy.filter(r => r.via === 'reading-list').map(r => `${r.name}:${r.list}`).sort(), ['newsletter:team-notes', 'newsletter:team-titles', 'studio-site:team-notes']);
});
