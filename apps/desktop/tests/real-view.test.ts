// The screens and the order of the two questions of the real-setup reader: words held to the text budget, the machine that cannot skip a step, and the markup that draws text as text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LIMITS, assertTextBudget, bannedIn, countWords } from '../shared/home/textbudget.js';
import type { RealDiscovery, RealPlace } from '../shared/real/types.js';
import { RealView } from '../renderer/home/real/RealLoader.js';
import { agentsTicked, realReduce, selectedIds, startState } from '../renderer/home/real/flow.js';
import type { RealAction, RealState } from '../renderer/home/real/flow.js';
import { KIND_WORDS, REAL_WORDS, countsLine, couldNotReadLine, foundPlaces, readSummary, reasonWords } from '../renderer/home/real/words.js';
import { codeOf } from '../renderer/home/real/bridge.js';

const place = (id: string, over: Partial<RealPlace> = {}): RealPlace => ({
  id, label: `Place ${id}`, kind: 'home', apps: ['Claude Code'], appLabel: 'Claude Code', counts: { agents: 2, skills: 3, tools: 1, hooks: 0, notes: 0 }, empty: false,
  details: { path: `~/${id}`, folders: ['.claude'], topics: [], notes: [] }, ...over,
});
const found = (...places: RealPlace[]): RealDiscovery => ({ places, stoppedEarly: false, couldNotRead: 0, notes: [], readOnly: true });
const run = (actions: RealAction[], from: RealState = startState()): RealState => actions.reduce(realReduce, from);

test('every label has at most 5 words, every hint at most 12, and no banned word', () => {
  for (const [key, text] of Object.entries(REAL_WORDS.label)) { assert.ok(countWords(text) <= LIMITS.label, `${key}: ${text}`); assert.equal(bannedIn(text), null, key); }
  for (const [key, text] of Object.entries(REAL_WORDS.hint)) { assert.ok(countWords(text) <= LIMITS.hint, `${key}: ${text}`); assert.equal(bannedIn(text), null, key); }
  for (const text of [countsLine({ agents: 12, skills: 40, tools: 3, hooks: 1, notes: 700 }), foundPlaces(1), foundPlaces(7), readSummary(3, 14), couldNotReadLine(1), couldNotReadLine(9), ...Object.values(KIND_WORDS)]) {
    assert.ok(countWords(text) <= LIMITS.hint, text); assert.equal(bannedIn(text), null, text);
  }
  for (const code of ['BUSY', 'NOT_ALLOWED', 'UNKNOWN_PLACE', 'BAD_ARGUMENT', 'TOO_MANY', 'NO_BRIDGE', 'FAILED']) { assert.equal(bannedIn(reasonWords(code)), null, code); assert.ok(countWords(reasonWords(code)) <= LIMITS.hint, code); }
  assert.equal(Object.isFrozen(REAL_WORDS), true); assert.equal(Object.isFrozen(REAL_WORDS.label), true);
});

test('the counts line leaves out what a place does not hold and says "Nothing here" for an empty one', () => {
  assert.equal(countsLine({ agents: 1, skills: 0, tools: 2, hooks: 1, notes: 0 }), '1 agent, 2 tools, 1 hook');
  assert.equal(countsLine({ agents: 0, skills: 0, tools: 0, hooks: 0, notes: 0 }), 'Nothing here');
});

test('the order of the steps: nothing is read before the person has asked, ticked and confirmed', () => {
  let s = startState();
  assert.equal(s.step, 'start');
  for (const bad of [{ type: 'yes' }, { type: 'looksRight' }, { type: 'done' }, { type: 'toggle', id: 'a' }, { type: 'back' }] as RealAction[]) assert.equal(realReduce(s, bad), s, `${bad.type} does nothing at the start`);
  s = run([{ type: 'find' }], s);
  assert.equal(s.step, 'looking');
  assert.equal(realReduce(s, { type: 'yes' }), s, 'cannot confirm while looking');
  s = run([{ type: 'found', found: found(place('a'), place('b', { empty: true })) }], s);
  assert.deepEqual([s.step, s.ticked], ['places', ['a']], 'an empty place starts unticked');
  assert.equal(realReduce(s, { type: 'yes' }), s, 'cannot read straight from the list of places');
  s = run([{ type: 'toggle', id: 'a' }], s);
  assert.deepEqual(s.ticked, []);
  assert.equal(realReduce(s, { type: 'looksRight' }), s, 'cannot go on with nothing ticked');
  s = run([{ type: 'toggle', id: 'b' }, { type: 'toggle', id: 'nope' }], s);
  assert.deepEqual(s.ticked, ['b'], 'an id that was not listed is ignored');
  s = run([{ type: 'looksRight' }], s);
  assert.equal(s.step, 'confirm');
  assert.equal(realReduce(s, { type: 'toggle', id: 'a' }), s, 'the ticks cannot change at the second question');
  assert.equal(run([{ type: 'back' }], s).step, 'places'); assert.equal(run([{ type: 'notNow' }], s).step, 'places');
  s = run([{ type: 'yes' }], s);
  assert.equal(s.step, 'reading');
  assert.deepEqual(selectedIds(s), ['b']);
  assert.equal(run([{ type: 'done' }], s).step, 'done');
});

test('a folder the person adds joins the list with its own tick; closing the chooser changes nothing but a note', () => {
  let s = run([{ type: 'find' }, { type: 'found', found: found(place('a')) }]);
  s = run([{ type: 'picked', found: found(place('c', { kind: 'picked' }), place('d', { kind: 'project', empty: true })), cancelled: false }], s);
  assert.deepEqual(s.places.map(p => p.id), ['a', 'c', 'd']); assert.deepEqual(s.ticked, ['a', 'c']);
  const again = run([{ type: 'picked', found: found(place('c', { kind: 'picked' })), cancelled: false }], s);
  assert.deepEqual(again.places.map(p => p.id), ['a', 'c', 'd'], 'a place listed twice is listed once'); assert.deepEqual(again.ticked, ['a', 'c']);
  const nothing = run([{ type: 'picked', found: found(), cancelled: true }], s);
  assert.deepEqual([nothing.places, nothing.ticked, nothing.pickedNothing], [s.places, s.ticked, true]);
  assert.equal(agentsTicked(s), 4);
});

test('a failure shows its code, and Try again goes back to where it came from', () => {
  const looking = run([{ type: 'find' }, { type: 'fail', code: 'BUSY' }]);
  assert.deepEqual([looking.step, looking.error, looking.retry], ['error', 'BUSY', 'start']);
  assert.equal(run([{ type: 'retry' }], looking).step, 'start');
  const reading = run([{ type: 'find' }, { type: 'found', found: found(place('a')) }, { type: 'looksRight' }, { type: 'yes' }, { type: 'fail', code: 'UNKNOWN_PLACE' }]);
  assert.deepEqual([reading.step, reading.retry], ['error', 'places']);
  const back = run([{ type: 'retry' }], reading);
  assert.deepEqual([back.step, back.ticked], ['places', ['a']], 'the ticks are kept');
  assert.equal(codeOf(new Error("Error invoking remote method 'x': Error: BUSY")), 'BUSY'); assert.equal(codeOf('whatever'), 'FAILED'); assert.equal(codeOf(null), 'FAILED');
});

const view = (state: RealState, details = false): string => renderToStaticMarkup(createElement(RealView, { state, details, busyPick: false, onAction: () => undefined }));

test('every screen is within the text budget, says Read-only, and keeps the paths behind Show details', () => {
  const places = run([{ type: 'find' }, { type: 'found', found: { ...found(place('a'), place('b', { kind: 'picked', appLabel: 'Notes', apps: [], counts: { agents: 0, skills: 0, tools: 0, hooks: 0, notes: 12 }, details: { path: '~/work/b', folders: [], topics: [{ name: 'docs', count: 12 }], notes: ['1 file over 2 MB was skipped.'] } })), couldNotRead: 3, stoppedEarly: true } }]);
  const screens: [string, string][] = [
    ['start', view(startState())], ['looking', view(run([{ type: 'find' }]))], ['places', view(places)], ['details', view(places, true)], ['confirm', view(run([{ type: 'looksRight' }], places))],
    ['reading', view(run([{ type: 'looksRight' }, { type: 'yes' }], places))], ['error', view(run([{ type: 'fail', code: 'BUSY' }], places))], ['empty', view(run([{ type: 'find' }, { type: 'found', found: found() }]))],
  ];
  for (const [name, markup] of screens) {
    assert.deepEqual(assertTextBudget(markup), [], name);
    assert.match(markup, /Read-only/, `${name} says Read-only`);
    assert.doesNotMatch(markup, /innerHTML|dangerouslySetInnerHTML/, name);
  }
  assert.doesNotMatch(screens.find(([n]) => n === 'places')![1], /~\/a|~\/work/, 'no path before Show details');
  assert.match(screens.find(([n]) => n === 'details')![1], /~\/a/);
  assert.match(screens.find(([n]) => n === 'places')![1], /Could not read 3 things\./);
  assert.match(screens.find(([n]) => n === 'places')![1], /stopped early/);
  assert.match(screens.find(([n]) => n === 'confirm')![1], /Keys and passwords are never copied\./);
});

test('text from a file is drawn as text: a markup string in a folder name comes out escaped', () => {
  const hostile = place('x', { label: '<img src=x onerror=alert(1)>', appLabel: '<b>Claude</b>' });
  const markup = view(run([{ type: 'find' }, { type: 'found', found: found(hostile) }]), true);
  assert.doesNotMatch(markup, /<img|<b>Claude/);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
