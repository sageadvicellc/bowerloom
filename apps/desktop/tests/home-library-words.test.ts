// The words and the markup of the Library page: the same rules as every other screen word of the home app (label 5, hint 12, popover 25, no banned word),
// the text budget on every rendered part, the data fields marked as content, no file path, no link built from a typed address, and a style sheet that
// takes every size, colour and time from the tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LIBRARY_KINDS, libraryDetails, libraryRows, removePlan, updateOf, entryOf } from '../shared/home/library-model.js';
import { SAMPLE_SOURCES } from '../shared/home/library-sources.js';
import { LIBRARY_MODEL_WORDS, agentSplitLine, hasLine, takesOffLine, usedByLine } from '../shared/home/library-model.js';
import { LIBRARY_WORDS, addItems, addedItems, addedTo, alreadyHere, changedLines, countLine, groupHeading, madeByLine, notUsedLabel, openSource, removedLine, sourceCounts, tabName, willBeCopies } from '../renderer/home/library/library-words.js';
import { LibraryDetails } from '../renderer/home/library/LibraryDetails.js';
import { LibraryHarness } from '../renderer/home/library/LibraryHarness.js';
import { LibraryPage } from '../renderer/home/library/LibraryPage.js';
import { RemoveDialog } from '../renderer/home/library/RemoveDialog.js';
import { UpdateDialog } from '../renderer/home/library/UpdateDialog.js';
import { WebSheet } from '../renderer/home/library/WebSheet.js';
import { LIBRARY_HASH } from '../renderer/home/library/route.js';
import { ProtoProvider } from '../renderer/proto/session.js';
import { createStore } from '../shared/proto/store.js';
import { LIMITS, assertTextBudget, bannedIn, countWords, extractText } from '../shared/home/textbudget.js';
import { DESKTOP } from './support.js';
import { libraryWorld } from './home-library-world.js';

const groups = [['label', LIMITS.label], ['hint', LIMITS.hint], ['popover', LIMITS.popover]] as const;
const FIVE = 'One two three four five';
const html = (element: ReactElement): string => renderToStaticMarkup(element);
const within = (markup: string): void => assert.deepEqual(assertTextBudget(markup), [], markup.slice(0, 300));
const said = (markup: string): string => extractText(markup).map(p => p.text).join(' | ');
const NO_PATH = /\.bowerloom|\/sample\/|SKILL\.md|\/Users\/|\.claude\/|\.codex\/|web\/|copies\/|alderhythe|tarnwick/;
const provided = (child: ReactElement) => createElement(ProtoProvider, { store: createStore(libraryWorld()) }, child);
const noop = (): void => undefined;

test('LIBRARY_WORDS is frozen all the way down and has the same three groups as WORDS', () => {
  assert.deepEqual(Object.keys(LIBRARY_WORDS), ['label', 'hint', 'popover']);
  assert.equal(Object.isFrozen(LIBRARY_WORDS), true);
  for (const [group] of groups) assert.equal(Object.isFrozen(LIBRARY_WORDS[group]), true, group);
  assert.throws(() => { (LIBRARY_WORDS.label as Record<string, string>).title = 'x'; }, TypeError);
});

for (const [group, limit] of groups) {
  test(`every ${group} in LIBRARY_WORDS has at most ${limit} words and no banned word`, () => {
    for (const [key, text] of Object.entries(LIBRARY_WORDS[group])) {
      assert.equal(typeof text, 'string', key);
      assert.ok(countWords(text) <= limit, `${group}.${key} has ${countWords(text)} words: ${text}`);
      assert.equal(bannedIn(text, group === 'popover'), null, `${group}.${key}: ${text}`);
      assert.equal(text, text.trim(), `${group}.${key} has stray space`);
    }
  });
}

test('the words of the page are the ones the brief asks for', () => {
  const l = LIBRARY_WORDS.label, h = LIBRARY_WORDS.hint;
  assert.deepEqual([l.title, l.skills, l.agents, l.tools, l.notes, l.byName, l.byAdded, l.addFromWeb], ['Library', 'Skills', 'Agents', 'Tools', 'Notes', 'Name', 'Recently added', 'Add from the web']);
  assert.deepEqual([l.addToAgent, l.removeFromLibrary, l.makeCopy, l.update, l.useUpdate, l.hasIt], ['Add to an agent', 'Remove from library', 'Make my own copy', 'Update', 'Use the update', 'Has it']);
  assert.deepEqual([l.pasteLink, l.starterSources, l.open], ['Paste a link', 'Starter sources', 'Open']);
  assert.equal(h.honest, 'This preview opens sample sources only. Nothing is downloaded.');
  assert.equal(h.fromWeb, 'From the web. Read it before you add it.');
  assert.equal(h.badLink, 'That does not look like a link to a collection.');
  assert.equal(h.unknownLink, 'This preview cannot open that link. Try a sample source.');
  assert.deepEqual([LIBRARY_MODEL_WORDS.notUsed, LIBRARY_MODEL_WORDS.runsCode, LIBRARY_MODEL_WORDS.updateAvailable, LIBRARY_MODEL_WORDS.needsKey], ['Not used yet', 'Runs code', 'Update available', 'needs a key']);
  assert.equal(takesOffLine(3), 'This takes it off 3 agents.');
  assert.equal(usedByLine(3), 'Used by 3 agents');
  assert.equal(addItems(7), 'Add 7 items'); assert.equal(addItems(1), 'Add 1 item');
  assert.equal(LIBRARY_HASH, '#prototype-v2/library');
  assert.doesNotMatch(JSON.stringify(LIBRARY_WORDS), /version/i, 'only the exact phrase "version history" may carry that word, and it is not used here');
});

test('the group a string sits in is the budget it is checked against, as markup', () => {
  for (const text of Object.values(LIBRARY_WORDS.label)) assert.deepEqual(assertTextBudget(`<button type="button">${text}</button>`), [], text);
  for (const text of Object.values(LIBRARY_WORDS.hint)) assert.deepEqual(assertTextBudget(`<p>${text}</p>`), [], text);
  for (const text of Object.values(LIBRARY_WORDS.popover)) assert.deepEqual(assertTextBudget(`<div data-budget="popover"><p>${text}</p></div>`), [], text);
});

test('the words built from numbers and names stay inside the budget, even with five-word names', () => {
  const built = [
    countLine(0, 53, 'skill', true), countLine(5, 53, 'skill', true), countLine(53, 53, 'skill', false), countLine(1, 1, 'note', false), countLine(3, 3, 'note', false),
    addItems(0), addItems(1), addItems(250), alreadyHere(1), alreadyHere(12), willBeCopies(1), willBeCopies(3), addedTo(FIVE), removedLine(FIVE), addedItems(7), addedItems(1),
    openSource(FIVE), changedLines(1), changedLines(40), usedByLine(0), usedByLine(1), usedByLine(99), hasLine(12, 3)!, takesOffLine(0), takesOffLine(1), takesOffLine(10),
    sourceCounts({ skill: 3, agent: 1, tool: 4 }), sourceCounts({ skill: 0, agent: 0, tool: 1 }), groupHeading('skill'), groupHeading('agent'), groupHeading('tool'),
    notUsedLabel(0), notUsedLabel(22), notUsedLabel(120), `${agentSplitLine({ yours: 10, readyMade: 6 })}. ${LIBRARY_WORDS.hint.agentsNote}`, `Ready-made · ${hasLine(12, 3)!}`,
  ];
  for (const text of built) { assert.ok(countWords(text) <= LIMITS.hint, text); assert.equal(bannedIn(text), null, text); assert.deepEqual(assertTextBudget(`<p>${text}</p>`), [], text); }
  assert.ok(countWords(tabName(FIVE, 120)) <= 7);
  assert.ok(countWords(madeByLine('Dana Whitfield')) <= LIMITS.hint);
  assert.equal(notUsedLabel(22), 'Not used yet 22');
  assert.equal(`${agentSplitLine({ yours: 10, readyMade: 6 })}. ${LIBRARY_WORDS.hint.agentsNote}`, 'Yours 10 · Ready-made 6. Ready-made agents come with Bowerloom.');
  assert.equal(countLine(5, 53, 'skill', true), '5 of 53 skills');
  assert.equal(countLine(1, 1, 'note', false), '1 note set');
  assert.equal(sourceCounts({ skill: 3, agent: 1, tool: 4 }), '3 skills, 1 agent, 4 tools');
});

test('the page, with every kind of thing in its list, passes the budget and shows the kit card for every row', () => {
  const m = html(provided(createElement(LibraryPage)));
  within(m);
  assert.doesNotMatch(said(m), NO_PATH);
  assert.match(m, /<h1 class="kit-heading"[^>]*>Library<\/h1>/);
  assert.equal([...m.matchAll(/role="tab"/g)].length, 4);
  assert.match(m, /aria-selected="true"[^>]*data-kind="skill"/);
  assert.equal([...m.matchAll(/class="kit-card"/g)].length, 53, 'one kit card for each skill');
  assert.equal([...m.matchAll(/class="lb-row"/g)].length, 53);
  assert.match(m, /53 skills/);
  assert.match(m, /Not used yet/);
  assert.match(m, /Used by 3 agents/);
  assert.match(m, /Update available/);
  assert.match(m, /<h2 class="kit-heading"[^>]*>Pick something<\/h2>/);
  assert.match(m, /role="tabpanel"/);
  assert.doesNotMatch(m, /<a [^>]*href|dangerouslySetInnerHTML|style=/, 'no link and no inline style');
  assert.match(m, /Add from the web<\/button>/);
});

test('the test page renders in its own provider, with the Save bar and the Version history button', () => {
  const m = html(createElement(LibraryHarness));
  within(m);
  assert.match(m, /Nothing to save yet/);
  assert.match(m, /aria-label="Version history"/);
  assert.match(m, /Preview/);
});

test('the details of every thing in the library pass the budget and the data fields are content', () => {
  const w = libraryWorld();
  for (const kind of LIBRARY_KINDS) for (const r of libraryRows(w, kind)) {
    const d = libraryDetails(w, kind, r.id)!;
    const m = html(createElement(LibraryDetails, { details: d, choices: [], say: '', onPickAgent: noop, onOpenAgent: noop, onRemove: noop, onCopy: noop, onUpdate: noop, onBadgePress: noop }));
    within(m);
    assert.doesNotMatch(said(m), NO_PATH, r.id);
    if (d.origin.outside) assert.match(m, /data-budget="content" data-field="author"/, r.id);
    if (d.origin.release !== null) assert.match(m, /data-budget="content" data-field="release"/, r.id);
    assert.equal(/<(input|textarea)|contenteditable/.test(m), false, `${r.id}: the details are read only`);
  }
  const empty = html(createElement(LibraryDetails, { details: null, choices: [], say: '', onPickAgent: noop, onOpenAgent: noop, onRemove: noop, onCopy: noop, onUpdate: noop, onBadgePress: noop }));
  within(empty);
  assert.match(empty, /Pick something to see its details\./);
});

test('the dialogs pass the budget and say what the brief asks', () => {
  const w = libraryWorld();
  const plan = removePlan(w, 'skill', 'skill-010')!;
  const r = html(createElement(RemoveDialog, { name: plan.name, line: plan.line, agents: plan.agents, leaving: false, onClose: noop, onConfirm: noop }));
  within(r);
  assert.match(r, /role="dialog" aria-modal="true"/);
  assert.match(r, /Remove from the library\?/);
  assert.match(r, /This takes it off 3 agents\./);
  assert.match(r, /Nothing changes until you press Save\./);
  assert.match(r, /<button[^>]*>Cancel<\/button>/);
  const info = updateOf(w, entryOf(w, 'skill', 'web-open-skills-tidy-notes')!)!;
  const u = html(createElement(UpdateDialog, { name: 'Tidy my meeting notes', info, leaving: false, onClose: noop, onConfirm: noop }));
  within(u);
  assert.match(u, /What the update changes/);
  assert.match(u, /After the update/);
  assert.equal([...u.matchAll(/class="add-line-row"/g)].length, 7);
  assert.equal([...u.matchAll(/class="add-line-row" data-changed/g)].length, 3, 'one line changes now, two after');
  assert.match(u, /data-budget="content">v1\.2</);
  assert.match(u, /data-budget="content">v1\.3</);
  assert.match(u, /Use the update/);
});

test('the sheet passes the budget, says it is a sample first, and builds no link from a typed address', () => {
  const m = html(provided(createElement(WebSheet, { open: true, onClose: noop, onAdded: noop })));
  within(m);
  assert.match(m, /This preview opens sample sources only\. Nothing is downloaded\./);
  assert.match(m, /Paste a link/);
  assert.match(m, /Starter sources/);
  for (const s of SAMPLE_SOURCES) assert.match(m, new RegExp(`Open ${s.name}`));
  assert.doesNotMatch(m, /<a [^>]*href|dangerouslySetInnerHTML|style=/);
  assert.ok(m.indexOf('Nothing is downloaded') < m.indexOf('Paste a link'), 'the honest line comes first');
});

test('the style sheet has no size, colour or pill of its own: everything is a token, a calc of tokens or a border', () => {
  const css = readFileSync(join(DESKTOP, 'renderer/home/library/library.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, 'colours come from the tokens');
  assert.doesNotMatch(css, /border-radius\s*:\s*[^;]*(?:999|\d+(?:px|rem))/, 'no pill and no radius of its own');
  for (const m of css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)) {
    const prop = m[1]!, value = m[2]!;
    if (/^(border|outline|box-shadow)/.test(prop) && !/^border-radius/.test(prop)) continue;
    assert.doesNotMatch(value.replace(/var\([^)]*\)/g, ''), /(?<![\w.-])\d*\.?\d+(?:px|rem|em|vh|vw|ch)\b/, `${prop}: ${value}`);
  }
  for (const m of css.matchAll(/font-size\s*:\s*([^;]+);/g)) assert.match(m[1]!.trim(), /^var\(--hm-text-(base|small|heading|display)\)$/);
  assert.doesNotMatch(css, /(?<![-\w])\d+(\.\d+)?m?s\b(?![^;{}]*var\()/, 'a fixed time');
  for (const m of css.matchAll(/(transition|animation)\s*:\s*([^;]+);/g)) assert.match(m[2]!, /var\(--motion-|none/, m[0]);
  assert.match(readFileSync(join(DESKTOP, 'renderer/home/library/library.css'), 'utf8'), /prefers-reduced-motion: reduce[\s\S]*animation: none !important; transition: none !important/);
});

test('the sources of the Library use no inline style, no raw markup, no storage and no network', () => {
  const dir = join(DESKTOP, 'renderer/home/library');
  for (const name of readdirSync(dir).filter(f => /\.tsx?$/.test(f))) {
    const text = readFileSync(join(dir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(text, /style=\{|dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|\bfetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|window\.open|bowerloom/, name);
    assert.doesNotMatch(text, /href=/, `${name}: no link is built`);
  }
});
