// Step 0 of Bowerloom 0.8: the portable installer names engines. The stored plan and receipt keep their exact bytes,
// so they still say `harness: "claude"`. The input takes both spellings. An engine with no writer is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { planInstallation } from '../../../dist/packages/portable/src/index.js';
import { projectionFor } from '../../../dist/packages/portable/src/harness-projection.js';

function fixture(t) {
  const parent = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'bowerloom-portable-engines-')));
  fs.chmodSync(parent, 0o700);
  const bundleDir = join(parent, 'bundle');
  fs.cpSync(resolve('examples/portable/report-seed'), bundleDir, { recursive: true });
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { bundleDir, selected: ['editorial'], harness: 'codex', targetDir: join(parent, 'workspace') };
}
const code = expected => error => error?.code === expected;

test('claude-code and the old id claude give the same plan, with the stored id the plan has always had', t => {
  const input = fixture(t), old = planInstallation({ ...input, harness: 'claude' }), current = planInstallation({ ...input, harness: 'claude-code' });
  assert.equal(current.revision, old.revision); assert.equal(current.harness, 'claude'); assert.equal(current.adapterVersion, 'claude/project-skills/v1alpha1');
  assert.equal(projectionFor('claude-code'), projectionFor('claude'));
});

test('an engine with no writer is refused by name, and an id nobody knows keeps its own refusal', t => {
  const input = fixture(t);
  for (const engine of ['opencode', 'pi', 'deepseek-harness']) {
    assert.throws(() => planInstallation({ ...input, harness: engine }), error => error?.code === 'ENGINE_NO_WRITER' && error.message === `no writer for engine ${engine} yet`, engine);
    assert.equal(projectionFor(engine), undefined, 'no projection is made for it');
  }
  assert.throws(() => planInstallation({ ...input, harness: 'unknown' }), code('UNSUPPORTED_HARNESS'));
});
