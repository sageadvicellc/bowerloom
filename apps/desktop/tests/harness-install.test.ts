// The install sheet of the harness-first preview, as pure logic: the list of files, the gate on conflicts, the interfaces it offers, the status after an install, and the words of the first-run,
// Projects, install, Interfaces and history screens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_IDS, createSampleWorld } from '../shared/harness/sample.js';
import { HARNESS_FILE, buildInstallPlan, defaultChoices, installButtonWords, keepBothName, planSummary } from '../shared/harness/files.js';
import { CHOICE_WORDS, chosenInterfaces, choiceFor, choiceHint, choicesOf, defaultInterfaces, interfaceLine, selectable, settled, unsettled } from '../shared/harness/install-flow.js';
import { FIXED_NOW, UNDO_NEWER_FIRST, install, removeInstall, setInterfaceOn, undoEntry } from '../shared/harness/store.js';
import { harnessById, harnessStatus, installOf, installLine, interfaceById, projectStatus, startNeeds } from '../shared/harness/status.js';
import { entryMeta, groupByDay } from '../shared/harness/time.js';
import { CONFLICT_CHOICES } from '../shared/harness/types.js';
import type { ConflictChoice } from '../shared/harness/types.js';
import { LIMITS, bannedHere, countWords } from '../shared/harness/words.js';
import { FILE_WORDS, FLOW, actionFor, actionName, conflictTitle, foundSources, installAction, installFor, interfaceSwitch, interfacesHint, makeAll, makeFrom, nothingChanged, readTitle, removedWords, reviewFor, reviewLine, savedAs, settledWords, undoName, updateFor } from '../renderer/harness/words-flow.js';

const { weekly, caveman, inbox, research, bowerloom, garden, archive, notes } = SAMPLE_IDS;
const world = createSampleWorld;
const CC = ['claude-code', 'codex'] as const;

test('the review of Weekly report crew in bowerloom lists every file of the design: 10 files, 7 new, 2 updates, 1 conflict', () => {
  const plan = buildInstallPlan(world(), bowerloom, weekly, CC);
  assert.equal(plan.counts.total, 10);
  assert.deepEqual([plan.counts.new, plan.counts.update, plan.counts.conflict], [7, 2, 1]);
  assert.equal(planSummary(plan), '7 new files, 2 updates and 1 conflict');
  assert.equal(installButtonWords(plan), 'Install 10 files');
  assert.deepEqual(plan.manifest, { path: '.bowerloom/harness.json', state: 'new' });
  assert.deepEqual(plan.groups.map(g => g.interfaceId), ['claude-code', 'codex']);
  assert.deepEqual(plan.groups[0]!.files.map(f => `${f.path} ${f.state}`), [
    '.claude/agents/planner.md new', '.claude/agents/researcher.md new', '.claude/agents/writer.md update', '.claude/skills/draft-outline/SKILL.md new', '.claude/skills/check-facts/SKILL.md update']);
  assert.deepEqual(plan.groups[1]!.files.map(f => `${f.path} ${f.state}`), [
    '.codex/agents/planner.toml new', '.codex/agents/researcher.toml new', '.codex/agents/writer.toml conflict', '.agents/skills/draft-outline/SKILL.md new']);
  assert.deepEqual(plan.conflicts.map(f => f.path), ['.codex/agents/writer.toml']);
  assert.equal(plan.manifest.path, HARNESS_FILE);
});

test('every install plan names the one harness file of the folder, .bowerloom/harness.json, and never a file under .bowerloom/harnesses/', () => {
  const w = world();
  assert.equal(HARNESS_FILE, '.bowerloom/harness.json');
  for (const project of w.projects) for (const harness of w.harnesses) {
    const plan = buildInstallPlan(w, project.id, harness.id, CC);
    assert.equal(plan.manifest.path, HARNESS_FILE, `${project.id} ${harness.id}`);
    for (const f of [plan.manifest, ...plan.groups.flatMap(g => g.files)]) assert.doesNotMatch(f.path, /^\.bowerloom\/harnesses\//, f.path);
  }
});

test('every other install gets a list by one rule, and every file of every group is in the count', () => {
  const w = world();
  for (const [project, harness] of [[archive, inbox], [garden, caveman], [notes, research], [archive, weekly]] as const) {
    const plan = buildInstallPlan(w, project, harness, CC);
    assert.equal(plan.counts.total, 1 + plan.groups.reduce((n, g) => n + g.files.length, 0), `${project} ${harness}`);
    assert.equal(plan.counts.new + plan.counts.update + plan.counts.conflict, plan.counts.total);
    for (const group of plan.groups) assert.ok(group.files.length > 0);
  }
  const fresh = buildInstallPlan(w, archive, inbox, CC);
  assert.equal(fresh.counts.update + fresh.counts.conflict, 0, 'nothing is installed in archive, so every file is new');
  assert.equal(fresh.manifest.state, 'new');
  const codexOnly = buildInstallPlan(w, notes, research, ['codex']);
  assert.equal(codexOnly.counts.conflict, 1, 'the conflict of notes shows in the review');
  assert.equal(buildInstallPlan(w, notes, research, []).groups.length, 0);
});

test('Install waits until every conflict is settled: a choice that is pressed settles it, "Keep mine" only counts once pressed', () => {
  const plan = buildInstallPlan(world(), bowerloom, weekly, CC), path = '.codex/agents/writer.toml';
  assert.equal(settled(plan, []), false);
  assert.deepEqual(unsettled(plan, []), [path]);
  assert.equal(choiceFor({}, path), 'keep-mine', 'Keep mine is the one that starts highlighted');
  assert.deepEqual(choicesOf(plan, {}), { [path]: 'keep-mine' });
  assert.deepEqual(defaultChoices(plan), { [path]: 'keep-mine' });
  assert.equal(settled(plan, [path]), true);
  assert.deepEqual(unsettled(plan, [path]), []);
  for (const c of CONFLICT_CHOICES) assert.deepEqual(choicesOf(plan, { [path]: c as ConflictChoice }), { [path]: c });
  const claudeOnly = buildInstallPlan(world(), bowerloom, weekly, ['claude-code']);
  assert.equal(claudeOnly.conflicts.length, 0);
  assert.equal(settled(claudeOnly, []), true, 'a plan with no conflict is ready');
  assert.equal(settled(plan, ['.codex/agents/other.toml']), false, 'a choice for another file settles nothing');
});

test('the three choices are named and explained in one line each; Keep both says what it creates', () => {
  assert.deepEqual(CONFLICT_CHOICES, ['keep-mine', 'use-harness', 'keep-both']);
  assert.deepEqual(CONFLICT_CHOICES.map(c => CHOICE_WORDS[c]), ['Keep mine', 'Use the harness copy', 'Keep both']);
  assert.equal(choiceHint('keep-mine', '.codex/agents/writer.toml'), 'Your file stays as it is.');
  assert.equal(choiceHint('use-harness', '.codex/agents/writer.toml'), 'Your file is replaced. Undo brings it back.');
  assert.equal(choiceHint('keep-both', '.codex/agents/writer.toml'), 'Saves the harness copy next to yours as writer.harness.toml.');
  assert.equal(keepBothName('.codex/agents/writer.toml'), 'writer.harness.toml');
  assert.equal(conflictTitle('.codex/agents/writer.toml'), 'Conflict: .codex/agents/writer.toml already exists. Pick one.');
  assert.equal(settledWords(CHOICE_WORDS['keep-both']), 'Settled. Keep both.');
});

test('the interface step: the design ticks Claude Code and Codex, and says why OpenCode cannot be ticked', () => {
  const w = world(), h = harnessById(w, weekly)!;
  assert.deepEqual(defaultInterfaces(w, bowerloom, weekly), ['claude-code', 'codex']);
  assert.deepEqual(defaultInterfaces(w, archive, inbox), ['claude-code', 'codex'], 'nothing installed yet: every ready interface');
  assert.deepEqual(defaultInterfaces(w, garden, caveman), ['claude-code'], 'an update offers only the interfaces that were installed');
  assert.deepEqual(defaultInterfaces(w, null, null), ['claude-code', 'codex']);
  const line = (id: Parameters<typeof interfaceById>[1]) => interfaceLine(w, h, interfaceById(w, id)!);
  assert.deepEqual(line('claude-code'), { words: 'Found. Uses all 11 parts.', tone: 'good' });
  assert.deepEqual(line('codex'), { words: 'Found. Cannot use 1 tool: Spreadsheet.', tone: 'warn' });
  assert.deepEqual(line('opencode'), { words: 'Found. Its config file has a problem, so it is off.', tone: 'warn' });
  assert.deepEqual([...w.interfaces].map(selectable), [true, true, false]);
});

test('the Interfaces switches change what the install sheet offers', () => {
  const w = world(), off = setInterfaceOn(w, 'codex', false, FIXED_NOW), h = harnessById(off, weekly)!;
  assert.deepEqual(chosenInterfaces(off, null, bowerloom, weekly), ['claude-code']);
  assert.deepEqual(chosenInterfaces(off, ['claude-code', 'codex'], bowerloom, weekly), ['claude-code'], 'a tick for an interface that is off is dropped');
  assert.deepEqual(interfaceLine(off, h, interfaceById(off, 'codex')!), { words: 'Found. Switched off in Engines.', tone: 'quiet' });
  assert.equal(buildInstallPlan(off, bowerloom, weekly, chosenInterfaces(off, null, bowerloom, weekly)).groups.length, 1);
  const on = setInterfaceOn(off, 'opencode', true, FIXED_NOW);
  assert.deepEqual(chosenInterfaces(on, ['claude-code', 'opencode'], bowerloom, weekly), ['claude-code', 'opencode']);
  assert.equal(interfaceLine(on, harnessById(on, weekly)!, interfaceById(on, 'opencode')!).words, 'Found. Its config file has a problem.');
  const none = setInterfaceOn(setInterfaceOn(off, 'claude-code', false, FIXED_NOW), 'codex', false, FIXED_NOW);
  assert.deepEqual(chosenInterfaces(none, null, bowerloom, weekly), []);
});

test('after the install the statuses change on every screen, one history entry says how many files, and Undo restores them', () => {
  const w = world();
  assert.equal(projectStatus(w, bowerloom)!.words, 'Codex out of date');
  assert.equal(harnessStatus(w, weekly).words, 'Needs an update in 1 of 2 projects');
  const plan = buildInstallPlan(w, bowerloom, weekly, CC);
  const done = install(w, { projectId: bowerloom, harnessId: weekly, interfaceIds: CC, conflictChoices: choicesOf(plan, {}) }, FIXED_NOW);
  assert.equal(projectStatus(done, bowerloom)!.words, 'All installed');
  assert.equal(harnessStatus(done, weekly).words, 'Installed in 2 projects');
  assert.equal(installLine(done, installOf(done, bowerloom, weekly)!).words, 'All installed');
  const entry = done.history[0]!;
  assert.equal(entry.text, 'Installed Weekly report crew in bowerloom');
  assert.equal(entry.filesWritten, 9, 'ten files are listed; the conflicting one is kept as the person\'s own, so it is not written');
  assert.equal(entryMeta(entry), 'Today 10:50 · Robin · this Mac · 9 files written');
  assert.equal(done.history.length, w.history.length + 1);
  const back = undoEntry(done, entry.id, FIXED_NOW);
  assert.equal(projectStatus(back, bowerloom)!.words, 'Codex out of date');
  assert.equal(harnessStatus(back, weekly).words, 'Needs an update in 1 of 2 projects');
  assert.equal(back.history[0]!.text, 'Undid: Installed Weekly report crew in bowerloom');
  assert.equal(back.history.find(e => e.id === entry.id)!.undone, true);
  assert.equal(undoEntry(back, entry.id, FIXED_NOW), back, 'a change is undone once');
});

test('installing into a project with no harness makes its status appear, and removing takes it away; both undo', () => {
  const w = world();
  assert.equal(projectStatus(w, archive), null);
  const done = install(w, { projectId: archive, harnessId: inbox, interfaceIds: ['claude-code'] }, FIXED_NOW);
  assert.equal(projectStatus(done, archive)!.words, 'All installed');
  assert.equal(harnessStatus(done, inbox).words, 'Installed in 1 project');
  const gone = removeInstall(done, archive, inbox, FIXED_NOW);
  assert.equal(projectStatus(gone, archive), null);
  assert.equal(gone.history[0]!.text, 'Removed Inbox helper from archive');
  assert.equal(gone.history[0]!.filesWritten, 0);
  assert.equal(projectStatus(undoEntry(gone, gone.history[0]!.id, FIXED_NOW), archive)!.words, 'All installed');
  assert.equal(removeInstall(w, archive, inbox, FIXED_NOW), w, 'nothing to remove');
  assert.equal(removeInstall(w, 'project-nope', inbox, FIXED_NOW), w);
});

test('the history screen groups the entries by day, newest first, and each says its time, person, computer and files', () => {
  const w = world(), days = groupByDay(w.history);
  assert.deepEqual(days.map(d => d.day), ['Today', 'Yesterday']);
  assert.deepEqual(days[0]!.entries.map(e => e.text), ['Installed Weekly report crew in bowerloom', 'Added Spreadsheet to Weekly report crew']);
  assert.deepEqual(days[1]!.entries.map(e => e.text), ['Linked Writer to Translate in Weekly report crew', 'Made Weekly report crew from a scan']);
  assert.deepEqual(w.history.map(e => entryMeta(e)), ['Today 10:40 · Robin · this Mac · 10 files written', 'Today 10:12 · Robin · this Mac · manifest changed', 'Yesterday 16:30 · Robin · this Mac · manifest changed', 'Yesterday 16:02 · Robin · this Mac · manifest created']);
  const off = setInterfaceOn(w, 'codex', false, FIXED_NOW);
  assert.equal(off.history[0]!.text, 'Turned off Codex');
  assert.equal(entryMeta(off.history[0]!), 'Today 10:50 · Robin · this Mac · settings changed');
});

test('the words of the first-run, Projects, install, Interfaces and history screens obey the rules: limits, no banned word', () => {
  const groups = [['label', LIMITS.label], ['hint', LIMITS.hint], ['paragraph', LIMITS.paragraph]] as const;
  assert.equal(Object.isFrozen(FLOW), true); assert.equal(Object.isFrozen(FLOW.label), true);
  for (const [group, limit] of groups) {
    const entries = Object.entries(FLOW[group]);
    assert.ok(entries.length >= 2, group);
    for (const [key, text] of entries) { assert.ok(countWords(text) <= limit, `${group}.${key}: ${text}`); assert.equal(bannedHere(text), null, `${group}.${key}`); assert.equal(text, text.trim(), `${group}.${key}`); }
  }
  assert.deepEqual([FLOW.label.findMyFiles, FLOW.label.looksRight, FLOW.label.makeFromThis, FLOW.label.notNow, FLOW.label.showDetails, FLOW.label.addFolder], ['Find my files', 'Looks right', 'Make a harness from this', 'Not now', 'Show details', 'Add a folder']);
  assert.deepEqual([FLOW.hint.welcomeLineOne, FLOW.hint.welcomeLineTwo], ['Build a harness from your agents and skills.', 'Then run it in any engine you use.']);
  assert.equal(FLOW.paragraph.chooseLine, 'Untick a source to skip it. Bowerloom reads the names and text of the files you keep. The text stays on this computer.');
  assert.equal(FLOW.paragraph.readLine, 'A harness is a saved list of agents and skills. Bowerloom stores it as one small file in the project you install it to.');
  assert.equal(FLOW.hint.installNote, 'Nothing changes until you press Install. You can undo in Install history.');
  assert.equal(FLOW.hint.historyHint, 'Newest first. Undo puts back what the change replaced.');
  assert.equal(FLOW.hint.removeNote, 'This does not delete your files. It removes only what Bowerloom wrote.');
  assert.equal(interfacesHint(4), '4 engines. Bowerloom installs only for the ones that are switched on.');
  assert.equal(foundSources(4), 'Found 4 sources'); assert.equal(readTitle(4), 'Read 4 sources. Make a harness from each.'); assert.equal(makeAll(4), 'Make all 4');
  assert.deepEqual(Object.values(FILE_WORDS), ['New', 'Update', 'Conflict', 'Same']);
  assert.deepEqual([actionFor('out-of-date'), actionFor('conflict'), actionFor('not-installed'), actionFor('installed')], ['Update', 'Review', 'Install', null]);
});

test('Start then Install: the interfaces ticked in Start are the ones the review lists and Install makes current, so Start goes on', () => {
  const w = world();
  assert.deepEqual(chosenInterfaces(w, null, garden, caveman), ['claude-code'], 'with no ticks passed, only the interface already used is ticked: Codex would be left out');
  const ticked = chosenInterfaces(w, ['claude-code', 'codex'], garden, caveman);
  assert.deepEqual(ticked, ['claude-code', 'codex']);
  assert.deepEqual(startNeeds(w, garden, caveman, ticked), ['claude-code', 'codex']);
  const plan = buildInstallPlan(w, garden, caveman, ticked);
  assert.deepEqual(plan.groups.map(g => g.interfaceId), ['claude-code', 'codex']);
  assert.ok(plan.groups[1]!.files.length > 0 && plan.groups[1]!.files.every(f => f.state === 'new' && (f.path.startsWith('.codex/') || f.path.startsWith('.agents/'))));
  const done = install(w, { projectId: garden, harnessId: caveman, interfaceIds: ticked, conflictChoices: choicesOf(plan, {}) }, FIXED_NOW);
  assert.deepEqual(startNeeds(done, garden, caveman, ticked), [], 'nothing is left to install, so Start can go on');
});

test('the words built from a name, a path or a number obey the same rules', () => {
  const w = world(), h = harnessById(w, weekly)!, plan = buildInstallPlan(w, bowerloom, weekly, CC);
  const built = [makeFrom('Caveman (plug-in)'), actionName('Update', 'Weekly report crew', 'bowerloom'), installFor('Codex'), updateFor('Codex'), reviewFor('Codex'), savedAs(HARNESS_FILE), installAction('Weekly report crew', 'bowerloom'),
    interfaceSwitch('Codex'), undoName('Installed Weekly report crew in bowerloom'), removedWords('Weekly report crew'), nothingChanged('that link is there already'), nothingChanged(UNDO_NEWER_FIRST), FLOW.hint.undoFirst, settledWords('Keep mine'), foundSources(1), readTitle(1), makeAll(2), interfacesHint(1)];
  for (const text of built) assert.equal(bannedHere(text), null, text);
  for (const text of [savedAs(HARNESS_FILE), conflictTitle('.codex/agents/writer.toml'), reviewLine(planSummary(plan), '~/Workshop/code/bowerloom')]) { assert.ok(countWords(text) <= LIMITS.hint + 5, text); assert.equal(bannedHere(text), null, text); }
  for (const c of CONFLICT_CHOICES) { const text = choiceHint(c, '.codex/agents/writer.toml'); assert.ok(countWords(text) <= LIMITS.hint, text); assert.equal(bannedHere(text), null, text); assert.equal(bannedHere(CHOICE_WORDS[c]), null); }
  for (const iface of w.interfaces) { const line = interfaceLine(w, h, iface).words; assert.ok(countWords(line) <= LIMITS.hint, line); assert.equal(bannedHere(line), null, line); }
  assert.ok(countWords(reviewLine(planSummary(plan), '~/Workshop/code/bowerloom')) <= LIMITS.paragraph);
  assert.ok(countWords(conflictTitle('.codex/agents/writer.toml')) <= LIMITS.hint);
});
