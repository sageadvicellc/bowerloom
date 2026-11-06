// U17: text shown for review writes out every character that can hide or fake text, and marks a word that mixes scripts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasHidden, visible } from '../shared/engine/scrub.js';

test('every hiding character the reviewer listed is written out as a visible mark, astral ones included', () => {
  const cases: [string, string][] = [
    ['\u{E0041}', '[U+E0041]'], ['\u{E007F}', '[U+E007F]'], ['\u{E0100}', '[U+E0100]'], ['️', '[U+FE0F]'], ['⠀', '[U+2800]'], ['͏', '[U+034F]'],
    [' ', '[U+2028]'], [' ', '[U+2029]'], ['᠋', '[U+180B]'], ['᠍', '[U+180D]'], [' ', '[U+00A0]'], [' ', '[U+2007]'], [' ', '[U+202F]'],
    [' ', '[U+205F]'], ['　', '[U+3000]'], [' ', '[U+1680]'], ['‮', '[U+202E]'], ['​', '[U+200B]'],
  ];
  for (const [ch, shown] of cases) {
    assert.equal(visible(`a${ch}b`), `a${shown}b`, shown);
    assert.equal(hasHidden(`a${ch}b`), true, shown);
  }
  assert.equal(visible('rm -rf\tx\ny'), 'rm -rf\tx\ny', 'tab, line feed and plain spaces stay');
  assert.equal(visible('😀 café'), '😀 café', 'a real emoji and a real accent stay');
});

test('a word that mixes scripts is marked, a word in one script is not', () => {
  assert.equal(visible('pаypal'), '[mixed scripts: Latin+Cyrillic]pаypal', 'Cyrillic а inside a Latin word');
  assert.equal(visible('Ехample ok'), '[mixed scripts: Latin+Cyrillic]Ехample ok');
  assert.equal(visible('привет world'), 'привет world', 'two words, each in one script');
  assert.equal(visible('git push --force'), 'git push --force');
  assert.equal(hasHidden('pаypal'), true);
});
