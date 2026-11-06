// What the window shows of the kept read: the time of the last read, a note when the folders changed, a note when the kept read could not be used, and one "Read again" control.
// The state machine is pure and is held here with no screen; the markup is drawn on the server with a made-up state. Nothing here reads a folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LastRead, SavedDamagedNote } from '../renderer/harness/real/LastRead.js';
import { SavedScanContext, firstSaved, savedReduce, startFromAnswer } from '../renderer/harness/real/saved-scan.js';
import type { SavedScanValue } from '../renderer/harness/real/saved-scan.js';
import { REAL, savedAtLine } from '../renderer/harness/real/words-real.js';
import { LIMITS, bannedHere, countWords } from '../shared/harness/words.js';
import type { RealPlace, RealResult } from '../shared/real/types.js';
import { generateWorld } from '../shared/world/sample.js';

const noop = (): void => undefined;
const value = (patch: Partial<SavedScanValue> = {}): SavedScanValue => ({ ...firstSaved(), readAgain: noop, markRead: noop, ...patch });
const draw = (v: SavedScanValue, element: ReturnType<typeof createElement>): string => renderToStaticMarkup(createElement(SavedScanContext, { value: v }, element));
const AT = Date.UTC(2026, 10, 5, 15, 12);

const place: RealPlace = {
  id: 'place-0123456789ab', label: 'Claude Code at home', kind: 'home', apps: ['Claude Code'], appLabel: 'Claude Code', counts: { agents: 0, skills: 0, tools: 0, hooks: 0, notes: 0 }, empty: true,
  details: { path: '~', folders: [], topics: [], notes: [] },
};
const result: RealResult = { world: generateWorld(1), others: [], counts: place.counts, ages: {}, stoppedEarly: false, couldNotRead: 0, partlyRead: 0, textsCut: 0, notes: [], readOnly: true };

// ---- the state

test('a launch with a kept read shows it, then learns whether the folders changed', () => {
  const start = savedReduce(firstSaved(), startFromAnswer({ status: 'saved', savedAtMs: AT, chosen: [place], result }));
  assert.deepEqual([start.readAtMs, start.fromSaved, start.checking, start.changed, start.damaged], [AT, true, true, false, false]);
  const same = savedReduce(start, { type: 'checked', forAtMs: AT, changed: false });
  assert.deepEqual([same.checking, same.changed], [false, false]);
  const changed = savedReduce(start, { type: 'checked', forAtMs: AT, changed: true });
  assert.deepEqual([changed.checking, changed.changed], [false, true]);
});

test('a check that answers after a newer read is dropped, so the note never belongs to an older read', () => {
  const start = savedReduce(firstSaved(), startFromAnswer({ status: 'saved', savedAtMs: AT, chosen: [place], result }));
  const newer = savedReduce(start, { type: 'read', atMs: AT + 5_000 });
  assert.deepEqual([newer.readAtMs, newer.fromSaved, newer.changed, newer.checking], [AT + 5_000, false, false, false]);
  assert.equal(savedReduce(newer, { type: 'checked', forAtMs: AT, changed: true }), newer);
});

test('a fresh read clears a damaged note, and a launch with no kept read or a damaged one starts clean', () => {
  const damaged = savedReduce(firstSaved(), startFromAnswer({ status: 'damaged', why: 'bad-shape' }));
  assert.deepEqual([damaged.damaged, damaged.readAtMs], [true, null]);
  const none = savedReduce(firstSaved(), startFromAnswer({ status: 'none' }));
  assert.deepEqual([none.damaged, none.readAtMs], [false, null]);
  assert.deepEqual([savedReduce(damaged, { type: 'read', atMs: AT }).damaged, savedReduce(damaged, { type: 'read', atMs: AT }).readAtMs], [false, AT]);
  // A kept read the window could not draw is told as a damaged one.
  assert.equal(savedReduce(firstSaved(), { type: 'unusable' }).damaged, true);
});

// ---- the screens

test('the Read screen says when the last read was, and offers Read again', () => {
  const html = draw(value({ readAtMs: AT }), createElement(LastRead));
  assert.ok(html.includes(savedAtLine(AT)), html);
  assert.match(html, /data-last-read=""/);
  assert.match(html, /<button[^>]*>.*Read again<\/button>/);
  assert.doesNotMatch(html, /changed/);
});

test('a read that came from the kept file says no folder was read just now; a read that was just made does not', () => {
  assert.ok(draw(value({ readAtMs: AT, fromSaved: true, checking: false }), createElement(LastRead)).includes(REAL.hint.savedShown));
  assert.ok(!draw(value({ readAtMs: AT, fromSaved: false }), createElement(LastRead)).includes(REAL.hint.savedShown));
});

test('while the folders are checked it says so; when they changed it says so and Read again is the way on', () => {
  assert.ok(draw(value({ readAtMs: AT, fromSaved: true, checking: true }), createElement(LastRead)).includes(REAL.hint.checkingFolders));
  const changed = draw(value({ readAtMs: AT, fromSaved: true, changed: true }), createElement(LastRead));
  assert.ok(changed.includes(REAL.hint.folderChanged));
  assert.match(changed, /data-folder-changed=""/);
  assert.match(changed, /Read again/);
  assert.ok(!changed.includes(REAL.hint.savedShown), 'one status line at a time');
});

test('Read again runs the one action it is given', () => {
  let ran = 0;
  const html = draw(value({ readAtMs: AT, readAgain: () => { ran += 1; } }), createElement(LastRead));
  assert.match(html, /Read again/);
  assert.equal(ran, 0, 'drawing it runs nothing');
});

test('nothing is drawn when no read is kept or made', () => {
  assert.equal(draw(value(), createElement(LastRead)), '');
  assert.equal(draw(value(), createElement(SavedDamagedNote)), '');
});

test('a kept read that could not be used is told in plain words on the first screen', () => {
  const html = draw(value({ damaged: true }), createElement(SavedDamagedNote));
  assert.ok(html.includes(REAL.hint.savedDamaged));
  assert.match(html, /role="status"/);
  assert.match(html, /data-saved-damaged=""/);
});

// ---- the words

test('the new words obey the limits and the banned list', () => {
  for (const text of [REAL.label.readAgain, REAL.hint.savedShown, REAL.hint.checkingFolders, REAL.hint.folderChanged, REAL.hint.savedDamaged, savedAtLine(AT, 'UTC'), savedAtLine(Number.NaN)]) assert.equal(bannedHere(text), null, text);
  assert.ok(countWords(REAL.label.readAgain) <= LIMITS.label);
  for (const text of [REAL.hint.savedShown, REAL.hint.checkingFolders, REAL.hint.folderChanged, REAL.hint.savedDamaged]) assert.ok(countWords(text) <= LIMITS.hint, text);
  assert.equal(REAL.label.readAgain, 'Read again');
});
