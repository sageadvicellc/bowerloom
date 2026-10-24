// The scan, step two and the review: what was found in the ticked places, and the conflicts inside them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScan } from '../shared/proto/scan-places.js';
import { buildReview } from '../shared/proto/scan-review.js';
import { keepBothProblem } from '../shared/proto/conflicts.js';
import { CASE_IDS, generateWorld } from '../shared/proto/sample.js';
import { reduceStore } from '../shared/proto/store.js';
import type { StoreState } from '../shared/proto/store.js';
import { createEmptyWorld } from '../renderer/proto/fakeApi.js';
import { copy } from './proto-testworld.js';

const world = generateWorld(1);
const scan = buildScan(world);
const all = scan.map(p => p.id);
const only = (...paths: string[]): string[] => paths.map(p => scan.find(s => s.path === p)!.id);

test('with nothing ticked the review is empty', () => {
  const r = buildReview(world, []);
  assert.equal(r.itemCount, 0);
  assert.deepEqual([r.skills, r.agents, r.tools, r.libraryTotal], [0, 0, 0, 0]);
  assert.deepEqual([r.hooks, r.needsSecret, r.conflicts, r.libraryItems], [[], [], [], []]);
});

test('only the ticked places are counted', () => {
  const claude = buildReview(world, only('/Users/sample/Studio/.claude'));
  const both = buildReview(world, only('/Users/sample/Studio/.claude', '/Users/sample/Studio/.codex'));
  assert.ok(claude.skills > 0 && both.skills > claude.skills);
  assert.equal(claude.conflicts.length, 0, 'one tool alone holds one text');
  assert.equal(both.conflicts.length, 1, 'two tools hold two texts');
  const everything = buildReview(world, all);
  // Every owned item that was found anywhere is counted once.
  const owned = world.items.filter(i => i.library === null && i.foundAt.length > 0);
  assert.equal(everything.skills, owned.filter(i => i.kind === 'skill').length);
  assert.equal(everything.agents, owned.filter(i => i.kind === 'agent').length);
  assert.equal(everything.tools, owned.filter(i => i.kind === 'tool').length);
  assert.equal(everything.itemCount, owned.length + 120);
});

test('library items are kept as a reference, apart from the owned counts', () => {
  const r = buildReview(world, all);
  assert.equal(r.libraryTotal, 120);
  assert.equal(r.agents, world.items.filter(i => i.kind === 'agent' && i.library === null).length);
  assert.deepEqual(r.libraryItems.map(l => [l.name, l.version, l.total]), [['Evergreen Kit', '2.3.0', 120]]);
  assert.equal(buildReview(world, only('/Users/sample/Studio/.claude')).libraryTotal, 0);
});

test('hooks are listed, and an MCP server with a missing secret is listed under needs a secret', () => {
  const r = buildReview(world, all);
  assert.ok(r.hooks.some(h => h.id === CASE_IDS.hook));
  assert.equal(r.hooks.length, 3);
  assert.deepEqual(r.needsSecret.map(s => s.id), [CASE_IDS.mcpMissing]);
  assert.deepEqual([r.needsSecret[0]!.secretKind, r.needsSecret[0]!.secretName], ['env', 'LANTERN_TOKEN']);
  assert.equal(buildReview(world, only('/Users/sample/Studio/.codex')).needsSecret.length, 0, 'the server is not found there');
  assert.equal(r.mcp + r.prompts + r.hooks.length, r.tools);
});

test('a skill found in three tools with different text is one conflict with three versions', () => {
  const r = buildReview(world, all);
  assert.equal(r.conflicts.length, 1);
  const c = r.conflicts[0]!;
  assert.equal(c.itemId, CASE_IDS.tripleSkill);
  assert.equal(c.variants.length, 3);
  assert.deepEqual(c.variants.map(v => v.interfaces), [['claude-code'], ['codex'], ['opencode']]);
  assert.deepEqual(c.variants.map(v => v.index), [0, 1, 2]);
  assert.equal(c.canKeepBoth, true);
  assert.equal(c.defaultNames.length, 3);
  assert.equal(c.defaultNames[0], c.name);
  assert.equal(new Set(c.defaultNames).size, 3);
});

test('with two of three places ticked the conflict shows two versions and cannot keep both', () => {
  const r = buildReview(world, only('/Users/sample/Studio/.claude', '/Users/sample/Studio/.opencode'));
  const c = r.conflicts[0]!;
  assert.deepEqual(c.variants.map(v => v.interfaces), [['claude-code'], ['opencode']]);
  assert.equal(c.canKeepBoth, false);
  assert.ok(!JSON.stringify(c).includes(world.items.find(i => i.id === CASE_IDS.tripleSkill)!.foundAt[1]!.text), 'the unticked version is not read');
});

test('resolving through the store removes the conflict from the review', () => {
  const state: StoreState = { committed: world, draft: world, undoStack: [], redoStack: [], headVersionId: null };
  const c = buildReview(world, all).conflicts[0]!;
  const one = reduceStore(state, { type: 'resolveConflict', itemId: c.itemId, keep: c.variants[1]!.index });
  assert.equal(buildReview(one.draft, all).conflicts.length, 0);
  const both = reduceStore(state, { type: 'resolveConflict', itemId: c.itemId, keep: 'keep-both', names: c.defaultNames });
  assert.equal(buildReview(both.draft, all).conflicts.length, 0);
  assert.equal(buildReview(both.draft, all).skills, buildReview(world, all).skills + 2);
});

test('keepBothProblem names the problem in plain words, and agrees with the store', () => {
  const c = buildReview(world, all).conflicts[0]!;
  assert.equal(keepBothProblem(world, c.itemId, c.defaultNames), null);
  assert.match(keepBothProblem(world, c.itemId, ['', 'b', 'c'])!, /needs a name/i);
  assert.match(keepBothProblem(world, c.itemId, ['same', 'same', 'c'])!, /own name/i);
  assert.match(keepBothProblem(world, c.itemId, ['a', 'b'])!, /3/);
  const taken = world.items.find(i => i.kind === 'skill' && i.id !== c.itemId && i.scopeId === 'global')!.name;
  assert.match(keepBothProblem(world, c.itemId, [c.name, 'b', taken])!, /already/i);
  assert.match(keepBothProblem(world, 'nope', ['a'])!, /not/i);
});

test('the review does not change its input, and a world with nothing found gives nothing', () => {
  const before = copy(world);
  buildReview(world, all);
  assert.deepEqual(world, before);
  assert.equal(buildReview(createEmptyWorld(), ['x']).itemCount, 0);
});
