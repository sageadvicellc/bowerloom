// The knowledge graph: read-only parsing of a context store's markdown into pages and links, with limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGraph, GRAPH_LIMITS, readPage } from '../main/graph.js';
import { storeChoices } from '../shared/viewmodel.js';
import { createController } from '../main/controller.js';
import { SAMPLE_DIR, tempDir } from './support.js';

const put = (path: string, text: string): void => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); };
const edge = (g: { edges: { from: string; to: string }[] }, from: string, to: string): boolean => g.edges.some(e => e.from === from && e.to === to);

test('pages become nodes with a title, folder, tags and size; wikilinks and relative links become edges', t => {
  const d = tempDir(t);
  put(join(d, 'index.md'), '---\ntags: [hub, start]\n---\n# Start here\n\nSee [[Alpha]] and [[notes/beta|the beta page]] and [gamma](topics/gamma.md#part) and ![[Alpha]].\n#intro and #area/ops\n');
  put(join(d, 'alpha.md'), 'Alpha has no heading. Back to [[index]].\n');
  put(join(d, 'notes', 'beta.md'), '# Beta\n[up](../index.md) and [[Missing page]] and [web](https://example.com/x.md) and [mail](mailto:a@b.c) and [abs](/etc/passwd.md)\n');
  put(join(d, 'topics', 'gamma.md'), '# Gamma\n[[alpha#section]]\n');
  const g = buildGraph(d);
  assert.deepEqual(g.nodes.map(n => n.id), ['alpha.md', 'index.md', 'notes/beta.md', 'topics/gamma.md']);
  const by = (id: string) => g.nodes.find(n => n.id === id)!;
  assert.equal(by('index.md').title, 'Start here'); assert.equal(by('alpha.md').title, 'alpha'); assert.equal(by('notes/beta.md').folder, 'notes'); assert.equal(by('index.md').folder, '');
  assert.deepEqual(by('index.md').tags, ['area/ops', 'hub', 'intro', 'start']);
  assert.ok(edge(g, 'index.md', 'alpha.md') && edge(g, 'index.md', 'notes/beta.md') && edge(g, 'index.md', 'topics/gamma.md') && edge(g, 'alpha.md', 'index.md') && edge(g, 'notes/beta.md', 'index.md') && edge(g, 'topics/gamma.md', 'alpha.md'));
  assert.equal(g.edges.filter(e => e.from === 'index.md' && e.to === 'alpha.md').length, 1, 'two links to one page are one edge');
  assert.equal(g.broken, 1, 'only the link to a missing page is broken; web, mail and absolute links are not pages');
  assert.equal(by('index.md').degree, 5); assert.equal(by('alpha.md').inDegree, 2); assert.equal(g.nodes.some(n => n.orphan), false);
  assert.deepEqual(g.folders, ['', 'notes', 'topics']);
  assert.ok(by('index.md').bytes > 0);
});

test('a page that links to no one and is linked by no one is an orphan; a self link and a cycle are handled', t => {
  const d = tempDir(t);
  put(join(d, 'a.md'), '[[a]] [[b]]'); put(join(d, 'b.md'), '[[a]]'); put(join(d, 'lonely.md'), 'nothing');
  const g = buildGraph(d), lonely = g.nodes.find(n => n.id === 'lonely.md')!;
  assert.equal(lonely.orphan, true); assert.equal(lonely.degree, 0); assert.equal(g.edges.some(e => e.from === e.to), false);
  assert.equal(g.edges.length, 2); assert.equal(g.nodes.find(n => n.id === 'a.md')!.degree, 2);
});

test('tags ignore code, headings, urls and numbers; titles and tags never hold hidden characters', t => {
  const d = tempDir(t);
  put(join(d, 'p.md'), '# Title‮ evil​\n```\n#notatag\n```\n`#inline` http://x.y/#frag issue #12 a#b\n#real-tag #Another_one\n');
  const n = buildGraph(d).nodes[0]!;
  assert.deepEqual(n.tags, ['Another_one', 'real-tag']); assert.doesNotMatch(n.title, /[‮​]/); assert.match(n.title, /^Title/);
});

test('hidden folders, node_modules, other file types, links and files outside the store are never read', t => {
  const d = tempDir(t), out = tempDir(t);
  put(join(d, 'ok.md'), '[[secret]] [x](../outside.md)'); put(join(d, '.git', 'h.md'), 'x'); put(join(d, 'node_modules', 'm.md'), 'x'); put(join(d, 'n.txt'), 'x');
  put(join(out, 'secret.md'), '# Secret'); put(join(out, 'outside.md'), 'x'); symlinkSync(out, join(d, 'linked')); symlinkSync(join(out, 'secret.md'), join(d, 'secret.md'));
  const g = buildGraph(d);
  assert.deepEqual(g.nodes.map(n => n.id), ['ok.md']); assert.equal(g.edges.length, 0); assert.equal(g.broken, 2);
});

test('a page over the size limit is a node without links and the graph says so; an unreadable page is a node too', t => {
  const d = tempDir(t);
  put(join(d, 'big.md'), '[[small]]' + ' '.repeat(GRAPH_LIMITS.fileBytes)); put(join(d, 'small.md'), 'x'); put(join(d, 'locked.md'), '[[small]]'); chmodSync(join(d, 'locked.md'), 0o000);
  const g = buildGraph(d);
  assert.equal(g.nodes.find(n => n.id === 'big.md')!.big, true); assert.equal(g.edges.some(e => e.from === 'big.md'), false);
  assert.ok(g.notices.some(x => /too large/.test(x))); assert.ok(g.nodes.some(n => n.id === 'locked.md')); chmodSync(join(d, 'locked.md'), 0o644);
});

test('the node, edge and depth limits stop the reading and say so in a plain sentence', t => {
  const d = tempDir(t);
  for (let i = 0; i < 12; i++) put(join(d, `p${String(i).padStart(2, '0')}.md`), Array.from({ length: 12 }, (_, j) => `[[p${String(j).padStart(2, '0')}]]`).join(' '));
  const few = buildGraph(d, { nodes: 5 });
  assert.equal(few.nodes.length, 5); assert.ok(few.notices.some(x => /first 5 pages/.test(x)));
  const fewer = buildGraph(d, { edges: 10 });
  assert.equal(fewer.edges.length, 10); assert.ok(fewer.notices.some(x => /first 10 links/.test(x)));
  put(join(d, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'deep.md'), 'x');
  assert.equal(buildGraph(d).nodes.some(n => n.id.endsWith('deep.md')), false); assert.ok(buildGraph(d).notices.some(x => /deeper/.test(x)));
  assert.equal(GRAPH_LIMITS.nodes, 5000); assert.equal(GRAPH_LIMITS.edges, 20000);
});

test('a store of 5000 pages reads in a reasonable time', t => {
  const d = tempDir(t);
  for (let i = 0; i < 1200; i++) put(join(d, `f${i % 12}`, `p${i}.md`), `# P${i}\n[[p${(i * 7) % 1200}]] [[p${(i * 13) % 1200}]] #t${i % 9}\n`);
  const start = Date.now(), g = buildGraph(d);
  assert.equal(g.nodes.length, 1200); assert.ok(g.edges.length > 1200); assert.ok(Date.now() - start < 8000);
});

test('a page is read as plain text only inside its store; paths that escape, links, other file types and big files are refused', t => {
  const d = tempDir(t), out = tempDir(t);
  put(join(d, 'sub', 'a.md'), 'Hello ‮ there'); put(join(out, 'x.md'), 'out'); symlinkSync(join(out, 'x.md'), join(d, 'l.md')); put(join(d, 'n.txt'), 'x'); put(join(d, 'big.md'), 'x'.repeat(GRAPH_LIMITS.fileBytes + 1));
  assert.match(readPage(d, 'sub/a.md').text!, /^Hello /); assert.doesNotMatch(readPage(d, 'sub/a.md').text!, /‮/);
  for (const bad of ['../x.md', '/etc/passwd.md', 'l.md', 'n.txt', 'big.md', 'missing.md', 'sub/../../x.md', 'a\0.md', '', 'sub/%2e%2e/a.md']) { const r = readPage(d, bad); assert.equal(r.text, null, bad); assert.ok(r.note, bad); }
  assert.equal(readPage(d, 5 as never).text, null);
});

test('the controller answers only for a store it listed, returns no page text in the graph, and a store list names who reads each store', async t => {
  const app = join(tempDir(t), 'appdata'), controller = createController({ appDir: app, sampleDir: SAMPLE_DIR, version: 't', platform: 't', forcedMode: 'sample', pickFolder: async () => null, openExternal: async () => undefined });
  const snap = await controller.getSnapshot(), project = snap.projects[0]!;
  assert.equal((await controller.getKnowledgeGraph('/etc')).ok, false); assert.equal((await controller.getKnowledgeGraph(5 as never)).ok, false);
  assert.equal((await controller.getPageText({ storeKey: '/etc', page: 'passwd' })).text, null);
  await controller.setRole(project.key, 'context-store');
  const again = await controller.getSnapshot(), choices = storeChoices(again);
  assert.ok(choices.some(c => c.key === project.key));
  const g = await controller.getKnowledgeGraph(project.key);
  assert.equal(g.ok, true); assert.ok(g.graph!.nodes.length >= 0);
  assert.ok(!JSON.stringify(g.graph).includes('"text"') && !JSON.stringify(g.graph).includes('"body"'), 'only ids, titles, edges, tags, folders and sizes');
});
