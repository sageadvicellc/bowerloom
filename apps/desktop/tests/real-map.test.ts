// The mapping from what the reader found to the World the home screens read. Runs on the made-up home folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { utimesSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { createScanner } from '../main/real-scan.js';
import { newTally } from '../main/real-fs.js';
import { validateWorld } from '../shared/world/sample.js';
import type { AgentItem, HarnessItem, World } from '../shared/world/types.js';
import { buildRealResult } from '../shared/real/map-world.js';
import type { RealResult } from '../shared/real/types.js';
import { FAKE_SECRET, FAKE_TOKEN_IN_TEXT, buildFixture } from './fixtures-real/build.js';
import type { Fixture } from './fixtures-real/build.js';

/** How many different texts an item holds across every place it was found. */
const distinctTexts = (item: HarnessItem): number => new Set(item.foundAt.map(f => f.contentHash)).size;

const NOW = Date.UTC(2026, 9, 26);

async function readAll(f: Fixture, foldExtraApps = false, nowMs = NOW): Promise<RealResult> {
  const scanner = createScanner({ home: f.home });
  const home = await scanner.discover(), picked = await scanner.addFolder(f.work);
  const batch = await scanner.read([...home.places, ...picked.places].map(p => p.id));
  return buildRealResult(batch.reads, batch.tally, { nowMs, foldExtraApps });
}
function fixture(t: TestContext): Fixture { const f = buildFixture(); t.after(() => f.cleanup()); return f; }
const named = (world: World, kind: HarnessItem['kind'], name: string, scopeId = 'global'): HarnessItem => {
  const item = world.items.find(i => i.kind === kind && i.name === name && i.scopeId === scopeId);
  assert.ok(item, `${kind} ${name} in ${scopeId}: ${world.items.filter(i => i.kind === kind).map(i => `${i.name}@${i.scopeId}`).join(', ')}`);
  return item;
};

test('the world is valid: no repeated id, no missing reference, hashes that match their texts', async t => {
  const r = await readAll(fixture(t));
  assert.deepEqual(validateWorld(r.world), []);
  assert.equal(r.readOnly, true);
});

test('what was found is counted, merged across programs, and split by scope', async t => {
  const r = await readAll(fixture(t)), w = r.world;
  assert.deepEqual(r.counts, { agents: 5, skills: 6, tools: 6, hooks: 1, notes: 6 });
  assert.deepEqual(w.scopes.map(s => [s.kind, s.name]), [['global', 'Your home folder'], ['project', 'work'], ['project', 'alpha']]);
  assert.deepEqual(w.interfaces.map(i => [i.id, i.installed]), [['claude-code', 'installed'], ['codex', 'installed'], ['opencode', 'installed']]);
  const totals = named(w, 'skill', 'Check the totals');
  assert.deepEqual(totals.foundAt.map(f => f.interface), ['claude-code', 'codex', 'opencode'], 'one skill in three programs is one item');
  assert.equal(distinctTexts(totals), 2, 'two different texts are the existing "different copies" case');
  assert.equal(named(w, 'skill', 'Write a reply').foundAt.length, 1);
  const alphaScope = w.scopes.find(s => s.name === 'alpha')!.id;
  assert.equal(named(w, 'skill', 'Check the totals', alphaScope).foundAt.length, 1, 'the same name in another scope is another item');
  assert.equal(named(w, 'tool', 'tracker').foundAt.length, 2, 'a connection of the same name in two programs is one item');
  assert.equal(distinctTexts(named(w, 'tool', 'ship')), 2);
  for (const p of w.items.flatMap(i => i.foundAt)) assert.match(p.path, /^~\/|^\//, 'a path starts at the home folder written ~');
});

test('an agent names the skills it lists and the connections its tool list mentions, with an access class read from the tool names', async t => {
  const w = (await readAll(fixture(t))).world;
  const reviewer = named(w, 'agent', 'reviewer') as AgentItem;
  assert.deepEqual(reviewer.definition.skillIds.map(id => w.items.find(i => i.id === id)!.name).sort(), ['Check the totals', 'Write a reply']);
  const tracker = named(w, 'tool', 'tracker');
  assert.deepEqual(reviewer.definition.toolAttachments, [{ toolId: tracker.id, access: 'read-only' }]);
  assert.equal(reviewer.definition.role, 'Reads a change and says what is risky.');
  assert.equal(reviewer.definition.instructions, 'You review changes.');
  assert.deepEqual(reviewer.extras.map(e => [e.badge, e.key, e.value]), [['Claude Code only', 'model', 'sonnet']]);
  const tidier = named(w, 'agent', 'tidier') as AgentItem;
  assert.deepEqual([tidier.definition.skillIds, tidier.definition.toolAttachments], [[], []], 'an agent that lists nothing is given nothing');
  const docs = named(w, 'agent', 'docs') as AgentItem;
  assert.equal(docs.foundAt[0]!.interface, 'opencode');
});

test('a secret reference keeps the name of the variable and never its value', async t => {
  const w = (await readAll(fixture(t))).world;
  const tracker = named(w, 'tool', 'tracker');
  assert.ok(tracker.kind === 'tool' && tracker.toolKind === 'mcp');
  assert.deepEqual(tracker.secret, { kind: 'env', name: 'TRACKER_API_KEY', state: 'present' });
  const hook = named(w, 'tool', 'PostToolUse: Edit|Write');
  assert.ok(hook.kind === 'tool' && hook.toolKind === 'hook' && hook.runsCode === true);
});

test('no key value is anywhere in the result, and a key in the text of a skill is hidden', async t => {
  const r = await readAll(fixture(t));
  const all = JSON.stringify(r);
  assert.doesNotMatch(all, new RegExp(FAKE_SECRET));
  assert.doesNotMatch(all, new RegExp(FAKE_TOKEN_IN_TEXT));
  assert.match(all, /\[hidden key\]/);
  assert.doesNotMatch(all, /someone@example|format\.sh|\/usr\/local\/bin|--token|--key/, 'no login, no command line, no argument');
});

test('programs the world has no room for are listed apart, with a name and a hint only', async t => {
  const r = await readAll(fixture(t));
  assert.deepEqual(r.others.map(o => `${o.app}:${o.kind}:${o.name}`).sort(), ['Hermes:agent:pixel', 'Hermes:mcp:files', 'Hermes:skill:tidy-up']);
  for (const o of r.others) assert.deepEqual(Object.keys(o).sort(), ['app', 'hint', 'kind', 'name', 'place']);
  assert.equal(r.world.items.some(i => i.name === 'tidy-up'), false);
});

test('with foldExtraApps the other programs enter the world under their own names, and the world is valid with them', async t => {
  const r = await readAll(fixture(t), true);
  assert.deepEqual(r.others, []);
  const tidy = named(r.world, 'skill', 'tidy-up');
  assert.equal(tidy.foundAt[0]!.interface, 'hermes');
  assert.deepEqual(validateWorld(r.world), [], 'Hermes is a program of the world now: the world has room for it');
  assert.deepEqual(r.world.interfaces.map(i => [i.id, i.installed]), [['claude-code', 'installed'], ['codex', 'installed'], ['opencode', 'installed'], ['hermes', 'installed']]);
});

test('ids are stable between two reads, unique, and never look like a sample id', async t => {
  const f = fixture(t);
  const a = await readAll(f), b = await readAll(f);
  assert.deepEqual(a.world.items.map(i => i.id), b.world.items.map(i => i.id));
  assert.deepEqual(a.world.wikiPages.map(p => p.id), b.world.wikiPages.map(p => p.id));
  const ids = [...a.world.items.map(i => i.id), ...a.world.slices.map(s => s.id), ...a.world.scopes.filter(s => s.kind === 'project').map(s => s.id)];
  assert.equal(new Set(ids).size, ids.length);
  for (const id of a.world.items.map(i => i.id).filter(id => !id.startsWith('item-'))) assert.match(id, /^real-(skill|agent|tool)-[0-9a-f]{16}(-\d+)?$/);
  assert.ok(ids.every(id => id.startsWith('real-') || id.startsWith('item-real-') || id.startsWith('scope-real-')), 'every id this reader made says so');
});

test('notes become pages with a title, a folder and tags, and sets of notes follow the places', async t => {
  const r = await readAll(fixture(t)), w = r.world;
  const plan = w.wikiPages.find(p => p.title === 'Alpha plan')!;
  assert.deepEqual([plan.folder, plan.tags, plan.type, plan.summary], ['alpha/notes', ['alpha', 'planning'], 'note', 'The plan for alpha.']);
  assert.ok(w.wikiPages.every(p => p.links.length === 0 && p.bytes > 0));
  assert.deepEqual(w.slices.map(s => s.name).sort(), ['Hermes at home notes', 'alpha notes', 'work notes']);
  const sets = w.items.filter(i => i.kind === 'context-slice');
  assert.equal(sets.length, w.slices.length);
  assert.doesNotMatch(JSON.stringify(w.wikiPages), /More text/, 'the page text is not kept, only the title and a short summary');
});

test('the age of each file is whole days before the time of the read, and never negative', async t => {
  const f = fixture(t);
  const when = new Date(Date.UTC(2026, 9, 21, 12));
  utimesSync(join(f.home, '.claude', 'agents', 'tidier.md'), when, when);
  const r = await readAll(f, false, when.getTime() + 5.5 * 86_400_000);
  const tidier = named(r.world, 'agent', 'tidier');
  assert.deepEqual(r.ages[tidier.id], [5]);
  const future = await readAll(f, false, when.getTime() - 86_400_000);
  assert.deepEqual(future.ages[tidier.id], [0]);
  for (const item of r.world.items.filter(i => i.kind !== 'context-slice')) assert.equal(r.ages[item.id]!.length, item.foundAt.length);
});

test('the result says what could not be read, in plain words', async t => {
  const r = await readAll(fixture(t));
  assert.ok(r.couldNotRead >= 4);
  assert.match(r.notes.join(' '), /Could not read \d+ things\./);
  assert.equal(r.partlyRead, 1);
  assert.match(r.notes.join(' '), /1 file has a header that could not be fully understood/);
});

test('an empty read gives a valid world with the home scope and nothing else', () => {
  const r = buildRealResult([], newTally(), { nowMs: NOW });
  assert.deepEqual(validateWorld(r.world), []);
  assert.deepEqual([r.counts, r.world.items, r.others], [{ agents: 0, skills: 0, tools: 0, hooks: 0, notes: 0 }, [], []]);
});
