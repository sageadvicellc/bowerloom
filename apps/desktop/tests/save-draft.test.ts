// The draft of the save sheet: one folder's harness, the person's changes kept apart until Save (spec 6.6), the edits they become, and the parts world the
// builder's graph draws from it, so a link drawn on the graph becomes a set-agent edit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_DRAFT, agentPart, draftCount, draftEdits, draftView, partSkill, definitionWorld, linkSkill, removeSkill, setDraftEngines,
} from '../shared/harness/save-draft.js';
import type { DefinitionView } from '../shared/engine/types.js';
import { graphOf } from '../shared/harness/layout.js';

const BASE: DefinitionView = {
  id: 'weekly-report', description: 'Drafts the weekly report.', engines: ['claude-code', 'codex'], instructions: true,
  skills: [{ id: 'check-facts', name: 'check-facts', description: 'Checks each figure.' }, { id: 'draft-outline', name: 'draft-outline', description: 'Outlines it.' }],
  agents: [{ id: 'editor', name: 'editor', description: 'Edits.', skills: [], notes: [] }, { id: 'writer', name: 'writer', description: 'Writes.', skills: ['draft-outline'], notes: [] }],
  sources: [], kits: [],
};

test('an empty draft changes nothing and makes no edit', () => {
  assert.deepEqual(draftEdits(BASE, EMPTY_DRAFT), []);
  assert.equal(draftCount(BASE, EMPTY_DRAFT), 0);
  assert.deepEqual(draftView(BASE, EMPTY_DRAFT), BASE);
});

test('a skill linked to an agent is one set-agent edit with the agent\'s full skill list; linking it back off cancels it', () => {
  const d = linkSkill(BASE, EMPTY_DRAFT, 'editor', 'check-facts', true);
  assert.deepEqual(draftEdits(BASE, d), [{ kind: 'set-agent', id: 'editor', skills: ['check-facts'] }]);
  assert.equal(draftCount(BASE, d), 1);
  assert.deepEqual(draftView(BASE, d).agents[0]!.skills, ['check-facts']);
  // The same link twice is one link.
  assert.deepEqual(linkSkill(BASE, d, 'editor', 'check-facts', true), d);
  assert.deepEqual(draftEdits(BASE, linkSkill(BASE, d, 'editor', 'check-facts', false)), []);
  // An unknown agent or skill changes nothing.
  assert.deepEqual(linkSkill(BASE, EMPTY_DRAFT, 'nobody', 'check-facts', true), EMPTY_DRAFT);
  assert.deepEqual(linkSkill(BASE, EMPTY_DRAFT, 'editor', 'ghost', true), EMPTY_DRAFT);
});

test('a removed skill is one remove-skill edit, after any set-agent, and no agent edit names it', () => {
  let d = linkSkill(BASE, EMPTY_DRAFT, 'editor', 'draft-outline', true);
  d = removeSkill(BASE, d, 'draft-outline', true);
  // Removing the skill unlinks it everywhere: the editor's edit nets out, and the writer loses it through the removal itself.
  assert.deepEqual(draftEdits(BASE, d), [{ kind: 'remove-skill', id: 'draft-outline' }]);
  assert.deepEqual(draftView(BASE, d).skills.map(s => s.id), ['check-facts']);
  assert.deepEqual(draftView(BASE, d).agents.map(a => a.skills), [[], []]);
  d = linkSkill(BASE, d, 'editor', 'check-facts', true);
  assert.deepEqual(draftEdits(BASE, d), [{ kind: 'set-agent', id: 'editor', skills: ['check-facts'] }, { kind: 'remove-skill', id: 'draft-outline' }]);
  // Keeping the skill again brings back the link the draft held for it.
  assert.deepEqual(draftEdits(BASE, removeSkill(BASE, d, 'draft-outline', false)), [{ kind: 'set-agent', id: 'editor', skills: ['draft-outline', 'check-facts'] }]);
  // A removed skill cannot be linked.
  assert.deepEqual(linkSkill(BASE, d, 'writer', 'draft-outline', true), d);
});

test('the interfaces are one set-engines edit in engine order, and only when they differ', () => {
  const d = setDraftEngines(BASE, EMPTY_DRAFT, ['codex']);
  assert.deepEqual(draftEdits(BASE, d), [{ kind: 'set-engines', engines: ['codex'] }]);
  assert.deepEqual(draftEdits(BASE, setDraftEngines(BASE, d, ['codex', 'claude-code'])), []);
  // No interface at all is not a harness: the draft keeps at least one.
  assert.deepEqual(setDraftEngines(BASE, d, []), d);
});

test('the parts world maps the draft onto the builder: agents and skills are parts, the links are the skills each agent uses, and a graph link maps back', () => {
  const d = linkSkill(BASE, EMPTY_DRAFT, 'editor', 'check-facts', true);
  const { state, harness } = definitionWorld(draftView(BASE, d));
  assert.deepEqual(state.parts.map(p => [p.id, p.kind]), [['agent:editor', 'agent'], ['agent:writer', 'agent'], ['skill:check-facts', 'skill'], ['skill:draft-outline', 'skill']]);
  assert.deepEqual(harness.links, [{ from: 'agent:editor', to: 'skill:check-facts' }, { from: 'agent:writer', to: 'skill:draft-outline' }]);
  assert.equal(state.parts.every(p => p.fileText === ''), true, 'no file text reaches the window');
  assert.equal(agentPart('agent:editor'), 'editor'); assert.equal(agentPart('skill:x'), null);
  assert.equal(partSkill('skill:check-facts'), 'check-facts'); assert.equal(partSkill('agent:editor'), null);
  const graph = graphOf(state, harness);
  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.edges.length, 2);
});

test('a new link goes to the end of the agent\'s own list, so a link and its unlink are no change, whatever order the agent keeps', () => {
  const base: DefinitionView = {
    ...BASE,
    skills: [...BASE.skills, { id: 'summarize', name: 'summarize', description: 'Summarizes.' }],
    // The agent keeps its skills in its own order, not the harness's.
    agents: [{ id: 'editor', name: 'editor', description: 'Edits.', skills: ['draft-outline', 'check-facts'], notes: [] }],
  };
  const linked = linkSkill(base, EMPTY_DRAFT, 'editor', 'summarize', true);
  assert.deepEqual(draftEdits(base, linked), [{ kind: 'set-agent', id: 'editor', skills: ['draft-outline', 'check-facts', 'summarize'] }]);
  const back = linkSkill(base, linked, 'editor', 'summarize', false);
  assert.deepEqual(draftEdits(base, back), [], 'link plus unlink is no change');
  assert.deepEqual(back, EMPTY_DRAFT);
});
