import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import test, { ATTEMPTS, namesSlotCollision, retrying } from './support/lock-slot-retry.js';
import { LOCK_SLOT_COLLISION_CHANNEL } from '../packages/project-context/src/index.js';

nodeTest('a lock slot collision is recognized in a code, a message, a wrapped assertion and child output only', () => {
  assert.equal(namesSlotCollision(Object.assign(new Error('x'), { code: 'MANAGED_SKILL_LOCK_SLOT_COLLISION' })), true);
  assert.equal(namesSlotCollision(new Error('REVISION_LOCK_SLOT_COLLISION (local port 20001)')), true);
  assert.equal(namesSlotCollision({ actual: { code: 'PROJECT_LOCK_SLOT_COLLISION' } }), true);
  assert.equal(namesSlotCollision({ message: '{"error":{"code":"REVISION_LOCK_SLOT_COLLISION"}}' }), true);
  for (const other of [null, undefined, 0, 'LOCKED', new Error('MANAGED_SKILL_LOCKED'), { code: 'PROJECT_LOCKED' }, { actual: { code: 'REVISION_LOCK_UNAVAILABLE' } }]) assert.equal(namesSlotCollision(other), false);
});

let thrown = 0;
test('a test that meets a collision runs again from the start', () => {
  if (thrown++ === 0) throw Object.assign(new Error('collision'), { code: 'MANAGED_SKILL_LOCK_SLOT_COLLISION' });
});
nodeTest('each retried test ran exactly twice, within the bound', () => {
  assert.equal(thrown, 2); assert.ok(ATTEMPTS >= 2 && ATTEMPTS <= 10);
});
nodeTest('only a thrown error that names a collision is retried: a collision published during a run that then fails otherwise is not', async t => {
  let runs = 0;
  await assert.rejects(retrying(t, () => { runs++; channel(LOCK_SLOT_COLLISION_CHANNEL).publish({ port: 20000 }); throw new Error('a later, unrelated assertion'); }), /unrelated/);
  assert.equal(runs, 1);
  runs = 0;
  await assert.rejects(retrying(t, () => { runs++; throw Object.assign(new Error('x'), { code: 'PROJECT_LOCK_SLOT_COLLISION' }); }), (e: { code?: string }) => e.code === 'PROJECT_LOCK_SLOT_COLLISION');
  assert.equal(runs, ATTEMPTS, 'a collision every time fails after the bound');
  runs = 0; await retrying(t, () => { runs++; }); assert.equal(runs, 1);
});
