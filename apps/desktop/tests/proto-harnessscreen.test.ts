// The harness editor screen: what it says with a session and without one, what the inspector says for each kind of node,
// the change bar for no changes and for some, and the words of the screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HarnessScreen } from '../renderer/proto/HarnessScreen.js';
import { AccessDialog, ChangeBar, ConflictDialog, Inspector, ResultPanel } from '../renderer/proto/harness-parts.js';
import { ProtoProvider } from '../renderer/proto/session.js';
import { countLine } from '../renderer/proto/words.js';
import { ACTION_WORDS, applyReason, changeBarText, describeSelection, groupPlan, savedLine, writtenLine } from '../shared/proto/editor-describe.js';
import { buildHarnessMap, groupIdOf, interfaceNodeId, scopeNodeId } from '../shared/proto/harnessmodel.js';
import type { HarnessMapModel } from '../shared/proto/harnessmodel.js';
import { planProjection } from '../shared/proto/plan.js';
import { CASE_IDS, generateWorld } from '../shared/proto/sample.js';
import { createStore } from '../shared/proto/store.js';
import type { Plan } from '../shared/proto/types.js';
import { DESKTOP } from './support.js';

const COMMAND = /\bbowerloom (ls|status|use|unuse|lock|apply|skills|skill|prompt|team|store|folder|slice|context|cache|up|help)\b|\bnpm (run|install)\b|\bgit (push|init|add|commit|remote)\b|\bcd \S|\bchmod\b|--[a-z]{3,}|terminal|command line|\$ /i;
const BANNED_WORD = /\bhelpers?\b|\bteams?\b/i;
const world = generateWorld(1);
const textOf = (markup: string): string => markup.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const model = (scopeId: string, expanded: string[] = []): HarnessMapModel => buildHarnessMap(world, { scopeId, showInherited: true, expandedGroups: expanded });
const withStore = (store = createStore(world)): string => renderToStaticMarkup(createElement(ProtoProvider, { store }, createElement(HarnessScreen, { world })));
const noop = (): void => undefined;
const ref = { current: null };

test('without a session the screen is the title and the count of items, and does not throw', () => {
  const markup = renderToStaticMarkup(createElement(HarnessScreen, { world }));
  assert.equal(textOf(markup), `Harness ${countLine('harness', world)}`);
  assert.match(markup, /<h1[^>]*>Harness<\/h1>/);
});

test('with a session the editor shows the title, a scope switch with every scope, the inherited toggle and one chip for each interface', () => {
  const markup = withStore(), text = textOf(markup);
  assert.match(markup, /<h1[^>]*>Harness<\/h1>/);
  assert.match(markup, /<label[^>]*>[\s\S]*?<span>Scope<\/span>[\s\S]*?<select/);
  for (const s of world.scopes) assert.match(markup, new RegExp(`<option[^>]*value="${s.id}"[^>]*>${s.name} \\(${s.kind === 'global' ? 'global' : 'project'}\\)</option>`), s.id);
  assert.equal([...markup.matchAll(/<option /g)].length, world.scopes.length);
  assert.match(text, /Show inherited/);
  for (const name of ['Claude Code', 'Codex', 'OpenCode']) assert.match(markup, new RegExp(`<button[^>]*aria-pressed="false"[^>]*>${name}</button>`), name);
  assert.match(markup, /role="group" aria-label="Show only items found in"/);
  assert.match(markup, /role="status" aria-live="polite"/, 'a live region for results and refusals');
});

test('the change bar with no changes: says so, Apply is off with its reason, and nothing else can be done', () => {
  const markup = withStore(), text = textOf(markup);
  assert.match(text, /No changes waiting/);
  for (const name of ['Apply', 'Undo', 'Redo', 'Discard', 'See what will be written']) assert.match(markup, new RegExp(`<button[^>]*disabled=""[^>]*>${name}</button>|<button[^>]*disabled=""[^>]*aria-describedby="[^"]*"[^>]*>${name}</button>|<button[^>]*aria-describedby="[^"]*"[^>]*disabled=""[^>]*>${name}</button>`), name);
  assert.match(text, /There is nothing to apply\. Make a change first\./);
  assert.equal(changeBarText(false, 0, 0), 'No changes waiting'); assert.equal(changeBarText(false, 7, 2), 'No changes waiting');
  assert.equal(applyReason(false), 'There is nothing to apply. Make a change first.'); assert.equal(applyReason(true), null);
});

test('the change bar with changes: the count, a label field, and Apply on', () => {
  const store = createStore(world);
  store.dispatch({ type: 'attachSkill', agentId: 'agent-01', skillId: 'skill-030' });
  const plan = planProjection(store.getState().committed, store.getState().draft);
  assert.ok(plan.changes.length >= 3, 'a change in an agent is written to every installed interface');
  const markup = withStore(store), text = textOf(markup);
  assert.equal(plan.edits, 1, 'one attached skill is one edit');
  assert.match(text, new RegExp(`1 edit waiting\\. ${plan.changes.length} files would change\\.`));
  assert.doesNotMatch(markup, /<button[^>]*disabled=""[^>]*>Apply<\/button>/);
  assert.match(markup, /<button[^>]*>Apply<\/button>/);
  assert.match(markup, /<button[^>]*>See what will be written<\/button>/);
  assert.match(markup, /placeholder="Short label for this version"/);
  assert.equal(changeBarText(true, 1, 1), '1 edit waiting. 1 file would change.'); assert.equal(changeBarText(true, 12, 5), '5 edits waiting. 12 files would change.');
  assert.equal(changeBarText(true, 0, 1), '1 edit waiting. No file would change.');
});

function planOf(): Plan {
  const store = createStore(world);
  store.dispatch({ type: 'attachSkill', agentId: 'agent-01', skillId: 'skill-030' });
  store.dispatch({ type: 'setOverride', scopeId: 'scope-copperfen', itemId: 'skill-010', mode: 'hide' });
  return planProjection(store.getState().committed, store.getState().draft);
}

test('the open list groups the files by interface, with the path, what happens to each file, and its text', () => {
  const plan = planOf(), groups = groupPlan(plan);
  assert.deepEqual(groups.map(g => g.name), ['Claude Code', 'Codex', 'OpenCode']);
  assert.equal(groups.reduce((n, g) => n + g.changes.length, 0), plan.changes.length);
  assert.ok(groups.every(g => /\d+ (added|changed|removed)/.test(g.summary)));
  const markup = renderToStaticMarkup(createElement(ChangeBar, { dirty: true, plan, open: true, onToggle: noop, canUndo: true, canRedo: false, onUndo: noop, onRedo: noop, onDiscard: noop, label: '', onLabel: noop, onApply: noop, toggleRef: ref }));
  const text = textOf(markup);
  for (const g of groups) { assert.match(markup, new RegExp(`aria-label="${g.name}"`)); assert.ok(text.includes(g.name)); }
  for (const c of plan.changes) { assert.ok(text.includes(c.path), c.path); assert.ok(text.includes(ACTION_WORDS[c.action]), c.action); }
  assert.match(markup, /aria-expanded="true"/);
  assert.ok(text.includes(plan.changes[0]!.preview.split('\n')[0]!), 'the preview text is there');
  const closed = renderToStaticMarkup(createElement(ChangeBar, { dirty: true, plan, open: false, onToggle: noop, canUndo: true, canRedo: false, onUndo: noop, onRedo: noop, onDiscard: noop, label: '', onLabel: noop, onApply: noop, toggleRef: ref }));
  assert.match(closed, /aria-expanded="false"/); assert.doesNotMatch(closed, /harness-plan/);
});

test('the result names the interfaces the plan touched, the files per interface, and the number of the version', () => {
  const plan = planOf();
  assert.equal(writtenLine(plan), 'Written to Claude Code, Codex and OpenCode (simulated)');
  assert.equal(writtenLine({ changes: plan.changes.filter(c => c.interface !== 'codex') }), 'Written to Claude Code and OpenCode (simulated)');
  assert.equal(writtenLine({ changes: [] }), 'Nothing needed to be written (simulated)');
  assert.equal(savedLine(3, 'Add a skill'), 'Saved as version 3: Add a skill');
  const markup = renderToStaticMarkup(createElement(ResultPanel, { plan, counter: 1, label: 'Applied changes', onClose: noop, headingRef: ref }));
  const text = textOf(markup);
  assert.match(text, /Written to Claude Code, Codex and OpenCode \(simulated\)/);
  assert.match(text, /Saved as version 1: Applied changes/);
  for (const c of plan.changes) assert.ok(text.includes(c.path), c.path);
  assert.match(markup, /<h2[^>]*id="harness-result-title"/);
});

test('the version number in the result is the one the store gave: first apply is version 1, the next is 2', () => {
  const store = createStore(world);
  store.dispatch({ type: 'attachSkill', agentId: 'agent-01', skillId: 'skill-030' });
  store.dispatch({ type: 'apply', label: 'First' });
  const s = store.getState();
  assert.equal(s.committed.versions.find(v => v.id === s.headVersionId)!.counter, 1);
  store.dispatch({ type: 'attachSkill', agentId: 'agent-02', skillId: 'skill-031' });
  store.dispatch({ type: 'apply', label: 'Second' });
  const t = store.getState();
  assert.equal(t.committed.versions.find(v => v.id === t.headVersionId)!.counter, 2);
});

// ---- the inspector, for each kind

function view(scopeId: string, id: string, expanded: string[] = []) {
  const m = model(scopeId, expanded), v = describeSelection(world, m, id);
  assert.ok(v, `${id} is on the page`);
  return v;
}
const ownedAgent = world.items.find(i => i.kind === 'agent' && i.library === null && i.id === 'agent-01')!;

test('describeSelection: a skill says what it is, where it was found, and who uses it', () => {
  const v = view('global', 'skill-010'), item = world.items.find(i => i.id === 'skill-010')!;
  assert.equal(v.kindWord, 'Skill'); assert.equal(v.name, item.name);
  assert.match(v.sentence, /^A skill is a reusable set of instructions for one kind of task\./);
  assert.ok(item.kind === 'skill' && v.sentence.includes(item.description));
  assert.deepEqual(v.foundAt.map(f => f.path), item.foundAt.map(f => f.path));
  assert.ok(v.foundAt.every(f => ['Claude Code', 'Codex', 'OpenCode'].includes(f.interfaceName)));
  assert.equal(v.flags.length, 0); assert.equal(v.readOnlyNote, null);
  assert.match(v.facts.join(' '), /^(No agent uses it yet|Used by \d+ agents?)/);
});

test('describeSelection: an agent lists its skills, its tools with the access words, and its slice, and offers to remove each', () => {
  const v = view('global', ownedAgent.id);
  assert.equal(v.kindWord, 'Agent'); assert.match(v.sentence, /^An agent is a named role/);
  assert.ok(v.facts[0]!.startsWith('Uses ')); assert.match(v.facts[1]!, /read only|read and write|no tools/); assert.ok(v.facts[2]!.length > 0);
  const removes = v.actions.filter(a => a.id === 'remove-skill');
  assert.equal(removes.length, ownedAgent.kind === 'agent' ? ownedAgent.definition.skillIds.length : -1);
  for (const a of removes) assert.equal(a.store?.type, 'detachSkill');
  assert.ok(v.actions.some(a => a.id === 'remove-tool') && v.actions.some(a => a.id === 'clear-slice'));
});

test('describeSelection: an MCP tool whose secret is missing says so in words; a saved prompt and a hook say what they are', () => {
  const mcp = view('global', CASE_IDS.mcpMissing);
  assert.equal(mcp.kindWord, 'Tool'); assert.match(mcp.sentence, /MCP server/); assert.match(mcp.sentence, /never the value/);
  assert.ok(mcp.flags.some(f => /^Secret missing/.test(f)));
  assert.match(view('global', CASE_IDS.mcpPresent).sentence, /keychain named/);
  const prompt = view('global', 'tool-prompt-01');
  assert.match(prompt.sentence, /saved prompt/); assert.equal(prompt.flags.length, 0);
  const hook = view('global', CASE_IDS.hook);
  assert.equal(hook.kindWord, 'Hook'); assert.match(hook.sentence, /runs code with no prompt/i);
  assert.ok(hook.flags.some(f => /^Runs code/.test(f)));
  assert.match(hook.readOnlyNote!, /cannot be created or edited/);
  assert.equal(hook.actions.some(a => a.id === 'remove-skill' || a.id === 'copy'), false);
});

test('describeSelection: a slice says its rule in words; the root, an interface and a library group say what they are', () => {
  const slice = view('global', 'item-slice-folders');
  assert.equal(slice.kindWord, 'Slice'); assert.match(slice.sentence, /^A slice is a chosen part of the knowledge base\. Everything in /);
  assert.match(slice.foundNote, /lives in Bowerloom/); assert.equal(slice.foundAt.length, 0);
  assert.match(view('global', scopeNodeId('global')).sentence, /global harness holds what every project starts with/);
  assert.match(view('scope-copperfen', scopeNodeId('scope-copperfen')).sentence, /starts with everything in the global harness/);
  assert.match(view('global', interfaceNodeId('claude-code')).sentence, /^Claude Code is a program you talk to\..*block reads/);
  assert.match(view('global', interfaceNodeId('codex')).sentence, /only advise/);
  const group = view('global', groupIdOf(CASE_IDS.newerLibrary));
  assert.equal(group.kindWord, 'Library'); assert.match(group.sentence, /read only and pinned to version 2\.3\.0\. Version 2\.4\.0 is waiting\./);
  assert.ok(group.flags.includes('New version waiting: 2.4.0.'));
  assert.deepEqual(group.actions.map(a => a.id), ['toggle-group']); assert.match(group.actions[0]!.label, /^Show all 120 items$/);
  assert.equal(describeSelection(world, model('global'), 'nope'), null);
});

test('describeSelection: a library item is read only and offers a copy; a conflict offers to resolve it', () => {
  const lib = world.items.find(i => i.id === CASE_IDS.newerLibraryItem)!;
  const v = view('global', lib.id, [groupIdOf(CASE_IDS.newerLibrary)]);
  assert.match(v.readOnlyNote!, /read only/); assert.ok(v.actions.some(a => a.id === 'copy' && a.store?.type === 'installItem'));
  assert.ok(v.flags.some(f => /^New version waiting: 2\.4\.0/.test(f))); assert.ok(v.flags.some(f => /^From the library Evergreen Kit, read only, pinned to 2\.3\.0/.test(f)));
  assert.equal(v.actions.some(a => a.id === 'remove-skill'), false);
  const c = view('global', CASE_IDS.tripleSkill);
  assert.ok(c.flags.some(f => /^Conflict/.test(f))); assert.ok(c.actions.some(a => a.id === 'resolve' && a.label === 'Resolve the conflict'));
  assert.equal(c.foundAt.length, 3);
});

test('describeSelection: in a project an inherited item has keep, hide and replace, and the current choice is marked', () => {
  const inherited = view('scope-copperfen', 'skill-010');
  assert.ok(inherited.flags.includes('Inherited from Studio.'));
  assert.deepEqual(inherited.actions.map(a => [a.label, a.pressed]), [['Keep from global', true], ['Hide here', false], ['Replace here', false]]);
  assert.deepEqual(inherited.actions[1]!.store, { type: 'setOverride', scopeId: 'scope-copperfen', itemId: 'skill-010', mode: 'hide' });
  const ghost = view(CASE_IDS.hidingScope, CASE_IDS.hiddenSkill);
  assert.ok(ghost.flags.some(f => /^Hidden here/.test(f))); assert.deepEqual(ghost.actions.map(a => a.pressed), [false, true, false]);
  const replaced = view('scope-copperfen', 'skill-005');
  assert.ok(replaced.flags.some(f => /^Replaced here by /.test(f))); assert.deepEqual(replaced.actions.map(a => a.pressed), [false, false, true]);
  const own = world.items.find(i => i.scopeId === 'scope-copperfen' && i.kind === 'skill')!;
  assert.equal(view('scope-copperfen', own.id).actions.length, 0, 'an item the project owns has nothing to keep, hide or replace');
  assert.equal(view('global', 'skill-010').actions.length, 0);
  const inheritedAgent = view('scope-copperfen', 'agent-01');
  assert.match(inheritedAgent.readOnlyNote!, /inherited from Studio/); assert.equal(inheritedAgent.actions.some(a => a.id === 'remove-skill'), false);
  assert.equal(view('scope-copperfen', CASE_IDS.hook).actions.some(a => a.id === 'replace-here'), false, 'a hook cannot be replaced');
});

test('the inspector draws the description, the states, the buttons, and the places', () => {
  const v = describeSelection(world, model('scope-copperfen'), 'skill-010')!;
  const markup = renderToStaticMarkup(createElement(Inspector, { view: v, onAction: noop, onClose: noop, headingRef: ref, replace: { choices: [{ id: 'a', label: 'Alpha (library)' }], value: 'a', onChange: noop, onConfirm: noop, onCancel: noop } }));
  const text = textOf(markup);
  assert.match(markup, /<aside[^>]*aria-label="Details of the selected item"/);
  assert.match(markup, /<h2[^>]*>/); assert.ok(text.includes(v.name)); assert.ok(text.includes(v.sentence));
  for (const f of v.flags) assert.ok(text.includes(f), f);
  for (const label of ['Keep from global', 'Hide here', 'Replace here']) assert.match(markup, new RegExp(`<button[^>]*aria-pressed="(true|false)"[^>]*>${label}</button>`), label);
  assert.match(text, /Where it was found/); for (const f of v.foundAt) { assert.ok(text.includes(f.interfaceName)); assert.ok(text.includes(f.path)); }
  assert.match(markup, /<label[^>]*>[\s\S]*Replace [^<]* with[\s\S]*<select/);
  assert.match(markup, /aria-label="Close the details"/);
});

test('the dialogs: the access chooser uses the placeholder words, and the conflict dialog shows every copy side by side with a name field for each', () => {
  const access = renderToStaticMarkup(createElement(AccessDialog, { agentName: 'Planner', toolName: 'Search', current: null, onPick: noop, onClose: noop }));
  assert.match(access, /role="dialog" aria-modal="true" aria-labelledby=/);
  assert.match(textOf(access), /read only/); assert.match(textOf(access), /read and write/);
  assert.equal([...access.matchAll(/type="radio"/g)].length, 2); assert.match(access, /<legend>How much may Planner do with Search\?/);
  const item = world.items.find(i => i.id === CASE_IDS.tripleSkill)!;
  const dialog = renderToStaticMarkup(createElement(ConflictDialog, { world, item, onKeepOne: noop, onKeepBoth: noop, onClose: noop }));
  const text = textOf(dialog);
  assert.match(dialog, /role="dialog" aria-modal="true"/);
  for (const name of ['Claude Code', 'Codex', 'OpenCode']) { assert.ok(text.includes(`Copy from ${name}`), name); assert.ok(text.includes(`Keep the copy from ${name}`), name); }
  for (const f of item.foundAt) { assert.ok(text.includes(f.path), f.path); assert.ok(dialog.includes(f.text.split('\n')[4] ?? f.text.slice(0, 20)) || text.includes(f.text.slice(0, 20)), 'the text of each copy'); }
  assert.match(text, /Keep both under their own names/);
});

// ---- words and source

test('the screen says nothing about a command line, a helper or a team, and uses no long dash', () => {
  const store = createStore(world);
  store.dispatch({ type: 'attachSkill', agentId: 'agent-01', skillId: 'skill-030' });
  const words = [withStore(), withStore(store)].map(textOf);
  const plan = planOf();
  words.push(textOf(renderToStaticMarkup(createElement(ResultPanel, { plan, counter: 2, label: 'x', onClose: noop, headingRef: ref }))));
  for (const scopeId of ['global', 'scope-copperfen', CASE_IDS.hidingScope]) for (const n of model(scopeId, [groupIdOf(CASE_IDS.newerLibrary)]).nodes) {
    const v = describeSelection(world, model(scopeId, [groupIdOf(CASE_IDS.newerLibrary)]), n.id)!;
    words.push(v.sentence, ...v.facts, ...v.flags, v.readOnlyNote ?? '', ...v.actions.map(a => a.label + (a.done ?? '')), v.foundNote);
  }
  assert.ok(words.length > 100);
  for (const w of words) { assert.doesNotMatch(w, COMMAND, w.slice(0, 80)); assert.doesNotMatch(w, BANNED_WORD, w.slice(0, 80)); assert.doesNotMatch(w, /[\u2013\u2014]/, w.slice(0, 80)); }
});

test('the new files keep to the rules: no long dash, no hex colour or fixed duration in the style sheet, the panel token for the slide', () => {
  const files = ['shared/proto/editor-actions.ts', 'shared/proto/editor-describe.ts', 'renderer/proto/HarnessScreen.tsx', 'renderer/proto/harness-parts.tsx', 'renderer/proto/harness-session.ts', 'renderer/proto/harness.css'];
  for (const f of files) assert.doesNotMatch(readFileSync(join(DESKTOP, f), 'utf8'), /[\u2013\u2014]/, f);
  const css = readFileSync(join(DESKTOP, 'renderer/proto/harness.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'colours come from tokens');
  assert.doesNotMatch(css, /\b\d+(\.\d+)?m?s\b(?!\w)/, 'durations come from the motion tokens');
  assert.match(css, /var\(--motion-panel-slide-ms\)/); assert.match(css, /var\(--motion-hover-ms\)/);
});
