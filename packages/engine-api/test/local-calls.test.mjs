// The local calls of the contract (the bowerloomLocal bridge) and their golden file. They sit beside the frozen base: the 39 engine calls and 3 reader calls and
// their golden file do not change, and the local list shares no name and no channel with them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENGINE_API_CALLS, ENGINE_CODE_FORMAT, LOCAL_CALLS, LOCAL_CALL_REFUSAL_CODES, READER_API_CALLS, callSpec, engineRefusalCodes, localCallSpec, readerRefusalCodes,
} from '../../../dist/packages/engine-api/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(fs.readFileSync(path.join(here, '..', 'golden', 'local-calls.json'), 'utf8'));
const plain = list => list.map(c => ({ name: c.name, arity: c.arity, optionalArgs: c.optionalArgs, channel: c.channel, returns: c.returns }));

test('the local list holds localModels: no argument, plain data, on the bowerloom-local channel', () => {
  assert.equal(LOCAL_CALLS.length, 1);
  assert.deepEqual(plain(LOCAL_CALLS), [{ name: 'localModels', arity: 0, optionalArgs: 0, channel: 'bowerloom-local:localModels', returns: 'plain' }]);
});

test('every local call has a unique name, a whole argument count and a channel with the local prefix', () => {
  assert.equal(new Set(LOCAL_CALLS.map(c => c.name)).size, LOCAL_CALLS.length);
  assert.equal(new Set(LOCAL_CALLS.map(c => c.channel)).size, LOCAL_CALLS.length);
  for (const c of LOCAL_CALLS) {
    assert.match(c.name, /^[a-z][A-Za-z0-9]*$/);
    assert.ok(Number.isInteger(c.arity) && c.arity >= 0 && Number.isInteger(c.optionalArgs) && c.optionalArgs >= 0);
    assert.equal(c.channel, `bowerloom-local:${c.name}`);
  }
});

test('the local side shares no call name and no channel with the engine side or the reader side', () => {
  const names = new Set([...ENGINE_API_CALLS, ...READER_API_CALLS].map(c => c.name));
  const channels = new Set([...ENGINE_API_CALLS, ...READER_API_CALLS].map(c => c.channel));
  for (const c of LOCAL_CALLS) {
    assert.ok(!names.has(c.name), c.name);
    assert.ok(!channels.has(c.channel), c.channel);
  }
});

test('the base stays frozen: still 39 engine calls and 3 reader calls, and callSpec does not find a local call', () => {
  assert.equal(ENGINE_API_CALLS.length, 39);
  assert.equal(READER_API_CALLS.length, 3);
  assert.equal(callSpec('localModels'), undefined);
});

test('the local list, its specs and its refusal codes are frozen', () => {
  assert.ok(Object.isFrozen(LOCAL_CALLS));
  assert.ok(Object.isFrozen(LOCAL_CALLS[0]));
  assert.ok(Object.isFrozen(LOCAL_CALL_REFUSAL_CODES));
  assert.throws(() => { LOCAL_CALLS.push({}); }, TypeError);
  assert.throws(() => { LOCAL_CALL_REFUSAL_CODES.push('X'); }, TypeError);
});

test('localCallSpec finds a local call and says nothing for any other name', () => {
  assert.equal(localCallSpec('localModels')?.channel, 'bowerloom-local:localModels');
  assert.equal(localCallSpec('folders'), undefined);
  assert.equal(localCallSpec('constructor'), undefined);
  assert.equal(localCallSpec('__proto__'), undefined);
  assert.equal(localCallSpec(''), undefined);
});

test('the local refusal codes have the format of a code, are the two the call can return, and join neither the engine codes nor the reader codes', () => {
  assert.deepEqual([...LOCAL_CALL_REFUSAL_CODES], ['NOT_ALLOWED', 'BAD_ARGUMENT']);
  for (const code of LOCAL_CALL_REFUSAL_CODES) assert.match(code, ENGINE_CODE_FORMAT);
  assert.equal(new Set(LOCAL_CALL_REFUSAL_CODES).size, LOCAL_CALL_REFUSAL_CODES.length);
  assert.equal(engineRefusalCodes().has('FAILED'), true, 'the engine set is unchanged');
  assert.equal(readerRefusalCodes().has('BUSY'), true, 'the reader set is unchanged');
});

test('the local golden file is well formed and equals the contract, call for call and code for code', () => {
  assert.equal(golden.format, 'bowerloom/engine-api-local-golden/v1');
  assert.equal(golden.bridge, 'bowerloomLocal');
  assert.equal(golden.channelPrefix, 'bowerloom-local:');
  assert.ok(golden.localCalls.length > 0, 'the golden file is not empty');
  assert.deepEqual(golden.localCalls, plain(LOCAL_CALLS));
  assert.deepEqual(golden.localCallRefusals, [...LOCAL_CALL_REFUSAL_CODES]);
});

test('the local golden file is not a base golden file, so the base file check still sees exactly one', () => {
  const names = fs.readdirSync(path.join(here, '..', 'golden'));
  assert.deepEqual(names.filter(f => /^base-[0-9a-f]{8}\.json$/.test(f)), ['base-d4c8a478.json']);
  assert.ok(names.includes('local-calls.json'));
});

test('a drifted golden file would fail the comparison', () => {
  const drifted = JSON.parse(JSON.stringify(golden));
  drifted.localCalls[0].arity = 1;
  assert.notDeepEqual(drifted.localCalls, plain(LOCAL_CALLS));
});
