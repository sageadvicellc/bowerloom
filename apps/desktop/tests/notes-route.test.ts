// The notes step of the first run has its own address, with no navigation, on either launch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REAL_BASE, formatRoute, isFirstRun, navKeyOf, parseRoute } from '../shared/harness/route.js';

test('the notes step is a first-run screen with its own address, both ways, in either launch', () => {
  assert.equal(formatRoute({ name: 'notes' }), '#sample/notes');
  assert.equal(formatRoute({ name: 'notes' }, REAL_BASE), '#app/notes');
  assert.deepEqual(parseRoute('#sample/notes'), { name: 'notes' });
  assert.deepEqual(parseRoute('#app/notes'), { name: 'notes' });
  assert.equal(isFirstRun({ name: 'notes' }), true);
  assert.equal(navKeyOf({ name: 'notes' }), null);
});
