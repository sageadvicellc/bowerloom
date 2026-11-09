// The golden file of the base. It was made by scripts/make-golden.mjs from the source of the base commit. These tests hold three things:
//  1. the golden file is well formed and names the commit it came from.
//  2. every call in it is in the contract with the same argument count, and the reverse.
//  3. every code literal found in the library source today is in it, so a literal that is dropped from the golden file, or added to the source without a new golden
//     file, fails here.
// The scanner is exercised on inline samples too, so a scanner that finds nothing cannot pass by being empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANCELLED, ENGINE_API_CALLS, ENGINE_CALL_REFUSAL_CODES, ENGINE_MAIN_REFUSAL_CODES, NAMED_OUTCOMES, NOT_THE_PLAN_SHOWN, READER_API_CALLS, READER_GATE_REFUSAL_CODES, READER_REFUSAL_CODES,
} from '../../../dist/packages/engine-api/src/index.js';
import { callsOf, checkGolden, codeLiteralsOf, goldenAgainstContract, listBaseSources, scanBase } from '../scripts/scan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const goldenDir = path.join(root, 'packages', 'engine-api', 'golden');
const goldenName = fs.readdirSync(goldenDir).filter(f => /^base-[0-9a-f]{8}\.json$/.test(f));
const contract = {
  engineCalls: ENGINE_API_CALLS, readerCalls: READER_API_CALLS, callRefusals: ENGINE_CALL_REFUSAL_CODES, readerGateRefusals: READER_GATE_REFUSAL_CODES,
  readerRefusals: READER_REFUSAL_CODES, namedOutcomes: NAMED_OUTCOMES, mainRefusals: ENGINE_MAIN_REFUSAL_CODES,
};

test('there is one golden file of the base, named for the first eight characters of its commit', () => {
  assert.deepEqual(goldenName, ['base-d4c8a478.json']);
  const golden = JSON.parse(fs.readFileSync(path.join(goldenDir, goldenName[0]), 'utf8'));
  assert.equal(golden.format, 'bowerloom/engine-api-golden/v1');
  assert.match(golden.commit, /^[0-9a-f]{40}$/);
  assert.equal(golden.commit.slice(0, 8), 'd4c8a478');
  assert.equal(golden.generatedBy, 'packages/engine-api/scripts/make-golden.mjs');
});

const golden = () => JSON.parse(fs.readFileSync(path.join(goldenDir, 'base-d4c8a478.json'), 'utf8'));

test('the golden file and the contract agree on every call, argument count, channel and refusal code', () => {
  assert.deepEqual(goldenAgainstContract(golden(), contract), []);
  assert.ok(golden().engineCalls.length > 0 && golden().readerCalls.length > 0, 'the golden file is not empty');
});

test('the golden file holds the two named outcomes and the codes of the three tables', () => {
  const g = golden();
  assert.deepEqual([...g.namedOutcomes].sort(), [CANCELLED, NOT_THE_PLAN_SHOWN].sort());
  for (const code of ['NOT_ALLOWED', 'BAD_ARGUMENT', 'UNKNOWN_FOLDER', 'UNKNOWN_BUNDLE', 'FAILED']) assert.ok(g.callRefusals.includes(code), code);
  for (const code of ['UNKNOWN_PLACE', 'TOO_MANY', 'BUSY', 'NO_HOME']) assert.ok(g.readerRefusals.includes(code), code);
});

test('every code literal in the library source today is in the golden file, and the source is the one the script reads', () => {
  const found = scanBase(root);
  assert.ok(found.sourceFiles.length >= 20, `the scan reads the library files (${found.sourceFiles.length})`);
  assert.ok(found.codeLiterals.length >= 80, `the scan finds the code literals (${found.codeLiterals.length})`);
  assert.deepEqual(checkGolden(golden(), found), []);
});

test('a code literal removed from the golden file fails the check, and so does a removed call', () => {
  const found = scanBase(root);
  const dropped = golden();
  dropped.codeLiterals = dropped.codeLiterals.filter(c => c !== 'SAVE_STALE');
  assert.match(checkGolden(dropped, found).join('\n'), /SAVE_STALE/);
  const fewer = golden();
  fewer.engineCalls = fewer.engineCalls.filter(c => c.name !== 'runSave');
  assert.match(checkGolden(fewer, found).join('\n'), /runSave/);
  const none = golden();
  none.codeLiterals = [];
  assert.ok(checkGolden(none, found).length >= 80);
  const wrongArity = golden();
  wrongArity.engineCalls = wrongArity.engineCalls.map(c => (c.name === 'runSave' ? { ...c, arity: 9 } : c));
  assert.match(checkGolden(wrongArity, found).join('\n'), /runSave/);
});

test('a call that is in the golden file and not in the contract fails the comparison', () => {
  const g = golden();
  g.engineCalls = [...g.engineCalls, { name: 'extraCall', arity: 0, optionalArgs: 0, channel: 'bowerloom-engine:extraCall' }];
  assert.match(goldenAgainstContract(g, contract).join('\n'), /extraCall/);
  const h = golden();
  h.readerCalls = h.readerCalls.filter(c => c.name !== 'pickFolder');
  assert.match(goldenAgainstContract(h, contract).join('\n'), /pickFolder/);
  const k = golden();
  k.callRefusals = k.callRefusals.filter(c => c !== 'FAILED');
  assert.match(goldenAgainstContract(k, contract).join('\n'), /FAILED/);
});

test('the scanner finds quoted upper-case words with an underscore, and single words only in a refusal position', () => {
  assert.deepEqual(codeLiteralsOf(`const a = 'SAVE_STALE'; const b = "UNKNOWN_FOLDER"; const c = 'lower_case'; const d = \`TEMPLATE_ONE\`;`).codes, ['SAVE_STALE', 'UNKNOWN_FOLDER']);
  assert.deepEqual(codeLiteralsOf(`throw new Error('FAILED'); const x = 'ENOENT'; const y = 'ROOT';`).codes, ['FAILED']);
  assert.deepEqual(codeLiteralsOf(`return { ok: false, refusal: { code: CANCELLED, message: 'm', paths: [] } }; const z = { code: 'BUSY' };`).codes, ['BUSY']);
  assert.deepEqual(codeLiteralsOf(`export const CANCELLED = 'CANCELLED';`).codes, ['CANCELLED']);
  assert.deepEqual(codeLiteralsOf('').codes, []);
  assert.deepEqual(codeLiteralsOf(`const s = 'A_'; const t = '_A'; const u = 'A__B';`).codes, []);
});

test('the call reader takes names, argument counts and channels from the text of the types files', () => {
  const types = `export const ENGINE_CALLS = Object.freeze(['one', 'two', 'three'] as const);
export const ENGINE_ARITY: Readonly<Record<EngineCall, number>> = Object.freeze({ one: 0, two: 2, three: 1 });
export const ENGINE_CHANNELS = Object.freeze(Object.fromEntries(ENGINE_CALLS.map(c => [c, \`bowerloom-engine:\${c}\`])));`;
  const ipc = `if (args.length !== ENGINE_ARITY[call] && !(call === 'two' && args.length === 3)) throw new Error('BAD_ARGUMENT');`;
  assert.deepEqual(callsOf({ types, ipc }).engineCalls, [
    { name: 'one', arity: 0, optionalArgs: 0, channel: 'bowerloom-engine:one' },
    { name: 'two', arity: 2, optionalArgs: 1, channel: 'bowerloom-engine:two' },
    { name: 'three', arity: 1, optionalArgs: 0, channel: 'bowerloom-engine:three' },
  ]);
});

test('the call reader reads the reader calls from REAL_CALLS, REAL_CHANNELS and the guarded handlers', () => {
  const real = `export const REAL_CALLS = Object.freeze(['a', 'b'] as const);
export const REAL_CHANNELS = Object.freeze({ a: 'bowerloom-real:a-x', b: 'bowerloom-real:b-y' } as const);`;
  const realIpc = `guarded(REAL_CHANNELS.a, 0, async () => 1);\n  guarded(REAL_CHANNELS.b, 1, async ([ids]) => 2);`;
  assert.deepEqual(callsOf({ real, realIpc }).readerCalls, [
    { name: 'a', arity: 0, optionalArgs: 0, channel: 'bowerloom-real:a-x' },
    { name: 'b', arity: 1, optionalArgs: 0, channel: 'bowerloom-real:b-y' },
  ]);
});

test('the source list is the library files only, in a fixed order', () => {
  const files = listBaseSources(root);
  assert.ok(files.every(f => /^apps\/desktop\/(main\/(engine|real)-[^/]+|shared\/(engine|real)\/[^/]+)\.ts$/.test(f)), files.join('\n'));
  assert.deepEqual(files, [...files].sort());
  assert.ok(files.includes('apps/desktop/main/engine-service.ts') && files.includes('apps/desktop/shared/real/types.ts'));
  assert.ok(!files.some(f => f.includes('main/main.ts')));
});
