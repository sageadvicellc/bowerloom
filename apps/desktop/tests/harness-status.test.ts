// The status logic of the harness-first preview: every status is computed from the install data, the worst state wins, and every screen reads the same answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_IDS, createSampleWorld } from '../shared/harness/sample.js';
import { install, startRuns, update } from '../shared/harness/store.js';
import {
  blockedFor, chipWords, compareNotice, countsWords, harnessById, harnessCountsWords, harnessStatus, harnessesHolding, installInterfaceLine, installLine, installOf, installStates, interfaceById,
  interfaceInstallState, interfaceStatus, kindCounts, libraryCounts, offeredInterfaces, partById, partsWords, projectStatus, runsIn, startButtonWords, startInterfaceLine, startNeeds,
  stateWords, usedByAgents, usedInOtherWords, usedInWords, usesOf, worksIn, worstState, installState, partsOf,
} from '../shared/harness/status.js';
import { dayGroupOf, entryMeta, groupByDay, minutesOpen, startedWords, stampAtWords, stampWords } from '../shared/harness/time.js';
import { excerptOf, fieldValue, parseFrontMatter } from '../shared/harness/frontmatter.js';
import type { HarnessState, InterfaceId, Stamp } from '../shared/harness/types.js';

const { weekly, caveman, inbox, research, bowerloom, siteRedesign, notes, garden, archive } = SAMPLE_IDS;
const NOW: Stamp = { daysAgo: 0, time: '11:00' };
const w = createSampleWorld();
// Hermes is no engine of 0.8, so the sample world has no interface that is not found. This makes one, to keep the not-found words under test.
const notFound = (s: HarnessState, id: InterfaceId): HarnessState => ({ ...s, interfaces: s.interfaces.map(i => (i.id === id ? { ...i, health: 'not-found' as const, healthWords: 'Not found', on: false } : i)) });

test('the sample world has the numbers of the design: 4 harnesses, 5 projects, 3 interfaces, a Library of 12, 41, 2 and 3', () => {
  assert.equal(w.harnesses.length, 4); assert.equal(w.projects.length, 5); assert.equal(w.interfaces.length, 3);
  assert.deepEqual(libraryCounts(w), { agent: 12, skill: 41, tool: 2, context: 3 });
  assert.deepEqual(w.harnesses.map(h => h.name), ['Weekly report crew', 'Caveman pack', 'Inbox helper', 'Research desk']);
  assert.deepEqual(w.projects.map(p => p.name), ['bowerloom', 'site-redesign', 'notes', 'garden', 'archive']);
  assert.deepEqual(w.interfaces.map(i => i.name), ['Claude Code', 'Codex', 'OpenCode']);
  assert.equal(new Set(w.parts.map(p => p.id)).size, w.parts.length, 'every part id is its own');
});

test('Weekly report crew holds 3 agents, 5 skills (Translate is missing), 2 tools, 2 context and 11 parts; the others read as in the design', () => {
  const h = harnessById(w, weekly)!;
  assert.deepEqual(kindCounts(w, h), { agent: 3, skill: 5, tool: 2, context: 2 });
  assert.equal(harnessCountsWords(w, h), '3 agents · 5 skills · 2 tools · 2 context'); assert.equal(partsWords(h), '11 parts');
  assert.deepEqual(h.missing.map(m => m.name), ['Translate']);
  assert.equal(partsOf(w, h).length, 11);
  assert.equal(harnessCountsWords(w, harnessById(w, caveman)!), '4 agents · 14 skills');
  assert.equal(harnessCountsWords(w, harnessById(w, inbox)!), '1 agent · 3 skills · 1 tool');
  assert.equal(harnessCountsWords(w, harnessById(w, research)!), '2 agents · 6 skills · 3 tools · 4 context');
  assert.equal(countsWords({ agent: 0, skill: 1, tool: 0, context: 1 }), '1 skill · 1 context');
});

test('every part that a harness holds, links or the Library lists exists', () => {
  for (const h of w.harnesses) {
    for (const id of h.partIds) assert.ok(partById(w, id), `${h.name}: ${id}`);
    const known = new Set([...h.partIds, ...h.missing.map(m => m.id)]);
    for (const l of h.links) { assert.ok(h.partIds.includes(l.from), `${h.name}: ${l.from}`); assert.ok(known.has(l.to), `${h.name}: ${l.to}`); }
  }
  assert.ok(w.sources.every(s => s.partIds.every(id => partById(w, id))));
  assert.deepEqual(w.sources.map(s => s.partIds.length), [18, 30, 7]);
});

test('worst state wins: conflict, then out of date, then installed, then not installed', () => {
  assert.equal(worstState([]), null);
  assert.equal(worstState(['installed', 'out-of-date', 'conflict']), 'conflict'); assert.equal(worstState(['installed', 'out-of-date']), 'out-of-date');
  assert.equal(worstState(['not-installed', 'installed']), 'installed', 'an interface that was never installed does not count against one that is');
  assert.equal(worstState(['not-installed']), 'not-installed');
});

test('harness rows: each status is computed from the installs', () => {
  const rows = (id: string) => { const s = harnessStatus(w, id); return [s.words, s.tone, s.state]; };
  assert.deepEqual(rows(weekly), ['Needs an update in 1 of 2 projects', 'warn', 'out-of-date']);
  assert.deepEqual(rows(caveman), ['Out of date in 1 project', 'warn', 'out-of-date']);
  assert.deepEqual(rows(inbox), ['Not installed', 'quiet', 'not-installed']);
  assert.deepEqual(rows(research), ['Conflict in 1 project', 'bad', 'conflict']);
});

test('project rows: the worst state of the project, with the names of the interfaces that have it', () => {
  assert.equal(projectStatus(w, bowerloom)!.words, 'Codex out of date'); assert.equal(projectStatus(w, siteRedesign)!.words, 'All installed');
  assert.equal(projectStatus(w, notes)!.words, 'Codex has a conflict'); assert.equal(projectStatus(w, garden)!.words, 'Claude Code out of date');
  assert.equal(projectStatus(w, archive), null);
  assert.deepEqual(['bowerloom', 'site-redesign', 'notes', 'garden'].map((_, i) => projectStatus(w, w.projects[i]!.id)!.tone), ['warn', 'good', 'bad', 'warn']);
});

test('the chips of a project row and the lines of the details column come from the same install', () => {
  const b = installOf(w, bowerloom, weekly)!;
  assert.deepEqual(installStates(w, b).map(r => chipWords(r.name, r.state)), ['Claude Code installed', 'Codex out of date', 'OpenCode not installed']);
  assert.equal(installLine(w, b).words, 'Codex out of date'); assert.equal(installLine(w, installOf(w, siteRedesign, weekly)!).words, 'All installed');
  assert.equal(installLine(w, installOf(w, notes, research)!).words, 'Codex has a conflict');
  assert.deepEqual(installStates(w, installOf(w, siteRedesign, weekly)!).map(r => chipWords(r.name, r.state)), ['Claude Code installed', 'Codex installed'], 'an interface with no record has no chip');
  assert.deepEqual([stateWords('installed'), stateWords('out-of-date'), stateWords('conflict'), stateWords('not-installed')], ['Installed', 'Out of date', 'Has a conflict', 'Not installed']);
  assert.equal(installState({ projectId: 'x', harnessId: 'y', states: {} }), 'not-installed');
});

test('two interfaces with one state share one line: "Claude Code and Codex out of date"', () => {
  const s = { ...w, installs: [{ projectId: bowerloom, harnessId: weekly, states: { 'claude-code': 'out-of-date', codex: 'out-of-date', opencode: 'conflict' } as const }] };
  assert.equal(installLine(s, s.installs[0]!).words, 'OpenCode has a conflict');
  const t = { ...w, installs: [{ projectId: bowerloom, harnessId: weekly, states: { 'claude-code': 'out-of-date', codex: 'out-of-date' } as const }] };
  assert.equal(installLine(t, t.installs[0]!).words, 'Claude Code and Codex out of date'); assert.equal(projectStatus(t, bowerloom)!.words, 'Claude Code and Codex out of date');
  assert.equal(harnessStatus(t, weekly).words, 'Out of date in 1 project');
});

test('a row that is in two projects says "of"; one that is in more than one says how many are installed', () => {
  let s = install(w, { projectId: siteRedesign, harnessId: research, interfaceIds: ['claude-code'] }, NOW);
  assert.equal(harnessStatus(s, research).words, 'Conflict in 1 of 2 projects');
  s = install(w, { projectId: archive, harnessId: weekly, interfaceIds: ['claude-code'] }, NOW);
  assert.equal(harnessStatus(s, weekly).words, 'Needs an update in 1 of 3 projects');
  s = update(s, { projectId: bowerloom, harnessId: weekly }, NOW);
  assert.equal(harnessStatus(s, weekly).words, 'Installed in 3 projects');
});

test('statuses agree after a change: the harness row, the project row, the details and the interface all move together', () => {
  const r = install(w, { projectId: notes, harnessId: research, interfaceIds: ['codex'] }, NOW);
  assert.equal(harnessStatus(r, research).words, 'Installed in 1 project'); assert.equal(projectStatus(r, notes)!.words, 'All installed'); assert.equal(installLine(r, installOf(r, notes, research)!).words, 'All installed');
  assert.equal(interfaceInstallState(w, 'codex'), 'conflict'); assert.equal(interfaceInstallState(r, 'codex'), 'out-of-date');
});

test('interface status: its health, and the worst install state across every project', () => {
  assert.deepEqual(interfaceStatus(w, 'claude-code'), { health: 'ready', words: 'Ready', tone: 'good', install: 'out-of-date' });
  assert.deepEqual(interfaceStatus(w, 'opencode'), { health: 'problem', words: 'Config file has a problem', tone: 'warn', install: 'not-installed' });
  assert.deepEqual(interfaceStatus(notFound(w, 'opencode'), 'opencode'), { health: 'not-found', words: 'Not found', tone: 'quiet', install: 'not-installed' });
});

test('interfaces: what is offered, where a harness runs, and where a part works', () => {
  assert.deepEqual(offeredInterfaces(w).map(i => i.id), ['claude-code', 'codex']);
  assert.deepEqual(runsIn(w).map(i => i.name), ['Claude Code', 'Codex']);
  assert.deepEqual(worksIn(w, partById(w, 'agent-researcher')!).map(i => i.name), ['Claude Code', 'Codex']);
  assert.deepEqual(worksIn(w, partById(w, 'tool-spreadsheet')!).map(i => i.name), ['Claude Code']);
  assert.deepEqual(blockedFor(w, harnessById(w, weekly)!, 'codex').map(p => p.name), ['Spreadsheet']); assert.deepEqual(blockedFor(w, harnessById(w, weekly)!, 'claude-code'), []);
});

test('the install sheet says what each interface does with the harness, in the design\'s own words', () => {
  const h = harnessById(w, weekly)!, line = (id: InterfaceId, s: HarnessState = w) => installInterfaceLine(s, h, interfaceById(s, id)!);
  assert.equal(line('claude-code'), 'Found. Uses all 11 parts.'); assert.equal(line('codex'), 'Found. Cannot use 1 tool: Spreadsheet.');
  assert.equal(line('opencode'), 'Found. Its config file has a problem, so it is off.'); assert.equal(line('opencode', notFound(w, 'opencode')), 'Not found on this computer.');
});

test('the start sheet: each interface says how it stands in the project, and out-of-date or missing installs are named', () => {
  const line = (id: InterfaceId, s: HarnessState = w) => startInterfaceLine(s, bowerloom, weekly, interfaceById(s, id)!).words;
  assert.equal(line('claude-code'), 'Installed in this project.'); assert.equal(line('codex'), 'Out of date. You review the update before it runs.');
  assert.equal(line('opencode'), 'Not installed. Install, then start.'); assert.equal(line('opencode', notFound(w, 'opencode')), 'Not found on this computer.');
  assert.equal(startInterfaceLine(w, notes, research, interfaceById(w, 'codex')!).state, 'conflict');
  assert.deepEqual(startNeeds(w, bowerloom, weekly, ['claude-code', 'codex']), ['codex']); assert.deepEqual(startNeeds(w, bowerloom, weekly, ['claude-code']), []);
  assert.deepEqual(startNeeds(w, archive, inbox, ['claude-code']), ['claude-code']);
  assert.equal(compareNotice(1), null); assert.equal(compareNotice(2), 'Compare is on. Bowerloom opens 2 runs with the same instruction in one folder, so run them one at a time if they write files.');
  assert.deepEqual([startButtonWords(1), startButtonWords(2)], ['Review and start 1 run', 'Review and start 2 runs']);
  assert.equal(startRuns(w, { harnessId: weekly, projectId: bowerloom, interfaceIds: ['claude-code', 'codex'], instruction: 'x' }, NOW).runIds.length, 2);
});

test('Library words: where a part is used, as in the design', () => {
  const used = (id: string) => usedInWords(harnessesHolding(w, id).length);
  assert.equal(used('skill-check-facts'), 'Used in 2 harnesses'); assert.equal(used('skill-draft-outline'), 'Used in 2 harnesses'); assert.equal(used('skill-answer-a-common-question'), 'Used in 1 harness');
  assert.equal(used('skill-clean-up-a-list'), 'Not used yet'); assert.equal(used('skill-summarize-sources'), 'Used in 1 harness'); assert.equal(used('skill-format-report'), 'Used in 1 harness');
  assert.deepEqual(harnessesHolding(w, 'skill-check-facts').map(h => h.name), ['Weekly report crew', 'Research desk']);
  assert.equal(usedInOtherWords(harnessesHolding(w, 'agent-researcher').length - 1), 'Used in 1 other harness');
});

test('the Researcher: what it uses, who uses a part, and its file', () => {
  const h = harnessById(w, weekly)!;
  assert.deepEqual(usesOf(w, h, 'agent-researcher').map(p => [p.name, p.kind]), [['Summarize sources', 'skill'], ['Web search', 'tool'], ['Check facts', 'skill'], ['Client list', 'context']]);
  assert.deepEqual(usesOf(w, h, 'agent-writer').map(p => p.name), ['Draft outline', 'Format report', 'Style guide'], 'a link to a missing part is left out');
  assert.deepEqual(usedByAgents(w, h, 'skill-draft-outline').map(p => p.name), ['Planner', 'Writer']);
  const researcher = partById(w, 'agent-researcher')!;
  assert.equal(researcher.path, 'agents/researcher.md'); assert.equal(excerptOf(researcher.fileText), '---\nname: researcher\ndescription: Finds sources and summarizes articles.\nmodel: sonnet\n---');
  const fm = parseFrontMatter(researcher.fileText);
  assert.deepEqual(fm.fields.map(f => f.key), ['name', 'description', 'model', 'tools', 'skills']); assert.equal(fieldValue('skills', fm.fields[4]!.value), 'Summarize sources, Check facts');
  assert.equal(fm.body, 'You find sources for a topic.\nRead each source. Write a short\nsummary. Say which claims have no\nsource.');
  assert.equal(parseFrontMatter('plain text').found, false); assert.equal(parseFrontMatter('---\nname: x\n').found, false);
  assert.equal(excerptOf('a\nb\nc\nd\ne\nf'), 'a\nb\nc\nd\ne');
});

test('times: the words of a stamp, a run and a history entry', () => {
  assert.equal(stampWords({ daysAgo: 0, time: '10:40' }), 'Today 10:40'); assert.equal(stampWords({ daysAgo: 1, time: '16:30' }), 'Yesterday 16:30'); assert.equal(stampWords({ daysAgo: 3, time: '09:00' }), '3 days ago 09:00');
  assert.equal(stampAtWords({ daysAgo: 0, time: '10:42' }), 'Today at 10:42'); assert.equal(startedWords({ daysAgo: 0, time: '10:42' }), 'started 10:42'); assert.equal(startedWords({ daysAgo: 1, time: '16:05' }), 'started yesterday 16:05');
  assert.deepEqual(w.history.map(e => entryMeta(e)), [
    'Today 10:40 · Robin · this Mac · 10 files written', 'Today 10:12 · Robin · this Mac · manifest changed',
    'Yesterday 16:30 · Robin · this Mac · manifest changed', 'Yesterday 16:02 · Robin · this Mac · manifest created',
  ]);
  assert.deepEqual(groupByDay(w.history).map(g => [g.day, g.entries.length]), [['Today', 2], ['Yesterday', 2]]); assert.equal(dayGroupOf({ daysAgo: 5, time: '08:00' }), 'Earlier');
  assert.equal(minutesOpen(w.runs[0]!, { daysAgo: 0, time: '10:54' }), 12); assert.equal(minutesOpen(w.runs[2]!, NOW), 1135, 'yesterday 16:05 to today 11:00');
});

test('the sample runs are as in the design: three runs, two of one instruction in one group', () => {
  assert.deepEqual(w.runs.map(r => [r.interfaceId, r.status, r.groupId]), [['claude-code', 'running', 'group-1'], ['codex', 'done', 'group-1'], ['claude-code', 'closed', null]]);
  assert.equal(w.runs[0]!.instruction, 'Write a weekly report from the notes in Meetings. Check that every claim has a source.');
  assert.equal(w.runs[1]!.rating, 'worse'); assert.equal(w.runs[1]!.notes, 'Skipped the fact check on section 2.');
});

test('no status is stored in the sample: it holds install states and nothing that says "worst"', () => {
  const text = JSON.stringify(w);
  assert.doesNotMatch(text, /Needs an update|All installed|Out of date in|Conflict in/);
  assert.deepEqual(Object.keys(w).sort(), ['chosenSourceIds', 'harnesses', 'history', 'installs', 'interfaces', 'nextId', 'parts', 'projects', 'runs', 'sources']);
});
