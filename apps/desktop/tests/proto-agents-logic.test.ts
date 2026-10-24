// The agents manager's logic: the lists and the 50-row pages, what a selected agent is made of, each action's outcome and refusal, and where an agent lands.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentLists, agentMatches, assignSliceOutcome, attachableSkills, attachableSlices, attachableTools, attachSkillOutcome, attachToolChoice, changeAccessOutcome, describeAgent,
  detachSkillOutcome, detachToolOutcome, moreLabel, moveSkillOutcome, PAGE_SIZE, rowsLeft, toolKindWord, visibleRows, whereItLands,
} from '../shared/proto/agents-logic.js';
import type { EditorOutcome } from '../shared/proto/editor-actions.js';
import { installOutcome } from '../shared/proto/library-install.js';
import { CASE_IDS, generateWorld } from '../shared/proto/sample.js';
import { createStore, isDirty } from '../shared/proto/store.js';
import type { AgentItem, ToolItem, World } from '../shared/proto/types.js';

const world = generateWorld(1);
const agentOf = (id: string, w: World = world): AgentItem => w.items.find(i => i.id === id && i.kind === 'agent') as AgentItem;
const owned = agentOf('agent-01'), library = agentOf(CASE_IDS.newerLibraryItem);
const action = (o: EditorOutcome) => { assert.equal(o.kind, 'action', o.kind === 'refused' ? o.message : o.kind); return o.kind === 'action' ? o : (undefined as never); };
const refused = (o: EditorOutcome): string => { assert.equal(o.kind, 'refused'); return o.kind === 'refused' ? o.message : ''; };
/** Runs an outcome's action in a store and returns the new draft. */
function run(w: World, o: EditorOutcome): World { const s = createStore(w); s.dispatch(action(o).action); return s.getState().draft; }

test('the lists: yours first (10 agents), then Evergreen Kit with 120, each sorted by name', () => {
  const lists = agentLists(world, '');
  assert.deepEqual(lists.map(l => [l.title, l.all, l.matching.length]), [['Yours', 10, 10], ['Evergreen Kit', 120, 120]]);
  assert.equal(lists[0]!.library, null); assert.equal(lists[1]!.library!.id, 'evergreen-kit');
  for (const l of lists) { const names = l.matching.map(a => a.name); assert.deepEqual(names, [...names].sort()); }
});

test('the search looks at the name and the role in every list; an empty query keeps all', () => {
  const role = library.definition.role, hits = agentLists(world, role);
  assert.ok(hits[1]!.matching.length >= 1 && hits[1]!.matching.length < 120); assert.ok(hits[1]!.matching.every(a => a.definition.role.toLowerCase().includes(role) || a.name.includes(role)));
  assert.equal(hits[1]!.all, 120, 'the total does not shrink');
  assert.equal(agentLists(world, owned.name)[0]!.matching.length, 1);
  assert.equal(agentLists(world, 'zzzzqqq').every(l => l.matching.length === 0), true);
  assert.equal(agentMatches(owned, owned.name.toUpperCase()), true); assert.equal(agentMatches(owned, ''), true);
});

test('pages: 50 rows at a time, "Show 50 more" until the last page, and never fewer than one page', () => {
  const rows = agentLists(world, '')[1]!.matching;
  assert.equal(PAGE_SIZE, 50);
  assert.equal(visibleRows(rows, 50).length, 50); assert.equal(rowsLeft(rows, 50), 70); assert.equal(moreLabel(70), 'Show 50 more');
  assert.equal(visibleRows(rows, 100).length, 100); assert.equal(rowsLeft(rows, 100), 20); assert.equal(moreLabel(20), 'Show 20 more');
  assert.equal(visibleRows(rows, 150).length, 120); assert.equal(rowsLeft(rows, 150), 0);
  assert.equal(visibleRows(rows, 0).length, 50, 'a smaller number still shows one page');
  assert.equal(visibleRows([1, 2, 3], 50).length, 3); assert.equal(rowsLeft([1, 2, 3], 50), 0);
});

test('describeAgent: an owned agent has its skills in order, its tools with access words, its slice and its extras with badges', () => {
  const v = describeAgent(world, owned);
  assert.equal(v.name, owned.name); assert.equal(v.role, owned.definition.role); assert.equal(v.instructions, owned.definition.instructions);
  assert.deepEqual(v.skills.map(s => s.id), [...owned.definition.skillIds]); assert.ok(v.skills.every(s => !s.missing && s.name !== s.id));
  assert.deepEqual(v.skills.map(s => [s.position, s.count]), owned.definition.skillIds.map((_, i) => [i, owned.definition.skillIds.length]));
  assert.ok(v.tools.length >= 1); assert.ok(v.tools.every(t => t.accessWords === 'read only' || t.accessWords === 'read and write'));
  assert.equal(v.tools[0]!.id, CASE_IDS.mcpMissing); assert.equal(v.tools[0]!.kind, 'MCP server');
  assert.notEqual(v.slice, null); assert.notEqual(v.sliceItemId, null);
  assert.equal(v.extras.length, 1); assert.match(v.extras[0]!.badge, /only$/); assert.equal(v.extras[0]!.key, 'accent');
  assert.match(v.extras[0]!.interfaceName, /Claude Code|Codex|OpenCode/);
  assert.equal(v.origin, 'Lives in Studio'); assert.equal(v.refusal, null); assert.equal(v.libraryName, null); assert.equal(v.newerVersion, null);
  assert.match(v.extrasNote, /one interface only/);
});

test('describeAgent: an agent with no extras says so, and a library agent is read only with the editor\'s own reason', () => {
  const plain = describeAgent(world, agentOf('agent-02'));
  assert.deepEqual(plain.extras, []); assert.equal(plain.extrasNote, 'No extras. This agent is the same in every interface.');
  const v = describeAgent(world, library);
  assert.equal(v.origin, 'From Evergreen Kit 2.3.0'); assert.equal(v.libraryName, 'Evergreen Kit'); assert.equal(v.newerVersion, '2.4.0');
  assert.equal(v.refusal, `${library.name} comes from the library Evergreen Kit and is read only. Make an editable copy first, then change the copy.`);
  assert.equal(describeAgent(world, agentOf('agent-lib-005')).newerVersion, '2.4.0', 'the library has a new version waiting');
  assert.deepEqual(v.skills, []);
});

test('describeAgent: a skill or tool the world does not have is marked missing and keeps its id as a name', () => {
  const broken: AgentItem = { ...owned, definition: { ...owned.definition, skillIds: ['skill-gone'], toolAttachments: [{ toolId: 'tool-gone', access: 'read-only' }] } };
  const v = describeAgent(world, broken);
  assert.deepEqual(v.skills.map(s => [s.name, s.missing]), [['skill-gone', true]]); assert.deepEqual(v.tools.map(t => [t.name, t.missing]), [['tool-gone', true]]);
});

test('attachableSkills and attachableTools: no skill the agent has, no hook, no tool it has, none for a library agent', () => {
  const skills = attachableSkills(world, owned);
  assert.ok(skills.length > 20); assert.ok(skills.every(s => !owned.definition.skillIds.includes(s.id)));
  assert.equal(skills.some(s => s.id === CASE_IDS.hiddenSkill), true, 'a skill hidden only in another project can be used by a global agent');
  const names = skills.map(s => s.name); assert.deepEqual(names, [...names].sort());
  const tools = attachableTools(world, owned);
  assert.ok(tools.length >= 1); assert.ok(tools.every((t: ToolItem) => t.toolKind !== 'hook' && !owned.definition.toolAttachments.some(a => a.toolId === t.id)));
  assert.deepEqual(attachableSkills(world, library), []); assert.deepEqual(attachableTools(world, library), []);
  assert.equal(toolKindWord(world.items.find(i => i.id === CASE_IDS.hook) as ToolItem), 'Hook');
  assert.equal(toolKindWord(world.items.find(i => i.id === 'tool-prompt-01') as ToolItem), 'Saved prompt');
});

test('attachableSkills for an agent in a project: a skill of another project is not offered', () => {
  const inProject = agentOf('agent-09');
  assert.equal(inProject.scopeId, CASE_IDS.hidingScope);
  const ids = attachableSkills(world, inProject).map(s => s.id);
  assert.equal(ids.includes('skill-proj-2'), false, 'skill-proj-2 belongs to another project');
  const free = world.items.find(i => i.kind === 'skill' && i.scopeId === 'global' && !inProject.definition.skillIds.includes(i.id))!;
  assert.equal(ids.includes(free.id), true, 'a global skill reaches a project');
});

test('attachableSlices lists the slices the agent\'s harness can reach', () => {
  const slices = attachableSlices(world, owned);
  assert.equal(slices.length, 3); assert.ok(slices.every(s => s.id.startsWith('item-slice-')));
});

test('attach a skill: the editor\'s wire; a second attach, a library agent and a tool are refused with a reason', () => {
  const free = attachableSkills(world, owned)[0]!;
  const o = action(attachSkillOutcome(world, owned, free.id));
  assert.deepEqual(o.action, { type: 'attachSkill', agentId: owned.id, skillId: free.id }); assert.equal(o.message, `${owned.name} now uses the skill ${free.name}.`);
  const after = run(world, o);
  assert.equal(agentOf(owned.id, after).definition.skillIds.at(-1), free.id);
  assert.match(refused(attachSkillOutcome(after, agentOf(owned.id, after), free.id)), /already uses the skill/);
  assert.match(refused(attachSkillOutcome(world, library, free.id)), /comes from the library Evergreen Kit and is read only/);
  assert.equal(refused(attachSkillOutcome(world, owned, 'tool-prompt-01')), 'That is a tool, not a skill.');
});

test('detach a skill: one action, and a refusal for a library agent and for a skill the agent does not use', () => {
  const skillId = owned.definition.skillIds[0]!, name = world.items.find(i => i.id === skillId)!.name;
  const o = action(detachSkillOutcome(world, owned, skillId));
  assert.equal(o.message, `${owned.name} no longer uses the skill ${name}.`);
  assert.equal(agentOf(owned.id, run(world, o)).definition.skillIds.includes(skillId), false);
  assert.match(refused(detachSkillOutcome(world, library, skillId)), /read only/);
  assert.match(refused(detachSkillOutcome(world, owned, 'skill-gone')), /does not use the skill/);
});

test('move a skill: up and down by one place, with a message that says the place; the ends and a library agent are refused', () => {
  const ids = owned.definition.skillIds, n = ids.length;
  assert.ok(n >= 2);
  const down = action(moveSkillOutcome(world, owned, ids[0]!, 1));
  assert.deepEqual(down.action, { type: 'moveSkill', agentId: owned.id, skillId: ids[0], toIndex: 1 });
  assert.match(down.message, new RegExp(`to place 2 of ${n} for ${owned.name}\\.$`));
  const moved = run(world, down);
  assert.deepEqual(agentOf(owned.id, moved).definition.skillIds.slice(0, 2), [ids[1], ids[0]]);
  assert.equal(refused(moveSkillOutcome(world, owned, ids[0]!, -1)).endsWith('is already first in the list.'), true);
  assert.equal(refused(moveSkillOutcome(world, owned, ids[n - 1]!, n)).endsWith('is already last in the list.'), true);
  assert.match(refused(moveSkillOutcome(world, owned, ids[1]!, 1)), /already in that place/);
  assert.match(refused(moveSkillOutcome(world, owned, 'skill-gone', 0)), /does not use the skill/);
  assert.match(refused(moveSkillOutcome(world, library, 'x', 0)), /read only/);
  assert.match(refused(moveSkillOutcome(world, owned, ids[0]!, 0.5)), /already (first|last)/);
});

test('attach a tool with an access class, change it, and detach it; a hook, a repeat and a library agent are refused', () => {
  const tool = attachableTools(world, owned)[0]!;
  const o = action(attachToolChoice(world, owned, tool.id, 'read-write'));
  assert.deepEqual(o.action, { type: 'attachTool', agentId: owned.id, toolId: tool.id, access: 'read-write' }); assert.equal(o.message, `${owned.name} now has the tool ${tool.name}, with access: read and write.`);
  const after = run(world, o), again = agentOf(owned.id, after);
  assert.equal(again.definition.toolAttachments.find(t => t.toolId === tool.id)!.access, 'read-write');
  const change = action(changeAccessOutcome(after, again, tool.id, 'read-only'));
  assert.equal(agentOf(owned.id, run(after, change)).definition.toolAttachments.find(t => t.toolId === tool.id)!.access, 'read-only');
  assert.match(refused(changeAccessOutcome(after, again, tool.id, 'read-write')), /already has the access: read and write\./);
  assert.match(refused(changeAccessOutcome(after, again, 'tool-gone', 'read-only')), /does not have the tool/);
  const gone = action(detachToolOutcome(after, again, tool.id));
  assert.equal(agentOf(owned.id, run(after, gone)).definition.toolAttachments.some(t => t.toolId === tool.id), false);
  assert.match(refused(detachToolOutcome(world, owned, 'tool-gone')), /does not have the tool/);
  assert.match(refused(attachToolChoice(world, owned, CASE_IDS.hook, 'read-only')), /A hook runs code on its own/);
  assert.match(refused(attachToolChoice(world, library, tool.id, 'read-only')), /read only/);
  assert.equal(refused(attachToolChoice(world, owned, 'skill-020', 'read-only')), 'That is not a tool.');
  assert.match(refused(changeAccessOutcome(world, library, tool.id, 'read-only')), /read only/); assert.match(refused(detachToolOutcome(world, library, tool.id)), /read only/);
});

test('assign a slice or none: the editor\'s wire, then a plain "none"; the same slice twice is refused', () => {
  const free = attachableSlices(world, agentOf('agent-05')); // agent-05 reads no slice
  assert.equal(agentOf('agent-05').definition.sliceId, undefined);
  const o = action(assignSliceOutcome(world, agentOf('agent-05'), free[0]!.id));
  assert.deepEqual(o.action, { type: 'assignSlice', agentId: 'agent-05', sliceId: free[0]!.sliceId });
  const after = run(world, o), a = agentOf('agent-05', after);
  assert.match(refused(assignSliceOutcome(after, a, free[0]!.id)), /already reads the slice/);
  const none = action(assignSliceOutcome(after, a, null));
  assert.equal(none.message, `${a.name} reads no slice now.`); assert.equal(agentOf('agent-05', run(after, none)).definition.sliceId, undefined);
  assert.match(refused(assignSliceOutcome(world, agentOf('agent-05'), null)), /reads no slice already/);
  assert.match(refused(assignSliceOutcome(world, library, null)), /read only/);
});

test('make my own copy: a library agent installs into the chosen harness as an editable agent the person can then change', () => {
  const o = action(installOutcome(world, library.id, 'scope-copperfen'));
  assert.deepEqual(o.action, { type: 'installItem', itemId: library.id, targetScopeId: 'scope-copperfen' });
  assert.equal(o.message, `Installed a copy that you can edit of ${library.name} into Copperfen.`);
  const after = run(world, o), copy = after.items.find(i => i.kind === 'agent' && i.scopeId === 'scope-copperfen' && i.name === library.name) as AgentItem;
  assert.ok(copy); assert.equal(copy.library, null);
  assert.equal(describeAgent(after, copy).refusal, null);
  const skill = attachableSkills(after, copy)[0]!;
  assert.equal(action(attachSkillOutcome(after, copy, skill.id)).action.type, 'attachSkill');
});

// ------------------------------------------------------------------------------------------------------------- where it lands

test('whereItLands: three interfaces in order; an owned agent has files in each, none waiting at the start', () => {
  const l = whereItLands(world, world, owned);
  assert.deepEqual(l.map(x => x.name), ['Claude Code', 'Codex', 'OpenCode']);
  for (const x of l) { assert.equal(x.installed, true); assert.ok(x.files.length >= 1, x.name); assert.ok(x.files.every(f => f.waiting === null && f.preview.startsWith(`Agent: ${owned.name}`))); assert.match(x.status, /^\d+ files? would be written\.$|^1 file would be written\.$/); }
  assert.match(l[0]!.files[0]!.path, /\.claude\/agents\//); assert.match(l[1]!.files[0]!.path, /\.codex\/agents\//); assert.match(l[2]!.files[0]!.path, /\.opencode\/agent\//);
});

test('whereItLands: an agent of the global harness is also written into each project that keeps it', () => {
  const l = whereItLands(world, world, owned)[0]!;
  assert.equal(l.files.length, world.scopes.length, 'one file for the global harness and one for each project');
  const own = whereItLands(world, world, agentOf('agent-09'))[0]!;
  assert.equal(own.files.length, 1, 'a project\'s own agent is written in that project only');
});

test('whereItLands: a change that waits shows on the file it changes, and the extras of one interface show in that interface\'s text', () => {
  const s = createStore(world), skill = attachableSkills(world, owned)[0]!;
  s.dispatch(action(attachSkillOutcome(world, owned, skill.id)).action);
  const { committed, draft } = s.getState();
  const l = whereItLands(committed, draft, agentOf(owned.id, draft));
  for (const x of l) { assert.ok(x.files.every(f => f.waiting === 'change')); assert.match(x.status, /waiting\.$/); assert.ok(x.files.every(f => f.preview.includes(skill.name))); }
  const extra = owned.extras[0]!, name = extra.interface === 'claude-code' ? 'Claude Code' : extra.interface === 'codex' ? 'Codex' : 'OpenCode';
  const holders = l.filter(x => x.files.some(f => f.preview.includes(`${extra.badge}: ${extra.key} = ${extra.value}`)));
  assert.deepEqual(holders.map(x => x.name), [name]);
});

test('whereItLands: a library agent writes nothing; its copy is a new file in every installed interface', () => {
  for (const x of whereItLands(world, world, library)) { assert.deepEqual(x.files, []); assert.equal(x.status, 'Nothing is written. A library agent is a reference.'); }
  const s = createStore(world); s.dispatch(action(installOutcome(world, library.id, 'global')).action);
  const { committed, draft } = s.getState(), copy = draft.items.find(i => i.name === `${library.name} copy`) as AgentItem;
  const l = whereItLands(committed, draft, copy);
  assert.ok(isDirty(s.getState()));
  for (const x of l) { assert.ok(x.files.length >= 1); assert.ok(x.files.every(f => f.waiting === 'add')); }
});

test('whereItLands: an interface that is not installed, or not checked, says so and has no files', () => {
  const w: World = { ...world, interfaces: world.interfaces.map(i => (i.id === 'codex' ? { ...i, installed: 'not-installed' as const } : i.id === 'opencode' ? { ...i, installed: 'unknown' as const } : i)) };
  const l = whereItLands(w, w, owned);
  assert.equal(l[1]!.status, 'Not installed on this computer. Nothing is written.'); assert.deepEqual(l[1]!.files, []); assert.equal(l[1]!.installed, false);
  assert.equal(l[2]!.status, 'Not checked yet. Nothing is written.');
  assert.ok(l[0]!.files.length >= 1);
});
