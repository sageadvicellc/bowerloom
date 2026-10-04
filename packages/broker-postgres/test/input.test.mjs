import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresBrokerStore } from '../../../dist/packages/broker-postgres/src/index.js';
import { state } from './fixtures.mjs';

const forbiddenPool = { connect() { throw new Error('Invalid input reached the pool'); } };
const store = new PostgresBrokerStore(forbiddenPool, { schema: 'trellis_unit_test' });
test('schema and scope inputs fail before database access', async () => {
  for (const schema of ['public', 'trellis_x;DROP SCHEMA public', 'trellis_"', '', 'trellis_' + 'x'.repeat(60)]) {
    assert.throws(() => new PostgresBrokerStore(forbiddenPool, { schema }), { code: 'INVALID_SCHEMA' });
  }
  for (const scope of [null, {}, { ...state().scope, surprise: true }, { ...state().scope, runId: '__proto__' }]) {
    await assert.rejects(store.read(scope), { code: 'INVALID_SCOPE' });
    await assert.rejects(store.transaction(scope, () => {}), { code: 'INVALID_SCOPE' });
  }
});
test('seed rejects malformed and lossy state before database access', async () => {
  const changes = [
    s => { s.surprise = true; }, s => { s.ownerEpoch = NaN; }, s => { s.cancelRequested = 'false'; },
    s => { s.task.approval = 'maybe'; }, s => { s.task.effects[0].path = '../escape'; },
    s => { s.scope.taskId = 'other'; }, s => { s.actions['bad'] = {}; },
    s => { s.ownerSubject = '\0'; }, s => { s.ownerSubject = '\ud800'; },
    s => { s.ownerEpoch = 1n; }, s => { s.extra = undefined; }, s => { s.extra = s; },
    s => { s.extra = new Date(); }, s => { s[Symbol('hidden')] = 1; },
    s => { Object.defineProperty(s, 'ownerSubject', { get() { throw new Error('Getter invoked'); }, enumerable: true }); },
  ];
  for (const change of changes) { const s = state(); change(s); await assert.rejects(store.seed(s), { code: 'INVALID_STATE' }); }
});
