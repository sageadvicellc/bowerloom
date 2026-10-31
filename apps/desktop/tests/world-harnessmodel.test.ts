// The harness graph model: what is drawn for each scope, the state flags, the library groups, and the wires.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCESS_WORDS, COMPACT_GROUP_LIMITS, NO_OWN_GROUPS, actionsFor, buildHarnessMap, describeNode, groupIdOf, interfaceNodeId, ownGroupId, ownGroupParts, scopeNodeId } from '../shared/world/harnessmodel.js';
import type { HarnessMapModel, HarnessNode, HarnessView } from '../shared/world/harnessmodel.js';
import { CASE_IDS, generateWorld } from '../shared/world/sample.js';
import type { AgentItem, World } from '../shared/world/types.js';
import { DESKTOP } from './support.js';

const world = generateWorld(1);
/** These tests are about the nodes of single items, so no skill is folded into a group here. The folding has its own tests below. */
const view = (scopeId: string, extra: Partial<HarnessView> = {}): HarnessView => ({ scopeId, showInherited: true, expandedGroups: [], groupLimits: NO_OWN_GROUPS, ...extra });
const node = (m: HarnessMapModel, id: string): HarnessNode => { const n = m.nodes.find(x => x.id === id); assert.ok(n, `node ${id} is missing`); return n; };
const has = (m: HarnessMapModel, id: string): boolean => m.nodes.some(n => n.id === id);
type Editable = { -readonly [K in keyof World]: World[K] };
const clone = (): Editable => structuredClone(world) as Editable;
type EditableAgent = { definition: { skillIds: string[] } };
const LIBRARY = groupIdOf(CASE_IDS.newerLibrary);

test('the global scope shows every kind of node: root, interfaces, skills, agents, tools of all three kinds, slices, and one library group', () => {
  const m = buildHarnessMap(world, view('global'));
  assert.equal(m.scopeId, 'global');
  const kinds = new Set(m.nodes.map(n => n.kind));
  for (const k of ['scope', 'interface', 'skill', 'agent', 'tool', 'context-slice', 'group'] as const) assert.ok(kinds.has(k), k);
  assert.deepEqual(new Set(m.nodes.filter(n => n.kind === 'tool').map(n => n.toolKind)), new Set(['mcp', 'prompt', 'hook']));
  assert.equal(m.nodes.filter(n => n.kind === 'scope').length, 1);
  assert.equal(m.nodes[0]!.id, scopeNodeId('global'));
  assert.deepEqual(m.nodes.filter(n => n.kind === 'interface').map(n => n.id), ['claude-code', 'codex', 'opencode'].map(i => interfaceNodeId(i as 'codex')));
  assert.equal(m.nodes.filter(n => n.kind === 'group').length, 1);
  assert.equal(new Set(m.nodes.map(n => n.id)).size, m.nodes.length, 'node ids are unique');
});

test('every scope stays under 400 nodes with the library collapsed, and the library is one node, not 120', () => {
  for (const scope of world.scopes) for (const showInherited of [true, false]) {
    const m = buildHarnessMap(world, view(scope.id, { showInherited }));
    assert.ok(m.nodes.length < 400, `${scope.id}: ${m.nodes.length}`);
    assert.equal(m.nodes.some(n => n.id.startsWith('agent-lib-')), false, 'no library agent is drawn on its own');
  }
  assert.ok(buildHarnessMap(world, view('global')).nodes.length > 40, 'the global scope is a real harness');
});

test('inherited flags per scope: the global scope inherits nothing; a project draws global items as inherited and its own as solid; the toggle removes them', () => {
  const global = buildHarnessMap(world, view('global'));
  assert.equal(global.nodes.some(n => n.inherited), false);
  const project = buildHarnessMap(world, view('scope-copperfen'));
  const own = world.items.filter(i => i.scopeId === 'scope-copperfen').map(i => i.id), globals = world.items.filter(i => i.scopeId === 'global').map(i => i.id);
  assert.ok(own.length > 0);
  for (const id of own) { const n = node(project, id); assert.equal(n.inherited, false, id); assert.equal(n.fromScope, null, id); assert.equal(n.badges.includes('inherited'), false, id); }
  const inherited = project.nodes.filter(n => n.inherited);
  assert.ok(inherited.length > 30);
  for (const n of inherited) { assert.ok(globals.includes(n.id) || n.kind === 'group', n.id); assert.equal(n.fromScope, 'Studio', n.id); }
  assert.ok(node(project, 'skill-010').badges.includes('inherited'));
  // A project never shows another project's items.
  for (const i of world.items) if (i.scopeId !== 'scope-copperfen' && i.scopeId !== 'global') assert.equal(has(project, i.id), false, `${i.id} belongs to another project`);
  const alone = buildHarnessMap(world, view('scope-copperfen', { showInherited: false }));
  assert.equal(alone.nodes.some(n => n.inherited), false);
  assert.equal(alone.nodes.some(n => n.kind === 'group'), false, 'the library is inherited too');
  for (const id of own) assert.ok(has(alone, id), id);
  assert.ok(alone.nodes.length < project.nodes.length / 2);
});

test('a hidden item is a ghost: kept in the model, flagged hidden and inherited, with no wires; it is not a ghost where nothing hides it', () => {
  const m = buildHarnessMap(world, view(CASE_IDS.hidingScope));
  const ghost = node(m, CASE_IDS.hiddenSkill);
  assert.equal(ghost.hidden, true); assert.equal(ghost.inherited, true); assert.ok(ghost.badges.includes('hidden')); assert.equal(ghost.badges.includes('inherited'), false);
  assert.equal(node(buildHarnessMap(world, view('global')), CASE_IDS.hiddenSkill).hidden, false);
  assert.equal(node(buildHarnessMap(world, view('scope-copperfen')), CASE_IDS.hiddenSkill).hidden, false, 'another project does not hide it');
  // Make an agent use the skill, so there is a wire to lose.
  const w = clone(), agent = w.items.find(i => i.id === 'agent-01') as unknown as EditableAgent;
  agent.definition.skillIds = [...agent.definition.skillIds, CASE_IDS.hiddenSkill];
  const edgesOf = (model: HarnessMapModel): number => model.edges.filter(e => e.from === CASE_IDS.hiddenSkill || e.to === CASE_IDS.hiddenSkill).length;
  assert.ok(edgesOf(buildHarnessMap(w, view('global'))) > 0, 'the skill has wires where it is shown');
  assert.equal(edgesOf(buildHarnessMap(w, view(CASE_IDS.hidingScope))), 0, 'the ghost has none');
  // Taking the hide away brings the wires back: the ghost was only an override, not a deletion.
  w.overrides = w.overrides.filter(o => o.itemId !== CASE_IDS.hiddenSkill);
  assert.ok(edgesOf(buildHarnessMap(w, view(CASE_IDS.hidingScope))) > 0);
  // The ghost stands for an inherited item, so it is not drawn when inherited items are off.
  assert.equal(has(buildHarnessMap(world, view(CASE_IDS.hidingScope, { showInherited: false })), CASE_IDS.hiddenSkill), false);
});

test('a replaced item shows its replacement: flagged replaced, a replaces wire from the new item, and agents are drawn using the new item', () => {
  const w = clone();
  const user = w.items.find(i => i.id === 'agent-02') as unknown as EditableAgent;
  user.definition.skillIds = [...user.definition.skillIds, 'skill-005'];
  const replacement = w.overrides.find(o => o.itemId === 'skill-005')!.replacementItemId!;
  const m = buildHarnessMap(w, view('scope-copperfen'));
  const old = node(m, 'skill-005');
  assert.equal(old.replaced, true); assert.equal(old.replacedBy, replacement); assert.ok(old.badges.includes('replaced')); assert.equal(old.hidden, false);
  assert.equal(node(m, replacement).replaced, false); assert.equal(node(m, replacement).inherited, false);
  assert.ok(m.edges.some(e => e.rel === 'replaces' && e.from === replacement && e.to === 'skill-005'));
  assert.ok(m.edges.some(e => e.rel === 'uses' && e.from === 'agent-02' && e.to === replacement), 'the agent uses the new skill');
  assert.equal(m.edges.some(e => e.rel === 'uses' && e.to === 'skill-005'), false, 'nobody uses the old one here');
  assert.equal(m.edges.some(e => e.from === 'skill-005' && e.rel === 'lands-in'), false, 'a replaced item is not written');
  // In the global scope nothing is replaced and the agent still uses the old skill.
  const g = buildHarnessMap(w, view('global'));
  assert.equal(node(g, 'skill-005').replaced, false);
  assert.ok(g.edges.some(e => e.rel === 'uses' && e.from === 'agent-02' && e.to === 'skill-005'));
  // An inherit override changes nothing.
  assert.equal(node(buildHarnessMap(world, view('scope-tallowbrook')), 'skill-006').hidden, false);
});

test('the library is one group node, collapsed by default, with its count, version and read-only words', () => {
  const m = buildHarnessMap(world, view('global'));
  const g = node(m, LIBRARY);
  assert.equal(g.kind, 'group'); assert.equal(g.label, 'Evergreen Kit, 120 agents'); assert.equal(g.memberCount, 120); assert.equal(g.expanded, false);
  assert.equal(g.libraryPinned, true); assert.equal(g.newerVersion, true); assert.match(g.detail, /2\.3\.0/); assert.match(g.detail, /2\.4\.0/); assert.match(g.detail, /read only/);
  assert.ok(g.badges.includes('new version'));
  assert.ok(m.edges.some(e => e.rel === 'lands-in' && e.from === LIBRARY && e.to === interfaceNodeId('claude-code')), 'the group lands in the interface its items were found in');
  assert.equal(m.edges.filter(e => e.from === LIBRARY && e.rel === 'lands-in').length, 1);
});

test('the library opens when its id is in expandedGroups: every item is drawn one by one, with its library flags, and the group says it is open', () => {
  for (const id of [LIBRARY, CASE_IDS.newerLibrary]) {
    const m = buildHarnessMap(world, view('global', { expandedGroups: [id] }));
    const members = m.nodes.filter(n => n.groupId === LIBRARY);
    assert.equal(members.length, 120, id);
    for (const n of members) { assert.equal(n.libraryPinned, true); assert.equal(n.kind, 'agent'); }
    assert.equal(node(m, LIBRARY).expanded, true);
    assert.equal(members.filter(n => n.newerVersion).map(n => n.id).join(), CASE_IDS.newerLibraryItem, 'only the planted item has a new version of its own');
    assert.ok(node(m, CASE_IDS.newerLibraryItem).badges.includes('new version'));
    assert.equal(m.edges.filter(e => e.rel === 'lands-in' && members.some(x => x.id === e.from)).length, 120);
    assert.ok(m.nodes.length < 400, 'even open, a harness of this size stays readable');
  }
  assert.equal(buildHarnessMap(world, view('global', { expandedGroups: ['group:something-else'] })).nodes.some(n => n.groupId !== null), false);
});

test('the four planted cases show the right flags', () => {
  const m = buildHarnessMap(world, view('global'));
  const triple = node(m, CASE_IDS.tripleSkill);
  assert.equal(triple.conflict, true); assert.ok(triple.badges.includes('conflict'));
  assert.deepEqual(m.nodes.filter(n => n.conflict).map(n => n.id), [CASE_IDS.tripleSkill], 'no other item has different text in different interfaces');
  assert.equal(m.edges.filter(e => e.from === CASE_IDS.tripleSkill && e.rel === 'lands-in').length, 3, 'it lands in all three interfaces');
  const hook = node(m, CASE_IDS.hook);
  assert.equal(hook.runsCode, true); assert.equal(hook.toolKind, 'hook'); assert.ok(hook.badges.includes('runs code'));
  assert.deepEqual(m.nodes.filter(n => n.runsCode).every(n => n.toolKind === 'hook'), true);
  const missing = node(m, CASE_IDS.mcpMissing), present = node(m, CASE_IDS.mcpPresent);
  assert.equal(missing.secretMissing, true); assert.ok(missing.badges.includes('secret missing')); assert.equal(missing.toolKind, 'mcp');
  assert.equal(present.secretMissing, false); assert.equal(present.badges.includes('secret missing'), false);
  assert.deepEqual(m.nodes.filter(n => n.secretMissing).map(n => n.id), [CASE_IDS.mcpMissing]);
  assert.equal(node(m, LIBRARY).newerVersion, true);
  const project = buildHarnessMap(world, view(CASE_IDS.hidingScope));
  assert.equal(node(project, CASE_IDS.hiddenSkill).hidden, true);
  // A flag is also a word, so it never rests on colour alone.
  for (const n of [triple, hook, missing]) assert.ok(n.badges.length > 0);
});

test('wires: agents use skills, have tools (labelled with the access class), and read slices; items land in installed interfaces', () => {
  const m = buildHarnessMap(world, view('global'));
  const byId = new Map(m.nodes.map(n => [n.id, n]));
  const rels = new Set(m.edges.map(e => e.rel));
  for (const r of ['uses', 'has-tool', 'reads', 'lands-in'] as const) assert.ok(rels.has(r), r);
  for (const e of m.edges.filter(x => x.rel === 'uses')) { assert.equal(byId.get(e.from)!.kind, 'agent'); assert.equal(byId.get(e.to)!.kind, 'skill'); }
  for (const e of m.edges.filter(x => x.rel === 'reads')) { assert.equal(byId.get(e.from)!.kind, 'agent'); assert.equal(byId.get(e.to)!.kind, 'context-slice'); }
  const accessWords = new Set(Object.values(ACCESS_WORDS));
  const toolEdges = m.edges.filter(x => x.rel === 'has-tool');
  assert.ok(toolEdges.length > 0);
  for (const e of toolEdges) { assert.equal(byId.get(e.from)!.kind, 'agent'); assert.equal(byId.get(e.to)!.kind, 'tool'); assert.ok(accessWords.has(e.label), e.label); assert.notEqual(byId.get(e.to)!.toolKind, 'hook', 'an agent never has a hook'); }
  for (const e of m.edges.filter(x => x.rel === 'lands-in')) assert.equal(byId.get(e.to)!.kind, 'interface');
  // The wires match the definitions.
  const agent = world.items.find(i => i.id === 'agent-01') as AgentItem;
  for (const id of agent.definition.skillIds) assert.ok(m.edges.some(e => e.rel === 'uses' && e.from === agent.id && e.to === id), id);
  for (const a of agent.definition.toolAttachments) assert.equal(m.edges.find(e => e.rel === 'has-tool' && e.from === agent.id && e.to === a.toolId)?.label, ACCESS_WORDS[a.access]);
  assert.equal(m.edges.some(e => e.rel === 'reads' && e.from === agent.id), agent.definition.sliceId !== undefined);
});

test('an item lands only in an installed interface; an interface that is not installed is still a node, marked in words', () => {
  const w = clone();
  w.interfaces = w.interfaces.map(i => (i.id === 'codex' ? { ...i, installed: 'not-installed' as const } : i.id === 'opencode' ? { ...i, installed: 'unknown' as const } : i));
  const m = buildHarnessMap(w, view('global'));
  for (const id of ['codex', 'opencode'] as const) {
    const n = node(m, interfaceNodeId(id));
    assert.equal(n.notInstalled, true); assert.ok(n.badges.includes('not installed'));
    assert.equal(m.edges.some(e => e.to === n.id), false, `nothing lands in ${id}`);
  }
  assert.equal(node(m, interfaceNodeId('claude-code')).notInstalled, false);
  assert.ok(m.edges.some(e => e.to === interfaceNodeId('claude-code')));
  assert.match(node(m, interfaceNodeId('codex')).detail, /Not installed/);
});

test('the interface filter keeps one interface and only what lands in it (slices stay)', () => {
  const m = buildHarnessMap(world, view('global', { interfaceFilter: 'codex' }));
  assert.deepEqual(m.nodes.filter(n => n.kind === 'interface').map(n => n.interfaceId), ['codex']);
  const items = new Map(world.items.map(i => [i.id, i]));
  for (const n of m.nodes.filter(x => x.kind === 'skill' || x.kind === 'agent' || x.kind === 'tool')) assert.ok(items.get(n.id)!.foundAt.some(f => f.interface === 'codex'), n.id);
  assert.ok(m.nodes.some(n => n.kind === 'context-slice'));
  assert.equal(m.nodes.some(n => n.kind === 'group'), false, 'every library item was found only in Claude Code');
  assert.ok(m.edges.every(e => e.rel !== 'lands-in' || e.to === interfaceNodeId('codex')));
  assert.ok(m.nodes.length < buildHarnessMap(world, view('global')).nodes.length);
});

test('no wire dangles, no wire repeats, and no wire runs from a node to itself: every scope, filter and open library', () => {
  const views: HarnessView[] = [];
  for (const s of world.scopes) for (const showInherited of [true, false]) for (const expandedGroups of [[], [LIBRARY]]) for (const interfaceFilter of [undefined, 'claude-code', 'codex', 'opencode'] as const) {
    views.push({ scopeId: s.id, showInherited, expandedGroups, ...(interfaceFilter === undefined ? {} : { interfaceFilter }) });
  }
  for (const v of views) {
    const m = buildHarnessMap(world, v), ids = new Set(m.nodes.map(n => n.id));
    assert.equal(ids.size, m.nodes.length);
    assert.equal(new Set(m.edges.map(e => e.id)).size, m.edges.length, 'edge ids are unique');
    for (const e of m.edges) { assert.ok(ids.has(e.from) && ids.has(e.to), `${JSON.stringify(v)} ${e.id}`); assert.notEqual(e.from, e.to); }
    for (const n of m.nodes.filter(x => x.hidden)) assert.equal(m.edges.some(e => e.from === n.id || e.to === n.id), false, n.id);
  }
});

test('words: the model says harness words only, never a helper, a team or a command line', () => {
  const bad = /\b(helpers?|teams?|command[- ]line|terminal|cli)\b/i;
  const models = [buildHarnessMap(world, view('global', { expandedGroups: [LIBRARY] })), ...world.scopes.map(s => buildHarnessMap(world, view(s.id)))];
  for (const m of models) {
    for (const n of m.nodes) for (const text of [n.kindLabel, n.label, n.detail, ...n.badges, describeNode(n)]) assert.doesNotMatch(text, bad, `${n.id}: ${text}`);
    for (const e of m.edges) assert.doesNotMatch(e.label, bad);
  }
  const labels = new Set(buildHarnessMap(world, view('global')).nodes.map(n => n.kindLabel));
  for (const word of ['Global harness', 'Interface', 'Skill', 'Agent', 'Slice', 'Tool · hook']) assert.ok(labels.has(word), word);
  assert.ok(buildHarnessMap(world, view('scope-copperfen')).nodes.some(n => n.kindLabel === 'Project harness'));
});

test('describeNode names the kind, the name and each state in plain words', () => {
  const m = buildHarnessMap(world, view(CASE_IDS.hidingScope));
  const hidden = describeNode(node(m, CASE_IDS.hiddenSkill));
  assert.match(hidden, /^Skill, /); assert.match(hidden, /Hidden in this project, inherited from Studio/);
  const g = buildHarnessMap(world, view('global'));
  assert.match(describeNode(node(g, CASE_IDS.hook)), /Runs code with no prompt/);
  assert.match(describeNode(node(g, CASE_IDS.mcpMissing)), /Its secret is missing/);
  assert.match(describeNode(node(g, CASE_IDS.tripleSkill)), /Conflict: it has different text in different interfaces/);
  assert.match(describeNode(node(g, LIBRARY)), /A new version is waiting.*Closed/);
  assert.match(describeNode(node(buildHarnessMap(world, view('scope-copperfen')), 'skill-010')), /Inherited from Studio, shown faded/);
  assert.match(describeNode(node(g, 'agent-01')), /^Agent, /);
});

test('the model is pure: it does not change the world, and the same view gives the same model', () => {
  const before = JSON.stringify(world);
  const a = buildHarnessMap(world, view('scope-copperfen', { expandedGroups: [LIBRARY] })), b = buildHarnessMap(structuredClone(world), view('scope-copperfen', { expandedGroups: [LIBRARY] }));
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(world), before);
  assert.ok(JSON.stringify(a).length > 1000);
});

test('an unknown scope falls back to the global scope, and a world with no scopes gives an empty model', () => {
  assert.equal(buildHarnessMap(world, view('nope')).scopeId, 'global');
  const w = clone(); w.scopes = [];
  assert.deepEqual(buildHarnessMap(w, view('global')), { scopeId: 'global', nodes: [], edges: [] });
});

test('long text is cut to one short line', () => {
  const w = clone(), skill = w.items.find(i => i.id === 'skill-003') as { description: string };
  skill.description = 'word '.repeat(200);
  assert.ok(node(buildHarnessMap(w, view('global')), 'skill-003').detail.length <= 90);
});

test('shared/world/harnessmodel.ts is pure: types and the slice rule only, no file, clock, random number, markup string or bridge', () => {
  for (const file of ['harnessmodel.ts']) {
    const code = readFileSync(join(DESKTOP, 'shared', 'world', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /from ['"]node:|node:fs|Math\.random|Date\.|\bnew Date\b|innerHTML|window\.bowerloom|\beval\(|process\.env|fetch\(|localStorage/, file);
    for (const m of code.matchAll(/^import[\s\S]*?;$/gm)) assert.match(m[0], /from '\.\/(types|slicerule|harnessmodel|common|words)\.js';$/, `${file}: ${m[0]}`);
  }
});

test('the menu of a node: open for all; hide and replace for an inherited item; show again for a ghost or a replaced item; open or close for a group', () => {
  const m = buildHarnessMap(world, view(CASE_IDS.hidingScope));
  const acts = (id: string): string[] => actionsFor(node(m, id)).map(a => a.action);
  assert.deepEqual(acts('skill-010'), ['open', 'hide', 'replace']);
  assert.deepEqual(acts(CASE_IDS.hiddenSkill), ['open', 'unhide']);
  assert.deepEqual(acts('skill-proj-1'), ['open'], 'an item the project owns is not hidden or replaced');
  assert.deepEqual(acts(scopeNodeId(CASE_IDS.hidingScope)), ['open']);
  assert.deepEqual(acts(interfaceNodeId('codex')), ['open']);
  assert.deepEqual(acts(LIBRARY), ['open', 'expand']);
  assert.deepEqual(actionsFor(node(buildHarnessMap(world, view(CASE_IDS.hidingScope, { expandedGroups: [LIBRARY] })), LIBRARY)).map(a => a.action), ['open', 'collapse']);
  const global = buildHarnessMap(world, view('global'));
  assert.deepEqual(actionsFor(node(global, 'skill-010')).map(a => a.action), ['open'], 'nothing is inherited in the global scope');
  const copper = buildHarnessMap(world, view('scope-copperfen'));
  assert.deepEqual(actionsFor(node(copper, 'skill-005')).map(a => a.action), ['open', 'unhide']);
  assert.match(actionsFor(node(copper, 'skill-005'))[1]!.label, /Stop replacing/);
  for (const m2 of [m, global, copper]) for (const n of m2.nodes) for (const a of actionsFor(n)) assert.doesNotMatch(a.label, /\b(helper|team|command line)\b/i);
});

// ------------------------------------------------------------------------------------------------------- own groups

/** The default view: a long list of skills is one node. */
const folded = (scopeId: string, extra: Partial<HarnessView> = {}): HarnessView => ({ scopeId, showInherited: true, expandedGroups: [], ...extra });
const SKILLS = ownGroupId('skill', 'global');

test('a scope with more than 12 owned skills draws them as one group: "44 skills", with the flags of what it holds', () => {
  const m = buildHarnessMap(world, folded('global'));
  const g = node(m, SKILLS);
  assert.equal(g.kind, 'group'); assert.equal(g.label, '44 skills'); assert.equal(g.memberCount, 44); assert.equal(g.memberKind, 'skill'); assert.equal(g.expanded, false);
  assert.equal(g.kindLabel, 'Group'); assert.equal(g.libraryPinned, false); assert.equal(g.inherited, false);
  assert.equal(m.nodes.filter(n => n.kind === 'skill').length, 0, 'no skill is drawn on its own');
  assert.equal(g.conflict, true, 'one skill in it has different text in different interfaces'); assert.ok(g.badges.includes('conflict'));
  assert.ok(m.nodes.length <= 30, `${m.nodes.length} nodes at the first view of the global harness`);
  assert.match(describeNode(g), /^Group, 44 skills\./);
  // The root still counts every skill, and the group is where the skills land.
  assert.match(node(m, scopeNodeId('global')).detail, /44 skills/);
  assert.equal(m.edges.filter(e => e.from === SKILLS && e.rel === 'lands-in').length, 3);
  // An agent's skills are one connection to the group, and it says how many.
  const uses = m.edges.filter(e => e.rel === 'uses');
  assert.ok(uses.length > 0 && uses.every(e => e.to === SKILLS), 'every uses connection goes to the group');
  const agent = world.items.find((i): i is AgentItem => i.kind === 'agent' && i.id === 'agent-03')!;
  assert.equal(m.edges.find(e => e.from === 'agent-03' && e.to === SKILLS)!.label, `uses ${agent.definition.skillIds.length} skills`);
  assert.equal(new Set(uses.map(e => e.id)).size, uses.length, 'one connection for each agent');
});

test('the group opens when its id is in expandedGroups: every skill is drawn on its own, the group stays and says it is open', () => {
  const m = buildHarnessMap(world, folded('global', { expandedGroups: [SKILLS] }));
  assert.equal(m.nodes.filter(n => n.kind === 'skill').length, 44);
  const g = node(m, SKILLS);
  assert.equal(g.expanded, true); assert.match(g.detail, /one by one/);
  assert.equal(m.edges.filter(e => e.rel === 'uses').every(e => e.to !== SKILLS), true, 'the agents are wired to the skills again');
  assert.deepEqual(actionsFor(g).map(a => a.label), ['Open details', 'Show as one group']);
  assert.equal(actionsFor(node(buildHarnessMap(world, folded('global')), SKILLS))[1]!.label, 'Show all 44 skills');
  assert.equal(actionsFor(node(buildHarnessMap(world, folded('global')), LIBRARY))[1]!.label, 'Show all 120 items', 'a library still says items');
});

test('a scope with 12 skills or fewer, or a filter that leaves few, draws each skill; a skill that an override hides or replaces is never folded', () => {
  const own = (id: string) => buildHarnessMap(world, folded(id, { showInherited: false })).nodes;
  assert.equal(own('scope-reedmarsh').filter(n => n.kind === 'skill').length, 3);
  assert.equal(own('scope-reedmarsh').some(n => n.kind === 'group' && n.memberKind === 'skill'), false);
  // In a project, the global skills are one inherited group, and the hidden skill is drawn beside it in its ghost state.
  const m = buildHarnessMap(world, folded(CASE_IDS.hidingScope));
  const g = node(m, SKILLS);
  assert.equal(g.inherited, true); assert.equal(g.fromScope, 'Studio'); assert.match(g.detail, /Inherited from Studio/);
  const ghost = node(m, CASE_IDS.hiddenSkill);
  assert.equal(ghost.hidden, true); assert.ok(g.memberCount! < 44, 'the hidden skill is not in the group');
  assert.equal(g.memberCount! + m.nodes.filter(n => n.kind === 'skill' && n.inherited).length, 44);
  // A filter that keeps few skills folds nothing.
  const few = buildHarnessMap(world, folded('global', { interfaceFilter: 'opencode' }));
  assert.equal(few.nodes.some(n => n.id === SKILLS), few.nodes.filter(n => n.kind === 'skill').length === 0);
});

test('a small canvas folds more: tools, slices and a long list of agents; the group carries the flags of what it holds', () => {
  const m = buildHarnessMap(world, folded('global', { groupLimits: COMPACT_GROUP_LIMITS }));
  const tools = node(m, ownGroupId('tool', 'global')), slices = node(m, ownGroupId('context-slice', 'global')), agents = node(m, ownGroupId('agent', 'global'));
  assert.equal(tools.label, '8 tools'); assert.equal(slices.label, '3 slices'); assert.equal(agents.label, '8 agents');
  assert.equal(tools.runsCode, true); assert.ok(tools.badges.includes('runs code')); assert.equal(tools.secretMissing, true); assert.ok(tools.badges.includes('secret missing'));
  assert.equal(m.nodes.filter(n => n.kind === 'agent' || n.kind === 'tool' || n.kind === 'context-slice' || n.kind === 'skill').length, 0);
  assert.ok(m.nodes.length <= 10, `${m.nodes.length} nodes in a small canvas`);
  assert.ok(m.edges.some(e => e.from === agents.id && e.to === SKILLS && e.rel === 'uses'), 'the agents group is wired to the skills group');
  assert.ok(m.edges.some(e => e.from === agents.id && e.to === tools.id && e.rel === 'has-tool'));
  assert.ok(m.edges.some(e => e.from === agents.id && e.to === slices.id && e.rel === 'reads'));
  assert.ok(m.edges.some(e => e.from === agents.id && e.rel === 'lands-in'));
  // Open the agents group and the agents come back with their own connections.
  const open = buildHarnessMap(world, folded('global', { groupLimits: COMPACT_GROUP_LIMITS, expandedGroups: [agents.id] }));
  assert.equal(open.nodes.filter(n => n.kind === 'agent').length, 8);
  assert.equal(open.edges.filter(e => e.from === agents.id).length, 0);
});

test('NO_OWN_GROUPS draws every item on its own, as the Skills and Agents screens need', () => {
  const m = buildHarnessMap(world, folded('global', { groupLimits: NO_OWN_GROUPS }));
  assert.equal(m.nodes.filter(n => n.kind === 'skill').length, 44);
  assert.equal(m.nodes.some(n => ownGroupParts(n.id) !== null), false);
});

test('an own group has a plain id that says its kind and its scope', () => {
  assert.equal(ownGroupId('skill', 'global'), 'group:skills:global');
  assert.deepEqual(ownGroupParts('group:skills:global'), { kind: 'skill', scopeId: 'global' });
  assert.deepEqual(ownGroupParts('group:agents:scope-copperfen'), { kind: 'agent', scopeId: 'scope-copperfen' });
  assert.deepEqual(ownGroupParts('group:context-slice:x'), null);
  assert.equal(ownGroupParts(LIBRARY), null); assert.equal(ownGroupParts('skill-010'), null);
});
