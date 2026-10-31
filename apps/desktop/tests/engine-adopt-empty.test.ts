// "New harness" in the Builder opens "From a folder" (adoption). For an empty folder, or one with no engine files, that is the only way to a definition: main
// plans it, asks in its own dialog, writes `harness.json` alone, and the Builder then opens the folder's harness with no parts. Real packages, synthetic folders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEngineService } from '../main/engine-service.js';
import type { EngineService } from '../main/engine-service.js';
import type { Ask } from '../main/engine-consent.js';
import { loadDefinition } from '../../../packages/harness-definition/src/index.js';
import type { AdoptChoices, Answer, FolderInfo } from '../shared/engine/types.js';
import { tempDir } from './support.js';
import { homeFolder } from './helpers-engine/folders.js';

const WHEN = new Date('2026-10-31T12:00:00Z');
const NONE: AdoptChoices = { picks: {}, acknowledged: [], everyEngine: [] };
const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null, 'an answer'); if (!a.ok) assert.fail(`refused: ${a.refusal.code} ${a.refusal.message}`); return a.value; };

function setup(t: test.TestContext): { home: string; service: EngineService; asks: Ask[]; pick(dir: string): void } {
  const home = homeFolder(tempDir(t, 'bowerloom-adopt-empty-'));
  let next: string | null = null;
  const asks: Ask[] = [];
  const service = createEngineService({ home, stateRoot: join(home, '.local', 'state', 'bowerloom'), chooseFolder: async () => next, confirm: async ask => { asks.push(ask); return true; }, who: 'tester', now: () => WHEN });
  return { home, service, asks, pick: dir => { next = dir; } };
}
const folderAt = (home: string, name: string, files: Record<string, string> = {}): string => {
  const dir = join(home, 'Projects', name);
  mkdirSync(dir, { recursive: true });
  for (const [rel, text] of Object.entries(files)) { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text); }
  return dir;
};

for (const [name, files] of [['empty', {}], ['plain', { 'README.md': '# Plain\n' }]] as const) {
  test(`a folder with ${name === 'empty' ? 'nothing in it' : 'no engine files'} becomes a harness with no parts through From a folder, and the Builder's load reads it`, async t => {
    const s = setup(t);
    const dir = folderAt(s.home, name, files);
    s.pick(dir);
    const f: FolderInfo = value(await s.service.chooseFolder());
    assert.equal(f.hasDefinition, false);

    const plan = value(await s.service.planAdoption(f.id, NONE));
    assert.equal(plan.ready, true);
    assert.deepEqual(plan.files.map(x => x.path), ['harness.json']);
    assert.deepEqual([plan.items.length, plan.conflicts.length, plan.approvals.length, plan.unmapped.length], [0, 0, 0, 0]);
    assert.match(plan.warnings.join('\n'), /No engine file names an engine/);
    assert.equal(existsSync(join(dir, '.bowerloom')), false, 'planning writes nothing');

    const written = value(await s.service.runAdoption(f.id, plan.revision, NONE, []));
    assert.deepEqual(written.written, ['.bowerloom/harness.json']);
    assert.equal(s.asks.length, 1, 'main asked once, in its own dialog');
    assert.deepEqual(readdirSync(join(dir, '.bowerloom')), ['harness.json']);
    assert.equal(loadDefinition(join(dir, '.bowerloom')).ok, true);

    // The Builder's load: the folder's harness with no parts, and its save points (none yet).
    const info = (await s.service.folders()).find(x => x.id === f.id)!;
    assert.equal(info.hasDefinition, true);
    assert.deepEqual(info.engines, ['claude-code', 'codex']);
    const view = value(await s.service.planSave(f.id, []));
    assert.equal(view.noop, true);
    assert.deepEqual([view.definition.agents.length, view.definition.skills.length, view.definition.sources.length], [0, 0, 0]);
    assert.equal(view.definition.instructions, false);
    assert.deepEqual(view.definition.engines, ['claude-code', 'codex']);
    assert.deepEqual(value(await s.service.listVersions(f.id)), []);
  });
}
