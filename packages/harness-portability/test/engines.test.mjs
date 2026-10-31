// Review of e1bbce9 (I1, L6, CR5): the API takes claude-code as well as the stored claude, and refuses an engine with no writer by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { importHarnessConfig, planHarnessProjection, planManagedProjection } from '../../../dist/packages/harness-portability/src/index.js';

function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'bowerloom-hp-engines-'))); fs.chmodSync(dir, 0o700); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'settings.json'); fs.writeFileSync(file, '{\n\t"model" : "sonnet"\n}\n', { mode: 0o640 });
  const neutral = { format: 'bowerloom/harness-preferences/v1beta1', preferences: { reasoningEffort: 'high' }, nativeModels: {}, executionAuthorized: false };
  return { dir, file, neutral, stateDir: join(dir, 'private-state') };
}

test('claude-code and the stored claude give the same import and the same plan', async t => {
  const f = fixture(t);
  const old = await importHarnessConfig({ harness: 'claude', file: f.file, synthetic: true }), current = await importHarnessConfig({ harness: 'claude-code', file: f.file, synthetic: true });
  assert.deepEqual(current, old);
  const planOld = await planHarnessProjection({ harness: 'claude', file: f.file, synthetic: true, neutral: f.neutral });
  const planCurrent = await planHarnessProjection({ harness: 'claude-code', file: f.file, synthetic: true, neutral: f.neutral });
  assert.deepEqual(planCurrent, planOld);
});

test('the managed plan takes claude-code and stores the old id, so the stored plan does not change', async t => {
  const f = fixture(t);
  const old = await planManagedProjection({ harness: 'claude', file: f.file, synthetic: true, neutral: f.neutral, stateDir: f.stateDir });
  const current = await planManagedProjection({ harness: 'claude-code', file: f.file, synthetic: true, neutral: f.neutral, stateDir: f.stateDir });
  assert.equal(current.input.harness, 'claude'); assert.equal(current.revision, old.revision);
});

test('an engine with no writer is refused by name in the import, the plan and the managed plan', async t => {
  const f = fixture(t);
  for (const engine of ['opencode', 'pi', 'deepseek-harness']) {
    const named = error => error?.code === 'ENGINE_NO_WRITER' && error.message === `no writer for engine ${engine} yet`;
    await assert.rejects(importHarnessConfig({ harness: engine, file: f.file, synthetic: true }), named, engine);
    await assert.rejects(planHarnessProjection({ harness: engine, file: f.file, synthetic: true, neutral: f.neutral }), named, engine);
    await assert.rejects(planManagedProjection({ harness: engine, file: f.file, synthetic: true, neutral: f.neutral, stateDir: f.stateDir }), named, engine);
  }
});
