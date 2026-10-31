// The pure parts of the card kit: the drag state machine and the drawer phases. (The avatar's colour and letters left with the avatar: agents wear a glyph tile now.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAG_START, dragCancel, dragMove, dragPress, dragRelease, idleDrag } from '../renderer/home/kit/drag.js';
import { drawerStep } from '../renderer/home/kit/drawer-phase.js';
import { saveAction } from '../renderer/home/store-actions.js';
import { createStore } from '../shared/world/store.js';
import { makeWorld } from './testworld.js';

test('a press is not a drag until the pointer has moved 6 pixels', () => {
  assert.equal(DRAG_START, 6);
  let m = dragPress('s1', 'Skill', 100, 100);
  assert.equal(m.phase, 'pressed');
  m = dragMove(m, 103, 102, null); assert.equal(m.phase, 'pressed');
  m = dragMove(m, 110, 100, null); assert.equal(m.phase, 'dragging'); assert.equal(m.x, 110);
  m = dragMove(m, 120, 100, 'agent-1'); assert.equal(m.over, 'agent-1');
});

test('releasing a click (no drag) drops nothing and misses nothing', () => {
  const r = dragRelease(dragPress('s1', 'Skill', 5, 5), null);
  assert.deepEqual({ drop: r.drop, missed: r.missed, phase: r.model.phase }, { drop: null, missed: false, phase: 'idle' });
  assert.equal(r.wasDrag, false);
});

test('releasing a drag over a target drops on it; over nothing it misses', () => {
  const dragging = dragMove(dragPress('s1', 'Skill', 0, 0), 50, 50, null);
  const hit = dragRelease(dragging, 'agent-1');
  assert.deepEqual(hit.drop, { id: 's1', target: 'agent-1' }); assert.equal(hit.missed, false); assert.equal(hit.wasDrag, true);
  const miss = dragRelease(dragging, null);
  assert.deepEqual({ drop: miss.drop, missed: miss.missed }, { drop: null, missed: true });
});

test('cancel (Escape) returns to idle without a drop, and nothing in a state is changed', () => {
  const dragging = dragMove(dragPress('s1', 'Skill', 0, 0), 50, 50, 'a');
  const before = JSON.stringify(dragging);
  assert.deepEqual(dragCancel(dragging), idleDrag);
  dragRelease(dragging, 'a'); dragMove(dragging, 90, 90, null);
  assert.equal(JSON.stringify(dragging), before);
  assert.equal(dragMove(idleDrag, 50, 50, null), idleDrag, 'moving with nothing pressed does nothing');
});

test('the drawer is closed, opens, and closes in two steps so it can slide out; with no motion it closes at once', () => {
  assert.equal(drawerStep('closed', true, true), 'open');
  assert.equal(drawerStep('open', false, true), 'closing');
  assert.equal(drawerStep('closing', false, true), 'closing');
  assert.equal(drawerStep('open', false, false), 'closed', 'no animation: closed at once');
  assert.equal(drawerStep('closing', true, true), 'open', 'opened again while closing');
  assert.equal(drawerStep('closed', false, true), 'closed');
  assert.equal(drawerStep('open', true, true), 'open');
});

test('saveAction builds the store action that writes a save point, and the store takes it', () => {
  const store = createStore(makeWorld());
  assert.deepEqual(saveAction('Saved'), { type: 'apply', label: 'Saved' });
  store.dispatch({ type: 'attachSkill', agentId: 'a2', skillId: 's1' });
  store.dispatch(saveAction('Saved'));
  assert.equal(store.getState().committed.versions.length, 1);
});
