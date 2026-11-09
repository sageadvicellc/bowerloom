// The shape suite of the engine API. It takes a factory that makes one implementation of the bridge, so the sample engine runs it today and the real library can run
// the same suite later by passing its own factory. Nothing here names the sample.
//
// For every call of the contract the suite asserts that the call exists, takes the contract's argument count, and answers with a value of the contract's return kind or
// with a refusal code of the contract. A runtime spy fails the suite if any call opens a port. The other named outcome, CANCELLED, needs a dialog that a person closes,
// so a subject with dialogs tests it in its own file. The sample has no dialogs and answers as main does after a yes.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_API_CALLS, ENGINE_CALL_REFUSAL_CODES, ENGINE_CODE_FORMAT, NOT_THE_PLAN_SHOWN } from '../../../../packages/engine-api/src/index.js';
import type { CallSpec, ReturnKind } from '../../../../packages/engine-api/src/index.js';
import type { EngineBridge } from '../../shared/engine/types.js';
import { installPortSpy } from './no-port-spy.js';
import type { PortSpy } from './no-port-spy.js';

/** One implementation to test: how to make a fresh one, and the ids it knows (a folder, a notes folder, a bundle). */
export interface ShapeSubject {
  readonly label: string;
  make(): EngineBridge;
  readonly ids: { readonly folder: string; readonly notes: string };
  /**
   * True when the implementation declares every parameter its call takes, so the declared count must be the contract's count (an optional extra argument counts too). The
   * sample ignores the arguments it does not use and declares fewer, for example `recordCheck: () => ...`. For it the declared count may be lower, never higher. The wire
   * (main/engine-ipc.ts) is where the exact count is enforced, and engine-api-contract.test.ts holds that count.
   */
  readonly declaresEveryParameter?: boolean;
}

const REVISION = 'a'.repeat(64);
const INPUT = { engines: ['claude-code'], reconcile: 'accept-agents', writeClaudeMd: false, approve: [] };
const CHOICES = { picks: {}, acknowledged: [] };
const NOTE_CHOICES = { link: {}, leave: [] };

/** Arguments of the right count for every call. A test checks each list has the contract's count, so a change to the contract shows here first. */
export function goodArguments(ids: ShapeSubject['ids']): Readonly<Record<string, readonly unknown[]>> {
  const F = ids.folder, N = ids.notes;
  return {
    folders: [], chooseFolder: [], planAdoption: [F, CHOICES], runAdoption: [F, REVISION, CHOICES, []], planAdoptionRecovery: [F], runAdoptionRecovery: [F, REVISION],
    planProjection: [F, INPUT], runProjection: [F, REVISION, INPUT], planRemoval: [F], runRemoval: [F, REVISION], planRecovery: [F, []], runRecovery: [F, REVISION, []],
    planMerge: [F], runMerge: [F, REVISION], recordCheck: ['yes', null],
    planSave: [F, []], runSave: [F, REVISION, []], listVersions: [F], planRestore: [F, 'v1'], runRestore: [F, REVISION, 'v1'], planSetAside: [F], runSetAside: [F, REVISION],
    chooseNotesFolder: ['use'], notesSummary: [N], planCreateNotes: [N], runCreateNotes: [N, REVISION], planNotesHistory: [N], runNotesHistory: [N, REVISION], openNotesReport: [N],
    planExport: [F], runExport: [F, REVISION, null], chooseBundle: [], planImport: [F, 'bundle-1', NOTE_CHOICES], runImport: [F, REVISION, 'bundle-1', NOTE_CHOICES, null],
    discardBundle: ['bundle-1'], savedScan: [], checkSavedScan: [], showStartCommand: [F, 'claude-code', 'Start here'], startCommandToClipboard: [F, 'claude-code', 'Start here'],
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What is wrong with an Answer: empty when it is `{ ok: true, value }` or `{ ok: false, refusal: { code, message, paths } }` with a code in the code format. */
export function answerProblems(v: unknown): string[] {
  if (!isRecord(v)) return ['not an object'];
  if (v['ok'] === true) return 'value' in v ? [] : ['ok answer without a value'];
  if (v['ok'] !== false) return ['ok is not a boolean'];
  const r = v['refusal'];
  if (!isRecord(r)) return ['refusal is not an object'];
  const out: string[] = [];
  if (typeof r['code'] !== 'string' || !ENGINE_CODE_FORMAT.test(r['code'])) out.push(`refusal code is not in the code format: ${String(r['code'])}`);
  if (typeof r['message'] !== 'string' || r['message'] === '') out.push('refusal has no words');
  if (!Array.isArray(r['paths']) || !r['paths'].every(p => typeof p === 'string')) out.push('refusal paths is not a list of strings');
  return out;
}

/** What is wrong with a returned value for a return kind. Empty when it fits. */
export function returnProblems(kind: ReturnKind, v: unknown): string[] {
  switch (kind) {
    case 'answer': return answerProblems(v);
    case 'answer-or-null': return v === null ? [] : answerProblems(v);
    case 'list': return Array.isArray(v) ? [] : ['not a list'];
    case 'boolean': return typeof v === 'boolean' ? [] : ['not a boolean'];
    case 'saved-scan': return isRecord(v) && typeof v['status'] === 'string' ? [] : ['no status'];
    case 'saved-scan-check': return typeof v === 'string' && v !== '' ? [] : ['not a word'];
    default: return [`unknown return kind ${String(kind)}`];
  }
}

/** Calls once and settles: a value, or the code of a thrown call refusal (the message is the code, as the IPC layer sends it). */
export async function settle(bridge: EngineBridge, name: string, args: readonly unknown[]): Promise<{ value: unknown } | { code: string }> {
  try {
    const fn = (bridge as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!;
    return { value: await Promise.resolve().then(() => fn.apply(bridge, [...args])) };
  } catch (error) {
    return { code: error instanceof Error ? error.message : String(error) };
  }
}

/** The reasons a settled call does not fit the contract. Empty when it does. */
export function settledProblems(spec: CallSpec, outcome: { value: unknown } | { code: string }): string[] {
  if ('code' in outcome) return (ENGINE_CALL_REFUSAL_CODES as readonly string[]).includes(outcome.code) ? [] : [`${spec.name} threw ${outcome.code}, which is not a call refusal of the contract`];
  return returnProblems(spec.returns, outcome.value).map(p => `${spec.name}: ${p}`);
}

/** What is wrong with the number of parameters a function declares: more than the call takes is always wrong. Fewer is wrong only when the subject declares every parameter. */
export function declaredCountProblems(spec: CallSpec, declared: number, strict: boolean): string[] {
  const most = spec.arity + spec.optionalArgs, least = strict ? spec.arity : 0;
  return declared >= least && declared <= most ? [] : [`${spec.name} declares ${declared} parameters, the contract allows ${least} to ${most}`];
}

export function defineShapeSuite(subject: ShapeSubject): void {
  describe(`engine API shape: ${subject.label}`, () => {
    let spy: PortSpy;
    before(() => { spy = installPortSpy(); });
    after(() => {
      spy.restore();
      assert.deepEqual(spy.hits, [], 'no call opened a port');
    });
    const args = goodArguments(subject.ids);

    test('the bridge holds exactly the calls of the contract, and a mode', () => {
      const bridge = subject.make();
      const functions = Object.entries(bridge).filter(([, v]) => typeof v === 'function').map(([k]) => k).sort();
      assert.deepEqual(functions, ENGINE_API_CALLS.map(c => c.name).sort());
      assert.ok(bridge.mode === 'sample' || bridge.mode === 'real');
    });

    test('the argument lists of the suite have the count of the contract', () => {
      assert.deepEqual(Object.keys(args).sort(), ENGINE_API_CALLS.map(c => c.name).sort());
      for (const spec of ENGINE_API_CALLS) assert.equal(args[spec.name]!.length, spec.arity, spec.name);
    });

    for (const spec of ENGINE_API_CALLS) {
      test(`${spec.name} takes ${spec.arity} argument${spec.arity === 1 ? '' : 's'}`, () => {
        const fn = (subject.make() as unknown as Record<string, unknown>)[spec.name];
        assert.equal(typeof fn, 'function');
        const length = (fn as (...a: unknown[]) => unknown).length;
        assert.deepEqual(declaredCountProblems(spec, length, subject.declaresEveryParameter === true), []);
      });

      test(`${spec.name} answers a ${spec.returns} or a call refusal of the contract`, async () => {
        const outcome = await settle(subject.make(), spec.name, args[spec.name]!);
        assert.deepEqual(settledProblems(spec, outcome), []);
        assert.deepEqual(spy.hits, []);
      });

      if (spec.arity > 0) {
        test(`${spec.name} refuses an unknown id or a bad argument with a code of the contract, or answers a refusal in the code format`, async () => {
          const bad = args[spec.name]!.map(() => ({ not: 'an id' }));
          const outcome = await settle(subject.make(), spec.name, bad);
          assert.deepEqual(settledProblems(spec, outcome), []);
          assert.deepEqual(spy.hits, []);
        });
      }
    }

    test('a write named for a revision that is not the plan shown last is the named outcome NOT_THE_PLAN_SHOWN', async () => {
      const bridge = subject.make();
      const plan = await settle(bridge, 'planExport', args['planExport']!);
      assert.ok('value' in plan, 'the plan call answers');
      const outcome = await settle(bridge, 'runExport', args['runExport']!);
      assert.ok('value' in outcome, 'the write answers');
      const answer = outcome.value as { ok: boolean; refusal?: { code: string } };
      assert.equal(answer.ok, false);
      assert.equal(answer.refusal?.code, NOT_THE_PLAN_SHOWN);
    });

    test('every call, run in a row on one bridge, keeps answering in shape', async () => {
      const bridge = subject.make();
      for (const spec of ENGINE_API_CALLS) assert.deepEqual(settledProblems(spec, await settle(bridge, spec.name, args[spec.name]!)), []);
    });
  });
}
