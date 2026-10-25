// The connect line: its path leaves the card on the side that faces the agent and arrives on the side that faces the card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LINE_HOLD_MS, connectPath } from '../shared/home/add-line.js';
import { FILE_IDLE, stepAfterAdd, stepFromResult } from '../shared/home/add-file.js';
import type { SharedFilePreview } from '../shared/home/add-file.js';

const box = (x: number, y: number, w = 100, h = 60) => ({ x, y, w, h });

test('an agent to the left of the card: the line leaves the left edge and arrives at the right edge of the agent', () => {
  const { start, end, d } = connectPath(box(500, 100), box(100, 300));
  assert.deepEqual(start, { x: 500, y: 130 });
  assert.deepEqual(end, { x: 200, y: 330 });
  assert.match(d, /^M 500 130 C /);
  assert.match(d, / 200 330$/);
});

test('an agent to the right of the card: the line leaves the right edge and arrives at the left edge', () => {
  const { start, end } = connectPath(box(100, 100), box(400, 100));
  assert.deepEqual(start, { x: 200, y: 130 });
  assert.deepEqual(end, { x: 400, y: 130 });
});

test('an agent above or below the card, in the same column, joins top to bottom or bottom to top', () => {
  const above = connectPath(box(100, 300), box(100, 50));
  assert.deepEqual(above.start, { x: 150, y: 300 });
  assert.deepEqual(above.end, { x: 150, y: 110 });
  const below = connectPath(box(100, 50), box(100, 300));
  assert.deepEqual(below.start, { x: 150, y: 110 });
  assert.deepEqual(below.end, { x: 150, y: 300 });
});

test('the path is always finite numbers and the hold time is about a second', () => {
  for (const [a, b] of [[box(0, 0), box(0, 0)], [box(10, 10, 0, 0), box(10, 10, 0, 0)], [box(-50, -50), box(900, 700)]] as const) assert.doesNotMatch(connectPath(a, b).d, /NaN|Infinity/);
  assert.ok(LINE_HOLD_MS >= 800 && LINE_HOLD_MS <= 1500);
});

test('the file tab steps: a good read shows a preview, a bad read shows why, adding finishes, other steps stay', () => {
  const preview = { bundle: { scopeIds: [], items: [], toolRefs: [], sliceRules: [] }, added: [{ kind: 'skill', name: 'A' }, { kind: 'agent', name: 'B' }], alreadyHere: [], differentCopies: [], keysNeeded: 0, missing: 0, empty: false } as const satisfies SharedFilePreview;
  const shown = stepFromResult({ ok: true, preview });
  assert.equal(shown.step, 'preview');
  assert.deepEqual(stepAfterAdd(shown), { step: 'done', count: 2 });
  assert.deepEqual(stepFromResult({ ok: false, reason: 'too-large' }), { step: 'failed', reason: 'too-large' });
  assert.equal(stepAfterAdd(FILE_IDLE), FILE_IDLE);
});
