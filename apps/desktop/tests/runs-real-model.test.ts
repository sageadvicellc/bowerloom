// The pure model of the real Runs and Compare screens (shared/harness/runs-real.ts) and their words (renderer/harness/runs-real-words.ts): the groups, the words of each state, and the rule that
// a figure the log did not hold is "Not read" and never a zero. The words obey the same limits and the same banned-word rule as the rest of the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_FIGURES } from '../shared/api/runs.js';
import type { RunFigures, RunView } from '../shared/api/runs.js';
import {
  canRateReal, countWords, runsRefusalWords, saveReportWords, durationWords, figureRows, figuresStateWords, modelWords, outcomeWords, realCompareGroupOf, realGroupById, realGroups, realRateQuestion, realRunById,
  realRunName, realStatusWords,
} from '../shared/harness/runs-real.js';
import { isoToLocalInput, localInputToIso, startedAtWords } from '../renderer/harness/clock.js';
import { RUNS_REAL, recordedToast, runsHintReal } from '../renderer/harness/runs-real-words.js';
import { noRunsWords } from '../renderer/harness/runs-words.js';
import { bannedHere, LIMITS, countWords as wordCount } from '../shared/harness/words.js';

const run = (id: string, groupId: string, engine: RunView['engine'] = 'claude-code', over: Partial<RunView> = {}): RunView =>
  ({ id, engine, instruction: 'Write a weekly report.', projectName: 'team', projectLabel: '~/Projects/team', startedAt: '2026-11-11T10:30:00.000Z', status: 'recorded', groupId, rating: null, notes: '', ...over });

test('runs of one group are kept together at the place of the first one, and only a group of two or more can be compared', () => {
  const runs = [run('run-4', 'group-2'), run('run-3', 'group-1', 'codex'), run('run-2', 'group-3'), run('run-1', 'group-1')];
  const groups = realGroups(runs);
  assert.deepEqual(groups.map(g => [g.id, g.runs.map(r => r.id), g.comparable]), [['group-2', ['run-4'], false], ['group-1', ['run-3', 'run-1'], true], ['group-3', ['run-2'], false]]);
  assert.equal(realGroupById(runs, 'group-1')?.runs.length, 2); assert.equal(realGroupById(runs, 'nope'), undefined);
  assert.equal(realRunById(runs, 'run-2')?.id, 'run-2'); assert.equal(realRunById(runs, 'run-9'), undefined);
  assert.equal(realCompareGroupOf(runs, runs[1]!), 'group-1'); assert.equal(realCompareGroupOf(runs, runs[0]!), null);
  assert.deepEqual(realGroups([]), []);
});

test('the status is Recorded or Done, a rating needs Done, and the question says why when it is locked', () => {
  assert.equal(realStatusWords('recorded'), 'Recorded'); assert.equal(realStatusWords('done'), 'Done');
  assert.equal(canRateReal({ status: 'recorded' }), false); assert.equal(canRateReal({ status: 'done' }), true);
  assert.equal(realRateQuestion({ status: 'done' }), 'How did it do?'); assert.equal(realRateQuestion({ status: 'recorded' }), 'How did it do? Mark the run as done to rate it.');
});

test('a figure the log did not hold is "Not read", never a zero, and a zero that the log did hold is a zero', () => {
  assert.equal(durationWords(null), 'Not read'); assert.equal(countWords(null), 'Not read'); assert.equal(modelWords(null), 'Not read'); assert.equal(outcomeWords('unknown'), 'Not read');
  assert.equal(durationWords(0), '0 seconds'); assert.equal(countWords(0), '0');
  for (const state of ['not-found', 'unreadable', 'ambiguous', 'not-available'] as const) assert.deepEqual(figureRows(NO_FIGURES(state)).map(r => r.value), ['Not read', 'Not read', 'Not read', 'Not read', 'Not read'], state);
  assert.deepEqual(figureRows(null).map(r => r.value), ['Not read', 'Not read', 'Not read', 'Not read', 'Not read']);
});

test('the figures read as plain words', () => {
  const f: RunFigures = { state: 'found', reason: null, startedAt: '2026-11-11T10:31:00.000Z', endedAt: '2026-11-11T11:36:00.000Z', durationMs: 65 * 60_000, inputTokens: 1234567, outputTokens: 90, model: 'claude-test-1', outcome: 'finished' };
  assert.deepEqual(figureRows(f), [
    { key: 'duration', label: 'Time taken', value: '1 hour 5 minutes' }, { key: 'input', label: 'Input', value: '1,234,567' }, { key: 'output', label: 'Output', value: '90' },
    { key: 'model', label: 'Model', value: 'claude-test-1' }, { key: 'outcome', label: 'Outcome', value: 'Finished' },
  ]);
  assert.deepEqual([1000, 45_000, 60_000, 4 * 60_000, 3_600_000, 2 * 3_600_000 + 60_000].map(durationWords), ['1 second', '45 seconds', '1 minute', '4 minutes', '1 hour', '2 hours 1 minute']);
  assert.deepEqual([0, 7, 999, 1000, 12345].map(countWords), ['0', '7', '999', '1,000', '12,345']);
});

test('each state of the log has its own line, and a log that was read has none', () => {
  assert.equal(figuresStateWords('found'), null);
  assert.equal(figuresStateWords('not-found'), 'No session log found. Details stay as you recorded them.');
  assert.equal(figuresStateWords('unreadable'), 'Could not read the log.');
  assert.equal(figuresStateWords('not-available'), 'Figures are not available for this engine.');
});

test('each reason a run has no figures has its own words, the window and the place are named without a full path, and the cap is named', () => {
  assert.equal(figuresStateWords('not-found', null, '~/Projects/team'), 'No session log found in ~/Projects/team, within an hour of the start. Details stay as you recorded them.');
  assert.equal(figuresStateWords('not-found', 'capped', '~/Projects/team'), 'Searched the newest 300 logs only. Details stay as you recorded them.');
  assert.equal(figuresStateWords('found', 'capped'), 'Searched the newest 300 logs only. This log may not be the right one.');
  assert.equal(figuresStateWords('ambiguous'), 'More than one session log fits this run. Not read.');
  assert.equal(figuresStateWords('unreadable', 'too-large'), 'The log is over 64 MB. Not read.');
  assert.equal(figuresStateWords('unreadable', 'unplaced'), 'Could not tell when the log began. Not read.');
  assert.equal(figuresStateWords('unreadable', 'no-permission'), 'Bowerloom may not open the log. Check its permissions.');
  assert.equal(figuresStateWords('found', 'partial'), 'Part of the log could not be read. Counts are not shown.');
  assert.equal(figuresStateWords('found', 'still-writing'), 'The log may still be written. Figures can change.');
  assert.equal(figuresStateWords('found', 'no-figures'), 'The log holds no figures.');
  const all = ['not-found', 'ambiguous', 'unreadable', 'found', 'not-available'] as const;
  const reasons = [null, 'capped', 'too-large', 'unplaced', 'no-permission', 'partial', 'still-writing', 'no-figures'] as const;
  const lines = all.flatMap(st => reasons.map(r => figuresStateWords(st, r, '~/Projects/site'))).filter((x): x is string => x !== null);
  assert.equal(new Set(lines).size >= 10, true);
  for (const text of lines) { assert.equal(bannedHere(text), null, text); assert.ok(wordCount(text) <= LIMITS.paragraph, text); assert.equal(text.includes('/Users'), false); }
});

test('each refusal code of a runs call has its own words, and the limit says plainly that removing is not there', () => {
  const codes = ['BAD_ARGUMENT', 'UNKNOWN_FOLDER', 'FOLDER_CHARACTER', 'FOLDER_LINK', 'UNKNOWN_RUN', 'RUN_LIMIT', 'STORE_DAMAGED', 'TOO_LONG'];
  const words = codes.map(runsRefusalWords);
  assert.equal(new Set(words).size, codes.length, 'no two codes share words');
  assert.equal(runsRefusalWords('RUN_LIMIT'), '500 runs are saved. Remove some first. Bowerloom cannot remove runs yet.');
  assert.equal(runsRefusalWords('STORE_DAMAGED'), 'Your saved runs file is damaged. Nothing was changed.');
  assert.equal(runsRefusalWords('FAILED'), runsRefusalWords('whatever'));
  for (const text of [...words, runsRefusalWords('FAILED')]) { assert.equal(bannedHere(text), null, text); assert.ok(wordCount(text) <= LIMITS.paragraph, text); assert.doesNotMatch(text, /could not read the log/i); }
});

test('a save is reported for each run: what was saved, and what was not and why', () => {
  assert.equal(saveReportWords([{ name: 'Claude Code', code: null }, { name: 'Codex', code: 'UNKNOWN_RUN' }]), 'Saved Claude Code. Codex was not saved: That run is not saved any more.');
  assert.equal(saveReportWords([{ name: 'Codex', code: 'STORE_DAMAGED' }]), 'Codex was not saved: Your saved runs file is damaged. Nothing was changed.');
  assert.equal(saveReportWords([{ name: 'Claude Code', code: 'TOO_LONG' }, { name: 'Codex', code: 'TOO_LONG' }]), 'Claude Code was not saved: The text is too long. Shorten it. Codex was not saved: The text is too long. Shorten it.');
});

test('times: a start is shown in the computer\'s zone, an unreadable one is said, and the form value round-trips', () => {
  assert.equal(startedAtWords('nope'), 'Unknown time');
  assert.match(startedAtWords('2026-11-11T10:30:00.000Z'), /^Nov (10|11|12), \d{2}:\d{2}$/);
  const iso = localInputToIso('2026-11-11T10:30');
  assert.ok(iso !== null && /Z$/.test(iso));
  assert.equal(isoToLocalInput(Date.parse(iso!)), '2026-11-11T10:30');
  for (const bad of ['', 'x', '2026-11-11', '2026-11-11T10:30:00']) assert.equal(localInputToIso(bad), null, bad);
});

test('the name of a run is the engine in the project', () => { assert.equal(realRunName(run('run-1', 'g', 'codex')), 'Codex in team'); });

test('the empty line points to recording, and the hint and toast count what they say', () => {
  assert.equal(noRunsWords(true), 'No runs yet. Record one after you start an engine.');
  assert.equal(runsHintReal(0), 'No runs yet.'); assert.equal(runsHintReal(1), '1 run. Runs of one instruction are grouped for Compare.'); assert.equal(runsHintReal(3), '3 runs. Runs of one instruction are grouped for Compare.');
  assert.equal(recordedToast(), 'Recorded. Find it in Runs.');
});

test('the words obey the limits of the app: a label at most 5 words, a hint at most 12, a paragraph at most 25, and none of the banned words', () => {
  const walk = (value: unknown, path: string, kind: string): void => {
    if (typeof value === 'string') {
      assert.equal(bannedHere(value), null, `${path}: ${value}`);
      const limit = kind === 'label' ? LIMITS.label : kind === 'paragraph' ? LIMITS.paragraph : LIMITS.hint;
      assert.ok(wordCount(value) <= limit, `${path} has ${wordCount(value)} words: ${value}`);
    } else if (typeof value === 'object' && value !== null) for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`, path === 'RUNS_REAL' ? k : kind);
  };
  walk(RUNS_REAL, 'RUNS_REAL', '');
  for (const text of [runsHintReal(3), recordedToast(), ...figureRows(null).map(r => r.label), ...(['not-found', 'unreadable', 'not-available'] as const).map(s => figuresStateWords(s)!)]) { assert.equal(bannedHere(text), null, text); assert.ok(wordCount(text) <= LIMITS.hint, text); }
  assert.equal(Object.isFrozen(RUNS_REAL), true); assert.equal(Object.isFrozen(RUNS_REAL.label), true);
});

test('no word of the screens says a run is running, or that Bowerloom starts or watches an engine', () => {
  const all = JSON.stringify(RUNS_REAL) + ['Recorded', 'Done'].join(' ');
  assert.doesNotMatch(all, /\brunning\b|\bwatch|\blaunch/i);
  assert.match(RUNS_REAL.paragraph.chatNote, /never reads the chat/i);
});

test('the words of the leave question, the buttons and the figures re-read are as decided', () => {
  assert.equal(RUNS_REAL.hint.leaveAsk, 'You have unsaved ratings or notes. Leave without saving?');
  assert.deepEqual([RUNS_REAL.label.keepEditing, RUNS_REAL.label.leave, RUNS_REAL.label.readAgain], ['Keep editing', 'Leave', 'Read again']);
});
