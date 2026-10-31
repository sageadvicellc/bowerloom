// The Builder's gestures on one folder's harness, as pure logic: each gesture names parts of the graph's world (`agent:`, `skill:`, `notes:`) and becomes a
// call of the save draft, so the Builder saves through the same edits as the save sheet. A gesture beta.1 does not allow is refused in words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDER_REFUSALS, REFUSED_KINDS, builderAction } from '../shared/harness/builder-draft.js';
import type { BuilderAction, BuilderRefusal, BuilderResult } from '../shared/harness/builder-draft.js';
import { COPY_LIMIT, EMPTY_DRAFT, KEEPER_AGENT, KEEPER_KIT, definitionWorld, draftEdits, draftView, notesPartId } from '../shared/harness/save-draft.js';
import type { SaveDraft, SkillCopy } from '../shared/harness/save-draft.js';
import type { DefinitionView, SourceView } from '../shared/engine/types.js';
import { LIMITS, bannedHere, countWords } from '../shared/harness/words.js';

const NOTES: SourceView = { name: 'notes', kind: 'wiki-folder', label: '~/Documents/notes', notesId: 'notes-1' };
const BOOKS: SourceView = { name: 'books', kind: 'wiki-folder', label: '~/Documents/books', notesId: 'notes-2' };
const PAPERS: SourceView = { name: 'papers', kind: 'wiki-folder', label: '~/Documents/papers', notesId: 'notes-3' };
const BASE: DefinitionView = {
  id: 'weekly-report', description: 'Drafts the weekly report.', engines: ['claude-code', 'codex'], instructions: true,
  skills: [{ id: 'check-facts', name: 'check-facts', description: 'Checks each figure.' }, { id: 'draft-outline', name: 'draft-outline', description: 'Outlines it.' }],
  agents: [
    { id: 'editor', name: 'editor', description: 'Edits.', skills: [], notes: [] },
    { id: 'writer', name: 'writer', description: 'Writes.', skills: ['draft-outline'], notes: ['notes'] },
  ],
  sources: [NOTES, BOOKS], kits: [],
};
const KIT_VIEW: DefinitionView = {
  ...BASE,
  skills: [...BASE.skills, { id: 'add-source', name: 'add-source', description: 'Adds a source.' }, { id: 'tidy', name: 'tidy', description: 'Tidies.' }],
  agents: [...BASE.agents, { id: KEEPER_AGENT, name: 'Notes keeper', description: 'Keeps the notes.', skills: ['add-source', 'tidy'], notes: [] }],
  kits: [{ id: KEEPER_KIT, version: '1.0.0', skills: ['add-source', 'tidy'] }],
};
const SUMMARIZE: SkillCopy = { id: 'summarize', from: 'reading', fromLabel: 'reading', name: 'summarize', description: 'Summarizes a page.' };

const run = (action: BuilderAction, draft: SaveDraft = EMPTY_DRAFT, pending: readonly SourceView[] = []): BuilderResult => builderAction(BASE, draft, action, pending);
/** The draft of an allowed gesture; the test fails with the refusal's words when it was refused. */
function ok(result: BuilderResult): SaveDraft {
  if (!result.ok) assert.fail(`refused: ${result.refusal}: ${result.words}`);
  return result.draft;
}
function refused(result: BuilderResult, refusal: BuilderRefusal): void {
  assert.equal(result.ok, false, `expected ${refusal}`);
  if (result.ok) return;
  assert.equal(result.refusal, refusal);
  assert.equal(result.words, BUILDER_REFUSALS[refusal]);
}

// ---- the world ids are the graph's own

test('the gestures take the part ids the graph draws from definitionWorld', () => {
  const ids = definitionWorld(BASE).state.parts.map(p => p.id);
  assert.deepEqual(ids, ['agent:editor', 'agent:writer', 'skill:check-facts', 'skill:draft-outline', 'notes:notes', 'notes:books']);
  const d = ok(run({ kind: 'link', a: 'agent:editor', b: 'skill:check-facts' }));
  assert.deepEqual(draftEdits(BASE, d), [{ kind: 'set-agent', id: 'editor', skills: ['check-facts'] }]);
});

// ---- link and unlink

test('linking an agent to a skill is a set-agent edit with skills, in either order, so a skill dropped on an agent links them', () => {
  const forward = ok(run({ kind: 'link', a: 'agent:editor', b: 'skill:check-facts' }));
  const dropped = ok(run({ kind: 'link', a: 'skill:check-facts', b: 'agent:editor' }));
  assert.deepEqual(dropped, forward);
  const two = ok(run({ kind: 'link', a: 'skill:draft-outline', b: 'agent:editor' }, forward));
  assert.deepEqual(draftEdits(BASE, two), [{ kind: 'set-agent', id: 'editor', skills: ['check-facts', 'draft-outline'] }]);
});

test('linking an agent to a notes card is a set-agent edit with notes; a card the harness does not hold yet adds its source', () => {
  const held = ok(run({ kind: 'link', a: 'agent:editor', b: notesPartId('books') }));
  assert.deepEqual(draftEdits(BASE, held), [{ kind: 'set-agent', id: 'editor', notes: ['books'] }]);
  const fresh = ok(run({ kind: 'link', a: notesPartId('papers'), b: 'agent:editor' }, EMPTY_DRAFT, [PAPERS]));
  assert.deepEqual(draftEdits(BASE, fresh), [{ kind: 'set-source', name: 'papers', notesId: 'notes-3' }, { kind: 'set-agent', id: 'editor', notes: ['papers'] }]);
});

test('unlinking takes the item out of the agent\'s set-agent list, for a skill and for notes', () => {
  const skill = ok(run({ kind: 'unlink', a: 'agent:writer', b: 'skill:draft-outline' }));
  assert.deepEqual(draftEdits(BASE, skill), [{ kind: 'set-agent', id: 'writer', skills: [] }]);
  const notes = ok(run({ kind: 'unlink', a: notesPartId('notes'), b: 'agent:writer' }));
  assert.deepEqual(draftEdits(BASE, notes), [{ kind: 'set-agent', id: 'writer', notes: [] }]);
  // A link made in the draft and unlinked again is no edit at all.
  const linked = ok(run({ kind: 'link', a: 'agent:editor', b: 'skill:check-facts' }));
  assert.deepEqual(draftEdits(BASE, ok(run({ kind: 'unlink', a: 'agent:editor', b: 'skill:check-facts' }, linked))), []);
});

test('a link that is there already, or an unlink of no link, is refused in words and the draft stays', () => {
  refused(run({ kind: 'link', a: 'agent:writer', b: 'skill:draft-outline' }), 'linked-already');
  refused(run({ kind: 'link', a: 'agent:writer', b: notesPartId('notes') }), 'linked-already');
  refused(run({ kind: 'unlink', a: 'agent:editor', b: 'skill:check-facts' }), 'not-linked');
  refused(run({ kind: 'unlink', a: 'agent:editor', b: notesPartId('books') }), 'not-linked');
});

test('a link needs one agent: two agents, or two parts that are not agents, are refused', () => {
  refused(run({ kind: 'link', a: 'agent:editor', b: 'agent:writer' }), 'agent-to-agent');
  refused(run({ kind: 'link', a: 'skill:check-facts', b: 'skill:draft-outline' }), 'no-agent');
  refused(run({ kind: 'link', a: 'skill:check-facts', b: notesPartId('notes') }), 'no-agent');
  refused(run({ kind: 'unlink', a: 'agent:editor', b: 'agent:writer' }), 'agent-to-agent');
});

test('a link to a part the harness does not hold is refused: an unknown agent, skill or card, or a tool', () => {
  refused(run({ kind: 'link', a: 'agent:nobody', b: 'skill:check-facts' }), 'unknown-part');
  refused(run({ kind: 'link', a: 'agent:editor', b: 'skill:ghost' }), 'unknown-part');
  refused(run({ kind: 'link', a: 'agent:editor', b: notesPartId('papers') }), 'unknown-part');
  refused(run({ kind: 'link', a: 'agent:editor', b: 'tool:web-search' }), 'unknown-part');
  refused(run({ kind: 'link', a: 'agent:editor', b: '' }), 'unknown-part');
});

test('a skill marked for removal, or notes the draft stops using, take no new link', () => {
  const gone = ok(run({ kind: 'remove', part: 'skill:check-facts' }));
  refused(run({ kind: 'link', a: 'agent:editor', b: 'skill:check-facts' }, gone), 'removed-skill');
  const stopped = ok(run({ kind: 'remove', part: notesPartId('books') }));
  refused(run({ kind: 'link', a: 'agent:editor', b: notesPartId('books') }, stopped), 'stopped-notes');
});

test('a skill copied into the draft can be linked like the harness\'s own', () => {
  const copied = ok(run({ kind: 'copy-skill', copy: SUMMARIZE }));
  const linked = ok(run({ kind: 'link', a: 'skill:summarize', b: 'agent:editor' }, copied));
  assert.deepEqual(draftEdits(BASE, linked), [{ kind: 'add-skill', id: 'summarize', from: 'reading' }, { kind: 'set-agent', id: 'editor', skills: ['summarize'] }]);
});

// ---- remove and keep

test('removing a skill is a remove-skill edit, which unlinks it everywhere; keep puts it back', () => {
  const d = ok(run({ kind: 'remove', part: 'skill:draft-outline' }));
  assert.deepEqual(draftEdits(BASE, d), [{ kind: 'remove-skill', id: 'draft-outline' }]);
  assert.deepEqual(draftView(BASE, d).agents.find(a => a.id === 'writer')!.skills, []);
  assert.deepEqual(draftEdits(BASE, ok(run({ kind: 'keep', part: 'skill:draft-outline' }, d))), []);
  refused(run({ kind: 'remove', part: 'skill:draft-outline' }, d), 'no-change');
  refused(run({ kind: 'keep', part: 'skill:draft-outline' }), 'no-change');
});

test('removing a copied skill takes the copy out of the draft, with its links', () => {
  const linked = ok(run({ kind: 'link', a: 'skill:summarize', b: 'agent:editor' }, ok(run({ kind: 'copy-skill', copy: SUMMARIZE }))));
  assert.deepEqual(draftEdits(BASE, ok(run({ kind: 'remove', part: 'skill:summarize' }, linked))), []);
});

test('removing saved notes is a remove-source edit; keep uses them again', () => {
  const d = ok(run({ kind: 'remove', part: notesPartId('notes') }));
  assert.deepEqual(draftEdits(BASE, d), [{ kind: 'remove-source', name: 'notes' }]);
  assert.deepEqual(draftEdits(BASE, ok(run({ kind: 'keep', part: notesPartId('notes') }, d))), []);
  refused(run({ kind: 'keep', part: notesPartId('books') }), 'no-change');
});

test('removing notes the draft added takes them off every agent, and their source goes with them', () => {
  let d = ok(run({ kind: 'link', a: 'agent:editor', b: notesPartId('papers') }, EMPTY_DRAFT, [PAPERS]));
  d = ok(run({ kind: 'link', a: 'agent:writer', b: notesPartId('papers') }, d, [PAPERS]));
  assert.equal(draftEdits(BASE, d).length, 3);
  assert.deepEqual(draftEdits(BASE, ok(run({ kind: 'remove', part: notesPartId('papers') }, d))), []);
});

test('removing a part the harness does not hold is refused', () => {
  refused(run({ kind: 'remove', part: 'skill:ghost' }), 'unknown-part');
  refused(run({ kind: 'remove', part: notesPartId('papers') }, EMPTY_DRAFT, [PAPERS]), 'unknown-part');
  refused(run({ kind: 'keep', part: 'agent:editor' }), 'no-change');
  refused(run({ kind: 'remove', part: 'agent:nobody' }), 'unknown-part');
});

// ---- the Notes keeper

test('adding the Notes keeper keeps main\'s plan with the kit, and is an add-from-kit edit', () => {
  const d = ok(run({ kind: 'add-keeper', view: KIT_VIEW }));
  assert.deepEqual(draftEdits(BASE, d), [{ kind: 'add-from-kit', kit: KEEPER_KIT }, { kind: 'set-agent', id: KEEPER_AGENT, skills: [] }]);
  refused(run({ kind: 'add-keeper', view: KIT_VIEW }, d), 'keeper-here');
  // A plan that does not bring the keeper changes nothing.
  refused(run({ kind: 'add-keeper', view: BASE }), 'keeper-not-added');
});

test('a keeper added in this draft can be taken out again, which removes the whole kit; a saved agent cannot', () => {
  const d = ok(run({ kind: 'link', a: 'agent:notes-keeper', b: 'skill:add-source' }, ok(run({ kind: 'add-keeper', view: KIT_VIEW }))));
  assert.deepEqual(draftEdits(BASE, ok(run({ kind: 'remove', part: `agent:${KEEPER_AGENT}` }, d))), []);
  refused(run({ kind: 'remove', part: 'agent:writer' }, d), 'remove-agent');
});

// ---- notes, copies and interfaces

test('adding notes from the Notes shelf puts a card on the agent, as set-source and set-agent', () => {
  const d = ok(run({ kind: 'add-notes', agent: 'agent:editor', source: PAPERS }));
  assert.deepEqual(draftEdits(BASE, d), [{ kind: 'set-source', name: 'papers', notesId: 'notes-3' }, { kind: 'set-agent', id: 'editor', notes: ['papers'] }]);
  refused(run({ kind: 'add-notes', agent: 'agent:writer', source: NOTES }), 'linked-already');
  refused(run({ kind: 'add-notes', agent: 'skill:check-facts', source: PAPERS }), 'no-agent');
  refused(run({ kind: 'add-notes', agent: 'agent:nobody', source: PAPERS }), 'unknown-part');
});

test('copying a skill from another folder is an add-skill edit; one the harness holds, or one past the limit, is refused', () => {
  const d = ok(run({ kind: 'copy-skill', copy: SUMMARIZE }));
  assert.deepEqual(draftEdits(BASE, d), [{ kind: 'add-skill', id: 'summarize', from: 'reading' }]);
  refused(run({ kind: 'copy-skill', copy: SUMMARIZE }, d), 'skill-here');
  refused(run({ kind: 'copy-skill', copy: { ...SUMMARIZE, id: 'check-facts' } }), 'skill-here');
  let full = EMPTY_DRAFT;
  for (let n = 0; n < COPY_LIMIT; n += 1) full = ok(run({ kind: 'copy-skill', copy: { ...SUMMARIZE, id: `copy-${n}` } }, full));
  refused(run({ kind: 'copy-skill', copy: SUMMARIZE }, full), 'copy-limit');
});

test('a copy from this same folder is refused: the skill is here already', () => {
  refused(run({ kind: 'copy-skill', copy: { ...SUMMARIZE, from: BASE.id } }), 'same-folder');
});

test('the interfaces are a set-engines edit; none at all, or the same ones, are refused', () => {
  const d = ok(run({ kind: 'set-engines', engines: ['codex'] }));
  assert.deepEqual(draftEdits(BASE, d), [{ kind: 'set-engines', engines: ['codex'] }]);
  refused(run({ kind: 'set-engines', engines: [] }), 'last-interface');
  refused(run({ kind: 'set-engines', engines: ['codex', 'claude-code'] }), 'no-change');
});

// ---- refused in beta.1

test('every gesture beta.1 does not allow is refused in words, and the draft stays as it was', () => {
  const d = ok(run({ kind: 'link', a: 'agent:editor', b: 'skill:check-facts' }));
  const cases: readonly [BuilderAction, BuilderRefusal][] = [
    [{ kind: 'new-harness' }, 'new-harness'],
    [{ kind: 'harness-from-scan' }, 'harness-from-scan'],
    [{ kind: 'rename', name: 'Weekly crew' }, 'rename'],
    [{ kind: 'move', part: 'skill:check-facts', toFolder: 'reading' }, 'move-between-folders'],
    [{ kind: 'add-part', part: 'agent' }, 'add-agent'],
    [{ kind: 'add-part', part: 'tool' }, 'add-tool'],
    [{ kind: 'remove', part: 'agent:editor' }, 'remove-agent'],
    [{ kind: 'remove', part: 'tool:web-search' }, 'remove-tool'],
    [{ kind: 'second-harness' }, 'second-harness'],
  ];
  for (const [action, refusal] of cases) {
    const result = builderAction(BASE, d, action);
    refused(result, refusal);
  }
  assert.deepEqual(draftEdits(BASE, d), [{ kind: 'set-agent', id: 'editor', skills: ['check-facts'] }]);
  assert.deepEqual([...REFUSED_KINDS].sort(), ['add-part', 'harness-from-scan', 'move', 'new-harness', 'rename', 'second-harness']);
});

test('New harness and a harness from a scan open the sheet that makes a harness from a folder; no other refusal opens anything', () => {
  for (const kind of ['new-harness', 'harness-from-scan'] as const) {
    const r = run({ kind });
    assert.ok(!r.ok && r.opens === 'from-folder', kind);
  }
  for (const action of [{ kind: 'rename', name: 'x' }, { kind: 'second-harness' }, { kind: 'add-part', part: 'agent' }, { kind: 'link', a: 'agent:editor', b: 'agent:writer' }] as const) {
    const r = run(action);
    assert.ok(!r.ok && r.opens === null, action.kind);
  }
});

test('a move between folders points at copying the skill instead', () => {
  const r = run({ kind: 'move', part: 'skill:check-facts', toFolder: 'reading' });
  assert.ok(!r.ok && /copy/i.test(r.words), 'the words name the copy');
});

// ---- the words

test('every refusal has words: a short line, plain, with no banned word, ending in a full stop', () => {
  const codes = Object.keys(BUILDER_REFUSALS) as BuilderRefusal[];
  assert.ok(codes.length >= 20);
  for (const code of codes) {
    const words = BUILDER_REFUSALS[code];
    assert.ok(words.length > 0, code);
    assert.ok(countWords(words) <= LIMITS.hint, `${code}: ${words}`);
    assert.equal(bannedHere(words), null, `${code}: ${words}`);
    assert.match(words, /\.$/, code);
    assert.doesNotMatch(words, /\/Users\/|~\//, 'no path');
  }
  assert.ok(Object.isFrozen(BUILDER_REFUSALS));
  assert.match(BUILDER_REFUSALS['copy-limit'], new RegExp(String(COPY_LIMIT)));
});

// ---- purity

test('a gesture never changes the base or the draft it is given, and a refused one hands back no draft', () => {
  const base = structuredClone(BASE), draft = ok(run({ kind: 'link', a: 'agent:editor', b: 'skill:check-facts' }));
  const before = structuredClone(draft);
  for (const action of [
    { kind: 'link', a: 'agent:editor', b: 'skill:draft-outline' }, { kind: 'remove', part: 'skill:check-facts' }, { kind: 'remove', part: notesPartId('notes') },
    { kind: 'set-engines', engines: ['codex'] }, { kind: 'copy-skill', copy: SUMMARIZE }, { kind: 'new-harness' },
  ] as const satisfies readonly BuilderAction[]) {
    const r = builderAction(base, draft, action);
    if (!r.ok) assert.equal('draft' in r, false);
  }
  assert.deepEqual(base, BASE);
  assert.deepEqual(draft, before);
});

test('a large harness: linking 200 of its 2,000 skills to one agent, one by one, stays exact and in order', () => {
  const skills = Array.from({ length: 2000 }, (_, n) => ({ id: `s-${n}`, name: `s-${n}`, description: '' }));
  const big: DefinitionView = { ...BASE, skills, agents: [{ id: 'one', name: 'one', description: '', skills: [], notes: [] }], sources: [] };
  let d = EMPTY_DRAFT;
  for (const s of skills.slice(0, 200)) {
    const r = builderAction(big, d, { kind: 'link', a: `skill:${s.id}`, b: 'agent:one' });
    assert.ok(r.ok);
    d = r.draft;
  }
  assert.deepEqual(draftEdits(big, d), [{ kind: 'set-agent', id: 'one', skills: skills.slice(0, 200).map(s => s.id) }]);
});

test('ids with odd characters are matched exactly, never as patterns', () => {
  const odd: DefinitionView = { ...BASE, skills: [...BASE.skills, { id: 'a.b*c', name: 'a.b*c', description: '' }, { id: 'café-☕', name: 'café-☕', description: '' }] };
  const r = builderAction(odd, EMPTY_DRAFT, { kind: 'link', a: 'agent:editor', b: 'skill:café-☕' });
  assert.ok(r.ok);
  assert.deepEqual(draftEdits(odd, r.draft), [{ kind: 'set-agent', id: 'editor', skills: ['café-☕'] }]);
  const star = builderAction(odd, EMPTY_DRAFT, { kind: 'link', a: 'agent:editor', b: 'skill:aXb*c' });
  assert.ok(!star.ok);
});
