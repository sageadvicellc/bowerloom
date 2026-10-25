// Fixes from the three reviews of the agents-first prototype that are pure logic: a shared file's missing references, an empty file, a plain reason for a refused
// file, a hostile file that must not freeze the window, the paths that leave in a copy, and the words of the Share sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUNDLE_LIMITS, buildBundle, commitImport } from '../shared/proto/bundle.js';
import { bundleText } from '../shared/proto/export-flow.js';
import { createStore, reduceStore } from '../shared/proto/store.js';
import { LIBRARY_CATALOG } from '../shared/proto/library-catalog.js';
import type { Bundle, SkillItem, World } from '../shared/proto/types.js';
import { generateWorld } from '../shared/proto/sample.js';
import { FILE_MAX_ITEMS, readSharedFile, stageFile } from '../shared/home/add-file.js';
import { planShare } from '../shared/home/share-model.js';
import { withSampleCopies } from '../shared/home/sample-copies.js';
import { ownedAgents } from '../shared/home/cards.js';
import { SHARE_WORDS, leftOutLine } from '../renderer/home/share/share-words.js';
import { ADD_WORDS, pointsToMissing } from '../renderer/home/add/add-words.js';
import { LIMITS, assertTextBudget, bannedIn, countWords } from '../shared/home/textbudget.js';
import { importFileAction } from '../renderer/home/store-actions.js';
import { found, makeWorld, skill } from './proto-testworld.js';

const empty: Bundle = { scopeIds: [], items: [], toolRefs: [], sliceRules: [] };

// ---- Item 6: what a shared file points to and does not hold.
test('a file whose agent uses a skill that is nowhere says how many things are not here (review item 6)', () => {
  const world = withSampleCopies(generateWorld(1));
  const a = ownedAgents(world)[0]!;
  const bare: World = { ...world, items: [], slices: [] };
  const bundle: Bundle = { ...buildBundle(world, ['global']), items: buildBundle(world, ['global']).items.filter(i => i.id === a.id), toolRefs: [], sliceRules: [] };
  const result = readSharedFile(bundleText(bundle), bare);
  assert.ok(result.ok);
  const wanted = a.definition.skillIds.length + a.definition.toolAttachments.length + (a.definition.sliceId === undefined ? 0 : 1);
  assert.ok(wanted > 0);
  assert.equal(result.preview.missing, wanted, 'one for each skill, tool and set of notes the agent points to');
  const whole = readSharedFile(bundleText(buildBundle(world, world.scopes.map(s => s.id))), bare);
  assert.ok(whole.ok);
  assert.equal(whole.preview.missing, 0, 'a whole file points to nothing that is missing');
});

test('a copy says how many ready-made things travel only as a name (review item 6)', () => {
  const world = withSampleCopies(generateWorld(1));
  const withLibrary = reduceStore(createStore(world).getState(), { type: 'addLibrary', libraryId: LIBRARY_CATALOG[0]!.id }).draft;
  const library = withLibrary.items.find(i => i.kind === 'skill' && i.library !== null);
  assert.ok(library !== undefined, 'a ready-made skill is there once a library is added');
  const a = ownedAgents(world)[0]!;
  const used: World = { ...withLibrary, items: withLibrary.items.map(i => (i.id === a.id && i.kind === 'agent' ? { ...i, definition: { ...i.definition, skillIds: [...i.definition.skillIds, library.id] } } : i)) };
  assert.equal(planShare(world, [a.id], []).readyMade, 0);
  assert.equal(planShare(used, [a.id], []).readyMade, 1);
  assert.equal(planShare(used, [a.id], [a.id]).readyMade, 0, 'an agent that is left out brings nothing along');
  assert.equal(leftOutLine(2, 0, 3), 'Left out: 2 passwords and keys and 3 ready-made items');
  assert.equal(leftOutLine(0, 0, 1), 'Left out: 1 ready-made item');
  assert.equal(leftOutLine(2, 1, 1), 'Left out: 2 passwords and keys, 1 agent and 1 ready-made item');
  assert.equal(leftOutLine(2, 0), 'Left out: 2 passwords and keys');
});

// ---- Item 7: an empty file, and a plain reason for a refused one.
test('a valid file with nothing in it is an empty file, not "everything is already here" (review item 7)', () => {
  const result = readSharedFile(bundleText(empty), makeWorld());
  assert.ok(result.ok);
  assert.equal(result.preview.empty, true);
  assert.equal(result.preview.added.length, 0);
  const again = readSharedFile(bundleText(buildBundle(makeWorld(), ['global'])), makeWorld());
  assert.ok(again.ok);
  assert.equal(again.preview.empty, false, 'a file whose parts are all here is not empty');
});

test('a file that is nested too deeply, shares an id, or holds too many things says so (review item 7)', () => {
  const world = makeWorld();
  let deep: unknown = 1;
  for (let i = 0; i < 12; i += 1) deep = { a: deep };
  assert.deepEqual(readSharedFile(JSON.stringify({ ...empty, deep }), world), { ok: false, reason: 'too-deep' });
  const one = buildBundle(world, ['global']).items[0]!;
  assert.deepEqual(readSharedFile(bundleText({ ...empty, items: [one, one] }), world), { ok: false, reason: 'same-id' });
  const many = Array.from({ length: FILE_MAX_ITEMS + 1 }, (_, i): SkillItem => ({ ...skill(`k${i}`, `Skill ${i}`), foundAt: [] }));
  assert.deepEqual(readSharedFile(bundleText({ ...empty, items: many }), world), { ok: false, reason: 'too-many' });
  assert.deepEqual(readSharedFile('not json at all', world), { ok: false, reason: 'unreadable' });
});

test('the words for each reason are plain and within the rules (review item 7)', () => {
  const h = ADD_WORDS.hint;
  for (const text of [h.fileEmpty, h.fileTooMany, h.fileTooDeep, h.fileSameId, h.firstFileOnly, pointsToMissing(1), pointsToMissing(5)]) {
    assert.ok(countWords(text) <= LIMITS.hint, text);
    assert.equal(bannedIn(text), null, text);
    assert.deepEqual(assertTextBudget(`<p>${text}</p>`), [], text);
  }
  assert.equal(pointsToMissing(1), '1 thing this file points to is not here.');
  assert.equal(pointsToMissing(4), '4 things this file points to are not here.');
  assert.equal(h.fileEmpty, 'There is nothing in this file.');
});

// ---- Item 8: a hostile file must not freeze the window.
function hostile(n: number): Bundle {
  const filler = 'x'.repeat(700);
  const items = Array.from({ length: n }, (_, i): SkillItem => ({ id: `h${i}`, kind: 'skill', name: 'Same name', scopeId: 'global', description: 'd', library: null, foundAt: [found('claude-code', 'a/SKILL.md', `${filler}${i}`, `hash-${i}`)] }));
  return { ...empty, items };
}

test('a file of 2000 skills with one name is landed fast, not in quadratic time (review item 8)', () => {
  const bundle = hostile(BUNDLE_LIMITS.items);
  assert.ok(bundleText(bundle).length < BUNDLE_LIMITS.textBytes, 'the file is under the size cap');
  const started = Date.now();
  const landed = commitImport(bundle, makeWorld());
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
  assert.equal(landed.items.filter(i => i.kind === 'skill' && i.name.startsWith('Same name')).length, BUNDLE_LIMITS.items);
});

test('the same file opened by a person is refused at once, with a plain reason (review item 8)', () => {
  const text = bundleText(hostile(BUNDLE_LIMITS.items));
  const started = Date.now();
  assert.deepEqual(readSharedFile(text, makeWorld()), { ok: false, reason: 'too-many' });
  assert.ok(Date.now() - started < 1000);
  assert.ok(FILE_MAX_ITEMS <= 200);
});

test('a file the person opens is landed once for the preview and once to add it, and the second is not worked out again (review item 8)', () => {
  const world = makeWorld();
  const items = Array.from({ length: FILE_MAX_ITEMS }, (_, i): SkillItem => ({ id: `m${i}`, kind: 'skill', name: 'Same name', scopeId: 'global', description: 'd', library: null, foundAt: [found('claude-code', 'a/SKILL.md', `${'y'.repeat(700)}${i}`, `m-${i}`)] }));
  const result = readSharedFile(bundleText({ ...empty, items }), world);
  assert.ok(result.ok);
  const store = createStore(world);
  const started = Date.now();
  store.dispatch(importFileAction(result.preview.bundle));
  assert.ok(Date.now() - started < 500);
  assert.equal(store.getState().draft.items.length, world.items.length + FILE_MAX_ITEMS);
});

// ---- Item 10: paths that leave in a copy.
test('a path outside its scope keeps only its last two segments, whatever its start (review item 10)', () => {
  const places = ['/Volumes/Clients/Acme/.claude/skills/Away/SKILL.md', '/root/work/Acme/Away/SKILL.md', '/opt/acme/team/Away/SKILL.md', 'D:\\Clients\\Acme\\Away\\SKILL.md',
    '\\\\fileserver\\share\\Acme\\Away\\SKILL.md', '/Users/jane/Clients/Acme/Away/SKILL.md', '/home/jane/Clients/Acme/Away/SKILL.md', 'C:\\Users\\jane\\Clients\\Acme\\Away\\SKILL.md'];
  const w: World = { ...makeWorld(), items: [{ ...skill('s1', 'Away'), foundAt: places.map(p => found('claude-code', p, 'x')) }] };
  const out = (buildBundle(w, ['global']).items[0] as SkillItem).foundAt.map(f => f.path);
  assert.deepEqual(out, places.map(() => 'Away/SKILL.md'));
  for (const p of out) assert.doesNotMatch(p, /Acme|Clients|jane|fileserver|Volumes|opt|root/);
});

test('a path under its scope stays whole, and a short path outside it is not cut further (review item 10)', () => {
  const w: World = { ...makeWorld(), items: [{ ...skill('s1', 'Away'), foundAt: [found('claude-code', '/sample/harness/.claude/skills/Away/SKILL.md', 'x'), found('codex', '/etc/Away.md', 'x'), found('opencode', 'D:\\SKILL.md', 'x')] }] };
  const root = w.scopes.find(s => s.id === 'global')!;
  assert.equal(root.path, '/sample/harness');
  assert.deepEqual((buildBundle(w, ['global']).items[0] as SkillItem).foundAt.map(f => f.path), ['.claude/skills/Away/SKILL.md', 'etc/Away.md', 'SKILL.md']);
});

// ---- Item 9: the Share sheet says what is true about what leaves.
test('the Share sheet does not claim that all secrets are left out; it says what is kept out and what is in (review item 9)', () => {
  const h = SHARE_WORDS.hint;
  assert.equal(h.secretsOut, 'Passwords and keys that Bowerloom keeps are left out.');
  assert.equal(h.textIn, 'Your own text is included, so read it first.');
  for (const text of [h.secretsOut, h.textIn, h.readyMadeOut]) { assert.ok(countWords(text) <= LIMITS.hint, text); assert.equal(bannedIn(text), null, text); }
  assert.doesNotMatch(Object.values(h).join(' '), /Secrets are left out/);
});

// ---- Item 15: "Added" is said only when the draft really changed.
test('adding a file changes the draft only when it adds something (review item 15)', () => {
  const world = makeWorld();
  const store = createStore(world);
  const bundle = buildBundle(makeWorld(), ['global']);
  assert.equal(stageFile(store.getState(), bundle).changed, false, 'everything in the file is already here');
  const bare: World = { ...world, items: [], slices: [] };
  const fresh = createStore(bare);
  const staged = stageFile(fresh.getState(), bundle);
  assert.equal(staged.changed, true);
  fresh.dispatch(staged.action);
  assert.equal(stageFile(fresh.getState(), bundle).changed, false, 'the second time nothing is added');
  assert.equal(stageFile(fresh.getState(), empty).changed, false);
});
