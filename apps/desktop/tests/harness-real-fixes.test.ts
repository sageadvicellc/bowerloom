// The silent-failure fixes of the preview on the person's own folders (the default launch): a read that holds nothing keeps what the reader said, a throw while a read is finished ends on the
// error screen, the launch mode is explicit, notes are not hidden, a folder added twice is said, and a failing listener, make or crash text is not silent. No file is read; no real folder is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { REAL_LIMITS } from '../shared/real/types.js';
import type { RealDiscovery, RealPlace, RealResult } from '../shared/real/types.js';
import type { RealNotes } from '../shared/harness/types.js';
import { createSampleWorld } from '../shared/harness/sample.js';
import { createHarnessStore } from '../shared/harness/store.js';
import { LIMITS, bannedHere, countWords } from '../shared/harness/words.js';
import { runRead } from '../renderer/harness/real/read-run.js';
import { firstState, reduceChoose } from '../renderer/harness/real/state.js';
import type { ChooseAction, ChooseState } from '../renderer/harness/real/state.js';
import { chooseKind } from '../renderer/harness/real/mode.js';
import { NoBridge, NothingFound } from '../renderer/harness/real/Nothing.js';
import { ChooseLines, NOTES_SHOWN, PlaceNotes, ReadNotes, visibleNotes } from '../renderer/harness/real/ReadNotes.js';
import { PlaceRow } from '../renderer/harness/real/PlaceRow.js';
import { REAL, limitsLine, nothingReadLine, skippedLine } from '../renderer/harness/real/words-real.js';
import { reasonWords } from '../renderer/home/real/words.js';
import { crashLine } from '../renderer/common/error-boundary.js';
import { makeOnce, makeSources } from '../renderer/harness/screens/read-make.js';
import { FLOW } from '../renderer/harness/words-flow.js';

const place = (id: string, over: Partial<RealPlace> = {}): RealPlace => ({
  id, label: `Place ${id}`, kind: 'project', apps: ['Claude Code'], appLabel: 'Claude Code', counts: { agents: 1, skills: 0, tools: 0, hooks: 0, notes: 0 }, empty: false,
  details: { path: `~/${id}`, folders: ['.claude'], topics: [], notes: [] }, ...over,
});
const disc = (places: RealPlace[], over: Partial<RealDiscovery> = {}): RealDiscovery => ({ places, stoppedEarly: false, couldNotRead: 0, notes: [], readOnly: true, ...over });
const run = (actions: ChooseAction[], from: ChooseState = firstState()): ChooseState => actions.reduce(reduceChoose, from);
const onList = (...places: RealPlace[]): ChooseState => run([{ type: 'find' }, { type: 'found', found: disc(places) }]);
const NOTES: RealNotes = { couldNotRead: 3, stoppedEarly: true, notes: ['2 things in a Bowerloom folder are not shown.'], textsCut: 0 };
const emptyResult = (over: Partial<RealResult> = {}): RealResult => ({
  world: { interfaces: [], items: [], scopes: [{ id: 'global', kind: 'global', name: 'Your home folder', parentId: null, path: '~' }], overrides: [], wikiPages: [], slices: [], versions: [], libraries: [] },
  others: [], counts: { agents: 0, skills: 0, tools: 0, hooks: 0, notes: 0 }, ages: {}, stoppedEarly: false, couldNotRead: 0, partlyRead: 0, textsCut: 0, notes: [], readOnly: true, ...over,
});

// ---- 1 and 2: finishing a read

function deps(over: Partial<Parameters<typeof runRead>[2]> = {}): { sent: ChooseAction[]; applied: unknown[]; left: number; logged: unknown[]; d: Parameters<typeof runRead>[2] } {
  const out = { sent: [] as ChooseAction[], applied: [] as unknown[], left: 0, logged: [] as unknown[] } as { sent: ChooseAction[]; applied: unknown[]; left: number; logged: unknown[]; d: Parameters<typeof runRead>[2] };
  out.d = { apply: next => { out.applied.push(next); }, send: a => { out.sent.push(a); }, leave: () => { out.left += 1; }, isLive: () => true, log: e => { out.logged.push(e); }, ...over };
  return out;
}

test('an empty read keeps what the reader said: things it could not read, that it stopped early, and its notes', async () => {
  const o = deps();
  await runRead(Promise.resolve(emptyResult({ couldNotRead: 4, stoppedEarly: true, notes: ['Keep me.'] })), [], o.d);
  assert.equal(o.applied.length, 0); assert.equal(o.left, 0);
  assert.equal(o.sent.length, 1);
  const sent = o.sent[0]!;
  assert.equal(sent.type, 'emptied');
  assert.deepEqual((sent as { real: RealNotes }).real, { couldNotRead: 4, stoppedEarly: true, notes: ['Keep me.'], textsCut: 0 });
});

test('a throw while the read is finished (the mapping, the load, the move) ends on the error screen, and is logged', async () => {
  for (const [name, over] of [['apply', { apply: () => { throw new Error('load failed'); } }], ['leave', { leave: () => { throw new Error('go failed'); } }]] as const) {
    const o = deps(over);
    const item = { id: 'real-skill-a', kind: 'skill', name: 'A', scopeId: 'global', library: null, description: 'A.', foundAt: [{ interface: 'claude-code', path: '~/.claude/skills/a/SKILL.md', contentHash: 'h', text: 'x' }] };
    const result = emptyResult({ world: { ...emptyResult().world, items: [item as never] } });
    await runRead(Promise.resolve(result), [], o.d);
    assert.deepEqual(o.sent.at(-1), { type: 'fail', code: 'FAILED' }, name);
    assert.equal(o.logged.length, 1, name);
  }
  const sent: ChooseAction[] = [], d = deps().d;
  const one = emptyResult({ world: { ...emptyResult().world, items: [{ id: 'real-skill-b', kind: 'skill', name: 'B', scopeId: 'global', library: null, description: 'B.', foundAt: [{ interface: 'claude-code', path: '~/.claude/skills/b/SKILL.md', contentHash: 'h', text: 'x' }] } as never] } });
  await runRead(Promise.resolve(one), [], { ...d, send: a => { sent.push(a); if (a.type === 'done') throw new Error('send failed'); } });
  assert.deepEqual(sent.at(-1), { type: 'fail', code: 'FAILED' });
});

test('a refused or failed call ends on the error screen with its code; a page that has gone away hears nothing', async () => {
  const o = deps();
  await runRead(Promise.reject(new Error('Error invoking remote method: BUSY')), [], o.d);
  assert.deepEqual(o.sent, [{ type: 'fail', code: 'BUSY' }]);
  const gone = deps({ isLive: () => false });
  await runRead(Promise.reject(new Error('x')), [], gone.d); await runRead(Promise.resolve(emptyResult()), [], gone.d);
  assert.deepEqual(gone.sent, []);
});

test('an empty read puts the person back on the nothing-found screen with the reader\'s words; adding a folder with work in it brings the list back', () => {
  const reading = run([{ type: 'find' }, { type: 'found', found: disc([place('a')]) }, { type: 'looksRight' }, { type: 'yes' }]);
  const empty = run([{ type: 'emptied', real: NOTES }], reading);
  assert.deepEqual([empty.step, empty.nothingRead, empty.readNotes], ['places', true, NOTES]);
  assert.equal(reduceChoose(onList(place('a')), { type: 'emptied', real: NOTES }).nothingRead, false, 'only from a read');
  const added = run([{ type: 'picked', found: disc([place('b')]), cancelled: false }], empty);
  assert.deepEqual([added.nothingRead, added.readNotes, added.places.map(p => p.id), added.ticked.includes('b')], [false, null, ['a', 'b'], true]);
  const closed = run([{ type: 'picked', found: disc([]), cancelled: true }], empty);
  assert.equal(closed.nothingRead, true); assert.equal(closed.pickedNothing, true);
});

const markup = (el: ReturnType<typeof createElement>): string => renderToStaticMarkup(el);
const noop = (): void => undefined;

test('the nothing-found screen after a read says could-not-read, stopped-early and the notes, and words itself for a read that stopped early', () => {
  const html = markup(createElement(NothingFound, { nothingRead: true, readNotes: NOTES, busy: false, onAdd: noop, onSample: noop }));
  assert.ok(html.includes(skippedLine(3, false))); assert.doesNotMatch(html, /Could not read/); assert.ok(html.includes(REAL.hint.stoppedEarly)); assert.match(html, /2 things in a Bowerloom folder are not shown\./);
  assert.ok(html.includes(nothingReadLine(NOTES)), 'the headline line');
  assert.notEqual(nothingReadLine(NOTES), REAL.hint.nothingRead); assert.ok(nothingReadLine(NOTES).includes('stopped early'));
  const quiet: RealNotes = { couldNotRead: 0, stoppedEarly: false, notes: [], textsCut: 0 };
  assert.equal(nothingReadLine(quiet), REAL.hint.nothingRead); assert.equal(nothingReadLine(null), REAL.hint.nothingRead);
  const plain = markup(createElement(NothingFound, { nothingRead: true, readNotes: quiet, busy: false, onAdd: noop, onSample: noop }));
  assert.doesNotMatch(plain, /could not be opened|data-read-notes/);
  assert.ok(markup(createElement(NothingFound, { nothingRead: false, readNotes: null, busy: false, onAdd: noop, onSample: noop })).includes(REAL.hint.noFolders));
});

// ---- 3: the launch mode

test('a real launch without its bridge shows the no-bridge error and never the sample; the sample launch ignores a bridge', () => {
  const bridge = { discoverPlaces: async () => disc([]), pickFolder: async () => ({ ...disc([]), cancelled: true }), readSelected: async () => emptyResult() };
  assert.deepEqual(chooseKind(true, null), { kind: 'no-bridge' }); assert.deepEqual(chooseKind(true, bridge), { kind: 'real', bridge });
  assert.deepEqual(chooseKind(false, null), { kind: 'sample' }); assert.deepEqual(chooseKind(false, bridge), { kind: 'sample' });
  const html = markup(createElement(NoBridge));
  assert.ok(html.includes(reasonWords('NO_BRIDGE'))); assert.ok(html.includes('data-error="NO_BRIDGE"')); assert.doesNotMatch(html, /sample/i);
  assert.equal(bannedHere(reasonWords('NO_BRIDGE')), null);
});

// ---- 4: the notes

test('the notes after the sixth are behind "Show all notes", and the button is there only when some are hidden', () => {
  const eight = Array.from({ length: 8 }, (_, i) => `Note ${i + 1}.`);
  assert.deepEqual(visibleNotes(eight, false), eight.slice(0, NOTES_SHOWN)); assert.deepEqual(visibleNotes(eight, true), eight);
  const html = markup(createElement(ReadNotes, { real: { couldNotRead: 0, stoppedEarly: false, notes: eight, textsCut: 0 } }));
  assert.match(html, /Note 6\./); assert.doesNotMatch(html, /Note 7\./); assert.match(html, /and 2 more notes\./); assert.match(html, />Show all notes</); assert.match(html, /aria-expanded="false"/);
  const few = markup(createElement(ReadNotes, { real: { couldNotRead: 0, stoppedEarly: false, notes: eight.slice(0, 6), textsCut: 0 } }));
  assert.doesNotMatch(few, /Show all notes/);
});

// ---- 8: a folder added again, a folder added at the wrong time

test('a folder that is already in the list says so and adds nothing a second time', () => {
  const noisy = disc([place('a')], { couldNotRead: 2, stoppedEarly: true, notes: ['Odd.'] });
  const first = run([{ type: 'find' }, { type: 'found', found: disc([place('a')], { couldNotRead: 1, notes: ['Odd.'] }) }]);
  const again = run([{ type: 'picked', found: noisy, cancelled: false }], first);
  assert.equal(again.alreadyListed, true);
  assert.equal(again.couldNotRead, 1, 'its could-not-read count is not added a second time'); assert.equal(again.stoppedEarly, false); assert.deepEqual(again.notes, ['Odd.']);
  assert.deepEqual(again.places.map(p => p.id), ['a']);
  const next = run([{ type: 'toggle', id: 'a' }], again);
  assert.equal(next.alreadyListed, false, 'the note goes with the next thing the person does');
  const fresh = run([{ type: 'picked', found: disc([place('a'), place('b')], { couldNotRead: 5 }), cancelled: false }], first);
  assert.equal(fresh.alreadyListed, false); assert.equal(fresh.couldNotRead, 6, 'a folder with something new is added in full');
});

test('a folder that arrives after the person has gone on is kept in the list, not ticked, and said on the list', () => {
  const confirm = run([{ type: 'looksRight' }], onList(place('a')));
  assert.equal(confirm.step, 'confirm');
  const late = run([{ type: 'picked', found: disc([place('b')], { couldNotRead: 2 }), cancelled: false }], confirm);
  assert.equal(late.step, 'confirm'); assert.deepEqual(late.places.map(p => p.id), ['a', 'b']); assert.deepEqual(late.ticked, ['a'], 'the ticks the person confirmed do not change'); assert.equal(late.couldNotRead, 2);
  assert.equal(late.addedAway, true);
  const back = run([{ type: 'back' }], late);
  assert.deepEqual([back.step, back.addedAway], ['places', true]);
  assert.equal(run([{ type: 'toggle', id: 'b' }], back).addedAway, false);
  const reading = run([{ type: 'yes' }], confirm);
  assert.deepEqual(run([{ type: 'picked', found: disc([place('c')]), cancelled: false }], reading).places.map(p => p.id), ['a', 'c']);
  const same = run([{ type: 'picked', found: disc([place('a')]), cancelled: false }], confirm);
  assert.equal(same.alreadyListed, true);
});

// ---- 9: a listener that throws, the crash text, the make buttons

test('loadWorld tells every listener even when one throws, and logs the error', t => {
  const log = t.mock.method(console, 'error', () => undefined);
  const store = createHarnessStore({ initial: createSampleWorld() });
  const heard: string[] = [];
  store.subscribe(() => { heard.push('a'); }); store.subscribe(() => { throw new Error('bad listener'); }); store.subscribe(() => { heard.push('c'); });
  assert.doesNotThrow(() => store.loadWorld(createSampleWorld()));
  assert.deepEqual(heard, ['a', 'c']); assert.equal(log.mock.callCount(), 1);
});

test('the crash text is true in both modes: the sample is named only in the sample', () => {
  assert.match(crashLine(false), /sample data/); assert.doesNotMatch(crashLine(true), /sample/i); assert.match(crashLine(true), /folders were not changed/);
  assert.equal(bannedHere(crashLine(true)), null);
});

test('making a harness runs once for a double click, says "Nothing was made." when nothing came, and then works again', () => {
  const store = { calls: [] as string[], createHarnessFromSource(id: string): string | null { this.calls.push(id); return id === 'gone' ? null : `h-${id}`; } };
  assert.equal(makeSources(store, ['gone', 'a', 'b']), 'h-a'); assert.deepEqual(store.calls, ['gone', 'a', 'b']);
  assert.equal(makeSources(store, ['gone']), null); assert.equal(makeSources(store, []), null);
  const flag = { current: false }, seen: string[] = [];
  const click = (make: () => string | null): void => makeOnce(flag, make, id => seen.push(`made ${id}`), () => seen.push('none'));
  let made = 0;
  click(() => { made += 1; return 'x'; }); click(() => { made += 1; return 'y'; });
  assert.equal(made, 1); assert.deepEqual(seen, ['made x']);
  const second = { current: false }; const toast: string[] = [];
  makeOnce(second, () => null, () => undefined, () => toast.push(FLOW.hint.nothingMade));
  assert.deepEqual(toast, ['Nothing was made.']); assert.equal(second.current, false, 'a failed make can be tried again');
  assert.ok(countWords(FLOW.hint.nothingMade) <= LIMITS.hint);
});

test('the new fixed words obey the limits and the banned-word list', () => {
  for (const text of [REAL.label.showAllNotes, REAL.label.showFewerNotes, REAL.label.aboutFolders]) { assert.ok(countWords(text) <= LIMITS.label, text); assert.equal(bannedHere(text), null, text); }
  for (const text of [REAL.hint.alreadyListed, REAL.hint.addedAway, REAL.hint.nothingStopped, FLOW.hint.nothingMade]) { assert.ok(countWords(text) <= LIMITS.hint, text); assert.equal(bannedHere(text), null, text); }
});

// ---- 5: the summary and its details

const BIG = 'This folder is big, so only part of it was looked at.';
const placeNotes = [{ name: 'Alpha', notes: ['2 files over 2 MB were skipped.', BIG] }, { name: 'Gamma', notes: ['1 thing could not be opened.'] }];

test('the Read summary is calm, says what the limits are from the reader\'s own constants, and hides the places behind "Show details"', () => {
  assert.equal(skippedLine(11, true), 'Everything was read, except 11 things that could not be opened or were skipped.');
  assert.equal(skippedLine(1, true), 'Everything was read, except 1 thing that could not be opened or was skipped.');
  assert.equal(skippedLine(11, false), '11 things could not be opened or were skipped.');
  assert.equal(limitsLine(), `Bowerloom looks at up to ${REAL_LIMITS.filesPerPlace.toLocaleString('en-US')} files and ${REAL_LIMITS.depth} folders deep in each folder, so a very big folder is only partly read.`);
  const whole = markup(createElement(ReadNotes, { real: { couldNotRead: 11, stoppedEarly: false, notes: [], textsCut: 0 } }));
  assert.ok(whole.includes(skippedLine(11, true))); assert.doesNotMatch(whole, /Show details|Could not read|5,000/, 'no places, no toggle, no limits line');
  const partial = markup(createElement(ReadNotes, { real: { couldNotRead: 11, stoppedEarly: false, notes: [], textsCut: 171, onlyPartRead: true, places: placeNotes } }));
  assert.ok(partial.includes(skippedLine(11, false))); assert.ok(partial.includes(limitsLine())); assert.ok(partial.includes('171 texts were cut short.'));
  assert.equal(partial.split(limitsLine()).length, 2, 'the limits show once'); assert.equal(partial.split(BIG).length, 1, 'the sentence is not repeated as a bare line');
  assert.match(partial, />Show details</); assert.match(partial, /aria-expanded="false"/); assert.doesNotMatch(partial, /Alpha|Gamma|Pick a smaller folder/, 'the places are behind the toggle');
});

test('the details name each place with its own notes, and a place that was partly read gets one plain next step', () => {
  const html = markup(createElement(PlaceNotes, { places: placeNotes }));
  assert.match(html, /Alpha/); assert.match(html, /Gamma/); assert.match(html, /2 files over 2 MB were skipped\./); assert.match(html, /1 thing could not be opened\./); assert.ok(html.includes(BIG));
  assert.equal(html.split(REAL.hint.nextStep).length, 2, 'the step shows once, for Alpha only');
  assert.ok(html.indexOf(REAL.hint.nextStep) > html.indexOf('Alpha') && html.indexOf(REAL.hint.nextStep) < html.indexOf('Gamma'));
  assert.equal(REAL.hint.nextStep, 'Pick a smaller folder to read all of it.');
  assert.ok(html.includes(REAL.hint.detailsFrom));
});

test('the Choose list gives the same calm lines, with the limits in place of the bare sentence, and the place details carry the next step', () => {
  const html = markup(createElement(ChooseLines, { couldNotRead: 11, stoppedEarly: false, notes: ['Some folders were big, so only part of them was looked at.', 'Other note.'] }));
  assert.ok(html.includes(skippedLine(11, false))); assert.ok(html.includes(limitsLine())); assert.doesNotMatch(html, /Some folders were big|Could not read/); assert.match(html, /Other note\./);
  const quiet = markup(createElement(ChooseLines, { couldNotRead: 0, stoppedEarly: false, notes: [] }));
  assert.doesNotMatch(quiet, /could not be opened|Bowerloom looks/);
  const row = (open: boolean): string => markup(createElement(PlaceRow, { place: place('a', { details: { path: '~/a', folders: [], topics: [], notes: [BIG] } }), on: true, open, onTick: noop }));
  assert.ok(row(true).includes(REAL.hint.nextStep)); assert.ok(!row(false).includes(REAL.hint.nextStep));
});
