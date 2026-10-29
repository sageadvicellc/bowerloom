// Step 5 review fixes in the app (items 4, 7, and 8 of the fix list): a stopped merge blocks install and removal, a tick is kept as an approval draft only
// when the write runs after main's dialog, the dialog says how many lines were approved, and a draft that cannot be cleared after a good write is a
// warning the window shows. Synthetic folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyInstructionMergeWith, planInstructionMerge } from '../../../packages/adoption/src/merge.js';
import { readPortableReceipt } from '../../../packages/project-sync/src/index.js';
import { harnessStateDirs } from '../../../packages/project-sync/src/harness-state.js';
import type { HarnessStateDirs } from '../../../packages/project-sync/src/harness-state.js';
import { addApprovalDraft, readApprovalDrafts } from '../../../packages/project-sync/src/harness-approvals.js';
import { loadDefinition } from '../../../packages/harness-definition/src/index.js';
import { createEngineService } from '../main/engine-service.js';
import type { EngineService } from '../main/engine-service.js';
import type { Answer, ProjectAnswer, ProjectInput } from '../shared/engine/types.js';
import { tempDir } from './support.js';
import { definedFolder, filesOf, homeFolder } from './helpers-engine/folders.js';

const WHEN = new Date('2026-10-28T12:00:00Z');
const INPUT: ProjectInput = { engines: ['claude-code', 'codex'], reconcile: 'accept-agents', writeClaudeMd: false, approve: [] };
const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null); if (!a.ok) assert.fail(`${a.refusal.code} ${a.refusal.message}`); return a.value; };
const crash = (): Error => Object.assign(new Error('simulated crash'), { crash: true });

interface Asked { title: string; message: string; detail: string }
interface Setup { home: string; stateRoot: string; asked: Asked[]; answer: { yes: boolean; onAsk: (() => void) | null }; make(next: () => string | null): EngineService }
function setup(t: test.TestContext): Setup {
  const home = homeFolder(tempDir(t, 'bowerloom-review-fixes-'));
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
type Approve = Extract<ProjectAnswer, { kind: 'approve' }>;
const planOf = (a: ProjectAnswer): Extract<ProjectAnswer, { kind: 'plan' }>['plan'] => { assert.equal(a.kind, 'plan'); return (a as Extract<ProjectAnswer, { kind: 'plan' }>).plan; };
async function ticked(service: EngineService, id: string, base: ProjectInput = INPUT): Promise<ProjectInput> {
  const ask = value(await service.planProjection(id, base)) as Approve;
  return { ...base, approve: ask.lines.map(l => l.key) };
}

test('item 8: planning with ticks writes no draft; a cancelled dialog and a plan that is not the shown one leave none; the yes keeps them, then the receipt drops them', async t => {
  const s = setup(t), dir = definedFolder(s.home);
  const { service, id, dirs } = await chosen(s, dir);
  const input = await ticked(service, id);
  const plan = planOf(value(await service.planProjection(id, input)));
  assert.deepEqual(readApprovalDrafts(dirs, dir), [], 'planning keeps the ticks in memory only');
  // A write that names another revision is refused before anything is kept.
  const other = await service.runProjection(id, 'a'.repeat(64), input);
  assert.ok(!other.ok); assert.equal(other.refusal.code, 'NOT_THE_PLAN_SHOWN');
  assert.deepEqual(readApprovalDrafts(dirs, dir), []);
  // A "no" in main's dialog keeps nothing either, and the command line counts nothing.
  s.answer.yes = false;
  const no = await service.runProjection(id, plan.revision, input);
  assert.ok(!no.ok); assert.equal(no.refusal.code, 'CANCELLED');
  assert.deepEqual(readApprovalDrafts(dirs, dir), [], 'a cancelled install leaves no approval behind');
  // The yes: nothing is on disk when main asks; the draft is kept after, then the receipt records the lines and the drafts go.
  s.answer.yes = true;
  const again = planOf(value(await service.planProjection(id, input)));
  assert.equal(again.revision, plan.revision, 'the same ticks give the same plan');
  let atAsk = -1;
  s.answer.onAsk = () => { atAsk = readApprovalDrafts(dirs, dir).length; };
  const done = value(await service.runProjection(id, again.revision, input));
  s.answer.onAsk = null;
  assert.equal(atAsk, 0, 'nothing was kept when main asked');
  assert.equal(done.warnings, undefined);
  assert.deepEqual(readApprovalDrafts(dirs, dir), []);
  const receipt = readPortableReceipt({ projectDir: dir, stateDir: dirs.portable })!;
  assert.equal(receipt.approvals.length, 2);
  assert.ok(receipt.approvals.every(a => a.when === '2026-10-28T12:00:00Z'), 'the time the plan had');
});

test('item 8: the dialog says how many lines the person approved, and says nothing of lines when none were', async t => {
  const s = setup(t), dir = definedFolder(s.home);
  const { service, id } = await chosen(s, dir);
  const input = await ticked(service, id);
  const plan = planOf(value(await service.planProjection(id, input)));
  value(await service.runProjection(id, plan.revision, input));
  const text = s.asked.at(-1)!;
  assert.match(text.detail, /You approved 2 lines that an interface carries more weakly than the harness says\./);
  // The same folder installed again with nothing changed is a no-op: no dialog. A different folder without any weaker line has no count.
  const clean = definedFolder(s.home, 'plain');
  const second = await chosen(s, clean);
  const approved = await ticked(second.service, second.id);
  value(await second.service.planProjection(second.id, approved));
  assert.doesNotMatch(s.asked.at(-1)!.detail, /You approved 0/);
});

test('item 8: a draft the command line accepted counts in the app without a tick, and the write keeps nothing of its own', async t => {
  const s = setup(t), dir = definedFolder(s.home);
  const { service, id, dirs } = await chosen(s, dir);
  const asked = (await service.planProjection(id, INPUT)) as { ok: true; value: Approve };
  const loaded = loadDefinition(join(dir, '.bowerloom'));
  assert.ok(loaded.ok);
  // Make the two drafts the command line would write for these lines, from what the plan shows.
  const input = { ...INPUT, approve: asked.value.lines.map(l => l.key) };
  const planned = planOf(value(await service.planProjection(id, input)));
  value(await service.runProjection(id, planned.revision, input));
  const receipt = readPortableReceipt({ projectDir: dir, stateDir: dirs.portable })!;
  for (const a of receipt.approvals) { const { when: _when, ...draft } = a; addApprovalDraft(dirs, dir, draft, { definition: loaded.definition, now: WHEN }); }
  assert.equal(readApprovalDrafts(dirs, dir).length, 2);
  const shared = value(await service.planProjection(id, INPUT));
  assert.equal(shared.kind, 'plan', 'no line to approve: the drafts on disk count');
});

test('item 7: approval drafts that cannot be cleared after an install or a removal are a warning the window gets, and the write stays done', async t => {
  const s = setup(t), dir = definedFolder(s.home);
  const { service, id, dirs } = await chosen(s, dir);
  // An install and a removal first, to learn the lines the command line would have accepted.
  const input = await ticked(service, id);
  value(await service.runProjection(id, planOf(value(await service.planProjection(id, input))).revision, input));
  const approvals = readPortableReceipt({ projectDir: dir, stateDir: dirs.portable })!.approvals;
  value(await service.runRemoval(id, value(await service.planRemoval(id)).revision));
  const loaded = loadDefinition(join(dir, '.bowerloom'));
  assert.ok(loaded.ok);
  for (const a of approvals) { const { when: _when, ...draft } = a; addApprovalDraft(dirs, dir, draft, { definition: loaded.definition, now: WHEN }); }
  assert.equal(readApprovalDrafts(dirs, dir).length, 2);
  // The record folder cannot be changed any more: the drafts file cannot be removed, but the portable record can still be written.
  mkdirSync(dirs.portable, { recursive: true, mode: 0o700 });
  chmodSync(dirs.base, 0o500);
  try {
    const plan = planOf(value(await service.planProjection(id, INPUT)));
    const done = value(await service.runProjection(id, plan.revision, INPUT));
    assert.ok(readPortableReceipt({ projectDir: dir, stateDir: dirs.portable }) !== null, 'the install is done');
    assert.ok(done.written.length > 0);
    assert.equal(done.warnings?.length, 1);
    assert.match(done.warnings![0]!, /^approval drafts not cleared \([A-Z_]+\); run bowerloom harness status$/);
    // The same for a removal: the drafts are still there, so the removal is done and warns.
    const removed = value(await service.runRemoval(id, value(await service.planRemoval(id)).revision));
    assert.ok(removed.deleted.length + removed.restored.length > 0);
    assert.equal(removed.warnings?.length, 1);
    assert.match(removed.warnings![0]!, /^approval drafts not cleared \([A-Z_]+\); run bowerloom harness status$/);
    assert.equal(readPortableReceipt({ projectDir: dir, stateDir: dirs.portable }), null, 'the removal is done');
  } finally { chmodSync(dirs.base, 0o700); }
});

test('item 4: a merge that stopped part way blocks the install and the removal, in the plan and in the write', async t => {
  const s = setup(t), dir = definedFolder(s.home), before = filesOf(dir);
  const { service, id, dirs } = await chosen(s, dir);
  const keepBoth: ProjectInput = { ...INPUT, reconcile: 'keep-both' };
  const input = await ticked(service, id, keepBoth);
  const plan = planOf(value(await service.planProjection(id, input)));
  // A projection is shown, then a merge stops part way.
  const io = { projectDir: dir, stateDir: dirs.adoption };
  await assert.rejects(applyInstructionMergeWith(io, planInstructionMerge(io).revision, new AbortController().signal, { afterWrite: () => { throw crash(); } }), /simulated crash/);
  assert.notDeepEqual(filesOf(dir), before);
  const asked = s.asked.length;
  const run = await service.runProjection(id, plan.revision, input);
  assert.ok(!run.ok); assert.equal(run.refusal.code, 'ADOPTION_RECOVERY_REQUIRED');
  assert.match(run.refusal.message, /bowerloom harness recover --adoption/);
  assert.equal(s.asked.length, asked, 'main did not even ask');
  const again = await service.planProjection(id, input);
  assert.ok(!again.ok); assert.equal(again.refusal.code, 'ADOPTION_RECOVERY_REQUIRED');
  const removal = await service.planRemoval(id);
  assert.ok(!removal.ok); assert.equal(removal.refusal.code, 'ADOPTION_RECOVERY_REQUIRED');
  assert.match(removal.refusal.message, /bowerloom harness recover --adoption/);
  const removed = await service.runRemoval(id, 'b'.repeat(64));
  assert.ok(!removed.ok); assert.equal(removed.refusal.code, 'ADOPTION_RECOVERY_REQUIRED');
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), '# Demo for Claude\n\nUse pnpm.\n', 'CLAUDE.md was never touched');
});
