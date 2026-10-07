import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import test, { ATTEMPTS, namesSlotCollision } from './support/lock-slot-retry.js';
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
let published = 0;
test('a collision a test swallowed still runs it again when it then fails', () => {
  if (published++ === 0) { channel(LOCK_SLOT_COLLISION_CHANNEL).publish({ port: 20000 }); throw new Error('a later, unrelated assertion'); }
});
nodeTest('each retried test ran exactly twice, within the bound', () => {
  assert.equal(thrown, 2); assert.equal(published, 2); assert.ok(ATTEMPTS >= 2 && ATTEMPTS <= 10);
});
