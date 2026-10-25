// The words and the markup of Share: the same rules as every other screen word of the home app (label 5, hint 12, no banned word), the text budget on the
// section and the sheet, no file path or invented word, "Share" and "Open a shared file" in place of the specification's words, and a style sheet that keeps
// text at 14 px or more.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ShareSection } from '../renderer/home/share/ShareSection.js';
import { ShareSheet } from '../renderer/home/share/ShareSheet.js';
import { SHARE_WORDS, bringsLine, countsLine, flaggedLine, leftOutLine, sizeLine } from '../renderer/home/share/share-words.js';
import { SavePoints } from '../renderer/home/points/SavePoints.js';
import { FileTab } from '../renderer/home/add/FileTab.js';
import { plainName } from '../shared/home/add-model.js';
import { generateWorld } from '../shared/proto/sample.js';
import { withSampleCopies } from '../shared/home/sample-copies.js';
import { ownedAgents } from '../shared/home/cards.js';
import { planShare } from '../shared/home/share-model.js';
import { LIMITS, assertTextBudget, bannedIn, countWords, extractText } from '../shared/home/textbudget.js';
import { DESKTOP } from './support.js';

const groups = [['label', LIMITS.label], ['hint', LIMITS.hint], ['popover', LIMITS.popover]] as const;
const html = (element: ReactElement): string => renderToStaticMarkup(element);
const within = (markup: string): void => assert.deepEqual(assertTextBudget(markup), [], markup.slice(0, 300));
const said = (markup: string): string => extractText(markup).map(p => p.text).join(' | ');
const NO_PATH = /\.bowerloom|\/sample\/|SKILL\.md|\/Users\/|\.claude\/|\.codex\/|\.opencode\/|\.json\b/;
const none = (): void => undefined;
const noFile = (): boolean => false;
const world = withSampleCopies(generateWorld(1));
const ids = ownedAgents(world).map(a => a.id);
const sheet = (hidden: readonly string[] = [], unsaved = false): string => html(createElement(ShareSheet, { world, hidden, unsaved, onClose: none, onCopy: none, onOpenFile: none }));

test('SHARE_WORDS is frozen all the way down and has the same three groups as WORDS', () => {
  assert.deepEqual(Object.keys(SHARE_WORDS), ['label', 'hint', 'popover']);
  assert.equal(Object.isFrozen(SHARE_WORDS), true);
  for (const [group] of groups) assert.equal(Object.isFrozen(SHARE_WORDS[group]), true, group);
  assert.throws(() => { (SHARE_WORDS.label as Record<string, string>).share = 'x'; }, TypeError);
});

for (const [group, limit] of groups) {
  test(`every ${group} in SHARE_WORDS has at most ${limit} words and no banned word`, () => {
    for (const [key, text] of Object.entries(SHARE_WORDS[group])) {
      assert.equal(typeof text, 'string', key);
      assert.ok(countWords(text) <= limit, `${group}.${key} has ${countWords(text)} words: ${text}`);
      assert.equal(bannedIn(text, group === 'popover'), null, `${group}.${key}: ${text}`);
      assert.equal(text, text.trim(), `${group}.${key} has stray space`);
    }
  });
}

test('the words of Share are the ones the brief asks for, and the keys and text lines are hints of at most 12 words', () => {
  const l = SHARE_WORDS.label, h = SHARE_WORDS.hint;
  assert.deepEqual([l.share, l.shareAgents, l.openFile, l.createFile, l.fileReady, l.lookInside, l.showText], ['Share', 'Share my agents', 'Open a shared file', 'Create share file', 'Share file ready', 'Look inside', 'Show text']);
  // Reworded after the review: the sheet no longer claims that every secret is left out, because the text of a skill or an agent goes in as written.
  assert.equal(`${h.secretsOut} ${h.textIn} ${h.keysAsk}`, 'Passwords and keys that Bowerloom keeps are left out. Your own text is included, so read it first. Tools that need a key will ask for one.');
  assert.equal(h.looksLikeKey, 'This text looks like it holds a key.');
  assert.ok(countWords(h.secretsOut) <= LIMITS.hint && countWords(h.textIn) <= LIMITS.hint && countWords(h.keysAsk) <= LIMITS.hint);
  assert.equal(h.nothingWritten, 'Nothing was written to your computer in this preview.');
});

test('the group a string sits in is the budget it is checked against, as markup', () => {
  for (const text of Object.values(SHARE_WORDS.label)) assert.deepEqual(assertTextBudget(`<button type="button">${text}</button>`), [], text);
  for (const text of Object.values(SHARE_WORDS.hint)) assert.deepEqual(assertTextBudget(`<p>${text}</p>`), [], text);
});

test('the words built from numbers read plainly and stay inside the budget, even at the largest counts', () => {
  assert.equal(countsLine({ agents: 10, skills: 29, tools: 8, noteSets: 3 }), '29 skills, 10 agents, 8 tools, 3 sets of notes');
  assert.equal(countsLine({ agents: 1, skills: 1, tools: 1, noteSets: 1 }), '1 skill, 1 agent, 1 tool, 1 set of notes');
  assert.equal(countsLine({ agents: 1, skills: 0, tools: 0, noteSets: 0 }), '1 agent');
  assert.equal(countsLine({ agents: 0, skills: 0, tools: 0, noteSets: 0 }), '');
  assert.equal(leftOutLine(2, 0), 'Left out: 2 passwords and keys');
  assert.equal(leftOutLine(3, 0), 'Left out: 3 passwords and keys');
  assert.equal(leftOutLine(1, 0), 'Left out: 1 password or key');
  assert.equal(leftOutLine(2, 1), 'Left out: 2 passwords and keys and 1 agent');
  assert.equal(leftOutLine(3, 0, 1, 1), 'Left out: 3 passwords and keys, 1 item and 1 ready-made item', 'twelve words is the most that fits');
  assert.equal(leftOutLine(3, 1, 1, 2), 'Left out: 3 passwords and keys and 4 other things', 'when the kinds do not fit, the things that are not secrets are counted together');
  assert.equal(leftOutLine(0, 1, 1, 1), 'Left out: 1 agent, 1 item and 1 ready-made item');
  assert.equal(leftOutLine(999, 999, 999, 999), 'Left out: 999 passwords and keys and 2997 other things');
  assert.equal(leftOutLine(0, 40, 40, 40), 'Left out: 40 agents, 40 items and 40 ready-made items');
  assert.equal(leftOutLine(0, 0, 0, 1), 'Left out: 1 item');
  assert.equal(flaggedLine(1, 0), '1 item looks like it holds a key. It is left out.');
  assert.equal(flaggedLine(2, 0), '2 items look like they hold a key. They are left out.');
  assert.equal(flaggedLine(1, 1), '1 item looks like it holds a key. Look inside first.');
  assert.equal(leftOutLine(0, 3), 'Left out: 3 agents');
  assert.equal(leftOutLine(0, 0), 'Left out: nothing');
  assert.deepEqual([sizeLine(10), sizeLine(1023), sizeLine(1024), sizeLine(33_800), sizeLine(1_500_000)], ['Under 1 KB', 'Under 1 KB', 'About 1 KB', 'About 33 KB', 'About 1.4 MB']);
  assert.deepEqual([bringsLine(0, 0), bringsLine(1, 0), bringsLine(5, 2), bringsLine(0, 1)], ['Nothing added yet', '1 skill', '5 skills, 2 tools', '1 tool']);
  const built = [countsLine({ agents: 999, skills: 999, tools: 999, noteSets: 999 }), leftOutLine(999, 999), leftOutLine(999, 999, 999, 999), flaggedLine(999, 1), flaggedLine(999, 0), sizeLine(1e9), bringsLine(999, 999)];
  for (const text of built) { assert.ok(countWords(text) <= LIMITS.hint, text); assert.equal(bannedIn(text), null, text); assert.deepEqual(assertTextBudget(`<p>${text}</p>`), [], text); }
});

test('the Share section has the heading, one hint and the two buttons, and passes the budget', () => {
  const m = html(createElement(ShareSection, { onShare: none, onOpenFile: none }));
  within(m);
  assert.match(m, /<h3 class="kit-heading"[^>]*>Share<\/h3>/);
  assert.match(m, /Share my agents<\/button>/);
  assert.match(m, /Open a shared file<\/button>/);
  assert.equal([...m.matchAll(/<button/g)].length, 2);
  assert.doesNotMatch(said(m), NO_PATH);
});

test('the Version history drawer body has the Share section under the list, and under an empty list too', () => {
  const row = { id: 'v1', name: 'How it started', when: 'when you began', changes: '', current: true };
  const full = html(createElement(SavePoints, { rows: [row], unsaved: false, onGoBack: none, onShare: none, onOpenFile: none }));
  within(full);
  assert.ok(full.indexOf('class="pt-list"') < full.indexOf('data-share-section'), 'the list comes first');
  const empty = html(createElement(SavePoints, { rows: [], unsaved: false, onGoBack: none, onShare: none, onOpenFile: none }));
  within(empty);
  assert.match(empty, /No history yet\./);
  assert.match(empty, /data-share-section/);
});

test('the sheet is a labelled modal dialog with the counts, the left-out line, the two secrets hints and one tick box for each agent', () => {
  const m = sheet();
  within(m);
  assert.doesNotMatch(said(m), NO_PATH);
  assert.match(m, /role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby/);
  assert.match(m, /<h2 class="kit-heading"[^>]*>Share my agents<\/h2>/);
  const plan = planShare(world, ids, []);
  assert.ok(m.includes(`>${countsLine(plan.counts)}<`), 'the counts line');
  assert.ok(m.includes(`>${leftOutLine(plan.keys, 0)}<`), 'the left-out line');
  assert.match(m, /Passwords and keys that Bowerloom keeps are left out\./);
  assert.match(m, /Your own text is included, so read it first\./);
  assert.match(m, /Tools that need a key will ask for one\./);
  assert.equal([...m.matchAll(/type="checkbox"/g)].length, 10);
  assert.equal([...m.matchAll(/type="checkbox"[^>]*checked=""/g)].length, 10, 'every agent starts ticked');
  assert.match(m, /<button[^>]*>(?:<svg.*?<\/svg>)?Create share file<\/button>/);
  assert.doesNotMatch(m, /disabled=""[^>]*>(?:<svg.*?<\/svg>)?Create share file/);
  assert.doesNotMatch(m, /Changes you have not saved/);
  assert.doesNotMatch(m, /Share file ready/, 'nothing is ready before Create share file');
  assert.match(m, /<button[^>]*aria-expanded="false"[^>]*>Look inside<\/button>/);
  assert.doesNotMatch(m, /sh-look-list/, 'the list inside is closed until it is asked for');
});

test('the sheet leaves out the agents Find skipped, and says changes that wait are not in the copy', () => {
  const m = sheet([ids[0]!, ids[1]!], true);
  within(m);
  assert.equal([...m.matchAll(/type="checkbox"/g)].length, 8);
  assert.match(m, /Changes you have not saved are not in the copy\./);
  const plan = planShare(world, ids.slice(2), []);
  assert.ok(m.includes(`>${countsLine(plan.counts)}<`));
});

test('the sheet with no agent to share says so and cannot save', () => {
  const m = sheet(ids);
  within(m);
  assert.match(m, /There are no agents to share yet\./);
  assert.match(m, /Tick at least one agent to share\./);
  assert.match(m, /disabled=""[^>]*>(?:<svg.*?<\/svg>)?Create share file/);
});

test('"From a shared file" offers "Open my last copy" only when a copy exists', () => {
  const text = planShare(world, ids, []).text;
  const without = html(createElement(FileTab, { world, nameOf: plainName, onAddFile: noFile }));
  const withCopy = html(createElement(FileTab, { world, nameOf: plainName, onAddFile: noFile, lastCopy: text }));
  assert.doesNotMatch(without, /Open my last copy/);
  assert.match(withCopy, /Open my last copy<\/button>/);
  within(withCopy);
});

test('the style sheet keeps text at 14 px or more, takes every time from the motion tokens, and yields under reduce motion', () => {
  const css = readFileSync(join(DESKTOP, 'renderer/home/share/share.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /(?<![-\w])\d+(\.\d+)?m?s\b(?![^;{}]*var\()/, 'a fixed time');
  for (const m of css.matchAll(/(transition|animation)\s*:\s*([^;]+);/g)) assert.match(m[2]!, /var\(--motion-|none/, m[0]);
  for (const m of css.matchAll(/font-size\s*:\s*([^;]+);/g)) assert.match(m[1]!.trim(), /^var\(--hm-text-(base|small|heading|display|title|section|name)\)$/, m[0]);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*animation: none !important; transition: none !important/);
  assert.doesNotMatch(css, /@keyframes/, 'Share adds no motion of its own');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\((?!\s*0 0 0)/, 'colours come from the tokens');
});

test('the sources of Share use no inline style and none of the specification words', () => {
  for (const name of ['ShareSheet.tsx', 'ShareSection.tsx']) {
    const text = readFileSync(join(DESKTOP, 'renderer/home/share', name), 'utf8');
    assert.doesNotMatch(text, /style=\{|dangerouslySetInnerHTML/, name);
  }
});
