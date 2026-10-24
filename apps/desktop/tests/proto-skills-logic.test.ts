// The skills manager's logic: rows per harness, search, the interface chip, the three groups, where a skill is in words, install targets, and the library list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOLDER_CANDIDATES } from '../shared/proto/library-catalog.js';
import {
  contextFor, defaultTarget, folderNote, installOutcome, installTargets, libraryOffers, LIBRARY_STAYS_REFERENCE, scopeLabel, waitingSentence, waitingView,
} from '../shared/proto/library-install.js';
import { planProjection } from '../shared/proto/plan.js';
import { CASE_IDS, generateWorld } from '../shared/proto/sample.js';
import { describePlacement, EVERY_HARNESS, filterRows, groupSkills, matchesQuery, skillRows, skillsSummary, stateWords, buildIndex } from '../shared/proto/skills-logic.js';
import { createStore, isDirty } from '../shared/proto/store.js';
import type { SkillItem, World } from '../shared/proto/types.js';
import { DESKTOP } from './support.js';

const world = generateWorld(1);
const NONE = { query: '', interfaceId: null } as const;
const skillOf = (id: string, w: World = world): SkillItem => w.items.find(i => i.id === id && i.kind === 'skill') as SkillItem;
const withLantern = (): World => { const s = createStore(world); s.dispatch({ type: 'addLibrary', libraryId: 'lantern-works' }); return s.getState().draft; };

test('skillRows: the global harness lists its own 44 skills, all own, and the "every harness" choice lists 52', () => {
  const rows = skillRows(world, 'global');
  assert.equal(rows.length, 44); assert.ok(rows.every(r => r.state === 'own' && r.fromScope === null));
  assert.equal(skillRows(world, EVERY_HARNESS).length, 52);
  assert.equal(skillRows(world, 'no-such-scope').length, 52, 'an unknown harness falls back to every skill');
});

test('skillRows: a project lists what it inherits, what it hides, what it replaces, and its own skills', () => {
  const reed = skillRows(world, CASE_IDS.hidingScope), at = (id: string) => reed.find(r => r.item.id === id);
  assert.equal(at(CASE_IDS.hiddenSkill)!.state, 'hidden'); assert.equal(stateWords(at(CASE_IDS.hiddenSkill)!), 'Hidden in this project');
  assert.equal(at('skill-010')!.state, 'inherited'); assert.equal(at('skill-010')!.fromScope, 'Studio'); assert.equal(stateWords(at('skill-010')!), 'Inherited from Studio');
  const own = reed.filter(r => r.state === 'own');
  assert.ok(own.length >= 1); assert.ok(own.every(r => r.item.scopeId === CASE_IDS.hidingScope)); assert.equal(stateWords(own[0]!), null);
  assert.equal(skillRows(world, 'scope-copperfen').find(r => r.item.id === 'skill-005')!.state, 'replaced');
  assert.equal(stateWords(skillRows(world, 'scope-copperfen').find(r => r.item.id === 'skill-005')!), 'Replaced in this project');
  assert.equal(skillRows(world, 'scope-tallowbrook').find(r => r.item.id === 'skill-006')!.state, 'inherited');
  // A project does not list the skills that belong to another project.
  assert.equal(reed.some(r => r.item.scopeId === 'scope-copperfen'), false);
});

test('the conflict flag marks the skill found in three interfaces with three texts, and no other', () => {
  const flagged = skillRows(world, EVERY_HARNESS).filter(r => r.conflict).map(r => r.item.id);
  assert.deepEqual(flagged, [CASE_IDS.tripleSkill]);
});

test('matchesQuery: every word must be in the name or the description, in any case; an empty query matches', () => {
  const s = skillOf('skill-010');
  assert.equal(matchesQuery(s, ''), true); assert.equal(matchesQuery(s, '   '), true);
  assert.equal(matchesQuery(s, s.name.toUpperCase()), true);
  const word = s.description.split(' ')[1]!.replace(/[^a-z]/gi, '');
  assert.equal(matchesQuery(s, `${s.name} ${word}`), true);
  assert.equal(matchesQuery(s, `${s.name} zzzzqqq`), false);
  assert.equal(matchesQuery(s, 'zzzzqqq'), false);
});

test('filterRows: the search and the interface chip work together, and the chip keeps skills found in that interface', () => {
  const rows = skillRows(world, 'global');
  const codex = filterRows(rows, { query: '', interfaceId: 'codex' });
  assert.ok(codex.length > 0 && codex.length < rows.length); assert.ok(codex.every(r => r.item.foundAt.some(f => f.interface === 'codex')));
  const one = rows.find(r => r.item.foundAt.some(f => f.interface === 'opencode'))!;
  const both = filterRows(rows, { query: one.item.name, interfaceId: 'opencode' });
  assert.deepEqual(both.map(r => r.item.id), [one.item.id]);
  assert.deepEqual(filterRows(rows, { query: one.item.name, interfaceId: null }).map(r => r.item.id), [one.item.id]);
  assert.equal(filterRows(rows, NONE).length, rows.length);
});

test('groupSkills: Yours, From libraries and Found in several tools; every skill is in one group; Evergreen Kit shows its version notice', () => {
  const rows = skillRows(world, 'global'), g = groupSkills(world, rows, NONE);
  assert.equal(g.yours.length, 43); assert.deepEqual(g.conflicts.map(r => r.item.id), [CASE_IDS.tripleSkill]);
  assert.equal(g.shown, 44); assert.equal(g.total, 44);
  assert.equal(g.libraries.length, 1);
  const kit = g.libraries[0]!;
  assert.equal(kit.library.name, 'Evergreen Kit'); assert.equal(kit.pinnedVersion, '2.3.0'); assert.equal(kit.newerVersion, '2.4.0');
  assert.equal(kit.agentCount, 120); assert.equal(kit.skillCount, 0); assert.deepEqual(kit.rows, []);
  assert.equal(skillsSummary(g), '44 skills');
});

test('groupSkills: a filter shrinks the groups and the summary says how many match', () => {
  const rows = skillRows(world, 'global'), target = skillOf('skill-020');
  const g = groupSkills(world, rows, { query: target.name, interfaceId: null });
  assert.equal(g.shown, 1); assert.deepEqual(g.yours.map(r => r.item.id), ['skill-020']); assert.equal(g.conflicts.length, 0);
  assert.equal(skillsSummary(g), '1 skill of 44 match');
  const none = groupSkills(world, rows, { query: 'zzzzqqq', interfaceId: null });
  assert.equal(none.shown, 0); assert.equal(skillsSummary(none), '0 skills of 44 match');
});

test('groupSkills after Lantern Works is added: a second library with 6 skills, pinned, with no new version', () => {
  const w = withLantern(), g = groupSkills(w, skillRows(w, 'global'), NONE);
  assert.equal(g.libraries.length, 2);
  const works = g.libraries.find(l => l.library.id === 'lantern-works')!;
  assert.equal(works.rows.length, 6); assert.equal(works.skillCount, 6); assert.equal(works.agentCount, 3); assert.equal(works.pinnedVersion, '1.2.0'); assert.equal(works.newerVersion, null);
  assert.equal(g.yours.length + g.conflicts.length + g.libraries.reduce((n, l) => n + l.rows.length, 0), g.shown, 'each skill is in exactly one group');
  assert.equal(g.shown, 50);
});

test('groupSkills: a library skill that carries a newer version shows it on its library', () => {
  const w = withLantern();
  const flagged: World = { ...w, items: w.items.map(i => (i.id === 'lantern-works-beam-aiming' && i.library !== null ? { ...i, library: { ...i.library, newerVersion: '1.3.0' } } : i)) };
  const works = groupSkills(flagged, skillRows(flagged, 'global'), NONE).libraries.find(l => l.library.id === 'lantern-works')!;
  assert.equal(works.newerVersion, '1.3.0');
});

test('describePlacement: where a skill is installed, found and written, in words', () => {
  const index = buildIndex(world);
  const plain = describePlacement(world, skillOf('skill-020'), index);
  assert.equal(plain.installed, 'Studio (global) and all 3 projects'); assert.deepEqual(plain.notes, []);
  assert.match(plain.written, /^(Claude Code|Codex|OpenCode)/); assert.match(plain.found, /Claude Code|Codex|OpenCode/);
  const hidden = describePlacement(world, skillOf(CASE_IDS.hiddenSkill), index);
  assert.equal(hidden.installed, 'Studio (global), Copperfen and Tallowbrook'); assert.deepEqual(hidden.notes, ['Hidden in Reedmarsh.']);
  const replaced = describePlacement(world, skillOf('skill-005'), index);
  assert.deepEqual(replaced.notes, ['Replaced in Copperfen.']); assert.equal(replaced.installed, 'Studio (global), Reedmarsh and Tallowbrook');
  const project = describePlacement(world, skillOf('skill-proj-1'), index);
  assert.equal(project.installed, 'Reedmarsh');
  assert.equal(describePlacement(world, skillOf('skill-020')).installed, plain.installed, 'the index is optional');
  assert.equal(plain.written, 'Claude Code, Codex and OpenCode');
});

test('describePlacement: a library skill is a reference, and an interface that is not installed is left out of "written"', () => {
  const w = withLantern(), lib = skillOf('lantern-works-wick-trimming', w);
  const p = describePlacement(w, lib);
  assert.equal(p.installed, 'Not installed. It is a reference to a library.'); assert.equal(p.written, 'Nothing. A library item is a reference.');
  assert.equal(p.found, 'Claude Code and Codex');
  const half: World = { ...world, interfaces: world.interfaces.map(i => (i.id === 'codex' ? { ...i, installed: 'not-installed' as const } : i)) };
  assert.equal(describePlacement(half, skillOf('skill-020', half)).written, 'Claude Code and OpenCode');
  const none: World = { ...world, interfaces: world.interfaces.map(i => ({ ...i, installed: 'not-installed' as const })) };
  assert.equal(describePlacement(none, skillOf('skill-020', none)).written, 'Nothing. No interface is installed.');
  const unused: World = { ...world, scopes: world.scopes, overrides: [], items: world.items.map(i => (i.id === 'skill-020' ? { ...i, foundAt: [] } : i)) };
  assert.equal(describePlacement(unused, skillOf('skill-020', unused)).found, 'Not a file in any interface.');
});

test('installTargets: the global harness first, a harness that already has the skill is off and says why, a library skill goes anywhere', () => {
  const owned = installTargets(world, 'skill-020');
  assert.deepEqual(owned.map(t => t.scopeId), ['global', 'scope-reedmarsh', 'scope-copperfen', 'scope-tallowbrook']);
  assert.equal(owned[0]!.disabled, true);
  assert.match(owned[0]!.reason!, /is already in Studio\.$/);
  assert.ok(owned.slice(1).every(t => !t.disabled && t.reason === null));
  assert.equal(owned[0]!.label, 'Studio (global)'); assert.equal(owned[1]!.label, 'Reedmarsh (project)');
  assert.equal(defaultTarget(owned)!.scopeId, 'scope-reedmarsh', 'the first harness that takes it');
  const w = withLantern(), lib = installTargets(w, 'lantern-works-oil-topping');
  assert.ok(lib.every(t => !t.disabled)); assert.equal(defaultTarget(lib)!.scopeId, 'global');
  assert.equal(defaultTarget([]), null);
  assert.equal(scopeLabel(world.scopes[0]!), 'Studio (global)');
});

test('installOutcome: it is the editor\'s drop on a harness; a library skill installs as an editable copy; a skill of another project goes to global', () => {
  const w = withLantern();
  const lib = installOutcome(w, 'lantern-works-oil-topping', 'scope-copperfen');
  assert.equal(lib.kind, 'action');
  if (lib.kind === 'action') { assert.deepEqual(lib.action, { type: 'installItem', itemId: 'lantern-works-oil-topping', targetScopeId: 'scope-copperfen' }); assert.equal(lib.message, 'Installed a copy that you can edit of oil-topping into Copperfen.'); }
  const mine = installOutcome(w, 'skill-proj-1', 'global');
  assert.equal(mine.kind, 'action');
  if (mine.kind === 'action') assert.equal(mine.message, `Installed a copy of ${skillOf('skill-proj-1').name} into Studio.`);
  const again = installOutcome(w, 'skill-020', 'global');
  assert.equal(again.kind, 'refused');
  assert.equal(installOutcome(w, 'no-such-item', 'global').kind, 'refused');
  assert.equal(installOutcome(w, 'skill-020', 'no-such-scope').kind, 'refused');
  assert.equal(installOutcome(w, CASE_IDS.hook, 'global').kind, 'refused', 'a hook is never copied');
});

test('an install changes the draft, not the committed world, and a library copy is a plain owned skill the plan will write', () => {
  const s = createStore(withLantern());
  const o = installOutcome(s.getState().draft, 'lantern-works-oil-topping', 'global');
  assert.equal(o.kind, 'action');
  if (o.kind !== 'action') return;
  s.dispatch(o.action);
  const st = s.getState();
  assert.equal(isDirty(st), true); assert.equal(st.committed.items.some(i => i.name === 'oil-topping copy'), false);
  const plan = planProjection(st.committed, st.draft);
  assert.ok(plan.changes.length >= 1 && plan.changes.every(c => c.action === 'add'));
  assert.match(waitingSentence(true, plan.changes.length, plan.edits ?? 0), /edits? waiting\. \d+ files? would change\. Apply on the Harness screen\.$/);
});

test('waitingSentence and waitingView reuse the change bar\'s words', () => {
  assert.equal(waitingSentence(true, 3, 1), '1 edit waiting. 3 files would change. Apply on the Harness screen.');
  assert.equal(waitingSentence(true, 1, 1), '1 edit waiting. 1 file would change. Apply on the Harness screen.');
  assert.equal(waitingSentence(true, 0, 2), '2 edits waiting. No file would change. Apply on the Harness screen.');
  assert.equal(waitingSentence(false, 0, 0), 'No changes waiting. Apply on the Harness screen.');
  const clean = waitingView(false, { changes: [] });
  assert.deepEqual(clean, { headline: 'No changes waiting', dirty: false, lines: [] });
  const s = createStore(world);
  s.dispatch({ type: 'attachSkill', agentId: 'agent-01', skillId: 'skill-030' });
  const plan = planProjection(s.getState().committed, s.getState().draft), v = waitingView(true, plan);
  assert.equal(v.headline, `1 edit waiting. ${plan.changes.length} files would change.`);
  assert.deepEqual(v.lines.map(l => l.split(':')[0]), ['Claude Code', 'Codex', 'OpenCode']);
});

test('libraryOffers: Evergreen Kit is installed with its version notice, Lantern Works is available; after adding both are installed', () => {
  const before = libraryOffers(world);
  assert.deepEqual(before.map(o => [o.name, o.state]), [['Evergreen Kit', 'installed'], ['Lantern Works', 'available']]);
  assert.deepEqual([before[0]!.skillCount, before[0]!.agentCount, before[0]!.newerVersion, before[0]!.version], [0, 120, '2.4.0', '2.3.0']);
  assert.deepEqual([before[1]!.skillCount, before[1]!.agentCount, before[1]!.newerVersion], [6, 3, null]);
  const after = libraryOffers(withLantern());
  assert.deepEqual(after.map(o => [o.name, o.state]), [['Evergreen Kit', 'installed'], ['Lantern Works', 'installed']]);
  assert.deepEqual([after[1]!.skillCount, after[1]!.agentCount], [6, 3]);
});

test('the folder source: invented folders, a plain note that reads nothing, and one sentence that a library stays a reference', () => {
  assert.ok(FOLDER_CANDIDATES.length >= 3);
  assert.equal(folderNote('Harbour notes', 2), 'Noted 2 skills from Harbour notes. Bowerloom reads a folder only after you approve it, so nothing was added.');
  assert.match(folderNote('Orchard work', 1), /^Noted 1 skill from/);
  assert.equal(LIBRARY_STAYS_REFERENCE.split('. ').length, 2, 'one sentence of two clauses');
  assert.match(LIBRARY_STAYS_REFERENCE, /stays a reference until you edit an item/);
});

test('contextFor gives the editor\'s rules a model with every library item open', () => {
  const ctx = contextFor(withLantern(), 'global');
  assert.ok(ctx.model.nodes.some(n => n.id === 'lantern-works-oil-topping'));
  assert.ok(ctx.model.nodes.some(n => n.id === 'agent-lib-001'));
});

test('the logic source is plain: no banned word, no clock, no random number, no colour', () => {
  for (const f of ['shared/proto/skills-logic.ts', 'shared/proto/agents-logic.ts', 'shared/proto/library-install.ts', 'shared/proto/library-catalog.ts']) {
    const code = readFileSync(join(DESKTOP, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\bhelpers?\b|\bteams?\b/i, f); assert.doesNotMatch(code, /terminal|command line|npm run|Math\.random|performance\.now/i, f); assert.doesNotMatch(code, /\bDate\b/, f);
    assert.doesNotMatch(code, /—/, f);
  }
});
