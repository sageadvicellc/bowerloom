// Fix pass A1: the plan reads an agent's skills and tools the way the graph does, undo stops at a version, an override must make sense,
// a path segment named like an object property is not a folder, and the small shared helpers exist once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planProjection } from '../shared/proto/plan.js';
import { createStore, isDirty } from '../shared/proto/store.js';
import { buildScan } from '../shared/proto/scan-places.js';
import { NO_OWN_GROUPS, buildHarnessMap } from '../shared/proto/harnessmodel.js';
import { effectiveResolver } from '../shared/proto/common.js';
import { generateWorld } from '../shared/proto/sample.js';
import { INTERFACE_WORDS, interfaceName, joinWords } from '../shared/proto/words.js';
import { INTERFACE_WORDS as REVIEW_WORDS } from '../shared/proto/scan-review.js';
import { buildIndex } from '../shared/proto/skills-logic.js';
import * as skillsLogic from '../shared/proto/skills-logic.js';
import { attachableSlices } from '../shared/proto/agents-logic.js';
import type { AgentItem, ContextSliceItem, HarnessItem, World } from '../shared/proto/types.js';
import { DESKTOP } from './support.js';
import { found, makeWorld, mcp, skill } from './proto-testworld.js';

const PROJ = '/sample/projects/one';
const projectAgent = (changes: readonly { path: string; preview: string }[]): string => changes.find(c => c.path === `${PROJ}/.claude/agents/Planner.md`)?.preview ?? '(no file)';
const withTools = (w: World): World => ({ ...w, items: w.items.map(i => (i.id === 'a1' ? { ...(i as AgentItem), definition: { ...(i as AgentItem).definition, toolAttachments: [{ toolId: 't1', access: 'read-only' as const }] } } : i)) });

// ---- 1. the plan follows hide and replace for an inherited agent

test('a skill hidden in a project is not listed by the project copy of an inherited agent', () => {
  const w = withTools(makeWorld()), store = createStore(w);
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 's1', mode: 'hide' });
  const { changes } = planProjection(w, store.getState().draft);
  assert.match(projectAgent(changes), /Skills: none/);
  assert.doesNotMatch(projectAgent(changes), /Review/);
  const global = changes.find(c => c.path === '/sample/harness/.claude/agents/Planner.md');
  assert.equal(global, undefined, 'the global agent file does not change');
});

test('a skill replaced in a project is listed under the name of its replacement', () => {
  const w = makeWorld(), store = createStore(w);
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 's1', mode: 'replace', replacementItemId: 's3' });
  const text = projectAgent(planProjection(w, store.getState().draft).changes);
  assert.match(text, /Skills: Local$/m);
});

test('a tool replaced in a project is listed under the name of its replacement, with the same access', () => {
  const w0 = withTools(makeWorld()), w: World = { ...w0, items: [...w0.items, mcp('t9', 'Search two', 'OTHER_TOKEN', 'proj')] }, store = createStore(w);
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 't1', mode: 'replace', replacementItemId: 't9' });
  assert.match(projectAgent(planProjection(w, store.getState().draft).changes), /Tools: Search two \(read-only\)/);
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 't1', mode: 'hide' });
  assert.match(projectAgent(planProjection(w, store.getState().draft).changes), /Tools: none/);
});

test('the plan and the graph agree on which skills an inherited agent uses (sample world, Tallowbrook)', () => {
  const world = generateWorld(1), scope = 'scope-tallowbrook';
  const owner = world.items.find((i): i is AgentItem => i.kind === 'agent' && i.library === null && i.scopeId === 'global' && i.definition.skillIds.some(id => world.items.find(s => s.id === id)?.library === null))!;
  const skillId = owner.definition.skillIds.find(id => world.items.find(s => s.id === id)?.library === null)!;
  const name = world.items.find(i => i.id === skillId)!.name;
  const store = createStore(world);
  store.dispatch({ type: 'setOverride', scopeId: scope, itemId: skillId, mode: 'hide' });
  const draft = store.getState().draft, path = world.scopes.find(s => s.id === scope)!.path;
  const mine = planProjection(world, draft).changes.filter(c => c.path.startsWith(`${path}/`) && c.path.includes('/agents/') && c.preview.startsWith(`Agent: ${owner.name}\n`));
  assert.ok(mine.length > 0, 'the project copy of the agent is changed');
  for (const c of mine) assert.ok(!c.preview.includes(`Skills: ${name}`) && !new RegExp(`Skills: .*\\b${name}\\b`).test(c.preview), c.path);
  const map = buildHarnessMap(draft, { scopeId: scope, showInherited: true, expandedGroups: [], groupLimits: NO_OWN_GROUPS });
  assert.equal(map.edges.some(e => e.rel === 'uses' && e.from === owner.id && e.to === skillId), false, 'the graph has no uses edge to the hidden skill');
  assert.equal(effectiveResolver(draft, scope)(skillId), undefined);
});

// ---- 2. undo does not walk past a version

test('apply and restore clear both stacks, so undo never crosses a version', () => {
  const store = createStore(makeWorld()), overrides = () => store.getState().draft.overrides.length;
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 's1', mode: 'hide' });
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 's2', mode: 'hide' });
  store.dispatch({ type: 'apply', label: 'two' });
  assert.equal(store.getState().undoStack.length, 0); assert.equal(store.getState().redoStack.length, 0);
  store.dispatch({ type: 'attachSkill', agentId: 'a2', skillId: 's2' });
  store.dispatch({ type: 'undo' }); store.dispatch({ type: 'undo' });
  assert.equal(overrides(), store.getState().committed.overrides.length, 'draft overrides equal committed');
  assert.equal(isDirty(store.getState()), false);
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 's1', mode: 'inherit' });
  const first = store.getState().committed.versions[0]!.id;
  store.dispatch({ type: 'restore', versionId: first });
  assert.equal(store.getState().undoStack.length, 0); assert.equal(store.getState().redoStack.length, 0);
  store.dispatch({ type: 'undo' });
  assert.equal(isDirty(store.getState()), false);
});

// ---- 3. an override must make sense

test('setOverride refuses an item the project does not inherit, and a replacement of another kind; the draft stays the same', () => {
  const w0 = makeWorld(), w: World = {
    ...w0, scopes: [...w0.scopes, { id: 'proj2', kind: 'project', name: 'Project two', parentId: 'global', path: '/sample/projects/two' }],
    items: [...w0.items, skill('s4', 'Sibling only', 'proj2')],
  };
  const store = createStore(w), before = store.getState().draft;
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 's4', mode: 'hide' });
  assert.equal(store.getState().draft, before, 'a sibling project item is not inherited, so no override');
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 's1', mode: 'replace', replacementItemId: 'a1' });
  assert.equal(store.getState().draft, before, 'a skill cannot be replaced by an agent');
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 't1', mode: 'replace', replacementItemId: 't2' });
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 't1', mode: 'replace', replacementItemId: 's1' });
  assert.equal(store.getState().draft.overrides.length, 1, 'a tool may be replaced by a tool of another tool kind, not by a skill');
  assert.equal(store.getState().undoStack.length, 1);
});

// ---- 4. object property names are not folders

test('a path with the segments "constructor" and "toString" is not a settings folder', () => {
  const w = makeWorld(), item = skill('sx', 'Odd path', 'global') as HarnessItem;
  const odd: World = { ...w, items: [{ ...item, foundAt: [found('claude-code', '/Users/me/constructor/toString/SKILL.md', 'text')] }] };
  const places = buildScan(odd);
  assert.equal(places.length, 1);
  assert.equal(places[0]!.path, '/Users/me/constructor/toString/.claude');
  assert.equal(places[0]!.group, 'claude-code');
  assert.match(places[0]!.label, /: \.claude$/);
});

// ---- 5. shared helpers

test('the interface names and the word joiner exist once and give the same words everywhere', () => {
  assert.equal(REVIEW_WORDS, INTERFACE_WORDS);
  assert.equal(interfaceName('opencode'), 'OpenCode');
  assert.equal(joinWords(['a']), 'a'); assert.equal(joinWords(['a', 'b']), 'a and b'); assert.equal(joinWords(['a', 'b', 'c']), 'a, b and c'); assert.equal(joinWords(['a', 'b', 'c'], 'or'), 'a, b or c');
  const dir = join(DESKTOP, 'shared', 'proto');
  for (const file of ['harnessmodel.ts', 'scan-review.ts', 'slice-preview.ts', 'sample.ts']) assert.doesNotMatch(readFileSync(join(dir, file), 'utf8'), /'Claude Code'/, file);
  for (const file of ['editor-describe.ts', 'editor-actions.ts', 'library-install.ts', 'slicerule.ts']) assert.doesNotMatch(readFileSync(join(dir, file), 'utf8'), /^const join(And|Words) = /m, file);
});

test('the use index is built by a plain function with a plain name, and the old alias is gone', () => {
  const w = makeWorld();
  assert.deepEqual([...buildIndex(w).get('s1') ?? []].sort(), ['global', 'proj']);
  assert.equal('useIndex' in skillsLogic, false);
});

test('slices with equal names keep the order of the world', () => {
  const w = makeWorld(), planner = w.items.find(i => i.id === 'a1') as AgentItem;
  const slice = (n: number): ContextSliceItem => ({ id: `si${n}`, kind: 'context-slice', name: 'Same name', scopeId: 'global', foundAt: [], library: null, sliceId: `sl${n}` });
  const world: World = { ...w, items: [...w.items, slice(1), slice(2), slice(3)] };
  assert.deepEqual(attachableSlices(world, planner).map(s => s.id), ['si1', 'si2', 'si3']);
  const rev: World = { ...w, items: [...w.items, slice(3), slice(2), slice(1)] };
  assert.deepEqual(attachableSlices(rev, planner).map(s => s.id), ['si3', 'si2', 'si1']);
});

test('the sample world holds no override that the store never makes', () => {
  assert.equal(generateWorld(1).overrides.some(o => o.mode === 'inherit'), false);
});
