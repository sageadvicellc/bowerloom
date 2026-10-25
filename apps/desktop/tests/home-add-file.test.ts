// "From a shared file": what opening a file would do, in counts and names, and the store's own action that adds it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBundle } from '../shared/proto/bundle.js';
import { bundleText } from '../shared/proto/export-flow.js';
import { createStore, isDirty, reduceStore } from '../shared/proto/store.js';
import type { Bundle, World } from '../shared/proto/types.js';
import { FILE_KIND_ORDER, FILE_MAX_BYTES, addsNothing, capList, countOf, readSharedFile } from '../shared/home/add-file.js';
import { importFileAction } from '../renderer/home/store-actions.js';
import { changeCount, plainName } from '../shared/home/add-model.js';
import { addDemoWorld } from '../renderer/home/add/add-demo-world.js';
import { sharedFileSample } from '../renderer/home/add/add-sample-file.js';

test('a file with new skills and an agent says what will be added, in counts and names, with no path', () => {
  const result = readSharedFile(sharedFileSample(), addDemoWorld(), plainName);
  assert.ok(result.ok);
  const p = result.preview;
  assert.ok(p.added.length >= 3);
  assert.ok(countOf(p, 'skill') >= 2);
  assert.ok(countOf(p, 'agent') >= 1);
  assert.equal(addsNothing(p), false);
  assert.ok(p.added.every(t => t.name.trim() !== ''));
  assert.doesNotMatch(JSON.stringify(p.added), /\.bowerloom|\/sample|SKILL\.md/);
});

test('the same file opened again says everything is already here and adds nothing', () => {
  const world = addDemoWorld();
  const store = createStore(world);
  const first = readSharedFile(sharedFileSample(), store.getState().draft, plainName);
  assert.ok(first.ok);
  store.dispatch(importFileAction(first.preview.bundle));
  const second = readSharedFile(sharedFileSample(), store.getState().draft, plainName);
  assert.ok(second.ok);
  assert.equal(addsNothing(second.preview), true);
  assert.ok(second.preview.alreadyHere.length >= 1);
});

test('a file with a skill that has the same name and other text says two different copies, and keeps both', () => {
  const world = addDemoWorld();
  const bundle = buildBundle(world, ['global']);
  const changed: Bundle = { ...bundle, items: bundle.items.filter(i => i.name === 'Write a reply').map(i => (i.kind === 'skill' ? { ...i, foundAt: i.foundAt.map(f => ({ ...f, text: 'A different way to reply.', contentHash: 'x-different' })) } : i)), toolRefs: [], sliceRules: [] };
  const result = readSharedFile(bundleText(changed), world, plainName);
  assert.ok(result.ok);
  assert.deepEqual(result.preview.differentCopies, ['Write a reply']);
  assert.equal(result.preview.added.length, 1);
  assert.match(result.preview.added[0]!.name, /Write a reply/);
});

test('a tool that needs a key is counted', () => {
  const world = addDemoWorld();
  const full = buildBundle(world, ['global']);
  const bare: World = { ...world, items: world.items.filter(i => i.kind !== 'tool') };
  const result = readSharedFile(bundleText(full), bare, plainName);
  assert.ok(result.ok);
  assert.ok(result.preview.keysNeeded >= 2);
});

test('text that is not a file, a file of the wrong shape, and a file that is too large are all refused with a reason', () => {
  const world = addDemoWorld();
  assert.deepEqual(readSharedFile('not json at all', world), { ok: false, reason: 'unreadable' });
  assert.deepEqual(readSharedFile('{"items": 3}', world), { ok: false, reason: 'unreadable' });
  assert.deepEqual(readSharedFile('[]', world), { ok: false, reason: 'unreadable' });
  assert.deepEqual(readSharedFile('x'.repeat(FILE_MAX_BYTES + 1), world), { ok: false, reason: 'too-large' });
});

test('reading a file changes nothing: the world is the same object afterwards', () => {
  const world = addDemoWorld();
  const before = JSON.stringify(world);
  readSharedFile(sharedFileSample(), world, plainName);
  assert.equal(JSON.stringify(world), before);
});

test('importing a bundle adds its items to the draft as one change that can be gone back, and saves nothing', () => {
  const store = createStore(addDemoWorld());
  const result = readSharedFile(sharedFileSample(), store.getState().draft, plainName);
  assert.ok(result.ok);
  const before = store.getState();
  let told = 0;
  store.subscribe(() => { told += 1; });
  store.dispatch(importFileAction(result.preview.bundle));
  const after = store.getState();
  assert.equal(told, 1);
  assert.equal(isDirty(after), true);
  assert.equal(after.committed, before.committed);
  assert.ok(changeCount(after) >= 1);
  assert.equal(after.undoStack.length, before.undoStack.length + 1);
  assert.equal(after.draft.items.length, before.draft.items.length + result.preview.added.length);
  store.dispatch({ type: 'undo' });
  assert.equal(store.getState().draft, before.draft);
});

test('importing a bundle that adds nothing returns the very same state and tells nobody', () => {
  const store = createStore(addDemoWorld());
  const result = readSharedFile(sharedFileSample(), store.getState().draft, plainName);
  assert.ok(result.ok);
  store.dispatch(importFileAction(result.preview.bundle));
  const once = store.getState();
  let told = 0;
  store.subscribe(() => { told += 1; });
  store.dispatch(importFileAction(result.preview.bundle));
  assert.equal(store.getState(), once);
  assert.equal(told, 0);
  assert.equal(reduceStore(once, importFileAction(result.preview.bundle)), once);
});

test('what will be added is grouped by kind: skills, then agents, then tools, then notes', () => {
  const result = readSharedFile(sharedFileSample(), addDemoWorld(), plainName);
  assert.ok(result.ok);
  const order = result.preview.added.map(t => FILE_KIND_ORDER.indexOf(t.kind));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.deepEqual([...FILE_KIND_ORDER], ['skill', 'agent', 'tool', 'note']);
});

test('a long list is cut after the limit, but one leftover item is shown and never summed up as "1 more"', () => {
  assert.deepEqual(capList([1, 2, 3], 6), { shown: [1, 2, 3], more: 0 });
  assert.deepEqual(capList([1, 2, 3, 4, 5, 6, 7], 6), { shown: [1, 2, 3, 4, 5, 6, 7], more: 0 });
  assert.deepEqual(capList([1, 2, 3, 4, 5, 6, 7, 8], 6), { shown: [1, 2, 3, 4, 5, 6], more: 2 });
  assert.deepEqual(capList([], 6), { shown: [], more: 0 });
});
