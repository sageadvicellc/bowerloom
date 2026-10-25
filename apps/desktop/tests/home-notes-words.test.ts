// The words and the markup of "Choose notes": the same rules as every other screen word of the home app (label 5, hint 12, no banned word), the text
// budget on all rendered parts, no file path or invented word, the kit's own card for every topic, and the style sheet keeps text at 14 px or more.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChooseNotes } from '../renderer/home/notes/ChooseNotes.js';
import { NotesHarness } from '../renderer/home/notes/NotesHarness.js';
import { NotesShelf } from '../renderer/home/notes/NotesShelf.js';
import { PreviewPanel } from '../renderer/home/notes/PreviewPanel.js';
import { NOTES_HASH } from '../renderer/home/notes/route.js';
import {
  NOTES_WORDS, SIZE_LINE, keptHint, leaveOutGroup, leaveOutOf, notesCount, ofTotal, partBackIn, partLeftOut, partOfTopic, pickedByHand, sizeLine, topicAdded, topicRemoved, topicTab, willRead,
} from '../renderer/home/notes/notes-words.js';
import { ProtoProvider } from '../renderer/proto/session.js';
import { generateWorld } from '../shared/proto/sample.js';
import { createStore } from '../shared/proto/store.js';
import { EMPTY_SELECTION, makeBasis, previewOf, ruleLines, toggleTopic } from '../shared/home/notes-model.js';
import { LIMITS, assertTextBudget, bannedIn, countWords, extractText } from '../shared/home/textbudget.js';
import { DESKTOP } from './support.js';

const groups = [['label', LIMITS.label], ['hint', LIMITS.hint], ['popover', LIMITS.popover]] as const;
const FIVE = 'One two three four five';
const html = (element: ReactElement): string => renderToStaticMarkup(element);
const within = (markup: string): void => assert.deepEqual(assertTextBudget(markup), [], markup.slice(0, 300));
/** What a person can read: the text and the spoken labels of the markup. The ids in data attributes are code. */
const said = (markup: string): string => extractText(markup).map(p => p.text).join(' | ');
const NO_PATH = /\.bowerloom|\/sample\/|SKILL\.md|\/Users\/|\.claude\/|\.codex\/|alderhythe|tarnwick|brindle|sedgefield|fennrow|quillmoor|cinderlow|marrowdeep/;
const store = () => createStore(generateWorld(1));
const layer = (agentId: string): string => html(createElement(ProtoProvider, { store: store() }, createElement(ChooseNotes, { open: true, agentId, onClose: () => undefined })));

test('NOTES_WORDS is frozen all the way down and has the same three groups as WORDS', () => {
  assert.deepEqual(Object.keys(NOTES_WORDS), ['label', 'hint', 'popover']);
  assert.equal(Object.isFrozen(NOTES_WORDS), true);
  for (const [group] of groups) assert.equal(Object.isFrozen(NOTES_WORDS[group]), true, group);
  assert.throws(() => { (NOTES_WORDS.label as Record<string, string>).use = 'x'; }, TypeError);
});

for (const [group, limit] of groups) {
  test(`every ${group} in NOTES_WORDS has at most ${limit} words and no banned word`, () => {
    for (const [key, text] of Object.entries(NOTES_WORDS[group])) {
      assert.equal(typeof text, 'string', key);
      assert.ok(countWords(text) <= limit, `${group}.${key} has ${countWords(text)} words: ${text}`);
      assert.equal(bannedIn(text, group === 'popover'), null, `${group}.${key}: ${text}`);
      assert.equal(text, text.trim(), `${group}.${key} has stray space`);
    }
  });
}

test('the words of the layer are the ones the brief asks for', () => {
  const l = NOTES_WORDS.label;
  assert.deepEqual([l.title, l.choose, l.use, l.cancel, l.pickByHand, l.leaveOut], ['Choose notes', 'Choose notes', 'Use these notes', 'Cancel', 'Choose one by one', 'Leave out']);
  assert.equal(NOTES_WORDS.hint.intro, 'Pick the notes this agent can read.');
  assert.ok(countWords(NOTES_WORDS.hint.intro) <= 12);
  assert.equal(willRead(214, 700), 'This agent will read 214 of 700 notes');
  assert.deepEqual([sizeLine('small'), sizeLine('medium'), sizeLine('big')], ['A small set', 'A medium set', 'A big set']);
  assert.equal(NOTES_HASH, '#prototype-v2/notes');
});

test('the group a string sits in is the budget it is checked against, as markup', () => {
  for (const text of Object.values(NOTES_WORDS.label)) assert.deepEqual(assertTextBudget(`<button type="button">${text}</button>`), [], text);
  for (const text of Object.values(NOTES_WORDS.hint)) assert.deepEqual(assertTextBudget(`<p>${text}</p>`), [], text);
});

test('the words built from numbers and names stay inside the budget, even with five-word names', () => {
  const built = [
    notesCount(0), keptHint(263), notesCount(1), notesCount(700), partOfTopic(52, 86), willRead(0, 700), willRead(1, 1), willRead(700, 700), ofTotal(1), ...Object.values(SIZE_LINE),
    topicAdded(FIVE, 1), topicAdded('Clients', 143), topicRemoved(FIVE), partLeftOut(FIVE), partBackIn(FIVE), pickedByHand(0), pickedByHand(120), topicTab(FIVE, 12),
  ];
  for (const text of built) { assert.ok(countWords(text) <= LIMITS.hint, text); assert.equal(bannedIn(text), null, text); assert.deepEqual(assertTextBudget(`<p>${text}</p>`), [], text); }
  for (const text of [leaveOutOf('Packing lists'), leaveOutOf('One to one'), leaveOutGroup('Clients')]) assert.ok(countWords(text) <= LIMITS.label, text);
  assert.equal(notesCount(1), '1 note');
  assert.equal(topicTab('Clients', 2), 'Clients, 2 picked');
});

test('the layer, opened for an agent with no notes, passes the budget, shows eight topics as the kit card and no invented word', () => {
  const m = layer('agent-05');
  within(m);
  assert.doesNotMatch(said(m), NO_PATH);
  assert.match(m, /role="dialog"[^>]*aria-labelledby/);
  assert.match(m, /<h2 class="kit-heading"[^>]*>Choose notes<\/h2>/);
  assert.match(m, /Pick the notes this agent can read\./);
  assert.equal([...m.matchAll(/class="kit-card"/g)].length, 8, 'one kit card for each topic');
  assert.equal([...m.matchAll(/data-kind="note"/g)].length, 8);
  assert.doesNotMatch(m, /Kept from before/, 'nothing was kept: there is no such card');
  assert.match(m, /Work<\/button>/);
  assert.match(m, /143 notes/);
  assert.match(m, /This agent will read<\/span>/);
  assert.match(m, /<span class="nt-num">0<\/span>/);
  assert.match(m, /of 700 notes/);
  assert.match(m, /Nothing is picked yet\./);
  assert.match(m, /Pick at least one note first\./);
  assert.match(m, /<button[^>]*disabled=""[^>]*>Use these notes<\/button>/);
  assert.match(m, /<button[^>]*>Cancel<\/button>/);
  assert.match(m, /<button[^>]*>Choose one by one<\/button>/);
  assert.equal([...m.matchAll(/aria-pressed="true"/g)].length, 0, 'no topic is on');
});

test('for an agent that reads notes already, the topics it names are on and "Kept from before" shows when there are some', () => {
  const folders = layer('agent-01');
  within(folders);
  assert.match(folders, /aria-pressed="true"/);
  assert.match(folders, /Leave out of Clients/);
  assert.match(folders, /Leave out of Company/);
  assert.match(folders, /All notes about Clients\./);
  const kept = layer('agent-02');
  within(kept);
  assert.match(kept, /Kept from before/);
  assert.match(kept, /notes kept from before\./);
  assert.match(kept, /notes chosen another way/);
});

test('the layer shows nothing for an agent that is not there or when it is closed', () => {
  const closed = html(createElement(ProtoProvider, { store: store() }, createElement(ChooseNotes, { open: false, agentId: 'agent-05', onClose: () => undefined })));
  assert.doesNotMatch(closed, /kit-drawer"/);
  const missing = html(createElement(ProtoProvider, { store: store() }, createElement(ChooseNotes, { open: true, agentId: 'nobody', onClose: () => undefined })));
  assert.doesNotMatch(missing, /kit-drawer"/);
});

test('the preview shows the first eight titles, then "Show more" when there are more', () => {
  const world = generateWorld(1), basis = makeBasis(world.wikiPages, undefined);
  const sel = toggleTopic(EMPTY_SELECTION, basis.topics[0]!);
  const m = html(createElement(PreviewPanel, { preview: previewOf(sel, basis), lines: ruleLines(sel, basis) }));
  within(m);
  assert.equal([...m.matchAll(/<li>/g)].length, 1 + 8, 'one line of the choice and eight titles');
  assert.match(m, /Show more/);
  assert.match(m, /<meter[^>]*aria-label="Share of all notes"/);
  const few = toggleTopic(EMPTY_SELECTION, basis.topics[basis.topics.length - 1]!);
  assert.doesNotMatch(html(createElement(PreviewPanel, { preview: { ...previewOf(few, basis), notes: previewOf(few, basis).notes.slice(0, 3) }, lines: [] })), /Show more/);
});

test('the Notes shelf has the Choose notes button on it, and the test page passes the budget with it', () => {
  const shelf = html(createElement(NotesShelf, { entries: [], selectedId: null, onSelect: () => undefined, onChoose: () => undefined }));
  within(shelf);
  assert.match(shelf, /<h3 class="kit-heading"[^>]*>Notes<\/h3>/);
  assert.match(shelf, /Choose notes<\/button>/);
  const page = html(createElement(NotesHarness));
  within(page);
  assert.doesNotMatch(said(page), NO_PATH);
  assert.match(page, /Choose notes test page/);
  assert.match(page, /Pick an agent, then press Choose notes\./);
  assert.equal([...page.matchAll(/data-kind="agent"/g)].length, 10);
  assert.match(page, /<button[^>]*disabled=""[^>]*>(?:<svg.*?<\/svg>)?Choose notes<\/button>/, 'with no agent picked the button cannot be pressed');
});

test('the style sheet keeps text at 14 px or more, takes every time from the motion tokens, and yields under reduce motion', () => {
  const css = readFileSync(join(DESKTOP, 'renderer/home/notes/notes.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /(?<![-\w])\d+(\.\d+)?m?s\b(?![^;{}]*var\()/, 'a fixed time');
  for (const m of css.matchAll(/(transition|animation)\s*:\s*([^;]+);/g)) assert.match(m[2]!, /var\(--motion-|none/, m[0]);
  for (const m of css.matchAll(/font-size\s*:\s*([^;]+);/g)) {
    const v = m[1]!.trim();
    assert.ok(/^var\(--hm-text-(base|small|heading|display|title|section|name)\)$/.test(v) || (/^[\d.]+rem$/.test(v) && parseFloat(v) >= 0.875), `font-size ${v}`);
  }
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*animation: none !important; transition: none !important/);
  assert.doesNotMatch(css, /@keyframes/, 'the layer adds no motion of its own: it slides in with the kit drawer');
});

test('the sources of the layer use no inline style, no raw colour and no word of the specification', () => {
  for (const name of ['ChooseNotes.tsx', 'TopicGrid.tsx', 'HandPicker.tsx', 'PreviewPanel.tsx', 'NotesShelf.tsx', 'NotesHarness.tsx']) {
    const text = readFileSync(join(DESKTOP, 'renderer/home/notes', name), 'utf8');
    assert.doesNotMatch(text, /style=\{|dangerouslySetInnerHTML/, name);
  }
  assert.doesNotMatch(readFileSync(join(DESKTOP, 'renderer/home/notes/notes.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-fA-F]{3,8}\b|rgb\((?!\s*0 0 0)/, 'colours come from the tokens');
});

// ---- Wave C
import { alreadyLine } from '../renderer/home/notes/notes-words.js';

test('the line of what is already included lists up to three topics with their counts, then "N more", then what is from before; it never passes twelve words', () => {
  assert.equal(alreadyLine([{ name: 'Meetings', count: 114 }, { name: 'Travel', count: 52 }], 52), 'Already included: Meetings (114), Travel (52) and 52 from before.');
  assert.equal(alreadyLine([{ name: 'Meetings', count: 114 }], 0), 'Already included: Meetings (114).');
  assert.equal(alreadyLine([{ name: 'Clients', count: 86 }, { name: 'Company', count: 18 }], 0), 'Already included: Clients (86) and Company (18).');
  assert.equal(alreadyLine([], 263), 'Already included: 263 from before.');
  assert.equal(alreadyLine([{ name: 'A', count: 1 }, { name: 'B', count: 2 }, { name: 'C', count: 3 }, { name: 'D', count: 4 }, { name: 'E', count: 5 }], 6), 'Already included: A (1), B (2), 3 more and 6 from before.', 'twelve words is the most, so the third topic is counted in the rest');
  assert.equal(alreadyLine([{ name: 'A', count: 1 }, { name: 'B', count: 2 }, { name: 'C', count: 3 }, { name: 'D', count: 4 }], 0), 'Already included: A (1), B (2), C (3) and 1 more.');
  for (const n of [0, 1, 4, 9]) for (const before of [0, 5, 999]) {
    const text = alreadyLine(Array.from({ length: n }, (_, i) => ({ name: `Topic number ${i + 1}`, count: 100 + i })), before);
    assert.ok(countWords(text) <= 12, text); assert.deepEqual(assertTextBudget(`<p>${text}</p>`), [], text); assert.equal(bannedIn(text), null, text);
  }
});
