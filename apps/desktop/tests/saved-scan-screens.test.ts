// What the window shows of the kept read: the time of the last read, a note when the folders changed, a note when the kept read could not be used, and one "Read again" control.
// The state machine is pure and is held here with no screen; the markup is drawn on the server with a made-up state. Nothing here reads a folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LastRead, SavedDamagedNote } from '../renderer/harness/real/LastRead.js';
import { SavedScanContext, firstSaved, loadSaved, savedReduce, startFromAnswer } from '../renderer/harness/real/saved-scan.js';
import type { LoadHooks, SavedAction, SavedScanValue } from '../renderer/harness/real/saved-scan.js';
import type { EngineBridge } from '../shared/engine/types.js';
import type { SavedScanAnswer, SavedScanCheck } from '../shared/real/saved-scan.js';
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
  const same = savedReduce(start, { type: 'checked', forAtMs: AT, verdict: 'same' });
  assert.deepEqual([same.checking, same.changed, same.unchecked], [false, false, false]);
  const changed = savedReduce(start, { type: 'checked', forAtMs: AT, verdict: 'changed' });
  assert.deepEqual([changed.checking, changed.changed, changed.unchecked], [false, true, false]);
  const unchecked = savedReduce(start, { type: 'checked', forAtMs: AT, verdict: 'unchecked' });
  assert.deepEqual([unchecked.checking, unchecked.changed, unchecked.unchecked], [false, false, true]);
});

test('a check that answers after a newer read is dropped, so the note never belongs to an older read', () => {
  const start = savedReduce(firstSaved(), startFromAnswer({ status: 'saved', savedAtMs: AT, chosen: [place], result }));
  const newer = savedReduce(start, { type: 'read', atMs: AT + 5_000 });
  assert.deepEqual([newer.readAtMs, newer.fromSaved, newer.changed, newer.checking], [AT + 5_000, false, false, false]);
  assert.equal(savedReduce(newer, { type: 'checked', forAtMs: AT, verdict: 'changed' }), newer);
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

test('a folder that could not be checked says so in its own words, apart from a folder that changed', () => {
  const html = draw(value({ readAtMs: AT, fromSaved: true, unchecked: true }), createElement(LastRead));
  assert.ok(html.includes('Some folders could not be checked.'));
  assert.equal(REAL.hint.folderUnchecked, 'Some folders could not be checked.');
  assert.ok(!html.includes(REAL.hint.folderChanged) && !html.includes(REAL.hint.savedShown));
  assert.match(html, /data-folder-unchecked=""/);
  assert.match(html, /Read again/);
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
  for (const text of [REAL.label.readAgain, REAL.hint.savedShown, REAL.hint.checkingFolders, REAL.hint.folderChanged, REAL.hint.folderUnchecked, REAL.hint.savedDamaged, savedAtLine(AT, 'UTC'), savedAtLine(Number.NaN)]) assert.equal(bannedHere(text), null, text);
  assert.ok(countWords(REAL.label.readAgain) <= LIMITS.label);
  for (const text of [REAL.hint.savedShown, REAL.hint.checkingFolders, REAL.hint.folderChanged, REAL.hint.folderUnchecked, REAL.hint.savedDamaged]) assert.ok(countWords(text) <= LIMITS.hint, text);
  assert.equal(REAL.label.readAgain, 'Read again');
});

// ---- the launch: what happens for each answer, with a made-up bridge

function launch(route: string | null): { actions: SavedAction[]; worlds: number; toasts: string[]; wentToRead: number; readied: number; hooks: LoadHooks } {
  const out = { actions: [] as SavedAction[], worlds: 0, toasts: [] as string[], wentToRead: 0, readied: 0 } as ReturnType<typeof launch>;
  out.hooks = {
    dispatch: a => { out.actions.push(a); }, replaceWorld: () => { out.worlds += 1; }, route: () => route, goRead: () => { out.wentToRead += 1; }, toast: text => { out.toasts.push(text); }, ready: () => { out.readied += 1; }, isLive: () => true,
  };
  return out;
}
const bridge = (savedScan: () => Promise<SavedScanAnswer>, checkSavedScan: () => Promise<SavedScanCheck> = async () => 'same'): EngineBridge => ({ savedScan, checkSavedScan }) as unknown as EngineBridge;
const saved: SavedScanAnswer = { status: 'saved', savedAtMs: AT, chosen: [place], result };

test('a kept read is loaded once, opens the Read screen from Welcome, and is then checked', async () => {
  const run = launch('welcome');
  await loadSaved(bridge(async () => saved, async () => 'changed'), run.hooks);
  assert.deepEqual([run.worlds, run.wentToRead, run.readied, run.toasts], [1, 1, 1, []]);
  assert.deepEqual(run.actions.map(a => a.type), ['saved', 'checked']);
  assert.deepEqual(run.actions[1], { type: 'checked', forAtMs: AT, verdict: 'changed' });
});

test('a kept read is loaded where the person already was, and does not move them', async () => {
  const run = launch('overview');
  await loadSaved(bridge(async () => saved), run.hooks);
  assert.deepEqual([run.worlds, run.wentToRead], [1, 0]);
});

test('a check that fails says it could not check, and never "same"', async () => {
  const run = launch('welcome');
  await loadSaved(bridge(async () => saved, async () => { throw new Error('FAILED'); }), run.hooks);
  assert.deepEqual(run.actions[1], { type: 'checked', forAtMs: AT, verdict: 'unchecked' });
});

test('a call that fails is told as a damaged read, on Welcome as a note and anywhere else as a toast', async () => {
  const quiet = console.error;
  console.error = (): void => undefined;
  try {
    const onWelcome = launch('welcome');
    await loadSaved(bridge(async () => { throw new Error('FAILED'); }), onWelcome.hooks);
    assert.deepEqual(onWelcome.actions, [{ type: 'damaged' }]);
    assert.deepEqual([onWelcome.toasts, onWelcome.readied], [[], 1], 'the Welcome screen draws the note');
    const elsewhere = launch('harnesses');
    await loadSaved(bridge(async () => { throw new Error('FAILED'); }), elsewhere.hooks);
    assert.deepEqual(elsewhere.actions, [{ type: 'damaged' }]);
    assert.deepEqual(elsewhere.toasts, [REAL.hint.savedDamaged]);
  } finally { console.error = quiet; }
});

test('a damaged answer shows the note where the person is, and a read the window cannot draw is told as damaged and loads nothing', async () => {
  const quiet = console.error;
  console.error = (): void => undefined;
  try {
    const elsewhere = launch('overview');
    await loadSaved(bridge(async () => ({ status: 'damaged', why: 'bad-shape' })), elsewhere.hooks);
    assert.deepEqual([elsewhere.actions, elsewhere.toasts, elsewhere.worlds], [[{ type: 'damaged' }], [REAL.hint.savedDamaged], 0]);
    const odd = launch('welcome');
    await loadSaved(bridge(async () => ({ ...saved, result: { ...result, world: { ...result.world, items: [5 as never] } } })), odd.hooks);
    assert.deepEqual([odd.actions, odd.worlds, odd.wentToRead], [[{ type: 'unusable' }], 0, 0]);
    const none = launch('overview');
    await loadSaved(bridge(async () => ({ status: 'none' })), none.hooks);
    assert.deepEqual([none.actions, none.toasts], [[{ type: 'none' }], []]);
  } finally { console.error = quiet; }
});
