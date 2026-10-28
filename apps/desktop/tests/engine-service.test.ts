// The main-process side of the adopt and install sheets, run with the real packages on synthetic folders: what the window gets (plain data, no absolute path),
// what it may send (ids it was given, approvals of lines it was shown), and that every write takes the revision of an approved plan and goes through the packages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEngineService, refusalOf } from '../main/engine-service.js';
import type { EngineService } from '../main/engine-service.js';
import { makeScrub } from '../shared/engine/scrub.js';
import type { AdoptView, Answer, FolderInfo, ProjectAnswer, ProjectInput, ProjectView } from '../shared/engine/types.js';
import { tempDir } from './support.js';
import { definedFolder, engineFolder, filesOf, homeFolder } from './helpers-engine/folders.js';

const WHEN = new Date('2026-10-28T12:00:00Z');

function setup(t: test.TestContext): { home: string; service: EngineService; pick(dir: string | null): void } {
  const home = homeFolder(tempDir(t, 'bowerloom-engine-'));
  let next: string | null = null;
  const service = createEngineService({ home, stateRoot: join(home, '.local', 'state', 'bowerloom'), chooseFolder: async () => next, who: 'tester', now: () => WHEN });
  return { home, service, pick: dir => { next = dir; } };
}
const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null, 'an answer'); if (!a.ok) assert.fail(`refused: ${a.refusal.code} ${a.refusal.message}`); return a.value; };
const absoluteIn = (data: unknown, path: string): boolean => JSON.stringify(data).includes(path);
async function choose(service: EngineService, pick: (d: string | null) => void, dir: string): Promise<FolderInfo> { pick(dir); return value(await service.chooseFolder()); }
const INPUT: ProjectInput = { engines: ['claude-code', 'codex'], reconcile: 'accept-agents', writeClaudeMd: false, approve: [] };

test('a chosen folder gets an id and a ~ label; the window never sees its absolute path; a closed chooser answers null', async t => {
  const { home, service, pick } = setup(t);
  pick(null);
  assert.equal(await service.chooseFolder(), null);
  const dir = engineFolder(home);
  const folder = await choose(service, pick, dir);
  assert.match(folder.id, /^folder-\d+$/);
  assert.equal(folder.label, '~/Projects/adopt-me');
  assert.equal(folder.name, 'adopt-me');
  assert.deepEqual([folder.hasDefinition, folder.projected, folder.unfinished.projection, folder.unfinished.adoption], [false, false, false, false]);
  assert.equal(absoluteIn(folder, home), false);
  // The same folder chosen again keeps its id, and the list holds it once.
  assert.equal((await choose(service, pick, dir)).id, folder.id);
  assert.deepEqual((await service.folders()).map(f => f.id), [folder.id]);
});

test('the home folder itself is refused with words, and the window never names a folder by path', async t => {
  const { home, service, pick } = setup(t);
  pick(home);
  const a = await service.chooseFolder();
  assert.ok(a !== null && !a.ok);
  assert.equal(absoluteIn(a, home), false);
  await assert.rejects(service.planAdoption('folder-99', { picks: {}, acknowledged: [] }), /UNKNOWN_FOLDER/);
  await assert.rejects(service.planAdoption('/etc', { picks: {}, acknowledged: [] }), /BAD_ARGUMENT/);
  await assert.rejects(service.planAdoption(home, { picks: {}, acknowledged: [] }), /BAD_ARGUMENT/);
});

test('the adoption plan shows items, places, the conflict, unmapped entries with reasons and gates, and the text of every approval; it writes nothing', async t => {
  const { home, service, pick } = setup(t);
  const dir = engineFolder(home), before = filesOf(dir);
  const folder = await choose(service, pick, dir);
  const view = value(await service.planAdoption(folder.id, { picks: {}, acknowledged: [] }));
  assert.equal(view.folder, '~/Projects/adopt-me');
  assert.deepEqual(view.items.map(i => i.key).sort(), ['guardrails/deny-shell-abbb71ff', 'hooks/pre-tool-use-52407f3d', 'mcp/files', 'skills/review']);
  assert.deepEqual(view.items.find(i => i.key === 'mcp/files')!.places.map(p => `${p.path}#${p.pointer}`), ['.mcp.json#/mcpServers/files']);
  assert.equal(view.conflicts.length, 1);
  assert.deepEqual(view.conflicts[0]!.variants.map(v => v.key), ['AGENTS.md', 'CLAUDE.md']);
  assert.equal(view.conflicts[0]!.picked, null);
  const gated = view.unmapped.find(u => u.id === '.claude/settings.json#/permissions/defaultMode')!;
  assert.equal(gated.gate, 'acknowledge');
  assert.match(gated.reason, /Permission modes do not translate/);
  assert.deepEqual(view.approvals.map(a => a.key), ['hooks/pre-tool-use-52407f3d', 'mcp/files']);
  for (const a of view.approvals) assert.ok(a.reasons.length > 0 && a.reasons.every(r => r.length > 20), `${a.key} carries its words`);
  assert.equal(view.ready, false);
  assert.equal(absoluteIn(view, home), false, 'no absolute path reaches the window');
  assert.deepEqual(filesOf(dir), before, 'planning wrote nothing');
});

async function readyAdoption(service: EngineService, id: string): Promise<{ view: AdoptView; choices: { picks: Record<string, string>; acknowledged: string[] } }> {
  const choices = { picks: { 'system-prompt/AGENTS.md': 'AGENTS.md' }, acknowledged: ['.claude/settings.json#/permissions/defaultMode'] };
  return { view: value(await service.planAdoption(id, choices)), choices };
}

test('adoption writes only with every approval ticked and the approved revision, and then only into .bowerloom', async t => {
  const { home, service, pick } = setup(t);
  const dir = engineFolder(home), before = filesOf(dir);
  const folder = await choose(service, pick, dir);
  const { view, choices } = await readyAdoption(service, folder.id);
  assert.equal(view.ready, true);
  assert.equal(view.conflicts[0]!.picked, 'AGENTS.md');
  // One approval missing: refused with words, nothing written.
  const short = await service.runAdoption(folder.id, view.revision, choices, ['mcp/files']);
  assert.ok(!short.ok); assert.equal(short.refusal.code, 'ADOPTION_APPROVAL_REQUIRED');
  assert.deepEqual(filesOf(dir), before);
  // A stale revision: refused.
  const stale = await service.runAdoption(folder.id, '0'.repeat(64), choices, view.approvals.map(a => a.key));
  assert.ok(!stale.ok); assert.equal(stale.refusal.code, 'ADOPTION_STALE_APPROVAL');
  const done = value(await service.runAdoption(folder.id, view.revision, choices, view.approvals.map(a => a.key)));
  assert.ok(done.written.includes('.bowerloom/harness.json'));
  const after = filesOf(dir);
  for (const [path, hash] of Object.entries(before)) assert.equal(after[path], hash, `${path} keeps its bytes`);
  assert.ok(Object.keys(after).filter(p => !(p in before)).every(p => p.startsWith('.bowerloom/')), 'only .bowerloom gained files');
  const info = (await service.folders())[0]!;
  assert.equal(info.hasDefinition, true);
  assert.deepEqual(info.engines, ['claude-code', 'codex']);
});

test('arguments are checked before anything runs: a bad revision, a bad choice shape, an approval that is not a string', async t => {
  const { home, service, pick } = setup(t);
  const folder = await choose(service, pick, engineFolder(home));
  await assert.rejects(service.runAdoption(folder.id, 'abc', { picks: {}, acknowledged: [] }, []), /BAD_ARGUMENT/);
  await assert.rejects(service.planAdoption(folder.id, { picks: { a: 1 }, acknowledged: [] }), /BAD_ARGUMENT/);
  await assert.rejects(service.planAdoption(folder.id, { picks: {}, acknowledged: [], extra: true }), /BAD_ARGUMENT/);
  await assert.rejects(service.runAdoption(folder.id, '0'.repeat(64), { picks: {}, acknowledged: [] }, [3]), /BAD_ARGUMENT/);
  await assert.rejects(service.planProjection(folder.id, { ...INPUT, engines: ['hermes'] }), /BAD_ARGUMENT/);
  await assert.rejects(service.planProjection(folder.id, { ...INPUT, reconcile: 'delete-all' }), /BAD_ARGUMENT/);
  await assert.rejects(service.planProjection(folder.id, { ...INPUT, writeClaudeMd: 'yes' }), /BAD_ARGUMENT/);
});

test('the install plan first asks for each weakened enforced line, then plans with the approvals the person ticked, and only those', async t => {
  const { home, service, pick } = setup(t);
  const dir = definedFolder(home), before = filesOf(dir);
  const folder = await choose(service, pick, dir);
  assert.deepEqual(folder.engines, ['claude-code', 'codex']);
  const first = value(await service.planProjection(folder.id, INPUT));
  assert.equal(first.kind, 'approve');
  const lines = (first as Extract<ProjectAnswer, { kind: 'approve' }>).lines;
  assert.deepEqual(lines.map(l => `${l.part}/${l.entry} ${l.engine} ${l.result}`), ['guardrails/no-force-push codex weakened', 'hooks/check-bash codex weakened']);
  assert.ok(lines.every(l => l.reason.length > 40));
  // An approval of a line the window was never shown is refused.
  await assert.rejects(service.planProjection(folder.id, { ...INPUT, approve: ['made-up'] }), /BAD_ARGUMENT/);
  // One of two ticked: still asks, and keeps both lines in the list.
  const half = value(await service.planProjection(folder.id, { ...INPUT, approve: [lines[0]!.key] }));
  assert.equal(half.kind, 'approve');
  assert.equal((half as Extract<ProjectAnswer, { kind: 'approve' }>).lines.length, 2);
  assert.deepEqual((half as Extract<ProjectAnswer, { kind: 'approve' }>).approvedSoFar, [lines[0]!.key]);
  const full = value(await service.planProjection(folder.id, { ...INPUT, approve: lines.map(l => l.key) }));
  assert.equal(full.kind, 'plan');
  const plan = (full as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  assert.equal(plan.approved.length, 2);
  assert.ok(plan.approved.every(a => a.who === 'tester' && a.when === '2026-10-28T12:00:00Z'));
  assert.deepEqual(filesOf(dir), before, 'planning wrote nothing');
  checkPlan(plan, home);
});

function checkPlan(plan: ProjectView, home: string): void {
  assert.deepEqual(plan.engines.map(e => e.engine), ['claude-code', 'codex']);
  const codex = plan.engines[1]!;
  assert.deepEqual(codex.counts, { exact: 2, translated: 0, weakened: 2, absent: 1 });
  assert.deepEqual(codex.parts.map(p => p.part), ['system-prompt', 'skills', 'guardrails', 'hooks', 'mcp']);
  assert.equal(codex.parts.find(p => p.part === 'mcp')!.lines[0]!.result, 'absent');
  assert.equal(plan.partial, true);
  assert.match(plan.notice ?? '', /partial/);
  assert.ok(plan.trust.some(x => x.state === 'pending trust' && x.engine === 'codex'));
  const rules = plan.review.find(r => r.path === '.codex/rules/bowerloom.rules')!;
  assert.equal(rules.kind, 'code'); assert.match(rules.text, /prefix_rule\(/); assert.match(rules.text, /decision = "forbidden"/);
  const server = plan.review.find(r => r.part === 'mcp')!;
  assert.equal(server.text, '["npx","-y","files-server"]'); assert.deepEqual(server.env, [{ name: 'ROOT', value: null }]);
  assert.ok(plan.drift !== null);
  assert.equal(plan.drift.defaultAction, 'accept-agents');
  assert.equal(plan.reconcile, 'accept-agents');
  assert.deepEqual(plan.drift.engines.map(e => `${e.engine} hides ${e.hidden}`), ['claude-code hides AGENTS.md', 'codex hides CLAUDE.md']);
  assert.ok(plan.changes.some(c => c.path === 'CLAUDE.md' && c.action === 'replace'));
  assert.equal(absoluteIn(plan, home), false);
}

test('the install writes with the approved revision, then shows drift with reasons, removes exactly what it wrote, and refuses a stale revision', async t => {
  const { home, service, pick } = setup(t);
  const dir = definedFolder(home), before = filesOf(dir);
  const folder = await choose(service, pick, dir);
  const ask = value(await service.planProjection(folder.id, INPUT)) as Extract<ProjectAnswer, { kind: 'approve' }>;
  const input = { ...INPUT, approve: ask.lines.map(l => l.key) };
  const plan = (value(await service.planProjection(folder.id, input)) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  const stale = await service.runProjection(folder.id, '0'.repeat(64), input);
  assert.ok(!stale.ok);
  assert.deepEqual(filesOf(dir), before);
  const done = value(await service.runProjection(folder.id, plan.revision, input));
  assert.equal(done.noop, false);
  assert.ok(done.written.includes('AGENTS.md') && done.written.includes('.codex/rules/bowerloom.rules'));
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.equal((await service.folders())[0]!.projected, true);
  // The approvals were recorded in the receipt: a new session plans with them and asks for nothing.
  let next: string | null = dir;
  const again = createEngineService({ home, stateRoot: join(home, '.local', 'state', 'bowerloom'), chooseFolder: async () => next, who: 'tester', now: () => WHEN });
  const id = value(await again.chooseFolder()).id; next = null;
  const second = value(await again.planProjection(id, INPUT));
  assert.equal(second.kind, 'plan');
  assert.equal((second as Extract<ProjectAnswer, { kind: 'plan' }>).plan.noop, true);
  // A person edits a file Bowerloom wrote: the next plan says which, and why.
  writeFileSync(join(dir, 'AGENTS.md'), '# Edited\n');
  const drifted = await again.planProjection(id, INPUT);
  assert.ok(!drifted.ok);
  assert.equal(drifted.refusal.code, 'PORTABLE_DRIFT');
  assert.deepEqual(drifted.refusal.drift, [{ path: 'AGENTS.md', reason: 'changed' }]);
  // Keeping the person's version is a recovery plan that names the path. It writes nothing until it is approved.
  const keep = value(await again.planRecovery(id, ['AGENTS.md']));
  assert.equal(keep.action, 'keep'); assert.deepEqual(keep.keep, ['AGENTS.md']); assert.match(keep.notice ?? '', /kept path/);
  // Removal: the plan lists what goes back, and the write restores the folder.
  writeFileSync(join(dir, 'AGENTS.md'), readFileSync(join(dir, '.bowerloom', 'instructions', 'AGENTS.md')));
  const removal = value(await again.planRemoval(id));
  assert.ok(removal.changes.some(c => c.path === 'CLAUDE.md' && c.action === 'restore'));
  assert.ok(removal.changes.some(c => c.path === 'AGENTS.md' && c.action === 'delete'));
  value(await again.runRemoval(id, removal.revision));
  assert.deepEqual(filesOf(dir), before, 'removal put the folder back as it was');
});

test('a recovery plan with nothing to recover is a refusal with words, never an error', async t => {
  const { home, service, pick } = setup(t);
  const folder = await choose(service, pick, definedFolder(home));
  const a = await service.planRecovery(folder.id, []);
  assert.ok(!a.ok); assert.equal(a.refusal.code, 'PORTABLE_RECOVER_NOTHING');
  const b = await service.planAdoptionRecovery(folder.id);
  assert.ok(!b.ok); assert.equal(b.refusal.code, 'ADOPTION_RECOVER_NOTHING');
  const c = await service.planRemoval(folder.id);
  assert.ok(!c.ok); assert.equal(c.refusal.code, 'PORTABLE_NOTHING_PROJECTED');
});

test('a refusal keeps its code and words with paths made safe; an error that is not a refusal says only that the call failed', () => {
  const s = makeScrub([{ path: '/Users/someone', as: '~' }]);
  assert.deepEqual(refusalOf(Object.assign(new Error('Nothing at /Users/someone/x.'), { code: 'PORTABLE_USAGE', paths: ['/Users/someone/x'] }), s), { code: 'PORTABLE_USAGE', message: 'Nothing at ~/x.', paths: ['~/x'] });
  assert.equal(refusalOf(new TypeError('boom at /Users/someone'), s).code, 'FAILED');
  assert.doesNotMatch(refusalOf(new TypeError('boom at /Users/someone'), s).message, /someone/);
});

test('calls run one at a time, in order', async t => {
  const { home, service, pick } = setup(t);
  const folder = await choose(service, pick, definedFolder(home));
  const order: string[] = [];
  await Promise.all([
    service.planProjection(folder.id, INPUT).then(() => order.push('plan')),
    service.folders().then(() => order.push('folders')),
    service.planRemoval(folder.id).then(() => order.push('removal')),
  ]);
  assert.deepEqual(order, ['plan', 'folders', 'removal']);
  assert.equal(existsSync(join(home, '.local', 'state', 'bowerloom')), false, 'plans made no state folder');
});
