// The fourth bridge, `bowerloomRuns`: its table (shared/api/runs.ts), the contract package that names the same calls, the preload that exposes it, the client that checks it, the shape rules
// main applies to each argument, and the rules that keep the page pure. The 42 calls of the reader and the engine, the 39 engine calls and the local calls are not touched here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { API_CALLS, API_CHANNELS, refusalCode } from '../shared/api/calls.js';
import { LOCAL_CALLS } from '../shared/api/local.js';
import { NO_FIGURES, RUN_ARITY, RUN_CALLS, RUN_CHANNELS, RUN_INSTRUCTION_LIMIT, RUN_NOTES_LIMIT, RUN_REFUSALS } from '../shared/api/runs.js';
import { cleanStartedAt, isRunId, parseRecordInput, parseRunPatch } from '../shared/api/runs-shape.js';
import { ENGINE_CALLS } from '../shared/engine/types.js';
import { REAL_CALLS } from '../shared/real/types.js';
import { createApiClient, runsCodeOf } from '../renderer/api/client.js';
import { pageTransport } from '../renderer/api/transport.js';
import { DESKTOP } from './support.js';

const ROOT = join(DESKTOP, '..', '..');

const read = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8');
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const sourcesUnder = (dir: string): string[] => readdirSync(join(DESKTOP, dir), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? sourcesUnder(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []));
const noop = (): Promise<never> => new Promise(() => undefined);
const fullRuns = (): Record<string, unknown> => Object.fromEntries(RUN_CALLS.map(call => [call, noop]));
const NOW = Date.parse('2026-11-11T12:00:00Z');

// ---- the table

test('the runs table holds five calls with their argument counts and their own channels in the bowerloom-runs namespace', () => {
  assert.deepEqual([...RUN_CALLS], ['listRuns', 'recordRun', 'updateRun', 'readRunFigures', 'startNewRunList']);
  assert.equal(Object.isFrozen(RUN_CALLS), true);
  assert.deepEqual(RUN_ARITY, { listRuns: 0, recordRun: 1, updateRun: 2, readRunFigures: 1, startNewRunList: 0 });
  for (const call of RUN_CALLS) assert.equal(RUN_CHANNELS[call], `bowerloom-runs:${call}`);
  assert.equal(new Set(Object.values(RUN_CHANNELS)).size, 5);
  assert.deepEqual([...RUN_REFUSALS], ['NOT_ALLOWED', 'BAD_ARGUMENT', 'UNKNOWN_FOLDER', 'UNKNOWN_RUN', 'RUN_LIMIT', 'STORE_DAMAGED', 'TOO_LONG', 'FOLDER_CHARACTER', 'FOLDER_LINK', 'FAILED']);
});

test('the runs calls are not part of the 42 calls of the reader and the engine, nor of the local calls', () => {
  assert.equal(API_CALLS.length, 42); assert.equal(ENGINE_CALLS.length, 39); assert.equal(REAL_CALLS.length, 3); assert.equal(LOCAL_CALLS.length, 2);
  for (const call of RUN_CALLS) {
    assert.equal((API_CALLS as readonly string[]).includes(call), false, call);
    assert.equal((LOCAL_CALLS as readonly string[]).includes(call), false, call);
    assert.equal(Object.values(API_CHANNELS).includes(RUN_CHANNELS[call]), false, RUN_CHANNELS[call]);
  }
});

test('the table of the page equals the contract package and its golden file, call for call', () => {
  const golden = JSON.parse(readFileSync(join(ROOT, 'packages', 'engine-api', 'golden', 'run-calls.json'), 'utf8')) as { runCalls: { name: string; arity: number; channel: string }[]; runCallRefusals: string[] };
  assert.deepEqual(golden.runCalls.map(c => [c.name, c.arity, c.channel]), RUN_CALLS.map(call => [call, RUN_ARITY[call], RUN_CHANNELS[call]]));
  assert.deepEqual(golden.runCallRefusals, RUN_REFUSALS.filter(code => code !== 'FAILED'));
});

test('the frozen engine golden file is not changed by this bridge: still one base file, d4c8a478', () => {
  const names = readdirSync(join(ROOT, 'packages', 'engine-api', 'golden'));
  assert.deepEqual(names.filter(n => /^base-/.test(n)), ['base-d4c8a478.json']);
});

test('a runs refusal code is read on its own side, and any other text is FAILED', () => {
  for (const code of RUN_REFUSALS) assert.equal(runsCodeOf(new Error(`Error invoking remote method 'bowerloom-runs:recordRun': Error: ${code}`)), code);
  for (const code of ['HOST_NOT_STARTED', 'UNKNOWN_PLACE', 'BUSY', 'NO_HOME', 'TOO_MANY', 'UNKNOWN_BUNDLE']) assert.equal(runsCodeOf(new Error(code)), 'FAILED', code);
  for (const odd of ['whatever', '', null, undefined, 5, {}, new Error('/home/person/secret exploded'), 'xUNKNOWN_RUNx']) assert.equal(runsCodeOf(odd), 'FAILED', String(odd));
  assert.equal(refusalCode(new Error('UNKNOWN_RUN'), 'runs'), 'UNKNOWN_RUN');
});

// ---- the shape of an argument

const good = { folderId: 'folder-3', engine: 'claude-code', instruction: '  Write a weekly report.  ', startedAt: '2026-11-11T10:30:00Z' };

test('recordRun accepts a whole input, trims the instruction, and canonicalizes the time', () => {
  assert.deepEqual(parseRecordInput(good, NOW), { folderId: 'folder-3', engine: 'claude-code', instruction: 'Write a weekly report.', startedAt: '2026-11-11T10:30:00.000Z' });
  assert.deepEqual(parseRecordInput({ ...good, startedAt: null }, NOW)?.startedAt, null);
  assert.equal(parseRecordInput({ ...good, engine: 'codex' }, NOW)?.engine, 'codex');
  assert.equal(parseRecordInput({ ...good, instruction: 'é😀 ok\nline two\tx' }, NOW)?.instruction, 'é😀 ok\nline two\tx');
});

test('recordRun refuses every shape that is not exactly an input: wrong type, extra key, bad id, bad engine, empty or odd text, bad time', () => {
  const bad: unknown[] = [
    undefined, null, 5, 'x', [], [good], () => 1, new Map(), Object.create({ folderId: 'folder-3', engine: 'codex', instruction: 'x' }),
    { ...good, extra: 1 }, { ...good, folderId: '../etc' }, { ...good, folderId: 'folder-' }, { ...good, folderId: 7 }, { ...good, folderId: 'folder-1234567' },
    { ...good, engine: 'vim' }, { ...good, engine: 'constructor' }, { ...good, engine: null },
    { ...good, instruction: '' }, { ...good, instruction: '   \n ' }, { ...good, instruction: 5 }, { ...good, instruction: 'a'.repeat(RUN_INSTRUCTION_LIMIT + 1) },
    { ...good, instruction: 'a\u0000b' }, { ...good, instruction: 'a\r\nb\u0007' }, { ...good, instruction: 'a\ud800b' },
    { ...good, startedAt: 'yesterday' }, { ...good, startedAt: '2026-11-11' }, { ...good, startedAt: '2026-11-11T10:30:00+02:00' }, { ...good, startedAt: 12345 },
    { ...good, startedAt: '2019-12-31T23:59:00Z' }, { ...good, startedAt: '2026-11-13T12:00:00Z' }, { ...good, startedAt: '2026-13-45T10:30:00Z' },
  ];
  for (const value of bad) assert.equal(parseRecordInput(value, NOW), null, JSON.stringify(value));
  const missing = { ...good } as Record<string, unknown>; delete missing.folderId;
  assert.equal(parseRecordInput(missing, NOW), null);
  assert.notEqual(parseRecordInput({ ...good, instruction: 'a'.repeat(RUN_INSTRUCTION_LIMIT) }, NOW), null, 'the limit itself is allowed');
});

test('cleanStartedAt takes an ISO time with Z inside the window and gives the canonical text', () => {
  assert.equal(cleanStartedAt('2026-11-11T10:30Z', NOW), '2026-11-11T10:30:00.000Z');
  assert.equal(cleanStartedAt('2026-11-12T11:59:00Z', NOW), '2026-11-12T11:59:00.000Z');
  assert.equal(cleanStartedAt('2026-11-12T12:00:01Z', NOW), null);
  for (const v of [undefined, null, 0, {}, '', 'x'.repeat(100)]) assert.equal(cleanStartedAt(v, NOW), null);
});

test('updateRun takes a patch of status, rating and notes only, with at least one of them', () => {
  assert.deepEqual(parseRunPatch({ status: 'done' }), { status: 'done' });
  assert.deepEqual(parseRunPatch({ rating: null }), { rating: null });
  assert.deepEqual(parseRunPatch({ status: 'done', rating: 'better', notes: 'ok' }), { status: 'done', rating: 'better', notes: 'ok' });
  assert.deepEqual(parseRunPatch({ notes: '' }), { notes: '' });
  const bad: unknown[] = [undefined, null, 1, 'x', [], {}, { id: 'run-1' }, { status: 'running' }, { status: 'closed' }, { status: null }, { rating: 'great' }, { rating: undefined, extra: 1 }, { notes: 5 },
    { notes: 'a'.repeat(RUN_NOTES_LIMIT + 1) }, { notes: 'a\u0000' }, { status: 'done', __proto__: { x: 1 }, y: 2 }];
  for (const value of bad) assert.equal(parseRunPatch(value), null, JSON.stringify(value));
});

test('a run id is run- and up to six digits, nothing else', () => {
  for (const id of ['run-1', 'run-123456']) assert.equal(isRunId(id), true, id);
  for (const id of ['run-', 'run-1234567', 'RUN-1', 'run-1 ', 'run-1\n', '../run-1', 'folder-1', 7, null, undefined, {}]) assert.equal(isRunId(id), false, String(id));
});

test('figures that cannot be read are a state with every figure null, never a zero', () => {
  for (const state of ['not-found', 'unreadable', 'ambiguous', 'not-available'] as const) {
    const f = NO_FIGURES(state);
    assert.deepEqual(f, { state, reason: null, startedAt: null, endedAt: null, durationMs: null, inputTokens: null, outputTokens: null, model: null, outcome: 'unknown' });
    assert.equal(Object.isFrozen(f), true);
  }
});

// ---- the preload

function builtPreload(): { exposed: Map<string, Record<string, unknown>>; sent: [string, unknown[]][]; failWith: (error: Error | null) => void } {
  const script = "import { build } from 'esbuild'; const o = await build({ entryPoints: ['preload/real-preload.ts'], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['electron'], logLevel: 'silent' }); process.stdout.write(o.outputFiles[0].text);";
  const built = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: DESKTOP, encoding: 'utf8', timeout: 60000 });
  assert.equal(built.status, 0, built.stderr);
  const exposed = new Map<string, Record<string, unknown>>(), sent: [string, unknown[]][] = [];
  let fail: Error | null = null;
  const electron = {
    contextBridge: { exposeInMainWorld: (name: string, api: Record<string, unknown>) => { exposed.set(name, api); } },
    ipcRenderer: { invoke: (channel: string, ...args: unknown[]) => { sent.push([channel, args]); return fail === null ? Promise.resolve('ok') : Promise.reject(fail); } },
  };
  new Function('require', 'module', 'exports', built.stdout)((id: string) => { assert.equal(id, 'electron'); return electron; }, { exports: {} }, {});
  return { exposed, sent, failWith: error => { fail = error; } };
}

test('the preload exposes bowerloomRuns with exactly the runs calls, frozen', () => {
  const { exposed } = builtPreload();
  const runs = exposed.get('bowerloomRuns');
  assert.ok(runs !== undefined);
  assert.deepEqual(Object.keys(runs).sort(), [...RUN_CALLS].sort());
  assert.equal(Object.isFrozen(runs), true);
});

test('each runs call sends exactly its arity of arguments on its own channel, and drops the rest', async () => {
  const { exposed, sent } = builtPreload();
  const runs = exposed.get('bowerloomRuns') as Record<string, (...a: unknown[]) => Promise<unknown>>;
  await runs.listRuns!('extra', 'more');
  await runs.recordRun!({ a: 1 }, 'extra');
  await runs.updateRun!('run-1', { notes: 'x' }, 'extra');
  await runs.readRunFigures!('run-1', 'extra');
  await runs.startNewRunList!('extra');
  assert.deepEqual(sent, [[RUN_CHANNELS.listRuns, []], [RUN_CHANNELS.recordRun, [{ a: 1 }]], [RUN_CHANNELS.updateRun, ['run-1', { notes: 'x' }]], [RUN_CHANNELS.readRunFigures, ['run-1']], [RUN_CHANNELS.startNewRunList, []]]);
});

test('a refusal becomes one short code on the page, and a long message with a path becomes FAILED', async () => {
  const { exposed, failWith } = builtPreload();
  const runs = exposed.get('bowerloomRuns') as Record<string, (...a: unknown[]) => Promise<unknown>>;
  for (const code of ['NOT_ALLOWED', 'BAD_ARGUMENT', 'UNKNOWN_FOLDER', 'UNKNOWN_RUN', 'RUN_LIMIT', 'STORE_DAMAGED', 'TOO_LONG', 'FOLDER_CHARACTER', 'FOLDER_LINK']) {
    failWith(new Error(`Error invoking remote method 'bowerloom-runs:updateRun': Error: ${code}`));
    await assert.rejects(runs.updateRun!('run-1', {}), (e: Error) => e.message === code, code);
  }
  failWith(new Error('/Users/someone/secret exploded'));
  for (const call of RUN_CALLS) await assert.rejects(runs[call]!(), (e: Error) => e.message === 'FAILED', call);
});

test('the other three bridges are unchanged by the fourth: their names and their key sets are as before', () => {
  const { exposed } = builtPreload();
  assert.deepEqual([...exposed.keys()].sort(), ['bowerloomEngine', 'bowerloomLocal', 'bowerloomModules', 'bowerloomReal', 'bowerloomRuns']);
  assert.deepEqual(Object.keys(exposed.get('bowerloomReal')!).sort(), [...REAL_CALLS].sort());
  assert.deepEqual(Object.keys(exposed.get('bowerloomEngine')!).filter(name => name !== 'mode').sort(), [...ENGINE_CALLS].sort());
  assert.deepEqual(Object.keys(exposed.get('bowerloomLocal')!).sort(), [...LOCAL_CALLS].sort());
});

// ---- the client

test('the client gives the runs bridge of a window that has all five calls', () => {
  const runs = fullRuns();
  assert.equal(createApiClient({ reader: undefined, engine: undefined, runs }).runs, runs as never);
});

test('the client gives null for no runs bridge, a value that is not an object, or a partial bridge', () => {
  for (const runs of [undefined, null, 5, 'x', true, []]) assert.equal(createApiClient({ reader: undefined, engine: undefined, runs }).runs, null, String(runs));
  assert.equal(createApiClient({ reader: undefined, engine: undefined }).runs, null);
  for (const call of RUN_CALLS) {
    const missing = fullRuns(); delete missing[call];
    assert.equal(createApiClient({ reader: undefined, engine: undefined, runs: missing }).runs, null, `${call} missing`);
    assert.equal(createApiClient({ reader: undefined, engine: undefined, runs: { ...fullRuns(), [call]: 'x' } }).runs, null, `${call} not a function`);
  }
});

test('the transport reads bowerloomRuns from the window by name, and nothing when there is no window', () => {
  const global = globalThis as unknown as { window?: unknown };
  const before = global.window;
  try {
    delete global.window;
    assert.equal(pageTransport().runs, undefined);
    const runs = fullRuns();
    global.window = { bowerloomRuns: runs };
    assert.equal(pageTransport().runs, runs);
  } finally {
    if (before === undefined) delete global.window; else global.window = before;
  }
});

// ---- the page stays pure

test('only the transport names bowerloomRuns in the page', () => {
  assert.deepEqual(sourcesUnder('renderer').filter(file => /bowerloomRuns/.test(strip(read(file)))), ['renderer/api/transport.ts']);
});

test('the shared table of the runs calls imports only types, so the preload that loads it pulls in no code; the shape rules are a separate file the preload does not load', () => {
  const code = strip(read('shared/api/runs.ts'));
  assert.doesNotMatch(code, /['"`]electron['"`]|['"`]node:[a-z]/);
  for (const line of code.split('\n').filter(l => /^import /.test(l))) assert.match(line, /^import type /, line);
  const shape = strip(read('shared/api/runs-shape.ts'));
  assert.doesNotMatch(shape, /['"`]electron['"`]|['"`]node:[a-z]/);
  assert.doesNotMatch(strip(read('preload/real-preload.ts')), /runs-shape/);
});
