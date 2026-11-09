// The engine API contract (packages/engine-api) against the real lists of the app. The package never imports apps/desktop, so the comparison lives here.
// Names are compared as sets, so the order of a list does not matter, and no count is written into a test: the real list is the measure.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANCELLED, ENGINE_ARITY, ENGINE_CALLS, ENGINE_CALL_REFUSALS, ENGINE_CHANNELS, KIT_MAIN_WORDS, NOTES_MAIN_WORDS, NOT_THE_PLAN_SHOWN, REPORT_MAIN_WORDS, SAVE_MAIN_WORDS, SHARE_MAIN_WORDS,
} from '../shared/engine/types.js';
import { REAL_CALLS, REAL_CHANNELS } from '../shared/real/types.js';
import { APP_INDEX } from '../main/security.js';
import { registerRealIpc } from '../main/real-ipc.js';
import type { RealEvent } from '../main/real-ipc.js';
import { REAL_BASE } from '../shared/harness/route.js';
import {
  CANCELLED as API_CANCELLED, ENGINE_API_CALLS, ENGINE_CALL_REFUSAL_CODES, ENGINE_MAIN_REFUSAL_CODES, NAMED_OUTCOMES, NOT_THE_PLAN_SHOWN as API_NOT_THE_PLAN_SHOWN, READER_API_CALLS,
} from '../../../packages/engine-api/src/index.js';
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
