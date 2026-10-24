// Which connections of the harness graph are drawn: one faint line for each agent, and the full set only for the node that is chosen or pointed at.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPACT_GROUP_LIMITS, buildHarnessMap, groupIdOf, interfaceNodeId, ownGroupId } from '../shared/proto/harnessmodel.js';
import type { HarnessView } from '../shared/proto/harnessmodel.js';
import { drawnWires, neighboursOf } from '../shared/proto/harness-wires.js';
import { CASE_IDS, generateWorld } from '../shared/proto/sample.js';

const world = generateWorld(1);
const view = (scopeId: string, extra: Partial<HarnessView> = {}): HarnessView => ({ scopeId, showInherited: true, expandedGroups: [], ...extra });
const LIBRARY = groupIdOf(CASE_IDS.newerLibrary);

test('with nothing chosen, one faint line is drawn for each agent and each library of agents, to the first interface it lands in', () => {
  const m = buildHarnessMap(world, view('global')), wires = drawnWires(m, null);
  assert.ok(wires.every(w => w.state === 'summary' && w.edge.rel === 'lands-in'));
  const agents = m.nodes.filter(n => n.kind === 'agent' || n.id === LIBRARY);
  assert.equal(wires.length, agents.length);
  assert.deepEqual(new Set(wires.map(w => w.edge.from)), new Set(agents.map(n => n.id)), 'every agent has its line');
  for (const w of wires) {
    const all = m.edges.filter(e => e.from === w.edge.from && e.rel === 'lands-in').map(e => e.to);
    const order = [interfaceNodeId('claude-code'), interfaceNodeId('codex'), interfaceNodeId('opencode')];
    assert.equal(w.edge.to, order.find(id => all.includes(id)), `${w.edge.from} goes to the first interface it lands in`);
  }
  assert.ok(wires.length < m.edges.length / 3, `${wires.length} of ${m.edges.length} connections are drawn at first`);
});

test('the chosen node shows all of its own connections at full strength; the summary lines of the others stay', () => {
  const m = buildHarnessMap(world, view('global')), wires = drawnWires(m, 'agent-03');
  const mine = m.edges.filter(e => e.from === 'agent-03' || e.to === 'agent-03');
  assert.ok(mine.length >= 4);
  assert.deepEqual(wires.filter(w => w.state === 'focus').map(w => w.edge.id).sort(), mine.map(e => e.id).sort());
  const summary = wires.filter(w => w.state === 'summary');
  assert.ok(summary.length > 0 && summary.every(w => w.edge.from !== 'agent-03' && w.edge.rel === 'lands-in'), 'no line is drawn twice');
  assert.equal(new Set(wires.map(w => w.edge.id)).size, wires.length);
  // A connection that is neither the chosen node's nor an agent's summary is not drawn at all.
  assert.equal(wires.some(w => w.edge.from === 'agent-04' && w.edge.rel === 'uses'), false);
});

test('an interface shows every agent that lands in it; a group shows its own connections', () => {
  const m = buildHarnessMap(world, view('global')), face = interfaceNodeId('codex');
  const focus = drawnWires(m, face).filter(w => w.state === 'focus');
  assert.equal(focus.length, m.edges.filter(e => e.to === face).length);
  const skills = ownGroupId('skill', 'global');
  assert.equal(drawnWires(m, skills).filter(w => w.state === 'focus').length, m.edges.filter(e => e.from === skills || e.to === skills).length);
});

test('a node that is not in the model is the same as nothing chosen; neighbours are the nodes a node is joined to', () => {
  const m = buildHarnessMap(world, view('global'));
  assert.deepEqual(drawnWires(m, 'not-there'), drawnWires(m, null));
  const near = neighboursOf(m, 'agent-03');
  for (const e of m.edges) if (e.from === 'agent-03') assert.ok(near.has(e.to)); else if (e.to === 'agent-03') assert.ok(near.has(e.from));
  assert.equal(near.has('agent-03'), false);
});

test('a folded list of agents is one summary line, and a small canvas keeps the line count at the number of agent nodes', () => {
  const m = buildHarnessMap(world, view('global', { groupLimits: COMPACT_GROUP_LIMITS }));
  const wires = drawnWires(m, null), agentNodes = m.nodes.filter(n => n.memberKind === 'agent');
  assert.equal(agentNodes.length, 2);
  assert.equal(wires.length, 2);
});

test('with the library open, there is still one line for each of its 120 agents and nothing else', () => {
  const m = buildHarnessMap(world, view('global', { expandedGroups: [LIBRARY] }));
  assert.equal(drawnWires(m, null).length, m.nodes.filter(n => n.kind === 'agent').length + 0);
});
