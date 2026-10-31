// The prototype's in-memory ViewerApi: every method answers from memory, nothing is shared between two fakes, and the source touches no outside place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CHANNELS } from '../shared/channels.js';
import type { Sketch, ViewerApi } from '../shared/types.js';
import type { World } from '../shared/world/types.js';
import { createEmptyWorld, createFakeApi } from '../renderer/common/fakeApi.js';
import { DESKTOP } from './support.js';

const sketch = (name: string): Sketch => ({ version: 1, name, nodes: [{ id: 'n1', kind: 'skill', label: 'A', x: 1, y: 2 }], edges: [] });

function smallWorld(): World {
  const w = createEmptyWorld();
  const page = (id: string, links: string[]) => ({ id, title: id.toUpperCase(), folder: 'notes', type: 'concept', tags: ['a'], summary: `about ${id}`, bytes: 100, links, joinedSinceVisit: false });
  return {
    ...w,
    wikiPages: [page('p1', ['p2', 'missing']), page('p2', ['p1']), page('p3', [])],
    items: [{ id: 's1', kind: 'skill', name: 'Skill', scopeId: 'global', library: null, description: 'd', foundAt: [{ interface: 'claude-code', path: '/sample/s1/SKILL.md', contentHash: 'h', text: 'skill text' }] }],
  };
}

/** Calls every method with a plausible argument. */
async function callAll(api: ViewerApi): Promise<Record<string, unknown>> {
  return {
    getInfo: await api.getInfo(), getSettings: await api.getSettings(), getSnapshot: await api.getSnapshot(),
    getItemContent: await api.getItemContent({ kind: 'skill', id: 's1', projectKey: null }),
    getFileText: await api.getFileText({ projectKey: 'none', file: 'config' }),
    chooseMode: await api.chooseMode('sample'), addRoot: await api.addRoot(), removeRoot: await api.removeRoot('/sample/root'),
    setTheme: await api.setTheme('dark'), setIncludeExamples: await api.setIncludeExamples(true), setRole: await api.setRole('k', 'project'),
    setMapLayout: await api.setMapLayout({ a: { x: 1, y: 2 } }), listSketches: await api.listSketches(), saveSketch: await api.saveSketch(sketch('one')),
    loadSketch: await api.loadSketch('one'), deleteSketch: await api.deleteSketch('one'), getKnowledgeGraph: await api.getKnowledgeGraph('kb'),
    getPageText: await api.getPageText({ storeKey: 'kb', page: 'p1' }), copyText: await api.copyText('x'),
    checkForUpdates: await api.checkForUpdates(), openLink: await api.openLink('https://github.com/x'),
  };
}

test('the fake implements exactly the keys the real preload exposes, each a function', () => {
  const api = createFakeApi(createEmptyWorld());
  assert.deepEqual(Object.keys(api).sort(), Object.keys(CHANNELS).sort());
  for (const [key, value] of Object.entries(api)) assert.equal(typeof value, 'function', key);
});

test('every method resolves without throwing, on an empty world and on a small one', async () => {
  for (const world of [createEmptyWorld(), smallWorld()]) {
    const results = await callAll(createFakeApi(world));
    assert.deepEqual(Object.keys(results).sort(), Object.keys(CHANNELS).sort());
    for (const [key, value] of Object.entries(results)) assert.notEqual(value, undefined, key);
  }
});

test('reads answer from memory: the knowledge graph and page text come from the world', async () => {
  const api = createFakeApi(smallWorld());
  const result = await api.getKnowledgeGraph('kb'), graph = result.graph!;
  assert.equal(result.ok, true);
  assert.deepEqual(graph.nodes.map(n => n.id).sort(), ['p1', 'p2', 'p3']);
  assert.deepEqual(graph.edges.map(e => `${e.from}>${e.to}`).sort(), ['p1>p2', 'p2>p1']);
  assert.equal(graph.broken, 1);
  const byId = Object.fromEntries(graph.nodes.map(n => [n.id, n]));
  assert.equal(byId['p1']!.degree, 2); assert.equal(byId['p1']!.inDegree, 1); assert.equal(byId['p3']!.orphan, true); assert.equal(byId['p1']!.orphan, false);
  assert.deepEqual(graph.folders, ['notes']); assert.deepEqual(graph.tags, ['a']);
  assert.deepEqual(await api.getPageText({ storeKey: 'kb', page: 'p2' }), { text: 'about p2', note: null });
  assert.deepEqual(await api.getPageText({ storeKey: 'kb', page: 'nope' }), { text: null, note: null });
  const content = await api.getItemContent({ kind: 'skill', id: 's1', projectKey: null });
  assert.equal(content.files[0]?.text, 'skill text'); assert.equal(content.files[0]?.bytes, 10);
  assert.deepEqual((await api.getItemContent({ kind: 'skill', id: 'nope', projectKey: null })).files, []);
});

test('an empty world gives an empty, well-formed snapshot and graph', async () => {
  const api = createFakeApi(createEmptyWorld());
  const s = await api.getSnapshot();
  assert.deepEqual([s.folders, s.projects, s.problems, s.library.skills, s.library.prompts, s.library.teams, s.cache.entries], [[], [], [], [], [], [], []]);
  assert.equal(s.mode, 'sample');
  const g = (await api.getKnowledgeGraph('kb')).graph!;
  assert.deepEqual([g.nodes, g.edges, g.folders, g.tags, g.broken], [[], [], [], [], 0]);
});

test('the write-like methods keep their value in memory and return it back', async () => {
  const api = createFakeApi(createEmptyWorld());
  assert.equal((await api.setTheme('dark')).settings.theme, 'dark'); assert.equal((await api.getSettings()).theme, 'dark');
  assert.equal((await api.setIncludeExamples(true)).settings.includeExamples, true);
  assert.deepEqual((await api.setRole('/p', 'workspace')).settings.roles, { '/p': 'workspace' });
  assert.deepEqual((await api.setRole('/p', null)).settings.roles, {});
  assert.deepEqual((await api.setMapLayout({ a: { x: 1, y: 2 } })).settings.mapLayout, { a: { x: 1, y: 2 } });
  assert.deepEqual((await api.setMapLayout(null)).settings.mapLayout, {});
  assert.equal((await api.chooseMode('real')).mode, 'real'); assert.equal((await api.getInfo()).mode, 'real');
  assert.deepEqual((await api.listSketches()).value, []);
  assert.deepEqual((await api.saveSketch(sketch('one'))).value, { name: 'one', nodes: 1, edges: 0 });
  assert.deepEqual((await api.listSketches()).value, [{ name: 'one', nodes: 1, edges: 0 }]);
  assert.equal((await api.loadSketch('one')).value?.name, 'one');
  assert.equal((await api.loadSketch('none')).ok, false);
  assert.equal((await api.deleteSketch('one')).ok, true); assert.deepEqual((await api.listSketches()).value, []);
  assert.equal(await api.copyText('x'), true); assert.equal(await api.openLink('https://github.com/x'), false);
});

test('returned data is a copy: changing a result changes nothing inside the fake or the world', async () => {
  const world = smallWorld(), before = JSON.stringify(world), api = createFakeApi(world);
  const settings = await api.getSettings(); settings.roots.push('/x'); settings.mapLayout['z'] = { x: 0, y: 0 };
  assert.deepEqual((await api.getSettings()).roots, []); assert.deepEqual((await api.getSettings()).mapLayout, {});
  const input = sketch('s'); await api.saveSketch(input); input.nodes.length = 0;
  assert.equal((await api.loadSketch('s')).value?.nodes.length, 1);
  const loaded = (await api.loadSketch('s')).value!; loaded.nodes.length = 0;
  assert.equal((await api.loadSketch('s')).value?.nodes.length, 1);
  await callAll(api);
  assert.equal(JSON.stringify(world), before);
});

test('two fake APIs made in one process share no state', async () => {
  const a = createFakeApi(createEmptyWorld()), b = createFakeApi(createEmptyWorld());
  await a.setTheme('dark'); await a.setMapLayout({ n: { x: 1, y: 1 } }); await a.saveSketch(sketch('mine')); await a.chooseMode('real'); await a.setIncludeExamples(true);
  await a.setRole('/p', 'project'); await a.removeRoot('/sample/root');
  const settings = await b.getSettings();
  assert.equal(settings.theme, 'system'); assert.deepEqual(settings.mapLayout, {}); assert.equal(settings.includeExamples, false); assert.deepEqual(settings.roles, {});
  assert.deepEqual((await b.listSketches()).value, []); assert.equal((await b.getInfo()).mode, 'sample');
  const c = createFakeApi(createEmptyWorld());
  assert.equal((await c.getSettings()).theme, 'system'); assert.deepEqual((await c.listSketches()).value, []);
});

test('the prototype source touches no window bridge, file, markup string, random number or clock', () => {
  const files: string[] = [];
  for (const dir of ['renderer/common', 'shared/world']) {
    for (const entry of readdirSync(join(DESKTOP, dir), { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(join((entry as unknown as { parentPath: string }).parentPath, entry.name));
    }
  }
  assert.ok(files.some(f => f.endsWith('fakeApi.ts')) && files.some(f => f.endsWith('types.ts')), files.join(','));
  const banned = ['window.bowerloom', 'node:fs', 'innerHTML', 'Math.random', 'Date.', 'new Date', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'process.env'];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const word of banned) assert.equal(text.includes(word), false, `${file} contains ${word}`);
    assert.doesNotMatch(text, /from ['"]node:/, `${file} imports a node module`);
  }
});
