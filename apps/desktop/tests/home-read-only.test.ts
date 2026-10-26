// Wave F, read-only mode, drawn to markup: the controls that would change the setup are shown but held back (aria-disabled, a plain reason in the tooltip), the Save bar says
// so, the Preview mark says "Read-only", and everything that only looks still works. With read only off, the same page is exactly as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HomeApp } from '../renderer/home/HomeApp.js';
import { HomeFlow } from '../renderer/home/HomeFlow.js';
import { LibraryPage } from '../renderer/home/library/LibraryPage.js';
import { DetailsPanel } from '../renderer/home/details/DetailsPanel.js';
import { SaveBar } from '../renderer/home/save/SaveBar.js';
import { Sidebar } from '../renderer/home/shell/Sidebar.js';
import { ReadOnlyFlag, ReadOnlyScope } from '../renderer/home/read-only.js';
import { loadWorld } from '../renderer/proto/world.js';
import { createStore } from '../shared/proto/store.js';
import { withLibrarySamples } from '../shared/home/library-sample.js';
import { withSampleCopies } from '../shared/home/sample-copies.js';
import { withStarterAgents } from '../shared/home/starters.js';
import { withStartPoint, saveBar } from '../shared/home/savebar.js';
import { ownedAgents, shelvesOf } from '../shared/home/cards.js';
import { detailsOf } from '../shared/home/details.js';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { WORDS } from '../renderer/home/words.js';

const none = (): void => undefined;
const REASON = 'Read-only: your setup is not changed.';
const store = () => createStore(withStartPoint(withLibrarySamples(withStarterAgents(withSampleCopies(loadWorld())))));
const draw = (readOnly: boolean, element: ReactElement): string => renderToStaticMarkup(createElement(ReadOnlyScope, { readOnly, store: store() }, element));
const within = (m: string): void => assert.deepEqual(assertTextBudget(m), [], m.slice(0, 120));

test('read only, the map is drawn with the Save bar saying so, Save held back, and the mark reading Read-only', () => {
  const m = draw(true, createElement(HomeApp));
  assert.match(m, /<p>Read-only\. Nothing here changes your setup\.<\/p>/);
  assert.match(m, /<button[^>]*aria-disabled="true"[^>]*data-variant="primary"[^>]*>Save<\/button>/);
  assert.doesNotMatch(m, /Nothing to save yet/);
  assert.match(m, /<button[^>]*class="kit-status kit-help-text"[^>]*aria-label="About read-only mode"[^>]*><span class="kit-dot"[^>]*><\/span><span>Read-only<\/span>/);
  assert.doesNotMatch(m, />Preview</);
  assert.match(m, new RegExp(`role="tooltip"[^>]*>${REASON.replace(/[.]/g, '\\.')}<`));
  within(m);
});

test('with read only off the page is as it was: Nothing to save yet, Save natively disabled, the Preview mark, and no reason anywhere', () => {
  const m = draw(false, createElement(HomeApp));
  assert.match(m, /Nothing to save yet/); assert.match(m, /<button disabled=""[^>]*data-variant="primary"[^>]*>Save<\/button>/);
  assert.match(m, /aria-label="About this preview"[^>]*><span class="kit-dot"[^>]*><\/span><span>Preview<\/span>/);
  assert.doesNotMatch(m, /Read-only|aria-disabled|data-readonly/);
});

test('the mark\'s popover says the setup is the person\'s own when real data is loaded, and "Read-only preview." otherwise', () => {
  const popover = (real: boolean): string => draw(true, createElement(Sidebar, {
    mode: 'open', overlay: false, view: 'agents', libraryKind: 'skill', libraryOpen: true, addOpen: false, historyOpen: false, findOpen: false, readOnly: true, real,
    onToggle: none, onAgents: none, onLibrary: none, onAdd: none, onFind: none, onShare: none, onHistory: none, onTour: none, onHow: none,
  }));
  assert.match(popover(false), /aria-label="About read-only mode"/); assert.doesNotMatch(popover(false), /You are looking at your setup/);
  // The popover is closed when drawn; its sentences are in the words table for the page to show.
  assert.equal(WORDS.popover.readOnlyReal, 'You are looking at your setup. Nothing here changes it.'); assert.equal(WORDS.popover.readOnlySample, 'Read-only preview.');
  within(`<div data-budget="popover"><p>${WORDS.popover.readOnlyReal}</p></div><div data-budget="popover"><p>${WORDS.popover.readOnlySample}</p></div>`);
});

test('HomeApp takes a dataSource prop that defaults to sample', () => {
  assert.match(draw(true, createElement(HomeApp, { dataSource: 'real' } as Record<string, unknown>)), /Read-only/);
  assert.match(draw(true, createElement(HomeApp)), /Read-only/);
});

test('read only, every Remove on the details of an agent is held back with the reason, and the cards themselves stay selectable', () => {
  const s = store(), w = s.getState().draft;
  const agent = ownedAgents(w).find(a => shelvesOf(w, a).skills.length > 0 && shelvesOf(w, a).notes.length > 0)!;
  const details = detailsOf(w, ownedAgents(w), { kind: 'agent', id: agent.id });
  const panel = (readOnly: boolean): string => renderToStaticMarkup(createElement(ReadOnlyFlag, { value: readOnly }, createElement(DetailsPanel, { details, onSelect: none, onRemove: none, onBadgePress: none, onChoose: none })));
  const held = panel(true), free = panel(false);
  const removes = [...held.matchAll(/<button[^>]*data-readonly=""[^>]*>/g)].map(x => x[0]);
  assert.ok(removes.length >= 3, 'each skill and note card has a Remove that is held back');
  assert.ok(removes.every(b => /aria-disabled="true"/.test(b) && /aria-label="Remove"/.test(b)));
  assert.ok([...held.matchAll(/class="kit-card-main"/g)].length > 0, 'the cards can still be pressed'); assert.doesNotMatch(held, /class="kit-card-main"[^>]*aria-disabled/);
  assert.doesNotMatch(free, /data-readonly|aria-disabled/);
  assert.match(held, /Choose notes/);
});

test('read only, the change list and the Undo of each change are held back, and Undo all changes is held back too', () => {
  const draw2 = (readOnly: boolean): string => renderToStaticMarkup(createElement(ReadOnlyFlag, { value: readOnly }, createElement(SaveBar, {
    model: saveBar(3, 1, null), ticks: [], onSave: none, onGoBack: none, onDiscard: none,
    list: { open: true, setOpen: none, entries: [{ key: 'a', text: 'Removed A', changes: 1, reason: null, undo: { at: [0] } }, { key: 'b', text: 'Removed B', changes: 1, reason: null, undo: { at: [1] } }], undo: none },
  })));
  const held = draw2(true);
  assert.match(held, /<button[^>]*aria-disabled="true"[^>]*>Undo all changes<\/button>/);
  assert.equal([...held.matchAll(/aria-label="Undo"[^>]*data-readonly=""|data-readonly=""[^>]*aria-label="Undo"/g)].length, 2, 'one held-back Undo for each change');
  assert.match(held, /Read-only\. Nothing here changes your setup\./);
  const free = draw2(false);
  assert.doesNotMatch(free, /data-readonly|aria-disabled/); assert.match(free, /<p>3 changes|3 changes/);
});

test('read only, the Library holds back Add to an agent, Make my own copy and Remove from library; its tabs, search and details are all there', () => {
  const m = draw(true, createElement(LibraryPage));
  assert.match(m, /role="tablist"/); assert.match(m, /type="search"/); assert.match(m, /aria-label="Sort"/);
  assert.doesNotMatch(m, /aria-disabled="true"[^>]*>Add from the web/, 'the web sheet opens: looking is not editing');
  within(m);
});

test('HomeFlow in read only opens Welcome, and the Welcome screen is not held back (the first scan only reads)', () => {
  const had = (globalThis as { location?: unknown }).location;
  (globalThis as { location?: unknown }).location = { hash: '#prototype-v2/readonly' };
  try {
    const m = renderToStaticMarkup(createElement(ReadOnlyScope, { readOnly: true, store: store(), children: createElement(HomeFlow) }));
    assert.match(m, /data-screen="welcome"/); assert.match(m, />Find my agents</); assert.doesNotMatch(m, /aria-disabled/);
  } finally { (globalThis as { location?: unknown }).location = had; }
});
