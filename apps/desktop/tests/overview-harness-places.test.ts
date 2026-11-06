// A folder that already holds a harness, which Bowerloom has never opened, is a place in the Overview (owner decision of 2026-11-04). The made-up home is read with the real scanner;
// the harness is read through the harness loader and nothing is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { createScanner } from '../main/real-scan.js';
import { buildMadeUpHome, digestTree } from '../tools/made-up-home.js';
import { buildRealResult } from '../shared/real/map-world.js';
import type { RealPlace } from '../shared/real/types.js';
import { realToHarnessState } from '../shared/harness/real-map.js';
import { HARNESS_UNREADABLE, overviewOf } from '../shared/harness/overview.js';
import { defaultExpanded, layoutOf } from '../shared/harness/overview-layout.js';
import { createSampleWorld } from '../shared/harness/sample.js';
import type { HarnessState } from '../shared/harness/types.js';
import type { FolderInfo } from '../shared/engine/types.js';
import { tempDir } from './support.js';

async function read(home: string, picked: readonly string[]): Promise<HarnessState> {
  const scanner = createScanner({ home });
  const places: RealPlace[] = [...(await scanner.discover()).places];
  for (const dir of picked) places.push(...(await scanner.addFolder(dir)).places);
  const batch = await scanner.read(places.map(p => p.id));
  return realToHarnessState(buildRealResult(batch.reads, batch.tally, { nowMs: Date.UTC(2026, 10, 4), foldExtraApps: true }), places);
}
const folder = (id: string, label: string): FolderInfo => ({ id, label, name: label, hasDefinition: true, engines: [], previewEngines: false, installedEngines: [], problem: null, projected: false, unfinished: { projection: false, adoption: false } });

test('rope-yard, which holds a harness and was never opened, is a place with its skills, agents and programs; it is not in Bowerloom and offers the folder chooser', async t => {
  const made = buildMadeUpHome(tempDir(t));
  const state = await read(made.home, [made.projects]);
  assert.equal(state.harnessPlaces?.length, 1);
  const o = overviewOf(state, []);
  const rope = o.groups.find(g => g.label === '~/Projects/rope-yard')!;
  assert.ok(rope, o.groups.map(g => g.label).join(', '));
  assert.equal(rope.name, 'rope-yard (Bowerloom)'); assert.equal(rope.scope, 'project');
  assert.deepEqual(rope.programs, ['Claude Code', 'Codex']);
  assert.deepEqual(rope.counts, { agent: 2, skill: 3, tool: 0, context: 0 });
  assert.deepEqual(rope.nodes.filter(n => n.kind === 'agent').map(n => n.name), ['foreman', 'tallyman']);
  assert.deepEqual(rope.nodes.filter(n => n.kind === 'skill').map(n => n.name), ['coil-count', 'knot-guide', 'splice']);
  assert.equal(rope.inBowerloom, false); assert.equal(rope.folderId, null); assert.equal(rope.note, undefined);
  // foreman names splice.
  const idOf = (name: string): string => rope.nodes.find(n => n.name === name)!.id;
  assert.deepEqual(rope.edges.map(e => e.id), [`${idOf('foreman')}>${idOf('splice')}`]);
  assert.ok(rope.nodes.every(n => /^[^/]+\/harness-(?:agent|skill|notes|mcp|hook)-\d+$/.test(n.id)), 'an id is a kind and a number, never a name');
  // A folder main knows gets no place of this kind: its own place already reads In Bowerloom, and it lists the folder's skills once.
  const known = overviewOf(state, [folder('f1', '~/Projects/rope-yard')]);
  assert.equal(known.groups.some(g => g.id === rope.id), false);
  assert.equal(known.groups.length, o.groups.length);
  const knownRope = known.groups.find(g => g.label === '~/Projects/rope-yard')!;
  assert.equal(knownRope.inBowerloom, true); assert.deepEqual(knownRope.nodes.map(n => n.name).sort(), ['coil-count', 'knot-guide', 'splice']);
  // No full path anywhere.
  assert.ok(!JSON.stringify(o).includes(made.home));
});

test('the read is read only: no file of the made-up home changes', async t => {
  const made = buildMadeUpHome(tempDir(t));
  const before = digestTree(made.home);
  await read(made.home, [made.projects]);
  assert.deepEqual(digestTree(made.home), before);
});

test('the read screen lists the skills of a folder with a harness as a source that names the harness place, and says nothing is left out', async t => {
  const made = buildMadeUpHome(tempDir(t));
  const state = await read(made.home, [made.projects]);
  const source = state.sources.find(s => /rope-yard/.test(s.name));
  assert.ok(source, 'the skills are found');
  assert.equal(source.harnessPlaceId, state.harnessPlaces?.find(h => /rope-yard/.test(h.name))?.id);
  assert.ok(!state.real!.notes.some(n => /in a Bowerloom folder (?:is|are) not shown\.$/.test(n)), 'every skill is listed');
  assert.equal(state.chosenSourceIds.length, state.sources.length);
});

test('a harness place follows the same budget as a project: the home is open, and a small place opens by the budget', async t => {
  const made = buildMadeUpHome(tempDir(t));
  const o = overviewOf(await read(made.home, [made.projects]), []);
  const open = defaultExpanded(o);
  assert.ok(o.groups[0]!.scope === 'home' && open.has(o.groups[0]!.id));
  const rope = o.groups.find(g => g.label === '~/Projects/rope-yard')!;
  const layout = layoutOf(o, new Set([rope.id]));
  assert.equal(layout.nodes.length, 5); assert.ok(layout.nodes.every(n => n.groupId === rope.id));
});

function homeWith(t: TestContext, files: Record<string, string>): { home: string; work: string } {
  const home = join(tempDir(t), 'home'), work = join(home, 'work');
  for (const [rel, text] of Object.entries(files)) { const abs = join(work, rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, text); }
  return { home, work };
}
const harnessJson = (extra: object = {}): string => JSON.stringify({ format: 'bowerloom/harness/v1beta1', id: 'x', description: 'X.', engines: [{ id: 'claude-code' }], parts: { skills: 'skills/', subagents: 'agents/', mcp: 'mcp.json', hooks: 'hooks.json' }, ...extra });

test('connections and hooks are tools; a hook runs code; no command, argument or value reaches the model', async t => {
  const { home, work } = homeWith(t, {
    'a/.bowerloom/harness.json': harnessJson({ parts: { skills: 'skills/', subagents: 'agents/', mcp: 'mcp.json', hooks: 'hooks.json' } }),
    'a/.bowerloom/skills/one/SKILL.md': '---\nname: one\ndescription: Does one thing. And more.\n---\n\nBody.\n',
    'a/.bowerloom/agents/boss.md': '---\nname: boss\ndescription: Runs it.\nskills: [one]\n---\n\nGo.\n',
    'a/.bowerloom/mcp.json': JSON.stringify({ servers: [{ name: 'tracker', transport: 'stdio', command: 'SECRETCOMMAND', args: ['SECRETARG'], env: { K: '${SECRETVALUE}' } }] }),
    'a/.bowerloom/hooks.json': JSON.stringify({ hooks: [{ id: 'fmt', event: 'PostToolUse', command: 'SECRETHOOK', strength: 'advisory' }] }),
  });
  mkdirSync(join(home, '.claude'), { recursive: true });
  const state = await read(home, [work]);
  const place = state.harnessPlaces?.[0];
  if (place?.readable !== true) { assert.ok(place, 'a place'); assert.fail(`the harness was not readable: ${JSON.stringify(place)}`); }
  const o = overviewOf(state, []);
  const g = o.groups.find(x => x.label === '~/work/a')!;
  assert.deepEqual(g.counts.skill, 1); assert.equal(g.counts.agent, 1);
  assert.ok(!/SECRET/.test(JSON.stringify(o)), 'no command, argument or value');
  const skill = g.nodes.find(n => n.kind === 'skill')!;
  assert.equal(skill.summary, 'Does one thing.');
  assert.equal(g.counts.tool, 2);
  assert.deepEqual(g.nodes.filter(x => x.kind === 'tool').map(x => [x.toolKind, x.runsCode]).sort(), [['hook', true], ['mcp', undefined]]);
  for (const n of g.nodes.filter(x => x.kind === 'tool')) assert.equal(n.runsCode === true, n.toolKind === 'hook');
});

test('a harness that could not be read is a place with its name, a plain line and no part of its own', async t => {
  const { home, work } = homeWith(t, { 'broken/.bowerloom/harness.json': '{ not json', 'broken/.bowerloom/skills/one/SKILL.md': '---\nname: one\n---\n' });
  mkdirSync(join(home, '.claude'), { recursive: true });
  const state = await read(home, [work]);
  const here = overviewOf(state, []).groups.filter(x => x.label === '~/work/broken');
  assert.equal(here.length, 1, 'the unreadable place and the folder own listing are one group');
  const g = here[0]!;
  assert.equal(g.name, 'broken (Bowerloom)'); assert.equal(g.note, HARNESS_UNREADABLE); assert.deepEqual(g.programs, []);
  // The harness could not be read, so it shows no part of its own: the folder's own skill is not hidden behind the unreadable place.
  assert.deepEqual(g.nodes.map(n => n.name), ['one']); assert.deepEqual(g.counts, { agent: 0, skill: 1, tool: 0, context: 0 });
});

test('a folder with a .bowerloom and no harness.json is no harness place; a hand-made place keeps the privacy rules', () => {
  const state: HarnessState = { ...createSampleWorld(), harnessPlaces: [{ id: 'h', name: 'In /Users/Hanna Sage/Projects/x (Bowerloom)', label: '~/x', readable: true, engines: ['Codex'], parts: [{ id: 'p', kind: 'skill', name: 'Skill', summary: 'Reads /Users/hanna/secret/x now' }], links: [] }] };
  const g = overviewOf(state, []).groups.find(x => x.id === 'h')!;
  assert.equal(g.nodes[0]!.summary, 'Reads …/x now'); assert.equal(g.name, 'In …/x (Bowerloom)');
  assert.doesNotMatch(JSON.stringify(g), /hanna|Hanna|Sage/);
  assert.deepEqual(overviewOf(createSampleWorld(), []).groups.map(x => x.note), [undefined, undefined, undefined]);
});

test('the places of a big harness fall under the same node cap', () => {
  const parts = Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, kind: 'skill' as const, name: `s${i}`, summary: '' }));
  const o = overviewOf({ ...createSampleWorld(), harnessPlaces: [{ id: 'h', name: 'big (Bowerloom)', label: '~/big', readable: true, engines: [], parts, links: [] }] }, []);
  const g = o.groups.find(x => x.id === 'h')!;
  assert.equal(g.nodes.length, 1000);
  assert.ok(!defaultExpanded(o).has('h'));
});

test('a harness file that is not valid JSON, is over the list limit, or has the wrong shape makes the place unreadable', async t => {
  const big = JSON.stringify({ servers: Array.from({ length: 201 }, (_, i) => ({ name: `s${i}`, transport: 'stdio', command: 'x' })) });
  const { home, work } = homeWith(t, {
    'good/.bowerloom/harness.json': harnessJson(),
    'badmcp/.bowerloom/harness.json': harnessJson(), 'badmcp/.bowerloom/mcp.json': '{ nope',
    'bighooks/.bowerloom/harness.json': harnessJson(), 'bighooks/.bowerloom/mcp.json': big,
    'shape/.bowerloom/harness.json': '[1,2]',
    'nofile/.bowerloom/skills/one/SKILL.md': '---\nname: one\n---\n',
  });
  mkdirSync(join(home, '.claude'), { recursive: true });
  const o = overviewOf(await read(home, [work]), []);
  const by = (n: string) => o.groups.find(g => g.label === `~/work/${n}`);
  assert.equal(by('good')?.note, undefined);
  for (const n of ['badmcp', 'bighooks', 'shape']) { assert.equal(by(n)?.note, HARNESS_UNREADABLE, n); assert.deepEqual(by(n)?.nodes, [], n); }
  // A folder without harness.json is no harness place. Its layer is listed like any other folder, by its own skills, and carries no unreadable note.
  assert.equal(by('nofile')?.name, 'nofile (Bowerloom)'); assert.deepEqual(by('nofile')?.nodes.map(n => n.name), ['one']); assert.equal(by('nofile')?.note, undefined);
  assert.equal((await read(home, [work])).harnessPlaces?.some(h => /nofile/.test(h.name)), false, 'a folder without harness.json is no harness place');
  assert.equal(HARNESS_UNREADABLE, 'Bowerloom could not read this harness.');
});

test('the reader keeps no command, argument, env, header, url or path of the harness', async t => {
  const { home, work } = homeWith(t, {
    'k/.bowerloom/harness.json': harnessJson(),
    'k/.bowerloom/mcp.json': JSON.stringify({ servers: [{ name: 'web', transport: 'http', url: 'https://example.test/SECRETURL', headers: { A: 'SECRETHEADER' } }] }),
    'k/.bowerloom/knowledge.json': JSON.stringify({ sources: [{ kind: 'wiki', name: 'tide-notes', path: '/Users/hanna/SECRETPATH' }] }),
  });
  mkdirSync(join(home, '.claude'), { recursive: true });
  const o = overviewOf(await read(home, [work]), []);
  const g = o.groups.find(x => x.label === '~/work/k')!;
  assert.deepEqual(g.nodes.map(n => [n.kind, n.name]), [['tool', 'web'], ['context', 'tide-notes']]);
  assert.doesNotMatch(JSON.stringify(o), /SECRET|hanna/);
});

test('a part id is a kind and a number: a name that is a path never reaches an id', async t => {
  const { home, work } = homeWith(t, {
    'p/.bowerloom/harness.json': harnessJson(),
    'p/.bowerloom/mcp.json': JSON.stringify({ servers: [{ name: '/Users/hanna/.ssh/id_rsa', transport: 'stdio', command: 'x' }] }),
    'p/.bowerloom/agents/Users\u202eodd.md': '---\nname: x\n---\n',
  });
  mkdirSync(join(home, '.claude'), { recursive: true });
  const state = await read(home, [work]);
  assert.deepEqual(state.harnessPlaces![0]!.parts.map(x => x.id).sort(), ['harness-agent-1', 'harness-mcp-1']);
  assert.doesNotMatch(JSON.stringify(overviewOf(state, [])), /Users|hanna|\u202e/);
});

test('a name used twice in mcp.json, hooks.json or knowledge.json makes the place unreadable, as the loader would refuse it', async t => {
  const dup = (key: string, name: string): string => JSON.stringify({ [key]: [{ [name]: 'same', transport: 'stdio', command: 'x' }, { [name]: 'same', transport: 'stdio', command: 'x' }] });
  const { home, work } = homeWith(t, {
    'm/.bowerloom/harness.json': harnessJson(), 'm/.bowerloom/mcp.json': dup('servers', 'name'),
    'k/.bowerloom/harness.json': harnessJson(), 'k/.bowerloom/knowledge.json': dup('sources', 'name'),
    'h/.bowerloom/harness.json': harnessJson(), 'h/.bowerloom/hooks.json': dup('hooks', 'id'),
  });
  mkdirSync(join(home, '.claude'), { recursive: true });
  const o = overviewOf(await read(home, [work]), []);
  for (const n of ['m', 'k', 'h']) assert.equal(o.groups.find(g => g.label === `~/work/${n}`)?.note, HARNESS_UNREADABLE, n);
});

test('an agents folder with many other files, too many agents, too many parts or too many bytes is unreadable, never cut short', async t => {
  const files: Record<string, string> = { 'many/.bowerloom/harness.json': harnessJson(), 'agents/.bowerloom/harness.json': harnessJson(), 'parts/.bowerloom/harness.json': harnessJson(), 'bytes/.bowerloom/harness.json': harnessJson(), 'ok/.bowerloom/harness.json': harnessJson(), 'ok/.bowerloom/agents/real.md': '---\nname: real\n---\n' };
  for (let i = 0; i < 1100; i += 1) files[`many/.bowerloom/agents/f${i}.txt`] = 'x';
  files['many/.bowerloom/agents/real.md'] = '---\nname: real\n---\n';
  for (let i = 0; i < 201; i += 1) files[`agents/.bowerloom/agents/a${i}.md`] = '---\nname: a\n---\n';
  files['parts/.bowerloom/mcp.json'] = JSON.stringify({ servers: Array.from({ length: 200 }, (_, i) => ({ name: `m${i}`, transport: 'stdio', command: 'x' })) });
  files['parts/.bowerloom/hooks.json'] = JSON.stringify({ hooks: Array.from({ length: 200 }, (_, i) => ({ id: `h${i}`, event: 'PostToolUse', command: 'x', strength: 'advisory' })) });
  files['parts/.bowerloom/knowledge.json'] = JSON.stringify({ sources: Array.from({ length: 200 }, (_, i) => ({ kind: 'wiki', name: `n${i}`, path: `p${i}` })) });
  for (let i = 0; i < 160; i += 1) files[`parts/.bowerloom/agents/a${i}.md`] = '---\nname: a\n---\n';
  for (let i = 0; i < 300; i += 1) files[`parts/.bowerloom/skills/s${i}/SKILL.md`] = '---\nname: s\n---\n';
  for (let i = 0; i < 5; i += 1) files[`bytes/.bowerloom/agents/b${i}.md`] = `---\nname: b\n---\n${'x'.repeat(600 * 1024)}`;
  const { home, work } = homeWith(t, files);
  mkdirSync(join(home, '.claude'), { recursive: true });
  const o = overviewOf(await read(home, [work]), []);
  const by = (n: string) => o.groups.find(g => g.label === `~/work/${n}`);
  for (const n of ['many', 'agents', 'parts', 'bytes']) assert.equal(by(n)?.note, HARNESS_UNREADABLE, n);
  assert.equal(by('ok')?.note, undefined); assert.equal(by('ok')?.counts.agent, 1);
});

test('a harness skill with the same text as a skill elsewhere is shared with it', async t => {
  const made = buildMadeUpHome(tempDir(t));
  const o = overviewOf(await read(made.home, [made.projects]), []);
  const rope = o.groups.find(g => g.label === '~/Projects/rope-yard')!;
  const coil = rope.nodes.find(n => n.name === 'coil-count')!;
  assert.ok(coil.sharedWith.length > 0 && coil.shareKey !== undefined, 'coil-count is also in the home folder with the same text');
  assert.equal(rope.nodes.find(n => n.name === 'splice')!.sharedWith.length, 0);
});

test('a folder that main already knows shows the skill of its harness exactly once', async t => {
  const { home, work } = homeWith(t, { 'known/.bowerloom/harness.json': harnessJson(), 'known/.bowerloom/skills/one/SKILL.md': '---\nname: one\ndescription: Does one thing.\n---\n\nBody.\n' });
  mkdirSync(join(home, '.claude'), { recursive: true });
  const state = await read(home, [work]);
  const count = (o: ReturnType<typeof overviewOf>): number => o.groups.flatMap(g => g.nodes).filter(n => n.name === 'one').length;
  assert.equal(count(overviewOf(state, [])), 1, 'not known: once');
  const known = overviewOf(state, [folder('f1', '~/work/known')]);
  assert.equal(count(known), 1, 'known: once');
  assert.equal(known.groups.filter(g => g.label === '~/work/known').length, 1);
});
