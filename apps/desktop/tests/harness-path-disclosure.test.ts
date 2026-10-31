// A file path is out of sight until "Show details" is pressed. The one disclosure of the harness screens: a real button with aria-expanded and aria-controls,
// a name that says what it opens, and a path element that is always in the page (hidden while closed) so the name always points at something.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PathDisclosure } from '../renderer/harness/parts/PathDisclosure.js';
import { WORDS, detailsName } from '../renderer/harness/words.js';
import { bannedHere, countWords, LIMITS } from '../shared/harness/words.js';

const markup = (path: string, subject: string): string => renderToStaticMarkup(createElement(PathDisclosure, { path, subject }));

test('closed: a "Show details" button with aria-expanded false names its path element, which is hidden', () => {
  const m = markup('skills/writer/SKILL.md', 'Writer');
  assert.match(m, /<button aria-expanded="false" aria-controls="([^"]+)" aria-label="Show details for Writer" type="button"[^>]*>Show details<\/button>/);
  const id = /aria-controls="([^"]+)"/.exec(m)![1]!;
  assert.match(m, new RegExp(`<p[^>]*id="${id.replace(/[:]/g, '\\$&')}"[^>]*hidden=""[^>]*>skills/writer/SKILL\\.md</p>`), 'the path is in the page and hidden, so aria-controls resolves');
});

test('the shown words are inside the button name, so a voice command by the shown words works', () => {
  for (const open of [false, true]) {
    const shown = open ? WORDS.label.hideDetails : WORDS.label.showDetails;
    assert.ok(detailsName(open, 'Writer').startsWith(shown), shown);
  }
  assert.equal(detailsName(true, 'Writer'), 'Hide details for Writer');
});

test('the words of the disclosure obey the limits and the banned list', () => {
  for (const text of [WORDS.label.showDetails, WORDS.label.hideDetails, detailsName(false, 'Writer'), detailsName(true, 'Writer')]) {
    assert.ok(countWords(text) <= LIMITS.hint, text); assert.equal(bannedHere(text), null, text);
  }
});

test('a path is the person\'s own text: markup in it is escaped, never drawn', () => {
  const m = markup('<img src=x onerror=alert(1)>', 'Writer');
  assert.ok(!m.includes('<img'), m);
  assert.ok(m.includes('&lt;img'), m);
});
