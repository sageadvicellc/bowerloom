// The agent tile of the map, rendered to markup: an accent edge, an apps line, a name, a job line, a thin bar of what it holds, and ONE line of plain count buttons. No avatar, no pills, no menu, no open list inside the tile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentCard } from '../renderer/home/kit/AgentCard.js';
import type { AgentCardProps } from '../renderer/home/kit/AgentCard.js';
import { AGENT_ACCENTS, agentAccent, agentCard, ownedAgents, shelvesOf } from '../shared/home/cards.js';
import type { ShelfEntry, Shelves } from '../shared/home/cards.js';
import { generateWorld } from '../shared/proto/sample.js';
import { assertTextBudget } from '../shared/home/textbudget.js';

const world = generateWorld(1);
const agents = ownedAgents(world);
const none = (): void => undefined;
const html = (props: Partial<AgentCardProps> & { shelves?: Shelves } = {}): string => {
  const a = agents.find(x => x.id === 'agent-01')!, words = agentCard(a);
  return renderToStaticMarkup(createElement(AgentCard, { name: words.name, hint: words.hint, shelves: shelvesOf(world, a), selected: false, onSelect: none, dropAgent: a.id, ...props }));
};
const many = (kind: ShelfEntry['kind'], n: number): ShelfEntry[] => Array.from({ length: n }, (_, i) => ({ id: `${kind}-${i}`, kind, name: `Item number ${i + 1}` }));
const counts = (m: string): string[] => [...m.matchAll(/class="kit-count"[^>]*>([^<]+)<\/button>/g)].map(x => x[1]!);

test('the tile has a name, a job line, a bar of what it holds and one line of counts, and nothing else: no avatar, no glyph tile, no menu', () => {
  const m = html();
  assert.match(m, /^<div class="kit-card" data-kind="agent" data-size="tile" data-accent="(blue|green|orange|red)" data-drop-agent="agent-01">/);
  assert.doesNotMatch(m, /kit-tile|kit-avatar|kit-icon|aria-haspopup|ellipsis/, 'no avatar, no icon and no menu button');
  assert.deepEqual([...m.matchAll(/<svg class="([^"]+)"/g)].map(x => x[1]), ['kit-hold-svg'], 'the only drawing is the bar');
  assert.match(m, /<button type="button" class="kit-card-main"[^>]*aria-pressed="false"[^>]*>Meeting assistant<\/button>/);
  assert.match(m, /<p class="kit-hint kit-card-hint"[^>]*>Summarizes meetings and writes replies\.<\/p>/);
  assert.deepEqual(counts(m), ['3 skills', '1 tool', '1 note set']);
  assert.equal([...m.matchAll(/<div class="kit-summary"/g)].length, 1, 'one summary line');
  assert.doesNotMatch(m, /kit-chip|kit-acc|kit-badge|kit-status|kit-tray|<ul/, 'no pills, no open list and no state inside the tile');
  assert.deepEqual(assertTextBudget(m), [], m.slice(0, 200));
});

test('the accent is the same for the same id and is one of four; the tile carries it as data-accent', () => {
  assert.equal(html({ dropAgent: 'agent-01' }).match(/data-accent="(\w+)"/)![1], agentAccent('agent-01'));
  const seen = new Set(agents.map(a => html({ dropAgent: a.id }).match(/data-accent="(\w+)"/)![1]));
  assert.ok([...seen].every(x => (AGENT_ACCENTS as readonly string[]).includes(x!)));
});

test('the bar of what it holds is hidden from a screen reader, has one part for each kind with something in it, and is empty for an agent with nothing', () => {
  const m = html({ shelves: { skills: many('skill', 12), tools: many('tool', 2), notes: many('note', 1) } });
  assert.match(m, /<div class="kit-hold" aria-hidden="true">/);
  assert.deepEqual([...m.matchAll(/class="kit-hold-part" data-kind="(\w+)" x="([\d.]+)" y="0" width="([\d.]+)"/g)].map(x => [x[1], Math.round(Number(x[2])), Math.round(Number(x[3]))]), [['skill', 0, 80], ['tool', 80, 13], ['note', 93, 7]]);
  assert.doesNotMatch(m, /style=/, 'no inline style');
  const some = html({ shelves: { skills: many('skill', 3), tools: [], notes: many('note', 1) } });
  assert.deepEqual([...some.matchAll(/kit-hold-part" data-kind="(\w+)"/g)].map(x => x[1]), ['skill', 'note']);
  const bare = html({ shelves: { skills: [], tools: [], notes: [] } });
  assert.match(bare, /<div class="kit-hold" aria-hidden="true"><\/div>/, 'an empty bar'); assert.doesNotMatch(bare, /kit-hold-part/);
});

test('the apps line shows the apps as plain words joined by hidden dots, names the line for a screen reader, is part of the name\'s description, and is left out when the agent has no apps', () => {
  const m = html({ apps: ['Claude Code', 'Codex'] });
  assert.match(m, /<span class="kit-card-apps" id="([^"]+)" role="list" aria-label="Works with" title="Claude Code, Codex" data-budget="tooltip"><span class="kit-card-app" role="listitem">Claude Code<\/span><span class="kit-card-app-dot" aria-hidden="true"><\/span><span class="kit-card-app" role="listitem">Codex<\/span><\/span>/);
  const appsId = /class="kit-card-apps" id="([^"]+)"/.exec(m)![1]!;
  assert.match(m, new RegExp(`class="kit-card-main"[^>]*aria-describedby="[^"]* ${appsId}"`));
  assert.equal([...m.matchAll(/kit-card-app-dot/g)].length, 1, 'one dot between two apps');
  assert.doesNotMatch(html(), /kit-card-apps/, 'no data, no line');
  // Too many names for one line: the first app and "+2", the whole list as hover text and as the name of the "+2" for a screen reader.
  const long = html({ apps: ['Claude Code', 'Codex', 'OpenCode'] });
  assert.match(long, /title="Claude Code, Codex, OpenCode"/);
  assert.match(long, />Claude Code<\/span>.*<span class="kit-card-app" role="listitem" aria-label="Codex, OpenCode">\+2<\/span>/);
  assert.doesNotMatch(long, />Codex<\/span>/);
  assert.deepEqual(assertTextBudget(m), []);
  // An odd or long app name is text, never markup.
  const odd = html({ apps: ['<b>x</b> & "y"'] });
  assert.doesNotMatch(odd, /<b>/); assert.match(odd, /&lt;b&gt;x&lt;\/b&gt; &amp; &quot;y&quot;/);
});

test('the counts are joined by middle dots that a screen reader skips; a kind with nothing in it is left out; the words are singular or plural to fit', () => {
  const m = html({ shelves: { skills: many('skill', 12), tools: many('tool', 2), notes: many('note', 1) } });
  assert.deepEqual(counts(m), ['12 skills', '2 tools', '1 note set']);
  assert.equal([...m.matchAll(/<span class="kit-sep" aria-hidden="true">·<\/span>/g)].length, 2, 'two dots between three counts');
  const some = html({ shelves: { skills: many('skill', 12), tools: [], notes: many('note', 2) } });
  assert.deepEqual(counts(some), ['12 skills', '2 note sets']);
  assert.equal([...some.matchAll(/kit-sep/g)].length, 1);
  assert.deepEqual(counts(html({ shelves: { skills: many('skill', 1), tools: many('tool', 1), notes: [] } })), ['1 skill', '1 tool']);
  const bare = html({ shelves: { skills: [], tools: [], notes: [] } });
  assert.doesNotMatch(bare, /kit-count|kit-sep/); assert.match(bare, /class="kit-summary"/, 'an agent with nothing keeps an empty line, so its tile is the same size');
});

test('a count is a button with aria-expanded and aria-controls that names its tray; the open one says so', () => {
  const closed = html();
  const buttons = [...closed.matchAll(/<button type="button" class="kit-count" data-kind="(\w+)" aria-expanded="(true|false)" aria-controls="([^"]+)"/g)];
  assert.equal(buttons.length, 3); assert.ok(buttons.every(b => b[2] === 'false'));
  assert.deepEqual(buttons.map(b => b[3]), ['tray-agent-01-skill', 'tray-agent-01-tool', 'tray-agent-01-note']);
  const open = html({ openKind: 'tool' });
  assert.deepEqual([...open.matchAll(/class="kit-count" data-kind="(\w+)" aria-expanded="(true|false)"/g)].map(x => [x[1], x[2]]), [['skill', 'false'], ['tool', 'true'], ['note', 'false']]);
  assert.match(open, /data-tray=""/, 'the tile whose tray is open keeps the accent edge');
  assert.match(closed, /<div class="kit-summary" role="group" aria-labelledby="([^"]+)">/);
  assert.equal(/role="group" aria-labelledby="([^"]+)"/.exec(closed)![1], /class="kit-card-main" id="([^"]+)"/.exec(closed)![1], 'the group is named by the tile\'s own name');
});

test('the keyboard order is the tile, then its counts', () => {
  const order = [...html().matchAll(/<button type="button" class="(kit-card-main|kit-count)[ "]/g)].map(x => x[1]);
  assert.deepEqual(order, ['kit-card-main', 'kit-count', 'kit-count', 'kit-count']);
});

test('the selected agent is highlighted (data-selected, aria-pressed); the owner of a selected item keeps the highlight', () => {
  const self = html({ selected: true });
  assert.match(self, /data-selected=""/); assert.match(self, /aria-pressed="true"/); assert.doesNotMatch(self, /data-owner|aria-current|data-tray/);
  const owner = html({ itemId: 'skill-022' });
  assert.match(owner, /data-owner=""/); assert.doesNotMatch(owner, /data-selected="" data-owner/); assert.match(owner, /aria-pressed="false" aria-current="true"/);
});

test('the tile carries the id of its agent and the tour id, and every sample tile passes the text budget', () => {
  const m = html({ dataTour: 'agent', fresh: true });
  assert.match(m, /data-fresh=""/); assert.match(m, /data-tour="agent"/); assert.match(m, /data-drop-agent="agent-01"/);
  for (const a of agents) {
    const words = agentCard(a);
    const text = renderToStaticMarkup(createElement(AgentCard, { name: words.name, hint: words.hint, shelves: shelvesOf(world, a), selected: false, onSelect: none, dropAgent: a.id }));
    assert.deepEqual(assertTextBudget(text), [], a.id);
  }
});

// ---- Wave C: the tiles of the map are one stop in the Tab order.
test('the tile that is the stop of the grid has its name and its counts in the Tab order; any other tile has none of them (the arrow keys reach it)', () => {
  const stop = html({ tabStop: true }), other = html({ tabStop: false });
  assert.match(stop, /class="kit-card-main"[^>]*tabindex="0"/);
  assert.equal([...stop.matchAll(/class="kit-count"[^>]*tabindex="0"/g)].length, 3);
  assert.match(other, /class="kit-card-main"[^>]*tabindex="-1"/);
  assert.equal([...other.matchAll(/class="kit-count"[^>]*tabindex="-1"/g)].length, 3);
  assert.doesNotMatch(other, /tabindex="0"/);
  assert.match(html(), /class="kit-card-main"[^>]*tabindex="0"/, 'a tile that is told nothing keeps its place in the Tab order (the kit gallery)');
  assert.deepEqual(assertTextBudget(other), []);
});
