// Beta.1 supports Claude Code and Codex. OpenCode, Pi, and DeepSeek Harness are preview engines: install to them is refused unless the
// preview switch is on. Adoption, drift, status, and removal stay open. Both the command line and the app plan through planPortable.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyPortable, applyPortableRemoval, planPortable, planPortableRemoval, portableDrift, readPortableReceipt,
} from '../../../dist/packages/project-sync/src/index.js';
import { EnginePreviewRefusal } from '../../../dist/packages/skill-manifest/src/engine.js';
import { FIVE, project, snapshot } from './portable-fixture.mjs';

const OFF = { previewEngines: false };
const ON = { previewEngines: true };
const preview = engine => error => error instanceof EnginePreviewRefusal && error.code === 'ENGINE_PREVIEW' && error.engine === engine;

test('an engine named on purpose is refused before any write when the switch is off', t => {
  const p = project(t);
  const before = snapshot(p.dir);
  for (const engine of ['opencode', 'pi', 'deepseek-harness']) {
    assert.throws(() => planPortable(p.input({ ...OFF, engines: [{ id: engine }] })), preview(engine), engine);
    assert.throws(() => planPortable(p.input({ ...OFF, engines: [{ id: 'codex' }, { id: engine }] })), preview(engine), `codex and ${engine}`);
  }
  assert.deepEqual(snapshot(p.dir), before);
  assert.equal(fs.existsSync(p.stateDir), false, 'no state folder was made');
});

test('the refusal names the first preview engine in the order of the engine list, with a plain message', t => {
  const p = project(t);
  assert.throws(() => planPortable(p.input({ ...OFF, engines: [{ id: 'deepseek-harness' }, { id: 'opencode' }] })), error => {
    assert.equal(error.code, 'ENGINE_PREVIEW'); assert.equal(error.engine, 'opencode');
    assert.match(error.message, /opencode is a preview engine in this beta/); assert.match(error.message, /BOWERLOOM_PREVIEW_ENGINES=1/);
    return true;
  });
});

test('a preview engine that harness.json does not list is still reported as not listed first', t => {
  const p = project(t, { engines: [{ id: 'codex' }] });
  assert.throws(() => planPortable(p.input({ ...OFF, engines: [{ id: 'pi' }] })), error => error?.code === 'PORTABLE_ENGINE_NOT_LISTED');
});

test('with no engine named, the plan installs the supported engines and names the skipped preview engines', t => {
  const p = project(t);
  const plan = planPortable(p.input(OFF));
  assert.deepEqual(plan.engines.map(e => e.id), ['claude-code', 'codex']);
  assert.deepEqual(plan.skippedPreview, ['opencode', 'pi', 'deepseek-harness']);
  assert.equal(plan.previewNotice, 'Preview engines skipped: opencode, pi, deepseek-harness. Set BOWERLOOM_PREVIEW_ENGINES=1 to install to them.');
  for (const c of plan.changes) for (const e of c.engines) assert.ok(e === 'claude-code' || e === 'codex', `${c.path} ${e}`);
  assert.ok(plan.loss.every(l => l.engine === 'claude-code' || l.engine === 'codex'), 'no loss line for a skipped engine');
});

test('a harness with no preview engines skips nothing', t => {
  const p = project(t, { engines: [{ id: 'claude-code' }, { id: 'codex' }] });
  assert.deepEqual(planPortable(p.input(OFF)).skippedPreview, []);
  assert.deepEqual(planPortable(p.input(ON)).skippedPreview, []);
});

test('a harness with only preview engines is refused when none is named', t => {
  const p = project(t, { engines: [{ id: 'pi' }, { id: 'opencode' }] });
  assert.throws(() => planPortable(p.input(OFF)), preview('opencode'));
  assert.deepEqual(planPortable(p.input(ON)).engines.map(e => e.id), ['opencode', 'pi']);
});

test('with the switch on, the plan equals the plan of every listed engine and skips nothing', t => {
  const p = project(t);
  const on = planPortable(p.input(ON));
  assert.deepEqual(on.engines.map(e => e.id), FIVE.map(e => e.id));
  assert.deepEqual(on.skippedPreview, []);
  assert.equal(on.previewNotice, null);
  assert.deepEqual(planPortable(p.input(ON)).revision, on.revision);
  assert.deepEqual(planPortable(p.input({ ...ON, engines: [{ id: 'opencode' }] })).engines.map(e => e.id), ['opencode']);
});

test('without an explicit choice the switch is read from the environment, exactly 1', t => {
  const p = project(t);
  const input = p.input(); delete input.previewEngines;
  const before = process.env.BOWERLOOM_PREVIEW_ENGINES;
  t.after(() => { if (before === undefined) delete process.env.BOWERLOOM_PREVIEW_ENGINES; else process.env.BOWERLOOM_PREVIEW_ENGINES = before; });
  delete process.env.BOWERLOOM_PREVIEW_ENGINES;
  assert.deepEqual(planPortable(input).engines.map(e => e.id), ['claude-code', 'codex']);
  process.env.BOWERLOOM_PREVIEW_ENGINES = 'true';
  assert.deepEqual(planPortable(input).engines.map(e => e.id), ['claude-code', 'codex']);
  process.env.BOWERLOOM_PREVIEW_ENGINES = '1';
  assert.equal(planPortable(input).engines.length, 5);
});

test('the revision covers the engine set: a plan made with the switch off cannot be applied with it on, or the reverse', async t => {
  const p = project(t);
  const off = planPortable(p.input(OFF)), on = planPortable(p.input(ON));
  assert.notEqual(off.revision, on.revision);
  const before = snapshot(p.dir);
  await assert.rejects(applyPortable(p.input(ON), off.revision), error => error?.code === 'STALE_APPROVAL');
  await assert.rejects(applyPortable(p.input(OFF), on.revision), error => error?.code === 'STALE_APPROVAL');
  assert.deepEqual(snapshot(p.dir), before, 'nothing was written');
  await applyPortable(p.input(OFF), off.revision);
  assert.deepEqual(readPortableReceipt(p.input()).engines.map(e => e.id), ['claude-code', 'codex']);
});

test('removal and drift stay open: a flagged install to a preview engine is removed with the switch off', async t => {
  const p = project(t);
  const before = snapshot(p.dir);
  const on = planPortable(p.input(ON));
  await applyPortable(p.input(ON), on.revision);
  assert.ok(fs.existsSync(path.join(p.dir, '.agents/skills/review/SKILL.md')));
  assert.ok(readPortableReceipt(p.input()).engines.some(e => e.id === 'opencode'));
  assert.deepEqual(portableDrift(p.input(OFF)), [], 'drift reads the receipt');
  // Removal takes no engine input: it follows the receipt.
  const removal = planPortableRemoval(p.input(OFF));
  await applyPortableRemoval(p.input(OFF), removal.revision);
  assert.deepEqual(snapshot(p.dir), before, 'every file the flagged install wrote is gone');
  assert.equal(readPortableReceipt(p.input()), null);
});
