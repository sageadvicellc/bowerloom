// Moving or dragging one node changes the place of that node only. Default places depend on the list of parts and their links, never on a saved or dragged place
// (shared/harness/layout.ts, `graphOf`). Before this rule, a dragged skill pushed every other part and every unplaced agent below it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dropLinkTarget, graphOf } from '../shared/harness/layout.js';
import type { GraphNode } from '../shared/harness/layout.js';
import { definitionWorld } from '../shared/harness/save-draft.js';
import { SAMPLE_IDS, createSampleWorld } from '../shared/harness/sample.js';
import { harnessById } from '../shared/harness/status.js';
import type { DefinitionView } from '../shared/engine/types.js';

const MADE_UP: DefinitionView = {
  id: 'rope-yard', description: 'Makes rope.', engines: ['claude-code'], instructions: true,
  skills: ['knot-guide', 'splice-guide', 'dye-guide', 'braid-guide', 'coil-guide'].map(id => ({ id, name: id, description: `The ${id}.` })),
  agents: [
    { id: 'tallyman', name: 'tallyman', description: 'Counts.', skills: ['knot-guide', 'splice-guide'], notes: [] },
    { id: 'spinner', name: 'spinner', description: 'Spins.', skills: ['dye-guide'], notes: [] },
    { id: 'rigger', name: 'rigger', description: 'Rigs.', skills: [], notes: [] },
  ],
  sources: [{ name: 'yard-log', kind: 'wiki-folder', label: '~/Documents/Yard log', notesId: 'notes-1' }], kits: [],
};

const sampleState = createSampleWorld();
const sample = { state: sampleState, harness: harnessById(sampleState, SAMPLE_IDS.weekly)! };
const made = definitionWorld(MADE_UP);

// A small deterministic generator, so a failure repeats.
const rng = (seed: number): (() => number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

for (const [name, world] of [['the sample harness', sample], ['a made-up harness of 3 agents and 5 skills', made]] as const) {
  test(`${name}: dragging one node changes no other node, for 200 random moves`, () => {
    const base = graphOf(world.state, world.harness);
    const random = rng(7);
    for (let i = 0; i < 200; i += 1) {
      const target = base.nodes[Math.floor(random() * base.nodes.length)]!;
      const far = { x: Math.round(random() * 3000 - 1000), y: Math.round(random() * 3000 - 1000) };
      const moved = graphOf(world.state, world.harness, { [target.id]: far });
      assert.equal(moved.nodes.length, base.nodes.length);
      for (const n of moved.nodes) {
        const before = base.nodes.find(b => b.id === n.id)!;
        if (n.id === target.id) assert.deepEqual([n.x, n.y], [far.x, far.y]);
        else assert.deepEqual(n, before, `moving ${target.id} must not change ${n.id}`);
      }
    }
  });

  test(`${name}: a saved place changes that node only`, () => {
    const base = graphOf(world.state, world.harness);
    for (const target of base.nodes) {
      const saved = { ...world.harness, positions: { ...world.harness.positions, [target.id]: { x: 900, y: 900 } } };
      const g = graphOf(world.state, saved);
      for (const n of g.nodes) if (n.id !== target.id) assert.deepEqual(n, base.nodes.find(b => b.id === n.id));
    }
  });
}

test('with nothing moved, the default places are the same on every call and agents never overlap', () => {
  const a = graphOf(made.state, made.harness), b = graphOf(made.state, made.harness);
  assert.deepEqual(a, b);
  const agents = a.nodes.filter(n => n.kind === 'agent');
  for (let i = 1; i < agents.length; i += 1) assert.ok(agents[i]!.y >= agents[i - 1]!.y + agents[i - 1]!.h + 12 - 0.001);
  const rest = a.nodes.filter(n => n.kind !== 'agent');
  assert.deepEqual(rest.map(n => n.y), rest.map((_, i) => 40 + i * 76));
});

test('the drop still finds an agent after a skill was dragged 600 units away', () => {
  const skill = 'skill:knot-guide';
  const base = graphOf(made.state, made.harness);
  const home = base.nodes.find(n => n.id === skill)!;
  const dragged = graphOf(made.state, made.harness, { [skill]: { x: home.x + 600, y: home.y + 600 } });
  const agent = dragged.nodes.find(n => n.id === 'agent:tallyman') as GraphNode;
  assert.deepEqual(agent, base.nodes.find(n => n.id === 'agent:tallyman'), 'the agent stayed under the pointer');
  assert.equal(dropLinkTarget(dragged.nodes, skill, { x: agent.x + agent.w / 2, y: agent.y + agent.h / 2 }), 'agent:tallyman');
});
