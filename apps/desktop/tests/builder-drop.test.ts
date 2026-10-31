// Drag to link in the Builder: a skill (or a notes card) dropped on an agent links them; any other drag moves the node. The rule is plain geometry on the
// graph's nodes (shared/harness/layout.ts), and the link itself goes through builderAction, so a refused link says why in words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dropLinkTarget, graphOf } from '../shared/harness/layout.js';
import type { GraphNode } from '../shared/harness/layout.js';
import { builderAction } from '../shared/harness/builder-draft.js';
import { EMPTY_DRAFT, definitionWorld } from '../shared/harness/save-draft.js';
import type { DefinitionView } from '../shared/engine/types.js';

const BASE: DefinitionView = {
  id: 'weekly-report', description: 'Drafts the weekly report.', engines: ['claude-code', 'codex'], instructions: true,
  skills: [{ id: 'check-facts', name: 'check-facts', description: 'Checks each figure.' }, { id: 'draft-outline', name: 'draft-outline', description: 'Outlines it.' }],
  agents: [{ id: 'editor', name: 'editor', description: 'Edits.', skills: [], notes: [] }, { id: 'writer', name: 'writer', description: 'Writes.', skills: ['draft-outline'], notes: [] }],
  sources: [{ name: 'reading-list', kind: 'wiki-folder', label: '~/Documents/Reading list', notesId: 'notes-1' }], kits: [],
};
const world = definitionWorld(BASE);
const nodes = graphOf(world.state, world.harness).nodes;
const node = (id: string): GraphNode => nodes.find(n => n.id === id)!;
const middle = (n: GraphNode): { x: number; y: number } => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

test('a skill dropped inside an agent names that agent; the link then goes through builderAction', () => {
  assert.equal(dropLinkTarget(nodes, 'skill:check-facts', middle(node('agent:editor'))), 'agent:editor');
  const linked = builderAction(BASE, EMPTY_DRAFT, { kind: 'link', a: 'skill:check-facts', b: 'agent:editor' });
  assert.equal(linked.ok, true);
  if (linked.ok) assert.deepEqual(linked.draft.agents, { editor: ['check-facts'] });
});

test('a notes card dropped on an agent names the agent too', () => {
  assert.equal(dropLinkTarget(nodes, 'notes:reading-list', middle(node('agent:writer'))), 'agent:writer');
});

test('any other drag moves the node: a skill dropped on empty ground or on another skill, and an agent dropped anywhere', () => {
  const editor = node('agent:editor');
  assert.equal(dropLinkTarget(nodes, 'skill:check-facts', { x: editor.x - 400, y: editor.y - 400 }), null);
  assert.equal(dropLinkTarget(nodes, 'skill:check-facts', middle(node('skill:draft-outline'))), null);
  assert.equal(dropLinkTarget(nodes, 'agent:editor', middle(node('agent:writer'))), null);
  assert.equal(dropLinkTarget(nodes, 'agent:editor', middle(node('skill:check-facts'))), null);
  assert.equal(dropLinkTarget(nodes, 'skill:nothing', middle(editor)), null, 'a node the graph does not draw moves nothing');
});

test('the edge of an agent counts as inside; one pixel past it does not', () => {
  const editor = node('agent:editor');
  assert.equal(dropLinkTarget(nodes, 'skill:check-facts', { x: editor.x, y: editor.y }), 'agent:editor');
  assert.equal(dropLinkTarget(nodes, 'skill:check-facts', { x: editor.x + editor.w, y: editor.y + editor.h }), 'agent:editor');
  assert.equal(dropLinkTarget(nodes, 'skill:check-facts', { x: editor.x + editor.w + 1, y: editor.y }), null);
});

test('a drop that would link what is linked already is refused by builderAction in words, and nothing changes', () => {
  assert.equal(dropLinkTarget(nodes, 'skill:draft-outline', middle(node('agent:writer'))), 'agent:writer');
  const again = builderAction(BASE, EMPTY_DRAFT, { kind: 'link', a: 'skill:draft-outline', b: 'agent:writer' });
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.words, 'That link is there already.');
});
