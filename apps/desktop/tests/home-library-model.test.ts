// The Library's model: every thing of a kind as a row (including what no agent uses), the search and the two orders, the status of a row, and the read-only
// details with where each thing came from.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceStore } from '../shared/proto/store.js';
import type { StoreState } from '../shared/proto/store.js';
import type { World } from '../shared/proto/types.js';
import { ownedAgents } from '../shared/home/cards.js';
import {
  LIBRARY_KINDS, copyDraft, daysBackOf, hasLine, libraryCounts, libraryDetails, libraryRows, listLibrary, matchesSearch, mineName, removePlan, sortRows, takesOffLine, updateOf, usedByLine, agentsFor, entryOf,
} from '../shared/home/library-model.js';
import { dayText } from '../shared/home/library-sample.js';
import { UPDATE_ITEM_ID } from '../shared/home/library-sample.js';
import { SAMPLE_SOURCES, infoOf, newItemOf } from '../shared/home/library-sources.js';
import { LIMITS, bannedIn, countWords } from '../shared/home/textbudget.js';
import { libraryWorld } from './home-library-world.js';

const world = (): World => libraryWorld();
const start = (): StoreState => { const w = world(); return { committed: w, draft: w, undoStack: [], redoStack: [], headVersionId: null }; };
const row = (w: World, kind: Parameters<typeof libraryRows>[1], id: string) => libraryRows(w, kind).find(r => r.id === id)!;

test('the library lists everything of a kind, including what no agent uses', () => {
  const w = world();
  assert.deepEqual(libraryCounts(w), { skill: 53, agent: 16, tool: 14, note: 3 });
  assert.deepEqual(LIBRARY_KINDS, ['skill', 'agent', 'tool', 'note']);
  const unused = libraryRows(w, 'skill').filter(r => r.usedBy === 0);
  assert.ok(unused.length >= 20, `${unused.length} skills nobody uses`);
  assert.deepEqual(unused.find(r => r.id === 'skill-003')?.status, { label: 'Not used yet', tone: 'info' });
  // skills of a folder that no agent can reach are the person's too
  assert.ok(libraryRows(w, 'skill').some(r => r.id === 'skill-proj-1'));
  assert.equal(libraryRows(w, 'tool').length, 14);
  assert.equal(libraryRows(w, 'note').length, 3);
});

test('"Used by" counts the agents of the person that hold the thing', () => {
  const w = world();
  assert.equal(row(w, 'skill', 'skill-010').usedBy, 3);
  assert.equal(row(w, 'skill', 'skill-042').usedBy, 2);
  assert.equal(row(w, 'tool', 'tool-mcp-02').usedBy, 2);
  assert.equal(row(w, 'note', 'slice-folders').usedBy, 2);
  assert.equal(row(w, 'skill', UPDATE_ITEM_ID).usedBy, 2);
  for (const r of libraryRows(w, 'skill')) assert.equal(r.usedBy, ownedAgents(w).filter(a => a.definition.skillIds.includes(r.id)).length, r.id);
  assert.equal(usedByLine(3), 'Used by 3 agents');
  assert.equal(usedByLine(1), 'Used by 1 agent');
});

test('a row has one status, by priority', () => {
  const w = world();
  assert.deepEqual(row(w, 'skill', 'skill-014').status, { label: '2 different copies', tone: 'warn' });
  assert.deepEqual(row(w, 'tool', 'tool-mcp-missing').status, { label: 'needs a key', tone: 'warn' });
  assert.deepEqual(row(w, 'tool', 'tool-hook-guard').status, { label: 'Runs code', tone: 'warn' });
  assert.deepEqual(row(w, 'skill', UPDATE_ITEM_ID).status, { label: 'Update available', tone: 'new' });
  assert.deepEqual(row(w, 'agent', 'agent-starter-note-taker').status, { label: 'Ready-made', tone: 'info' });
  assert.equal(row(w, 'agent', 'agent-01').status, null);
  assert.equal(row(w, 'skill', 'skill-010').status, null, 'used and fine: nothing to say');
  assert.deepEqual(row(w, 'note', 'slice-seeds').status, null);
});

test('an agent row says what the agent has', () => {
  const w = world();
  assert.equal(row(w, 'agent', 'agent-01').has, '4 skills and 1 tool');
  assert.equal(hasLine(0, 0), null); assert.equal(hasLine(1, 0), '1 skill'); assert.equal(hasLine(0, 2), '2 tools'); assert.equal(hasLine(2, 1), '2 skills and 1 tool');
});

test('search matches the name and the hint, every word, whatever the letter case, live', () => {
  const rows = libraryRows(world(), 'skill');
  assert.equal(listLibrary(world(), 'skill', '', 'name').rows.length, 53);
  assert.equal(listLibrary(world(), 'skill', '   ', 'name').rows.length, 53);
  const meeting = listLibrary(world(), 'skill', 'MEETING', 'name').rows.map(r => r.name);
  assert.ok(meeting.includes('Summarize a meeting') && meeting.includes('Move a meeting'));
  for (const r of listLibrary(world(), 'skill', 'meeting', 'name').rows) assert.match(`${r.name} ${r.hint}`.toLowerCase(), /meeting/);
  // a word of the hint, not the name
  assert.ok(listLibrary(world(), 'skill', 'pros and cons', 'name').rows.some(r => r.name === 'Compare two options'));
  assert.deepEqual(listLibrary(world(), 'skill', 'meeting notes xyz', 'name').rows, []);
  assert.equal(listLibrary(world(), 'skill', 'zzzzzz', 'name').total, 53, 'the total ignores the search');
  assert.equal(matchesSearch({ name: 'A b', hint: 'c d' }, 'b c'), true);
  assert.equal(matchesSearch({ name: 'A b', hint: 'c d' }, 'b  x'), false);
  assert.ok(rows.length === 53);
});

test('search treats special characters as plain letters', () => {
  for (const q of ['(', '[a-z', '.*', '\\', '<b>', '\'; DROP TABLE', '🌿', 'é']) assert.doesNotThrow(() => listLibrary(world(), 'skill', q, 'name'), q);
  assert.deepEqual(listLibrary(world(), 'skill', '.*', 'name').rows, []);
});

test('sorting by name is alphabetical and by recently added puts the newest first', () => {
  const w = world();
  const names = listLibrary(w, 'skill', '', 'name').rows.map(r => r.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  const added = listLibrary(w, 'skill', '', 'added').rows;
  for (let i = 1; i < added.length; i += 1) assert.ok(added[i - 1]!.days <= added[i]!.days, 'newer first');
  // a thing made in this preview is the newest of all
  const s = reduceStore(start(), { type: 'makeOwnCopy', itemId: 'skill-010', name: 'Compare two options (mine)', description: 'x', text: 'a\nb\n' });
  assert.equal(listLibrary(s.draft, 'skill', '', 'added').rows[0]!.name, 'Compare two options (mine)');
  assert.equal(sortRows([], 'name').length, 0);
});

test('every name has at most 5 words, every hint at most 12, and no banned word, for every thing the library lists', () => {
  const w = world();
  for (const kind of LIBRARY_KINDS) for (const r of libraryRows(w, kind)) {
    assert.ok(countWords(r.name) <= LIMITS.label, `${r.id}: ${r.name}`);
    assert.ok(countWords(r.hint) <= LIMITS.hint, `${r.id}: ${r.hint}`);
    assert.equal(bannedIn(r.name), null, r.name); assert.equal(bannedIn(r.hint), null, r.hint);
    assert.ok(r.name.trim() !== '' && r.hint.trim() !== '', r.id);
    if (r.status !== null) assert.ok(countWords(r.status.label) <= LIMITS.hint);
  }
});

test('details of a skill from outside: source, author, release, date added, what it does, who uses it, where it works, the full text', () => {
  const w = world();
  const d = libraryDetails(w, 'skill', 'skill-024')!;
  assert.equal(d.name, 'Find good sources');
  assert.equal(d.hint, 'Looks for trusted pages and papers on a topic.');
  assert.equal(d.origin.source, 'Open skills library');
  assert.equal(d.origin.outside, true);
  assert.match(d.origin.author, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.match(d.origin.release ?? '', /^v1\.\d$/);
  assert.match(d.origin.added, /^\d{1,2} [A-Z][a-z]+ 2026$/);
  assert.equal(d.canCopy, true); assert.equal(d.canAdd, true);
  assert.ok(d.text.length >= 2);
  assert.deepEqual(d.usedBy.map(a => a.name), ['Research assistant']);
  assert.ok(d.works.length >= 1 && d.works.every(w => ['Claude Code', 'Codex', 'OpenCode'].includes(w)));
  // the same item always has the same author, release and date
  assert.deepEqual(libraryDetails(world(), 'skill', 'skill-024')!.origin, d.origin);
});

test('an own item says "Made by you", has no release, and cannot be copied', () => {
  const d = libraryDetails(world(), 'skill', 'skill-042')!;
  assert.deepEqual([d.origin.source, d.origin.author, d.origin.release, d.origin.outside, d.canCopy], ['Made by you', 'Made by you', null, false, false]);
});

test('a skill with two copies says how many', () => {
  const d = libraryDetails(world(), 'skill', 'skill-014')!;
  assert.equal(d.copies, 2);
  assert.equal(libraryDetails(world(), 'skill', 'skill-010')!.copies, 0);
});

test('details of the item with an update: its source, author and release come from its own text, and the update is ready', () => {
  const w = world();
  const d = libraryDetails(w, 'skill', UPDATE_ITEM_ID)!;
  assert.equal(d.name, 'Tidy my meeting notes');
  assert.deepEqual([d.origin.source, d.origin.author, d.origin.release], ['Open skills library', 'Priya Raman', 'v1.2']);
  assert.deepEqual(d.usedBy.map(a => a.name).sort(), ['Interview notetaker', 'Meeting assistant']);
  assert.ok(d.update !== null);
  assert.deepEqual([d.update.from, d.update.to], ['v1.2', 'v1.3']);
  assert.equal(d.update.oldLines.length, 3); assert.equal(d.update.newLines.length, 4);
  assert.notDeepEqual(d.update.oldLines, d.update.newLines);
  assert.equal(updateOf(w, entryOf(w, 'skill', 'skill-010')!), null);
  assert.equal(libraryDetails(w, 'skill', 'skill-010')!.update, null);
  assert.equal(daysBackOf(UPDATE_ITEM_ID) > 0, true);
});

test('details of a tool: what it reaches (an example host), how far it can go, and the flags', () => {
  const w = world();
  const cal = libraryDetails(w, 'tool', 'tool-mcp-missing')!;
  assert.deepEqual([cal.name, cal.reach, cal.ability, cal.needsKey, cal.runsCode, cal.canAdd], ['Read my calendar', 'Reaches calendar.example.com', 'Can change things', true, false, true]);
  const search = libraryDetails(w, 'tool', 'tool-mcp-present')!;
  assert.deepEqual([search.reach, search.ability, search.needsKey, search.keyReady], ['Reaches search.example.com', 'Can only read', false, true]);
  const prompt = libraryDetails(w, 'tool', 'tool-prompt-01')!;
  assert.equal(prompt.reach, 'Nothing outside. It only sends a saved prompt.');
  const hook = libraryDetails(w, 'tool', 'tool-hook-guard')!;
  assert.deepEqual([hook.name, hook.runsCode, hook.canAdd, hook.reach, hook.ability], ['Check files after editing', true, false, 'This computer only', 'Can change things']);
  for (const t of libraryRows(w, 'tool')) {
    const full = libraryDetails(w, 'tool', t.id)!;
    assert.ok(full.reach !== null && full.ability !== null && full.text.length >= 2, t.id);
    for (const line of [full.reach!, ...full.text]) assert.equal(bannedIn(line), null, `${t.id}: ${line}`);
  }
});

test('details of an agent list what it has; details of a set of notes say how many notes', () => {
  const w = world();
  const a = libraryDetails(w, 'agent', 'agent-01')!;
  assert.equal(a.name, 'Meeting assistant');
  assert.ok(a.has !== null && a.has.skills.length === 4 && a.has.tools.length === 1 && a.has.notes.length === 1);
  assert.deepEqual(a.usedBy, []);
  const ready = libraryDetails(w, 'agent', 'agent-starter-note-taker')!;
  assert.deepEqual([ready.origin.source, ready.origin.author, ready.origin.release, ready.canCopy, ready.canAdd], ['Evergreen Kit', 'Evergreen Kit authors', '2.3.0', true, false]);
  const n = libraryDetails(w, 'note', 'slice-folders')!;
  assert.equal(n.name, 'Client list');
  assert.ok(n.notes !== null && n.notes.titles.length > 0 && /notes? it can read/.test(n.notes.countLine));
  assert.equal(n.usedBy.length, 2);
  assert.equal(libraryDetails(w, 'skill', 'nope'), null);
  assert.equal(libraryDetails(w, 'note', 'skill-042'), null);
});

test('every full text and every line of details obeys the banned list', () => {
  const w = world();
  for (const kind of LIBRARY_KINDS) for (const r of libraryRows(w, kind)) {
    const d = libraryDetails(w, kind, r.id)!;
    for (const line of [...d.text, d.origin.source, d.origin.author, d.origin.added, ...(d.notes?.titles ?? [])]) assert.equal(bannedIn(line), null, `${r.id}: ${line}`);
  }
});

test('the agents a thing can be added to: those that have it are marked', () => {
  const w = world();
  const choices = agentsFor(w, 'skill', 'skill-010');
  assert.equal(choices.length, 10);
  assert.equal(choices.filter(c => c.has).length, 3);
  assert.deepEqual(agentsFor(w, 'agent', 'agent-01'), []);
  assert.equal(agentsFor(w, 'note', 'slice-folders').filter(c => c.has).length, 2);
  assert.equal(agentsFor(w, 'skill', 'nope').length, 0);
});

test('removing: the plan names the agents it comes off, and the line says how many', () => {
  const w = world();
  const plan = removePlan(w, 'skill', 'skill-010')!;
  assert.equal(plan.line, 'This takes it off 3 agents.');
  assert.equal(plan.agents.length, 3);
  assert.equal(plan.name, 'Compare two options');
  assert.equal(removePlan(w, 'skill', 'skill-003')!.line, 'No agent uses it yet.');
  assert.equal(takesOffLine(1), 'This takes it off 1 agent.');
  assert.equal(removePlan(w, 'skill', 'nope'), null);
});

test('an own copy: "<name> (mine)", the lines of the original, no author, no release', () => {
  const w = world();
  const draft = copyDraft(w, 'skill', 'skill-024')!;
  assert.equal(draft.name, 'Find good sources (mine)');
  assert.match(draft.text, /Look for trusted pages/);
  assert.doesNotMatch(draft.text, /^(author|release):/m);
  const next = reduceStore(start(), { type: 'makeOwnCopy', itemId: 'skill-024', ...draft });
  const copy = next.draft.items.find(i => i.name === draft.name)!;
  const d = libraryDetails(next.draft, 'skill', copy.id)!;
  assert.equal(d.name, 'Find good sources (mine)');
  assert.equal(d.hint, 'Looks for trusted pages and papers on a topic.');
  assert.deepEqual([d.origin.source, d.origin.author, d.origin.outside, d.canCopy, d.origin.added], ['Made by you', 'Made by you', false, false, 'Added just now']);
  assert.deepEqual(d.text, libraryDetails(w, 'skill', 'skill-024')!.text);
  assert.deepEqual(d.usedBy, []);
  assert.equal(copyDraft(w, 'note', 'slice-folders'), null);
  assert.equal(copyDraft(w, 'skill', 'nope'), null);
});

test('an own copy of a tool keeps what it reaches, and an own copy of a ready-made agent keeps its job', () => {
  const w = world();
  const tool = copyDraft(w, 'tool', 'tool-mcp-01')!;
  const s = reduceStore(start(), { type: 'makeOwnCopy', itemId: 'tool-mcp-01', ...tool });
  const copy = s.draft.items.find(i => i.name === 'Read my spending file (mine)')!;
  const d = libraryDetails(s.draft, 'tool', copy.id)!;
  assert.deepEqual([d.reach, d.ability, d.origin.author], ['Reaches files.example.com', 'Can only read', 'Made by you']);
  const agent = copyDraft(w, 'agent', 'agent-starter-email-drafter')!;
  const s2 = reduceStore(start(), { type: 'makeOwnCopy', itemId: 'agent-starter-email-drafter', ...agent });
  const mine = s2.draft.items.find(i => i.name === 'Email drafter (mine)')!;
  const ad = libraryDetails(s2.draft, 'agent', mine.id)!;
  assert.equal(ad.name, 'Email drafter (mine)');
  assert.equal(ad.hint, 'Writes replies and matches your tone.', 'the hint the map gives the agent, built from its skills');
  assert.equal(mine.library, null);
});

test('mineName keeps the mark inside five words', () => {
  assert.equal(mineName('Summarize a meeting'), 'Summarize a meeting (mine)');
  assert.equal(mineName('Fix spelling and grammar'), 'Fix spelling and grammar (mine)');
  assert.equal(mineName('One two three four five six'), 'One two three four (mine)');
  assert.equal(countWords(mineName('One two three four five six')), 5);
  assert.equal(mineName('Mail'), 'Mail (mine)');
});

test('dates are plain text inside 2026 and stable', () => {
  assert.equal(dayText(0), '24 October 2026');
  assert.equal(dayText(1), '23 October 2026');
  assert.equal(dayText(24), '30 September 2026');
  assert.equal(dayText(296), '1 January 2026');
  assert.equal(dayText(9999), '1 January 2026');
  assert.equal(dayText(-5), '24 October 2026');
  assert.equal(daysBackOf('skill-001'), daysBackOf('skill-001'));
  assert.equal(daysBackOf('web-x-y'), -1); assert.equal(daysBackOf('skill-1-mine'), -1); assert.equal(daysBackOf('agent-starter-note-taker-copy-2'), -1);
});

test('the sample sources are not in the world until someone adds them, and adding one shows its author, release and source on each item', () => {
  const w = world();
  const office = SAMPLE_SOURCES[0]!;
  const next = reduceStore(start(), { type: 'addToLibrary', source: infoOf(office), items: office.items.map(i => newItemOf(i)) }).draft;
  assert.equal(libraryCounts(next).skill, libraryCounts(w).skill + 3);
  const triage = libraryRows(next, 'skill').find(r => r.name === 'Triage my inbox')!;
  const d = libraryDetails(next, 'skill', triage.id)!;
  assert.deepEqual([d.hint, d.origin.source, d.origin.author, d.origin.release, d.origin.added, d.origin.outside, d.usedBy.length], ['Sorts new mail into what needs you today and what can wait.', 'Everyday office kit', 'Dana Whitfield', 'v2.1', 'Added just now', true, 0]);
  assert.deepEqual(triage.status, { label: 'Not used yet', tone: 'info' });
  const chat = libraryDetails(next, 'tool', libraryRows(next, 'tool').find(r => r.name === 'Send a chat message')!.id)!;
  assert.deepEqual([chat.reach, chat.ability, chat.needsKey, chat.origin.author], ['Reaches chat.example.com', 'Can change things', true, 'Lena Brandt']);
  const hook = libraryDetails(next, 'tool', libraryRows(next, 'tool').find(r => r.name === 'Tidy files after saving')!.id)!;
  assert.deepEqual([hook.runsCode, hook.canAdd, hook.reach], [true, false, 'This computer only']);
  const clerk = libraryRows(next, 'agent').find(r => r.name === 'Mail clerk')!;
  assert.equal(clerk.hint, 'Reads your mail and drafts short replies for you to check.');
  assert.deepEqual(clerk.status, { label: 'Ready-made', tone: 'info' });
});
