// The one call the Memory explorer added to the bowerloomModules bridge, `listModuleFiles`, and its own golden file. The golden file of lane 2 (module-calls.json) is not changed by it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_API_CALLS, LOCAL_CALLS, MODULE_CALLS, MODULE_CALL_REFUSAL_CODES, MODULE_LIST_CALLS, READER_API_CALLS, RUN_CALLS, callSpec, moduleCallSpec } from '../../../dist/packages/engine-api/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(here, '..', 'golden', name), 'utf8'));
const plain = list => list.map(c => ({ name: c.name, arity: c.arity, optionalArgs: c.optionalArgs, channel: c.channel, returns: c.returns }));

test('the list holds one call on the bowerloom-modules channel with plain data, frozen', () => {
  assert.deepEqual(MODULE_LIST_CALLS.map(c => [c.name, c.arity, c.channel, c.returns, c.optionalArgs]), [['listModuleFiles', 2, 'bowerloom-modules:listModuleFiles', 'plain', 0]]);
  assert.ok(Object.isFrozen(MODULE_LIST_CALLS)); assert.ok(Object.isFrozen(MODULE_LIST_CALLS[0]));
  assert.throws(() => { MODULE_LIST_CALLS.push({}); }, TypeError);
});

test('its name and channel are in no other list, and the base stays frozen: 39 engine calls and 3 reader calls', () => {
  const others = [...ENGINE_API_CALLS, ...READER_API_CALLS, ...LOCAL_CALLS, ...RUN_CALLS, ...MODULE_CALLS];
  for (const c of MODULE_LIST_CALLS) { assert.ok(!others.some(o => o.name === c.name), c.name); assert.ok(!others.some(o => o.channel === c.channel), c.channel); assert.equal(callSpec(c.name), undefined); }
  assert.equal(ENGINE_API_CALLS.length, 39); assert.equal(READER_API_CALLS.length, 3); assert.equal(MODULE_CALLS.length, 4);
});

test('its golden file equals the contract, and its refusal codes are codes of the modules calls', () => {
  const golden = read('module-list-calls.json');
  assert.equal(golden.format, 'bowerloom/engine-api-module-list-golden/v1');
  assert.equal(golden.bridge, 'bowerloomModules');
  assert.deepEqual(golden.moduleListCalls, plain(MODULE_LIST_CALLS));
  for (const code of golden.moduleListCallRefusals) assert.ok(MODULE_CALL_REFUSAL_CODES.includes(code), code);
});

test('the golden file of lane 2 is unchanged: four calls, and the base golden file is the only base file', () => {
  const golden = read('module-calls.json');
  assert.deepEqual(golden.moduleCalls.map(c => c.name), ['listModulePlaces', 'approveModulePlace', 'revokeModulePlace', 'readModuleFile']);
  assert.deepEqual(golden.moduleCalls, plain(MODULE_CALLS));
  const names = fs.readdirSync(path.join(here, '..', 'golden')).sort();
  assert.deepEqual(names.filter(f => /^base-[0-9a-f]{8}\.json$/.test(f)), ['base-d4c8a478.json']);
  assert.ok(names.includes('module-list-calls.json'));
});

test('a drifted golden file fails the comparison for every field', () => {
  const golden = read('module-list-calls.json');
  const same = g => JSON.stringify(g.moduleListCalls) === JSON.stringify(plain(MODULE_LIST_CALLS));
  assert.equal(same(golden), true);
  for (const [field, change] of [['name', 'x'], ['arity', 9], ['optionalArgs', 1], ['channel', 'bowerloom-modules:x'], ['returns', 'list']]) {
    const drifted = JSON.parse(JSON.stringify(golden)); drifted.moduleListCalls[0][field] = change;
    assert.equal(same(drifted), false, field);
  }
});

test('L6: moduleCallSpec finds the list call too, and callSpec still does not', () => {
  assert.equal(moduleCallSpec('listModuleFiles')?.channel, 'bowerloom-modules:listModuleFiles');
  assert.equal(moduleCallSpec('readModuleFile')?.channel, 'bowerloom-modules:readModuleFile');
  assert.equal(callSpec('listModuleFiles'), undefined);
});
