// The contract on its own: its lists are well formed and agree with each other. The comparison with the real lists lives in apps/desktop/tests (engine-api-contract.test.ts),
// because the package never imports apps/desktop.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANCELLED, ENGINE_API_CALLS, ENGINE_CALL_REFUSAL_CODES, ENGINE_CODE_FORMAT, ENGINE_MAIN_REFUSAL_CODES, NAMED_OUTCOMES, NOT_THE_PLAN_SHOWN, READER_API_CALLS,
  READER_GATE_REFUSAL_CODES, READER_REFUSAL_CODES, callSpec, engineRefusalCodes, readerRefusalCodes,
} from '../../../dist/packages/engine-api/src/index.js';

const names = list => list.map(c => c.name);

test('every call has a unique name, a whole argument count, a channel and a return kind', () => {
  for (const list of [ENGINE_API_CALLS, READER_API_CALLS]) {
    assert.ok(list.length > 0);
    assert.equal(new Set(names(list)).size, list.length, 'names are unique');
    assert.equal(new Set(list.map(c => c.channel)).size, list.length, 'channels are unique');
    for (const c of list) {
      assert.ok(Number.isInteger(c.arity) && c.arity >= 0, `${c.name} arity`);
      assert.ok(Number.isInteger(c.optionalArgs) && c.optionalArgs >= 0, `${c.name} optionalArgs`);
      assert.match(c.name, /^[a-z][A-Za-z0-9]*$/);
      assert.equal(typeof c.returns, 'string');
    }
  }
});

test('the engine side and the reader side share no call name and no channel', () => {
  const engine = new Set(names(ENGINE_API_CALLS)), reader = names(READER_API_CALLS);
  for (const name of reader) assert.ok(!engine.has(name), name);
  const channels = new Set(ENGINE_API_CALLS.map(c => c.channel));
  for (const c of READER_API_CALLS) assert.ok(!channels.has(c.channel), c.channel);
});

test('the lists are frozen, so no caller can change the contract', () => {
  for (const list of [ENGINE_API_CALLS, READER_API_CALLS, ENGINE_CALL_REFUSAL_CODES, READER_GATE_REFUSAL_CODES, READER_REFUSAL_CODES, ENGINE_MAIN_REFUSAL_CODES, NAMED_OUTCOMES]) {
    assert.ok(Object.isFrozen(list));
    assert.throws(() => { list.push('x'); }, TypeError);
  }
  assert.ok(Object.isFrozen(ENGINE_API_CALLS[0]));
});

test('the two named outcomes are the codes of their own names, and the engine side returns them', () => {
  assert.equal(NOT_THE_PLAN_SHOWN, 'NOT_THE_PLAN_SHOWN');
  assert.equal(CANCELLED, 'CANCELLED');
  assert.deepEqual([...NAMED_OUTCOMES].sort(), ['CANCELLED', 'NOT_THE_PLAN_SHOWN']);
  const engine = engineRefusalCodes();
  for (const code of NAMED_OUTCOMES) assert.ok(engine.has(code), code);
  for (const code of ENGINE_CALL_REFUSAL_CODES) assert.ok(engine.has(code), code);
  for (const code of ENGINE_MAIN_REFUSAL_CODES) assert.ok(engine.has(code), code);
});

test('the reader side returns its gate codes and its own codes, and never an outcome of the engine side', () => {
  const reader = readerRefusalCodes();
  for (const code of [...READER_GATE_REFUSAL_CODES, ...READER_REFUSAL_CODES]) assert.ok(reader.has(code), code);
  for (const code of NAMED_OUTCOMES) assert.ok(!reader.has(code), code);
});

test('every code has the format of a code', () => {
  for (const code of [...engineRefusalCodes(), ...readerRefusalCodes()]) assert.match(code, ENGINE_CODE_FORMAT);
});

test('callSpec finds a call on either side and says nothing for an unknown name', () => {
  assert.equal(callSpec('planSave')?.arity, 2);
  assert.equal(callSpec('readSelected')?.arity, 1);
  assert.equal(callSpec('chooseFolder')?.optionalArgs, 1);
  assert.equal(callSpec('constructor'), undefined);
  assert.equal(callSpec('__proto__'), undefined);
  assert.equal(callSpec(''), undefined);
});
