// One timer at a time, and it can be cancelled: the canvas uses this for the "settling" flag after a drop, so an unmount cancels it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { timerSlot } from '../renderer/proto/timer-slot.js';
import { DESKTOP } from './support.js';

test('a timer runs once after its time', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const slot = timerSlot(); let ran = 0;
  slot.set(() => { ran += 1; }, 100);
  assert.equal(slot.pending(), true);
  t.mock.timers.tick(99); assert.equal(ran, 0);
  t.mock.timers.tick(1); assert.equal(ran, 1);
  assert.equal(slot.pending(), false);
  t.mock.timers.tick(1000); assert.equal(ran, 1);
});

test('clear cancels a timer that has not run, and a second set replaces the first', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const slot = timerSlot(); const log: string[] = [];
  slot.set(() => log.push('a'), 100); slot.clear();
  assert.equal(slot.pending(), false);
  t.mock.timers.tick(500); assert.equal(log.join(), '', 'a cleared timer never runs (an unmounted canvas)');
  slot.set(() => log.push('b'), 100); slot.set(() => log.push('c'), 100);
  t.mock.timers.tick(500); assert.equal(log.join(), 'c', 'only the newest timer runs');
  slot.clear(); slot.clear();
});

test('the canvas keeps its settle flag timer in a slot that is cleared when the canvas goes away', () => {
  const code = readFileSync(join(DESKTOP, 'renderer', 'proto', 'HarnessCanvas.tsx'), 'utf8');
  assert.doesNotMatch(code, /window\.setTimeout\(\(\) => setSettling/, 'no loose timer');
  assert.match(code, /settlingTimer\.set\(\(\) => setSettling\(false\)/);
  assert.match(code, /useEffect\(\(\) => \(\) => settlingTimer\.clear\(\), \[settlingTimer\]\)/, 'cleared on unmount');
  assert.match(code, /settlingTimer\.clear\(\); setSettling\(false\); }, \[settlingTimer\]\)/, 'a new drag cancels the old timer too');
});
