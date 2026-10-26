// The details panel, rendered to markup for each kind of selection: the blocks, their headings, the full text, the key that is never shown, and the text budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DetailsPanel } from '../renderer/home/details/DetailsPanel.js';
import type { DetailsPanelProps } from '../renderer/home/details/DetailsPanel.js';
import { detailsOf } from '../shared/home/details.js';
import type { Selected } from '../shared/home/details.js';
import { ownedAgents } from '../shared/home/cards.js';
import { skillTextOf } from '../shared/home/plain-details.js';
import { generateWorld } from '../shared/proto/sample.js';
import { assertTextBudget, extractText } from '../shared/home/textbudget.js';

const world = generateWorld(1);
const agents = ownedAgents(world);
const none = (): void => undefined;
const panel = (selected: Selected | null, extra: Partial<DetailsPanelProps> = {}): string => {
  const el: ReactElement = createElement(DetailsPanel, { details: detailsOf(world, agents, selected), onSelect: none, onRemove: none, onBadgePress: none, onChoose: none, ...extra });
  return renderToStaticMarkup(el);
};
/** The h3 headings, in order (the h2 is the panel's title). */
const headings = (m: string): string[] => [...m.matchAll(/<h3 [^>]*>([^<]*)<\/h3>/g)].map(x => x[1]!);
const within = (m: string): void => assert.deepEqual(assertTextBudget(m), [], m.slice(0, 160));

test('nothing selected: "Pick an agent" and three empty shelves, as before', () => {
  const m = panel(null);
  assert.deepEqual(headings(m), ['Skills', 'Tools', 'Notes']); assert.match(m, /<h2 class="kit-heading" id="hm-panel-title" tabindex="-1">Pick an agent<\/h2>/);
  assert.equal([...m.matchAll(/Nothing here yet\./g)].length, 3); assert.doesNotMatch(m, /Where it works|kit-card/); within(m);
});

test('an agent: the title, its job, where it works, and its three shelves with Remove on every card and Choose notes on the notes', () => {
  const m = panel({ kind: 'agent', id: 'agent-01' });
  assert.deepEqual(headings(m), ['Where it works', 'Skills', 'Tools', 'Notes']);
  assert.match(m, /id="hm-panel-title" tabindex="-1">Meeting assistant<\/h2>/); assert.match(m, /Summarizes meetings and writes replies\./);
  assert.deepEqual([...m.matchAll(/class="dt-chip">([^<]+)</g)].map(x => x[1]), ['Claude Code', 'Codex', 'OpenCode']);
  assert.equal([...m.matchAll(/class="kit-card"/g)].length, 3 + 1 + 1); assert.equal([...m.matchAll(/data-remove=""/g)].length, 5);
  assert.match(m, />Choose notes</); assert.doesNotMatch(m, /kit-card-check|Back to agent/); within(m);
});

test('a skill: what it does, who uses it, where it works, where it came from, a collapsed full text, and Remove from its agent', () => {
  const m = panel({ kind: 'skill', id: 'skill-042', ownerAgentId: 'agent-01' });
  assert.deepEqual(headings(m), ['What it does', 'Used by', 'Where it works', 'Where it came from']);
  assert.match(m, /<h2 class="kit-heading" id="hm-panel-title" tabindex="-1">Summarize a meeting<\/h2>/); assert.match(m, />Skill</);
  assert.match(m, /Turns a long meeting into a few clear points\./);
  assert.deepEqual([...m.matchAll(/class="dt-agent">([^<]+)</g)].map(x => x[1]).sort(), ['Interview notetaker', 'Meeting assistant']);
  assert.match(m, /data-programs=""><li class="dt-chip">Claude Code<\/li><\/ul>/); assert.match(m, /<p>Made by you<\/p>/);
  assert.match(m, /<button[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"[^>]*>Show the full text<\/button>/); assert.doesNotMatch(m, /data-budget="content"/, 'collapsed');
  assert.match(m, />Back to agent</); assert.match(m, />Remove from Meeting assistant</); within(m);
});

test('the full text of a skill is the plain sample text in a block marked as content, and it still passes the budget', () => {
  const m = panel({ kind: 'skill', id: 'skill-042', ownerAgentId: 'agent-01' }, { textOpen: true });
  assert.match(m, /aria-expanded="true"[^>]*>Hide the full text</);
  assert.match(m, /<div class="dt-text" id="[^"]+" role="region" aria-label="Full text" tabindex="0" data-budget="content">/);
  const lines = skillTextOf('skill-042')!.lines;
  assert.deepEqual(extractText(m).filter(p => p.content).map(p => p.text), lines);
  const long = m.replace(lines[0]!, Array.from({ length: 40 }, (_, i) => `word${i}`).join(' '));
  within(long);
});

test('a skill with different copies shows the state as a text button', () => {
  const m = panel({ kind: 'skill', id: 'skill-triple' });
  assert.match(m, /<button type="button" class="kit-status"[^>]*><span class="kit-dot" aria-hidden="true"><\/span><span>3 different copies<\/span>(?:<span class="kit-status-short" aria-hidden="true" data-short="\d+ copies"><\/span>)?<\/button>/);
  assert.doesNotMatch(m, />Back to agent<|>Remove from/, 'with no owner there is no agent to go back to or to remove it from'); within(m);
});

test('a tool: what it can reach, how far it goes, and a key that is missing is a plain line, never a value', () => {
  const m = panel({ kind: 'tool', id: 'tool-mcp-missing', ownerAgentId: 'agent-01' });
  assert.deepEqual(headings(m), ['What it can reach', 'How far it can go', 'Used by']);
  assert.match(m, /<p data-access="">Can change things<\/p>/); assert.match(m, /data-key="missing"[^>]*>[\s\S]*needs a key[\s\S]*<p>Add this key when asked\.<\/p>/);
  assert.doesNotMatch(m, /SEARCH|TOKEN|_KEY|secret/i); assert.doesNotMatch(m, /Runs code/); assert.match(m, />Remove from Meeting assistant</); within(m);
  const ready = panel({ kind: 'tool', id: 'tool-mcp-present', ownerAgentId: 'agent-02' });
  assert.match(ready, /data-key="ready">Its key is ready\.<\/p>/); assert.match(ready, /Can only read/); assert.doesNotMatch(ready, /needs a key/); within(ready);
});

test('a tool that runs code shows the badge', () => {
  const hook = world.items.find(i => i.kind === 'tool' && i.toolKind === 'hook')!;
  const m = panel({ kind: 'tool', id: hook.id }); assert.match(m, /<span>Runs code<\/span>/); within(m);
});

test('a set of notes: what it covers, how many it can read, five titles, who reads it, Choose notes, and Remove', () => {
  const m = panel({ kind: 'note', id: 'slice-folders', ownerAgentId: 'agent-01' });
  assert.deepEqual(headings(m), ['What it covers', 'Some of the notes', 'Used by']);
  assert.match(m, /id="hm-panel-title" tabindex="-1">Client list<\/h2>/); assert.match(m, /\d+ notes it can read\./);
  assert.equal([...m.matchAll(/<li>[^<]+<\/li>/g)].length, 5); assert.match(m, />Choose notes</); assert.match(m, />Remove from Meeting assistant</); within(m);
});

test('every kind of details passes the text budget for every item of the sample', () => {
  for (const a of agents) {
    within(panel({ kind: 'agent', id: a.id }));
    for (const id of a.definition.skillIds) within(panel({ kind: 'skill', id, ownerAgentId: a.id }, { textOpen: true }));
    for (const t of a.definition.toolAttachments) within(panel({ kind: 'tool', id: t.toolId, ownerAgentId: a.id }));
    if (a.definition.sliceId !== undefined) within(panel({ kind: 'note', id: a.definition.sliceId, ownerAgentId: a.id }));
  }
});
