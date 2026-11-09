// The golden file of the base. It was made by scripts/make-golden.mjs from the source of the base commit. These tests hold three things:
//  1. the golden file is well formed and names the commit it came from.
//  2. every call in it is in the contract with the same argument count, and the reverse.
//  3. every code literal found in the library source today is in it, so a literal that is dropped from the golden file, or added to the source without a new golden
//     file, fails here.
// The scanner is exercised on inline samples too, so a scanner that finds nothing cannot pass by being empty. It throws when it cannot find what it reads, so it never
// returns an empty result by accident.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  CANCELLED, ENGINE_API_CALLS, ENGINE_CALL_REFUSAL_CODES, ENGINE_MAIN_REFUSAL_CODES, NAMED_OUTCOMES, NOT_THE_PLAN_SHOWN, READER_API_CALLS, READER_GATE_REFUSAL_CODES, READER_REFUSAL_CODES,
} from '../../../dist/packages/engine-api/src/index.js';
import { callsOf, checkGolden, codeLiteralsOf, emptyTables, escapeRegExp, goldenAgainstContract, hashProblems, listBaseSources, refusalsOf, scanBase } from '../scripts/scan.mjs';

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

// ---- exact counts, so a scan that finds less cannot pass

test('the scan finds the exact number of calls and a full table of every kind', () => {
  const found = scanBase(root);
  assert.equal(found.engineCalls.length, 39);
  assert.equal(found.readerCalls.length, 3);
  assert.equal(found.engineCalls.length, ENGINE_API_CALLS.length);
  assert.equal(found.readerCalls.length, READER_API_CALLS.length);
  for (const table of ['callRefusals', 'namedOutcomes', 'mainRefusals', 'readerGateRefusals', 'readerRefusals', 'codeLiterals', 'sourceFiles']) assert.ok(found[table].length > 0, `${table} is not empty`);
  assert.deepEqual(emptyTables(found), []);
  assert.equal(golden().engineCalls.length, found.engineCalls.length);
  assert.equal(golden().readerCalls.length, found.readerCalls.length);
});

test('the list of source files is the list the golden file recorded, name for name', () => {
  assert.deepEqual(listBaseSources(root), golden().sourceFiles.map(f => f.path));
});

test('emptyTables names every list that is empty', () => {
  const found = scanBase(root);
  assert.deepEqual(emptyTables({ ...found, engineCalls: [], codeLiterals: [] }), ['engineCalls', 'codeLiterals']);
  assert.deepEqual(emptyTables({}), ['sourceFiles', 'engineCalls', 'readerCalls', 'callRefusals', 'namedOutcomes', 'mainRefusals', 'readerGateRefusals', 'readerRefusals', 'codeLiterals']);
});

// ---- the check goes both ways

test('a golden entry that the source no longer has fails, for calls and for tables', () => {
  const found = scanBase(root);
  const extraCall = golden();
  extraCall.engineCalls = [...extraCall.engineCalls, { name: 'ghostCall', arity: 0, optionalArgs: 0, channel: 'bowerloom-engine:ghostCall' }];
  assert.match(checkGolden(extraCall, found).join('\n'), /ghostCall.*golden file and not in the source/);
  const extraReader = golden();
  extraReader.readerCalls = [...extraReader.readerCalls, { name: 'ghostRead', arity: 0, optionalArgs: 0, channel: 'bowerloom-real:ghost' }];
  assert.match(checkGolden(extraReader, found).join('\n'), /ghostRead/);
  for (const table of ['callRefusals', 'namedOutcomes', 'mainRefusals', 'readerGateRefusals', 'readerRefusals']) {
    const extra = golden();
    extra[table] = [...extra[table], 'GHOST_CODE'];
    assert.match(checkGolden(extra, found).join('\n'), new RegExp(`${table}: GHOST_CODE is in the golden file and not in the source`), table);
  }
});

test('a code literal that the source no longer has may stay in the golden file: a removal needs a decision', () => {
  const found = scanBase(root);
  const kept = golden();
  kept.codeLiterals = [...kept.codeLiterals, 'REMOVED_LATER'].sort();
  assert.deepEqual(checkGolden(kept, found), []);
});

// ---- the scanner cannot come back empty without saying so

const tmp = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-api-scan-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('a root without the library folders, or with one of them missing, makes the scan throw', t => {
  const bare = tmp(t);
  assert.throws(() => listBaseSources(bare), /apps\/desktop\/main/);
  assert.throws(() => scanBase(bare), /cannot find/);
  const partial = tmp(t);
  fs.mkdirSync(path.join(partial, 'apps', 'desktop', 'main'), { recursive: true });
  fs.writeFileSync(path.join(partial, 'apps', 'desktop', 'main', 'engine-x.ts'), 'export const A = 1;\n');
  assert.throws(() => listBaseSources(partial), /apps\/desktop\/shared\/engine/);
});

test('a folder that holds no file of the pattern makes the scan throw', t => {
  const root2 = tmp(t);
  for (const dir of ['main', 'shared/engine', 'shared/real']) fs.mkdirSync(path.join(root2, 'apps', 'desktop', dir), { recursive: true });
  assert.throws(() => listBaseSources(root2), /no file/);
});

test('a missing block, a missing file, an unknown argument count and an empty channel each throw', () => {
  const types = `export const ENGINE_CALLS = Object.freeze(['one'] as const);
export const ENGINE_ARITY: Readonly<Record<EngineCall, number>> = Object.freeze({ one: 0 });
export const ENGINE_CHANNELS = Object.freeze(Object.fromEntries(ENGINE_CALLS.map(c => [c, \`bowerloom-engine:\${c}\`])));`;
  assert.deepEqual(callsOf({ types, ipc: '' }).engineCalls.map(c => c.name), ['one']);
  assert.throws(() => callsOf({ types: 'nothing here', ipc: '' }), /ENGINE_CALLS/);
  assert.throws(() => callsOf({ types: types.replace('export const ENGINE_ARITY', 'export const OTHER'), ipc: '' }), /ENGINE_ARITY/);
  assert.throws(() => callsOf({ types: types.replace('{ one: 0 }', '{ two: 0 }'), ipc: '' }), /arity/);
  assert.throws(() => callsOf({ types: types.replace('bowerloom-engine:', ''), ipc: '' }), /channel/);
  assert.throws(() => callsOf({ types }), /main\/engine-ipc\.ts/);
  assert.throws(() => callsOf({ types: types.replace("['one']", '[]'), ipc: '' }), /no calls/);
  const real = `export const REAL_CALLS = Object.freeze(['a'] as const);
export const REAL_CHANNELS = Object.freeze({ a: 'bowerloom-real:a-x' } as const);`;
  const realIpc = 'guarded(REAL_CHANNELS.a, 0, async () => 1);';
  assert.deepEqual(callsOf({ real, realIpc }).readerCalls.length, 1);
  assert.throws(() => callsOf({ real, realIpc: 'nothing' }), /arity/);
  assert.throws(() => callsOf({ real: real.replace("a: 'bowerloom-real:a-x'", "a: ''"), realIpc }), /channel/);
  assert.throws(() => callsOf({ real: real.replace('export const REAL_CHANNELS', 'export const X'), realIpc }), /REAL_CHANNELS/);
  assert.throws(() => callsOf({ real: 'nothing', realIpc }), /REAL_CALLS/);
});

test('a refusal table that cannot be read throws, whatever file it is missing from', () => {
  const found = scanBase(root);
  assert.ok(found.callRefusals.length > 0);
  assert.throws(() => refusalsOf({ types: '', realScan: '', realIpc: '', consent: '' }), /ENGINE_CALL_REFUSALS/);
  assert.throws(() => refusalsOf({}), /needs the text/);
  const base = (name) => fs.readFileSync(path.join(root, 'apps', 'desktop', name), 'utf8');
  const all = { types: base('shared/engine/types.ts'), realScan: base('main/real-scan.ts'), realIpc: base('main/real-ipc.ts'), consent: base('main/engine-consent.ts') };
  assert.ok(refusalsOf(all).readerRefusals.length > 0);
  assert.throws(() => refusalsOf({ ...all, consent: '' }), /named outcome/);
  assert.throws(() => refusalsOf({ ...all, realScan: '' }), /RealRefusal/);
  assert.throws(() => refusalsOf({ ...all, realIpc: '' }), /gate/);
  assert.throws(() => refusalsOf({ ...all, types: all.types.replace(/_MAIN_WORDS/g, '_OTHER') }), /_MAIN_WORDS/);
});

test('a call name with a character that means something in a pattern is read as plain text', () => {
  const pattern = new RegExp(`call === '${escapeRegExp('a.b(c+')}' && args\\.length === (\\d+)`);
  assert.deepEqual(pattern.exec("call === 'a.b(c+' && args.length === 2")?.[1], '2');
  assert.equal(pattern.test("call === 'axb(c+' && args.length === 2"), false);
  assert.equal(escapeRegExp('plain'), 'plain');
});

// ---- the hashes bind the golden file to the source

test('every file whose hash in the golden file equals the live file needs nothing, and the live source matches today', () => {
  assert.deepEqual(hashProblems(golden(), root), []);
});

test('a file that differs from its hash in the golden file fails with its name until the golden file is made again', () => {
  const changed = golden();
  const victim = changed.sourceFiles[3];
  changed.sourceFiles = changed.sourceFiles.map(f => (f.path === victim.path ? { ...f, sha256: '0'.repeat(64) } : f));
  const problems = hashProblems(changed, root);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes(victim.path), problems[0]);
  assert.match(problems[0], /make-golden/);
});

test('a source file that the golden file does not list, and a listed file that is gone, both fail with the file name', () => {
  const fewer = golden();
  const dropped = fewer.sourceFiles.pop();
  assert.match(hashProblems(fewer, root).join('\n'), new RegExp(dropped.path.replace(/[.]/g, '[.]')));
  const more = golden();
  more.sourceFiles = [...more.sourceFiles, { path: 'apps/desktop/main/engine-gone.ts', sha256: '0'.repeat(64) }];
  assert.match(hashProblems(more, root).join('\n'), /engine-gone\.ts/);
});

test('the golden file says what it was made from: the commit label and the hashes', () => {
  const g = golden();
  assert.match(g.commit, /^[0-9a-f]{40}$/);
  for (const f of g.sourceFiles) assert.match(f.sha256, /^[0-9a-f]{64}$/, f.path);
});

// ---- the script

const SCRIPT = path.join(root, 'packages', 'engine-api', 'scripts', 'make-golden.mjs');
const BASE_COMMIT = 'd4c8a47833e7ef7bba4161b481dba1f1f115df6c';
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('make-golden --check exits 0 when the golden file matches the source', () => {
  const ran = run('--check', '--commit', BASE_COMMIT);
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.match(ran.stdout, /matches the source/);
});

test('make-golden exits 2 for a bad flag and 1 when the scan finds nothing or cannot read the source', t => {
  assert.equal(run('--check').status, 2);
  assert.equal(run('--check', '--commit', 'abc').status, 2);
  const bare = tmp(t);
  const ran = run('--check', '--commit', BASE_COMMIT, '--root', bare);
  assert.equal(ran.status, 1, ran.stdout + ran.stderr);
  assert.match(ran.stderr, /cannot find/);
  assert.equal(fs.readdirSync(bare).length, 0, 'it wrote nothing');
  const write = run('--commit', BASE_COMMIT, '--root', bare);
  assert.equal(write.status, 1);
  assert.equal(fs.readdirSync(bare).length, 0, 'it wrote nothing');
});

test('the root script check:golden runs the same check', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['check:golden'], /make-golden\.mjs --check --commit [0-9a-f]{40}/);
  assert.ok(pkg.scripts['check:golden'].includes(golden().commit));
});
