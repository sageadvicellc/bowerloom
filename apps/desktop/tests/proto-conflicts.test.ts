// One implementation of conflicts for the Setup review and the Harness inspector: the same item gets the same copies, the same first names and the same sentences.
import test from 'node:test';
import assert from 'node:assert/strict';
import { conflictCopies, defaultCopyNames, distinctTexts, keepBothProblem } from '../shared/proto/conflicts.js';
import { buildScan } from '../shared/proto/scan-places.js';
import { buildReview } from '../shared/proto/scan-review.js';
import { CASE_IDS, generateWorld } from '../shared/proto/sample.js';
import type { HarnessItem } from '../shared/proto/types.js';

const world = generateWorld(1);
const item = world.items.find(i => i.id === CASE_IDS.tripleSkill)!;
const every = buildScan(world).map(p => p.id);

test('the review and the inspector see the same copies and the same first names', () => {
  const review = buildReview(world, every).conflicts[0]!;
  assert.deepEqual(review.variants, conflictCopies(item));
  assert.deepEqual(review.defaultNames, defaultCopyNames(item));
  assert.deepEqual(defaultCopyNames(item), [item.name, `${item.name} (Codex)`, `${item.name} (OpenCode)`]);
  assert.equal(distinctTexts(item), 3);
});

test('a place filter limits the copies, and fewer than two texts is no conflict', () => {
  assert.equal(conflictCopies(item, f => f.interface !== 'codex').length, 2);
  assert.deepEqual(conflictCopies(item, f => f.interface === 'codex'), []);
  const plain = world.items.find(i => i.id === 'skill-010')!;
  assert.deepEqual(conflictCopies(plain), []);
  assert.equal(distinctTexts(plain), 1);
});

test('one set of sentences for every way keep-both can fail', () => {
  const names = defaultCopyNames(item);
  assert.equal(keepBothProblem(world, item.id, names), null);
  assert.equal(keepBothProblem(world, 'nope', names), 'This item is not here any more.');
  assert.equal(keepBothProblem(world, 'skill-010', ['a', 'b']), 'This item has only one text, so there is no conflict to resolve.');
  assert.equal(keepBothProblem(world, item.id, ['a', 'b']), 'Give each of the 3 copies a name.');
  assert.equal(keepBothProblem(world, item.id, ['a', ' ', 'c']), 'Every copy needs a name.');
  assert.equal(keepBothProblem(world, item.id, ['a', 'a ', 'c']), 'Each copy needs its own name.');
  const other = world.items.find((i: HarnessItem) => i.kind === item.kind && i.scopeId === item.scopeId && i.id !== item.id)!;
  assert.equal(keepBothProblem(world, item.id, ['a', other.name, 'c']), `The name "${other.name}" is already used by another skill in this harness. Pick another name.`);
  assert.equal(keepBothProblem(world, item.id, [item.name, 'b', 'c']), null, "the item's own name is free for one of its copies");
});
