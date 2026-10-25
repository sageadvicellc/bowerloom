// The words of the Add drawer and the copies dialog obey the same rules as every other screen word of the home app: label 5, hint 12, popover 25, no banned word.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADD_WORDS, addedTo, agentAdded, alreadyOn, changesCount, copyNumber, fileAdded, foundIn, keptCopy, keysNeeded, kindCount, kindWord, linesChanged, moreCount,
} from '../renderer/home/add/add-words.js';
import { ADD_MODEL_WORDS } from '../shared/home/add-model.js';
import { LIMITS, assertTextBudget, bannedIn, countWords } from '../shared/home/textbudget.js';
import { DESKTOP } from './support.js';

const groups = [['label', LIMITS.label], ['hint', LIMITS.hint], ['popover', LIMITS.popover]] as const;
const FIVE = 'One two three four five';

test('ADD_WORDS is frozen all the way down and has the same three groups as WORDS', () => {
  assert.deepEqual(Object.keys(ADD_WORDS), ['label', 'hint', 'popover']);
  assert.equal(Object.isFrozen(ADD_WORDS), true);
  for (const [group] of groups) assert.equal(Object.isFrozen(ADD_WORDS[group]), true, group);
  assert.throws(() => { (ADD_WORDS.label as Record<string, string>).addTo = 'x'; }, TypeError);
});

for (const [group, limit] of groups) {
  test(`every ${group} in ADD_WORDS has at most ${limit} words and no banned word`, () => {
    for (const [key, text] of Object.entries(ADD_WORDS[group])) {
      assert.equal(typeof text, 'string', key);
      assert.ok(countWords(text) <= limit, `${group}.${key} has ${countWords(text)} words: ${text}`);
      assert.equal(bannedIn(text, group === 'popover'), null, `${group}.${key}: ${text}`);
      assert.equal(text, text.trim(), `${group}.${key} has stray space`);
    }
  });
}

test('the storyboard words are used as written', () => {
  const l = ADD_WORDS.label;
  assert.deepEqual([l.skills, l.tools, l.notes, l.file, l.add], ['Skills', 'Tools', 'Notes', 'From a shared file', 'Add']);
  assert.equal(l.differentCopies, 'Two different copies');
  assert.equal(l.goBack, 'Go back');
});

test('the group a string sits in is the budget it is checked against, as markup', () => {
  for (const text of Object.values(ADD_WORDS.label)) assert.deepEqual(assertTextBudget(`<button type="button">${text}</button>`), [], text);
  for (const text of Object.values(ADD_WORDS.hint)) assert.deepEqual(assertTextBudget(`<p>${text}</p>`), [], text);
  for (const text of Object.values(ADD_MODEL_WORDS)) assert.deepEqual(assertTextBudget(`<p>${text}</p>`), [], text);
});

test('the words built from numbers and names stay inside the budget, even with five-word names', () => {
  const built = [
    addedTo(FIVE), alreadyOn(FIVE), agentAdded(FIVE), copyNumber(3), foundIn('Claude Code, Codex and OpenCode'), linesChanged(0), linesChanged(1), linesChanged(12),
    keptCopy(2, FIVE), changesCount(0), changesCount(1), changesCount(30), moreCount(115), fileAdded(1), fileAdded(40), keysNeeded(1), keysNeeded(3),
    kindCount('skill', 1), kindCount('note', 12), kindCount('tool', 2), kindCount('agent', 1), kindWord('note'),
    ['skill', 'agent', 'tool', 'note'].map(k => kindCount(k as 'skill', 12)).join(', '),
  ];
  for (const text of built) {
    assert.ok(countWords(text) <= LIMITS.hint, text);
    assert.equal(bannedIn(text), null, text);
    assert.deepEqual(assertTextBudget(`<p>${text}</p>`), [], text);
  }
  assert.equal(addedTo('Study buddy'), 'Added to Study buddy.');
  assert.equal(linesChanged(1), '1 line changed');
  assert.equal(changesCount(1), '1 change');
  assert.equal(changesCount(0), 'No changes yet');
});

test('the source scan of the home words covers the new folder and this table', () => {
  const found = readdirSync(join(DESKTOP, 'renderer/home'), { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => e.name);
  for (const name of ['add-words.ts', 'AddDrawerBody.tsx', 'CopiesDialog.tsx', 'FileTab.tsx', 'AddHarness.tsx']) assert.ok(found.includes(name), name);
});

test('the Add style sheet takes every duration from the motion tokens, keeps text at 14 px or more, and yields under reduce motion', () => {
  const css = readFileSync(join(DESKTOP, 'renderer/home/add/add.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /(?<![-\w])\d+(\.\d+)?m?s\b(?![^;{}]*var\()/, 'a fixed time');
  for (const m of css.matchAll(/(transition|animation)\s*:\s*([^;]+);/g)) assert.match(m[2]!, /var\(--motion-|none/, m[0]);
  for (const m of css.matchAll(/font-size\s*:\s*([^;]+);/g)) {
    const v = m[1]!.trim();
    assert.ok(/^var\(--hm-text-(base|small|heading|display)\)$/.test(v) || (/^[\d.]+rem$/.test(v) && parseFloat(v) >= 0.875), `font-size ${v}`);
  }
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*animation: none !important; transition: none !important/);
});

test('the only new motion is the wire: no other keyframes in the Add style sheet', () => {
  const css = readFileSync(join(DESKTOP, 'renderer/home/add/add.css'), 'utf8');
  assert.deepEqual([...css.matchAll(/@keyframes ([\w-]+)/g)].map(m => m[1]).sort(), ['add-link-dot', 'add-link-draw']);
});
