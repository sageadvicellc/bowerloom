// The pieces of the map, rendered to markup: the Remove button, the drop marker on an agent card, the sort toggle and the Save bar in each mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ItemCard } from '../renderer/home/kit/ItemCard.js';
import { Shelf } from '../renderer/home/kit/Shelf.js';
import { SortList, SortMenu } from '../renderer/home/kit/SortMenu.js';
import { SaveBar } from '../renderer/home/save/SaveBar.js';
import { HomeApp } from '../renderer/home/HomeApp.js';
import { ProtoProvider } from '../renderer/proto/session.js';
import { loadWorld } from '../renderer/proto/world.js';
import { createStore } from '../shared/proto/store.js';
import { saveBar } from '../shared/home/savebar.js';
import type { ShelfEntry } from '../shared/home/cards.js';
import { assertTextBudget } from '../shared/home/textbudget.js';

const html = (element: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(element);
const none = (): void => undefined;
const within = (markup: string): void => assert.deepEqual(assertTextBudget(markup), [], markup.slice(0, 200));

test('a card with Remove has a real icon button named "Remove" and then the card\'s name, and a card without it has none', () => {
  const m = html(createElement(ItemCard, { kind: 'skill', name: 'Summarize a meeting', hint: 'Turns a long meeting into a few clear points.', selected: false, onSelect: none, onRemove: none }));
  assert.match(m, /data-removable=""/);
  const tag = /<button[^>]*data-remove=""[^>]*>/.exec(m);
  assert.ok(tag !== null, m);
  const remove = /id="([^"]+)"[^>]*aria-labelledby="\1 ([^"]+)"/.exec(tag![0]);
  assert.ok(remove !== null, tag![0]);
  assert.match(tag![0], /aria-label="Remove"/); assert.match(tag![0], /data-no-drag=""/); assert.match(tag![0], /data-icon-only=""/);
  assert.match(m, new RegExp(`<button type="button" class="kit-card-main" id="${remove![2]}"`), 'the second name in aria-labelledby is the card\'s own name');
  assert.match(m, /<button[^>]*data-remove=""[^>]*><svg[\s\S]*?<\/svg><\/button>/, 'the button holds an icon and no words');
  assert.match(m, /role="tooltip"[^>]*>Remove<\/span>/, 'a tooltip says Remove');
  assert.ok([...m.matchAll(/aria-label="([^"]*)"/g)].every(x => x[1]!.split(' ').length <= 5), 'no label is longer than 5 words');
  within(m);
  const plain = html(createElement(ItemCard, { kind: 'skill', name: 'Summarize a meeting', selected: false, onSelect: none }));
  assert.doesNotMatch(plain, /data-remove|data-removable/);
});

test('the keyboard reaches the name first, then the state button of copies, then Remove; the hint is plain text before them on the second line', () => {
  const m = html(createElement(ItemCard, { kind: 'skill', name: 'X', hint: 'One.', badge: { label: '2 different copies', tone: 'warn' }, selected: true, onSelect: none, onRemove: none, onBadgePress: none }));
  const order = ['kit-card-main', 'kit-card-hint', 'kit-status', 'data-remove'].map(c => m.indexOf(c));
  assert.ok(order.every(i => i > -1) && order.every((at, i) => i === 0 || at > order[i - 1]!), order.join());
});

test('an agent card can carry the id of its agent for a drag to find', () => {
  const m = html(createElement(ItemCard, { kind: 'agent', name: 'Meeting assistant', hint: 'Summarizes meetings.', selected: false, onSelect: none, dropAgent: 'agent-01' }));
  assert.match(m, /<div class="kit-card"[^>]* data-drop-agent="agent-01"/);
  assert.doesNotMatch(html(createElement(ItemCard, { kind: 'agent', name: 'A', selected: false, onSelect: none })), /data-drop-agent/);
});

test('a shelf gives every card its hint and its Remove button when asked to', () => {
  const entries: ShelfEntry[] = [{ id: 'a', kind: 'skill', name: 'Write a reply', hint: 'Drafts a reply in your voice for you to check.' }, { id: 'b', kind: 'skill', name: 'Set a reminder', hint: 'Reminds you before something is due.' }];
  const m = html(createElement(Shelf, { title: 'Skills', entries, selectedId: null, onSelect: none, onRemove: none, emptyText: 'Nothing here yet.' }));
  assert.equal([...m.matchAll(/data-remove=""/g)].length, 2); assert.equal([...m.matchAll(/class="kit-hint kit-card-hint"/g)].length, 2);
  assert.match(m, /Drafts a reply in your voice/); within(m);
  assert.doesNotMatch(html(createElement(Shelf, { title: 'Skills', entries, selectedId: null, onSelect: none, emptyText: 'Nothing here yet.' })), /data-remove/);
});

const CHOICES = [{ mode: 'name', label: 'Name' }, { mode: 'recent', label: 'Recently changed' }] as const;

test('the sort control is one icon button named Sort that opens a menu; the menu is a list of two radio items, the one in use is checked, and no item has an icon or a tick', () => {
  const closed = html(createElement(SortMenu, { mode: 'name', choices: CHOICES, onChange: none, label: 'Sort', menuLabel: 'Order of the agents' }));
  assert.match(closed, /aria-label="Sort"/); assert.match(closed, /aria-haspopup="menu"/); assert.match(closed, /aria-expanded="false"/); assert.doesNotMatch(closed, /role="menu"/, 'the menu is not in the page until it is opened');
  assert.equal([...closed.matchAll(/<svg/g)].length, 1, 'the icon button holds one icon'); within(closed);
  const byName = html(createElement(SortList, { id: 'm', mode: 'name', choices: CHOICES, label: 'Order of the agents', onPick: none }));
  assert.match(byName, /role="menu" aria-label="Order of the agents"/);
  assert.match(byName, /role="menuitemradio"[^>]*aria-checked="true"[^>]*data-sort="name"[^>]*>Name</); assert.match(byName, /role="menuitemradio"[^>]*aria-checked="false"[^>]*data-sort="recent"[^>]*>Recently changed</);
  const recent = html(createElement(SortList, { id: 'm', mode: 'recent', choices: CHOICES, label: 'Order of the agents', onPick: none }));
  assert.match(recent, /aria-checked="false"[^>]*data-sort="name"/); assert.match(recent, /aria-checked="true"[^>]*data-sort="recent"[^>]*>Recently changed</);
  assert.doesNotMatch(byName, /<svg/); assert.doesNotMatch(recent, /<svg/);
  within(byName); within(recent);
});

const bar = (changes: number, points: number, phase: Parameters<typeof saveBar>[2]): string =>
  html(createElement(SaveBar, { model: saveBar(changes, points, phase), ticks: ['Claude Code', 'Codex', 'OpenCode'], onSave: none, onGoBack: none, onDiscard: none }));

test('the Save bar says "Nothing to save yet" with Save turned off, and offers nothing else', () => {
  const m = bar(0, 1, null);
  assert.match(m, /data-mode="clean"/); assert.match(m, /role="status"[^>]*><p>Nothing to save yet<\/p>/); assert.match(m, /<button disabled=""[^>]*>Save<\/button>/);
  assert.doesNotMatch(m, /Go back|Discard changes|Undo all changes|hm-tick/); within(m);
});

test('the Save bar counts changes: "1 change", "2 changes", with Save and Undo all changes on', () => {
  const one = bar(1, 1, null), two = bar(2, 1, null);
  assert.match(one, /<p>1 change<\/p>/); assert.match(two, /<p>2 changes<\/p>/);
  for (const m of [one, two]) { assert.match(m, /data-mode="dirty"/); assert.doesNotMatch(m, /<button disabled/); assert.match(m, />Undo all changes</); assert.doesNotMatch(m, />Discard changes</); assert.doesNotMatch(m, /Go back|hm-tick/); within(m); }
});

test('after a save the bar says it was saved in the preview and lists the programs a real save would update as quiet chips with no tick, and offers Go back', () => {
  const m = bar(0, 2, { kind: 'saved', at: 2, backTo: 'v1' });
  assert.match(m, /data-mode="saved"/); assert.match(m, /<p>Saved in this preview\. Your files are untouched\.<\/p>/);
  assert.match(m, /<span class="hm-would-lead" id="([^"]+)">Would update:<\/span><ul class="hm-ticks" aria-labelledby="\1">/);
  assert.deepEqual([...m.matchAll(/<li class="hm-tick">([^<]+)<\/li>/g)].map(x => x[1]), ['Claude Code', 'Codex', 'OpenCode']);
  // The chips carry no check icon: nothing was written, so nothing is ticked off.
  assert.doesNotMatch(/<div class="hm-would"[\s\S]*?<\/ul>/.exec(m)![0], /<svg|kit-icon/);
  assert.doesNotMatch(m, /Saved<\/p>|>Saved</);
  assert.match(m, />Go back</); assert.match(m, /<button disabled=""[^>]*>Save<\/button>/); within(m);
});

test('after Go back the bar says so, with no ticks and no Go back', () => {
  const m = bar(0, 3, { kind: 'back', at: 3, backTo: null });
  assert.match(m, /data-mode="back"/); assert.match(m, /<p>Back to how it was<\/p>/); assert.doesNotMatch(m, /hm-tick|Go back</); within(m);
});

test('a save with no earlier save point has no Go back', () => {
  assert.doesNotMatch(bar(0, 2, { kind: 'saved', at: 2, backTo: null }), /Go back/);
});

test('every agent card on the map carries the id of its agent, once each', () => {
  const m = html(createElement(ProtoProvider, { store: createStore(loadWorld()) }, createElement(HomeApp)));
  const ids = [...m.matchAll(/data-drop-agent="([^"]+)"/g)].map(x => x[1]!);
  assert.equal(ids.length, 10); assert.equal(new Set(ids).size, 10); assert.ok(ids.every(id => /^agent-\d\d$/.test(id)), ids.join());
  assert.match(m, /data-sort-button=""/); assert.doesNotMatch(m, /class="hm-group|data-kind="group"/);
});

test('the window starts with a link to the details, before the navigation, and exactly one tile of the grid is in the Tab order', () => {
  const m = html(createElement(ProtoProvider, { store: createStore(loadWorld()) }, createElement(HomeApp)));
  assert.match(m, /<div class="hm-root" data-home="" data-nav="open"><a class="hm-skip" href="#hm-panel-title">Skip to details<\/a><nav class="hm-nav"/);
  const tiles = m.slice(m.indexOf('class="hm-grid"'), m.indexOf('</main>'));
  assert.equal([...tiles.matchAll(/class="kit-card-main"[^>]*tabindex="0"/g)].length, 1, 'one tile is the stop');
  assert.equal([...tiles.matchAll(/class="kit-card-main"[^>]*tabindex="-1"/g)].length, 9, 'the other nine are reached by the arrow keys');
  assert.ok([...tiles.matchAll(/class="kit-count"[^>]*tabindex="0"/g)].length >= 1);
  within(m);
});
