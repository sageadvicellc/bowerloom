// Real mode in the shell, without a window: Hermes and Bowerloom as programs of the world, the plain layer for items from a real setup (each hook, with a real item and without one),
// the merge of two reads (Find more), and a sweep that no screen model says a sample word or an invented line about a setup read from files. Everything runs on a made-up home folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { createScanner } from '../main/real-scan.js';
import { DESKTOP } from './support.js';
import { agentCard, noteWords, ownedAgents, shelvesOf, wordsOf } from '../shared/home/cards.js';
import { detailsOf } from '../shared/home/details.js';
import { appLabel, findAgents, findPlaces } from '../shared/home/find-model.js';
import { findReduce, startFind } from '../shared/home/find-flow.js';
import { LIBRARY_KINDS, daysBackOf, libraryDetails, libraryRows, originOf, entriesOf } from '../shared/home/library-model.js';
import { PLAIN_AGENTS, PLAIN_NOTES, PLAIN_SKILLS, PLAIN_TOOLS, agentRecency, plainOf } from '../shared/home/plain.js';
import { plainNameOf } from '../shared/home/plain-names.js';
import { PROGRAM_NAMES, PROGRAM_ORDER } from '../shared/home/plain-details.js';
import { sampleCopyDays } from '../shared/home/sample-copies.js';
import { planShare } from '../shared/home/share-model.js';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { STARTERS } from '../shared/home/starters.js';
import { placesOf, placesOfItem } from '../shared/home/where-it-lives.js';
import { validateWorld } from '../shared/proto/sample.js';
import { INTERFACE_WORDS } from '../shared/proto/words.js';
import type { AgentItem, HarnessItem, World } from '../shared/proto/types.js';
import { buildRealResult } from '../shared/real/map-world.js';
import { countsOf, mergeResults } from '../shared/real/merge-result.js';
import { clearRealResult, isRealId, realCopyDaysOf, realPlacesOf, realRecencyOf, registerRealResult } from '../shared/real/plain-fallback.js';
import type { RealResult } from '../shared/real/types.js';
import { SHELL_AGENTS, SHELL_COPIES_SKILL, SHELL_SECRET, buildShellHome } from './fixtures-real/shell-home.js';
import type { ShellHome } from './fixtures-real/shell-home.js';

const NOW = Date.UTC(2026, 9, 26);

function shell(t: TestContext): ShellHome { const f = buildShellHome(); t.after(() => f.cleanup()); return f; }
const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

/** Reads the home places and the given folders, the way the main process does for real mode (the other programs fold into the world). */
async function readFrom(home: string, folders: readonly string[] = [], fold = true): Promise<RealResult> {
  const scanner = createScanner({ home });
  const found = await scanner.discover(), places = [...found.places];
  for (const folder of folders) places.push(...(await scanner.addFolder(folder)).places);
  const batch = await scanner.read(places.map(p => p.id));
  return buildRealResult(batch.reads, batch.tally, { nowMs: NOW, foldExtraApps: fold });
}
const shown = (world: World): string[] => ownedAgents(world).map(a => agentCard(a).name).sort((a, b) => a.localeCompare(b));
const itemNamed = (world: World, name: string): HarnessItem => world.items.find(i => i.name.toLowerCase() === name.toLowerCase())!;

test.afterEach(() => { clearRealResult(); });

// ---------------------------------------------------------------------------------------------------- Hermes and Bowerloom are programs

test('every table keyed by a program names all five, and the details list them in one order', () => {
  const all = ['claude-code', 'codex', 'opencode', 'hermes', 'bowerloom'];
  assert.deepEqual(Object.keys(INTERFACE_WORDS), all);
  assert.deepEqual(Object.keys(PROGRAM_NAMES), all);
  assert.deepEqual([...PROGRAM_ORDER], all);
  assert.equal(appLabel('hermes'), 'Hermes'); assert.equal(appLabel('bowerloom'), 'Bowerloom'); assert.equal(appLabel('opencode'), 'OpenCode');
  assert.equal(appLabel('some-new-app'), 'Some New App', 'a program the table does not know is named by its own id as words');
});

test('an item found in Claude Code and in Hermes has a place in each, a Bowerloom folder is a program, and the world is valid with them', async t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-hermes-test-'))); t.after(() => rmSync(dir, { recursive: true, force: true }));
  put(join(dir, '.claude', 'skills', 'lamp-check', 'SKILL.md'), '---\nname: Lamp check\ndescription: Checks the lamps.\n---\nLook at each lamp.\n');
  put(join(dir, '.hermes', 'skills', 'general', 'lamp-check', 'SKILL.md'), '---\nname: Lamp check\ndescription: Checks the lamps.\n---\nLook at each lamp, twice.\n');
  put(join(dir, '.hermes', 'skills', 'general', 'dusk-only', 'SKILL.md'), '---\nname: Dusk only\ndescription: Only at dusk.\n---\nWait for dusk.\n');
  put(join(dir, 'proj', '.bowerloom', 'skills', 'ledger-note', 'SKILL.md'), '---\nname: Ledger note\ndescription: Notes on the ledger.\n---\nWrite it.\n');
  const folded = await readFrom(dir, [join(dir)]);
  const lamp = folded.world.items.find(i => i.name === 'Lamp check')!;
  assert.deepEqual(lamp.foundAt.map(f => f.interface), ['claude-code', 'hermes']);
  assert.equal(new Set(lamp.foundAt.map(f => f.contentHash)).size, 2, 'two different texts: the existing different-copies case');
  assert.deepEqual(folded.world.items.find(i => i.name === 'Dusk only')!.foundAt.map(f => f.interface), ['hermes']);
  assert.deepEqual(folded.world.items.find(i => i.name === 'Ledger note')!.foundAt.map(f => f.interface), ['bowerloom']);
  assert.deepEqual(folded.world.interfaces.map(i => [i.id, i.installed]), [['claude-code', 'installed'], ['codex', 'unknown'], ['opencode', 'unknown'], ['hermes', 'installed'], ['bowerloom', 'installed']]);
  assert.deepEqual(folded.others, []);
  assert.deepEqual(validateWorld(folded.world), []);
  assert.deepEqual(folded.ages[lamp.id]!.length, 2, 'one age for each place, in the order of the places');
  // Without the option, a program beyond the three is listed apart and the world holds only the three.
  const apart = await readFrom(dir, [join(dir)], false);
  assert.deepEqual(apart.world.interfaces.map(i => i.id), ['claude-code', 'codex', 'opencode']);
  assert.deepEqual(apart.world.items.find(i => i.name === 'Lamp check')!.foundAt.map(f => f.interface), ['claude-code']);
  assert.ok(apart.others.some(o => o.app === 'Hermes' && o.name === 'Lamp check'));
});

// ---------------------------------------------------------------------------------------------------- the made-up home reads to what we expect

test('the made-up home gives the agents we expect, each with the app tags it works in, Hermes among them', async t => {
  const f = shell(t), result = await readFrom(f.home, [f.orchard]);
  registerRealResult(result);
  assert.deepEqual(validateWorld(result.world), []);
  const list = findAgents(result.world);
  assert.deepEqual(list.map(a => a.name), [...SHELL_AGENTS.home, ...SHELL_AGENTS.orchard].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(shown(result.world), list.map(a => a.name));
  const tags = Object.fromEntries(list.map(a => [a.name, a.apps]));
  assert.deepEqual(tags['Ledger keeper'], ['Claude Code']); assert.deepEqual(tags['Seed sorter'], ['Codex']); assert.deepEqual(tags['Bench scribe'], ['OpenCode']);
  assert.deepEqual(tags['Lantern'], ['Hermes']); assert.deepEqual(tags['Graft helper'], ['Claude Code']);
  for (const a of list) assert.notEqual(a.hint, '', a.name);
  assert.deepEqual(findPlaces(result.world).map(p => p.name), ['Your home folder', 'Apple Row']);
});

test('the key value never reaches a model of any screen, and the other facts of the file do', async t => {
  const f = shell(t), result = await readFrom(f.home, [f.orchard]);
  registerRealResult(result);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SHELL_SECRET));
  const copies = result.world.items.find(i => i.name === SHELL_COPIES_SKILL)!;
  assert.deepEqual(copies.foundAt.map(x => x.interface), ['claude-code', 'codex']);
});

// ---------------------------------------------------------------------------------------------------- the plain layer, each hook

test('plainOf: a real id has the words worked out from its file once the result is registered, and none before or after', async t => {
  const f = shell(t), result = await readFrom(f.home, [f.orchard]), w = result.world;
  const keeper = w.items.find(i => i.name === 'Ledger keeper')!, tally = w.items.find(i => i.name === SHELL_COPIES_SKILL)!, ledger = w.items.find(i => i.kind === 'tool' && i.name === 'ledger-sync')!;
  assert.equal(plainOf('agent', keeper.id), null, 'not registered yet: the sample layer does not know it');
  registerRealResult(result);
  assert.deepEqual(plainOf('agent', keeper.id), { name: 'Ledger keeper', hint: 'Keeps the household ledger tidy and flags odd entries.' });
  assert.deepEqual(plainOf('skill', tally.id), { name: 'Shared tally', hint: 'Adds up the household totals again.' });
  assert.equal(plainOf('tool', ledger.id)!.name, 'Ledger Sync', 'a file-style name becomes words');
  assert.equal(plainOf('skill', keeper.id), null, 'an id asked as the wrong kind is not answered');
  assert.equal(plainOf('agent', 'agent-01')!.name, 'Meeting assistant', 'the sample is answered first and unchanged');
  clearRealResult();
  assert.equal(plainOf('agent', keeper.id), null, 'cleared on unmount');
});

test('agentRecency: the agent whose file changed most recently comes first; a sample agent keeps its rank', async t => {
  const f = shell(t), result = await readFrom(f.home, [f.orchard]);
  registerRealResult(result);
  const agents = result.world.items.filter((i): i is AgentItem => i.kind === 'agent');
  const ranks = agents.map(a => agentRecency(a.id)).sort((a, b) => a - b);
  assert.deepEqual(ranks, agents.map((_, i) => i), 'ranks 0..n-1, each once');
  assert.ok(agents.every(a => realRecencyOf(a.id) === agentRecency(a.id)));
  assert.equal(agentRecency('agent-04'), PLAIN_AGENTS['agent-04']!.recency);
  assert.equal(agentRecency('real-agent-0000000000'), Number.MAX_SAFE_INTEGER, 'an id nobody knows comes last');
});

test('agentCard: a real agent says what its own file says, not what a sample skill does', async t => {
  const f = shell(t), result = await readFrom(f.home, [f.orchard]);
  registerRealResult(result);
  const keeper = result.world.items.find(i => i.name === 'Ledger keeper') as AgentItem;
  assert.ok(keeper.definition.skillIds.length > 0, 'it holds skills');
  assert.deepEqual(agentCard(keeper), { name: 'Ledger keeper', hint: 'Keeps the household ledger tidy and flags odd entries.' });
  // Not registered: it falls back to its own name and the generic line, never to an invented sample name.
  clearRealResult();
  assert.equal(agentCard(keeper).name, 'Ledger Keeper');
  assert.match(agentCard(keeper).hint, /^An? .* with 2 skills and 1 tool\.$/);
});

test('sampleCopyDays: a real item has the ages of its own files, whatever its id looks like', async t => {
  const f = shell(t), result = await readFrom(f.home, [f.orchard]);
  const tally = result.world.items.find(i => i.name === SHELL_COPIES_SKILL)!;
  assert.deepEqual(sampleCopyDays(tally), [3, 9, 17, 30].slice(0, 2), 'before it is registered, the made-up days of the sample answer');
  registerRealResult(result);
  assert.deepEqual(sampleCopyDays(tally), result.ages[tally.id]);
  assert.equal(realCopyDaysOf(tally)!.length, 2);
  assert.ok(sampleCopyDays(tally)!.every(d => Number.isInteger(d) && d >= 0), 'whole days, never negative');
  const sample = { id: 'skill-014', foundAt: tally.foundAt };
  assert.deepEqual(sampleCopyDays(sample), [3, 9], 'a sample id keeps the sample days');
});

test('placesOfItem: a real item has its real paths with the home folder written ~, a sample item keeps the sample paths, and nothing is invented', async t => {
  const f = shell(t), result = await readFrom(f.home, [f.orchard]);
  registerRealResult(result);
  const tally = result.world.items.find(i => i.name === SHELL_COPIES_SKILL)!;
  const places = placesOfItem(tally, 'Shared tally');
  assert.deepEqual(places.map(p => p.app), ['Claude Code', 'Codex']);
  assert.deepEqual(places.map(p => p.path), ['~/.claude/skills/shared-tally/SKILL.md', '~/.codex/skills/shared-tally/SKILL.md']);
  assert.deepEqual(realPlacesOf(tally), places);
  const lantern = itemNamed(result.world, 'Lantern');
  assert.deepEqual(placesOf(result.world, 'agent', lantern.id, 'Lantern').map(p => p.app), ['Hermes']);
  assert.ok(placesOfItem(lantern, 'Lantern').every(p => p.path.startsWith('~/.hermes/')), 'the path is Hermes\'s own');
  const sampleSkill = { ...tally, id: 'skill-014' };
  assert.ok(placesOfItem(sampleSkill, 'Sort mail by topic').every(p => !isRealId(sampleSkill.id) && p.path.length > 0), 'a sample id is answered by the sample table');
  assert.equal(realPlacesOf(sampleSkill), null);
  assert.doesNotMatch(JSON.stringify(places), /Studio|\/Users\/sample/);
});

test('noteWords: a set of notes from a real setup has its own name and how many notes it holds', async t => {
  const f = shell(t), result = await readFrom(f.home, [f.orchard]);
  registerRealResult(result);
  const sets = result.world.slices;
  assert.ok(sets.length >= 1);
  for (const s of sets) {
    const words = noteWords(s, result.world.wikiPages);
    assert.match(words.hint, /^\d+ notes? it can read\.$|^No notes yet\.$/);
    assert.notEqual(words.name, '');
  }
  const names = sets.map(s => noteWords(s, result.world.wikiPages).name).sort();
  assert.deepEqual(names, ['Apple-row notes', 'Notes in apple-row'], 'a topic called "notes" is named by its place, not "Notes notes"');
});

// ---------------------------------------------------------------------------------------------------- nothing invented, nothing from the sample

const SAMPLE_NAMES = (): string[] => [...Object.values(PLAIN_AGENTS), ...Object.values(PLAIN_SKILLS), ...Object.values(PLAIN_TOOLS), ...Object.values(PLAIN_NOTES)].map(p => p.name).concat(STARTERS.map(s => s.name));

test('the made-up home uses no name that the sample uses (so a sample name on a screen could only come from the sample)', () => {
  const mine = [...SHELL_AGENTS.home, ...SHELL_AGENTS.orchard, ...SHELL_AGENTS.cellar, SHELL_COPIES_SKILL, 'Pantry check', 'Graft notes', 'Ledger sync'];
  const theirs = new Set(SAMPLE_NAMES().map(n => n.toLowerCase()));
  for (const name of mine) assert.equal(theirs.has(name.toLowerCase()), false, name);
});

test('every model a screen reads, for every item of a real setup, holds no sample name, no "undefined", no invented maker, release or date, and no key value', async t => {
  const f = shell(t), result = await readFrom(f.home, [f.orchard]), w = result.world;
  registerRealResult(result);
  const parts: unknown[] = [];
  const agents = ownedAgents(w);
  const nameOf = plainNameOf(w);
  for (const a of agents) {
    parts.push(agentCard(a), shelvesOf(w, a), detailsOf(w, agents, { kind: 'agent', id: a.id }), placesOf(w, 'agent', a.id, nameOf(a.name)));
    const own = shelvesOf(w, a);
    for (const s of own.skills) parts.push(detailsOf(w, agents, { kind: 'skill', id: s.id, ownerAgentId: a.id }));
    for (const s of own.tools) parts.push(detailsOf(w, agents, { kind: 'tool', id: s.id, ownerAgentId: a.id }));
  }
  for (const kind of LIBRARY_KINDS) {
    parts.push(libraryRows(w, kind));
    for (const e of entriesOf(w, kind)) parts.push(libraryDetails(w, kind, e.id), e.kind === 'note' ? noteWords(e.slice, w.wikiPages) : e.kind === 'agent' ? agentCard(e.item as AgentItem) : wordsOf(e.kind, e.id, e.item.name));
  }
  parts.push(findAgents(w), findPlaces(w), planShare(w, agents.map(a => a.id), []).text);
  const text = JSON.stringify(parts);
  assert.doesNotMatch(text, /undefined|NaN|\[object/);
  assert.doesNotMatch(text, /Made by you|Open skills library|Community skills library|Evergreen|Studio|\/Users\/sample|Update available|Ready-made/);
  assert.doesNotMatch(text, new RegExp(SHELL_SECRET));
  for (const name of SAMPLE_NAMES()) assert.equal(text.includes(`"${name}"`), false, `the sample name ${name} is on a screen model`);
  // The origin of a real item: the place it was found in, and when its file last changed; no maker and no release.
  for (const kind of ['skill', 'agent', 'tool'] as const) for (const e of entriesOf(w, kind)) {
    if (e.kind === 'note') continue;
    const origin = originOf(w, e);
    assert.equal(origin.outside, false); assert.equal(origin.release, null); assert.equal(origin.changed, true);
    assert.equal(origin.author, 'Not stated');
    assert.match(origin.added, /^(Today|\d+ days? ago)$/, e.id);
    assert.ok(w.scopes.some(s => s.name === origin.source), `${e.id}: the source is the name of a place that was read: ${origin.source}`);
    assert.equal(daysBackOf(e.id), realCopyDaysOf(e.item)!.reduce((m, d) => Math.min(m, d), Infinity));
  }
});

test('a tool from a real setup says what its file says: the host or nothing, and how far it goes only when an agent was given it', async t => {
  const f = shell(t), result = await readFrom(f.home, [f.orchard]), w = result.world;
  registerRealResult(result);
  const ledger = w.items.find(i => i.kind === 'tool' && i.name === 'ledger-sync')!;
  const d = libraryDetails(w, 'tool', ledger.id)!;
  assert.equal(d.reach, 'It does not say what it reaches.', 'it starts a program on this computer; the file names no host');
  assert.notEqual(d.ability, 'Not stated', 'the Ledger keeper lists a tool of this connection');
  assert.equal(d.keyReady, false); assert.equal(d.needsKey, false, 'a file read from disk claims nothing about a key');
  const greenhouse = w.items.find(i => i.kind === 'tool' && i.name === 'greenhouse-feed')!;
  assert.equal(libraryDetails(w, 'tool', greenhouse.id)!.ability, 'Not stated', 'no agent holds it, so nothing says how far it goes');
  const details = detailsOf(w, ownedAgents(w), { kind: 'tool', id: greenhouse.id });
  assert.ok(details !== null && details.kind === 'tool' && details.access === 'Not stated' && details.keyReady === false);
});

test('the details of a real skill say where it was found and show its own text, and no maker', async t => {
  const f = shell(t), result = await readFrom(f.home, [f.orchard]), w = result.world;
  registerRealResult(result);
  const graft = w.items.find(i => i.name === 'Graft notes')!;
  const d = detailsOf(w, ownedAgents(w), { kind: 'skill', id: graft.id });
  assert.ok(d !== null && d.kind === 'skill');
  assert.equal(d.source, 'apple-row');
  assert.deepEqual(d.text, ['Notes.']);
  assert.deepEqual(d.works, ['Claude Code']);
});

// ---------------------------------------------------------------------------------------------------- Find more: the merge of two reads

test('two reads merge by id: new things join, a thing read again is replaced, nothing is lost, and the counts agree with the world', async t => {
  const f = shell(t);
  const first = await readFrom(f.home, [f.orchard]);
  const second = await readFrom(f.home, [f.cellar]);
  const merged = mergeResults(first, second);
  assert.deepEqual(validateWorld(merged.world), []);
  // The merged world is shown with the words that were registered for it.
  registerRealResult(merged);
  assert.deepEqual(shown(merged.world), [...SHELL_AGENTS.home, ...SHELL_AGENTS.orchard, ...SHELL_AGENTS.cellar].sort((a, b) => a.localeCompare(b)));
  assert.equal(new Set(merged.world.items.map(i => i.id)).size, merged.world.items.length, 'each id once');
  assert.deepEqual(merged.counts, countsOf(merged.world));
  assert.deepEqual(merged.world.scopes.map(s => s.name), ['Your home folder', 'orchard', 'apple-row', 'cellar', 'bottle-log'], 'a picked folder is a place, and so is each project in it');
  assert.ok(Object.keys(merged.ages).every(id => merged.world.items.some(i => i.id === id)));
  assert.equal(merged.readOnly, true);
  assert.equal(mergeResults(null, first), first, 'the first read comes back as it is');
  assert.deepEqual(mergeResults(first, first).world.items.map(i => i.id), first.world.items.map(i => i.id), 'reading the same places again changes nothing');
  assert.deepEqual(mergeResults(first, first).counts, first.counts);
  // Neither result is changed.
  assert.equal(first.world.scopes.length, 3); assert.equal(second.world.scopes.length, 3);
  assert.equal(plainOf('agent', merged.world.items.find(i => i.name === 'Label printer')!.id)!.hint, 'Prints a label for every new bottle.');
  assert.equal(plainOf('agent', merged.world.items.find(i => i.name === 'Graft helper')!.id)!.name, 'Graft helper', 'what the first read found is still named');
});

test('"Show on the map" ends the list at once, and only with an agent ticked', () => {
  const start = startFind(3, ['a', 'b'], ['a']);
  const list = findReduce(start, { type: 'lightAll' });
  assert.equal(findReduce(start, { type: 'choose' }), start, 'not while the search is looking');
  const done = findReduce(list, { type: 'choose' });
  assert.deepEqual([done.step, done.ticked], ['done', ['a']]);
  const none = findReduce(list, { type: 'clear', keep: [] });
  assert.equal(findReduce(none, { type: 'choose' }), none, 'nothing ticked: nothing to show');
  assert.equal(findReduce(findReduce(list, { type: 'looksRight' }), { type: 'choose' }).step, 'confirm', 'not from the second question');
});

// ---------------------------------------------------------------------------------------------------- the text budget on a person's own words

test('the budget takes out the person\'s own words and still holds ours: a name with a banned word passes, our own banned word beside it does not', () => {
  const own = ['Graft helper', 'Keeps the household ledger tidy and flags odd entries.'];
  const page = '<main><h2>Graft helper</h2><p>Keeps the household ledger tidy and flags odd entries.</p><button aria-label="Remove from Graft helper">Remove</button></main>';
  assert.ok(assertTextBudget(page).length > 0, 'without the option the banned word in the name is found');
  assert.deepEqual(assertTextBudget(page, { own }), []);
  assert.ok(assertTextBudget('<main><h2>Graft helper</h2><p>The scan is done.</p></main>', { own }).some(p => /scan/.test(p)), 'our own banned word is still found');
  assert.ok(assertTextBudget('<main><h2>Graft helper and then a good many more words</h2></main>', { own }).some(p => /heading/.test(p)), 'our own words around a name are still counted');
  assert.deepEqual(assertTextBudget('<main><p>Plain words.</p></main>', { own: [] }), []);
});

// ---------------------------------------------------------------------------------------------------- real mode builds nothing from the sample

test('the screens of real mode never build or ask for the sample world: no generated world, no sample copies, no starters, no library samples, no start point', () => {
  const dir = join(DESKTOP, 'renderer', 'home', 'real');
  const banned = /\b(loadWorld|generateWorld|withSampleCopies|withStarterAgents|withLibrarySamples|withStartPoint|withPlainKeys|withReadingTools|seedSample|addDemoWorld)\b/;
  const files = readdirSync(dir).filter(f => /\.tsx?$/.test(f));
  assert.ok(files.includes('RealRoot.tsx') && files.includes('RealScan.tsx') && files.includes('RealFind.tsx'));
  for (const file of files) assert.doesNotMatch(readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''), banned, file);
  // The sample is built in one place only, the root of the sample pages, which real mode does not reach.
  const mount = readFileSync(join(DESKTOP, 'renderer', 'home', 'mount.tsx'), 'utf8');
  const sampleRoot = mount.slice(mount.indexOf('function SampleRoot'));
  assert.match(sampleRoot, /loadWorld\(\)/);
  assert.doesNotMatch(mount.slice(mount.indexOf('function HomeRoot'), mount.indexOf('function SampleRoot')), /loadWorld|withStarterAgents|withLibrarySamples|withSampleCopies/);
});
