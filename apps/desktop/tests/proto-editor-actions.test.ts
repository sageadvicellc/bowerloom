// The harness editor's rules: canvas events to store actions, and every refusal with its reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GROUP_REFUSAL, HOOK_REFUSAL, attachToolOutcome, canEditInPlace, conflictCopies, connectOutcome, copyOutcome, defaultCopyNames, dropOutcome, editRefusal,
  keepBothOutcome, keepBothProblem, keepOneOutcome, menuOutcome, overrideOutcome, reachesScope, replacementChoices,
} from '../shared/proto/editor-actions.js';
import type { EditorContext, EditorOutcome } from '../shared/proto/editor-actions.js';
import { ACCESS_WORDS, buildHarnessMap, groupIdOf, interfaceNodeId, scopeNodeId } from '../shared/proto/harnessmodel.js';
import { CASE_IDS, generateWorld } from '../shared/proto/sample.js';
import { createStore, isDirty } from '../shared/proto/store.js';
import type { AgentItem, World } from '../shared/proto/types.js';
import { DESKTOP } from './support.js';
import { makeWorld, skill } from './proto-testworld.js';

const world = generateWorld(1);
const LIB = groupIdOf(CASE_IDS.newerLibrary);
const ctxOf = (scopeId: string, expanded: string[] = [], w: World = world, showInherited = true): EditorContext => ({ world: w, model: buildHarnessMap(w, { scopeId, showInherited, expandedGroups: expanded }) });
const agentOf = (id: string): AgentItem => world.items.find((i): i is AgentItem => i.kind === 'agent' && i.id === id)!;
function refused(o: EditorOutcome): string { assert.equal(o.kind, 'refused', JSON.stringify(o)); return o.kind === 'refused' ? o.message : ''; }

// agent-01 is an owned global agent. Find a global skill, a tool and a slice it does not have yet.
const a1 = agentOf('agent-01');
const freeSkill = world.items.find(i => i.kind === 'skill' && i.scopeId === 'global' && !a1.definition.skillIds.includes(i.id) && i.id !== CASE_IDS.hiddenSkill)!;
const freeTool = world.items.find(i => i.kind === 'tool' && i.toolKind === 'prompt' && i.scopeId === 'global' && !a1.definition.toolAttachments.some(t => t.toolId === i.id))!;
const freeSlice = world.items.find(i => i.kind === 'context-slice' && i.sliceId !== a1.definition.sliceId)!;

test('a wire from a skill to an agent attaches the skill, in either direction', () => {
  const ctx = ctxOf('global');
  for (const [from, to] of [[freeSkill.id, a1.id], [a1.id, freeSkill.id]] as const) {
    const o = connectOutcome(ctx, from, to);
    assert.equal(o.kind, 'action');
    if (o.kind === 'action') { assert.deepEqual(o.action, { type: 'attachSkill', agentId: a1.id, skillId: freeSkill.id }); assert.match(o.message, new RegExp(`${a1.name} now uses the skill ${freeSkill.name}`)); }
  }
});

test('a wire from a skill the agent already uses changes nothing and says so', () => {
  const used = a1.definition.skillIds[0]!;
  assert.match(refused(connectOutcome(ctxOf('global'), used, a1.id)), /already uses the skill/);
});

test('a wire from a tool to an agent asks for the access class first, and remembers the class it has now', () => {
  const ctx = ctxOf('global');
  const o = connectOutcome(ctx, freeTool.id, a1.id);
  assert.deepEqual(o, { kind: 'choose-access', agentId: a1.id, toolId: freeTool.id, agentName: a1.name, toolName: freeTool.name, current: null });
  const attached = a1.definition.toolAttachments[0]!;
  const again = connectOutcome(ctx, a1.id, attached.toolId);
  assert.equal(again.kind, 'choose-access'); if (again.kind === 'choose-access') assert.equal(again.current, attached.access);
  // Picking the class makes the action, in the placeholder words.
  const done = attachToolOutcome(a1.id, freeTool.id, 'read-write', ACCESS_WORDS, a1.name, freeTool.name);
  assert.equal(done.kind, 'action');
  if (done.kind === 'action') { assert.deepEqual(done.action, { type: 'attachTool', agentId: a1.id, toolId: freeTool.id, access: 'read-write' }); assert.ok(done.message.includes(ACCESS_WORDS['read-write'])); }
});

test('a wire from an agent to a slice assigns the slice; the same slice twice changes nothing', () => {
  const ctx = ctxOf('global');
  const o = connectOutcome(ctx, a1.id, freeSlice.id);
  assert.equal(o.kind, 'action');
  if (o.kind === 'action' && freeSlice.kind === 'context-slice') assert.deepEqual(o.action, { type: 'assignSlice', agentId: a1.id, sliceId: freeSlice.sliceId });
  const has = world.items.find((i): i is AgentItem => i.kind === 'agent' && i.library === null && i.definition.sliceId !== undefined)!;
  const sliceItem = world.items.find(i => i.kind === 'context-slice' && i.sliceId === has.definition.sliceId)!;
  assert.match(refused(connectOutcome(ctx, has.id, sliceItem.id)), /already reads the slice/);
});

test('a hook cannot be wired, copied, replaced or dropped: the refusal names hooks', () => {
  const ctx = ctxOf('global'), hookId = CASE_IDS.hook;
  assert.equal(refused(connectOutcome(ctx, hookId, a1.id)), HOOK_REFUSAL);
  assert.equal(refused(connectOutcome(ctx, a1.id, hookId)), HOOK_REFUSAL);
  assert.equal(refused(dropOutcome(ctx, hookId, scopeNodeId('global'))), HOOK_REFUSAL);
  assert.equal(refused(copyOutcome(ctx, hookId)), HOOK_REFUSAL);
  assert.equal(editRefusal(ctx, hookId), HOOK_REFUSAL);
  assert.equal(canEditInPlace(ctx, hookId), false);
  assert.equal(refused(overrideOutcome(ctxOf('scope-copperfen'), hookId, 'replace')), HOOK_REFUSAL);
  assert.match(HOOK_REFUSAL, /never creates/);
});

test('a library item cannot be edited in place: the reason says read only and how to make a copy', () => {
  const ctx = ctxOf('global', [LIB]), lib = ctx.world.items.find(i => i.library !== null && i.kind === 'agent')!;
  assert.ok(ctx.model.nodes.some(n => n.id === lib.id), 'the library is open');
  const why = refused(connectOutcome(ctx, freeSkill.id, lib.id));
  assert.match(why, /read only/); assert.match(why, /editable copy/); assert.match(why, /Evergreen Kit/);
  assert.equal(editRefusal(ctx, lib.id), why); assert.equal(canEditInPlace(ctx, lib.id), false);
  assert.equal(canEditInPlace(ctx, a1.id), true);
  // The library item can still be a partner of an owned agent: using a library skill is not editing it.
  const o = copyOutcome(ctx, lib.id);
  assert.equal(o.kind, 'action'); if (o.kind === 'action') { assert.deepEqual(o.action, { type: 'installItem', itemId: lib.id, targetScopeId: 'global' }); assert.match(o.message, /editable copy/); }
});

test('a closed library group is not wired; it asks to be opened', () => {
  assert.equal(refused(connectOutcome(ctxOf('global'), LIB, a1.id)), GROUP_REFUSAL);
  assert.equal(refused(dropOutcome(ctxOf('global'), LIB, scopeNodeId('global'))), GROUP_REFUSAL);
});

test('a wire between kinds that do not connect does nothing and says why in plain words', () => {
  const ctx = ctxOf('global'), skills = world.items.filter(i => i.kind === 'skill' && i.scopeId === 'global');
  const m1 = refused(connectOutcome(ctx, skills[0]!.id, skills[1]!.id));
  assert.match(m1, /^A skill and a skill do not connect\./); assert.match(m1, /joins a skill to an agent/);
  assert.match(refused(connectOutcome(ctx, a1.id, 'agent-02')), /^An agent and an agent do not connect/);
  assert.match(refused(connectOutcome(ctx, skills[0]!.id, freeTool.id)), /^A skill and a tool do not connect/);
  assert.match(refused(connectOutcome(ctx, skills[0]!.id, interfaceNodeId('codex'))), /^A skill and an interface do not connect/);
  assert.match(refused(connectOutcome(ctx, scopeNodeId('global'), a1.id)), /^A harness and an agent do not connect/);
  assert.match(refused(connectOutcome(ctx, a1.id, a1.id)), /two different items/);
  assert.match(refused(connectOutcome(ctx, 'nope', a1.id)), /not on the page/);
});

test('an inherited agent is not changed from a project; a hidden skill is not wired either', () => {
  const copper = ctxOf('scope-copperfen');
  const why = refused(connectOutcome(copper, freeSkill.id, a1.id));
  assert.match(why, /inherited from Studio/); assert.match(why, /make a copy/);
  const reed = ctxOf(CASE_IDS.hidingScope), projectAgent = world.items.find((i): i is AgentItem => i.kind === 'agent' && i.scopeId === CASE_IDS.hidingScope)!;
  assert.match(refused(connectOutcome(reed, CASE_IDS.hiddenSkill, projectAgent.id)), /is hidden here/);
  // A project agent can use a global skill: the project reaches its parent.
  const ok = connectOutcome(reed, freeSkill.id, projectAgent.id);
  assert.equal(ok.kind, 'action');
});

test('an agent cannot use an item that lives in a scope it cannot reach', () => {
  assert.equal(reachesScope(world, 'scope-copperfen', 'global'), true);
  assert.equal(reachesScope(world, 'global', 'scope-copperfen'), false);
  assert.equal(reachesScope(world, 'scope-copperfen', 'scope-reedmarsh'), false);
  const w = makeWorld(), model = buildHarnessMap(w, { scopeId: 'proj', showInherited: true, expandedGroups: [] });
  // Pretend the global agent is on this page as the project's own, to test the reach rule alone.
  const ctx: EditorContext = { world: w, model: { ...model, nodes: model.nodes.map(n => (n.id === 'a1' ? { ...n, inherited: false } : n)) } };
  assert.match(refused(connectOutcome(ctx, 's3', 'a1')), /Local belongs to Project one, so Planner in Global cannot use it/);
  const w2 = { ...w, items: [...w.items, skill('s9', 'Extra')] };
  assert.equal(connectOutcome({ world: w2, model: buildHarnessMap(w2, { scopeId: 'global', showInherited: true, expandedGroups: [] }) }, 's9', 'a2').kind, 'action');
});

test('a drop on a harness installs a copy into that scope; a library item becomes a copy that can be edited', () => {
  const copper = ctxOf('scope-copperfen', [LIB]), target = scopeNodeId('scope-copperfen');
  const o = dropOutcome(copper, 'skill-010', target);
  assert.equal(o.kind, 'action');
  if (o.kind === 'action') { assert.deepEqual(o.action, { type: 'installItem', itemId: 'skill-010', targetScopeId: 'scope-copperfen' }); assert.match(o.message, /Copperfen/); }
  const lib = copper.world.items.find(i => i.library !== null && i.kind === 'agent')!;
  const l = dropOutcome(copper, lib.id, target);
  assert.equal(l.kind, 'action');
  if (l.kind === 'action') { assert.deepEqual(l.action, { type: 'installItem', itemId: lib.id, targetScopeId: 'scope-copperfen' }); assert.match(l.message, /that you can edit/); }
  const own = world.items.find(i => i.scopeId === 'scope-copperfen' && i.kind === 'skill')!;
  assert.match(refused(dropOutcome(copper, own.id, target)), /is already in Copperfen/);
  assert.match(refused(dropOutcome(copper, freeTool.id, target)), /Only skills and agents/);
  assert.match(refused(dropOutcome(copper, freeSlice.id, target)), /Only skills and agents/);
  assert.match(refused(dropOutcome(copper, 'skill-010', interfaceNodeId('codex'))), /nothing to drop on an interface/i);
  assert.match(refused(dropOutcome(copper, interfaceNodeId('codex'), target)), /cannot drop an interface on a harness/);
});

test('a drop on an agent behaves as a wire', () => {
  const ctx = ctxOf('global');
  const s = dropOutcome(ctx, freeSkill.id, a1.id); assert.equal(s.kind, 'action');
  assert.equal(dropOutcome(ctx, freeTool.id, a1.id).kind, 'choose-access');
  assert.match(refused(dropOutcome(ctx, freeSkill.id, freeTool.id)), /do not connect/);
  assert.match(refused(dropOutcome(ctx, a1.id, a1.id)), /different item/);
});

test('keep, hide and replace work in a project, on inherited items only', () => {
  const copper = ctxOf('scope-copperfen');
  const hide = overrideOutcome(copper, 'skill-010', 'hide');
  assert.equal(hide.kind, 'action'); if (hide.kind === 'action') assert.deepEqual(hide.action, { type: 'setOverride', scopeId: 'scope-copperfen', itemId: 'skill-010', mode: 'hide' });
  assert.deepEqual(menuOutcome(copper, 'skill-010', 'hide'), hide);
  assert.match(refused(overrideOutcome(copper, 'skill-010', 'inherit')), /already kept from Studio/);
  assert.equal(overrideOutcome(copper, 'skill-010', 'replace').kind, 'choose-replacement');
  assert.deepEqual(menuOutcome(copper, 'skill-010', 'replace'), overrideOutcome(copper, 'skill-010', 'replace'));
  const rep = overrideOutcome(copper, 'skill-010', 'replace', 'skill-011');
  assert.equal(rep.kind, 'action'); if (rep.kind === 'action') assert.deepEqual(rep.action, { type: 'setOverride', scopeId: 'scope-copperfen', itemId: 'skill-010', mode: 'replace', replacementItemId: 'skill-011' });
  assert.match(refused(overrideOutcome(copper, 'skill-010', 'replace', 'skill-010')), /different item/);
  assert.match(refused(overrideOutcome(copper, 'skill-010', 'replace', 'gone')), /different item/);
  // A ghost comes back with "keep"; the menu's unhide means the same.
  const reed = ctxOf(CASE_IDS.hidingScope);
  const back = menuOutcome(reed, CASE_IDS.hiddenSkill, 'unhide');
  assert.equal(back.kind, 'action'); if (back.kind === 'action') assert.deepEqual(back.action, { type: 'setOverride', scopeId: CASE_IDS.hidingScope, itemId: CASE_IDS.hiddenSkill, mode: 'inherit' });
  assert.match(refused(overrideOutcome(reed, CASE_IDS.hiddenSkill, 'hide')), /already hidden/);
  // Refusals.
  assert.match(refused(overrideOutcome(ctxOf('global'), 'skill-010', 'hide')), /inside a project/);
  const own = world.items.find(i => i.scopeId === 'scope-copperfen' && i.kind === 'skill')!;
  assert.match(refused(overrideOutcome(copper, own.id, 'hide')), /belongs to Copperfen/);
  assert.match(refused(overrideOutcome(copper, interfaceNodeId('codex'), 'hide')), /cannot keep, hide or replace an interface/);
  assert.match(refused(overrideOutcome(copper, 'nope', 'hide')), /not on the page/);
});

test('the replacement list holds items of the same kind and tool kind, never the item, never a hidden one, own items first', () => {
  const copper = ctxOf('scope-copperfen'), list = replacementChoices(copper, 'skill-010');
  assert.ok(list.length > 10);
  assert.ok(list.every(i => i.kind === 'skill' && i.id !== 'skill-010'));
  const own = world.items.filter(i => i.scopeId === 'scope-copperfen' && i.kind === 'skill').map(i => i.id);
  assert.deepEqual(list.slice(0, own.length).map(i => i.id).sort(), own.sort(), 'the project\'s own skills come first');
  const prompts = replacementChoices(copper, freeTool.id);
  assert.ok(prompts.length > 0 && prompts.every(i => i.kind === 'tool' && i.toolKind === 'prompt'));
  const reed = ctxOf(CASE_IDS.hidingScope);
  assert.equal(replacementChoices(reed, 'skill-010').some(i => i.id === CASE_IDS.hiddenSkill), false, 'a hidden item is not offered');
  assert.deepEqual(replacementChoices(copper, 'nope'), []);
  // Another project's items are out of reach.
  const other = world.items.filter(i => i.scopeId === 'scope-tallowbrook' && i.kind === 'skill');
  assert.ok(other.length > 0); for (const o of other) assert.equal(list.some(i => i.id === o.id), false);
});

test('conflicts: the three copies of the sample skill, their names, and the rules for keeping both', () => {
  const item = world.items.find(i => i.id === CASE_IDS.tripleSkill)!, copies = conflictCopies(item);
  assert.equal(copies.length, 3);
  assert.deepEqual(copies.map(c => c.interfaceNames), ['Claude Code', 'Codex', 'OpenCode']);
  assert.deepEqual(copies.map(c => c.index), [0, 1, 2]);
  assert.ok(copies.every(c => c.text.length > 20 && c.paths.length === 1));
  assert.deepEqual(defaultCopyNames(item), copies.map(c => `${item.name} (${c.interfaceNames})`));
  assert.deepEqual(conflictCopies(world.items.find(i => i.id === 'skill-010')!), [], 'no conflict, no copies');
  assert.equal(keepBothProblem(world, item, defaultCopyNames(item)), null);
  assert.match(keepBothProblem(world, item, ['a', 'b'])!, /Give every copy a name/);
  assert.match(keepBothProblem(world, item, ['a', ' ', 'c'])!, /Give every copy a name/);
  assert.match(keepBothProblem(world, item, ['a', 'a', 'c'])!, /own name/);
  const taken = world.items.find(i => i.id === 'skill-010')!.name;
  assert.match(keepBothProblem(world, item, ['a', taken, 'c'])!, /already used/);
  assert.match(keepBothProblem(world, world.items.find(i => i.id === 'skill-010')!, ['a', 'b'])!, /no conflict/);
  assert.match(refused(keepBothOutcome(world, item, ['a', 'a', 'c'])), /own name/);
});

test('keeping one copy or both is a resolveConflict that the store accepts', () => {
  const item = world.items.find(i => i.id === CASE_IDS.tripleSkill)!;
  const one = keepOneOutcome(item, 1);
  assert.equal(one.kind, 'action'); if (one.kind === 'action') { assert.deepEqual(one.action, { type: 'resolveConflict', itemId: item.id, keep: 1 }); assert.match(one.message, /Codex/); }
  assert.match(refused(keepOneOutcome(item, 7)), /not there/);
  const store = createStore(world);
  if (one.kind === 'action') store.dispatch(one.action);
  const kept = store.getState().draft.items.find(i => i.id === item.id)!;
  assert.equal(kept.foundAt.length, 1); assert.equal(kept.foundAt[0]!.interface, 'codex');
  const both = keepBothOutcome(world, item, ['  First ', 'Second', 'Third']);
  assert.equal(both.kind, 'action');
  const store2 = createStore(world);
  if (both.kind === 'action') { assert.deepEqual(both.action, { type: 'resolveConflict', itemId: item.id, keep: 'keep-both', names: ['First', 'Second', 'Third'] }); store2.dispatch(both.action); }
  assert.deepEqual(store2.getState().draft.items.filter(i => ['First', 'Second', 'Third'].includes(i.name)).length, 3);
});

test('every action the rules produce is accepted by the store: the draft changes, and the input world does not', () => {
  const before = JSON.stringify(world);
  const cases: EditorOutcome[] = [
    connectOutcome(ctxOf('global'), freeSkill.id, a1.id), connectOutcome(ctxOf('global'), a1.id, freeSlice.id),
    attachToolOutcome(a1.id, freeTool.id, 'read-only', ACCESS_WORDS, a1.name, freeTool.name),
    dropOutcome(ctxOf('scope-copperfen'), 'skill-010', scopeNodeId('scope-copperfen')),
    overrideOutcome(ctxOf('scope-copperfen'), 'skill-010', 'hide'), overrideOutcome(ctxOf('scope-copperfen'), 'skill-010', 'replace', 'skill-011'),
    menuOutcome(ctxOf(CASE_IDS.hidingScope), CASE_IDS.hiddenSkill, 'unhide'),
  ];
  for (const o of cases) {
    assert.equal(o.kind, 'action');
    if (o.kind !== 'action') continue;
    const store = createStore(world);
    store.dispatch(o.action);
    assert.equal(isDirty(store.getState()), true, JSON.stringify(o.action));
  }
  assert.equal(JSON.stringify(world), before, 'the world is never changed');
});

test('the source: the rules read no file, clock or random number, and use no word the product avoids', () => {
  const code = readFileSync(join(DESKTOP, 'shared/proto/editor-actions.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /node:fs|Math\.random|\bDate\b|performance\.now|window\./);
  assert.doesNotMatch(code, /\bhelpers?\b|\bteams?\b|terminal|command line/i);
  assert.doesNotMatch(code, /[\u2013\u2014]/);
});
