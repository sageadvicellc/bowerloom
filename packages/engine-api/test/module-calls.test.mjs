// The module calls of the contract (the bowerloomModules bridge) and their golden file. They sit beside the frozen base: the 39 engine calls, the 3 reader calls, the local calls, the runs calls
// and their golden files do not change, and the module list shares no name and no channel with any of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENGINE_API_CALLS, ENGINE_CODE_FORMAT, LOCAL_CALLS, MODULE_CALLS, MODULE_CALL_REFUSAL_CODES, READER_API_CALLS, RUN_CALLS, callSpec, localCallSpec, moduleCallSpec, runCallSpec,
} from '../../../dist/packages/engine-api/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(fs.readFileSync(path.join(here, '..', 'golden', 'module-calls.json'), 'utf8'));
const plain = list => list.map(c => ({ name: c.name, arity: c.arity, optionalArgs: c.optionalArgs, channel: c.channel, returns: c.returns }));

test('the module list holds four calls, each on the bowerloom-modules channel with plain data', () => {
  assert.deepEqual(MODULE_CALLS.map(c => [c.name, c.arity]), [['listModulePlaces', 1], ['approveModulePlace', 1], ['revokeModulePlace', 2], ['readModuleFile', 3]]);
  for (const c of MODULE_CALLS) {
    assert.equal(c.channel, `bowerloom-modules:${c.name}`);
    assert.equal(c.returns, 'plain');
    assert.equal(c.optionalArgs, 0);
    assert.match(c.name, /^[a-z][A-Za-z0-9]*$/);
  }
  assert.equal(new Set(MODULE_CALLS.map(c => c.name)).size, MODULE_CALLS.length);
  assert.equal(new Set(MODULE_CALLS.map(c => c.channel)).size, MODULE_CALLS.length);
});

test('the module side shares no call name and no channel with the engine, reader, local or runs side', () => {
  const others = [...ENGINE_API_CALLS, ...READER_API_CALLS, ...LOCAL_CALLS, ...RUN_CALLS];
  const names = new Set(others.map(c => c.name)), channels = new Set(others.map(c => c.channel));
  for (const c of MODULE_CALLS) { assert.ok(!names.has(c.name), c.name); assert.ok(!channels.has(c.channel), c.channel); }
});

test('the base stays frozen: still 39 engine calls and 3 reader calls, and no other lookup finds a module call', () => {
  assert.equal(ENGINE_API_CALLS.length, 39);
  assert.equal(READER_API_CALLS.length, 3);
  assert.equal(LOCAL_CALLS.length, 1);
  assert.equal(RUN_CALLS.length, 5);
  for (const c of MODULE_CALLS) { assert.equal(callSpec(c.name), undefined, c.name); assert.equal(localCallSpec(c.name), undefined, c.name); assert.equal(runCallSpec(c.name), undefined, c.name); }
});

test('the module list, its specs and its refusal codes are frozen', () => {
  assert.ok(Object.isFrozen(MODULE_CALLS)); assert.ok(Object.isFrozen(MODULE_CALLS[0])); assert.ok(Object.isFrozen(MODULE_CALL_REFUSAL_CODES));
  assert.throws(() => { MODULE_CALLS.push({}); }, TypeError);
  assert.throws(() => { MODULE_CALL_REFUSAL_CODES.push('X'); }, TypeError);
});

test('moduleCallSpec finds a module call and says nothing for any other name', () => {
  assert.equal(moduleCallSpec('readModuleFile')?.channel, 'bowerloom-modules:readModuleFile');
  for (const name of ['folders', 'localModels', 'listRuns', 'constructor', '__proto__', '']) assert.equal(moduleCallSpec(name), undefined, name);
});

test('the module refusal codes have the format of a code, are the thirteen a call can return, and none is an engine code twice', () => {
  assert.deepEqual([...MODULE_CALL_REFUSAL_CODES], ['NOT_ALLOWED', 'BAD_ARGUMENT', 'UNKNOWN_MODULE', 'NOT_APPROVED', 'PLACE_CHANGED', 'BAD_PATH', 'OUTSIDE_PLACE', 'NOT_A_FILE', 'TOO_LARGE', 'NOT_TEXT', 'UNREADABLE', 'RECORD_DAMAGED', 'RECORD_BLOCKED']);
  for (const code of MODULE_CALL_REFUSAL_CODES) assert.match(code, ENGINE_CODE_FORMAT);
  assert.equal(new Set(MODULE_CALL_REFUSAL_CODES).size, MODULE_CALL_REFUSAL_CODES.length);
});

test('the module golden file is well formed and equals the contract, call for call and code for code', () => {
  assert.equal(golden.format, 'bowerloom/engine-api-modules-golden/v1');
  assert.equal(golden.bridge, 'bowerloomModules');
  assert.equal(golden.channelPrefix, 'bowerloom-modules:');
  assert.ok(golden.moduleCalls.length > 0);
  assert.deepEqual(golden.moduleCalls, plain(MODULE_CALLS));
  assert.deepEqual(golden.moduleCallRefusals, [...MODULE_CALL_REFUSAL_CODES]);
});

test('the module golden file is not a base golden file, and the base, local and runs golden files are untouched', () => {
  const names = fs.readdirSync(path.join(here, '..', 'golden')).sort();
  assert.ok(names.includes('module-calls.json'));
  assert.deepEqual(names.filter(f => /^base-[0-9a-f]{8}\.json$/.test(f)), ['base-d4c8a478.json']);
  assert.ok(names.includes('local-calls.json') && names.includes('run-calls.json'));
});

test('a drifted golden file fails the comparison with the code, for every field of every call and for the refusal codes', () => {
  const same = g => JSON.stringify(g.moduleCalls) === JSON.stringify(plain(MODULE_CALLS)) && JSON.stringify(g.moduleCallRefusals) === JSON.stringify([...MODULE_CALL_REFUSAL_CODES]);
  assert.equal(same(golden), true, 'the real golden file matches');
  for (let i = 0; i < golden.moduleCalls.length; i += 1) {
    for (const [field, change] of [['name', 'x'], ['arity', 9], ['optionalArgs', 1], ['channel', 'bowerloom-modules:x'], ['returns', 'list']]) {
      const drifted = JSON.parse(JSON.stringify(golden)); drifted.moduleCalls[i][field] = change;
      assert.equal(same(drifted), false, `${golden.moduleCalls[i].name}.${field}`);
    }
  }
  const fewer = JSON.parse(JSON.stringify(golden)); fewer.moduleCalls.pop();
  assert.equal(same(fewer), false, 'a call missing from the golden file');
  const codes = JSON.parse(JSON.stringify(golden)); codes.moduleCallRefusals.pop();
  assert.equal(same(codes), false, 'a refusal code missing from the golden file');
});
