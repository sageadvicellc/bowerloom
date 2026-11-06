// A workspace root with its own `.bowerloom` layer. The layer's skill, agent and saved prompt must show in the scan, as they do for any other work folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createScanner } from '../main/real-scan.js';
import { buildRealResult } from '../shared/real/map-world.js';
import { overviewOf } from '../shared/harness/overview.js';
import { realToHarnessState } from '../shared/harness/real-map.js';
import { tempDir } from './support.js';
import type { TestContext } from 'node:test';

const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const NOW = Date.UTC(2026, 10, 1);
const doc = (name: string, description: string): string => `---\nname: ${name}\ndescription: ${description}\n---\nBody of ${name}.\n`;

/** A workspace root that holds a `.bowerloom` layer, and a nested folder that holds its own. */
function workspace(t: TestContext): { home: string; root: string } {
  const home = tempDir(t, 'bowerloom-root-layer-'), root = join(home, 'workspace');
  put(join(root, '.bowerloom', 'skills', 'root-skill', 'SKILL.md'), doc('Root skill', 'A skill in the root layer.'));
  put(join(root, '.bowerloom', 'teams', 'crew', 'agents', 'root-agent.md'), doc('Root agent', 'An agent in the root layer.'));
  put(join(root, '.bowerloom', 'prompts', 'root-prompt.md'), doc('Root prompt', 'A prompt in the root layer.'));
  put(join(root, 'inner', '.bowerloom', 'skills', 'inner-skill', 'SKILL.md'), doc('Inner skill', 'A skill in a nested layer.'));
  return { home, root };
}

test('a picked workspace root with a .bowerloom layer shows the skill, agent and prompt of that layer', async t => {
  const { home, root } = workspace(t), scanner = createScanner({ home });
  const found = await scanner.addFolder(root);
  const picked = found.places.find(p => p.kind === 'picked');
  assert.ok(picked, 'the picked folder is a place');
  assert.deepEqual(picked.apps, ['Bowerloom']);
  assert.equal(picked.counts.skills, 1);
  assert.equal(picked.counts.agents, 1);
  const batch = await scanner.read(found.places.map(p => p.id));
  const result = buildRealResult(batch.reads, batch.tally, { nowMs: Date.UTC(2026, 10, 1), foldExtraApps: true });
  const names = result.world.items.map(i => i.name);
  for (const want of ['Root skill', 'Root agent', 'Inner skill']) assert.ok(names.includes(want), `${want} is in the scan: ${names.join(', ')}`);
});

test('the harness state lists the skill, agent and prompt of a root .bowerloom layer as one source for that folder', async t => {
  const { home, root } = workspace(t), scanner = createScanner({ home });
  const found = await scanner.addFolder(root);
  const batch = await scanner.read(found.places.map(p => p.id));
  const state = realToHarnessState(buildRealResult(batch.reads, batch.tally, { nowMs: Date.UTC(2026, 10, 1), foldExtraApps: true }), found.places);
  const names = state.parts.map(p => p.name);
  for (const want of ['Root skill', 'Root agent', 'Root prompt', 'Inner skill']) assert.ok(names.includes(want), `${want} is a part: ${names.join(', ')}`);
  const source = state.sources.find(s => s.name === 'workspace (Bowerloom)');
  assert.ok(source, state.sources.map(s => s.name).join(' | '));
  assert.equal(source.interfaceName, 'Bowerloom');
  assert.deepEqual(source.partIds.map(id => state.parts.find(p => p.id === id)!.name).sort(), ['Root agent', 'Root prompt', 'Root skill']);
  assert.ok(state.sources.some(s => s.name === 'inner (Bowerloom)'), 'a nested layer is its own source');
  assert.equal(state.real!.notes.some(n => /Bowerloom folder/.test(n)), false, state.real!.notes.join(' | '));
  assert.match(state.parts.find(p => p.name === 'Root skill')!.description, /A skill in the root layer\./);
  assert.equal(state.parts.some(p => /Claude Code/.test(p.description)), false, 'a Bowerloom part is not said to come from Claude Code');
});

async function readState(home: string, root: string) {
  const scanner = createScanner({ home }), found = await scanner.addFolder(root), batch = await scanner.read(found.places.map(p => p.id));
  const result = buildRealResult(batch.reads, batch.tally, { nowMs: NOW, foldExtraApps: true });
  return { result, state: realToHarnessState(result, found.places) };
}
/** How many nodes of the Overview have this name, in every group. */
const shownTimes = (state: Awaited<ReturnType<typeof readState>>['state'], name: string): number => overviewOf(state, []).groups.reduce((n, g) => n + g.nodes.filter(x => x.name === name).length, 0);
const names = (state: Awaited<ReturnType<typeof readState>>['state'], kind: 'skill' | 'agent' | 'tool'): string[] => state.parts.filter(p => p.kind === kind).map(p => p.name);

test('a layer that holds a harness shows its skill once, in the harness place, and still lists the agent and prompt the harness does not hold', async t => {
  const { home, root } = workspace(t);
  put(join(root, '.bowerloom', 'harness.json'), JSON.stringify({ engines: [{ id: 'claude-code' }] }));
  const { state } = await readState(home, root);
  assert.equal(state.harnessPlaces?.some(h => h.parts.some(p => p.name === 'Root skill')), true, 'the harness place holds the skill');
  assert.equal(shownTimes(state, 'Root skill'), 1, 'the skill is shown exactly once');
  assert.equal(shownTimes(state, 'Root agent'), 1, 'the team agent is shown');
  assert.equal(shownTimes(state, 'Root prompt'), 1, 'the prompt is shown');
  const source = state.sources.find(x => x.name === 'workspace (Bowerloom)');
  assert.equal(source?.harnessPlaceId, state.harnessPlaces?.find(h => h.parts.some(p => p.name === 'Root skill'))?.id, 'the source names the harness place, and the Overview lists the skill once');
  assert.equal(state.real!.notes.some(n => /Bowerloom folder/.test(n)), false, state.real!.notes.join(' | '));
});

test('a layer whose harness cannot be read is still listed by its own items', async t => {
  const { home, root } = workspace(t);
  put(join(root, '.bowerloom', 'harness.json'), '{ not json');
  const { state } = await readState(home, root);
  assert.equal(state.harnessPlaces?.some(h => !h.readable), true, 'the harness place is there and unreadable');
  for (const want of ['Root skill', 'Root agent', 'Root prompt']) assert.equal(shownTimes(state, want), 1, want);
});

test('two folders whose cleaned paths are equal are told apart: the one without a harness keeps its items', async t => {
  const home = tempDir(t, 'bowerloom-root-layer-'), root = join(home, 'work'), long = 'row-'.repeat(35);
  put(join(root, `${long}one`, '.bowerloom', 'harness.json'), JSON.stringify({ engines: [{ id: 'claude-code' }] }));
  put(join(root, `${long}one`, '.bowerloom', 'skills', 'held-skill', 'SKILL.md'), doc('Held skill', 'Shown by the harness place.'));
  put(join(root, `${long}two`, '.bowerloom', 'skills', 'plain-skill', 'SKILL.md'), doc('Plain skill', 'Shown by its own source.'));
  const { result, state } = await readState(home, root);
  const paths = result.world.scopes.filter(s => s.kind === 'project' && /row-/.test(s.path)).map(s => s.path);
  assert.equal(paths.length, 2); assert.equal(paths[0], paths[1], 'the two cleaned paths are equal');
  assert.equal(shownTimes(state, 'Held skill'), 1);
  assert.equal(shownTimes(state, 'Plain skill'), 1, names(state, 'skill').join(', '));
});

const harness = (): string => JSON.stringify({ engines: [{ id: 'claude-code' }] });

test('a team agent that shares a name with an agent of the harness is shown as well', async t => {
  const home = tempDir(t, 'bowerloom-root-layer-'), root = join(home, 'work');
  put(join(root, '.bowerloom', 'harness.json'), harness());
  put(join(root, '.bowerloom', 'agents', 'helper.md'), doc('helper', 'The harness agent.'));
  put(join(root, '.bowerloom', 'teams', 'crew', 'agents', 'helper.md'), doc('helper', 'The team agent.'));
  const { state } = await readState(home, root);
  assert.equal(names(state, 'agent').includes('helper'), true, 'the team agent is a part');
  assert.equal(shownTimes(state, 'helper'), 2, 'the harness agent and the team agent');
});

test('a prompt that shares a name with a connection or a hook of the harness is shown as well', async t => {
  const home = tempDir(t, 'bowerloom-root-layer-'), root = join(home, 'work');
  put(join(root, '.bowerloom', 'harness.json'), harness());
  put(join(root, '.bowerloom', 'mcp.json'), JSON.stringify({ servers: [{ name: 'review', transport: 'stdio', command: 'x' }] }));
  put(join(root, '.bowerloom', 'hooks.json'), JSON.stringify({ hooks: [{ id: 'review', event: 'PostToolUse', command: 'x', strength: 'advisory' }] }));
  put(join(root, '.bowerloom', 'prompts', 'review.md'), doc('review', 'A saved prompt.'));
  const { state } = await readState(home, root);
  assert.equal(names(state, 'tool').includes('review'), true, 'the prompt is a part');
  assert.equal(shownTimes(state, 'review'), 3, 'the connection, the hook and the prompt');
});

test('a set of notes that shares a name with a notes source of the harness is shown as well', async t => {
  const home = tempDir(t, 'bowerloom-root-layer-'), root = join(home, 'work');
  put(join(root, '.bowerloom', 'harness.json'), harness());
  put(join(root, '.bowerloom', 'knowledge.json'), JSON.stringify({ sources: [{ kind: 'wiki', name: 'work notes', path: 'notes' }] }));
  put(join(root, 'notes', 'one.md'), '# One\n\nA page of notes.\n');
  const { state } = await readState(home, root);
  assert.equal(state.parts.some(p => p.kind === 'context' && p.name === 'work notes'), true, state.parts.map(p => p.name).join(', '));
  assert.equal(shownTimes(state, 'work notes'), 2, 'the harness notes source and the set of notes');
});

test('a folder with a harness and layer items of its own is one group in the Overview', async t => {
  const { home, root } = workspace(t);
  put(join(root, '.bowerloom', 'harness.json'), harness());
  const { state } = await readState(home, root);
  const groups = overviewOf(state, []).groups.filter(g => g.name === 'workspace (Bowerloom)');
  assert.equal(groups.length, 1, 'one group');
  assert.deepEqual(groups[0]!.nodes.map(n => n.name).sort(), ['Root agent', 'Root prompt', 'Root skill']);
});

test('a folder whose harness cannot be read is one group too, with the unreadable note and its own items', async t => {
  const { home, root } = workspace(t);
  put(join(root, '.bowerloom', 'harness.json'), '{ not json');
  const { state } = await readState(home, root);
  const groups = overviewOf(state, []).groups.filter(g => g.name === 'workspace (Bowerloom)');
  assert.equal(groups.length, 1);
  assert.notEqual(groups[0]!.note, undefined);
  assert.deepEqual(groups[0]!.nodes.map(n => n.name).sort(), ['Root agent', 'Root prompt', 'Root skill']);
});

test('a skill with a name of 100 characters that a harness place shows is shown once', async t => {
  const home = tempDir(t, 'bowerloom-root-layer-'), root = join(home, 'work'), long = `A long skill name ${'with many words '.repeat(6)}`.trim();
  assert.ok(long.length > 100);
  put(join(root, '.bowerloom', 'harness.json'), harness());
  put(join(root, '.bowerloom', 'skills', 'long-one', 'SKILL.md'), doc(long, 'A skill with a long name.'));
  const { state } = await readState(home, root);
  const counts = overviewOf(state, []).groups.flatMap(g => g.nodes).filter(n => n.kind === 'skill').length;
  assert.equal(counts, 1);
});
