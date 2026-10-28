// The store of the harness-first preview: every action, its history entry, and its undo. Pure data: no file, no clock, no random number.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_IDS, createSampleWorld } from '../shared/harness/sample.js';
import {
  FIXED_NOW, RUN_FINISH_MS, UNDO_NEWER_FIRST, addLink, addLinkProblem, addPart, chooseSources, createHarness, createHarnessFromSource, createHarnessStore, finishRun, fixFor, fixMissingPart, install,
  installProblem, rateRun, removeLink, removePart, setInterfaceOn, setNodePosition, startProblem, startRuns, tryUndo, undoBlocker, undoEntry, update,
} from '../shared/harness/store.js';
import type { Schedule } from '../shared/harness/store.js';
import { buildInstallPlan, defaultChoices, installButtonWords, keepBothName, planSummary } from '../shared/harness/files.js';
import { harnessById, installOf, kindCounts, partsWords, projectStatus, harnessStatus } from '../shared/harness/status.js';
import type { HarnessState, InterfaceId, Stamp } from '../shared/harness/types.js';

const { weekly, caveman, inbox, research, bowerloom, garden, archive, notes } = SAMPLE_IDS;
const NOW: Stamp = { daysAgo: 0, time: '11:00' };
const world = createSampleWorld;
// Hermes is no engine of 0.8, so the sample world has no interface that is not found. This makes one, to keep the not-found rules under test.
const notFound = (s: HarnessState, id: InterfaceId): HarnessState => ({ ...s, interfaces: s.interfaces.map(i => (i.id === id ? { ...i, health: 'not-found' as const, healthWords: 'Not found', on: false } : i)) });
const weeklyOf = (s: ReturnType<typeof world>) => harnessById(s, weekly)!;

test('every reducer leaves the state it was given untouched', () => {
  const s = world(), before = JSON.stringify(s);
  const a = addPart(s, weekly, 'skill-translate', NOW), b = removePart(a, weekly, 'agent-writer', NOW), c = addLink(b, weekly, 'agent-researcher', 'skill-translate', NOW);
  install(c, { projectId: archive, harnessId: inbox, interfaceIds: ['claude-code'] }, NOW);
  startRuns(c, { harnessId: weekly, projectId: bowerloom, interfaceIds: ['claude-code', 'codex'], instruction: 'Go.' }, NOW);
  undoEntry(c, c.history[0]!.id, NOW);
  assert.equal(JSON.stringify(s), before);
});

test('createHarness makes an empty "New harness", a second one is named "New harness 2", and both can be undone', () => {
  const one = createHarness(world(), NOW), two = createHarness(one.state, NOW);
  const made = harnessById(one.state, one.harnessId)!;
  assert.equal(made.name, 'New harness'); assert.deepEqual(made.partIds, []); assert.equal(partsWords(made), '0 parts');
  assert.equal(harnessById(two.state, two.harnessId)!.name, 'New harness 2');
  assert.equal(one.state.history[0]!.text, 'Made New harness'); assert.equal(one.state.history[0]!.manifest, 'created');
  const undone = undoEntry(two.state, two.state.history[0]!.id, NOW);
  assert.equal(harnessById(undone, two.harnessId), undefined); assert.ok(harnessById(undone, one.harnessId));
});

test('createHarnessFromSource: the harness holds the parts of that source, every agent is linked, and an unknown source does nothing', () => {
  const s = world();
  const r = createHarnessFromSource(s, 'src-codex', NOW);
  const h = harnessById(r.state, r.harnessId!)!;
  assert.equal(h.name, 'Codex folder'); assert.equal(h.partIds.length, 7);
  assert.deepEqual(kindCounts(r.state, h), { agent: 2, skill: 5, tool: 0, context: 0 });
  assert.equal(h.links.length, 5); assert.ok(h.links.every(l => l.from.startsWith('agent-')));
  assert.equal(r.state.history[0]!.text, 'Made Codex folder from a scan');
  assert.equal(createHarnessFromSource(r.state, 'src-codex', NOW).state.harnesses.at(-1)!.name, 'Codex folder 2');
  const nothing = createHarnessFromSource(s, 'src-nope', NOW);
  assert.equal(nothing.harnessId, null); assert.equal(nothing.state, s);
});

test('all four scan sources make four harnesses; chooseSources keeps only real ids', () => {
  let s = world();
  assert.deepEqual(s.chosenSourceIds, ['src-caveman', 'src-claude', 'src-codex', 'src-hermes']);
  s = chooseSources(s, ['src-codex', 'src-nope', 'src-hermes']);
  assert.deepEqual(s.chosenSourceIds, ['src-codex', 'src-hermes']);
  for (const id of ['src-caveman', 'src-claude', 'src-codex', 'src-hermes']) s = createHarnessFromSource(s, id, NOW).state;
  assert.equal(s.harnesses.length, 8);
});

test('addPart adds the part, marks it new, records a manifest change, and refuses a part that is held or unknown', () => {
  const s = world();
  const a = addPart(s, caveman, 'tool-web-search', NOW);
  const h = harnessById(a, caveman)!;
  assert.ok(h.partIds.includes('tool-web-search')); assert.ok(h.newPartIds.includes('tool-web-search'));
  assert.equal(a.history[0]!.text, 'Added Web search to Caveman pack'); assert.equal(a.history[0]!.manifest, 'changed'); assert.equal(a.history[0]!.filesWritten, 0);
  assert.equal(addPart(a, caveman, 'tool-web-search', NOW), a, 'held already');
  assert.equal(addPart(s, caveman, 'tool-nope', NOW), s); assert.equal(addPart(s, 'harness-nope', 'tool-web-search', NOW), s);
  const back = undoEntry(a, a.history[0]!.id, NOW);
  assert.ok(!harnessById(back, caveman)!.partIds.includes('tool-web-search'));
});

test('removePart takes the part and its links away, and undo puts back the part, its links, its place and its "new" dot', () => {
  const s = world();
  const r = removePart(s, weekly, 'tool-spreadsheet', NOW);
  const h = weeklyOf(r);
  assert.ok(!h.partIds.includes('tool-spreadsheet')); assert.ok(!h.newPartIds.includes('tool-spreadsheet')); assert.equal(h.links.some(l => l.to === 'tool-spreadsheet'), false); assert.equal(h.positions['tool-spreadsheet'], undefined);
  assert.equal(partsWords(h), '10 parts'); assert.equal(r.history[0]!.text, 'Removed Spreadsheet from Weekly report crew');
  const u = undoEntry(r, r.history[0]!.id, NOW), back = weeklyOf(u);
  assert.ok(back.partIds.includes('tool-spreadsheet')); assert.ok(back.newPartIds.includes('tool-spreadsheet'));
  assert.ok(back.links.some(l => l.from === 'agent-planner' && l.to === 'tool-spreadsheet')); assert.deepEqual(back.positions['tool-spreadsheet'], { x: 440, y: 116 });
  const agent = removePart(s, weekly, 'agent-researcher', NOW);
  assert.equal(weeklyOf(agent).links.filter(l => l.from === 'agent-researcher').length, 0);
  assert.equal(removePart(s, weekly, 'skill-translate', NOW), s, 'not held');
});

test('addLink links an agent to a held part in the manifest, once; it refuses an agent target, a non-agent source and a part the harness lacks', () => {
  const s = world();
  const a = addLink(s, weekly, 'agent-researcher', 'skill-format-report', NOW);
  assert.ok(weeklyOf(a).links.some(l => l.from === 'agent-researcher' && l.to === 'skill-format-report'));
  assert.equal(a.history[0]!.text, 'Linked Researcher to Format report in Weekly report crew'); assert.equal(a.history[0]!.manifest, 'changed');
  assert.equal(addLink(a, weekly, 'agent-researcher', 'skill-format-report', NOW), a, 'once');
  assert.equal(addLink(s, weekly, 'agent-researcher', 'agent-writer', NOW), s); assert.equal(addLink(s, weekly, 'skill-check-facts', 'tool-web-search', NOW), s);
  assert.equal(addLink(s, weekly, 'agent-researcher', 'skill-answer-a-common-question', NOW), s); assert.equal(addLink(s, weekly, 'agent-researcher', 'agent-researcher', NOW), s);
  const missing = addLink(s, weekly, 'agent-researcher', 'missing-translate', NOW);
  assert.equal(missing.history[0]!.text, 'Linked Researcher to Translate in Weekly report crew', 'a missing part can be linked to');
  const u = undoEntry(a, a.history[0]!.id, NOW);
  assert.equal(weeklyOf(u).links.some(l => l.from === 'agent-researcher' && l.to === 'skill-format-report'), false);
});

test('removeLink and its undo', () => {
  const s = world(), r = removeLink(s, weekly, 'agent-planner', 'tool-spreadsheet', NOW);
  assert.equal(weeklyOf(r).links.length, 9); assert.equal(r.history[0]!.text, 'Unlinked Planner from Spreadsheet in Weekly report crew');
  assert.equal(weeklyOf(undoEntry(r, r.history[0]!.id, NOW)).links.length, 10);
  assert.equal(removeLink(s, weekly, 'agent-planner', 'tool-web-search', NOW), s);
});

test('setNodePosition saves a whole-number place in the manifest and adds no history entry; unknown nodes and no-ops change nothing', () => {
  const s = world(), r = setNodePosition(s, weekly, 'agent-writer', { x: 100.4, y: 300.6 });
  assert.deepEqual(weeklyOf(r).positions['agent-writer'], { x: 100, y: 301 }); assert.equal(r.history.length, s.history.length);
  assert.equal(setNodePosition(r, weekly, 'agent-writer', { x: 100, y: 301 }), r);
  assert.equal(setNodePosition(s, weekly, 'agent-nobody', { x: 1, y: 1 }), s); assert.equal(setNodePosition(s, weekly, 'agent-writer', { x: Number.NaN, y: 1 }), s);
  assert.ok(setNodePosition(s, weekly, 'missing-translate', { x: 5, y: 6 }) !== s, 'a missing part can be moved too');
});

test('fixMissingPart: the Library part takes the place of the missing one, the link follows, the counts stay and undo brings the missing part back', () => {
  const s = world();
  assert.deepEqual(kindCounts(s, weeklyOf(s)), { agent: 3, skill: 5, tool: 2, context: 2 }); assert.equal(partsWords(weeklyOf(s)), '11 parts');
  assert.deepEqual(fixFor(s, weekly, 'missing-translate'), { ref: { id: 'missing-translate', kind: 'skill', name: 'Translate' }, partId: 'skill-translate' });
  const f = fixMissingPart(s, weekly, 'missing-translate', NOW), h = weeklyOf(f);
  assert.deepEqual(h.missing, []); assert.ok(h.partIds.includes('skill-translate'));
  assert.ok(h.links.some(l => l.from === 'agent-writer' && l.to === 'skill-translate')); assert.equal(h.links.some(l => l.to === 'missing-translate'), false);
  assert.deepEqual(h.positions['skill-translate'], { x: 440, y: 648 }); assert.equal(h.positions['missing-translate'], undefined);
  assert.deepEqual(kindCounts(f, h), { agent: 3, skill: 5, tool: 2, context: 2 }); assert.equal(partsWords(h), '12 parts');
  assert.equal(f.history[0]!.text, 'Added Translate to Weekly report crew');
  const u = weeklyOf(undoEntry(f, f.history[0]!.id, NOW));
  assert.deepEqual(u.missing, [{ id: 'missing-translate', kind: 'skill', name: 'Translate' }]); assert.ok(!u.partIds.includes('skill-translate'));
  assert.ok(u.links.some(l => l.from === 'agent-writer' && l.to === 'missing-translate'));
  assert.equal(fixMissingPart(s, weekly, 'missing-nothing', NOW), s);
  assert.equal(fixMissingPart(f, weekly, 'missing-translate', NOW), f, 'fixed already');
});

test('the install list for Weekly report crew in bowerloom is the design list: 10 files, 7 new, 2 updates, 1 conflict', () => {
  const plan = buildInstallPlan(world(), bowerloom, weekly, ['claude-code', 'codex']);
  assert.deepEqual(plan.counts, { new: 7, update: 2, conflict: 1, total: 10 });
  assert.deepEqual(plan.manifest, { path: '.bowerloom/harnesses/weekly-report-crew.json', state: 'new' });
  assert.deepEqual(plan.groups.map(g => g.interfaceId), ['claude-code', 'codex']);
  assert.deepEqual(plan.groups[0]!.files, [
    { path: '.claude/agents/planner.md', state: 'new' }, { path: '.claude/agents/researcher.md', state: 'new' }, { path: '.claude/agents/writer.md', state: 'update' },
    { path: '.claude/skills/draft-outline/SKILL.md', state: 'new' }, { path: '.claude/skills/check-facts/SKILL.md', state: 'update' },
  ]);
  assert.deepEqual(plan.groups[1]!.files, [
    { path: '.codex/agents/planner.toml', state: 'new' }, { path: '.codex/agents/researcher.toml', state: 'new' }, { path: '.codex/agents/writer.toml', state: 'conflict' },
    { path: '.agents/skills/draft-outline/SKILL.md', state: 'new' },
  ]);
  assert.deepEqual(plan.conflicts, [{ path: '.codex/agents/writer.toml', state: 'conflict' }]);
  assert.equal(planSummary(plan), '7 new files, 2 updates and 1 conflict'); assert.equal(installButtonWords(plan), 'Install 10 files');
  assert.deepEqual(defaultChoices(plan), { '.codex/agents/writer.toml': 'keep-mine' });
  assert.equal(keepBothName('.codex/agents/writer.toml'), 'writer.harness.toml');
  const oneOnly = buildInstallPlan(world(), bowerloom, weekly, ['codex']);
  assert.equal(oneOnly.groups.length, 1); assert.equal(oneOnly.counts.total, 5);
});

test('any other install list follows one rule: a new manifest, an agent file for each agent, and the first two skills', () => {
  const plan = buildInstallPlan(world(), archive, inbox, ['claude-code', 'codex']);
  assert.equal(plan.manifest.state, 'new'); assert.equal(plan.manifest.path, '.bowerloom/harnesses/inbox-helper.json');
  assert.deepEqual(plan.groups[0]!.files.map(f => f.path), ['.claude/agents/inbox-sorter.md', '.claude/skills/answer-a-common-question/SKILL.md', '.claude/skills/sort-the-inbox/SKILL.md']);
  assert.ok(plan.groups.every(g => g.files.every(f => f.state === 'new')));
  const conflict = buildInstallPlan(world(), notes, research, ['codex']);
  assert.equal(conflict.counts.conflict, 1); assert.equal(conflict.groups[0]!.files[0]!.state, 'conflict'); assert.equal(conflict.manifest.state, 'update');
  assert.equal(buildInstallPlan(world(), archive, 'harness-nope', ['codex']).counts.total, 0);
});

test('install makes the chosen interfaces installed, adds one history entry with the file count, and statuses follow on every screen', () => {
  const s = world();
  assert.equal(projectStatus(s, bowerloom)!.words, 'Codex out of date'); assert.equal(harnessStatus(s, weekly).words, 'Needs an update in 1 of 2 projects');
  const r = install(s, { projectId: bowerloom, harnessId: weekly, interfaceIds: ['claude-code', 'codex'], conflictChoices: { '.codex/agents/writer.toml': 'keep-mine' } }, NOW);
  assert.deepEqual(installOf(r, bowerloom, weekly)!.states, { 'claude-code': 'installed', codex: 'installed', opencode: 'not-installed' });
  assert.equal(projectStatus(r, bowerloom)!.words, 'All installed'); assert.equal(harnessStatus(r, weekly).words, 'Installed in 2 projects');
  const top = r.history[0]!;
  assert.equal(top.text, 'Installed Weekly report crew in bowerloom'); assert.equal(top.filesWritten, 9, '10 listed, 1 kept as the person\'s own'); assert.equal(top.manifest, null); assert.deepEqual(top.stamp, NOW);
  assert.equal(r.history.length, s.history.length + 1);
  const u = undoEntry(r, top.id, NOW);
  assert.deepEqual(installOf(u, bowerloom, weekly)!.states, { 'claude-code': 'installed', codex: 'out-of-date', opencode: 'not-installed' });
  assert.equal(projectStatus(u, bowerloom)!.words, 'Codex out of date');
});

test('install into a project with no harness yet, and an undo that removes it', () => {
  const s = world(), r = install(s, { projectId: archive, harnessId: inbox, interfaceIds: ['claude-code', 'codex'] }, NOW);
  assert.deepEqual(installOf(r, archive, inbox)!.states, { 'claude-code': 'installed', codex: 'installed' });
  assert.equal(projectStatus(r, archive)!.words, 'All installed'); assert.equal(harnessStatus(r, inbox).words, 'Installed in 1 project');
  assert.equal(r.history[0]!.filesWritten, 7, 'the manifest, then an agent file and two skill files for each of two interfaces');
  const u = undoEntry(r, r.history[0]!.id, NOW);
  assert.equal(installOf(u, archive, inbox), undefined); assert.equal(projectStatus(u, archive), null);
});

test('install refuses what cannot be installed: unknown project, unknown harness, no interface, an interface that is not found', () => {
  const s = world();
  assert.equal(install(s, { projectId: 'project-nope', harnessId: weekly, interfaceIds: ['codex'] }, NOW), s);
  assert.equal(install(s, { projectId: archive, harnessId: 'harness-nope', interfaceIds: ['codex'] }, NOW), s);
  assert.equal(install(s, { projectId: archive, harnessId: inbox, interfaceIds: [] }, NOW), s);
  const gone = notFound(s, 'opencode');
  assert.equal(install(gone, { projectId: archive, harnessId: inbox, interfaceIds: ['opencode'] }, NOW), gone);
  const mixed = install(gone, { projectId: archive, harnessId: inbox, interfaceIds: ['opencode', 'codex', 'codex'] }, NOW);
  assert.deepEqual(installOf(mixed, archive, inbox)!.states, { codex: 'installed' });
});

test('a conflict is settled by installing; every choice ends installed, "Keep mine" writes no file for it, and a missing choice means "Keep mine"', () => {
  const written: Record<string, number> = {};
  for (const choice of ['keep-mine', 'use-harness', 'keep-both'] as const) {
    const r = install(world(), { projectId: notes, harnessId: research, interfaceIds: ['codex'], conflictChoices: { '.codex/agents/researcher.toml': choice } }, NOW);
    assert.equal(installOf(r, notes, research)!.states.codex, 'installed', choice); assert.equal(harnessStatus(r, research).words, 'Installed in 1 project', choice);
    written[choice] = r.history[0]!.filesWritten;
  }
  assert.deepEqual(written, { 'keep-mine': 4, 'use-harness': 5, 'keep-both': 5 }, 'the manifest, the other agent, two skills, and the conflicting file unless it is kept as mine');
  const none = install(world(), { projectId: notes, harnessId: research, interfaceIds: ['codex'] }, NOW);
  assert.equal(installOf(none, notes, research)!.states.codex, 'installed'); assert.equal(none.history[0]!.filesWritten, 4);
  const other = install(world(), { projectId: notes, harnessId: research, interfaceIds: ['codex'], conflictChoices: { '.codex/agents/nobody.toml': 'use-harness' } }, NOW);
  assert.equal(other.history[0]!.filesWritten, 4, 'a choice for a file that is not a conflict changes nothing');
});

test('update brings out-of-date interfaces up to date and adds an entry; it does nothing when nothing is out of date', () => {
  const s = world(), r = update(s, { projectId: garden, harnessId: caveman }, NOW);
  assert.equal(installOf(r, garden, caveman)!.states['claude-code'], 'installed'); assert.equal(projectStatus(r, garden)!.words, 'All installed'); assert.equal(harnessStatus(r, caveman).words, 'Installed in 1 project');
  assert.equal(r.history[0]!.text, 'Updated Caveman pack in garden'); assert.ok(r.history[0]!.filesWritten > 0);
  assert.equal(weeklyOf(r).id, weekly);
  assert.equal(update(r, { projectId: garden, harnessId: caveman }, NOW), r);
  assert.equal(update(s, { projectId: archive, harnessId: inbox }, NOW), s);
  const part = update(s, { projectId: bowerloom, harnessId: weekly, interfaceIds: ['claude-code'] }, NOW);
  assert.equal(part, s, 'Claude Code is not out of date there, so asking for it changes nothing');
  const codex = update(s, { projectId: bowerloom, harnessId: weekly, interfaceIds: ['codex'] }, NOW);
  assert.equal(projectStatus(codex, bowerloom)!.words, 'All installed');
  assert.equal(installOf(undoEntry(r, r.history[0]!.id, NOW), garden, caveman)!.states['claude-code'], 'out-of-date');
});

test('startRuns: one run for each interface, a shared group for two or more, newest first, "running", and nothing for an empty instruction', () => {
  const s = world();
  const r = startRuns(s, { harnessId: weekly, projectId: bowerloom, interfaceIds: ['claude-code', 'codex'], instruction: '  Write the report.  ' }, NOW);
  assert.equal(r.runIds.length, 2); assert.deepEqual(r.state.runs.slice(0, 2).map(x => x.id), r.runIds);
  const [a, b] = r.state.runs;
  assert.deepEqual([a!.interfaceId, b!.interfaceId], ['claude-code', 'codex']); assert.equal(a!.groupId, b!.groupId); assert.notEqual(a!.groupId, null);
  assert.ok(r.state.runs.slice(0, 2).every(x => x.status === 'running' && x.rating === null && x.notes === '' && x.instruction === 'Write the report.' && x.started === NOW));
  assert.equal(r.state.runs.length, s.runs.length + 2);
  const one = startRuns(s, { harnessId: weekly, projectId: bowerloom, interfaceIds: ['claude-code'], instruction: 'Go.' }, NOW);
  assert.equal(one.state.runs[0]!.groupId, null);
  for (const bad of [{ instruction: '   ' }, { interfaceIds: [] as const }, { interfaceIds: ['opencode'] as const }, { harnessId: 'harness-nope' }, { projectId: 'project-nope' }]) {
    const out = startRuns(s, { harnessId: weekly, projectId: bowerloom, interfaceIds: ['codex'], instruction: 'Go.', ...bad }, NOW);
    assert.equal(out.state, s); assert.deepEqual(out.runIds, []);
  }
  const two = startRuns(r.state, { harnessId: weekly, projectId: bowerloom, interfaceIds: ['claude-code', 'codex'], instruction: 'Again.' }, NOW);
  assert.notEqual(two.state.runs[0]!.groupId, a!.groupId, 'each start has its own group');
});

test('finishRun finishes a running run only, and rateRun is locked until the run is done', () => {
  const s = world();
  assert.equal(s.runs[0]!.status, 'running');
  assert.equal(rateRun(s, 'run-1', 'better', 'Good.'), s, 'locked while running');
  const done = finishRun(s, 'run-1');
  assert.equal(done.runs[0]!.status, 'done'); assert.equal(finishRun(done, 'run-1'), done); assert.equal(finishRun(s, 'run-2'), s, 'a done run is left alone'); assert.equal(finishRun(s, 'run-nope'), s);
  const rated = rateRun(done, 'run-1', 'better', 'Good.');
  assert.deepEqual([rated.runs[0]!.rating, rated.runs[0]!.notes], ['better', 'Good.']);
  const cleared = rateRun(rated, 'run-1', null, '');
  assert.equal(cleared.runs[0]!.rating, null);
  assert.equal(rateRun(s, 'run-3', 'same', 'Fine.').runs[2]!.rating, 'same', 'a closed run can be rated');
  assert.equal(rateRun(s, 'run-nope', 'same', ''), s);
});

test('setInterfaceOn switches an interface, records it, undoes it, and never switches on one that is not found', () => {
  const s = world();
  const off = setInterfaceOn(s, 'codex', false, NOW);
  assert.equal(off.interfaces.find(i => i.id === 'codex')!.on, false); assert.equal(off.history[0]!.text, 'Turned off Codex');
  assert.equal(setInterfaceOn(off, 'codex', false, NOW), off);
  const gone = notFound(s, 'opencode');
  assert.equal(setInterfaceOn(gone, 'opencode', true, NOW), gone, 'an interface that is not found cannot be switched on');
  const opencode = setInterfaceOn(s, 'opencode', true, NOW);
  assert.equal(opencode.interfaces.find(i => i.id === 'opencode')!.on, true);
  assert.equal(undoEntry(off, off.history[0]!.id, NOW).interfaces.find(i => i.id === 'codex')!.on, true);
});

test('history is newest first, ids are unique, an entry is undone once, and the undo is an entry of its own that cannot be undone', () => {
  let s = world();
  const seed = s.history.map(e => e.id);
  s = addPart(s, caveman, 'tool-web-search', NOW); s = addLink(s, caveman, 'agent-plain-editor', 'tool-web-search', NOW);
  assert.deepEqual(s.history.slice(0, 2).map(e => e.text), ['Linked Plain editor to Web search in Caveman pack', 'Added Web search to Caveman pack']);
  assert.equal(new Set(s.history.map(e => e.id)).size, s.history.length); assert.deepEqual(s.history.slice(2).map(e => e.id), seed);
  const link = s.history[0]!;
  const u = undoEntry(s, link.id, NOW);
  assert.equal(u.history[0]!.text, 'Undid: Linked Plain editor to Web search in Caveman pack'); assert.equal(u.history[0]!.undo, null);
  assert.equal(u.history.find(e => e.id === link.id)!.undone, true);
  assert.equal(undoEntry(u, link.id, NOW), u, 'once'); assert.equal(undoEntry(u, u.history[0]!.id, NOW), u, 'an undo cannot be undone'); assert.equal(undoEntry(u, 'history-nope', NOW), u);
});

test('the seeded history can be undone, newest first: the install, the added part, the link and the harness', () => {
  let s = world();
  assert.deepEqual(s.history.map(e => e.text), ['Installed Weekly report crew in bowerloom', 'Added Spreadsheet to Weekly report crew', 'Linked Writer to Translate in Weekly report crew', 'Made Weekly report crew from a scan']);
  assert.equal(undoEntry(s, 'history-2', NOW), s, 'the part change is newer');
  assert.equal(undoEntry(s, 'history-1', NOW), s, 'the harness has newer changes');
  s = undoEntry(s, 'history-4', NOW); s = undoEntry(s, 'history-3', NOW);
  const link = undoEntry(s, 'history-2', NOW);
  assert.equal(weeklyOf(link).links.some(l => l.to === 'missing-translate'), false);
  const made = undoEntry(link, 'history-1', NOW);
  assert.equal(harnessById(made, weekly), undefined); assert.equal(made.installs.some(i => i.harnessId === weekly), false);
});

test('undo: the newest change of an install pair goes first; an older one is blocked until the newer one is undone, and a snapshot never overwrites a newer change', () => {
  const a = install(world(), { projectId: archive, harnessId: inbox, interfaceIds: ['claude-code'] }, NOW);
  const b = install(a, { projectId: archive, harnessId: inbox, interfaceIds: ['codex'] }, NOW);
  const [entryB, entryA] = [b.history[0]!, b.history[1]!];
  assert.equal(entryA.text, 'Installed Inbox helper in archive');
  assert.equal(undoBlocker(b, entryA.id)?.id, entryB.id); assert.equal(undoBlocker(b, entryB.id), null);
  assert.equal(undoEntry(b, entryA.id, NOW), b, 'A is blocked');
  assert.deepEqual(tryUndo(b, entryA.id, NOW), { state: b, reason: UNDO_NEWER_FIRST });
  assert.equal(b.history.some(e => e.text.startsWith('Undid')), false);
  const noB = undoEntry(b, entryB.id, NOW);
  assert.deepEqual(installOf(noB, archive, inbox)!.states, { 'claude-code': 'installed' }, 'B put back what A left');
  assert.equal(undoBlocker(noB, entryA.id), null, 'an undone change no longer blocks');
  const noA = undoEntry(noB, entryA.id, NOW);
  assert.equal(installOf(noA, archive, inbox), undefined);
  // Another pair, another harness and a setting do not block it.
  const other = install(a, { projectId: garden, harnessId: caveman, interfaceIds: ['codex'] }, NOW);
  assert.equal(undoBlocker(other, entryA.id), null);
  const linked = addLink(a, weekly, 'agent-researcher', 'skill-format-report', NOW);
  assert.equal(undoBlocker(linked, entryA.id), null);
  const off = setInterfaceOn(a, 'codex', false, NOW);
  assert.equal(undoBlocker(off, entryA.id), null);
  // The same harness blocks: a link edit waits for the newer part edit; making a harness waits for every newer change to it and to its installs.
  const part = addPart(addPart(world(), caveman, 'tool-web-search', NOW), caveman, 'skill-translate', NOW);
  assert.equal(undoBlocker(part, part.history[1]!.id)?.id, part.history[0]!.id);
  const made = createHarness(world(), NOW), madeId = made.harnessId;
  const installed = install(made.state, { projectId: archive, harnessId: madeId, interfaceIds: ['claude-code'] }, NOW);
  assert.equal(installed, made.state, 'an empty harness cannot be installed');
  const filled = addPart(made.state, madeId, 'skill-translate', NOW);
  const installedFilled = install(filled, { projectId: archive, harnessId: madeId, interfaceIds: ['claude-code'] }, NOW);
  assert.equal(undoBlocker(installedFilled, made.state.history[0]!.id)?.id, installedFilled.history[0]!.id, 'the install of the new harness blocks undoing that it was made');
  // A change that is itself an undo is never blocked and never blocks.
  assert.equal(undoBlocker(noB, noB.history[0]!.id), null);
});

test('undo: a step that cannot apply leaves the entry not undone, logs nothing and says why', () => {
  const s = addPart(world(), caveman, 'tool-web-search', NOW);
  const gone = { ...s, harnesses: s.harnesses.filter(h => h.id !== caveman) };
  const r = tryUndo(gone, s.history[0]!.id, NOW);
  assert.equal(r.state, gone); assert.equal(r.reason, 'that harness is not here any more');
  assert.equal(gone.history.some(e => e.undone), false); assert.equal(undoEntry(gone, s.history[0]!.id, NOW), gone);
  assert.equal(r.state.history.some(e => e.text.startsWith('Undid')), false);
  const fixed = fixMissingPart(world(), weekly, 'missing-translate', NOW);
  const brokenFix = { ...fixed, harnesses: fixed.harnesses.filter(h => h.id !== weekly) };
  assert.equal(tryUndo(brokenFix, fixed.history[0]!.id, NOW).state, brokenFix, 'a change of several steps applies all of them or none');
  const ok = tryUndo(s, s.history[0]!.id, NOW);
  assert.equal(ok.reason, null); assert.equal(ok.state.history[0]!.text, 'Undid: Added Web search to Caveman pack'); assert.equal(ok.state.history.find(e => e.id === s.history[0]!.id)!.undone, true);
  assert.equal(tryUndo(ok.state, s.history[0]!.id, NOW).reason, 'it was undone already'); assert.equal(tryUndo(s, 'history-nope', NOW).reason, 'that change is not in the list');
  assert.equal(tryUndo(ok.state, ok.state.history[0]!.id, NOW).reason, 'it cannot be undone');
  const store = createHarnessStore({ initial: world(), now: () => NOW });
  store.addPart(caveman, 'tool-web-search'); store.addPart(caveman, 'skill-translate');
  const first = store.getState().history[1]!.id;
  assert.equal(store.undo(first), UNDO_NEWER_FIRST); assert.equal(store.undo(store.getState().history[0]!.id), null); assert.equal(store.undo(first), null);
});

test('install and startRuns say why they changed nothing: unknown or empty harness, unknown project, no interface, an interface that is off or not found', () => {
  const s = world(), empty = createHarness(s, NOW);
  const bad = [
    [{ projectId: archive, harnessId: 'harness-nope', interfaceIds: ['codex'] }, 'that harness is not here'], [{ projectId: 'project-nope', harnessId: inbox, interfaceIds: ['codex'] }, 'that project is not here'],
    [{ projectId: archive, harnessId: empty.harnessId, interfaceIds: ['codex'] }, 'that harness is empty'], [{ projectId: archive, harnessId: inbox, interfaceIds: [] }, 'no interface is picked'],
    [{ projectId: archive, harnessId: inbox, interfaceIds: ['opencode'] }, 'no interface that is switched on and found is picked'],
  ] as const;
  for (const [request, why] of bad) {
    assert.equal(installProblem(empty.state, request), why, why); assert.equal(install(empty.state, request, NOW), empty.state, why);
    assert.equal(createHarnessStore({ initial: empty.state }).install(request), why);
    const run = { ...request, instruction: 'Go.' };
    assert.equal(startProblem(empty.state, run), why, why); assert.equal(startRuns(empty.state, run, NOW).state, empty.state);
  }
  assert.equal(startProblem(s, { harnessId: inbox, projectId: archive, interfaceIds: ['codex'], instruction: '  ' }), 'the instruction is empty');
  const off = setInterfaceOn(s, 'codex', false, NOW);
  assert.equal(installProblem(off, { projectId: archive, harnessId: inbox, interfaceIds: ['codex'] }), 'no interface that is switched on and found is picked');
  assert.equal(install(off, { projectId: archive, harnessId: inbox, interfaceIds: ['codex'] }, NOW), off);
  assert.deepEqual(installOf(install(off, { projectId: archive, harnessId: inbox, interfaceIds: ['claude-code', 'codex'] }, NOW), archive, inbox)!.states, { 'claude-code': 'installed' }, 'an interface that is off is left out');
  assert.equal(installProblem(s, { projectId: archive, harnessId: inbox, interfaceIds: ['codex'] }), null); assert.equal(startProblem(s, { harnessId: inbox, projectId: archive, interfaceIds: ['codex'], instruction: 'Go.' }), null);
});

test('addLink says why it changed nothing: duplicate, agent target, source not an agent, part not in the harness', () => {
  const s = world(), a = addLink(s, weekly, 'agent-researcher', 'skill-format-report', NOW);
  assert.equal(addLinkProblem(s, weekly, 'agent-researcher', 'skill-format-report'), null);
  assert.equal(addLinkProblem(a, weekly, 'agent-researcher', 'skill-format-report'), 'that link is there already');
  assert.equal(addLinkProblem(s, weekly, 'agent-researcher', 'agent-writer'), 'an agent cannot link to an agent');
  assert.equal(addLinkProblem(s, weekly, 'skill-check-facts', 'tool-web-search'), 'only an agent can link to a part');
  assert.equal(addLinkProblem(s, weekly, 'agent-researcher', 'skill-answer-a-common-question'), 'that part is not in this harness');
  assert.equal(addLinkProblem(s, weekly, 'agent-researcher', 'agent-researcher'), 'a part cannot link to itself');
  assert.equal(addLinkProblem(s, 'harness-nope', 'agent-researcher', 'skill-format-report'), 'that harness is not here');
  assert.equal(addLinkProblem(s, weekly, 'agent-inbox-sorter', 'skill-format-report'), 'that agent is not in this harness');
  assert.equal(addLink(a, weekly, 'agent-researcher', 'skill-format-report', NOW), a);
  const store = createHarnessStore({ initial: s, now: () => NOW });
  assert.equal(store.addLink(weekly, 'agent-researcher', 'skill-format-report'), null); assert.equal(store.addLink(weekly, 'agent-researcher', 'skill-format-report'), 'that link is there already');
});

test('the store object: it hands the reducers a stamp, tells subscribers, and ignores a change that changes nothing', () => {
  let time = 0;
  const store = createHarnessStore({ initial: world(), now: () => ({ daysAgo: 0, time: `11:0${time += 1}` }) });
  let calls = 0;
  const off = store.subscribe(() => { calls += 1; });
  store.addPart(caveman, 'tool-web-search'); assert.equal(calls, 1);
  assert.equal(store.getState().history[0]!.stamp.time, '11:01');
  store.addPart(caveman, 'tool-web-search'); assert.equal(calls, 1, 'no change, no call');
  const id = store.createHarness(); assert.ok(harnessById(store.getState(), id));
  store.chooseSources(['src-codex']); store.setNodePosition(id, 'x', { x: 1, y: 1 });
  const made = store.createHarnessFromSource('src-hermes'); assert.ok(made !== null && harnessById(store.getState(), made));
  store.removePart(caveman, 'tool-web-search'); store.addLink(weekly, 'agent-researcher', 'skill-format-report'); store.removeLink(weekly, 'agent-researcher', 'skill-format-report');
  store.install({ projectId: archive, harnessId: inbox, interfaceIds: ['codex'] }); store.update({ projectId: garden, harnessId: caveman }); store.setInterfaceOn('opencode', true);
  store.fixMissingPart(weekly, 'missing-translate'); store.undo(store.getState().history[0]!.id);
  off(); const before = calls; store.addPart(caveman, 'tool-web-search'); assert.equal(calls, before, 'unsubscribed');
});

test('a run finishes by itself after about 15 seconds, and a timer that has not fired can be cancelled', () => {
  assert.equal(RUN_FINISH_MS, 15_000);
  const queue: { run: () => void; ms: number; live: boolean }[] = [];
  const schedule: Schedule = (run, ms) => { const item = { run, ms, live: true }; queue.push(item); return () => { item.live = false; }; };
  const store = createHarnessStore({ initial: world(), now: () => NOW, schedule });
  const ids = store.startRuns({ harnessId: weekly, projectId: bowerloom, interfaceIds: ['claude-code', 'codex'], instruction: 'Go.' });
  assert.equal(ids.length, 2); assert.deepEqual(queue.map(q => q.ms), [15_000, 15_000]);
  assert.ok(store.getState().runs.slice(0, 2).every(r => r.status === 'running'));
  queue[0]!.run();
  assert.deepEqual(store.getState().runs.slice(0, 2).map(r => r.status), ['done', 'running']);
  store.dispose(); assert.equal(queue[1]!.live, false);
  assert.deepEqual(store.startRuns({ harnessId: weekly, projectId: bowerloom, interfaceIds: ['claude-code'], instruction: '' }), [], 'nothing is scheduled for an empty instruction');
  assert.equal(queue.length, 2);
});

test('runs that are running at the start finish by themselves when the store is asked to', () => {
  const queue: (() => void)[] = [];
  const store = createHarnessStore({ initial: world(), schedule: run => { queue.push(run); return () => undefined; }, finishRunning: true, finishAfterMs: 5 });
  assert.equal(queue.length, 1);
  queue[0]!();
  assert.equal(store.getState().runs.find(r => r.id === 'run-1')!.status, 'done');
  const quiet = createHarnessStore({ initial: world(), schedule: () => { throw new Error('no timer wanted'); } });
  assert.equal(quiet.getState().runs[0]!.status, 'running');
  assert.equal(FIXED_NOW.time, '10:50');
});
