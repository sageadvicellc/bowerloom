// A workspace root with its own `.bowerloom` layer. The layer's skill, agent and saved prompt must show in the scan, as they do for any other work folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createScanner } from '../main/real-scan.js';
import { buildRealResult } from '../shared/real/map-world.js';
import { realToHarnessState } from '../shared/harness/real-map.js';
import { tempDir } from './support.js';
import type { TestContext } from 'node:test';

const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
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

test('a root layer that holds a harness is shown once, as a harness place, and not as a source as well', async t => {
  const { home, root } = workspace(t), scanner = createScanner({ home });
  put(join(root, '.bowerloom', 'harness.json'), JSON.stringify({ engines: [{ id: 'claude-code' }] }));
  const found = await scanner.addFolder(root);
  const batch = await scanner.read(found.places.map(p => p.id));
  const state = realToHarnessState(buildRealResult(batch.reads, batch.tally, { nowMs: Date.UTC(2026, 10, 1), foldExtraApps: true }), found.places);
  assert.equal(state.sources.some(s => s.name === 'workspace (Bowerloom)'), false);
  assert.ok(state.harnessPlaces?.some(h => h.parts.some(p => p.name === 'Root skill')), 'the harness place holds the skill');
  assert.ok(state.sources.some(s => s.name === 'inner (Bowerloom)'), 'a nested layer with no harness still has its source');
  assert.ok(state.real!.notes.some(n => /3 things in a Bowerloom folder are not shown\./.test(n)), state.real!.notes.join(' | '));
});
