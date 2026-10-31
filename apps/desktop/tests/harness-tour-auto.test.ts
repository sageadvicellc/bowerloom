// The tour starts on its own at first use (first five minutes, section 2 and section 9): when the edit of a folder's agents first opens with no Notes keeper
// saved, and only once. "Seen" is kept in the window's own storage, wrapped so a storage that throws never stops the window and never makes the tour repeat
// in this window. Help replays it at any time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOUR_SEEN_KEY, createTourMemory, startsOnItsOwn } from '../renderer/harness/tour/seen.js';
import type { DefinitionView } from '../shared/engine/types.js';
import { KEEPER_AGENT } from '../shared/harness/save-draft.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP } from './support.js';

const BASE: DefinitionView = {
  id: 'team', description: '', engines: ['claude-code'], instructions: false, skills: [], agents: [{ id: 'reader', name: 'reader', description: '', skills: [], notes: [] }], sources: [], kits: [],
};
const WITH_KEEPER: DefinitionView = { ...BASE, agents: [...BASE.agents, { id: KEEPER_AGENT, name: KEEPER_AGENT, description: '', skills: [], notes: [] }] };

/** A storage like the window's: a map, and a switch that makes every call throw. */
function storage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; data: Map<string, string>; broken: boolean } {
  const s = {
    data: new Map<string, string>(), broken: false,
    getItem(k: string): string | null { if (s.broken) throw new Error('storage is off'); return s.data.get(k) ?? null; },
    setItem(k: string, v: string): void { if (s.broken) throw new Error('storage is off'); s.data.set(k, v); },
  };
  return s;
}

test('the tour starts on its own only in the edit, with the harness read, no keeper saved, and the tour not seen yet', () => {
  assert.equal(startsOnItsOwn({ step: 'edit', base: BASE, seen: false }), true);
  assert.equal(startsOnItsOwn({ step: 'edit', base: BASE, seen: true }), false);
  assert.equal(startsOnItsOwn({ step: 'edit', base: WITH_KEEPER, seen: false }), false, 'a saved keeper: the person built one already');
  assert.equal(startsOnItsOwn({ step: 'edit', base: null, seen: false }), false, 'not before the harness is read');
  for (const step of ['folder', 'review', 'done'] as const) assert.equal(startsOnItsOwn({ step, base: BASE, seen: false }), false, step);
});

test('"seen" is kept under one key of the window\'s storage, and read back', () => {
  const s = storage();
  const m = createTourMemory(() => s);
  assert.equal(m.seen(), false);
  m.mark();
  assert.equal(s.data.get(TOUR_SEEN_KEY), '1');
  assert.equal(m.seen(), true);
  // Another window of the same storage reads it too.
  assert.equal(createTourMemory(() => s).seen(), true);
  assert.equal(TOUR_SEEN_KEY, 'bowerloom-harness-tour-seen');
});

test('a storage that throws, or none at all, never stops the window: the tour is shown once, then held as seen in memory for this window', () => {
  const s = storage(); s.broken = true;
  const m = createTourMemory(() => s);
  assert.equal(m.seen(), false);
  assert.doesNotThrow(() => m.mark());
  assert.equal(m.seen(), true, 'it does not repeat in this window');
  const none = createTourMemory(() => { throw new Error('no storage here'); });
  assert.equal(none.seen(), false);
  none.mark();
  assert.equal(none.seen(), true);
  const missing = createTourMemory(() => null);
  missing.mark();
  assert.equal(missing.seen(), true);
});

test('a storage read that throws is "not seen", and it is told on the console with console.warn', t => {
  const warned = t.mock.method(console, 'warn', () => undefined);
  const s = storage(); s.broken = true;
  assert.equal(createTourMemory(() => s).seen(), false);
  assert.equal(warned.mock.callCount(), 1);
  const [words, error] = warned.mock.calls[0]!.arguments as [unknown, unknown];
  assert.match(String(words), /tour/i);
  assert.ok(error instanceof Error && error.message === 'storage is off');
  // A storage that cannot be reached at all is told the same way.
  assert.equal(createTourMemory(() => { throw new Error('no storage here'); }).seen(), false);
  assert.equal(warned.mock.callCount(), 2);
  // A storage that works, or none, says nothing.
  assert.equal(createTourMemory(() => storage()).seen(), false);
  assert.equal(createTourMemory(() => null).seen(), false);
  assert.equal(warned.mock.callCount(), 2);
});

test('the comment of seen.ts says where sessionStorage lands: the temporary app data folder, not memory', () => {
  const text = readFileSync(join(DESKTOP, 'renderer', 'harness', 'tour', 'seen.ts'), 'utf8');
  assert.doesNotMatch(text, /held in memory, survives/);
  assert.match(text, /temporary app data folder/);
});

test('a stored value other than "1" is not seen', () => {
  const s = storage(); s.data.set(TOUR_SEEN_KEY, 'yes');
  assert.equal(createTourMemory(() => s).seen(), false);
});
