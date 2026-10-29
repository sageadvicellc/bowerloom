// Beta.1 supports Claude Code and Codex. OpenCode, Pi, and DeepSeek Harness are preview engines: the app installs to them only when main runs with
// BOWERLOOM_PREVIEW_ENGINES=1. The window gets one yes or no per folder, and the package refuses the rest (ENGINE_PREVIEW), so the app and the command
// line cannot differ. Removal stays open. Synthetic folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PREVIEW_ENGINE_IDS as PACKAGE_PREVIEW, ENGINE_IDS as PACKAGE_ENGINES } from '../../../packages/harness-definition/src/index.js';
import { createEngineService } from '../main/engine-service.js';
import type { EngineService } from '../main/engine-service.js';
import { ENGINE_IDS, PREVIEW_ENGINE_IDS, isEngineId, isPreviewEngine } from '../shared/engine/engines.js';
import type { Answer, ProjectAnswer, ProjectInput } from '../shared/engine/types.js';
import { DESKTOP, tempDir } from './support.js';
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
function make(t: test.TestContext, previewEngines: boolean | undefined): { home: string; service: (dir: string, flag?: boolean) => EngineService } {
  const home = homeFolder(tempDir(t, 'bowerloom-preview-'));
  const service = (dir: string, flag: boolean | undefined = previewEngines): EngineService => createEngineService({
    home, stateRoot: join(home, '.local', 'state', 'bowerloom'), chooseFolder: async () => dir, who: 'tester', now: () => new Date('2026-10-29T12:00:00Z'),
    confirm: async () => true, ...(flag === undefined ? {} : { previewEngines: flag }),
  });
  return { home, service };
}
type Plan = Extract<ProjectAnswer, { kind: 'plan' }>['plan'];
/** Plans, ticking every line the first answer asks for, and returns the plan and the input that made it. */
async function planned(s: EngineService, id: string, engines: ProjectInput['engines']): Promise<{ plan: Plan; ticked: ProjectInput }> {
  const first = value(await s.planProjection(id, input(engines))) as ProjectAnswer;
  const ticked = input(engines, first.kind === 'approve' ? first.lines.map(l => l.key) : []);
  const second = first.kind === 'plan' ? first : value(await s.planProjection(id, ticked)) as ProjectAnswer;
  assert.equal(second.kind, 'plan');
  return { plan: (second as Extract<ProjectAnswer, { kind: 'plan' }>).plan, ticked };
}
/** The paths under a folder that only OpenCode reads. */
const opencodeOnly = (files: Record<string, string>): string[] => Object.keys(files).filter(p => p === 'opencode.json' || p.startsWith('.opencode/'));
const ALL: ProjectInput['engines'] = ['claude-code', 'codex', 'opencode'];
const SUPPORTED: ProjectInput['engines'] = ['claude-code', 'codex'];

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
    assert.deepEqual(folders[0]!.installedEngines, [], 'nothing is installed yet');
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
  assert.deepEqual(filesOf(dir), before);
  const plain = await s.planProjection(id, input(SUPPORTED));
  assert.ok(plain.ok, 'the supported engines plan as before');
});

test('a plan made with the switch on cannot be run on a service with the switch off: ENGINE_PREVIEW, nothing written', async t => {
  const { home, service } = make(t, true), dir = previewFolder(home);
  const on = service(dir), id = value(await on.chooseFolder()).id;
  const { plan, ticked } = await planned(on, id, ALL);
  const off = service(dir, false), offId = value(await off.chooseFolder()).id;
  const before = filesOf(dir);
  const run = await off.runProjection(offId, plan.revision, ticked);
  assert.ok(!run.ok);
  assert.equal(run.refusal.code, 'ENGINE_PREVIEW');
  assert.deepEqual(filesOf(dir), before);
});

test('with the switch on, the plan covers the preview engine', async t => {
  const { home, service } = make(t, true), dir = previewFolder(home), s = service(dir);
  const id = value(await s.chooseFolder()).id;
  const { plan } = await planned(s, id, ALL);
  assert.deepEqual(plan.engines.map(e => e.engine), ['claude-code', 'codex', 'opencode']);
  assert.deepEqual(plan.skippedPreview, []); assert.deepEqual(plan.keptPreview, []); assert.equal(plan.previewNotice, null);
});

test('the app never falls back to the environment: with the variable set in this process and the service off, OpenCode is still refused', async t => {
  const before = process.env.BOWERLOOM_PREVIEW_ENGINES;
  t.after(() => { if (before === undefined) delete process.env.BOWERLOOM_PREVIEW_ENGINES; else process.env.BOWERLOOM_PREVIEW_ENGINES = before; });
  process.env.BOWERLOOM_PREVIEW_ENGINES = '1';
  const { home, service } = make(t, undefined), dir = previewFolder(home), s = service(dir);
  const id = value(await s.chooseFolder()).id;
  assert.equal((await s.folders())[0]!.previewEngines, false, 'a service built with no choice is off');
  const refused = await s.planProjection(id, input(ALL));
  assert.ok(!refused.ok); assert.equal(refused.refusal.code, 'ENGINE_PREVIEW');
});

test('every PortableInput that main builds sets previewEngines in the same object', () => {
  const dir = join(DESKTOP, 'main');
  let seen = 0;
  for (const name of readdirSync(dir).filter(n => n.endsWith('.ts'))) {
    const text = readFileSync(join(dir, name), 'utf8');
    for (const m of text.matchAll(/definitionFolder\s*:/g)) {
      let open = m.index!, depth = 0;
      while (open > 0) { open -= 1; const ch = text[open]; if (ch === '}') depth += 1; else if (ch === '{') { if (depth === 0) break; depth -= 1; } }
      let close = open, level = 0;
      for (; close < text.length; close += 1) { if (text[close] === '{') level += 1; else if (text[close] === '}') { level -= 1; if (level === 0) break; } }
      seen += 1;
      assert.match(text.slice(open, close + 1), /\bpreviewEngines\b/, `${name}: an input with definitionFolder sets previewEngines`);
    }
  }
  assert.ok(seen >= 1, 'the check found the input the app builds');
});

test('removal stays open: with the switch off, the app removes the files an install with the switch on wrote for OpenCode', async t => {
  const on = make(t, true), dir = previewFolder(on.home), before = filesOf(dir);
  const flagged = on.service(dir), id = value(await flagged.chooseFolder()).id;
  const { plan, ticked } = await planned(flagged, id, ALL);
  value(await flagged.runProjection(id, plan.revision, ticked));
  assert.ok(opencodeOnly(filesOf(dir)).length > 0, 'the install wrote files only OpenCode reads');
  const off = on.service(dir, false), offId = value(await off.chooseFolder()).id;
  assert.equal((await off.folders())[0]!.projected, true);
  const removal = value(await off.planRemoval(offId));
  value(await off.runRemoval(offId, removal.revision));
  assert.deepEqual(filesOf(dir), before);
});

test('left alone: an install with the switch off keeps the OpenCode files, the receipt lists OpenCode, the plan says so, and remove still takes them', async t => {
  const on = make(t, true), dir = previewFolder(on.home), before = filesOf(dir);
  const flagged = on.service(dir), id = value(await flagged.chooseFolder()).id;
  const first = await planned(flagged, id, ALL);
  value(await flagged.runProjection(id, first.plan.revision, first.ticked));
  const installed = filesOf(dir), only = opencodeOnly(installed);
  assert.ok(only.length > 0);
  const off = on.service(dir, false), offId = value(await off.chooseFolder()).id;
  const info = (await off.folders())[0]!;
  assert.deepEqual(info.installedEngines, ['claude-code', 'codex', 'opencode'], 'the folder says what the receipt holds');
  assert.equal(info.previewEngines, false);
  const second = await planned(off, offId, SUPPORTED);
  assert.deepEqual(second.plan.skippedPreview, ['opencode']);
  assert.deepEqual(second.plan.keptPreview, ['opencode']);
  assert.equal(second.plan.previewNotice, 'Preview engines skipped: opencode. Its files from an earlier install are left as they are. Set BOWERLOOM_PREVIEW_ENGINES=1 to install to it.');
  assert.deepEqual(second.plan.engines.map(e => e.engine), ['claude-code', 'codex']);
  for (const p of only) assert.ok(!second.plan.changes.some(c => c.path === p && c.action !== 'unchanged'), `${p} is not touched`);
  if (!second.plan.noop) value(await off.runProjection(offId, second.plan.revision, second.ticked));
  const after = filesOf(dir);
  for (const p of only) assert.equal(after[p], installed[p], `${p} is byte for byte the same`);
  assert.deepEqual((await off.folders())[0]!.installedEngines, ['claude-code', 'codex', 'opencode'], 'the receipt still lists OpenCode');
  const removal = value(await off.planRemoval(offId));
  value(await off.runRemoval(offId, removal.revision));
  assert.deepEqual(filesOf(dir), before);
});
