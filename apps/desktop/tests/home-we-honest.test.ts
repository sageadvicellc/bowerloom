// Wave E, group G: the sample says what it is. A tool named "Read my calendar" says it can only read, wherever its access is shown; a source line names where a thing
// came from; the copies have dates; and a save of two things to two agents does not drop the agents.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_WORDS } from '../shared/home/plain-details.js';
import { READ_VERBS, TOOL_FACTS, withReadingTools } from '../shared/home/library-sample.js';
import { SAMPLE_SOURCES, abilityOfItem } from '../shared/home/library-sources.js';
import { libraryDetails, libraryRows } from '../shared/home/library-model.js';
import { detailsOf } from '../shared/home/details.js';
import type { ToolDetails } from '../shared/home/details.js';
import { ownedAgents } from '../shared/home/cards.js';
import { libraryWorld } from './home-library-world.js';

const world = libraryWorld();
const reads = (name: string): boolean => READ_VERBS.some(verb => name === verb || name.startsWith(`${verb} `));

test('every tool whose name starts with Read, Search, Look or Check says "Can only read" in the Library, in the details of every agent that holds it, and in the web sample', () => {
  const tools = libraryRows(world, 'tool');
  const reading = tools.filter(t => reads(t.name));
  assert.ok(reading.length >= 4, `${reading.map(t => t.name).join(', ')}`);
  assert.ok(reading.some(t => t.name === 'Read my calendar'), 'the calendar is one of them');
  for (const t of reading) {
    assert.equal(libraryDetails(world, 'tool', t.id)!.ability, ACCESS_WORDS['read-only'], `${t.name} in the Library`);
    const holders = ownedAgents(world).filter(a => a.definition.toolAttachments.some(x => x.toolId === t.id));
    for (const a of holders) assert.equal((detailsOf(world, ownedAgents(world), { kind: 'tool', id: t.id, ownerAgentId: a.id }) as ToolDetails).access, ACCESS_WORDS['read-only'], `${t.name} for ${a.id}`);
    if (holders.length > 0) assert.equal((detailsOf(world, ownedAgents(world), { kind: 'tool', id: t.id }) as ToolDetails).access, ACCESS_WORDS['read-only'], `${t.name} with no owner`);
  }
  for (const source of SAMPLE_SOURCES) for (const item of source.items) if (item.kind === 'tool' && reads(item.name)) assert.equal(abilityOfItem(item), ACCESS_WORDS['read-only'], `${item.name} in ${source.name}`);
  // The plain facts agree with the names, and a tool that can change things does not start with one of those words.
  for (const [id, facts] of Object.entries(TOOL_FACTS)) if (facts.name !== undefined && reads(facts.name)) assert.equal(facts.access, 'read-only', id);
  for (const t of tools) if (libraryDetails(world, 'tool', t.id)!.ability === ACCESS_WORDS['read-write']) assert.equal(reads(t.name), false, `${t.name} can change things`);
});

test('putting the tools in line is idempotent, changes only the agents that held a reading tool with another access, and leaves a world with none as it was', () => {
  assert.equal(withReadingTools(world), world, 'the app world is already in line');
  const once = withReadingTools(world);
  assert.equal(withReadingTools(once), once);
  const spoiled = { ...world, items: world.items.map(i => (i.kind === 'agent' && i.library === null ? { ...i, definition: { ...i.definition, toolAttachments: i.definition.toolAttachments.map(t => ({ ...t, access: 'read-write' as const })) } } : i)) };
  const fixed = withReadingTools(spoiled);
  assert.notEqual(fixed, spoiled);
  for (const a of ownedAgents(fixed)) for (const t of a.definition.toolAttachments) {
    const name = libraryDetails(fixed, 'tool', t.toolId)!.name;
    assert.equal(t.access, reads(name) ? 'read-only' : 'read-write', `${a.id} ${name}`);
  }
});

// ---- Two things added to two agents keep a word about where.
import { barSentence } from '../shared/home/changes.js';
import { reduceStore } from '../shared/proto/store.js';
import { libraryChangeList } from '../shared/home/library-changes.js';
import { barSaid } from '../shared/home/change-undo.js';
import { countWords } from '../shared/home/textbudget.js';

test('two things added to the same agent name it; two things added to two agents say "to 2 agents" when the names do not fit, never nothing', () => {
  const at = (agentId: string, skillId: string) => ({ type: 'attachSkill', agentId, skillId }) as const;
  const state = (...actions: ReturnType<typeof at>[]) => actions.reduce((s, a) => reduceStore(s, a), { committed: world, draft: world, undoStack: [], redoStack: [], headVersionId: null } as Parameters<typeof reduceStore>[0]);
  const same = state(at('agent-04', 'skill-019'), at('agent-04', 'skill-proj-4'));
  assert.equal(barSaid(libraryChangeList(same.committed, same.draft), 2), 'Added Check a link and Check a price list to Inbox sorter');
  const apart = state(at('agent-04', 'skill-019'), at('agent-10', 'skill-proj-4'));
  const said = barSaid(libraryChangeList(apart.committed, apart.draft), 2)!;
  assert.equal(said, 'Added Check a link and Check a price list to 2 agents');
  assert.ok(countWords(said) <= 12);
  // Short names still fit in full, with both agents named.
  assert.equal(barSentence([{ verb: 'added', what: 'A', to: 'X' }, { verb: 'added', what: 'B', to: 'Y' }], 2), 'Added A to X and added B to Y');
  // The same agent and a different verb are as they were.
  assert.equal(barSentence([{ verb: 'removed', what: 'A' }, { verb: 'added', what: 'B', to: 'Y' }], 2), 'Removed A and added B to Y');
});

// ---- The copies have dates, and the dialog says which is newer.
import { copiesOf, newerCopy } from '../shared/home/add-copies.js';
import { SAMPLE_COPY_DAYS, SAMPLE_COPY_SKILL, sampleCopyDays } from '../shared/home/sample-copies.js';
import { ADD_WORDS, changedAgo, foundIn, newerIs } from '../renderer/home/add/add-words.js';
import { bannedIn } from '../shared/home/textbudget.js';

test('every item with different copies has a date for each place, the newest copy is named, and a copy made in this preview has none', () => {
  const skill = world.items.find(i => i.id === SAMPLE_COPY_SKILL)!;
  const days = sampleCopyDays(skill)!;
  assert.deepEqual(days, skill.foundAt.map((_, at) => SAMPLE_COPY_DAYS[at % SAMPLE_COPY_DAYS.length]));
  const views = copiesOf(skill);
  assert.equal(views.length, 2);
  // Claude Code and OpenCode hold the first text (3 and 17 days), Codex the second (9 days): the first copy is the newer.
  assert.deepEqual(views.map(v => [v.place, v.daysAgo]), [['Claude Code and OpenCode', 3], ['Codex', 9]]);
  assert.equal(newerCopy(views), 1);
  assert.equal(foundIn(views[0]!.place, views[0]!.daysAgo), 'Found in Claude Code and OpenCode, changed 3 days ago');
  assert.equal(newerIs(1), 'Copy 1 is the newer one.');
  // The triple skill has three copies with three dates.
  const triple = copiesOf(world.items.find(i => i.id === 'skill-triple')!);
  assert.equal(triple.length, 3);
  assert.deepEqual(triple.map(v => v.daysAgo), [3, 9, 17]);
  assert.equal(newerCopy(triple), 1);
  // No date, no "newer"; the same day for the two newest, no "newer".
  assert.equal(newerCopy(views.map(v => ({ ...v, daysAgo: null }))), null);
  assert.equal(newerCopy(views.map(v => ({ ...v, daysAgo: 4 }))), null);
  assert.equal(newerCopy([views[0]!]), null);
  assert.equal(sampleCopyDays({ id: 'web-open-skills-tidy-notes', foundAt: skill.foundAt }), null);
  assert.equal(sampleCopyDays({ id: 'skill-1-mine', foundAt: skill.foundAt }), null);
  assert.equal(sampleCopyDays({ id: 'agent-starter-note-taker-copy-2', foundAt: skill.foundAt }), null);
  for (const text of [changedAgo(0), changedAgo(1), changedAgo(40), foundIn('Claude Code, Codex and OpenCode', 17), newerIs(3)]) { assert.ok(countWords(text) <= 12, text); assert.equal(bannedIn(text), null, text); }
  assert.equal(changedAgo(0), 'changed today'); assert.equal(changedAgo(1), 'changed 1 day ago');
  assert.equal(ADD_WORDS.label.differentCopies, 'Two different copies');
});

// ---- Look inside: a tool's text is words, and its key is a plain name, so nothing in the sample reads as a password.
import { flaggedIds, lookItems, looksLikeKey } from '../shared/home/share-look.js';
import { PLAIN_KEY_NAMES, withPlainKeys } from '../shared/home/library-sample.js';
import { buildShare, keyNamesIn, planShare, shareableAgents } from '../shared/home/share-model.js';
import { plainNameOf } from '../shared/home/plain-names.js';
import { generateWorld } from '../shared/proto/sample.js';

test('the text of a tool in Look inside is its plain name and the name of its key, with no made-up word pair that reads like a password', () => {
  const offered = shareableAgents(world).map(a => a.id);
  const bundle = buildShare(world, offered);
  const nameOf = plainNameOf(world);
  const tools = lookItems(bundle, nameOf, world.wikiPages).filter(i => i.kind === 'tool');
  assert.ok(tools.length >= 5);
  const stored = bundle.toolRefs.map(t => t.name);
  for (const t of tools) {
    for (const raw of stored) assert.equal(t.text.includes(raw), false, `${t.name}: ${t.text}`);
    assert.doesNotMatch(t.text, /\b[a-z]+-[a-z]+\b/, t.text);
    assert.equal(t.flagged, false, t.text);
    assert.equal(looksLikeKey(t.text), false, t.text);
    assert.ok(t.text.startsWith(t.name), `${t.name}: the text opens with the name`);
  }
  const calendar = tools.find(t => t.name === 'Read my calendar')!;
  assert.equal(calendar.text, 'Read my calendar\n\nKey name: CALENDAR_KEY');
  assert.deepEqual(flaggedIds(lookItems(bundle, nameOf, world.wikiPages)), [], 'the key check still finds nothing in the sample');
});

test('the keys of the sample have plain names, in the world and in the text of their files; the names are all the share file holds of them', () => {
  const raw = generateWorld(1);
  const rawKeys = raw.items.flatMap(i => (i.kind === 'tool' && i.toolKind === 'mcp' && i.secret !== null ? [i.secret.name] : []));
  assert.ok(rawKeys.some(k => /_TOKEN$/.test(k)), 'the generated names are made-up word pairs');
  const plain = withPlainKeys(raw);
  for (const [id, name] of Object.entries(PLAIN_KEY_NAMES)) {
    const tool = plain.items.find(i => i.id === id)!;
    assert.ok(tool.kind === 'tool' && tool.toolKind === 'mcp' && tool.secret !== null);
    assert.equal(tool.kind === 'tool' && tool.toolKind === 'mcp' ? tool.secret?.name : '', name);
    assert.ok(tool.foundAt.every(f => f.text.includes(`"${name}"`) && f.contentHash !== ''), 'the file says the same name');
  }
  assert.equal(withPlainKeys(plain), plain, 'a second pass changes nothing');
  const plan = planShare(world, shareableAgents(world).map(a => a.id), []);
  assert.deepEqual(plan.keyNames, [...new Set(plan.keyNames)].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(plan.keyNames, keyNamesIn(plan.bundle));
  assert.equal(plan.keyNames.length, plan.keys);
  for (const name of plan.keyNames) assert.match(name, /^[A-Z]+_KEY$/);
  assert.ok(plan.keyNames.length >= 3, plan.keyNames.join());
  // Only names: nothing like a value is in the file.
  assert.equal(looksLikeKey(plan.text), false, 'nothing in the file looks like a key');
  for (const name of plan.keyNames) assert.equal(plan.text.includes(`"${name}"`), true, 'the name is in the file'), assert.equal(new RegExp(`"${name}"\\s*:`).test(plan.text), false, 'and it is a name, not a field with a value');
});
