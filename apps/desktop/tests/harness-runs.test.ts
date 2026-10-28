// Runs, Start and Compare of the harness-first preview: the groups, the words, the finish timing (with a fake clock), the rating lock, and the words of the three screens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_IDS, SAMPLE_INSTRUCTION, createSampleWorld, minutesBefore } from '../shared/harness/sample.js';
import { RUN_FINISH_MS, createHarnessStore, finishRun, rateRun, startRuns } from '../shared/harness/store.js';
import type { Schedule } from '../shared/harness/store.js';
import {
  RATINGS, canRate, compareGroupOf, compareStartedLine, rateQuestion, ratingWords, runById, runGroups, runMeta, runName, runStatusWords, runTitle, runTone, runWhere, runsHint, runsOfGroup, sameInstructionWords,
} from '../shared/harness/runs.js';
import { compareNotice, offeredInterfaces, startButtonWords, startInterfaceLine, startNeeds } from '../shared/harness/status.js';
import { bannedHere, LIMITS, countWords } from '../shared/harness/words.js';
import { RUN_WORDS, bringName, compareTitle, firstSentence, stillRunning } from '../renderer/harness/runs-words.js';
import { minutesOpen, stampWords } from '../shared/harness/time.js';
import type { HarnessState, InterfaceId, Stamp } from '../shared/harness/types.js';

const { weekly, bowerloom, research } = SAMPLE_IDS;
const NOW: Stamp = { daysAgo: 0, time: '11:00' };
const world = createSampleWorld;
// Hermes is no engine of 0.8, so the sample world has no interface that is not found. This makes one, to keep the not-found rules under test.
const notFound = (s: HarnessState, id: InterfaceId): HarnessState => ({ ...s, interfaces: s.interfaces.map(i => (i.id === id ? { ...i, health: 'not-found' as const, healthWords: 'Not found', on: false } : i)) });

/** A clock the test turns by hand: a timer runs only when `tick` reaches its time. */
function fakeClock(): { schedule: Schedule; tick(ms: number): void; pending(): number } {
  let at = 0;
  const timers: { due: number; run: () => void; live: boolean }[] = [];
  return {
    schedule: (run, ms) => { const timer = { due: at + ms, run, live: true }; timers.push(timer); return () => { timer.live = false; }; },
    tick(ms) { at += ms; for (const t of timers) if (t.live && t.due <= at) { t.live = false; t.run(); } },
    pending: () => timers.filter(t => t.live).length,
  };
}

test('runGroups keeps the runs of one instruction together and leaves a lone run on its own', () => {
  const groups = runGroups(world());
  assert.deepEqual(groups.map(g => [g.id, g.runs.map(r => r.id), g.comparable]), [['group-1', ['run-1', 'run-2'], true], [null, ['run-3'], false]]);
  assert.equal(groups[0]!.instruction, SAMPLE_INSTRUCTION);
  assert.deepEqual(runsOfGroup(world(), 'group-1').map(r => r.id), ['run-1', 'run-2']); assert.deepEqual(runsOfGroup(world(), 'nope'), []);
});

test('runGroups agrees with the runs: every run is in exactly one group, in the order of the list', () => {
  let s = world();
  s = startRuns(s, { harnessId: weekly, projectId: bowerloom, interfaceIds: ['claude-code', 'codex'], instruction: 'Go.' }, NOW).state;
  s = startRuns(s, { harnessId: research, projectId: bowerloom, interfaceIds: ['claude-code'], instruction: 'Look.' }, NOW).state;
  const groups = runGroups(s);
  assert.deepEqual(groups.flatMap(g => g.runs.map(r => r.id)).sort(), s.runs.map(r => r.id).sort());
  assert.deepEqual(groups.map(g => g.runs.length), [1, 2, 2, 1]);
  assert.deepEqual(groups.map(g => g.comparable), [false, true, true, false]);
});

test('startRuns makes one run for each interface, running, in one group when there are two or more', () => {
  const two = startRuns(world(), { harnessId: weekly, projectId: bowerloom, interfaceIds: ['claude-code', 'codex'], instruction: '  Write it.  ' }, NOW);
  assert.equal(two.runIds.length, 2); assert.equal(two.state.runs.length, 5);
  const made = two.runIds.map(id => runById(two.state, id)!);
  assert.deepEqual(made.map(r => [r.interfaceId, r.status, r.rating, r.notes, r.instruction]), [['claude-code', 'running', null, '', 'Write it.'], ['codex', 'running', null, '', 'Write it.']]);
  assert.ok(made[0]!.groupId !== null && made[0]!.groupId === made[1]!.groupId);
  assert.equal(compareGroupOf(two.state, made[0]!), made[0]!.groupId);
  const one = startRuns(world(), { harnessId: weekly, projectId: bowerloom, interfaceIds: ['claude-code'], instruction: 'Write it.' }, NOW);
  assert.equal(one.runIds.length, 1); assert.equal(runById(one.state, one.runIds[0]!)!.groupId, null); assert.equal(compareGroupOf(one.state, runById(one.state, one.runIds[0]!)!), null);
  assert.deepEqual(startRuns(world(), { harnessId: weekly, projectId: bowerloom, interfaceIds: ['claude-code'], instruction: '   ' }, NOW).runIds, [], 'an empty instruction starts nothing');
  assert.deepEqual(startRuns(notFound(world(), 'opencode'), { harnessId: weekly, projectId: bowerloom, interfaceIds: ['opencode'], instruction: 'Go.' }, NOW).runIds, [], 'an interface that is not found starts nothing');
});

test('a run finishes by itself after 15 seconds, on a clock the test turns', () => {
  const clock = fakeClock();
  const store = createHarnessStore({ initial: world(), now: () => NOW, schedule: clock.schedule });
  const ids = store.startRuns({ harnessId: weekly, projectId: bowerloom, interfaceIds: ['claude-code', 'codex'], instruction: 'Go.' });
  assert.equal(RUN_FINISH_MS, 15_000); assert.equal(clock.pending(), 2);
  assert.deepEqual(ids.map(id => runById(store.getState(), id)!.status), ['running', 'running']);
  clock.tick(RUN_FINISH_MS - 1);
  assert.deepEqual(ids.map(id => runById(store.getState(), id)!.status), ['running', 'running'], 'not yet');
  clock.tick(1);
  assert.deepEqual(ids.map(id => runById(store.getState(), id)!.status), ['done', 'done']); assert.equal(clock.pending(), 0);
  store.dispose();
});

test('dispose cancels the timers, so a run that was running stays running', () => {
  const clock = fakeClock();
  const store = createHarnessStore({ initial: world(), now: () => NOW, schedule: clock.schedule });
  const [id] = store.startRuns({ harnessId: weekly, projectId: bowerloom, interfaceIds: ['claude-code'], instruction: 'Go.' });
  store.dispose(); clock.tick(RUN_FINISH_MS * 2);
  assert.equal(runById(store.getState(), id!)!.status, 'running');
});

test('the rating is locked until the run is done, then it saves and can be cleared', () => {
  let s = startRuns(world(), { harnessId: weekly, projectId: bowerloom, interfaceIds: ['claude-code'], instruction: 'Go.' }, NOW).state;
  const id = s.runs[0]!.id;
  assert.equal(canRate(runById(s, id)!), false);
  assert.equal(rateRun(s, id, 'better', 'Good.'), s, 'a locked rating changes nothing');
  assert.equal(runById(s, 'run-1')!.status, 'running'); assert.equal(rateRun(s, 'run-1', 'same', 'x'), s);
  s = finishRun(s, id);
  assert.equal(canRate(runById(s, id)!), true);
  s = rateRun(s, id, 'better', 'Good.');
  assert.deepEqual([runById(s, id)!.rating, runById(s, id)!.notes], ['better', 'Good.']);
  s = rateRun(s, id, null, 'Good.');
  assert.equal(runById(s, id)!.rating, null);
  assert.equal(canRate(runById(s, 'run-3')!), true, 'a closed run was done first');
  assert.equal(rateRun(s, 'run-404', 'same', ''), s);
});

test('rating in the store saves in memory and adds no history entry', () => {
  const store = createHarnessStore({ initial: world(), now: () => NOW, schedule: () => () => undefined });
  const before = store.getState().history.length;
  store.rateRun('run-2', 'better', 'Changed my mind.');
  assert.deepEqual([runById(store.getState(), 'run-2')!.rating, runById(store.getState(), 'run-2')!.notes], ['better', 'Changed my mind.']);
  assert.equal(store.getState().history.length, before);
});

test('statuses and counts are computed from the runs, and say the same thing in every place', () => {
  const s = world();
  assert.deepEqual(s.runs.map(r => runStatusWords(r.status)), ['Running', 'Done', 'Closed']);
  assert.deepEqual(s.runs.map(r => runTone(r.status)), ['good', 'quiet', 'quiet']);
  assert.deepEqual(RATINGS.map(ratingWords), ['Better', 'Same', 'Worse']);
  assert.equal(runName(s, s.runs[0]!), 'Weekly report crew in Claude Code'); assert.equal(runName(s, s.runs[1]!), 'Weekly report crew in Codex'); assert.equal(runName(s, s.runs[2]!), 'Research desk in Claude Code');
  assert.equal(runMeta(s, s.runs[0]!), 'bowerloom · started 10:42'); assert.equal(runMeta(s, s.runs[2]!), 'notes · started yesterday 16:05');
  assert.equal(runWhere(s, s.runs[0]!), 'Weekly report crew in bowerloom'); assert.equal(runTitle(s, s.runs[0]!), 'Claude Code run');
  assert.equal(runsHint(3), '3 runs. Runs of one instruction are grouped for Compare.'); assert.equal(runsHint(1), '1 run. Runs of one instruction are grouped for Compare.'); assert.equal(runsHint(0), 'No runs yet.');
  assert.equal(sameInstructionWords(2), 'Same instruction in both runs'); assert.equal(sameInstructionWords(3), 'Same instruction in all 3 runs');
  assert.equal(rateQuestion(s.runs[0]!), 'How did it do? You can rate it when the run is done.'); assert.equal(rateQuestion(s.runs[1]!), 'How did it do?');
});

test('"Started 10:42. Open for 12 minutes." reads the time open from the stamp it is given', () => {
  const s = world(), run = s.runs[0]!;
  assert.equal(compareStartedLine(run, { daysAgo: 0, time: '10:54' }), 'Started 10:42. Open for 12 minutes.');
  assert.equal(compareStartedLine(run, { daysAgo: 0, time: '10:42' }), 'Started 10:42. Open for less than a minute.');
  assert.equal(compareStartedLine(run, { daysAgo: 0, time: '10:43' }), 'Started 10:42. Open for 1 minute.');
  assert.equal(compareStartedLine(run, { daysAgo: 0, time: '12:42' }), 'Started 10:42. Open for 2 hours.');
  assert.equal(compareStartedLine(s.runs[2]!, NOW), 'Started yesterday 16:05. The window is closed.');
});

test('the sample is dated from the clock at the start: the runs are 12 minutes old, the newest changes minutes old, and the order holds across midnight', () => {
  for (const time of ['10:54', '13:30', '00:05', '00:30', '23:59']) {
    const now: Stamp = { daysAgo: 0, time }, w = createSampleWorld(now);
    assert.match(compareStartedLine(w.runs[0]!, now), /Open for 12 minutes\.$/, time);
    assert.deepEqual(w.runs[0]!.started, minutesBefore(now, 12)); assert.deepEqual(w.runs[1]!.started, w.runs[0]!.started);
    assert.equal(minutesOpen(w.runs[0]!, now), 12, time);
    const newest = w.history.slice(0, 2).map(e => minutesOpen({ ...w.runs[0]!, started: e.stamp }, now));
    assert.deepEqual(newest, [14, 42], time);
    const minutesAgo = w.history.map(e => minutesOpen({ ...w.runs[0]!, started: e.stamp }, now));
    assert.deepEqual([...minutesAgo].sort((a, b) => a - b), minutesAgo, `newest first at ${time}`);
  }
  const night = createSampleWorld({ daysAgo: 0, time: '00:10' });
  assert.deepEqual(night.runs[0]!.started, { daysAgo: 1, time: '23:58' }); assert.equal(stampWords(night.history[0]!.stamp), 'Yesterday 23:56');
  assert.deepEqual(createSampleWorld().runs[0]!.started, { daysAgo: 0, time: '10:42' }, 'with no clock the sample is the design\'s own');
  assert.deepEqual(createSampleWorld().history.map(e => e.stamp), [{ daysAgo: 0, time: '10:40' }, { daysAgo: 0, time: '10:12' }, { daysAgo: 1, time: '16:30' }, { daysAgo: 1, time: '16:02' }]);
});

test('minutesOpen counts across midnight and across days instead of stopping at 0', () => {
  const run = (daysAgo: number, time: string) => ({ ...world().runs[0]!, started: { daysAgo, time } });
  assert.equal(minutesOpen(run(1, '23:58'), { daysAgo: 0, time: '00:10' }), 12);
  assert.equal(minutesOpen(run(0, '23:58'), { daysAgo: 0, time: '00:10' }), 12, 'a clock that reads earlier than the start means midnight passed');
  assert.equal(minutesOpen(run(1, '16:05'), { daysAgo: 0, time: '10:54' }), 18 * 60 + 49);
  assert.equal(minutesOpen(run(0, '10:42'), { daysAgo: 0, time: '10:42' }), 0);
  assert.equal(compareStartedLine({ ...run(1, '16:05'), status: 'done' }, { daysAgo: 0, time: '10:54' }), 'Started yesterday 16:05. Open for 18 hours.');
  assert.equal(compareStartedLine({ ...run(3, '10:00'), status: 'done' }, { daysAgo: 0, time: '10:54' }), 'Started 3 days ago 10:00. Open for 3 days.');
});

test('the Start sheet: which interfaces are offered, what each says, and which need an install first', () => {
  const s = world();
  assert.deepEqual(offeredInterfaces(s).map(i => i.id), ['claude-code', 'codex'], 'an interface that is off or not found is not offered');
  assert.deepEqual(['claude-code', 'codex', 'opencode'].map(id => startInterfaceLine(s, bowerloom, weekly, s.interfaces.find(i => i.id === id)!).words),
    ['Installed in this project.', 'Out of date. You review the update before it runs.', 'Not installed. Install, then start.']);
  const gone = notFound(s, 'opencode');
  assert.equal(startInterfaceLine(gone, bowerloom, weekly, gone.interfaces.find(i => i.id === 'opencode')!).words, 'Not found on this computer.');
  assert.deepEqual(startNeeds(s, bowerloom, weekly, ['claude-code']), []);
  assert.deepEqual(startNeeds(s, bowerloom, weekly, ['claude-code', 'codex']), ['codex'], 'out of date opens the install review first');
  assert.deepEqual(startNeeds(s, SAMPLE_IDS.notes, weekly, ['claude-code']), ['claude-code'], 'not installed in this project');
  assert.equal(compareNotice(1), null); assert.equal(compareNotice(2), 'Compare is on. Bowerloom opens 2 runs with the same instruction in one folder, so run them one at a time if they write files.');
  assert.equal(startButtonWords(2), 'Review and start 2 runs'); assert.equal(startButtonWords(1), 'Review and start 1 run');
});

test('the words of Start, Runs and Compare obey the limits and the banned-word rule', () => {
  const groups = [['label', LIMITS.label], ['hint', LIMITS.hint], ['paragraph', LIMITS.paragraph]] as const;
  assert.equal(Object.isFrozen(RUN_WORDS), true); assert.equal(Object.isFrozen(RUN_WORDS.label), true);
  for (const [group, limit] of groups) for (const [key, text] of Object.entries(RUN_WORDS[group])) { assert.ok(countWords(text) <= limit, `${group}.${key}: ${text}`); assert.equal(bannedHere(text), null, `${group}.${key}`); }
  const built = [stillRunning(['Claude Code']), stillRunning(['Claude Code', 'Codex']), compareTitle(SAMPLE_INSTRUCTION), bringName('Claude Code'), runsHint(3), sameInstructionWords(2), rateQuestion(world().runs[0]!), compareStartedLine(world().runs[0]!, NOW)];
  for (const text of built) assert.equal(bannedHere(text), null, text);
  assert.ok(countWords(stillRunning(['Claude Code', 'Codex'])) <= LIMITS.hint);
  // The words that are copied from the pictures.
  assert.equal(RUN_WORDS.label.bringFront, 'Bring window to the front'); assert.equal(RUN_WORDS.label.openCompare, 'Open compare'); assert.equal(RUN_WORDS.label.saveRating, 'Save rating and notes'); assert.equal(RUN_WORDS.label.closeCompare, 'Close compare');
  assert.equal(RUN_WORDS.hint.saved, 'Saved on this computer, in Bowerloom. Your project files do not change.');
  assert.equal(RUN_WORDS.paragraph.startNote, 'Bowerloom opens each interface with your instruction. It never reads the chat.');
  assert.equal(RUN_WORDS.paragraph.chatNote, 'Bowerloom does not read or keep the chat. Read it in the interface window.');
});

test('the heading of a group holds the first sentence of the instruction, as in the design', () => {
  assert.equal(firstSentence(SAMPLE_INSTRUCTION), 'Write a weekly report from the notes in Meetings.');
  assert.equal(compareTitle(firstSentence(SAMPLE_INSTRUCTION)), 'Compare: Write a weekly report from the notes in Meetings.');
  assert.equal(firstSentence('  One sentence only  '), 'One sentence only'); assert.equal(firstSentence('Check v1.2 now. Then stop.'), 'Check v1.2 now.'); assert.equal(firstSentence(''), '');
});
