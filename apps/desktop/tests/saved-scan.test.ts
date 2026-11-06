// The saved read (the last answer of the reader, kept so the next launch can show it): what a file must look like to be believed. The file is untrusted when it is loaded,
// so every wrong shape gives a plain reason and never a half-loaded read. Nothing here reads a real folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAVED_SCAN_CAPS, SAVED_SCAN_VERSION, SAVED_SCAN_MAX_BYTES, parseSavedScan } from '../shared/real/saved-scan.js';
import { savedAtLine } from '../renderer/harness/real/words-real.js';
import type { SavedScan } from '../shared/real/saved-scan.js';
import { REAL_LIMITS } from '../shared/real/types.js';
import type { RealPlace, RealResult } from '../shared/real/types.js';
import { smallResult } from './fixtures-real/small-result.js';

const place = (id: string): RealPlace => ({
  id, label: 'Claude Code at home', kind: 'home', apps: ['Claude Code'], appLabel: 'Claude Code', counts: { agents: 1, skills: 2, tools: 0, hooks: 0, notes: 0 }, empty: false,
  details: { path: '~', folders: ['.claude'], topics: [{ name: 'Notes', count: 2 }], notes: [] },
});
const result = (): RealResult => ({
  ...smallResult(),
});
const scan = (): SavedScan => ({ version: SAVED_SCAN_VERSION, savedAtMs: Date.UTC(2026, 10, 5, 15, 12), fingerprint: 'a'.repeat(64), chosen: [place('place-0123456789ab')], result: result() });
const text = (change: (s: Record<string, unknown>) => void = () => undefined): string => { const s = JSON.parse(JSON.stringify(scan())) as Record<string, unknown>; change(s); return JSON.stringify(s); };

test('a saved read that was written by this app comes back whole', () => {
  const back = parseSavedScan(JSON.stringify(scan()));
  assert.equal(back.ok, true);
  assert.deepEqual(back.ok ? back.scan : null, scan());
});

test('the version is 1, and any other number is told apart from a broken file', () => {
  assert.equal(SAVED_SCAN_VERSION, 1);
  assert.deepEqual(parseSavedScan(text(s => { s.version = 2; })), { ok: false, why: 'wrong-version' });
  assert.deepEqual(parseSavedScan(text(s => { s.version = 0; })), { ok: false, why: 'wrong-version' });
  assert.deepEqual(parseSavedScan(text(s => { delete s.version; })), { ok: false, why: 'bad-shape' });
  assert.deepEqual(parseSavedScan(text(s => { s.version = '1'; })), { ok: false, why: 'bad-shape' });
});

test('text that is not a saved read gives a reason and never throws', () => {
  for (const bad of ['', '{', 'null', '[]', '"x"', '5', 'true', '{}', '{"version":1}']) assert.equal(parseSavedScan(bad).ok, false, bad);
  assert.deepEqual(parseSavedScan('{'), { ok: false, why: 'bad-shape' });
  assert.deepEqual(parseSavedScan('x'.repeat(SAVED_SCAN_MAX_BYTES + 1)), { ok: false, why: 'too-big' });
});

test('every part is checked: the time, the fingerprint, the places and the result', () => {
  const broken: [string, (s: Record<string, unknown>) => void][] = [
    ['time is text', s => { s.savedAtMs = 'now'; }],
    ['time is negative', s => { s.savedAtMs = -1; }],
    ['time is not a number', s => { s.savedAtMs = null; }],
    ['fingerprint too short', s => { s.fingerprint = 'abc'; }],
    ['fingerprint not hex', s => { s.fingerprint = 'z'.repeat(64); }],
    ['no places', s => { s.chosen = []; }],
    ['places not a list', s => { s.chosen = {}; }],
    ['too many places', s => { s.chosen = Array.from({ length: 201 }, (_, i) => place(`place-${String(i).padStart(12, '0')}`)); }],
    ['a place with a bad id', s => { (s.chosen as RealPlace[])[0] = { ...place('x'), id: '../../etc' }; }],
    ['a place with a bad kind', s => { (s.chosen as Record<string, unknown>[])[0]!.kind = 'elsewhere'; }],
    ['a place with counts as text', s => { (s.chosen as Record<string, unknown>[])[0]!.counts = 'many'; }],
    ['a place with no details', s => { delete (s.chosen as Record<string, unknown>[])[0]!.details; }],
    ['a place path that is a number', s => { ((s.chosen as Record<string, unknown>[])[0]!.details as Record<string, unknown>).path = 5; }],
    ['no result', s => { delete s.result; }],
    ['result is a list', s => { s.result = []; }],
    ['world is missing', s => { delete (s.result as Record<string, unknown>).world; }],
    ['world items are not a list', s => { ((s.result as Record<string, unknown>).world as Record<string, unknown>).items = 'x'; }],
    ['counts are missing', s => { delete (s.result as Record<string, unknown>).counts; }],
    ['readOnly is not true', s => { (s.result as Record<string, unknown>).readOnly = false; }],
    ['notes are not text', s => { (s.result as Record<string, unknown>).notes = [1]; }],
    ['textsCut is text', s => { (s.result as Record<string, unknown>).textsCut = 'a lot'; }],
    ['harness places are not a list', s => { (s.result as Record<string, unknown>).harnessPlaces = 7; }],
  ];
  for (const [what, change] of broken) assert.deepEqual(parseSavedScan(text(change)), { ok: false, why: 'bad-shape' }, what);
});

test('the time of the last read is one plain line, in the zone it is given', () => {
  const at = Date.UTC(2026, 10, 5, 15, 12);
  assert.equal(savedAtLine(at, 'UTC'), 'Last read: Nov 5, 2026, 3:12 PM.');
  assert.equal(savedAtLine(at, 'America/New_York'), 'Last read: Nov 5, 2026, 10:12 AM.');
  assert.equal(savedAtLine(Number.NaN, 'UTC'), 'Last read: time not known.');
});

// ---- the caps: a file cannot make the window, or main, do work the reader could never have made it do

const item = (i: number): Record<string, unknown> => ({ id: `i${i}`, kind: 'skill', name: 'n', scopeId: 's', foundAt: [], library: null, description: '' });
const withWorld = (change: (world: Record<string, unknown>) => void): string => text(s => { change((s.result as { world: Record<string, unknown> }).world); });

test('a file with 100,000 items is refused at once, before anything walks them', () => {
  const big = withWorld(w => { w.items = Array.from({ length: 100_000 }, (_, i) => item(i)); });
  const started = Date.now();
  assert.deepEqual(parseSavedScan(big), { ok: false, why: 'too-big' });
  assert.ok(Date.now() - started < 2_000, 'refused fast');
});

test('each list is held to what the reader can make, and a list past its cap is told as too big (never as a wrong shape)', () => {
  const over = REAL_LIMITS.itemsPerCall + 1, places = SAVED_SCAN_CAPS.scopes + 1;
  assert.equal(parseSavedScan(withWorld(w => { w.items = Array.from({ length: SAVED_SCAN_CAPS.items }, (_, i) => item(i)); })).ok, true, 'at the cap');
  assert.deepEqual(parseSavedScan(withWorld(w => { w.items = Array.from({ length: SAVED_SCAN_CAPS.items + 1 }, (_, i) => item(i)); })), { ok: false, why: 'too-big' });
  assert.deepEqual(parseSavedScan(withWorld(w => { w.scopes = Array.from({ length: places }, (_, i) => ({ id: `s${i}`, kind: 'project', name: 'n', parentId: null, path: '~' })); })), { ok: false, why: 'too-big' });
  assert.equal(parseSavedScan(withWorld(w => { w.wikiPages = Array.from({ length: over }, (_, i) => ({ id: `p${i}` })); })).ok, false);
  assert.equal(parseSavedScan(withWorld(w => { w.scopes = Array.from({ length: places }, (_, i) => ({ id: `s${i}`, kind: 'project', name: 'n', parentId: null, path: '~' })); })).ok, false);
  assert.equal(parseSavedScan(withWorld(w => { w.slices = Array.from({ length: SAVED_SCAN_CAPS.slices + 1 }, (_, i) => ({ id: `l${i}` })); })).ok, false);
  assert.equal(parseSavedScan(text(s => { (s.result as Record<string, unknown>).others = Array.from({ length: over }, () => ({})); })).ok, false);
  assert.equal(parseSavedScan(text(s => { (s.result as Record<string, unknown>).harnessPlaces = Array.from({ length: REAL_LIMITS.places + 1 }, () => ({})); })).ok, false);
});

test('an item, a scope, a slice and a page must have the fields the window reads', () => {
  const bad: [string, (w: Record<string, unknown>) => void][] = [
    ['item is a number', w => { w.items = [5]; }],
    ['item without an id', w => { w.items = [{ ...item(1), id: undefined }]; }],
    ['item kind is a number', w => { w.items = [{ ...item(1), kind: 3 }]; }],
    ['item scope id is a number', w => { w.items = [{ ...item(1), scopeId: 3 }]; }],
    ['foundAt is not a list', w => { w.items = [{ ...item(1), foundAt: 'x' }]; }],
    ['foundAt entry is not an object', w => { w.items = [{ ...item(1), foundAt: [4] }]; }],
    ['foundAt interface is a number', w => { w.items = [{ ...item(1), foundAt: [{ interface: 4, path: 'p' }] }]; }],
    ['scope is a text', w => { w.scopes = ['x']; }],
    ['scope without an id', w => { w.scopes = [{ kind: 'global' }]; }],
    ['slice without an id', w => { w.slices = [{}]; }],
    ['page without an id', w => { w.wikiPages = [{}]; }],
  ];
  for (const [what, change] of bad) assert.deepEqual(parseSavedScan(withWorld(change)), { ok: false, why: 'bad-shape' }, what);
  // The made-up world of the tests is a real one, so every shape it holds passes.
  assert.equal(parseSavedScan(JSON.stringify(scan())).ok, true);
});

test('a time past the last moment a date can hold is refused, and a date that is not a date is told as "not known"', () => {
  assert.equal(parseSavedScan(text(s => { s.savedAtMs = 8.64e15; })).ok, true);
  assert.deepEqual(parseSavedScan(text(s => { s.savedAtMs = 8.64e15 + 1; })), { ok: false, why: 'bad-shape' });
  assert.deepEqual(parseSavedScan(text(s => { s.savedAtMs = 1e300; })), { ok: false, why: 'bad-shape' });
  assert.equal(savedAtLine(8.64e15 + 1, 'UTC'), 'Last read: time not known.');
  assert.equal(savedAtLine(1e300), 'Last read: time not known.');
});
