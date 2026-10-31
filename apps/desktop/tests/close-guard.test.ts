// The close guard (owner decision Q1A): closing the window, Cmd+Q, Cmd+W or a reload with unsaved Builder changes asks "Discard N changes?" in a native box.
// The window sets a `beforeunload` handler while any folder holds changes (renderer/harness/close-guard.ts). Electron cancels the unload without a word unless main
// handles `will-prevent-unload` (main/close-guard.ts), so main asks in its own box and the window cannot skip it or answer it. The tools come in as arguments, so
// this runs with no Electron and no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CLOSE_BUTTONS, closeGuard, closeQuestion } from '../main/close-guard.js';
import type { AskClose } from '../main/close-guard.js';
import { CLOSE_WORDS, TITLE_NAME, changesInTitle, discardWords, titleWithChanges } from '../shared/harness/close-words.js';
import { installCloseGuard } from '../renderer/harness/close-guard.js';
import type { UnloadEvent } from '../renderer/harness/close-guard.js';
import { FolderDraftProvider, folderDraftsReduce, totalChangeCount, useChangeCount } from '../renderer/harness/folder-draft.js';
import type { FolderDrafts } from '../renderer/harness/folder-draft.js';
import { WORDS } from '../renderer/harness/words.js';
import { LIMITS, bannedHere, countWords } from '../shared/harness/words.js';
import { EMPTY_DRAFT, linkSkill, removeSkill } from '../shared/harness/save-draft.js';
import type { Answer, DefinitionView, VersionView } from '../shared/engine/types.js';
import { DESKTOP } from './support.js';

const read = (path: string): string => readFileSync(join(DESKTOP, path), 'utf8');
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const BASE: DefinitionView = {
  id: 'weekly-report', description: 'Drafts the weekly report.', engines: ['claude-code', 'codex'], instructions: true,
  skills: [{ id: 'check-facts', name: 'check-facts', description: 'Checks each figure.' }, { id: 'draft-outline', name: 'draft-outline', description: 'Outlines it.' }],
  agents: [{ id: 'editor', name: 'editor', description: 'Edits.', skills: [], notes: [] }, { id: 'writer', name: 'writer', description: 'Writes.', skills: ['draft-outline'], notes: [] }],
  sources: [], kits: [],
};
const NONE: Answer<readonly VersionView[]> = { ok: true, value: [] };
const loaded = (s: FolderDrafts, folder: string): FolderDrafts => folderDraftsReduce(s, { kind: 'loaded', folder, base: BASE, versions: NONE });

// ---- the count

test('the total change count is the sum of the unsaved changes of every folder; a folder not read, or with no change, counts zero', () => {
  assert.equal(totalChangeCount({}), 0);
  let s = loaded(loaded({}, 'a'), 'b');
  assert.equal(totalChangeCount(s), 0);
  s = folderDraftsReduce(s, { kind: 'change', folder: 'a', next: d => linkSkill(BASE, d, 'editor', 'check-facts', true) });
  assert.equal(totalChangeCount(s), 1);
  s = folderDraftsReduce(s, { kind: 'change', folder: 'a', next: d => removeSkill(BASE, d, 'draft-outline', true) });
  const inA = totalChangeCount(s);
  assert.ok(inA >= 2, 'two edits in one folder');
  s = folderDraftsReduce(s, { kind: 'change', folder: 'b', next: d => linkSkill(BASE, d, 'editor', 'check-facts', true) });
  assert.equal(totalChangeCount(s), inA + 1, 'a second folder adds its own changes');
  s = folderDraftsReduce(s, { kind: 'discard', folder: 'a' });
  assert.equal(totalChangeCount(s), 1);
  s = folderDraftsReduce(s, { kind: 'saved', folder: 'b' });
  assert.equal(totalChangeCount(s), 0);
});

test('a folder with a draft but no base counts zero, and a folder named like a prototype property is a folder', () => {
  assert.equal(totalChangeCount({ x: { base: null, versions: null, stack: { past: [], present: EMPTY_DRAFT, future: [], limit: 50 }, positions: {} } }), 0);
  const s = loaded({}, '__proto__');
  assert.equal(totalChangeCount(s), 0);
});

test('useChangeCount reads the total from the provider', () => {
  let s = loaded({}, 'a');
  s = folderDraftsReduce(s, { kind: 'change', folder: 'a', next: d => linkSkill(BASE, d, 'editor', 'check-facts', true) });
  const Probe = (): ReturnType<typeof createElement> => createElement('span', null, String(useChangeCount()));
  assert.match(renderToStaticMarkup(createElement(FolderDraftProvider, { initial: s }, createElement(Probe))), />1</);
  assert.match(renderToStaticMarkup(createElement(FolderDraftProvider, { initial: {} }, createElement(Probe))), />0</);
});

// ---- the page title, which carries the count to main without a channel

test('the title carries the count, and only a clean count comes back out of it', () => {
  assert.equal(titleWithChanges('Bowerloom', 0), 'Bowerloom');
  assert.equal(titleWithChanges('Bowerloom', 1), 'Bowerloom, 1 unsaved change');
  assert.equal(titleWithChanges('Bowerloom', 4), 'Bowerloom, 4 unsaved changes');
  assert.equal(changesInTitle('Bowerloom'), null);
  assert.equal(changesInTitle('Bowerloom, 1 unsaved change'), 1);
  assert.equal(changesInTitle('Bowerloom, 12 unsaved changes'), 12);
  for (const bad of ['', 'Bowerloom, 0 unsaved changes', 'Bowerloom, -3 unsaved changes', 'Bowerloom, 1.5 unsaved changes', 'Bowerloom, 1e3 unsaved changes', 'Bowerloom, 99999999 unsaved changes', 'Bowerloom, 0x10 unsaved changes', 'Bowerloom, 3 unsaved changes!', 'Elsewhere, 3 unsaved changes', 'Bowerloom, 3 unsaved changes\nDiscard everything?']) assert.equal(changesInTitle(bad), null, JSON.stringify(bad));
  for (const odd of [undefined, null, 5, {}] as unknown[]) assert.equal(changesInTitle(odd as string), null);
});

// ---- the question

test('the question says "Discard N changes?", with the buttons Keep editing and Discard and one line that the changes are not saved', () => {
  const q = closeQuestion(3);
  assert.equal(q.title, 'Discard 3 changes?');
  assert.equal(q.message, 'Discard 3 changes?');
  assert.deepEqual([...q.buttons], ['Keep editing', 'Discard']);
  assert.deepEqual([...CLOSE_BUTTONS], ['Keep editing', 'Discard']);
  assert.equal(q.defaultId, 0);
  assert.equal(q.cancelId, 0);
  assert.equal(q.noLink, true);
  assert.equal(q.detail, CLOSE_WORDS.note);
  assert.match(q.detail, /not saved/);
  assert.equal(closeQuestion(1).title, 'Discard 1 change?');
});

test('a title with no count still asks, in general words', () => {
  const q = closeQuestion(null);
  assert.equal(q.title, 'Discard your changes?');
  assert.deepEqual([...q.buttons], ['Keep editing', 'Discard']);
});

test('the words are the screen\'s own, and obey the limits and the banned words', () => {
  assert.equal(TITLE_NAME, WORDS.label.appName);
  assert.equal(CLOSE_WORDS.keep, WORDS.label.keepEditing);
  assert.equal(CLOSE_WORDS.discard, WORDS.label.discard);
  assert.equal(discardWords(3), 'Discard 3 changes?');
  for (const text of [closeQuestion(1).title, closeQuestion(250).title, closeQuestion(null).title, CLOSE_WORDS.keep, CLOSE_WORDS.discard]) {
    assert.equal(bannedHere(text), null, text);
    assert.ok(countWords(text) <= LIMITS.label + 1, text);
  }
  assert.equal(bannedHere(CLOSE_WORDS.note), null);
  assert.ok(countWords(CLOSE_WORDS.note) <= LIMITS.hint, CLOSE_WORDS.note);
  assert.doesNotMatch(CLOSE_WORDS.note, /n't|'s|'re|'ll|'ve/);
});

// ---- main's handler

interface Probe { asked: ReturnType<typeof closeQuestion>[]; prevented: number; handler(): void }
function probe(answer: number | Error, title: string): Probe {
  const asked: ReturnType<typeof closeQuestion>[] = [];
  const p: Probe = {
    asked, prevented: 0,
    handler() {
      const ask: AskClose = options => { asked.push(options as ReturnType<typeof closeQuestion>); if (answer instanceof Error) throw answer; return answer; };
      closeGuard({ title: () => title, ask })({ preventDefault: () => { p.prevented++; } });
    },
  };
  return p;
}

test('Discard (button 1) lets the page unload: the event is prevented, so Electron ignores the page\'s hold', () => {
  const p = probe(1, titleWithChanges('Bowerloom', 3));
  p.handler();
  assert.equal(p.prevented, 1);
  assert.equal(p.asked.length, 1);
  assert.equal(p.asked[0]!.title, 'Discard 3 changes?');
});

test('Keep editing (button 0) leaves the event alone, so the window stays', () => {
  const p = probe(0, titleWithChanges('Bowerloom', 3));
  p.handler();
  assert.equal(p.prevented, 0);
  assert.equal(p.asked.length, 1);
});

test('any other answer, and a box that fails, keep the window', () => {
  for (const answer of [2, -1, NaN, 1.5, 7]) { const p = probe(answer, titleWithChanges('Bowerloom', 2)); p.handler(); assert.equal(p.prevented, 0, String(answer)); }
  const failed = probe(new Error('no box'), titleWithChanges('Bowerloom', 2));
  assert.doesNotThrow(() => failed.handler());
  assert.equal(failed.prevented, 0);
});

test('a page that lies about its count cannot change the words, skip the box, or answer it', () => {
  const p = probe(0, 'Bowerloom, 5 unsaved changes\nDiscard 1 change?');
  p.handler();
  assert.equal(p.asked.length, 1, 'the box still shows');
  assert.equal(p.asked[0]!.title, 'Discard your changes?');
  assert.equal(p.prevented, 0);
});

test('the question is asked once for each event, with the title read at that moment', () => {
  let title = titleWithChanges('Bowerloom', 1), asks = 0;
  const handler = closeGuard({ title: () => title, ask: o => { asks++; assert.match(o.title, /^Discard \d+ changes?\?$/); return 0; } });
  handler({ preventDefault() { /* kept */ } });
  title = titleWithChanges('Bowerloom', 9);
  handler({ preventDefault() { /* kept */ } });
  assert.equal(asks, 2);
});

// ---- the window's handler

class FakeTarget {
  readonly listeners: { type: string; fn: (e: UnloadEvent) => void }[] = [];
  addEventListener(type: 'beforeunload', fn: (e: UnloadEvent) => void): void { this.listeners.push({ type, fn }); }
  removeEventListener(type: 'beforeunload', fn: (e: UnloadEvent) => void): void { const i = this.listeners.findIndex(l => l.type === type && l.fn === fn); if (i >= 0) this.listeners.splice(i, 1); }
}

test('with changes the window holds the unload: beforeunload is cancelled and returnValue is set; the title carries the count', () => {
  const target = new FakeTarget(), doc = { title: '' };
  installCloseGuard(target, doc, 3);
  assert.equal(doc.title, 'Bowerloom, 3 unsaved changes');
  assert.equal(target.listeners.length, 1);
  assert.equal(target.listeners[0]!.type, 'beforeunload');
  const event = { prevented: false, returnValue: undefined as unknown, preventDefault() { this.prevented = true; } };
  target.listeners[0]!.fn(event);
  assert.equal(event.prevented, true);
  assert.equal(typeof event.returnValue, 'string');
  assert.notEqual(event.returnValue, '');
});

test('with no change the window sets no handler and the title is the app\'s name', () => {
  const target = new FakeTarget(), doc = { title: 'stale' };
  installCloseGuard(target, doc, 0);
  assert.equal(target.listeners.length, 0);
  assert.equal(doc.title, 'Bowerloom');
});

test('the cleanup takes the handler away, so a later count sets exactly one', () => {
  const target = new FakeTarget(), doc = { title: '' };
  const stop = installCloseGuard(target, doc, 2);
  assert.equal(target.listeners.length, 1);
  stop();
  assert.equal(target.listeners.length, 0);
  const again = installCloseGuard(target, doc, 4);
  assert.equal(target.listeners.length, 1);
  assert.equal(doc.title, 'Bowerloom, 4 unsaved changes');
  again();
  assert.equal(target.listeners.length, 0);
});

// ---- the wiring, and the rules that stay

test('main handles will-prevent-unload with the guard and a synchronous box; the window gets no new channel, and cannot answer', () => {
  const main = strip(read('main/main.ts'));
  assert.match(main, /'will-prevent-unload'/);
  assert.match(main, /closeGuard\(/);
  assert.match(main, /showMessageBoxSync\(/);
  assert.equal([...main.matchAll(/ipcMain\.\w+/g)].length, 0);
  const guard = strip(read('main/close-guard.ts'));
  assert.doesNotMatch(guard, /ipcMain|ipcRenderer|executeJavaScript|process\.env|require\(/);
  const renderer = strip(read('renderer/harness/close-guard.ts'));
  assert.doesNotMatch(renderer, /ipcRenderer|bridge|getBridge|engine/i);
});
