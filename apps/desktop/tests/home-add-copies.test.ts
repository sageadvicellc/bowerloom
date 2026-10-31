// "Two different copies": the copies of an item as the side-by-side view needs them, and the one store action that keeps a copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, isDirty, reduceStore } from '../shared/world/store.js';
import { itemBadge } from '../shared/home/cards.js';
import { copiesLookAlike, copiesOf, hasCopies, keepCopyAction } from '../shared/home/add-copies.js';
import { entriesFor } from '../shared/home/add-model.js';
import { generateWorld, CASE_IDS } from '../shared/world/sample.js';
import { addDemoWorld, DEMO } from '../renderer/home/add/add-demo-world.js';

const demo = () => createStore(addDemoWorld()).getState();
const itemOf = (world: ReturnType<typeof addDemoWorld>, id: string) => world.items.find(i => i.id === id)!;

test('a skill with two different texts has two copies; a skill with one text has none', () => {
  const world = addDemoWorld();
  assert.equal(hasCopies(itemOf(world, DEMO.copiesSkill)), true);
  assert.equal(hasCopies(itemOf(world, DEMO.skills[0]!)), false);
  assert.deepEqual(copiesOf(itemOf(world, DEMO.skills[0]!)), []);
});

test('the copies come in the order they were found, numbered from 1, with the tools that hold them in words', () => {
  const copies = copiesOf(itemOf(addDemoWorld(), DEMO.copiesSkill));
  assert.equal(copies.length, 2);
  assert.deepEqual(copies.map(c => c.number), [1, 2]);
  assert.equal(copies[0]!.place, 'Claude Code and OpenCode');
  assert.equal(copies[1]!.place, 'Codex');
});

test('the lines that differ are marked in both copies, and the lines they share are not', () => {
  const [a, b] = copiesOf(itemOf(addDemoWorld(), DEMO.copiesSkill)) as [ReturnType<typeof copiesOf>[number], ReturnType<typeof copiesOf>[number]];
  assert.deepEqual(a.lines.filter(l => l.changed).map(l => l.text), ['List what is still open.', 'Ask what to focus on next.']);
  assert.deepEqual(b.lines.filter(l => l.changed).map(l => l.text), ['List what is still open and who owns it.', 'Suggest three things to focus on next.', 'Keep it under one page.']);
  assert.equal(a.changed, 2);
  assert.equal(b.changed, 3);
  assert.deepEqual(a.lines.filter(l => !l.changed).map(l => l.text), ['Look at last week\'s work.', 'List what got done.']);
  assert.equal(copiesLookAlike([a, b]), false);
});

test('no copy shows a file path', () => {
  const text = JSON.stringify(copiesOf(itemOf(addDemoWorld(), DEMO.copiesSkill)));
  assert.doesNotMatch(text, /\/sample|\.claude|SKILL\.md|\.codex/);
});

test('keeping a copy is one store action: the other copy leaves the draft, the badge goes away, and the change is staged', () => {
  const state = demo();
  const copies = copiesOf(itemOf(state.draft, DEMO.copiesSkill));
  assert.equal(itemBadge(itemOf(state.draft, DEMO.copiesSkill))?.label, '2 different copies');
  const next = reduceStore(state, keepCopyAction(DEMO.copiesSkill, copies[1]!));
  const kept = itemOf(next.draft, DEMO.copiesSkill);
  assert.equal(hasCopies(kept), false);
  assert.equal(itemBadge(kept), null);
  assert.equal(isDirty(next), true);
  assert.deepEqual(kept.foundAt.map(f => f.interface), ['codex']);
  assert.equal(entriesFor(next.draft, 'skills').find(e => e.id === DEMO.copiesSkill)?.badge, undefined);
});

test('keeping the first copy keeps the two tools that hold it', () => {
  const state = demo();
  const copies = copiesOf(itemOf(state.draft, DEMO.copiesSkill));
  const kept = itemOf(reduceStore(state, keepCopyAction(DEMO.copiesSkill, copies[0]!)).draft, DEMO.copiesSkill);
  assert.deepEqual(kept.foundAt.map(f => f.interface), ['claude-code', 'opencode']);
});

test('three copies work too: the first is compared with the second, the third with the first', () => {
  const world = generateWorld(1);
  const triple = world.items.find(i => i.id === CASE_IDS.tripleSkill)!;
  const copies = copiesOf(triple);
  assert.equal(copies.length, 3);
  assert.deepEqual(copies.map(c => c.index).length, 3);
  for (const c of copies) assert.ok(c.lines.length > 0);
});

test('copies that differ only past the last line look alike, and the view can say so', () => {
  const world = addDemoWorld();
  const item = itemOf(world, DEMO.copiesSkill);
  assert.ok(item.kind === 'skill');
  const same = { ...item, foundAt: [{ ...item.foundAt[0]!, text: 'One line.' }, { ...item.foundAt[1]!, text: 'One line.\n', contentHash: 'other' }] };
  const views = copiesOf(same);
  assert.equal(views.length, 2);
  assert.equal(copiesLookAlike(views), true);
});
