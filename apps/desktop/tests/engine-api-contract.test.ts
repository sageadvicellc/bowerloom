// The engine API contract (packages/engine-api) against the real lists of the app. The package never imports apps/desktop, so the comparison lives here.
// Names are compared as sets, so the order of a list does not matter, and no count is written into a test: the real list is the measure.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANCELLED, ENGINE_ARITY, ENGINE_CALLS, ENGINE_CALL_REFUSALS, ENGINE_CHANNELS, KIT_MAIN_WORDS, NOTES_MAIN_WORDS, NOT_THE_PLAN_SHOWN, REPORT_MAIN_WORDS, SAVE_MAIN_WORDS, SHARE_MAIN_WORDS,
} from '../shared/engine/types.js';
import type { Refusal as AppRefusal } from '../shared/engine/types.js';
import { START_MAIN_WORDS } from '../shared/engine/start-command.js';
import { WORKER_CAUSES } from '../main/engine-bundle-host.js';
import { EXPORT_TARGET_IN_HARNESS, QUIT_BEGUN } from '../main/engine-bundle.js';
import { UNKNOWN_BUNDLE_MARK } from '../main/engine-bundle-mark.js';
import { REAL_CALLS, REAL_CHANNELS } from '../shared/real/types.js';
import { APP_INDEX } from '../main/security.js';
import { registerRealIpc } from '../main/real-ipc.js';
import type { RealEvent } from '../main/real-ipc.js';
import { REAL_BASE } from '../shared/harness/route.js';
import {
  CANCELLED as API_CANCELLED, ENGINE_API_CALLS, ENGINE_CALL_REFUSAL_CODES, ENGINE_MAIN_ANSWER_REFUSAL_CODES, ENGINE_MAIN_REFUSAL_CODES, ENGINE_REFUSAL_STEPS, NAMED_OUTCOMES,
  NOT_THE_PLAN_SHOWN as API_NOT_THE_PLAN_SHOWN, READER_API_CALLS,
} from '../../../packages/engine-api/src/index.js';
import type { Refusal as ApiRefusal } from '../../../packages/engine-api/src/index.js';
import { buildFixture } from './fixtures-real/build.js';

/** What a list has that the other has not, as words. Empty when the two hold the same names. */
function differences(label: string, contract: readonly string[], real: readonly string[]): string[] {
  const a = new Set(contract), b = new Set(real), out: string[] = [];
  if (a.size !== contract.length) out.push(`${label}: the contract lists a name twice`);
  if (b.size !== real.length) out.push(`${label}: the real list holds a name twice`);
  for (const n of a) if (!b.has(n)) out.push(`${label}: only in the contract: ${n}`);
  for (const n of b) if (!a.has(n)) out.push(`${label}: only in the real list: ${n}`);
  return out;
}

test('the comparison itself reports a missing name, an extra name and a doubled name', () => {
  assert.deepEqual(differences('x', ['a', 'b'], ['b', 'a']), []);
  assert.deepEqual(differences('x', ['a'], ['a', 'b']), ['x: only in the real list: b']);
  assert.deepEqual(differences('x', ['a', 'c'], ['a']), ['x: only in the contract: c']);
  assert.deepEqual(differences('x', ['a', 'a'], ['a']), ['x: the contract lists a name twice']);
  assert.deepEqual(differences('x', [], []), []);
});

test('the contract lists exactly the engine calls of the app', () => {
  assert.ok(ENGINE_CALLS.length > 0);
  assert.deepEqual(differences('engine calls', ENGINE_API_CALLS.map(c => c.name), ENGINE_CALLS), []);
});

test('every engine call has the argument count and the channel the app gives it', () => {
  for (const spec of ENGINE_API_CALLS) {
    const name = spec.name as keyof typeof ENGINE_ARITY;
    assert.equal(spec.arity, ENGINE_ARITY[name], `${spec.name} arity`);
    assert.equal(spec.channel, ENGINE_CHANNELS[name], `${spec.name} channel`);
  }
  // The one call that takes an optional extra argument is chooseFolder (main/engine-ipc.ts). Every other call takes exactly its count.
  assert.deepEqual(ENGINE_API_CALLS.filter(c => c.optionalArgs !== 0).map(c => `${c.name}+${c.optionalArgs}`), ['chooseFolder+1']);
});

test('the contract lists exactly the three calls of the reader, with the channels of the app', () => {
  assert.deepEqual(differences('reader calls', READER_API_CALLS.map(c => c.name), REAL_CALLS), []);
  for (const spec of READER_API_CALLS) assert.equal(spec.channel, REAL_CHANNELS[spec.name as keyof typeof REAL_CHANNELS], spec.name);
});

test('the reader handler refuses the wrong number of arguments, for the count the contract names', async t => {
  const f = buildFixture();
  t.after(() => f.cleanup());
  const handlers = new Map<string, (event: RealEvent, ...args: unknown[]) => unknown>();
  registerRealIpc({ ipc: { handle: (channel, listener) => { handlers.set(channel, listener); } }, appIndexUrl: APP_INDEX, home: f.home, chooseFolder: async () => null });
  const page: RealEvent = { senderFrame: { url: `${APP_INDEX}${REAL_BASE}`, parent: null } };
  const reason = async (channel: string, ...args: unknown[]): Promise<string> => { try { await handlers.get(channel)!(page, ...args); return 'answered'; } catch (e) { return (e as Error).message; } };
  for (const spec of READER_API_CALLS) {
    assert.equal(await reason(spec.channel, ...new Array(spec.arity + 1).fill('x')), 'BAD_ARGUMENT', `${spec.name}: one argument too many`);
    if (spec.arity > 0) assert.equal(await reason(spec.channel, ...new Array(spec.arity - 1).fill('x')), 'BAD_ARGUMENT', `${spec.name}: one argument too few`);
    assert.notEqual(await reason(spec.channel, ...(spec.arity === 0 ? [] : [['no-such-place']])), 'BAD_ARGUMENT', `${spec.name}: the contract count is accepted`);
  }
});

test('the contract holds the call refusals, the two named outcomes and the refusals of main that the app defines', () => {
  assert.deepEqual(differences('call refusals', ENGINE_CALL_REFUSAL_CODES, ENGINE_CALL_REFUSALS), []);
  assert.equal(API_NOT_THE_PLAN_SHOWN, NOT_THE_PLAN_SHOWN);
  assert.equal(API_CANCELLED, CANCELLED);
  assert.deepEqual(differences('named outcomes', NAMED_OUTCOMES, [NOT_THE_PLAN_SHOWN, CANCELLED]), []);
  const mainWords = [SAVE_MAIN_WORDS, SHARE_MAIN_WORDS, KIT_MAIN_WORDS, NOTES_MAIN_WORDS, REPORT_MAIN_WORDS].flatMap(table => Object.keys(table));
  assert.ok(mainWords.length > 0);
  assert.deepEqual(differences('refusals of main', ENGINE_MAIN_REFUSAL_CODES, mainWords), []);
});

test('the main answer refusals of the contract are the ones the app source names: the START words, the chooser, the quit and the export place', () => {
  const start = ENGINE_MAIN_ANSWER_REFUSAL_CODES.filter(c => c.startsWith('START_'));
  assert.deepEqual(differences('start refusals', start, [...Object.keys(START_MAIN_WORDS), 'START_INSTRUCTION_SUBCOMMAND']), []);
  const rest = ENGINE_MAIN_ANSWER_REFUSAL_CODES.filter(c => !c.startsWith('START_'));
  assert.deepEqual(differences('other main answer refusals', rest, ['NOT_THE_FOLDER_SHOWN', 'NOT_A_FOLDER', QUIT_BEGUN, EXPORT_TARGET_IN_HARNESS]), []);
  assert.ok(!(ENGINE_MAIN_ANSWER_REFUSAL_CODES as readonly string[]).includes(UNKNOWN_BUNDLE_MARK), 'the worker mark is mapped to UNKNOWN_BUNDLE and never answered');
});

test('the steps of the contract are the causes of a stopped worker and the read timeout of the app', () => {
  assert.deepEqual(differences('worker causes', ENGINE_REFUSAL_STEPS.filter(c => c.startsWith('WORKER_')), WORKER_CAUSES), []);
  assert.ok(ENGINE_REFUSAL_STEPS.includes('READ_TIMED_OUT'));
});

test('a refusal of the app is a refusal of the contract, with its optional drift and step', () => {
  const fromApp: AppRefusal = { code: 'FAILED', message: 'words', paths: [], step: 'WORKER_CRASHED', drift: [] };
  const asContract: ApiRefusal = fromApp;
  assert.equal(asContract.step, 'WORKER_CRASHED');
});
