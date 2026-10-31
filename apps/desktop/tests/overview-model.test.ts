// The model of the Overview (Task 2 lane G): `overviewOf` on the made-up multi-place sample and on small states made here. Nothing is read from disk.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { FolderInfo } from '../shared/engine/types.js';
import { overviewOf } from '../shared/harness/overview.js';
import { createSampleOverviewState, createSampleWorld } from '../shared/harness/sample.js';
import type { HarnessState, Part, PartKind, ScanSource } from '../shared/harness/types.js';

const folder = (id: string, label: string, hasDefinition: boolean): FolderInfo => ({ id, label, name: label, hasDefinition, engines: [], previewEngines: false, installedEngines: [], problem: null, projected: false, unfinished: { projection: false, adoption: false } });

const part = (id: string, kind: PartKind, name: string, extra: Partial<Part> = {}): Part =>
  ({ id, kind, name, summary: `${name}.`, description: '', path: '', source: '', origin: '', fileText: '', cannotUse: [], inLibrary: true, ...extra });
const source = (id: string, parts: readonly Part[], extra: Partial<ScanSource> = {}): ScanSource =>
  ({ id, name: id, interfaceName: 'Claude Code', harnessName: id, partIds: parts.map(p => p.id), ...extra });
/** A state with only what the Overview reads. */
function stateOf(sources: readonly ScanSource[], parts: readonly Part[]): HarnessState {
  return { ...createSampleWorld(), parts, sources, chosenSourceIds: sources.map(s => s.id) };
}

test('groups come in a fixed order: the home sources in scan order, then projects by size (largest first), then name', () => {
  const o = overviewOf(createSampleOverviewState(), []);
  assert.deepEqual(o.groups.map(g => g.id), ['src-caveman', 'src-claude', 'src-codex', 'src-alpha', 'src-beta', 'src-gamma']);
  assert.deepEqual(o.groups.map(g => g.scope), ['home', 'home', 'home', 'project', 'project', 'project']);
  // Equal sizes fall to the name, then the id; the order does not depend on the order of the sources.
  const parts = [part('a', 'skill', 'A'), part('b', 'skill', 'B'), part('c', 'skill', 'C'), part('d', 'skill', 'D')];
  const sources = [source('s-zed', [parts[0]!], { name: 'Zed', scope: 'project' }), source('s-big', [parts[1]!, parts[2]!, parts[3]!], { name: 'Mid', scope: 'project' }), source('s-ant', [parts[0]!], { name: 'ant', scope: 'project' }), source('s-home', [], { scope: 'home' })];
  assert.deepEqual(overviewOf(stateOf(sources, parts), []).groups.map(g => g.id), ['s-home', 's-big', 's-ant', 's-zed']);
  assert.deepEqual(overviewOf(stateOf([...sources].reverse(), parts), []).groups.map(g => g.id), ['s-home', 's-big', 's-ant', 's-zed']);
});

test('a node is <group id>/<part id>; the nodes of a group go agents, skills, tools, notes, each by name then id; counts equal the nodes', () => {
  const o = overviewOf(createSampleOverviewState(), []);
  for (const g of o.groups) {
    const kinds = g.nodes.map(n => n.kind), order = ['agent', 'skill', 'tool', 'context'];
    assert.deepEqual(kinds, [...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b)), g.id);
    for (const n of g.nodes) assert.equal(n.id, `${g.id}/${n.partId}`);
    for (const kind of order) assert.equal(g.counts[kind as PartKind], g.nodes.filter(n => n.kind === kind).length, `${g.id} ${kind}`);
    const names = (kind: string): string[] => g.nodes.filter(n => n.kind === kind).map(n => n.name.toLowerCase());
    for (const kind of order) assert.deepEqual(names(kind), [...names(kind)].sort(), `${g.id} ${kind} by name`);
  }
  const alpha = o.groups.find(g => g.id === 'src-alpha')!;
  assert.deepEqual(alpha.counts, { agent: 2, skill: 2, tool: 2, context: 1 });
  assert.equal(new Set(o.groups.flatMap(g => g.nodes.map(n => n.id))).size, o.groups.reduce((n, g) => n + g.nodes.length, 0), 'ids are unique across the whole Overview');
  // The total equals the parts that sources hold.
  assert.equal(o.groups.reduce((n, g) => n + g.nodes.length, 0), createSampleOverviewState().sources.reduce((n, s) => n + s.partIds.length, 0));
});

test('tool kinds and the hook mark: only a tool has a kind, and only a hook runs code', () => {
  const o = overviewOf(createSampleOverviewState(), []);
  const alpha = o.groups.find(g => g.id === 'src-alpha')!;
  const hook = alpha.nodes.find(n => n.name === 'Format on save')!, mcp = alpha.nodes.find(n => n.name === 'Tracker')!;
  assert.equal(hook.toolKind, 'hook'); assert.equal(hook.runsCode, true);
  assert.equal(mcp.toolKind, 'mcp'); assert.equal(Object.hasOwn(mcp, 'runsCode'), false);
  assert.equal(o.groups.find(g => g.id === 'src-beta')!.nodes.find(n => n.kind === 'tool')!.toolKind, 'prompt');
  for (const n of o.groups.flatMap(g => g.nodes)) if (n.kind !== 'tool') { assert.equal(Object.hasOwn(n, 'toolKind'), false, n.id); assert.equal(Object.hasOwn(n, 'runsCode'), false, n.id); }
  // A tool with no kind (the plain sample) has none here either.
  const plain = overviewOf(createSampleWorld(), []).groups.flatMap(g => g.nodes).filter(n => n.kind === 'tool');
  assert.ok(plain.length > 0); assert.ok(plain.every(n => !Object.hasOwn(n, 'toolKind') && !Object.hasOwn(n, 'runsCode')));
});

test('edges stay inside a group, run from an agent, and are not repeated', () => {
  const o = overviewOf(createSampleOverviewState(), []);
  assert.ok(o.groups.some(g => g.edges.length > 0));
  for (const g of o.groups) {
    const ids = new Map(g.nodes.map(n => [n.id, n] as const));
    assert.equal(new Set(g.edges.map(e => e.id)).size, g.edges.length);
    for (const e of g.edges) { assert.equal(e.id, `${e.from}>${e.to}`); assert.equal(ids.get(e.from)?.kind, 'agent', e.id); assert.ok(ids.has(e.to), e.id); }
  }
  const alpha = o.groups.find(g => g.id === 'src-alpha')!;
  assert.equal(alpha.edges.length, 5);
  // A link to a part of another group, an unknown part, itself, a repeat, or from a skill is dropped.
  const a = part('a', 'agent', 'A'), s = part('s', 'skill', 'S'), t = part('t', 'skill', 'T');
  const bad = overviewOf(stateOf([
    source('one', [a, s], { links: [{ from: 'a', to: 's' }, { from: 'a', to: 's' }, { from: 'a', to: 't' }, { from: 'a', to: 'ghost' }, { from: 'a', to: 'a' }, { from: 's', to: 'a' }] }),
    source('two', [t]),
  ], [a, s, t]), []);
  assert.deepEqual(bad.groups.find(g => g.id === 'one')!.edges, [{ id: 'one/a>one/s', from: 'one/a', to: 'one/s' }]);
  assert.deepEqual(bad.groups.find(g => g.id === 'two')!.edges, []);
});

test('a skill with the same text in two or more places is shared: the other places are listed, in group order, and the table keeps the node ids', () => {
  const o = overviewOf(createSampleOverviewState(), []);
  assert.equal(o.sharedKeys.size, 1);
  const [hash, nodes] = [...o.sharedKeys][0]!;
  assert.match(hash, /^[0-9a-f]{16}$/);
  assert.deepEqual(nodes, ['src-claude/skill-check-facts', 'src-alpha/alpha-skill-check-facts', 'src-beta/beta-skill-check-facts']);
  const sharedWith = (group: string, id: string): readonly string[] => o.groups.find(g => g.id === group)!.nodes.find(n => n.partId === id)!.sharedWith;
  assert.deepEqual(sharedWith('src-claude', 'skill-check-facts'), ['src-alpha', 'src-beta']);
  assert.deepEqual(sharedWith('src-alpha', 'alpha-skill-check-facts'), ['src-claude', 'src-beta']);
  assert.deepEqual(sharedWith('src-beta', 'beta-skill-check-facts'), ['src-claude', 'src-alpha']);
  assert.equal(o.groups.flatMap(g => g.nodes).filter(n => n.sharedWith.length > 0).length, 3, 'no other node is marked');
  // The count of places is the "also in N" number.
  assert.equal(sharedWith('src-claude', 'skill-check-facts').length, 2);
});

test('sharing needs a hash in two different groups: no hash, an empty hash, a different kind, or two copies in one group are not shared', () => {
  const x1 = part('x1', 'skill', 'X', { contentHash: 'h1' }), x2 = part('x2', 'skill', 'X again', { contentHash: 'h1' });
  const none1 = part('n1', 'skill', 'N'), none2 = part('n2', 'skill', 'N');
  const empty1 = part('e1', 'skill', 'E', { contentHash: '' }), empty2 = part('e2', 'skill', 'E', { contentHash: '' });
  const agent1 = part('g1', 'agent', 'G', { contentHash: 'h2' }), agent2 = part('g2', 'agent', 'G', { contentHash: 'h2' });
  const all = [x1, x2, none1, none2, empty1, empty2, agent1, agent2];
  const o = overviewOf(stateOf([source('one', [x1, x2, none1, empty1, agent1]), source('two', [none2, empty2, agent2])], all), []);
  assert.equal(o.sharedKeys.size, 0);
  assert.ok(o.groups.every(g => g.nodes.every(n => n.sharedWith.length === 0)));
  // A third group with the hash makes all three copies shared, and the two in the first group both list the others once.
  const y = part('y', 'skill', 'Y', { contentHash: 'h1' });
  const three = overviewOf(stateOf([source('one', [x1, x2]), source('two', [y])], [x1, x2, y]), []);
  assert.deepEqual(three.sharedKeys.get('h1'), ['one/x1', 'one/x2', 'two/y']);
  assert.deepEqual(three.groups[0]!.nodes.map(n => n.sharedWith), [['two'], ['two']]);
  assert.deepEqual(three.groups[1]!.nodes[0]!.sharedWith, ['one']);
});

test('a group with no parts is still a group; a scan with no sources has no groups; an unknown or repeated part id is skipped', () => {
  const lone = overviewOf(stateOf([source('empty', [], { scope: 'home', label: '~' })], []), []);
  assert.equal(lone.groups.length, 1);
  assert.deepEqual(lone.groups[0]!.counts, { agent: 0, skill: 0, tool: 0, context: 0 });
  assert.deepEqual(lone.groups[0]!.nodes, []); assert.deepEqual(lone.groups[0]!.edges, []);
  assert.deepEqual(overviewOf(stateOf([], []), []).groups, []);
  assert.equal(overviewOf(stateOf([], []), []).sharedKeys.size, 0);
  const p = part('p', 'skill', 'P');
  const odd = overviewOf(stateOf([{ ...source('s', [p]), partIds: ['p', 'p', 'ghost'] }], [p, p]), []);
  assert.deepEqual(odd.groups[0]!.nodes.map(n => n.id), ['s/p']);
});

test('a source made before the Overview has no scope or label: it reads as a project named by its name', () => {
  const p = part('p', 'skill', 'P');
  const g = overviewOf(stateOf([source('plain', [p], { name: 'Plain' })], [p]), []).groups[0]!;
  assert.equal(g.scope, 'project'); assert.equal(g.label, 'Plain'); assert.deepEqual(g.programs, ['Claude Code']);
  const sample = overviewOf(createSampleWorld(), []);
  assert.deepEqual(sample.groups.map(g => [g.name, g.scope, g.label]), [['Caveman (plug-in)', 'home', '~'], ['Your Claude Code folder', 'home', '~'], ['Your Codex folder', 'home', '~']]);
  assert.deepEqual(sample.groups.map(g => g.programs), [['Claude Code'], ['Claude Code'], ['Codex']]);
  // A notes source is not a program.
  assert.deepEqual(overviewOf(createSampleOverviewState(), []).groups.find(g => g.id === 'src-gamma')!.programs, []);
});

test('"In Bowerloom" is a folder main knows with the same ~ label and a harness; the id comes with it', () => {
  const state = createSampleOverviewState();
  const folders = [folder('f-b', '~/Projects/beta', true), folder('f-a', '~/Projects/alpha', true), folder('f-g', '~/Projects/gamma', false), folder('f-x', '~/Elsewhere', true)];
  const o = overviewOf(state, folders);
  const by = (id: string) => o.groups.find(g => g.id === id)!;
  assert.deepEqual([by('src-alpha').inBowerloom, by('src-alpha').folderId], [true, 'f-a']);
  assert.deepEqual([by('src-beta').inBowerloom, by('src-beta').folderId], [true, 'f-b']);
  assert.deepEqual([by('src-gamma').inBowerloom, by('src-gamma').folderId], [false, null], 'a folder with no harness is not in Bowerloom');
  assert.deepEqual([by('src-claude').inBowerloom, by('src-claude').folderId], [false, null]);
  // The home folder matches the folder labelled ~. Two folders with one label: the smaller id.
  const home = overviewOf(state, [folder('f-z', '~', true), folder('f-h', '~', true)]);
  assert.ok(home.groups.filter(g => g.scope === 'home').every(g => g.folderId === 'f-h'));
  assert.ok(overviewOf(state, []).groups.every(g => !g.inBowerloom && g.folderId === null));
});

test('names, summaries and labels are one plain line, and a full path never reaches the model', () => {
  const nasty = part('n', 'skill', 'Bad\u202e name\u0007 \n here', { summary: 'Line one\nline\u200b two\t' });
  const o = overviewOf(stateOf([
    source('s1', [nasty], { name: 'Odd\u0000 place\u202e', label: '/Users/someone/Projects/alpha', scope: 'project' }),
    source('s2', [], { label: 'C:\\Users\\someone\\Projects\\beta', scope: 'project' }),
    source('s3', [], { label: '/', scope: 'project' }),
  ], [nasty]), []);
  const text = JSON.stringify(o);
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(text, /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e]/);
  assert.equal(o.groups.find(g => g.id === 's1')!.nodes[0]!.name, 'Bad name here');
  assert.equal(o.groups.find(g => g.id === 's1')!.nodes[0]!.summary, 'Line one line two');
  assert.equal(o.groups.find(g => g.id === 's1')!.name, 'Odd place');
  assert.equal(o.groups.find(g => g.id === 's1')!.label, '…/alpha');
  assert.equal(o.groups.find(g => g.id === 's2')!.label, '…/beta');
  assert.equal(o.groups.find(g => g.id === 's3')!.label, '…');
  assert.doesNotMatch(text, /Users|someone/);
});

test('the Overview is deterministic, and the order of the parts and links in the state does not change it', () => {
  const state = createSampleOverviewState();
  const again = overviewOf(state, []);
  assert.deepEqual(overviewOf(state, []), again);
  const shuffled: HarnessState = {
    ...state, parts: [...state.parts].reverse(),
    sources: state.sources.map(s => ({ ...s, partIds: [...s.partIds].reverse(), ...(s.links === undefined ? {} : { links: [...s.links].reverse() }) })),
  };
  assert.deepEqual(overviewOf(shuffled, []), again);
});

test('the model does not change the state it reads', () => {
  const state = createSampleOverviewState();
  const before = JSON.stringify(state);
  overviewOf(state, [folder('f', '~/Projects/alpha', true)]);
  assert.equal(JSON.stringify(state), before);
});
