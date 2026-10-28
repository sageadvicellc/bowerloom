// Verification round of the consent rules (W1, W2, W4, W7, W9): main asks before every write that changes anything on disk, its record included; a folder
// label reaches the dialog and the window with hidden characters written out; an approval with no text to show is a block; an install line shows the
// entry's own text; and a "no" writes nothing for a removal, a recovery and the recovery of a stopped adoption.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { applyAdoptionWith } from '../../../packages/adoption/src/apply.js';
import { planAdoption } from '../../../packages/adoption/src/index.js';
import { applyPortableWith } from '../../../packages/project-sync/src/portable-run.js';
import { planPortable } from '../../../packages/project-sync/src/index.js';
import { createEngineService } from '../main/engine-service.js';
import type { EngineService } from '../main/engine-service.js';
import { approvalText } from '../main/engine-consent.js';
import { adoptCanWrite, adoptWaits, tickOf } from '../shared/engine/gates.js';
import { sampleEngineFixtures } from '../shared/engine/sample.js';
import type { AdoptView, Answer, ProjectAnswer, ProjectInput } from '../shared/engine/types.js';
import { tempDir } from './support.js';
import { definedFolder, engineFolder, filesOf, homeFolder } from './helpers-engine/folders.js';

const WHEN = new Date('2026-10-28T12:00:00Z');
const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null); if (!a.ok) assert.fail(`${a.refusal.code} ${a.refusal.message}`); return a.value; };
const INPUT: ProjectInput = { engines: ['claude-code', 'codex'], reconcile: 'accept-agents', writeClaudeMd: false, approve: [] };
const crash = (): Error => Object.assign(new Error('simulated crash'), { crash: true });

interface Asked { title: string; message: string; detail: string }
function setup(t: test.TestContext): { home: string; stateRoot: string; asked: Asked[]; answer: { yes: boolean }; make(next: () => string | null): EngineService } {
  const home = homeFolder(tempDir(t, 'bowerloom-consent2-'));
  const asked: Asked[] = [], answer = { yes: true }, stateRoot = join(home, '.local', 'state', 'bowerloom');
  const make = (next: () => string | null): EngineService => createEngineService({ home, stateRoot, chooseFolder: async () => next(), confirm: async q => { asked.push(q); return answer.yes; }, who: 'tester', now: () => WHEN });
  return { home, stateRoot, asked, answer, make };
}
const stateOf = (stateRoot: string, dir: string, kind: 'adoption' | 'portable'): string => join(stateRoot, 'desktop', createHash('sha256').update(dir).digest('hex').slice(0, 32), kind);
async function installed(service: EngineService, id: string): Promise<ProjectInput> {
  const ask = value(await service.planProjection(id, INPUT)) as Extract<ProjectAnswer, { kind: 'approve' }>;
  const input = { ...INPUT, approve: ask.lines.map(l => l.key) };
  const plan = (value(await service.planProjection(id, input)) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  value(await service.runProjection(id, plan.revision, input));
  return input;
}

test('W1: a plan that changes no file but is not a no-op (only the record changes) still asks, in its own words, and a "no" leaves the record as it was', async t => {
  const { home, stateRoot, asked, answer, make } = setup(t);
  const dir = definedFolder(home), service = make(() => dir), id = value(await service.chooseFolder()).id;
  const input = await installed(service, id);
  const receipt = join(stateOf(stateRoot, dir, 'portable'), 'receipt.json'), before = readFileSync(receipt, 'utf8');
  const h = JSON.parse(readFileSync(join(dir, '.bowerloom', 'harness.json'), 'utf8'));
  h.description = 'A changed description.';
  writeFileSync(join(dir, '.bowerloom', 'harness.json'), JSON.stringify(h, null, 2));
  const files = filesOf(dir);
  const plan = (value(await service.planProjection(id, input)) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  assert.equal(plan.noop, false, 'the record changes');
  assert.ok(plan.changes.every(c => c.action === 'unchanged'), 'no file changes');
  const count = asked.length;
  answer.yes = false;
  const no = await service.runProjection(id, plan.revision, input);
  assert.ok(!no.ok); assert.equal(no.refusal.code, 'CANCELLED');
  assert.equal(asked.length, count + 1, 'asked once');
  assert.equal(asked.at(-1)!.message, 'Update Bowerloom\'s record for ~/Projects/defined?');
  assert.equal(readFileSync(receipt, 'utf8'), before, 'the record is as it was');
  assert.deepEqual(filesOf(dir), files);
  // A plan that is a true no-op asks nothing, and writes nothing.
  answer.yes = true;
  const again = (value(await service.planProjection(id, input)) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  value(await service.runProjection(id, again.revision, input));
  const noop = (value(await service.planProjection(id, input)) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  assert.equal(noop.noop, true);
  const n = asked.length;
  value(await service.runProjection(id, noop.revision, input));
  assert.equal(asked.length, n, 'a no-op asks nothing');
});

test('W2: a folder name with a hidden character reaches the window and main\'s dialog written out', async t => {
  const { home, asked, make } = setup(t);
  const dir = definedFolder(home, 'repo‮txt.exe');
  const service = make(() => dir), info = value(await service.chooseFolder());
  assert.equal(info.label, '~/Projects/repo[U+202E]txt.exe');
  assert.equal(info.name, 'repo[U+202E]txt.exe');
  const ask = value(await service.planProjection(info.id, INPUT)) as Extract<ProjectAnswer, { kind: 'approve' }>;
  const input = { ...INPUT, approve: ask.lines.map(l => l.key) };
  const plan = (value(await service.planProjection(info.id, input)) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  assert.equal(plan.folder, '~/Projects/repo[U+202E]txt.exe');
  value(await service.runProjection(info.id, plan.revision, input));
  assert.ok(!JSON.stringify(asked).includes('‮'), 'the dialog has no hidden character');
  assert.match(asked.at(-1)!.message, /repo\[U\+202E\]txt\.exe/);
});

test('W7: each install line to approve shows the entry\'s own text from the harness', async t => {
  const { home, make } = setup(t);
  const dir = definedFolder(home), service = make(() => dir), id = value(await service.chooseFolder()).id;
  const ask = value(await service.planProjection(id, INPUT)) as Extract<ProjectAnswer, { kind: 'approve' }>;
  const guard = ask.lines.find(l => l.part === 'guardrails')!, hook = ask.lines.find(l => l.part === 'hooks')!;
  assert.match(guard.text, /"pattern": "git push --force \*"/);
  assert.match(hook.text, /"command": "echo check"/);
  assert.doesNotMatch(hook.text, /git push/);
  for (const l of sampleEngineFixtures().approveLines) assert.ok(l.text.length > 0, 'the sample shows text too');
});

test('W4: an adoption approval with no text to show is a block with a reason, and never tickable', () => {
  assert.deepEqual(approvalText('hooks/gone', new Map()), []);
  assert.deepEqual(approvalText('mcp/gone', new Map([['mcp.json', { bytes: Buffer.from('{"servers":[]}') }]])), []);
  const v = sampleEngineFixtures().adopt;
  const ready: AdoptView = { ...v, conflicts: v.conflicts.map(c => ({ ...c, picked: c.variants[0]!.key })), unmapped: v.unmapped.map(u => ({ ...u, acknowledged: true })), ready: true };
  const textless: AdoptView = { ...ready, approvals: ready.approvals.map(a => (a.key === 'mcp/mail' ? { ...a, text: [], blocked: 'Bowerloom cannot show the text this approval covers, so it cannot be approved here.' } : a)) };
  const ticks = textless.approvals.map(tickOf);
  assert.deepEqual(adoptWaits(textless, ticks), [{ kind: 'block', id: 'mcp/mail' }]);
  assert.equal(adoptCanWrite(textless, ticks), false);
  for (const a of v.approvals) assert.equal(a.blocked, null, `${a.key} has text, so it is not blocked`);
});

test('W9: a "no" in main\'s dialog writes nothing for a removal, a recovery, and the recovery of a stopped adoption', async t => {
  const { home, stateRoot, answer, make } = setup(t);
  // A removal.
  const dir = definedFolder(home), service = make(() => dir), id = value(await service.chooseFolder()).id;
  await installed(service, id);
  const files = filesOf(dir);
  const removal = value(await service.planRemoval(id));
  answer.yes = false;
  const r = await service.runRemoval(id, removal.revision);
  assert.ok(!r.ok); assert.equal(r.refusal.code, 'CANCELLED');
  assert.deepEqual(filesOf(dir), files);
  // A recovery of a stopped install.
  answer.yes = true;
  const other = definedFolder(home, 'stopped'), s2 = make(() => other), id2 = value(await s2.chooseFolder()).id;
  const ask = value(await s2.planProjection(id2, INPUT)) as Extract<ProjectAnswer, { kind: 'approve' }>;
  void ask;
  const portable = stateOf(stateRoot, other, 'portable');
  const io = { projectDir: other, definitionFolder: join(other, '.bowerloom'), stateDir: portable, engines: [{ id: 'claude-code' as const }] };
  const plan = planPortable(io);
  let steps = 0;
  await assert.rejects(applyPortableWith(io, plan.revision, new AbortController().signal, { afterStep: () => { if (++steps === 2) throw crash(); } }), /simulated crash/);
  assert.ok(existsSync(join(portable, 'pending.json')));
  const filesStopped = filesOf(other);
  const recovery = value(await s2.planRecovery(id2, []));
  answer.yes = false;
  const rr = await s2.runRecovery(id2, recovery.revision, []);
  assert.ok(!rr.ok); assert.equal(rr.refusal.code, 'CANCELLED');
  assert.deepEqual(filesOf(other), filesStopped);
  assert.ok(existsSync(join(portable, 'pending.json')), 'the stopped run is still there to recover');
  // The recovery of a stopped adoption.
  answer.yes = true;
  const eng = engineFolder(home, 'half-made'), s3 = make(() => eng), id3 = value(await s3.chooseFolder()).id;
  const adoption = stateOf(stateRoot, eng, 'adoption');
  mkdirSync(join(adoption, '..'), { recursive: true, mode: 0o700 });
  const ainput = { projectDir: eng, stateDir: adoption, choices: { 'system-prompt/AGENTS.md': { pick: 'AGENTS.md' } }, acknowledged: ['.claude/settings.json#/permissions/defaultMode'] };
  const aplan = planAdoption(ainput);
  let writes = 0;
  await assert.rejects(applyAdoptionWith(ainput, aplan.revision, aplan.approvalsRequired, new AbortController().signal, { beforeWrite: () => { if (++writes === 3) throw crash(); } }), /simulated crash/);
  const filesHalf = filesOf(eng);
  const arec = value(await s3.planAdoptionRecovery(id3));
  assert.ok(arec.remove.length > 0);
  answer.yes = false;
  const ar = await s3.runAdoptionRecovery(id3, arec.revision);
  assert.ok(!ar.ok); assert.equal(ar.refusal.code, 'CANCELLED');
  assert.deepEqual(filesOf(eng), filesHalf);
});
