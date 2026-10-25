// The agent card of the map, rendered to markup: the glyph tile, the count chips, the mini accordions, and the rules that keep them reachable and honest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentCard, LIST_LIMIT } from '../renderer/home/kit/AgentCard.js';
import type { AgentCardProps } from '../renderer/home/kit/AgentCard.js';
import { agentCard, ownedAgents, shelvesOf } from '../shared/home/cards.js';
import type { ShelfEntry, Shelves } from '../shared/home/cards.js';
import { generateWorld } from '../shared/proto/sample.js';
import { assertTextBudget } from '../shared/home/textbudget.js';

const world = generateWorld(1);
const agents = ownedAgents(world);
const none = (): void => undefined;
const html = (props: Partial<AgentCardProps> & { shelves?: Shelves } = {}): string => {
  const a = agents.find(x => x.id === 'agent-01')!, words = agentCard(a);
  return renderToStaticMarkup(createElement(AgentCard, { name: words.name, hint: words.hint, shelves: shelvesOf(world, a), selected: false, onSelect: none, onSelectItem: none, dropAgent: a.id, ...props }));
};
const many = (kind: ShelfEntry['kind'], n: number): ShelfEntry[] => Array.from({ length: n }, (_, i) => ({ id: `${kind}-${i}`, kind, name: `Item number ${i + 1}` }));
const tagsOf = (m: string): string[] => [...m.matchAll(/class="(kit-card-main|kit-chip|kit-acc-main|kit-acc-more|kit-badge)[ "]/g)].map(x => x[1]!);

test('the agent card has a glyph tile, a name, a job line, and a count chip for each kind it holds', () => {
  const m = html();
  assert.match(m, /^<div class="kit-card" data-kind="agent" data-size="large" data-drop-agent="agent-01">/);
  assert.match(m, /<span class="kit-tile" data-size="large" aria-hidden="true"><svg/); assert.doesNotMatch(m, /kit-avatar/);
  assert.match(m, /<button type="button" class="kit-card-main"[^>]*aria-pressed="false"[^>]*>Meeting assistant<\/button>/);
  assert.match(m, /<p class="kit-hint kit-card-hint"[^>]*>Summarizes meetings and writes replies\.<\/p>/);
  assert.deepEqual([...m.matchAll(/class="kit-chip"[^>]*><span>([^<]+)<\/span>/g)].map(x => x[1]), ['3 skills', '1 tool', '1 notes set']);
  assert.doesNotMatch(m, /kit-card-check/);
  assert.deepEqual(assertTextBudget(m), [], m.slice(0, 200));
});

test('a kind with nothing in it has no chip; an agent with nothing has no chip row at all', () => {
  const some = html({ shelves: { skills: many('skill', 12), tools: [], notes: many('note', 1) } });
  assert.deepEqual([...some.matchAll(/class="kit-chip"[^>]*><span>([^<]+)<\/span>/g)].map(x => x[1]), ['12 skills', '1 notes set']);
  assert.equal([...some.matchAll(/class="kit-acc"/g)].length, 2, 'a list for each chip, and none for the tools');
  const bare = html({ shelves: { skills: [], tools: [], notes: [] } });
  assert.doesNotMatch(bare, /kit-chip|kit-acc|kit-chips/);
  const singular = html({ shelves: { skills: many('skill', 1), tools: many('tool', 1), notes: [] } });
  assert.match(singular, /<span>1 skill<\/span>/); assert.match(singular, /<span>1 tool<\/span>/);
});

test('a chip is a button with aria-expanded, and aria-controls names the list it opens; the lists are closed and cannot be reached until opened', () => {
  const m = html();
  const chips = [...m.matchAll(/<button type="button" class="kit-chip" data-kind="(\w+)" aria-expanded="(true|false)" aria-controls="([^"]+)"/g)];
  assert.equal(chips.length, 3); assert.ok(chips.every(c => c[2] === 'false'));
  for (const c of chips) assert.match(m, new RegExp(`<div class="kit-acc" id="${c[3]!.replace(/[:]/g, '\\$&')}" data-kind="${c[1]}" inert="">`), `the list ${c[1]} is closed and inert`);
  assert.match(m, /<div class="kit-chips" role="group" aria-labelledby="([^"]+)">/);
  const group = /role="group" aria-labelledby="([^"]+)"/.exec(m)![1], name = /class="kit-card-main" id="([^"]+)"/.exec(m)![1];
  assert.equal(group, name, 'the group is named by the card\'s own name');
});

test('an open list shows the names of the items, one to a line, as buttons, and is not inert; several can be open at once', () => {
  const m = html({ defaultOpen: ['skill', 'tool'] });
  const open = [...m.matchAll(/<div class="kit-acc" id="[^"]+" data-kind="(\w+)" data-open=""( inert="")?>/g)];
  assert.deepEqual(open.map(o => [o[1], o[2] === undefined]), [['skill', true], ['tool', true]]);
  assert.match(m, /<div class="kit-acc" id="[^"]+" data-kind="note" inert="">/, 'the notes list stays closed');
  assert.deepEqual([...m.matchAll(/<button type="button" class="kit-acc-main" aria-pressed="false"><svg[^>]*>[\s\S]*?<\/svg><span class="kit-acc-name">([^<]+)<\/span>/g)].map(x => x[1]).slice(0, 3), ['Summarize a meeting', 'Write a reply', 'List action items']);
  assert.deepEqual([...m.matchAll(/class="kit-chip" data-kind="(\w+)" aria-expanded="(true|false)"/g)].map(x => [x[1], x[2]]), [['skill', 'true'], ['tool', 'true'], ['note', 'false']], 'a chip says whether its list is open');
});

test('the keyboard order is the card, then its chips, then the lines of its lists', () => {
  const m = html({ defaultOpen: ['skill', 'tool', 'note'] });
  const order = tagsOf(m);
  assert.equal(order[0], 'kit-card-main');
  assert.deepEqual(order.slice(1, 4), ['kit-chip', 'kit-chip', 'kit-chip']);
  assert.ok(order.slice(4).every(t => t === 'kit-acc-main' || t === 'kit-badge' || t === 'kit-acc-more'));
  assert.equal(order.filter(t => t === 'kit-acc-main').length, 3 + 1 + 1);
});

test('a list shows the first six lines and a "Show more" button that says what it shows more of; expanded it says "Show less"', () => {
  const m = html({ shelves: { skills: many('skill', 9), tools: [], notes: [] }, defaultOpen: ['skill'] });
  assert.equal(LIST_LIMIT, 6); assert.equal([...m.matchAll(/class="kit-acc-main"/g)].length, 6);
  assert.match(m, /<button type="button" class="kit-acc-more" aria-expanded="false" aria-label="Show more skills">Show more<\/button>/);
  const six = html({ shelves: { skills: many('skill', 6), tools: [], notes: [] }, defaultOpen: ['skill'] });
  assert.doesNotMatch(six, /kit-acc-more/, 'six lines need no Show more');
  assert.deepEqual(assertTextBudget(m), []);
});

test('the selected agent is highlighted (data-selected, aria-pressed); the owner of a selected item keeps the highlight and that line has its own', () => {
  const self = html({ selected: true });
  assert.match(self, /data-selected=""/); assert.match(self, /aria-pressed="true"/); assert.doesNotMatch(self, /data-owner|aria-current/);
  const owner = html({ itemId: 'skill-022', defaultOpen: ['skill'] });
  assert.match(owner, /data-owner=""/); assert.doesNotMatch(owner, /data-selected="" data-owner/); assert.match(owner, /aria-pressed="false" aria-current="true"/);
  assert.match(owner, /<li class="kit-acc-row" data-line="skill-022" data-selected=""><button type="button" class="kit-acc-main" aria-pressed="true">/);
  assert.equal([...owner.matchAll(/class="kit-acc-row" data-line="[^"]+" data-selected=""/g)].length, 1, 'one line is lit');
});

test('a line keeps its badge: "needs a key" is words, "2 different copies" is a button that opens the dialog', () => {
  const shelves: Shelves = { skills: [{ id: 'sk', kind: 'skill', name: 'Write a weekly summary', badge: { label: '3 different copies', tone: 'warn' } }], tools: [{ id: 'tl', kind: 'tool', name: 'Read my calendar', badge: { label: 'needs a key', tone: 'warn' } }], notes: [] };
  const m = html({ shelves, defaultOpen: ['skill', 'tool'], onBadgePress: none });
  assert.match(m, /<button type="button" class="kit-badge" data-tone="warn" data-no-drag=""><svg[\s\S]*?<\/svg><span>3 different copies<\/span><\/button>/);
  assert.match(m, /<span class="kit-badge" data-tone="warn" data-no-drag=""><svg[\s\S]*?<\/svg><span>needs a key<\/span><\/span>/, 'a key badge is not a button');
  assert.doesNotMatch(html({ shelves, defaultOpen: ['skill'] }), /<button type="button" class="kit-badge"/, 'with no handler the badge is only words');
});

test('the card carries the id of its agent and the tour id, and the whole card still passes the text budget', () => {
  const m = html({ dataTour: 'agent', fresh: true });
  assert.match(m, /data-fresh=""/); assert.match(m, /data-tour="agent"/); assert.match(m, /data-drop-agent="agent-01"/);
  for (const a of agents) {
    const words = agentCard(a);
    const text = renderToStaticMarkup(createElement(AgentCard, { name: words.name, hint: words.hint, shelves: shelvesOf(world, a), selected: false, onSelect: none, onSelectItem: none, dropAgent: a.id, defaultOpen: ['skill', 'tool', 'note'] }));
    assert.deepEqual(assertTextBudget(text), [], a.id);
  }
});
