// The shape suite of the engine API. It takes a factory that makes one implementation of the bridge, so the sample engine runs it today and the real library can run
// the same suite later by passing its own factory. Nothing here names the sample.
//
// For every call of the contract the suite asserts that the call exists (found by its name, so a class works as well as an object), declares the contract's parameter count,
// and answers with a value of the contract's return kind or with a refusal code of the contract. It also asserts that at least one call of each family (plan, read, save,
// export) succeeds with `ok: true`, so an engine whose every call refuses cannot pass. A runtime spy fails the suite if any call opens a port. The other named outcome,
// CANCELLED, needs a dialog that a person closes, so a subject with dialogs tests it in its own file. The sample has no dialogs and answers as main does after a yes.
//
// The count of arguments on the wire is not held here. main/engine-ipc.ts holds it, and tests/engine-api-shape.test.ts drives registerEngineIpc to prove it.
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
   * Default true: the implementation declares every parameter its call takes, so the declared count must be the contract's count (an optional extra argument counts
   * too). Set it to false only for an implementation that ignores the arguments it does not use and declares fewer, as the sample does (`recordCheck: () => ...`). The
   * declared count may then be lower, never higher, and the test says "takes at most N arguments".
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

/** True unless the subject says it declares fewer parameters than its calls take. */
export function isStrict(subject: Pick<ShapeSubject, 'declaresEveryParameter'>): boolean {
  return subject.declaresEveryParameter !== false;
}

/** The name of the parameter test: what it checks, said honestly. A loose test only bounds the count from above. */
export function parameterTestName(spec: CallSpec, strict: boolean): string {
  const most = spec.arity + spec.optionalArgs, plural = (n: number): string => (n === 1 ? '' : 's');
  if (!strict) return `${spec.name} takes at most ${most} argument${plural(most)}`;
  return `${spec.name} declares ${spec.optionalArgs === 0 ? String(spec.arity) : `${spec.arity} to ${most}`} parameter${spec.optionalArgs === 0 ? plural(most) : 's'}`;
}

/** What is wrong with the bridge as a whole: a call of the contract that is not a function, a function that is not a call of the contract, or a mode that is not a mode. */
export function bridgeProblems(bridge: EngineBridge): string[] {
  const problems: string[] = [];
  const holder = bridge as unknown as Record<string, unknown>;
  for (const spec of ENGINE_API_CALLS) if (typeof holder[spec.name] !== 'function') problems.push(`the bridge has no call ${spec.name}`);
  // Own functions and the methods of the classes the bridge comes from, so a class-based implementation is read the same way as an object.
  const names = new Set<string>();
  for (let o: object | null = bridge; o !== null && o !== Object.prototype; o = Object.getPrototypeOf(o) as object | null) {
    for (const name of Object.getOwnPropertyNames(o)) {
      if (name === 'constructor') continue;
      const d = Object.getOwnPropertyDescriptor(o, name);
      if (d !== undefined && typeof d.value === 'function') names.add(name);
    }
  }
  const known = new Set(ENGINE_API_CALLS.map(c => c.name));
  for (const name of names) if (!known.has(name)) problems.push(`the bridge has a function ${name} that is not a call of the contract`);
  if (bridge.mode !== 'sample' && bridge.mode !== 'real') problems.push(`the bridge mode is ${String(bridge.mode)}`);
  return problems;
}

type Probe = (bridge: EngineBridge, ids: ShapeSubject['ids']) => Promise<{ value: unknown } | { code: string }>;

/** The first call of a family that answers a plan, then the call that writes it with the revision the plan gave. */
const planThenRun = (plan: string, run: string, rest: (id: string, revision: string, acknowledge: unknown) => readonly unknown[]): Probe => async (bridge, ids) => {
  const arg = goodArguments(ids);
  const planned = await settle(bridge, plan, arg[plan]!);
  const view = 'value' in planned ? (planned.value as { ok?: boolean; value?: { revision?: string; acknowledge?: unknown } }) : null;
  if (view?.ok !== true || typeof view.value?.revision !== 'string') return planned;
  return settle(bridge, run, rest(ids.folder, view.value.revision, view.value.acknowledge ?? null));
};
const plain = (name: string, pick: 'folder' | 'notes'): Probe => (bridge, ids) => settle(bridge, name, [ids[pick]]);

/**
 * The families of calls, each with the calls that may prove it. A family passes when at least one of its probes answers `{ ok: true }`. The probes use only the ids the
 * subject gives and the revision a plan gives, so another implementation runs the same ones.
 */
export const SUCCESS_FAMILIES: readonly { readonly family: string; readonly probes: Readonly<Record<string, Probe>> }[] = Object.freeze([
  { family: 'plan', probes: { planSave: (b, ids) => settle(b, 'planSave', goodArguments(ids)['planSave']!), planExport: (b, ids) => settle(b, 'planExport', goodArguments(ids)['planExport']!) } },
  { family: 'read', probes: { listVersions: plain('listVersions', 'folder'), notesSummary: plain('notesSummary', 'notes') } },
  { family: 'save', probes: { runSave: planThenRun('planSave', 'runSave', (id, rev) => [id, rev, []]) } },
  { family: 'export', probes: { runExport: planThenRun('planExport', 'runExport', (id, rev, ack) => [id, rev, ack]) } },
]);

/** What is wrong with the success path of a bridge: one line for each family in which no call answered `{ ok: true }`. A bridge whose every call throws or refuses fails all four. */
export async function successProblems(bridge: EngineBridge, ids: ShapeSubject['ids']): Promise<string[]> {
  const problems: string[] = [];
  for (const { family, probes } of SUCCESS_FAMILIES) {
    const seen: string[] = [];
    let good = false;
    for (const [name, probe] of Object.entries(probes)) {
      const outcome = await probe(bridge, ids);
      if ('value' in outcome && isRecord(outcome.value) && outcome.value['ok'] === true && answerProblems(outcome.value).length === 0) { good = true; break; }
      seen.push(`${name} ${'code' in outcome ? `threw ${outcome.code}` : 'did not answer ok'}`);
    }
    if (!good) problems.push(`none of the ${family} calls answered ok: true (${seen.join(', ')})`);
  }
  return problems;
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

    test('the bridge holds exactly the calls of the contract, found by name, and a mode', () => {
      assert.deepEqual(bridgeProblems(subject.make()), []);
    });

    test('at least one call of each family (plan, read, save, export) succeeds with ok: true', async () => {
      assert.deepEqual(await successProblems(subject.make(), subject.ids), []);
      assert.deepEqual(spy.hits, []);
    });

    test('the argument lists of the suite have the count of the contract', () => {
      assert.deepEqual(Object.keys(args).sort(), ENGINE_API_CALLS.map(c => c.name).sort());
      for (const spec of ENGINE_API_CALLS) assert.equal(args[spec.name]!.length, spec.arity, spec.name);
    });

    for (const spec of ENGINE_API_CALLS) {
      test(parameterTestName(spec, isStrict(subject)), () => {
        const fn = (subject.make() as unknown as Record<string, unknown>)[spec.name];
        assert.equal(typeof fn, 'function');
        const length = (fn as (...a: unknown[]) => unknown).length;
        assert.deepEqual(declaredCountProblems(spec, length, isStrict(subject)), []);
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
