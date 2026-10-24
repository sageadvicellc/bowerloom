// The setup flow as a pure reducer: which step shows, what is ticked, and what has been decided.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOW_STEPS, STEP_TITLES, folderChoices, initialSetup, nestingOf, reduceSetup, stepNumber } from '../shared/proto/setup-flow.js';
import type { SetupAction, SetupState } from '../shared/proto/setup-flow.js';
import { generateWorld } from '../shared/proto/sample.js';
import { createEmptyWorld } from '../renderer/proto/fakeApi.js';

const run = (actions: SetupAction[], from: SetupState = initialSetup()): SetupState => actions.reduce(reduceSetup, from);
const roots: SetupAction[] = [{ type: 'openPickers' }, { type: 'pickHarnessRoot', path: '/a' }, { type: 'pickKnowledgeRoot', path: '/a/k' }];

test('it starts on the welcome step with nothing chosen, nothing scanned and nothing ticked', () => {
  const s = initialSetup();
  assert.deepEqual(s, { step: 'welcome', pickersOpen: false, harnessRoot: null, knowledgeRoot: null, scanned: false, ticked: [], resolved: {}, broughtIn: false });
  assert.deepEqual(FLOW_STEPS, ['welcome', 'places', 'contents', 'review', 'bring-in', 'done']);
  for (const step of FLOW_STEPS) assert.ok(STEP_TITLES[step].length > 3, step);
});

test('the scan cannot start until both roots are chosen', () => {
  assert.equal(run([{ type: 'next' }]).step, 'welcome');
  assert.equal(run([{ type: 'openPickers' }, { type: 'pickHarnessRoot', path: '/a' }, { type: 'next' }]).step, 'welcome');
  assert.equal(run([...roots, { type: 'next' }]).step, 'places');
  assert.equal(run([{ type: 'pickHarnessRoot', path: '' }]).harnessRoot, null, 'an empty path is no choice');
});

test('step two needs a scan, step three needs a tick, and each step follows the one before', () => {
  let s = run([...roots, { type: 'next' }]);
  assert.equal(run([{ type: 'next' }], s).step, 'places', 'not scanned yet');
  s = run([{ type: 'scan' }, { type: 'next' }], s);
  assert.deepEqual([s.scanned, s.step], [true, 'contents']);
  assert.equal(run([{ type: 'next' }], s).step, 'contents', 'nothing ticked');
  s = run([{ type: 'tick', id: 'p1' }, { type: 'next' }], s);
  assert.equal(s.step, 'review');
  s = run([{ type: 'next' }], s);
  assert.equal(s.step, 'bring-in');
  s = run([{ type: 'bringIn' }], s);
  assert.deepEqual([s.step, s.broughtIn], ['done', true]);
  assert.equal(run([{ type: 'next' }, { type: 'back' }], s).step, 'done', 'done is the end');
});

test('bring in works only from the bring in step', () => {
  assert.equal(run([{ type: 'bringIn' }]).broughtIn, false);
  assert.equal(run([...roots, { type: 'next' }, { type: 'bringIn' }]).broughtIn, false);
});

test('tick toggles, select all adds each place once, select none empties', () => {
  let s = run([{ type: 'tick', id: 'a' }, { type: 'tick', id: 'b' }, { type: 'tick', id: 'a' }]);
  assert.deepEqual(s.ticked, ['b']);
  s = run([{ type: 'tickAll', ids: ['a', 'b', 'c'] }, { type: 'tickAll', ids: ['a', 'd'] }], s);
  assert.deepEqual(s.ticked, ['b', 'a', 'c', 'd']);
  assert.deepEqual(run([{ type: 'tickNone' }], s).ticked, []);
  assert.deepEqual(run([{ type: 'tick', id: '' }]).ticked, []);
});

test('back goes one step, keeps what was ticked, and stops at the welcome step', () => {
  let s = run([...roots, { type: 'next' }, { type: 'scan' }, { type: 'next' }, { type: 'tick', id: 'x' }, { type: 'next' }]);
  assert.equal(s.step, 'review');
  s = run([{ type: 'back' }], s);
  assert.deepEqual([s.step, s.ticked], ['contents', ['x']]);
  s = run([{ type: 'back' }, { type: 'back' }, { type: 'back' }], s);
  assert.equal(s.step, 'welcome');
  assert.equal(s.harnessRoot, '/a', 'the choices stay');
});

test('a resolved conflict is remembered by item and in words', () => {
  const s = run([{ type: 'resolved', itemId: 'i1', summary: 'Kept the Codex version' }, { type: 'resolved', itemId: 'i2', summary: 'Kept both' }]);
  assert.deepEqual(s.resolved, { i1: 'Kept the Codex version', i2: 'Kept both' });
  assert.deepEqual(run([{ type: 'resolved', itemId: '', summary: 'x' }]).resolved, {});
});

test('start again returns the first state, and an action that changes nothing returns the very same state', () => {
  const s = run([...roots, { type: 'next' }, { type: 'scan' }, { type: 'tick', id: 'x' }]);
  assert.deepEqual(run([{ type: 'reset' }], s), initialSetup());
  const fresh = initialSetup();
  assert.equal(reduceSetup(fresh, { type: 'next' }), fresh);
  assert.equal(reduceSetup(fresh, { type: 'back' }), fresh);
  assert.equal(reduceSetup(fresh, { type: 'tickNone' }), fresh);
});

test('the reducer does not change its input', () => {
  const s = run([...roots, { type: 'next' }]);
  const frozen = structuredClone(s);
  Object.freeze(s); Object.freeze(s.ticked); Object.freeze(s.resolved);
  reduceSetup(s, { type: 'tick', id: 'z' }); reduceSetup(s, { type: 'scan' }); reduceSetup(s, { type: 'reset' });
  assert.deepEqual(s, frozen);
});

test('step numbers run from 1 to 5, and done counts as the last', () => {
  assert.deepEqual(FLOW_STEPS.map(stepNumber), [1, 2, 3, 4, 5, 5]);
});

test('the folders offered include the world\'s harness root, and nesting is told in plain words', () => {
  const choices = folderChoices(generateWorld(1));
  assert.ok(choices.length >= 3 && choices.length <= 6);
  assert.ok(choices.includes('/Users/sample/Studio'));
  assert.ok(choices.some(c => c.startsWith('/Users/sample/Studio/')), 'a folder inside the harness root');
  assert.equal(new Set(choices).size, choices.length);
  assert.ok(folderChoices(createEmptyWorld()).length >= 3);
  assert.equal(nestingOf('/a', '/a/k'), 'knowledge-inside');
  assert.equal(nestingOf('/a/k', '/a'), 'harness-inside');
  assert.equal(nestingOf('/a', '/a'), 'same');
  assert.equal(nestingOf('/a', '/ab'), 'apart', 'a shared prefix is not nesting');
  assert.equal(nestingOf('/a/', '/a/k/'), 'knowledge-inside');
  assert.equal(nestingOf('/a', '/b'), 'apart');
});
