// What kind of folder each one is: the guess, the person's choice, and the counting of pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { guessRole, looksLikeWiki, markdownFiles, pageCount, PAGE_LIMITS, WIKI_RULES } from '../main/roles.js';
import { createController } from '../main/controller.js';
import { loadSettings, parseSettings } from '../main/config.js';
import { readSnapshot } from '../main/reader.js';
import { SAMPLE_DIR, clone, sampleSnapshot, tempDir } from './support.js';

const put = (path: string, text: string): void => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); };

/** A wiki of `n` pages: an index, and pages that link to each other. */
const wiki = (dir: string, n = 12, extra: Record<string, string> = {}): void => {
  put(join(dir, 'wiki', 'index.md'), '# Index\n' + Array.from({ length: n }, (_, i) => `- [[page-${i}]]`).join('\n'));
  for (let i = 0; i < n; i++) put(join(dir, 'wiki', `page-${i}.md`), `# Page ${i}\nSee [[page-${(i + 1) % n}]] and [next](page-${(i + 2) % n}.md).\n`);
  for (const [f, t] of Object.entries(extra)) put(join(dir, f), t);
};

test('a role is a context store only when it looks like a wiki or was registered; a name alone is not enough', async t => {
  const base = tempDir(t), all = [join(base, 'Work'), join(base, 'Work', 'code'), join(base, 'Work', 'knowledge-base'), join(base, 'Wiki'), join(base, 'Reg'), join(base, 'Reg', 'sub'), join(base, 'Plain'), join(base, 'NamedOnly', 'knowledge-base'), join(base, 'Docs')];
  wiki(join(base, 'Wiki')); put(join(base, 'Plain', 'wiki', 'a.md'), 'No links here.\n'); put(join(base, 'Work', 'knowledge-base', 'notes.md'), 'x'); put(join(base, 'NamedOnly', 'knowledge-base', 'README.md'), 'Only a name.\n');
  const role = (dir: string, registered: string[] = []) => guessRole({ dir, allDirs: all, registeredDirs: registered });
  assert.equal(await role(join(base, 'Wiki')), 'context-store'); assert.equal(await role(join(base, 'Reg'), [join(base, 'Reg')]), 'context-store'); assert.equal(await role(join(base, 'Reg', 'sub'), [join(base, 'Reg')]), 'context-store');
  assert.equal(await role(join(base, 'Work')), 'workspace'); assert.equal(await role(join(base, 'Work', 'code')), 'project'); assert.equal(await role(join(base, 'Plain')), 'project', 'a wiki folder with no links is not a wiki');
  assert.equal(await role(join(base, 'Work', 'knowledge-base')), 'project', 'a folder merely named knowledge-base is not a store');
  assert.equal(await role(join(base, 'NamedOnly', 'knowledge-base')), 'project');
  // A code project with a docs folder is not a wiki, however many linked pages the docs hold.
  wiki(join(base, 'Docs'), 12); for (let i = 0; i < 80; i++) put(join(base, 'Docs', 'src', `f${i}.ts`), 'export {}');
  assert.equal(await role(join(base, 'Docs')), 'project', 'mostly code is not a wiki');
  assert.equal(await looksLikeWiki(join(base, 'Wiki')), true); assert.equal(await looksLikeWiki(join(base, 'Plain')), false);
});

test('the wiki test needs an index page, several pages, and several linked ones, and is not fooled by one [[link]]', async t => {
  const base = tempDir(t);
  put(join(base, 'One', 'wiki', 'a.md'), 'See [[b]].'); assert.equal(await looksLikeWiki(join(base, 'One')), false, 'one link in one page');
  for (let i = 0; i < 12; i++) put(join(base, 'NoIndex', `p${i}.md`), `[[p${(i + 1) % 12}]]`); assert.equal(await looksLikeWiki(join(base, 'NoIndex')), false, 'no index or overview page');
  for (let i = 0; i < 12; i++) put(join(base, 'NoLinks', `p${i}.md`), `Words only ${i}`); put(join(base, 'NoLinks', 'index.md'), 'Index'); assert.equal(await looksLikeWiki(join(base, 'NoLinks')), false, 'pages that link to nothing');
  put(join(base, 'Web', 'index.md'), '[a](https://x.example/a.md)'); for (let i = 0; i < 12; i++) put(join(base, 'Web', `p${i}.md`), `[a](https://x.example/${i}.md)`); assert.equal(await looksLikeWiki(join(base, 'Web')), false, 'web links are not links between pages');
  wiki(join(base, 'Yes')); assert.equal(await looksLikeWiki(join(base, 'Yes')), true);
  for (let i = 0; i < 6; i++) put(join(base, 'Few', `p${i}.md`), '[[p]]'); put(join(base, 'Few', 'index.md'), '[[p]]'); assert.equal(await looksLikeWiki(join(base, 'Few')), false, 'too few pages');
});

test('a large wiki is judged by a sample spread over all its pages, and a folder with links the first pages lack still passes', async t => {
  const base = tempDir(t);
  put(join(base, 'Big', 'index.md'), 'Index');
  for (let i = 0; i < 300; i++) put(join(base, 'Big', 'notes', `n${String(i).padStart(3, '0')}.md`), i >= 150 ? `[[n${i - 1}]]` : 'No link in the early pages.');
  assert.equal(await looksLikeWiki(join(base, 'Big')), true, 'linked pages come late in name order, but the sample is spread');
  assert.ok(WIKI_RULES.sample >= 100 && WIKI_RULES.walk >= 300);
});

test('the guess is made with asynchronous reads and never follows a link', async t => {
  const base = tempDir(t), outside = tempDir(t); wiki(outside); symlinkSync(join(outside, 'wiki'), join(base, 'wiki'));
  assert.equal(await looksLikeWiki(base), false, 'a linked wiki folder is not followed');
  const pending = looksLikeWiki(join(base, 'nothing')); assert.ok(pending instanceof Promise); assert.equal(await pending, false);
});

test('pages are counted without following links, without hidden folders, and with a cap', async t => {
  const base = tempDir(t); put(join(base, 'a.md'), '#a'); put(join(base, 'sub', 'b.MD'), '#b'); put(join(base, '.hidden', 'c.md'), '#c'); put(join(base, 'node_modules', 'd.md'), '#d'); put(join(base, 'e.txt'), 'no');
  const outside = tempDir(t); put(join(outside, 'secret.md'), 's'); symlinkSync(outside, join(base, 'link')); symlinkSync(join(outside, 'secret.md'), join(base, 'file-link.md'));
  assert.equal(await pageCount(base), 2); assert.equal((await markdownFiles(base, 1)).capped, true); assert.ok(PAGE_LIMITS.files >= 5000);
});

test('a role the person chose wins over the guess, is remembered by the viewer only, can be cleared, and only for known folders', async t => {
  const app = join(tempDir(t), 'appdata'), controller = createController({ appDir: app, sampleDir: SAMPLE_DIR, version: 't', platform: 't', forcedMode: 'sample', pickFolder: async () => null, openExternal: async () => undefined });
  const first = await controller.getSnapshot(), p = first.projects.find(x => x.name === 'newsletter')!;
  assert.equal(p.role, 'project'); assert.equal(p.roleChosen, false);
  assert.match((await controller.setRole('/etc', 'workspace')).message!, /not in the list/); assert.match((await controller.setRole(p.key, 'bogus' as never)).message!, /not in the list/);
  assert.equal((await controller.setRole(p.key, 'context-store')).message, null);
  const second = (await controller.getSnapshot()).projects.find(x => x.name === 'newsletter')!; assert.equal(second.role, 'context-store'); assert.equal(second.roleGuess, 'project'); assert.equal(second.roleChosen, true); assert.equal(typeof second.pages, 'number');
  assert.deepEqual({ ...loadSettings(app).settings.roles }, { [p.key]: 'context-store' });
  assert.equal((await controller.setRole(p.key, null)).message, null); assert.equal((await controller.getSnapshot()).projects.find(x => x.name === 'newsletter')!.role, 'project'); assert.deepEqual({ ...loadSettings(app).settings.roles }, {});
});

test('the settings file keeps only valid roles for full paths', () => {
  const s = parseSettings(JSON.stringify({ roles: { '/a': 'workspace', '/b': 'nonsense', 'relative': 'project', '/c': 'context-store' } }))!;
  assert.deepEqual({ ...s.roles }, { '/a': 'workspace', '/c': 'context-store' });
  assert.deepEqual({ ...parseSettings(JSON.stringify({ roles: ['project'] }))!.roles }, {});
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

test('a guessed workspace or context store says so, in plain words, where it is shown; a chosen one and a plain project do not', async () => {
  const { guessNote, contextStoreRows, projectRows } = await import('../shared/viewmodel.js');
  const { buildMap } = await import('../shared/mapmodel.js');
  const s = clone(await sampleSnapshot());
  const p = s.projects[0]!; p.role = 'context-store'; p.roleChosen = false; p.roleGuess = 'context-store';
  assert.match(guessNote(p)!, /We guessed that this is a context store\. You can change it\./);
  assert.match(contextStoreRows(s)[0]!.guess!, /guessed/); assert.match(projectRows(s).find(r => r.key === p.key)!.guess!, /guessed/); assert.match(buildMap(s).nodes.find(n => n.id === `context:${p.key}`)!.guess!, /guessed/);
  p.roleChosen = true; assert.equal(guessNote(p), null); p.roleChosen = false; p.role = 'project'; assert.equal(guessNote(p), null);
});
