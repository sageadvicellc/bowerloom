// Beta.1 supports Claude Code and Codex. OpenCode, Pi, and DeepSeek Harness are preview engines: the app installs to them only when main runs with
// BOWERLOOM_PREVIEW_ENGINES=1. The window gets one yes or no per folder, and the package refuses the rest (ENGINE_PREVIEW), so the app and the command
// line cannot differ. Removal stays open. Synthetic folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PREVIEW_ENGINE_IDS as PACKAGE_PREVIEW, ENGINE_IDS as PACKAGE_ENGINES } from '../../../packages/harness-definition/src/index.js';
import { createEngineService } from '../main/engine-service.js';
import type { EngineService } from '../main/engine-service.js';
import { ENGINE_IDS, PREVIEW_ENGINE_IDS, isEngineId, isPreviewEngine } from '../shared/engine/engines.js';
import type { Answer, ProjectAnswer, ProjectInput } from '../shared/engine/types.js';
import { tempDir } from './support.js';
import { definedFolder, filesOf, homeFolder } from './helpers-engine/folders.js';

const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null); if (!a.ok) assert.fail(`${a.refusal.code} ${a.refusal.message}`); return a.value; };
const input = (engines: ProjectInput['engines'], approve: readonly string[] = []): ProjectInput => ({ engines, reconcile: 'accept-agents', writeClaudeMd: false, approve });

/** definedFolder lists Claude Code and Codex; this one lists OpenCode too. */
function previewFolder(home: string): string {
  const dir = definedFolder(home);
  const file = join(dir, '.bowerloom', 'harness.json');
  const harness = JSON.parse(readFileSync(file, 'utf8')) as { engines: { id: string; version?: string }[] };
  harness.engines.push({ id: 'opencode', version: '1.18.30' });
  writeFileSync(file, JSON.stringify(harness, null, 2) + '\n');
  return dir;
}
function make(t: test.TestContext, previewEngines: boolean | undefined): { home: string; service: (dir: string) => EngineService } {
  const home = homeFolder(tempDir(t, 'bowerloom-preview-'));
  const service = (dir: string): EngineService => createEngineService({
    home, stateRoot: join(home, '.local', 'state', 'bowerloom'), chooseFolder: async () => dir, who: 'tester', now: () => new Date('2026-10-29T12:00:00Z'),
    confirm: async () => true, ...(previewEngines === undefined ? {} : { previewEngines }),
  });
  return { home, service };
}

test('the app lists the engines the packages list, and the same three preview engines', () => {
  assert.equal(ENGINE_IDS, PACKAGE_ENGINES, 'the very same list, not a copy');
  assert.equal(PREVIEW_ENGINE_IDS, PACKAGE_PREVIEW, 'the very same list, not a copy');
  assert.deepEqual([...PREVIEW_ENGINE_IDS], ['opencode', 'pi', 'deepseek-harness']);
  assert.equal(isEngineId('codex'), true); assert.equal(isEngineId('hermes'), false);
  assert.equal(isPreviewEngine('pi'), true); assert.equal(isPreviewEngine('codex'), false);
});

test('folders() tells the window whether preview engines may be installed, as one yes or no', async t => {
  for (const [dep, want] of [[false, false], [true, true]] as const) {
    const { home, service } = make(t, dep), dir = previewFolder(home), s = service(dir);
    value(await s.chooseFolder());
    const folders = await s.folders();
    assert.equal(folders[0]!.previewEngines, want);
    assert.deepEqual(folders[0]!.engines, ['claude-code', 'codex', 'opencode'], 'the folder still lists the preview engine');
    assert.equal(JSON.stringify(folders).includes('BOWERLOOM'), false, 'no variable name or environment reaches the window');
  }
});

test('with the switch off, a plan that names a preview engine is refused before anything is written', async t => {
  const { home, service } = make(t, false), dir = previewFolder(home), s = service(dir);
  const id = value(await s.chooseFolder()).id;
  const before = filesOf(dir);
  const refused = await s.planProjection(id, input(['claude-code', 'opencode']));
  assert.ok(!refused.ok);
  assert.equal(refused.refusal.code, 'ENGINE_PREVIEW');
  assert.match(refused.refusal.message, /opencode is a preview engine in this beta/);
  const run = await s.runProjection(id, 'a'.repeat(64), input(['claude-code', 'opencode']));
  assert.ok(!run.ok, 'a run for a plan that was never shown is refused too');
  assert.deepEqual(filesOf(dir), before);
  // The supported engines plan as before.
  const plain = await s.planProjection(id, input(['claude-code', 'codex']));
  assert.ok(plain.ok);
});

test('with the switch on, the same plan is made for the preview engine', async t => {
  const { home, service } = make(t, true), dir = previewFolder(home), s = service(dir);
  const id = value(await s.chooseFolder()).id;
  const answer = value(await s.planProjection(id, input(['claude-code', 'codex', 'opencode']))) as ProjectAnswer;
  assert.ok(answer.kind === 'approve' || answer.kind === 'plan');
});

test('removal stays open: with the switch off, the app removes the files an install with the switch on wrote for OpenCode', async t => {
  const on = make(t, true), dir = previewFolder(on.home), before = filesOf(dir);
  const flagged = on.service(dir);
  const id = value(await flagged.chooseFolder()).id;
  const all = input(['claude-code', 'codex', 'opencode']);
  const ask = value(await flagged.planProjection(id, all)) as Extract<ProjectAnswer, { kind: 'approve' }>;
  const ticked = input(all.engines, ask.lines.map(l => l.key));
  const plan = value(await flagged.planProjection(id, ticked)) as Extract<ProjectAnswer, { kind: 'plan' }>;
  value(await flagged.runProjection(id, plan.plan.revision, ticked));
  const installed = filesOf(dir);
  assert.ok(Object.keys(installed).some(p => p.startsWith('.agents/') || p === 'opencode.json'), 'the install wrote files OpenCode reads');
  // A new service with the switch off, on the same state, removes them.
  const off = createEngineService({ home: on.home, stateRoot: join(on.home, '.local', 'state', 'bowerloom'), chooseFolder: async () => dir, who: 'tester', confirm: async () => true, previewEngines: false });
  const offId = value(await off.chooseFolder()).id;
  assert.equal((await off.folders())[0]!.projected, true);
  const removal = value(await off.planRemoval(offId));
  value(await off.runRemoval(offId, removal.revision));
  assert.deepEqual(filesOf(dir), before);
});
