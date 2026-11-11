// The runs calls of the contract (the bowerloomRuns bridge) and their golden file. They sit beside the frozen base: the 39 engine calls, the 3 reader calls, the local calls
// and their golden files do not change, and the runs list shares no name and no channel with any of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENGINE_API_CALLS, ENGINE_CODE_FORMAT, LOCAL_CALLS, READER_API_CALLS, RUN_CALLS, RUN_CALL_REFUSAL_CODES, callSpec, runCallSpec,
} from '../../../dist/packages/engine-api/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(fs.readFileSync(path.join(here, '..', 'golden', 'run-calls.json'), 'utf8'));
const plain = list => list.map(c => ({ name: c.name, arity: c.arity, optionalArgs: c.optionalArgs, channel: c.channel, returns: c.returns }));

test('the runs list holds five calls, each on the bowerloom-runs channel with plain data', () => {
  assert.deepEqual(RUN_CALLS.map(c => [c.name, c.arity]), [['listRuns', 0], ['recordRun', 1], ['updateRun', 2], ['readRunFigures', 1], ['startNewRunList', 0]]);
  for (const c of RUN_CALLS) {
    assert.equal(c.channel, `bowerloom-runs:${c.name}`);
    assert.equal(c.returns, 'plain');
    assert.equal(c.optionalArgs, 0);
    assert.match(c.name, /^[a-z][A-Za-z0-9]*$/);
  }
  assert.equal(new Set(RUN_CALLS.map(c => c.name)).size, RUN_CALLS.length);
  assert.equal(new Set(RUN_CALLS.map(c => c.channel)).size, RUN_CALLS.length);
});

test('the runs side shares no call name and no channel with the engine, reader or local side', () => {
  const others = [...ENGINE_API_CALLS, ...READER_API_CALLS, ...LOCAL_CALLS];
  const names = new Set(others.map(c => c.name)), channels = new Set(others.map(c => c.channel));
  for (const c of RUN_CALLS) { assert.ok(!names.has(c.name), c.name); assert.ok(!channels.has(c.channel), c.channel); }
});

test('the base stays frozen: still 39 engine calls and 3 reader calls, and callSpec does not find a runs call', () => {
  assert.equal(ENGINE_API_CALLS.length, 39);
  assert.equal(READER_API_CALLS.length, 3);
  for (const c of RUN_CALLS) assert.equal(callSpec(c.name), undefined, c.name);
});

test('the runs list, its specs and its refusal codes are frozen', () => {
  assert.ok(Object.isFrozen(RUN_CALLS)); assert.ok(Object.isFrozen(RUN_CALLS[0])); assert.ok(Object.isFrozen(RUN_CALL_REFUSAL_CODES));
  assert.throws(() => { RUN_CALLS.push({}); }, TypeError);
  assert.throws(() => { RUN_CALL_REFUSAL_CODES.push('X'); }, TypeError);
});

test('runCallSpec finds a runs call and says nothing for any other name', () => {
  assert.equal(runCallSpec('recordRun')?.channel, 'bowerloom-runs:recordRun');
  for (const name of ['folders', 'localModels', 'constructor', '__proto__', '']) assert.equal(runCallSpec(name), undefined, name);
});

test('the runs refusal codes have the format of a code and are the nine a call can return before it runs', () => {
  assert.deepEqual([...RUN_CALL_REFUSAL_CODES], ['NOT_ALLOWED', 'BAD_ARGUMENT', 'UNKNOWN_FOLDER', 'UNKNOWN_RUN', 'RUN_LIMIT', 'STORE_DAMAGED', 'TOO_LONG', 'FOLDER_CHARACTER', 'FOLDER_LINK']);
  for (const code of RUN_CALL_REFUSAL_CODES) assert.match(code, ENGINE_CODE_FORMAT);
});

test('the runs golden file is well formed and equals the contract, call for call and code for code', () => {
  assert.equal(golden.format, 'bowerloom/engine-api-runs-golden/v1');
  assert.equal(golden.bridge, 'bowerloomRuns');
  assert.equal(golden.channelPrefix, 'bowerloom-runs:');
  assert.ok(golden.runCalls.length > 0);
  assert.deepEqual(golden.runCalls, plain(RUN_CALLS));
  assert.deepEqual(golden.runCallRefusals, [...RUN_CALL_REFUSAL_CODES]);
});

test('the runs golden file is not a base golden file, and the base and local golden files are untouched', () => {
  const names = fs.readdirSync(path.join(here, '..', 'golden')).sort();
  assert.deepEqual(names, ['base-d4c8a478.json', 'local-calls.json', 'run-calls.json']);
  assert.deepEqual(names.filter(f => /^base-[0-9a-f]{8}\.json$/.test(f)), ['base-d4c8a478.json']);
});

test('a drifted golden file fails the comparison with the code, for every field of every call and for the refusal codes', () => {
  const same = (g) => JSON.stringify(g.runCalls) === JSON.stringify(plain(RUN_CALLS)) && JSON.stringify(g.runCallRefusals) === JSON.stringify([...RUN_CALL_REFUSAL_CODES]);
  assert.equal(same(golden), true, 'the real golden file matches');
  for (let i = 0; i < golden.runCalls.length; i += 1) {
    for (const [field, change] of [['name', 'x'], ['arity', 9], ['optionalArgs', 1], ['channel', 'bowerloom-runs:x'], ['returns', 'list']]) {
      const drifted = JSON.parse(JSON.stringify(golden)); drifted.runCalls[i][field] = change;
      assert.equal(same(drifted), false, `${golden.runCalls[i].name}.${field}`);
    }
  }
  const fewer = JSON.parse(JSON.stringify(golden)); fewer.runCalls.pop();
  assert.equal(same(fewer), false, 'a call missing from the golden file');
  const codes = JSON.parse(JSON.stringify(golden)); codes.runCallRefusals.pop();
  assert.equal(same(codes), false, 'a refusal code missing from the golden file');
});
