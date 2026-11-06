// What the main process holds the window to before anything is written (rulings U3, U7, U15, U16, SL3): each approval binds the exact content the
// person read, a changed entry is never approved again without a new tick, a write must be the plan main showed last with the same choices, and main
// asks the person itself, in its own words, before it writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEngineService, shownLine } from '../main/engine-service.js';
import type { EngineService } from '../main/engine-service.js';
import type { AdoptView, Answer, ProjectAnswer, ProjectInput } from '../shared/engine/types.js';
import { ENGINE_CALL_REFUSALS } from '../shared/engine/types.js';
import { DESKTOP, tempDir } from './support.js';
import { definedFolder, engineFolder, filesOf, homeFolder } from './helpers-engine/folders.js';

const WHEN = new Date('2026-10-28T12:00:00Z');
const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null); if (!a.ok) assert.fail(`${a.refusal.code} ${a.refusal.message}`); return a.value; };
const INPUT: ProjectInput = { engines: ['claude-code', 'codex'], reconcile: 'accept-agents', writeClaudeMd: false, approve: [] };
const all = (v: AdoptView): { key: string; hash: string }[] => v.approvals.map(a => ({ key: a.key, hash: a.hash }));

interface Asked { title: string; message: string; detail: string }
function setup(t: test.TestContext, answer = true): { home: string; service: EngineService; asked: Asked[]; open(dir: string): Promise<string>; make(): EngineService } {
  const home = homeFolder(tempDir(t, 'bowerloom-consent-'));
  const asked: Asked[] = [];
  let next: string | null = null;
  const make = (): EngineService => createEngineService({ home, stateRoot: join(home, '.local', 'state', 'bowerloom'), chooseFolder: async () => next, confirm: async q => { asked.push(q); return answer; }, who: 'tester', now: () => WHEN });
  const service = make();
  return { home, service, asked, make, open: async dir => { next = dir; return value(await service.chooseFolder()).id; } };
}

test('U7: each adoption approval carries the exact text from the planned definition files: the hook command, the server command and its arguments', async t => {
  const { home, service, open } = setup(t);
  const id = await open(engineFolder(home));
  const view = value(await service.planAdoption(id, { picks: {}, acknowledged: [] }));
  const hook = view.approvals.find(a => a.key.startsWith('hooks/'))!, server = view.approvals.find(a => a.key === 'mcp/files')!;
  assert.deepEqual(hook.text.map(x => x.path), ['.bowerloom/hooks.json']);
  assert.match(hook.text[0]!.text, /"command": "echo check"/);
  assert.match(hook.text[0]!.text, /"event": "PreToolUse"/);
  assert.deepEqual(server.text.map(x => x.path), ['.bowerloom/mcp.json']);
  assert.match(server.text[0]!.text, /"command": "npx"/);
  assert.match(server.text[0]!.text, /"files-server"/);
  // Only the item's own entry, never the whole file.
  assert.doesNotMatch(server.text[0]!.text, /echo check/);
});

test('U3: an approval and an acknowledgement are bound to a hash of everything the person read; a different hash is never taken as consent', async t => {
  const { home, service, open } = setup(t);
  const dir = engineFolder(home), id = await open(dir), before = filesOf(dir);
  const first = value(await service.planAdoption(id, { picks: {}, acknowledged: [] }));
  for (const a of first.approvals) assert.match(a.hash, /^[a-f0-9]{64}$/);
  const ack = first.unmapped.find(u => u.gate === 'acknowledge')!;
  assert.match(ack.hash, /^[a-f0-9]{64}$/);
  // An acknowledgement with another hash does not count.
  const wrongAck = value(await service.planAdoption(id, { picks: { 'system-prompt/AGENTS.md': 'AGENTS.md' }, acknowledged: [{ id: ack.id, hash: '0'.repeat(64) }] }));
  assert.equal(wrongAck.unmapped.find(u => u.id === ack.id)!.acknowledged, false);
  assert.equal(wrongAck.ready, false);
  const choices = { picks: { 'system-prompt/AGENTS.md': 'AGENTS.md' }, acknowledged: [{ id: ack.id, hash: ack.hash }] };
  const view = value(await service.planAdoption(id, choices));
  assert.equal(view.ready, true);
  // An approval whose hash is not the one shown is refused before the package runs.
  const forged = all(view).map((a, i) => (i === 0 ? { ...a, hash: '0'.repeat(64) } : a));
  const refused = await service.runAdoption(id, view.revision, choices, forged);
  assert.ok(!refused.ok); assert.equal(refused.refusal.code, 'NOT_THE_PLAN_SHOWN');
  assert.deepEqual(filesOf(dir), before);
  // A change to what an approval covers changes its hash.
  const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
  mcp.mcpServers.files.args.push('--and-more');
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify(mcp, null, 2));
  const changed = value(await service.planAdoption(id, choices));
  assert.notEqual(changed.approvals.find(a => a.key === 'mcp/files')!.hash, view.approvals.find(a => a.key === 'mcp/files')!.hash);
  assert.equal(changed.approvals.find(a => a.key.startsWith('hooks/'))!.hash, view.approvals.find(a => a.key.startsWith('hooks/'))!.hash, 'an unchanged item keeps its hash');
});

test('U15: a line key includes the entry hash; a changed entry is asked again, never approved by the old tick; reuse of an earlier approval is for an unchanged entry and is listed as earlier', async t => {
  const { home, service, open, make } = setup(t);
  const dir = definedFolder(home), id = await open(dir);
  const ask = value(await service.planProjection(id, INPUT)) as Extract<ProjectAnswer, { kind: 'approve' }>;
  for (const l of ask.lines) { assert.match(l.key, /sha256:[a-f0-9]{64}$/); assert.equal(l.approvable, true); }
  const keys = ask.lines.map(l => l.key);
  const plan = (value(await service.planProjection(id, { ...INPUT, approve: keys })) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  assert.ok(plan.approved.every(a => !a.earlier));
  // The person edits the guardrail after ticking it: the same ticks no longer cover it.
  const rules = JSON.parse(readFileSync(join(dir, '.bowerloom', 'guardrails.json'), 'utf8'));
  rules.rules[0].pattern = 'git push -f *';
  writeFileSync(join(dir, '.bowerloom', 'guardrails.json'), JSON.stringify(rules, null, 2));
  const again = value(await service.planProjection(id, { ...INPUT, approve: keys })) as Extract<ProjectAnswer, { kind: 'approve' }>;
  assert.equal(again.kind, 'approve');
  const guard = again.lines.find(l => l.part === 'guardrails')!;
  assert.ok(!keys.includes(guard.key), 'the changed entry has a new key');
  assert.ok(!again.approvedSoFar.includes(guard.key));
  // Approve the changed rule, write, and a new session reuses the recorded approvals for unchanged entries only, listed as earlier.
  const now = [...again.lines.map(l => l.key)];
  const p2 = (value(await service.planProjection(id, { ...INPUT, approve: now })) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  value(await service.runProjection(id, p2.revision, { ...INPUT, approve: now }));
  const later = make();
  const id2 = value(await later.chooseFolder()).id;
  const reused = (value(await later.planProjection(id2, INPUT)) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  assert.equal(reused.approved.length, 2);
  assert.ok(reused.approved.every(a => a.earlier), 'listed as approved earlier');
  rules.rules[0].pattern = 'git push --force-with-lease *';
  writeFileSync(join(dir, '.bowerloom', 'guardrails.json'), JSON.stringify(rules, null, 2));
  const changedAgain = value(await later.planProjection(id2, INPUT));
  assert.equal(changedAgain.kind, 'approve', 'a changed entry is never approved by the earlier record');
  assert.deepEqual((changedAgain as Extract<ProjectAnswer, { kind: 'approve' }>).lines.map(l => l.part), ['guardrails']);
});

test('U16: a write must be the plan main showed last, with the same choices; main asks the person in its own words and writes nothing when they say no', async t => {
  const { home, service, open, asked } = setup(t);
  const dir = definedFolder(home), id = await open(dir), before = filesOf(dir);
  const ask = value(await service.planProjection(id, INPUT)) as Extract<ProjectAnswer, { kind: 'approve' }>;
  const keys = ask.lines.map(l => l.key);
  const input = { ...INPUT, approve: keys };
  const plan = (value(await service.planProjection(id, input)) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  // Other choices than the plan shown: refused, nothing asked.
  const other = await service.runProjection(id, plan.revision, { ...input, reconcile: 'keep-both' });
  assert.ok(!other.ok); assert.equal(other.refusal.code, 'NOT_THE_PLAN_SHOWN');
  const fewer = await service.runProjection(id, plan.revision, { ...input, approve: keys.slice(1) });
  assert.ok(!fewer.ok); assert.equal(fewer.refusal.code, 'NOT_THE_PLAN_SHOWN');
  assert.equal(asked.length, 0);
  assert.deepEqual(filesOf(dir), before);
  value(await service.runProjection(id, plan.revision, input));
  assert.equal(asked.length, 1);
  assert.match(asked[0]!.message, /^Write \d+ files in ~\/Projects\/defined\?$/);
  assert.match(asked[0]!.detail, new RegExp(`plan ${plan.revision.slice(0, 8)}`));
  assert.doesNotMatch(JSON.stringify(asked), new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('U16: a "no" in the dialog writes nothing, for an install, a removal and an adoption', async t => {
  const { home, service, open, asked } = setup(t, false);
  const dir = definedFolder(home), id = await open(dir), before = filesOf(dir);
  const ask = value(await service.planProjection(id, INPUT)) as Extract<ProjectAnswer, { kind: 'approve' }>;
  const input = { ...INPUT, approve: ask.lines.map(l => l.key) };
  const plan = (value(await service.planProjection(id, input)) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  const no = await service.runProjection(id, plan.revision, input);
  assert.ok(!no.ok); assert.equal(no.refusal.code, 'CANCELLED');
  assert.deepEqual(filesOf(dir), before);
  const eng = engineFolder(home), id2 = await open(eng), engBefore = filesOf(eng);
  const first = value(await service.planAdoption(id2, { picks: {}, acknowledged: [] }));
  const ack = first.unmapped.find(u => u.gate === 'acknowledge')!;
  const choices = { picks: { 'system-prompt/AGENTS.md': 'AGENTS.md' }, acknowledged: [{ id: ack.id, hash: ack.hash }] };
  const view = value(await service.planAdoption(id2, choices));
  const no2 = await service.runAdoption(id2, view.revision, choices, all(view));
  assert.ok(!no2.ok); assert.equal(no2.refusal.code, 'CANCELLED');
  assert.deepEqual(filesOf(eng), engBefore);
  assert.match(asked[1]!.message, /^Write \d+ files into ~\/Projects\/adopt-me\/\.bowerloom\?$/);
});

test('U16: a removal and a recovery must be the plan shown last', async t => {
  const { home, service, open } = setup(t);
  const dir = definedFolder(home), id = await open(dir);
  const ask = value(await service.planProjection(id, INPUT)) as Extract<ProjectAnswer, { kind: 'approve' }>;
  const input = { ...INPUT, approve: ask.lines.map(l => l.key) };
  const plan = (value(await service.planProjection(id, input)) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  value(await service.runProjection(id, plan.revision, input));
  // A recovery that was never planned is refused, whatever revision it names; the removal that was planned runs.
  const early = await service.runRemoval(id, '1'.repeat(64));
  assert.ok(!early.ok); assert.equal(early.refusal.code, 'NOT_THE_PLAN_SHOWN');
  const removal = value(await service.planRemoval(id));
  const notShown = await service.runRecovery(id, removal.revision, []);
  assert.ok(!notShown.ok); assert.equal(notShown.refusal.code, 'NOT_THE_PLAN_SHOWN');
  value(await service.runRemoval(id, removal.revision));
});

test('SL3: a refused line whose entry the definition does not hold is shown, but offers no tick', () => {
  const raw = { part: 'skills', entry: 'gone', engine: 'codex', result: 'weakened' as const, reason: 'r' };
  const s = (x: string): string => x;
  assert.equal(shownLine(raw, undefined, s).line.approvable, false);
  const ok = shownLine({ ...raw, entry: 'there' }, { id: 'there' }, s);
  assert.equal(ok.line.approvable, true);
  assert.match(ok.line.key, /sha256:[a-f0-9]{64}$/);
});

test('SL3: BUSY is neither declared nor read: the calls run one at a time in order', () => {
  assert.ok(!(ENGINE_CALL_REFUSALS as readonly string[]).includes('BUSY'));
  assert.doesNotMatch(readFileSync(join(DESKTOP, 'preload', 'real-preload.ts'), 'utf8').split('bowerloomEngine')[0]!.split('engineRefusal')[1] ?? '', /BUSY/);
  assert.doesNotMatch(readFileSync(join(DESKTOP, 'renderer', 'harness', 'real', 'engine-bridge.ts'), 'utf8'), /BUSY/);
});
