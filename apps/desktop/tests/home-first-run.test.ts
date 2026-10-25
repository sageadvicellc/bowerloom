// U3: the words and the markup of the Welcome screen and the Find screen obey the text budget, and a path is never a label.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FIND_WORDS, foundTitle, readProgress, readSummary, readingNow } from '../renderer/home/first-run/find-words.js';
import { Welcome } from '../renderer/home/first-run/Welcome.js';
import { FindScreen } from '../renderer/home/first-run/FindScreen.js';
import { HomeApp } from '../renderer/home/HomeApp.js';
import { ProtoProvider } from '../renderer/proto/session.js';
import { loadWorld } from '../renderer/proto/world.js';
import { createStore } from '../shared/proto/store.js';
import { withSampleCopies } from '../shared/home/sample-copies.js';
import { LIMITS, assertTextBudget, bannedIn, countWords } from '../shared/home/textbudget.js';
import { DESKTOP } from './support.js';

const groups = [['label', LIMITS.label], ['hint', LIMITS.hint]] as const;
const none = (): void => undefined;
const world = () => withSampleCopies(loadWorld());

test('FIND_WORDS is frozen all the way down and has the same three groups as WORDS', () => {
  assert.deepEqual(Object.keys(FIND_WORDS), ['label', 'hint', 'popover']);
  assert.equal(Object.isFrozen(FIND_WORDS), true);
  for (const g of ['label', 'hint', 'popover'] as const) assert.equal(Object.isFrozen(FIND_WORDS[g]), true, g);
});

for (const [group, limit] of groups) {
  test(`every ${group} in FIND_WORDS has at most ${limit} words and no banned word`, () => {
    for (const [key, text] of Object.entries(FIND_WORDS[group])) {
      assert.ok(countWords(text) <= limit, `${group}.${key} has ${countWords(text)} words: ${text}`);
      assert.equal(bannedIn(text), null, `${group}.${key}: ${text}`);
      assert.equal(text, text.trim(), key);
    }
  });
}

test('the storyboard words are used as written', () => {
  const l = FIND_WORDS.label, h = FIND_WORDS.hint;
  assert.deepEqual([l.findMyAgents, l.looksRight, l.showDetails, l.readTitle, l.yesRead, l.notNow, l.whereILooked, l.notFound, l.findMore], ['Find my agents', 'Looks right', 'Show details', 'Read what is inside?', 'Yes, read them', 'Not now', 'Where I looked', 'Not found', 'Find more']);
  assert.equal(`${h.welcomeLineOne} ${h.welcomeLineTwo}`, 'See everything your AI agents can do, and change it in one place.');
  assert.equal(h.closingNote, 'Saved in this preview. Help replays the tour any time.');
  assert.ok(countWords(h.welcomeNote) <= 12);
});

test('no Welcome or Find word is a file path', () => {
  for (const group of ['label', 'hint'] as const) for (const text of Object.values(FIND_WORDS[group])) assert.doesNotMatch(text, /[/\\]|\.claude|\.codex|\.opencode/, text);
});

test('the words built from numbers and names stay inside the budget, even with a five-word place', () => {
  const built = [foundTitle(0), foundTitle(1), foundTitle(10), readSummary(1, 1), readSummary(3, 10), readingNow('Your home folder'), readingNow('One two three four five'), readProgress(2, 3)];
  for (const text of built) { assert.deepEqual(assertTextBudget(`<p>${text}</p>`), [], text); assert.equal(bannedIn(text), null, text); }
  assert.equal(foundTitle(10), 'Found 10 agents'); assert.equal(foundTitle(1), 'Found 1 agent'); assert.equal(readSummary(3, 10), '3 places, 10 agents');
  assert.ok(countWords(foundTitle(10)) <= LIMITS.label, 'it is a heading');
});

test('Welcome renders the logo, two lines of one sentence, one button and one quiet line, within the text budget', () => {
  const m = renderToStaticMarkup(createElement(Welcome, { onFind: none }));
  assert.deepEqual(assertTextBudget(m), []);
  assert.equal([...m.matchAll(/<button/g)].length, 1);
  assert.match(m, />Find my agents</); assert.match(m, /See everything your AI agents can do,/); assert.match(m, /Nothing is changed until you press Save\./);
  assert.match(m, /<main id="main"/, 'the skip link finds it');
  assert.doesNotMatch(m, /harness/i);
});

test('Find draws three tiles that wait, the first time, and no folder path anywhere', () => {
  const store = createStore(world());
  const m = renderToStaticMarkup(createElement(ProtoProvider, { store }, createElement(FindScreen, { world: store.getState().draft, onLeave: none, onDone: none })));
  assert.deepEqual(assertTextBudget(m), []);
  assert.equal([...m.matchAll(/class="fr-tile"/g)].length, 3);
  assert.deepEqual([...m.matchAll(/data-state="(\w+)"/g)].map(x => x[1]), ['waiting', 'waiting', 'waiting']);
  assert.match(m, /Looking for your agents/);
  assert.doesNotMatch(m, /\/Users|\.claude|\.codex|\.opencode/);
});

test('the map has a "Find more" button only when it is given a way to reopen Find, and the closing note area only when it is guided', () => {
  const store = createStore(world());
  const draw = (props: Record<string, unknown>): string => renderToStaticMarkup(createElement(ProtoProvider, { store }, createElement(HomeApp, props)));
  assert.doesNotMatch(draw({}), /Find more/); assert.doesNotMatch(draw({}), /hm-toast/);
  const guided = draw({ onFindMore: none, closingNote: true });
  assert.match(guided, />Find more</); assert.match(guided, /class="hm-toast"/); assert.doesNotMatch(guided, /Saved\. Help replays/, 'the note is empty until the first Save');
  assert.deepEqual(assertTextBudget(guided), []);
});

test('HomeApp keeps skipped agents off the map', () => {
  const store = createStore(world());
  const w = store.getState().draft;
  const agentIds = w.items.filter(i => i.kind === 'agent' && i.library === null).map(i => i.id);
  const draw = (skipped: string[]): string => renderToStaticMarkup(createElement(ProtoProvider, { store }, createElement(HomeApp, { skipped } as Record<string, unknown>)));
  assert.equal([...draw([]).matchAll(/data-drop-agent=/g)].length, 10);
  assert.equal([...draw(agentIds.slice(0, 3)).matchAll(/data-drop-agent=/g)].length, 7);
  assert.match(draw(agentIds.slice(0, 3)), /7 agents/);
});

test('the Find and Welcome style sheet has no text under 14 px and no fixed time', () => {
  const css = readFileSync(join(DESKTOP, 'renderer/home/first-run/find.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /(?<![-\w])\d+(\.\d+)?m?s\b(?![^;{}]*var\()/, 'a fixed time');
  for (const m of css.matchAll(/(transition|animation)\s*:\s*([^;]+);/g)) assert.match(m[2]!, /var\(--motion-|none/, m[0]);
  for (const m of css.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)) assert.ok(parseFloat(m[1]!) * (m[2] === 'rem' ? 16 : 1) >= 14, m[0]);
  assert.doesNotMatch(css, /infinite/, 'nothing loops');
});
