// The words of the notes step, the Notes panel, the keeper build and the tour in the harness-first window: a label at most 5 words, a hint at most 12, the
// screen words of the first five minutes (section 8: "notes", "Notes keeper", "tidy-up report"), the tour's six sentences exactly as section 9 writes them,
// and no word the home rule bans (so "harness", "plan" and "version" stay off these screens too).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LIMITS, bannedIn, countWords } from '../shared/home/textbudget.js';
import { DESKTOP } from './support.js';
import {
  NOTES, NEXT_IDEAS, TOUR_STEPS, addToKeeperName, buildHint, hiddenWords, lastChangeWords, onShelfName, pagesWords, reportWords, usedByWords,
} from '../renderer/harness/words-notes.js';

const all = (group: Readonly<Record<string, string>>): [string, string][] => Object.entries(group);

test('every fixed word obeys the limits and the home rule, and the table is frozen', () => {
  assert.equal(Object.isFrozen(NOTES), true); assert.equal(Object.isFrozen(NOTES.label), true);
  for (const [key, text] of all(NOTES.label)) { assert.ok(countWords(text) <= LIMITS.label, `label.${key}: ${text}`); assert.equal(bannedIn(text), null, `label.${key}: ${text}`); }
  for (const [key, text] of all(NOTES.hint)) { assert.ok(countWords(text) <= LIMITS.hint, `hint.${key}: ${text}`); assert.equal(bannedIn(text), null, `hint.${key}: ${text}`); }
});

test('the screen words of section 8: notes, Notes keeper, tidy-up report', () => {
  assert.equal(NOTES.label.keeper, 'Notes keeper');
  assert.equal(NOTES.label.notes, 'Notes');
  assert.match(reportWords({ date: '2026-10-29', path: 'reports/2026-10-29-refine.md' }), /^Tidy-up report /);
  assert.equal(reportWords(null), 'No tidy-up report yet.');
  assert.equal(NOTES.hint.question, 'Where do you keep your notes?');
  assert.deepEqual([NOTES.label.useMine, NOTES.label.startFresh, NOTES.label.create], ['Use my notes', 'Start fresh', 'Create']);
  assert.equal(NOTES.hint.moreKinds, 'More kinds of notes are coming.');
});

test('the tour: the six sentences of section 9 in order, at most 12 words each, then What next with three ideas, the schedule one in words only', () => {
  assert.deepEqual(TOUR_STEPS.map(s => s.id), ['map', 'notes', 'keeper', 'shelves', 'save', 'help', 'next']);
  assert.deepEqual(TOUR_STEPS.slice(0, 6).map(s => s.text), [
    'These are your AI agents, from every tool.',
    'Your notes are what your agents can read.',
    'This agent looks after your notes.',
    'Skills are what it knows how to do.',
    'Changes wait here until you press Save.',
    'Replay this tour any time.',
  ]);
  for (const s of TOUR_STEPS) { assert.ok(countWords(s.text) <= 12, s.text); assert.equal(bannedIn(s.text), null, s.text); }
  assert.equal(NEXT_IDEAS.length, 3);
  for (const idea of NEXT_IDEAS) { assert.ok(countWords(idea) <= 12, idea); assert.equal(bannedIn(idea), null, idea); }
  assert.match(NEXT_IDEAS[0]!, /first source/); assert.match(NEXT_IDEAS[1]!, /tidy-up report/); assert.match(NEXT_IDEAS[2]!, /schedule/);
  // Spec 6.11: no screen tells the person to run a command. The schedule idea names a tool, never a command line.
  assert.doesNotMatch(NEXT_IDEAS[2]!, /`|\$|bowerloom |npx|npm|cron|--/);
  // The shelves step waits while the keeper is built: its area is the build panel.
  const shelves = TOUR_STEPS.find(s => s.id === 'shelves')!;
  assert.equal(shelves.wait, true); assert.equal(shelves.area, 'build');
  assert.equal(TOUR_STEPS.find(s => s.id === 'next')!.target, null);
});

test('the words built from a number, a date or a name obey the same rules, and a path is never one of them', () => {
  const built = [
    pagesWords(14, true), pagesWords(1, true), pagesWords(500, false), lastChangeWords('2026-10-28T09:30:00Z'), lastChangeWords(null), usedByWords([]), usedByWords(['notes-keeper', 'editor']),
    reportWords({ date: '2026-10-29', path: 'reports/2026-10-29-refine.md' }), hiddenWords(1), hiddenWords(3), addToKeeperName('add-source'), onShelfName('Reading list'),
    buildHint({ first: 'add-source', firstDone: false, restDone: false, notesDone: false, hasNotes: true }),
    buildHint({ first: 'add-source', firstDone: true, restDone: false, notesDone: false, hasNotes: true }),
    buildHint({ first: 'add-source', firstDone: true, restDone: true, notesDone: false, hasNotes: true }),
    buildHint({ first: 'add-source', firstDone: true, restDone: true, notesDone: true, hasNotes: true }),
    buildHint({ first: 'add-source', firstDone: true, restDone: true, notesDone: false, hasNotes: false }),
  ];
  for (const text of built) { assert.ok(countWords(text) <= LIMITS.hint, text); assert.equal(bannedIn(text), null, text); assert.doesNotMatch(text, /~|\//, text); }
  assert.equal(pagesWords(14, true), '14 pages'); assert.equal(pagesWords(1, true), '1 page'); assert.equal(pagesWords(500, false), 'At least 500 pages');
  assert.equal(lastChangeWords('2026-10-28T09:30:00Z'), 'Last change 2026-10-28'); assert.equal(lastChangeWords(null), 'No history yet');
  assert.equal(usedByWords([]), 'No agent reads these yet.'); assert.equal(usedByWords(['notes-keeper']), 'Read by notes-keeper');
  assert.equal(buildHint({ first: 'add-source', firstDone: false, restDone: false, notesDone: false, hasNotes: true }), 'Drag add-source onto Skills, or press its Add button.');
});

test('a report listing that stopped early says so: the date is the newest read, and no report read is not "none"', () => {
  const latest = { date: '2026-10-29', path: 'reports/2026-10-29-refine.md' };
  assert.equal(reportWords(latest, true), reportWords(latest));
  assert.equal(reportWords(latest, false), 'Tidy-up report 2026-10-29 or later');
  assert.equal(reportWords(null, false), 'No tidy-up report in the part read.');
  for (const text of [reportWords(latest, false), reportWords(null, false)]) { assert.ok(countWords(text) <= LIMITS.hint, text); assert.equal(bannedIn(text), null, text); }
});

test('every fixed word of the notes screens is drawn somewhere: no word is left unused', () => {
  const files: string[] = [];
  const walk = (dir: string): void => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name) && !e.name.startsWith('words-notes')) files.push(readFileSync(p, 'utf8')); } };
  walk(join(DESKTOP, 'renderer')); walk(join(DESKTOP, 'shared'));
  const own = readFileSync(join(DESKTOP, 'renderer', 'harness', 'words-notes.ts'), 'utf8').split('} as const);')[1] ?? '';
  const text = files.join('\n') + own;
  const unused = (['label', 'hint'] as const).flatMap(group => Object.keys(NOTES[group]).filter(k => !new RegExp(`NOTES\\.${group}\\.${k}\\b`).test(text)).map(k => `${group}.${k}`));
  assert.deepEqual(unused, []);
});
