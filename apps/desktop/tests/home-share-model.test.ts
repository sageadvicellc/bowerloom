// Share: what goes in a copy of the person's agents, what is left out, and the round trip into "From a shared file". Pure logic, no screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../shared/world/sample.js';
import { parseBundle } from '../shared/world/bundle.js';
import type { AgentItem, McpTool, World } from '../shared/world/types.js';
import { withSampleCopies } from '../shared/home/sample-copies.js';
import { ownedAgents } from '../shared/home/cards.js';
import { FILE_KIND_ORDER, countOf, readSharedFile } from '../shared/home/add-file.js';
import { buildShare, canSave, keysIn, planShare, shareCounts, shareableAgents, sizeBytes, toggleLeftOut } from '../shared/home/share-model.js';

const world = withSampleCopies(generateWorld(1));
const agents = ownedAgents(world);
const ids = agents.map(a => a.id);
/** A world with the same harnesses and wiki and none of the agents, skills, tools or notes: where a shared file lands as all new. */
const bare: World = { ...world, items: [], slices: [] };

const usedSkills = (list: readonly AgentItem[]): Set<string> => new Set(list.flatMap(a => a.definition.skillIds));
const ownedSkill = (id: string): boolean => world.items.some(i => i.id === id && i.kind === 'skill' && i.library === null);

test('the agents on offer are the ones the person owns, minus the ones Find skipped', () => {
  assert.equal(agents.length, 10);
  assert.deepEqual(shareableAgents(world).map(a => a.id), ids);
  assert.deepEqual(shareableAgents(world, [ids[0]!, ids[3]!]).map(a => a.id), ids.filter(id => id !== ids[0] && id !== ids[3]));
  assert.deepEqual(shareableAgents(world, ['nobody']).map(a => a.id), ids);
});

test('a copy of every agent holds the agents, the skills they use, the tools they use and the notes they read, and nothing else', () => {
  const bundle = buildShare(world, ids);
  const counts = shareCounts(bundle);
  assert.equal(counts.agents, 10);
  assert.equal(counts.skills, [...usedSkills(agents)].filter(ownedSkill).length);
  assert.equal(counts.tools, new Set(agents.flatMap(a => a.definition.toolAttachments.map(t => t.toolId))).size - world.items.filter(i => i.kind === 'tool' && i.toolKind === 'hook' && agents.some(a => a.definition.toolAttachments.some(t => t.toolId === i.id))).length);
  assert.equal(counts.noteSets, new Set(agents.flatMap(a => (a.definition.sliceId === undefined ? [] : [a.definition.sliceId]))).size);
  assert.ok(counts.skills > 0 && counts.tools > 0 && counts.noteSets > 0, JSON.stringify(counts));
  // A skill no agent uses is not in the copy.
  const unused = world.items.filter(i => i.kind === 'skill' && i.library === null && !usedSkills(agents).has(i.id));
  for (const s of unused) assert.equal(bundle.items.some(i => i.id === s.id), false, s.id);
});

test('leaving an agent out takes out the agent, and the skills, tools and notes that only it uses', () => {
  const all = buildShare(world, ids);
  for (const left of agents) {
    const rest = agents.filter(a => a.id !== left.id);
    const bundle = buildShare(world, rest.map(a => a.id));
    assert.equal(bundle.items.some(i => i.id === left.id), false);
    assert.equal(shareCounts(bundle).agents, 9);
    const keptSkills = new Set(rest.flatMap(a => a.definition.skillIds)), keptTools = new Set(rest.flatMap(a => a.definition.toolAttachments.map(t => t.toolId)));
    for (const item of bundle.items) if (item.kind === 'skill') assert.ok(keptSkills.has(item.id), `${left.id}: skill ${item.id} has no reader`);
    for (const t of bundle.toolRefs) assert.ok(keptTools.has(t.toolId), `${left.id}: tool ${t.toolId} has no reader`);
    for (const s of bundle.sliceRules) assert.ok(rest.some(a => a.definition.sliceId === s.sliceId), `${left.id}: notes ${s.sliceId} have no reader`);
    // Never more than the whole.
    const a = shareCounts(all), b = shareCounts(bundle);
    assert.ok(b.skills <= a.skills && b.tools <= a.tools && b.noteSets <= a.noteSets);
  }
});

test('a skill that two agents use stays when one of them is left out', () => {
  const shared = [...usedSkills(agents)].find(id => ownedSkill(id) && agents.filter(a => a.definition.skillIds.includes(id)).length >= 2)!;
  assert.ok(shared, 'the sample has a skill used by two agents');
  const [first, second] = agents.filter(a => a.definition.skillIds.includes(shared));
  const only = buildShare(world, [second!.id]);
  assert.equal(only.items.some(i => i.id === shared), true);
  assert.equal(buildShare(world, ids.filter(id => id !== first!.id)).items.some(i => i.id === shared), true);
});

test('with nothing ticked the copy is empty and cannot be saved', () => {
  const plan = planShare(world, ids, ids);
  assert.deepEqual(plan.counts, { agents: 0, skills: 0, tools: 0, noteSets: 0 });
  assert.equal(plan.keys, 0);
  assert.equal(canSave(plan), false);
  assert.equal(plan.leftOutAgents, 10);
  assert.equal(canSave(planShare(world, ids, [])), true);
});

test('the plan counts what is left out: keys, and the agents the person unticked', () => {
  const none = planShare(world, ids, []);
  assert.equal(none.leftOutAgents, 0);
  assert.equal(none.keys, keysIn(none.bundle));
  const some = planShare(world, ids, [ids[0]!, ids[1]!]);
  assert.equal(some.leftOutAgents, 2);
  assert.equal(some.counts.agents, 8);
  assert.ok(some.keys <= none.keys);
  // An id that is not on offer is not counted as left out.
  assert.equal(planShare(world, ids, ['nobody']).leftOutAgents, 0);
  assert.equal(planShare(world, ids, ['nobody']).counts.agents, 10);
});

test('toggling an agent in the leave-out list puts it in or takes it out, and never repeats it', () => {
  assert.deepEqual(toggleLeftOut([], 'a'), ['a']);
  assert.deepEqual(toggleLeftOut(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(toggleLeftOut(toggleLeftOut([], 'a'), 'a'), []);
});

test('secrets: the copy holds the name of a key and never a value, and counts the keys it leaves out', () => {
  const withKey = (tool: McpTool): McpTool => ({ ...tool, secret: { kind: 'env', name: 'LANTERN_TOKEN', state: 'present', value: 'sk-live-0123456789' } as unknown as McpTool['secret'] });
  const mcp = world.items.find((i): i is McpTool => i.kind === 'tool' && i.toolKind === 'mcp' && agents.some(a => a.definition.toolAttachments.some(t => t.toolId === i.id)))!;
  const leaky: World = { ...world, items: world.items.map(i => (i.id === mcp.id ? withKey(mcp) : i)) };
  const plan = planShare(leaky, ids, []);
  assert.doesNotMatch(plan.text, /sk-live-0123456789/);
  assert.doesNotMatch(plan.text, /secret"?:\{[^}]*value/);
  assert.match(plan.text, /LANTERN_TOKEN/);
  for (const ref of plan.bundle.toolRefs) if (ref.secret !== null) assert.deepEqual(Object.keys(ref.secret).sort(), ['kind', 'name']);
  assert.ok(plan.keys >= 1);
  // Two tools that name one key need it once.
  const barrow = plan.bundle.toolRefs.filter(t => t.secret?.name === 'BARROW_TOKEN');
  assert.equal(barrow.length, 2);
  assert.equal(plan.keys, new Set(plan.bundle.toolRefs.flatMap(t => (t.secret === null ? [] : [t.secret.name]))).size);
  // The bundle code refuses a file that carries a value, so what was built can be read back.
  assert.doesNotThrow(() => parseBundle(JSON.parse(plan.text)));
});

test('the copy has no path from the person\'s computer and no page of the wiki', () => {
  const plan = planShare(world, ids, []);
  assert.doesNotMatch(plan.text, /\/Users\/|\/home\/|[A-Za-z]:\\|\.\.\//);
  assert.equal(plan.text.includes('wikiPages'), false);
  assert.equal(plan.bundle.sliceRules.every(s => s.name !== '' && !('seeds' in s)), true);
  const page = world.wikiPages[0]!;
  assert.equal(plan.text.includes(page.summary), false);
});

test('the size is the number of bytes of the text, and grows with the agents', () => {
  const small = planShare(world, ids, ids.slice(1)), big = planShare(world, ids, []);
  assert.equal(big.bytes, new TextEncoder().encode(big.text).length);
  assert.ok(small.bytes < big.bytes);
  assert.equal(sizeBytes(big.text), big.bytes);
});

test('round trip: a copy opened as a shared file in a place that has none of it shows the same counts', () => {
  for (const left of [[], [ids[0]!], ids.slice(0, 4)]) {
    const plan = planShare(world, ids, left);
    const result = readSharedFile(plan.text, bare);
    assert.ok(result.ok, JSON.stringify(left));
    const p = result.preview;
    assert.equal(countOf(p, 'agent'), plan.counts.agents);
    assert.equal(countOf(p, 'skill'), plan.counts.skills);
    assert.equal(countOf(p, 'tool'), plan.counts.tools);
    assert.equal(countOf(p, 'note'), plan.counts.noteSets);
    assert.equal(p.added.length, FILE_KIND_ORDER.reduce((n, k) => n + countOf(p, k), 0));
    assert.equal(p.alreadyHere.length, 0);
    assert.equal(p.differentCopies.length, 0);
    assert.equal(p.keysNeeded, plan.keys);
  }
});

test('round trip: the copy parses back to the same bundle, and opened where it came from adds nothing', () => {
  const plan = planShare(world, ids, []);
  assert.deepEqual(parseBundle(JSON.parse(plan.text)), JSON.parse(plan.text));
  const again = readSharedFile(plan.text, world);
  assert.ok(again.ok);
  assert.equal(again.preview.added.length, 0);
  assert.ok(again.preview.alreadyHere.length >= 1);
});

test('round trip: the copy of a few agents opens in the world without them, and the agents come back with their skills', () => {
  const left = ids.slice(0, 7);
  const plan = planShare(world, ids, left);
  const target: World = { ...world, items: world.items.filter(i => !(i.kind === 'agent' && plan.bundle.items.some(b => b.id === i.id))) };
  const result = readSharedFile(plan.text, target);
  assert.ok(result.ok);
  assert.equal(countOf(result.preview, 'agent'), 3);
  assert.equal(result.preview.differentCopies.length, 0);
});
