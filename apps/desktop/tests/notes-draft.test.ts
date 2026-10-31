// The save draft with notes and the ready-made Notes keeper (spec 6.9, first five minutes section 4 steps 4 and 5): the keeper is added from the kit as a
// draft and starts with no skill linked, the first skill is linked by a drag (or its button), one button links the rest, and a notes card goes on the
// keeper's Notes shelf as set-source plus set-agent notes. Nothing leaves the draft until Save: these are the closed edits main takes, in its order.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_DRAFT, KEEPER_AGENT, KEEPER_FIRST_SKILL, KEEPER_KIT, addKit, attachNotes, definitionWorld, draftCount, draftEdits, draftView, keeperOf, keeperSkills,
  linkRest, linkSkill, partNotes, removeKit, removeSkill, sourceFor,
} from '../shared/harness/save-draft.js';
import type { DefinitionView, SourceView } from '../shared/engine/types.js';
import { graphOf } from '../shared/harness/layout.js';

const KIT_SKILLS = ['add-source', 'file-page', 'answer-from-notes', 'check-notes', 'log-change', 'refine-report'];
const BASE: DefinitionView = {
  id: 'weekly-report', description: 'Drafts the weekly report.', engines: ['claude-code', 'codex'], instructions: true,
  skills: [{ id: 'check-facts', name: 'check-facts', description: 'Checks each figure.' }, { id: 'draft-outline', name: 'draft-outline', description: 'Outlines it.' }],
  agents: [{ id: 'editor', name: 'editor', description: 'Edits.', skills: [], notes: [] }, { id: 'writer', name: 'writer', description: 'Writes.', skills: ['draft-outline'], notes: [] }],
  sources: [], kits: [],
};
/** The harness as main plans it with the kit added: the kit's agent with all six skills, and the kit's skills, in id order. */
const WITH_KIT: DefinitionView = {
  ...BASE,
  skills: [...BASE.skills, ...KIT_SKILLS.map(id => ({ id, name: id, description: `${id} words.` }))].sort((a, b) => a.id.localeCompare(b.id)),
  agents: [...BASE.agents, { id: KEEPER_AGENT, name: KEEPER_AGENT, description: 'Looks after a folder of notes.', skills: KIT_SKILLS, notes: [] }].sort((a, b) => a.id.localeCompare(b.id)),
  kits: [{ id: KEEPER_KIT, version: '0.1.0', skills: [...KIT_SKILLS].sort() }],
};
const GARDEN: SourceView = { name: 'garden-notes', kind: 'wiki-folder', label: '~/Documents/Garden notes', notesId: 'n1' };

test('the keeper comes from the kit as one add-from-kit edit, and starts with no skill linked', () => {
  const d = addKit(BASE, EMPTY_DRAFT, WITH_KIT);
  assert.deepEqual(draftEdits(BASE, d), [{ kind: 'add-from-kit', kit: KEEPER_KIT }, { kind: 'set-agent', id: KEEPER_AGENT, skills: [] }]);
  assert.equal(draftCount(BASE, d), 2);
  const now = draftView(BASE, d);
  assert.deepEqual(keeperOf(now)?.skills, []);
  assert.deepEqual(now.kits, [{ id: KEEPER_KIT, version: '0.1.0', skills: [...KIT_SKILLS].sort() }]);
  assert.deepEqual(keeperSkills(BASE, d), KIT_SKILLS, 'the kit\'s own order, for the shelf');
  // Adding it twice is one add; a harness that holds the kit already takes none.
  assert.deepEqual(addKit(BASE, d, WITH_KIT), d);
  assert.deepEqual(addKit(WITH_KIT, EMPTY_DRAFT, WITH_KIT), EMPTY_DRAFT);
  // A kit view that lost an item of the harness is not the harness plus the kit: the draft stays as it was.
  assert.deepEqual(addKit(BASE, EMPTY_DRAFT, { ...WITH_KIT, agents: WITH_KIT.agents.filter(a => a.id !== 'editor') }), EMPTY_DRAFT);
});

test('the storyboard: the first skill is linked on its own, then one button links the rest in the kit\'s order, so the keeper ends as the kit made it', () => {
  let d = addKit(BASE, EMPTY_DRAFT, WITH_KIT);
  d = linkSkill(BASE, d, KEEPER_AGENT, KEEPER_FIRST_SKILL, true);
  assert.deepEqual(keeperOf(draftView(BASE, d))?.skills, ['add-source']);
  assert.deepEqual(draftEdits(BASE, d)[1], { kind: 'set-agent', id: KEEPER_AGENT, skills: ['add-source'] });
  d = linkRest(BASE, d, KEEPER_AGENT, keeperSkills(BASE, d));
  assert.deepEqual(keeperOf(draftView(BASE, d))?.skills, KIT_SKILLS);
  // All six in the kit's order is the kit as it ships: no set-agent edit is left, only the add.
  assert.deepEqual(draftEdits(BASE, d), [{ kind: 'add-from-kit', kit: KEEPER_KIT }]);
  // The rest, pressed before any drag, links all six too.
  assert.deepEqual(keeperOf(draftView(BASE, linkRest(BASE, addKit(BASE, EMPTY_DRAFT, WITH_KIT), KEEPER_AGENT, KIT_SKILLS)))?.skills, KIT_SKILLS);
});

test('a notes card on the keeper\'s Notes shelf is set-source then set-agent notes; taking it off drops both', () => {
  let d = addKit(BASE, EMPTY_DRAFT, WITH_KIT);
  d = linkRest(BASE, d, KEEPER_AGENT, KIT_SKILLS);
  d = attachNotes(BASE, d, KEEPER_AGENT, GARDEN, true);
  assert.deepEqual(draftEdits(BASE, d), [
    { kind: 'add-from-kit', kit: KEEPER_KIT },
    { kind: 'set-source', name: 'garden-notes', notesId: 'n1' },
    { kind: 'set-agent', id: KEEPER_AGENT, notes: ['garden-notes'] },
  ]);
  const now = draftView(BASE, d);
  assert.deepEqual(now.sources, [GARDEN]);
  assert.deepEqual(keeperOf(now)?.notes, ['garden-notes']);
  // The same card twice is one attach.
  assert.deepEqual(attachNotes(BASE, d, KEEPER_AGENT, GARDEN, true), d);
  // Off again: no agent reads it, so the source the draft added goes too.
  const off = attachNotes(BASE, d, KEEPER_AGENT, GARDEN, false);
  assert.deepEqual(draftEdits(BASE, off), [{ kind: 'add-from-kit', kit: KEEPER_KIT }]);
  assert.deepEqual(draftView(BASE, off).sources, []);
});

test('notes attach to any agent, and a second agent on the same notes adds no second source', () => {
  let d = attachNotes(BASE, EMPTY_DRAFT, 'editor', GARDEN, true);
  d = attachNotes(BASE, d, 'writer', GARDEN, true);
  assert.deepEqual(draftEdits(BASE, d), [
    { kind: 'set-source', name: 'garden-notes', notesId: 'n1' },
    { kind: 'set-agent', id: 'editor', notes: ['garden-notes'] },
    { kind: 'set-agent', id: 'writer', notes: ['garden-notes'] },
  ]);
  // One agent lets go: the source stays, because the other still reads it.
  assert.deepEqual(draftView(BASE, attachNotes(BASE, d, 'editor', GARDEN, false)).sources, [GARDEN]);
  // An unknown agent changes nothing.
  assert.deepEqual(attachNotes(BASE, EMPTY_DRAFT, 'nobody', GARDEN, true), EMPTY_DRAFT);
});

test('a source the harness holds already is attached by its own name, with no set-source', () => {
  const saved: DefinitionView = { ...BASE, sources: [GARDEN] };
  const d = attachNotes(saved, EMPTY_DRAFT, 'editor', { ...GARDEN, name: 'other-name' }, true);
  assert.deepEqual(draftEdits(saved, d), [{ kind: 'set-agent', id: 'editor', notes: ['garden-notes'] }]);
});

test('sourceFor names a chosen folder: its own source when held, its suggested name when free, and a new name when that name is taken', () => {
  const view = { ...BASE, sources: [GARDEN] };
  assert.deepEqual(sourceFor(view, { id: 'n1', label: '~/Documents/Garden notes', suggestedName: 'garden-notes' }), GARDEN);
  assert.deepEqual(sourceFor(BASE, { id: 'n2', label: '~/Notes', suggestedName: 'notes' }), { name: 'notes', kind: 'wiki-folder', label: '~/Notes', notesId: 'n2' });
  assert.equal(sourceFor(view, { id: 'n3', label: '~/Other/Garden notes', suggestedName: 'garden-notes' }).name, 'garden-notes-2');
});

test('removing the kit takes back the add and every edit of its agent and skills', () => {
  let d = addKit(BASE, EMPTY_DRAFT, WITH_KIT);
  d = linkSkill(BASE, d, KEEPER_AGENT, KEEPER_FIRST_SKILL, true);
  d = attachNotes(BASE, d, KEEPER_AGENT, GARDEN, true);
  d = linkSkill(BASE, d, 'editor', 'check-facts', true);
  d = removeSkill(BASE, d, 'refine-report', true);
  const back = removeKit(BASE, d);
  assert.deepEqual(draftEdits(BASE, back), [{ kind: 'set-agent', id: 'editor', skills: ['check-facts'] }]);
});

test('a removed kit skill leaves the keeper\'s shelf and the edits keep main\'s order: kit, sources, agents, removals', () => {
  let d = addKit(BASE, EMPTY_DRAFT, WITH_KIT);
  d = linkRest(BASE, d, KEEPER_AGENT, KIT_SKILLS);
  d = removeSkill(BASE, d, 'refine-report', true);
  d = attachNotes(BASE, d, KEEPER_AGENT, GARDEN, true);
  assert.deepEqual(draftEdits(BASE, d).map(e => e.kind), ['add-from-kit', 'set-source', 'set-agent', 'remove-skill']);
  assert.deepEqual(keeperOf(draftView(BASE, d))?.skills, KIT_SKILLS.filter(s => s !== 'refine-report'));
});

test('the map shows the notes as a card beside the agents: a part of its own, linked to each agent that reads it, and a graph link maps back', () => {
  const d = attachNotes(BASE, EMPTY_DRAFT, 'editor', GARDEN, true);
  const pending: SourceView = { name: 'notes', kind: 'wiki-folder', label: '~/Notes', notesId: 'n2' };
  const { state, harness } = definitionWorld(draftView(BASE, d), [pending]);
  const notesParts = state.parts.filter(p => p.kind === 'context');
  assert.deepEqual(notesParts.map(p => p.id), ['notes:garden-notes', 'notes:notes']);
  assert.ok(notesParts.every(p => !p.path.startsWith('~') && !p.summary.includes('~')), 'a path is never a label');
  assert.ok(harness.links.some(l => l.from === 'agent:editor' && l.to === 'notes:garden-notes'));
  assert.equal(partNotes('notes:garden-notes'), 'garden-notes');
  assert.equal(partNotes('skill:x'), null);
  assert.equal(graphOf(state, harness).nodes.length, 6);
});

test('a saved keeper is offered every skill of its kit record that the harness holds, not only the ones it uses, minus the ones removed', () => {
  // The keeper was saved with one skill linked; the kit's record names all six, and the harness holds all six.
  const saved: DefinitionView = { ...WITH_KIT, agents: WITH_KIT.agents.map(a => (a.id === KEEPER_AGENT ? { ...a, skills: ['add-source'] } : a)) };
  const offered = keeperSkills(saved, EMPTY_DRAFT);
  assert.deepEqual([...offered].sort(), [...KIT_SKILLS].sort());
  assert.equal(offered[0], 'add-source', 'the skills the keeper uses come first');
  // A skill removed in the draft is not offered; nor is one the record names that the harness no longer holds.
  assert.equal(keeperSkills(saved, removeSkill(saved, EMPTY_DRAFT, 'check-notes', true)).includes('check-notes'), false);
  const gone: DefinitionView = { ...saved, skills: saved.skills.filter(s => s.id !== 'log-change') };
  assert.equal(keeperSkills(gone, EMPTY_DRAFT).includes('log-change'), false);
  // With no kit record, the keeper's own skills are the offer.
  assert.deepEqual(keeperSkills({ ...saved, kits: [] }, EMPTY_DRAFT), ['add-source']);
  // "Add the other skills" then links the rest.
  const d = linkRest(saved, EMPTY_DRAFT, KEEPER_AGENT, offered);
  assert.equal(keeperOf(draftView(saved, d))?.skills.length, KIT_SKILLS.length);
});
