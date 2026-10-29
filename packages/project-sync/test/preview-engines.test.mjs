// Beta.1 supports Claude Code and Codex. OpenCode, Pi, and DeepSeek Harness are preview engines: install to them is refused unless the
// preview switch is on. Adoption, drift, status, and removal stay open. Both the command line and the app plan through planPortable.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  applyPortable, applyPortableRemoval, planPortable, planPortableRemoval, portableDrift, readPortableReceipt,
} from '../../../dist/packages/project-sync/src/index.js';
import { EnginePreviewRefusal } from '../../../dist/packages/skill-manifest/src/engine.js';
import { FIVE, json, project, snapshot } from './portable-fixture.mjs';
import { revisionOf } from '../../../dist/packages/project-sync/src/portable-files.js';
import { approveAll, lockedProject } from './locked-fixture.mjs';

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

// ---- left alone: a preview engine that an earlier flagged install wrote is neither deleted nor restored ------------------------

const RULES = [{ id: 'no-push-main', action: 'shell', pattern: 'git push * main', effect: 'deny', strength: 'enforced' }];
const isPreview = id => ['opencode', 'pi', 'deepseek-harness'].includes(id);
const keyOf = a => [a.part, a.entry, a.field ?? '', a.engine].join('\u0000');
const sha = (p, rel) => createHash('sha256').update(fs.readFileSync(path.join(p.dir, rel))).digest('hex');

/** A project with locked-in parts for all five engines, installed with the switch on. */
async function flagged(t) {
  const p = lockedProject(t, { rules: RULES, hooks: [{ id: 'guard', event: 'PreToolUse', matcher: 'Bash', command: '${PROJECT_DIR}/scripts/guard.sh', strength: 'enforced' }] });
  let approvals = [];
  try { planPortable(p.input(ON)); } catch (e) { if (e.code !== 'PORTABLE_FIDELITY') throw e; approvals = approveAll(p, e); }
  const plan = planPortable(p.input({ ...ON, approvals }));
  await applyPortable(p.input({ ...ON, approvals }), plan.revision);
  const receipt = readPortableReceipt(p.input());
  const only = receipt.files.filter(f => f.engines.length > 0 && f.engines.every(isPreview));
  return { p, receipt, only, approvals: receipt.approvals };
}

test('left alone: with the switch off, files of preview engines from an earlier install stay unchanged targets, named or not', async t => {
  const { p, only, receipt } = await flagged(t);
  assert.ok(only.length >= 3, `preview-only files: ${only.map(f => f.path).join(', ')}`);
  assert.ok(receipt.approvals.some(a => isPreview(a.engine)), 'an approval for a preview engine is recorded');
  for (const named of [undefined, [{ id: 'claude-code' }, { id: 'codex' }]]) {
    const plan = planPortable(p.input({ ...OFF, approvals: receipt.approvals, ...(named ? { engines: named } : {}) }));
    assert.deepEqual(plan.engines.map(e => e.id), ['claude-code', 'codex']);
    assert.deepEqual(plan.skippedPreview, ['opencode', 'pi', 'deepseek-harness']);
    assert.deepEqual(plan.keptPreview.map(e => e.id), ['opencode', 'pi', 'deepseek-harness']);
    for (const f of only) {
      const c = plan.changes.find(x => x.path === f.path);
      assert.ok(c, f.path); assert.equal(c.action, 'unchanged', `${f.path} is ${c.action}`);
    }
    assert.ok(!plan.changes.some(c => c.action === 'delete' || c.action === 'restore'), 'nothing is deleted or restored');
    assert.match(plan.previewNotice, /^Preview engines skipped: opencode, pi, deepseek-harness\. Their files from an earlier install are left as they are\. Set BOWERLOOM_PREVIEW_ENGINES=1 to install to them\.$/);
  }
});

test('left alone: the new receipt carries the files, the engines, and the approvals of the preview engines forward; drift stays quiet; the third plan is a no-op', async t => {
  const { p, only, receipt, approvals } = await flagged(t);
  const before = Object.fromEntries(only.map(f => [f.path, sha(p, f.path)]));
  const input = p.input({ ...OFF, approvals, engines: [{ id: 'claude-code' }, { id: 'codex' }] });
  const plan = planPortable(input);
  await applyPortable(input, plan.revision);
  for (const f of only) assert.equal(sha(p, f.path), before[f.path], `${f.path} is byte for byte the same`);
  const after = readPortableReceipt(p.input());
  assert.deepEqual(after.engines.map(e => e.id), receipt.engines.map(e => e.id), 'the receipt still lists every engine');
  for (const f of only) assert.deepEqual(after.files.find(x => x.path === f.path), f, `${f.path} is carried forward unchanged`);
  const kept = a => approvals.filter(x => isPreview(x.engine)).map(x => [keyOf(x), JSON.stringify(x)]);
  for (const [k, text] of kept()) assert.equal(JSON.stringify(after.approvals.find(a => keyOf(a) === k)), text, 'an approval of a preview engine is carried forward');
  assert.deepEqual(portableDrift(p.input(OFF)), [], 'drift with the switch off reports nothing');
  assert.equal(planPortable(p.input({ ...OFF, approvals: after.approvals, engines: [{ id: 'claude-code' }, { id: 'codex' }] })).noop, true, 'the next plan has nothing to do');
  assert.equal(planPortable(p.input({ ...OFF, approvals: after.approvals })).noop, true, 'the same with no engine named');
});

test('left alone: the revision differs from the switch-on plan, and a file a person changed in a kept path does not block the install', async t => {
  const { p, only, approvals } = await flagged(t);
  const off = planPortable(p.input({ ...OFF, approvals })), on = planPortable(p.input({ ...ON, approvals }));
  assert.notEqual(off.revision, on.revision);
  assert.deepEqual(on.keptPreview, []); assert.equal(on.previewNotice, null);
  fs.appendFileSync(path.join(p.dir, only[0].path), '\n// a person\'s edit\n');
  const plan = planPortable(p.input({ ...OFF, approvals }));
  assert.equal(plan.changes.find(c => c.path === only[0].path).action, 'unchanged');
  assert.ok(portableDrift(p.input(OFF)).some(d => d.path === only[0].path), 'drift still reports the changed file');
});

test('left alone: remove with the switch off still removes the files, even after an install with the switch off', async t => {
  const { p, only, approvals } = await flagged(t);
  const before = snapshot(p.dir);
  const input = p.input({ ...OFF, approvals });
  await applyPortable(input, planPortable(input).revision);
  for (const f of only) assert.ok(fs.existsSync(path.join(p.dir, f.path)), f.path);
  const removal = planPortableRemoval(p.input(OFF));
  await applyPortableRemoval(p.input(OFF), removal.revision);
  for (const f of only) assert.equal(fs.existsSync(path.join(p.dir, f.path)), false, f.path);
  assert.equal(readPortableReceipt(p.input()), null);
  assert.ok(Object.keys(snapshot(p.dir)).length <= Object.keys(before).length);
});

test('a named supported engine still reports the listed preview engines as skipped', t => {
  const p = project(t);
  const plan = planPortable(p.input({ ...OFF, engines: [{ id: 'codex' }] }));
  assert.deepEqual(plan.skippedPreview, ['opencode', 'pi', 'deepseek-harness']);
  assert.deepEqual(plan.keptPreview, [], 'nothing was installed before, so nothing is kept');
  assert.match(plan.previewNotice, /^Preview engines skipped: opencode, pi, deepseek-harness\. Set BOWERLOOM_PREVIEW_ENGINES=1 to install to them\.$/);
});

test('the refusal reads the same for install, accept, and a preview-only harness: it says nothing was installed only if it was never tried', () => {
  const error = new EnginePreviewRefusal('pi');
  assert.doesNotMatch(error.message, /Nothing was installed/);
  assert.match(error.message, /^pi is a preview engine in this beta\./);
});

// ---- verification round: shared paths, switching back on, older receipts, and sources -------------------------------------------

test('left alone: a path owned by a kept preview engine and a supported engine that is no longer a target stays, narrowed to the kept owners', async t => {
  const p = project(t);
  const first = planPortable(p.input(ON));
  await applyPortable(p.input(ON), first.revision);
  const shared = readPortableReceipt(p.input()).files.find(f => f.path === '.agents/skills/review/SKILL.md');
  assert.deepEqual(shared.engines, ['codex', 'opencode', 'pi', 'deepseek-harness'], 'the path is shared before');
  const before = sha(p, shared.path);
  const input = p.input({ ...OFF, engines: [{ id: 'claude-code' }] });
  const plan = planPortable(input);
  const change = plan.changes.find(c => c.path === shared.path);
  assert.equal(change.action, 'unchanged', 'not deleted while OpenCode, Pi, and DeepSeek Harness stay in the receipt');
  assert.deepEqual(change.engines, ['opencode', 'pi', 'deepseek-harness']);
  await applyPortable(input, plan.revision);
  assert.equal(sha(p, shared.path), before);
  const after = readPortableReceipt(p.input());
  assert.deepEqual(after.files.find(f => f.path === shared.path).engines, ['opencode', 'pi', 'deepseek-harness']);
  assert.ok(after.engines.some(e => e.id === 'opencode'));
});

test('switching on again after an off install needs no new approval, changes no file byte, restores the engine lists, and leaves the next plan a no-op', async t => {
  const { p, receipt, approvals } = await flagged(t);
  const snap = snapshot(p.dir);
  const off = p.input({ ...OFF, approvals });
  await applyPortable(off, planPortable(off).revision);
  const mid = readPortableReceipt(p.input());
  assert.notDeepEqual(mid.files.map(f => f.engines), receipt.files.map(f => f.engines), 'the shared lists shrank while the switch was off');
  const on = p.input({ ...ON, approvals: mid.approvals });
  const plan = planPortable(on);
  assert.deepEqual(plan.skippedPreview, []); assert.deepEqual(plan.keptPreview, []);
  assert.ok(plan.changes.every(c => c.action === 'unchanged'), 'no file changes');
  await applyPortable(on, plan.revision);
  assert.deepEqual(snapshot(p.dir), snap, 'every file and mode is as it was');
  const back = readPortableReceipt(p.input());
  assert.deepEqual(back.files, receipt.files, 'the engine lists of the shared files are restored');
  assert.deepEqual(back.engines, receipt.engines);
  assert.deepEqual(back.approvals, receipt.approvals);
  assert.equal(planPortable(p.input({ ...ON, approvals: back.approvals })).noop, true);
});

for (const form of ['v1beta3', 'v1beta2']) {
  test(`a receipt of the older ${form} shape, planned with the switch off, leaves the preview files alone`, async t => {
    const { p, approvals } = await flagged(t);
    const file = path.join(p.stateDir, 'receipt.json');
    const { revision: _r, ...body } = JSON.parse(fs.readFileSync(file, 'utf8'));
    const old = { ...body, format: `bowerloom/portable-projection-receipt/${form}`, sources: body.sources.map(({ claimed: _c, ...s }) => s) };
    if (form === 'v1beta2') delete old.approvals;
    fs.writeFileSync(file, JSON.stringify({ ...old, revision: revisionOf(old) }, null, 2) + '\n', { mode: 0o600 });
    const receipt = readPortableReceipt(p.input());
    assert.ok(receipt.engines.some(e => e.id === 'opencode'), 'the older receipt reads');
    const only = receipt.files.filter(f => f.engines.length > 0 && f.engines.every(isPreview));
    assert.ok(only.length > 0);
    const before = snapshot(p.dir);
    const input = p.input({ ...OFF, approvals });
    const plan = planPortable(input);
    assert.deepEqual(plan.keptPreview.map(e => e.id), ['opencode', 'pi', 'deepseek-harness']);
    for (const f of only) assert.equal(plan.changes.find(c => c.path === f.path).action, 'unchanged', f.path);
    await applyPortable(input, plan.revision);
    assert.deepEqual(snapshot(p.dir), before, 'no file changed');
    const after = readPortableReceipt(p.input());
    for (const f of only) assert.deepEqual(after.files.find(x => x.path === f.path), f);
    assert.equal(after.format, 'bowerloom/portable-projection-receipt/v1beta4');
  });
}

test('left alone: the sources of a skill only a preview engine reads are carried forward', async t => {
  const p = project(t, {
    skills: { review: { engines: ['opencode'] } }, parts: { plugins: 'sources.json' },
    files: { 'sources.json': json({ sources: [{ name: 'review-kit', marketplace: 'example-market', version: '1.2.0', claimed: true, items: [{ part: 'skills', id: 'review' }] }] }) },
  });
  const first = planPortable(p.input(ON));
  await applyPortable(p.input(ON), first.revision);
  // A claimed source: a receipt with an unclaimed one does not read back (see the report), so this test uses the form that does.
  const source = { skill: 'review', name: 'review-kit', marketplace: 'example-market', version: '1.2.0', claimed: true };
  assert.deepEqual(readPortableReceipt(p.input()).sources, [source]);
  const input = p.input(OFF);
  const plan = planPortable(input);
  assert.deepEqual(plan.sources, [source], 'the plan carries it');
  await applyPortable(input, plan.revision);
  assert.deepEqual(readPortableReceipt(p.input()).sources, [source], 'the receipt keeps it');
  assert.ok(fs.existsSync(path.join(p.dir, '.claude/skills/review/SKILL.md')), 'the skill the source belongs to is still there');
});
