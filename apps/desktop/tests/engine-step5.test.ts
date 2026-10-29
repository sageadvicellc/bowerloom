// Step 5 of the app side (decisions 7B, D2A, D3A, D4A, D5A): the app keeps its records in the shared layout the command line uses, moves the record of the
// earlier app once, refuses plainly when both records exist, shares approval drafts with the command line, runs Merge as a definition edit after its own
// dialog, puts a stopped merge back through the adoption recovery, and offers Restore mode and Keep new mode on a mode drift line. Synthetic folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { applyInstructionMergeWith, planInstructionMerge } from '../../../packages/adoption/src/merge.js';
import { applyPortable, planPortable, readPortableReceipt } from '../../../packages/project-sync/src/index.js';
import { harnessStateDirs } from '../../../packages/project-sync/src/harness-state.js';
import type { HarnessStateDirs } from '../../../packages/project-sync/src/harness-state.js';
import { addApprovalDraft, readApprovalDrafts } from '../../../packages/project-sync/src/harness-approvals.js';
import { loadDefinition } from '../../../packages/harness-definition/src/index.js';
import { createEngineService } from '../main/engine-service.js';
import type { EngineService } from '../main/engine-service.js';
import { ENGINE_ARITY, ENGINE_CALLS } from '../shared/engine/types.js';
import type { Answer, ProjectAnswer, ProjectInput, RecoveryChoices } from '../shared/engine/types.js';
import { tempDir } from './support.js';
import { definedFolder, filesOf, homeFolder } from './helpers-engine/folders.js';

const WHEN = new Date('2026-10-28T12:00:00Z');
const INPUT: ProjectInput = { engines: ['claude-code', 'codex'], reconcile: 'accept-agents', writeClaudeMd: false, approve: [] };
const NONE: RecoveryChoices = { keep: [], restoreMode: [], recordMode: [] };
const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null); if (!a.ok) assert.fail(`${a.refusal.code} ${a.refusal.message}`); return a.value; };
const crash = (): Error => Object.assign(new Error('simulated crash'), { crash: true });
const modeOf = (p: string): number => statSync(p).mode & 0o777;

interface Asked { title: string; message: string; detail: string }
interface Setup { home: string; stateRoot: string; asked: Asked[]; answer: { yes: boolean; onAsk: (() => void) | null }; make(next: () => string | null): EngineService }
function setup(t: test.TestContext): Setup {
  const home = homeFolder(tempDir(t, 'bowerloom-step5-'));
  const asked: Asked[] = [], answer: Setup['answer'] = { yes: true, onAsk: null }, stateRoot = join(home, '.local', 'state', 'bowerloom');
  const make = (next: () => string | null): EngineService => createEngineService({
    home, stateRoot, chooseFolder: async () => next(), who: 'tester', now: () => WHEN,
    confirm: async q => { asked.push(q); answer.onAsk?.(); return answer.yes; },
  });
  return { home, stateRoot, asked, answer, make };
}
async function chosen(s: Setup, dir: string): Promise<{ service: EngineService; id: string; dirs: HarnessStateDirs }> {
  const service = s.make(() => dir);
  return { service, id: value(await service.chooseFolder()).id, dirs: harnessStateDirs(s.stateRoot, dir) };
}
const planOf = (a: ProjectAnswer): Extract<ProjectAnswer, { kind: 'plan' }>['plan'] => { assert.equal(a.kind, 'plan'); return (a as Extract<ProjectAnswer, { kind: 'plan' }>).plan; };
async function installed(service: EngineService, id: string): Promise<ProjectInput> {
  const ask = value(await service.planProjection(id, INPUT)) as Extract<ProjectAnswer, { kind: 'approve' }>;
  const input = { ...INPUT, approve: ask.lines.map(l => l.key) };
  value(await service.runProjection(id, planOf(value(await service.planProjection(id, input))).revision, input));
  return input;
}

test('the calls of Merge are named, each with its own argument count', () => {
  assert.ok(ENGINE_CALLS.includes('planMerge') && ENGINE_CALLS.includes('runMerge'));
  assert.equal(ENGINE_ARITY.planMerge, 1); assert.equal(ENGINE_ARITY.runMerge, 2);
});

test('7B: the record of the earlier app moves once into the shared layout when its folder is chosen, and stays valid', async t => {
  const s = setup(t), dir = definedFolder(s.home), before = filesOf(dir);
  const dirs = harnessStateDirs(s.stateRoot, dir);
  // The earlier app installed for Claude Code, with its record at desktop/<path hash>/portable.
  mkdirSync(dirs.legacy, { recursive: true, mode: 0o700 });
  const io = { projectDir: dir, definitionFolder: join(dir, '.bowerloom'), stateDir: join(dirs.legacy, 'portable'), engines: [{ id: 'claude-code' as const }] };
  await applyPortable(io, planPortable(io).revision);
  const { service, id } = await chosen(s, dir);
  assert.equal(existsSync(dirs.legacy), false, 'the old folder is gone');
  assert.equal(existsSync(join(dirs.base, 'moved.json')), true, 'the move is recorded');
  assert.ok(readPortableReceipt({ projectDir: dir, stateDir: dirs.portable }) !== null, 'the receipt is at the shared path');
  assert.equal((await service.folders())[0]!.projected, true);
  // A second session finds nothing to move, and the moved record removes what the earlier app wrote.
  const again = await chosen(s, dir);
  assert.equal((await again.service.folders())[0]!.projected, true);
  const removal = value(await service.planRemoval(id));
  value(await service.runRemoval(id, removal.revision));
  assert.deepEqual(filesOf(dir), before);
});

test('7B: both records present is a plain refusal on choosing the folder; nothing moves and the folder is not listed', async t => {
  const s = setup(t), dir = definedFolder(s.home), dirs = harnessStateDirs(s.stateRoot, dir);
  mkdirSync(dirs.legacy, { recursive: true, mode: 0o700 });
  mkdirSync(dirs.base, { recursive: true, mode: 0o700 });
  const service = s.make(() => dir);
  const a = await service.chooseFolder();
  assert.ok(a !== null && !a.ok);
  assert.equal(a.refusal.code, 'HARNESS_STATE_TWO_RECORDS');
  assert.match(a.refusal.message, /Two private records exist for this folder/);
  assert.equal(JSON.stringify(a).includes(s.home), false, 'no absolute path');
  assert.deepEqual(await service.folders(), []);
  assert.ok(existsSync(dirs.legacy) && existsSync(dirs.base));
});

test('D2A, D3A: a tick in the app is a record in memory until main\'s dialog says yes, a draft on disk counts in the app, and an install or a removal drops them', async t => {
  const s = setup(t), dir = definedFolder(s.home);
  const { service, id, dirs } = await chosen(s, dir);
  const ask = value(await service.planProjection(id, INPUT)) as Extract<ProjectAnswer, { kind: 'approve' }>;
  assert.equal(ask.lines.length, 2);
  assert.deepEqual(readApprovalDrafts(dirs, dir), [], 'a plan with no tick writes no draft');
  const input = { ...INPUT, approve: ask.lines.map(l => l.key) };
  const first = planOf(value(await service.planProjection(id, input)));
  assert.deepEqual(readApprovalDrafts(dirs, dir), [], 'a plan with ticks writes no draft either (item 8)');
  // Another session (or the command line) has no draft to plan with, so it asks for the lines again.
  const other = await chosen(s, dir);
  const apart = value(await other.service.planProjection(other.id, INPUT)) as Extract<ProjectAnswer, { kind: 'approve' }>;
  assert.equal(apart.kind, 'approve');
  const loaded = loadDefinition(join(dir, '.bowerloom'));
  assert.ok(loaded.ok);
  const asked = s.asked.length;
  value(await service.runProjection(id, first.revision, input));
  assert.equal(s.asked.length, asked + 1, 'main asked before it wrote');
  assert.deepEqual(readApprovalDrafts(dirs, dir), [], 'the receipt records them, so the drafts go');
  const receipt = readPortableReceipt({ projectDir: dir, stateDir: dirs.portable })!;
  assert.equal(receipt.approvals.length, 2);
  assert.ok(receipt.approvals.every(a => a.who === 'tester' && a.when === '2026-10-28T12:00:00Z'));
  // A draft left on disk goes with a removal.
  const { when: _when, ...draft } = receipt.approvals[0]!;
  addApprovalDraft(dirs, dir, draft, { definition: loaded.definition, now: WHEN });
  assert.equal(readApprovalDrafts(dirs, dir).length, 1);
  const removal = value(await other.service.planRemoval(other.id));
  value(await other.service.runRemoval(other.id, removal.revision));
  assert.deepEqual(readApprovalDrafts(dirs, dir), []);
});

test('D4A: Merge plans a definition edit, asks in main\'s own dialog before it writes, and the install that follows accepts AGENTS.md', async t => {
  const s = setup(t), dir = definedFolder(s.home), before = filesOf(dir);
  const { service, id } = await chosen(s, dir);
  const instructions = join(dir, '.bowerloom', 'instructions', 'AGENTS.md'), original = readFileSync(instructions, 'utf8');
  const plan = value(await service.planMerge(id));
  assert.deepEqual(plan.files, [{ path: '.bowerloom/instructions/AGENTS.md', action: 'update' }]);
  assert.equal(plan.addsPart, false);
  assert.equal(plan.heading, 'From CLAUDE.md');
  assert.equal(plan.claude, '# Demo for Claude\n\nUse pnpm.\n');
  assert.equal(plan.folder, '~/Projects/defined');
  assert.equal(JSON.stringify(plan).includes(s.home), false);
  assert.deepEqual(filesOf(dir), before, 'a plan writes nothing');
  // A write that names another revision, or a "no", writes nothing.
  const other = await service.runMerge(id, 'a'.repeat(64));
  assert.ok(!other.ok); assert.equal(other.refusal.code, 'NOT_THE_PLAN_SHOWN');
  s.answer.yes = false;
  const no = await service.runMerge(id, plan.revision);
  assert.ok(!no.ok); assert.equal(no.refusal.code, 'CANCELLED');
  assert.equal(s.asked.at(-1)!.title, 'Merge CLAUDE.md into the harness');
  assert.equal(s.asked.at(-1)!.message, 'Write 1 file into ~/Projects/defined/.bowerloom?');
  assert.deepEqual(filesOf(dir), before);
  // The yes: the dialog comes before the write.
  s.answer.yes = true;
  const again = value(await service.planMerge(id));
  let atAsk = '';
  s.answer.onAsk = () => { atAsk = readFileSync(instructions, 'utf8'); };
  const done = value(await service.runMerge(id, again.revision));
  s.answer.onAsk = null;
  assert.equal(atAsk, original, 'nothing was written when main asked');
  assert.deepEqual(done.written, ['.bowerloom/instructions/AGENTS.md']);
  assert.match(readFileSync(instructions, 'utf8'), /## From CLAUDE\.md\n\n# Demo for Claude\n\nUse pnpm\.\n$/);
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), '# Demo for Claude\n\nUse pnpm.\n', 'CLAUDE.md does not change yet');
  // A second merge has nothing to move, and says so.
  const nothing = await service.planMerge(id);
  assert.ok(!nothing.ok); assert.equal(nothing.refusal.code, 'ADOPTION_MERGE_NOTHING');
  // The install that follows: Accept AGENTS.md, with its own plan and its own dialog.
  const asks = s.asked.length;
  await installed(service, id);
  assert.equal(s.asked.length, asks + 1);
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /Use pnpm\./);
});

test('D4A: a merge that stopped part way is put back through the recovery of a stopped harness', async t => {
  const s = setup(t), dir = definedFolder(s.home), before = filesOf(dir);
  const { service, id, dirs } = await chosen(s, dir);
  const input = { projectDir: dir, stateDir: dirs.adoption };
  await assert.rejects(applyInstructionMergeWith(input, planInstructionMerge(input).revision, new AbortController().signal, { afterWrite: () => { throw crash(); } }), /simulated crash/);
  assert.notDeepEqual(filesOf(dir), before, 'the stopped merge left its write');
  assert.equal((await service.folders())[0]!.unfinished.adoption, true);
  const merge = await service.planMerge(id);
  assert.ok(!merge.ok); assert.equal(merge.refusal.code, 'ADOPTION_RECOVERY_REQUIRED');
  const plan = value(await service.planAdoptionRecovery(id));
  assert.equal(plan.kind, 'merge');
  assert.deepEqual(plan.restore, ['.bowerloom/instructions/AGENTS.md']);
  assert.deepEqual(plan.remove, []);
  s.answer.yes = false;
  const no = await service.runAdoptionRecovery(id, plan.revision);
  assert.ok(!no.ok); assert.equal(no.refusal.code, 'CANCELLED');
  assert.match(s.asked.at(-1)!.message, /^Put back 1 file that a stopped merge changed in ~\/Projects\/defined\/\.bowerloom\?$/);
  s.answer.yes = true;
  const done = value(await service.runAdoptionRecovery(id, plan.revision));
  assert.deepEqual(done.restored, ['.bowerloom/instructions/AGENTS.md']);
  assert.deepEqual(filesOf(dir), before);
  assert.equal((await service.folders())[0]!.unfinished.adoption, false);
});

test('D5A: a mode drift line has its own reason; Restore mode puts the recorded mode back after main\'s dialog', async t => {
  const s = setup(t), dir = definedFolder(s.home);
  const { service, id } = await chosen(s, dir);
  const input = await installed(service, id);
  const target = join(dir, 'AGENTS.md'), recorded = modeOf(target);
  chmodSync(target, 0o700);
  const drifted = await service.planProjection(id, input);
  assert.ok(!drifted.ok);
  assert.equal(drifted.refusal.code, 'PORTABLE_DRIFT');
  assert.deepEqual(drifted.refusal.drift, [{ path: 'AGENTS.md', reason: 'mode' }]);
  const choices: RecoveryChoices = { ...NONE, restoreMode: ['AGENTS.md'] };
  const plan = value(await service.planRecovery(id, choices));
  assert.equal(plan.action, 'mode');
  assert.deepEqual(plan.modes, [{ path: 'AGENTS.md', choice: 'restoreMode', now: '0700', recorded: `0${recorded.toString(8)}` }]);
  const wrong = await service.runRecovery(id, plan.revision, { ...NONE, recordMode: ['AGENTS.md'] });
  assert.ok(!wrong.ok); assert.equal(wrong.refusal.code, 'NOT_THE_PLAN_SHOWN');
  value(await service.runRecovery(id, plan.revision, choices));
  assert.equal(s.asked.at(-1)!.message, 'Restore or keep 1 file mode in ~/Projects/defined?');
  assert.equal(modeOf(target), recorded);
  assert.equal(planOf(value(await service.planProjection(id, input))).noop, true);
});

test('D5A: Keep new mode makes the receipt take the new mode; a group or world write mode is refused plainly', async t => {
  const s = setup(t), dir = definedFolder(s.home);
  const { service, id } = await chosen(s, dir);
  const input = await installed(service, id);
  const target = join(dir, 'AGENTS.md');
  chmodSync(target, 0o664);
  const unsafe = await service.planRecovery(id, { ...NONE, recordMode: ['AGENTS.md'] });
  assert.ok(!unsafe.ok);
  assert.equal(unsafe.refusal.code, 'PORTABLE_MODE_UNSAFE');
  assert.match(unsafe.refusal.message, /lets the group or others write it/);
  assert.deepEqual(unsafe.refusal.paths, ['AGENTS.md']);
  chmodSync(target, 0o600);
  const choices: RecoveryChoices = { ...NONE, recordMode: ['AGENTS.md'] };
  const plan = value(await service.planRecovery(id, choices));
  assert.equal(plan.modes[0]!.choice, 'recordMode');
  value(await service.runRecovery(id, plan.revision, choices));
  assert.equal(modeOf(target), 0o600);
  assert.equal(planOf(value(await service.planProjection(id, input))).noop, true);
});

test('recovery choices are checked: an old keep list still works, and an unknown field or a wrong type is refused before anything runs', async t => {
  const s = setup(t), dir = definedFolder(s.home);
  const { service, id } = await chosen(s, dir);
  await assert.rejects(service.planRecovery(id, { keep: [], restoreMode: [], recordMode: [], other: [] }), /BAD_ARGUMENT/);
  await assert.rejects(service.planRecovery(id, { keep: 'AGENTS.md', restoreMode: [], recordMode: [] }), /BAD_ARGUMENT/);
  await assert.rejects(service.planRecovery(id, null), /BAD_ARGUMENT/);
  const a = await service.planRecovery(id, []);
  assert.ok(!a.ok); assert.equal(a.refusal.code, 'PORTABLE_RECOVER_NOTHING');
  const b = await service.planRecovery(id, NONE);
  assert.ok(!b.ok); assert.equal(b.refusal.code, 'PORTABLE_RECOVER_NOTHING');
});
