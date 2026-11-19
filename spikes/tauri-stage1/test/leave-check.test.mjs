// The Leave check of Gate 3: after the close-guard spec, the runner must see the app end. The check may be skipped only for a run that does not include that spec,
// and only on purpose. These tests hold the skip to that rule, so a leaked environment variable cannot make a full run pass without the check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPIKE } from './support.mjs';
import { LEAVE_SWITCH, SKIP_MESSAGE, decideLeaveCheck, withoutLeaveSwitch } from '../e2e/leave-check.mjs';

const FULL = [join(SPIKE, 'e2e', 'specs', '*.spec.mjs')];
const one = n => [join(SPIKE, 'e2e', 'specs', `0${n}-x.spec.mjs`)];
const GUARD = [join(SPIKE, 'e2e', 'specs', '08-close-guard.spec.mjs')];

test('L1. no switch: the check runs, for a full run and for a single spec', () => {
  assert.deepEqual(decideLeaveCheck({ env: {}, specs: FULL }), { run: true });
  assert.deepEqual(decideLeaveCheck({ env: {}, specs: one(3) }), { run: true });
});

test('L2. the leak case: the switch is set and the full spec list is run, so the run fails loudly and does not skip', () => {
  const d = decideLeaveCheck({ env: { [LEAVE_SWITCH]: 'off' }, specs: FULL });
  assert.equal(d.run, true);
  assert.match(d.error, /close-guard/);
  assert.match(d.error, new RegExp(LEAVE_SWITCH));
});

test('L3. the switch is set and the close-guard spec is named: the run fails and does not skip', () => {
  const d = decideLeaveCheck({ env: { [LEAVE_SWITCH]: 'off' }, specs: GUARD });
  assert.equal(d.run, true);
  assert.ok(d.error);
});

test('L4. the switch is set and a single spec from 1 to 7 is run: the check is skipped, with the message (7 of 7 specs)', () => {
  for (let n = 1; n <= 7; n += 1) {
    const d = decideLeaveCheck({ env: { [LEAVE_SWITCH]: 'off' }, specs: one(n) });
    assert.deepEqual(d, { run: false, message: SKIP_MESSAGE }, `spec ${n}`);
  }
  assert.equal(SKIP_MESSAGE, 'Leave check skipped');
});

test('L5. any value other than "off" does not skip', () => {
  assert.deepEqual(decideLeaveCheck({ env: { [LEAVE_SWITCH]: '1' }, specs: one(2) }), { run: true });
});

test('L6. the run script removes the switch from the environment it gives to a full run', () => {
  const env = withoutLeaveSwitch({ PATH: '/bin', [LEAVE_SWITCH]: 'off' });
  assert.equal(env.PATH, '/bin');
  assert.equal(LEAVE_SWITCH in env, false);
});

test('L7. scripts/e2e-runs.mjs uses it, and the config uses the decision (the wiring)', () => {
  assert.match(readFileSync(join(SPIKE, 'scripts', 'e2e-runs.mjs'), 'utf8'), /withoutLeaveSwitch\(process\.env\)/);
  assert.match(readFileSync(join(SPIKE, 'e2e', 'wdio.conf.mjs'), 'utf8'), /decideLeaveCheck\(/);
});
