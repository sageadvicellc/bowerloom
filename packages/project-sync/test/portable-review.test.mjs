// The fix round of the portable projection: review rulings P1 to P28 on cf2d4a9. Each test names its ruling.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import fs from 'node:fs';
import path from 'node:path';
import * as index from '../../../dist/packages/project-sync/src/index.js';
import {
  LOCKED_IN_REASON, NOTHING, PARTIAL_NOTICE, applyPortable, applyPortableRecovery, applyPortableRemoval, atImports, instructionDrift,
  planPortable, planPortableRecovery, planPortableRemoval, portableDrift, readPortableReceipt,
} from '../../../dist/packages/project-sync/src/index.js';
import { applyPortableRemovalWith, applyPortableWith } from '../../../dist/packages/project-sync/src/portable-run.js';
import { ENGINE_IDS, skillContentHash } from '../../../dist/packages/harness-definition/src/index.js';
import {
  INSTRUCTIONS, assert, code, crashAt, forge, isCaseSensitive, json, project, projectNow, sha, skill, snapshot,
} from './portable-fixture.mjs';

const signal = () => new AbortController().signal;
const pending = p => path.join(p.stateDir, 'pending.json');
const blobs = p => { try { return fs.readdirSync(path.join(p.stateDir, 'blobs')).sort(); } catch { return []; } };
async function recover(p, extra = {}) { const plan = planPortableRecovery(p.input(extra)); await applyPortableRecovery(p.input(extra), plan.revision); return plan; }
async function remove(p) { const plan = planPortableRemoval(p.input()); return applyPortableRemoval(p.input(), plan.revision); }

// ---- P1, P15: forged state records ---------------------------------------------------------------------------------------

test('P1: a receipt with a forged path, folder, or mode, or a receipt of another project, is refused and nothing outside is touched', async t => {
  const outside = (p, name) => { const f = path.join(p.base, name); fs.writeFileSync(f, 'keep me\n'); return f; };
  const forgeries = [
    ['../outside.txt', r => { r.files[0].path = '../outside.txt'; }],
    ['.git/hooks/pre-commit', r => { r.files[0].path = '.git/hooks/pre-commit'; }],
    ['AGENTS.md/../../x', r => { r.files[0].path = '.claude/skills/review/../../../x'; }],
    ['created folder', r => { r.createdDirs.push('.git'); }],
    ['created folder up', r => { r.createdDirs.push('.claude/skills/../..'); }],
    ['mode bits', r => { r.files[0].mode = 0o4755; }],
    ['short hash', r => { r.files[0].original = { sha256: 'abc', mode: 0o644 }; }],
    ['extra key', r => { r.extra = true; }],
  ];
  for (const [label, change] of forgeries) {
    const p = project(t);
    const keep = outside(p, 'outside.txt');
    await projectNow(p.input());
    forge(p.stateDir, 'receipt.json', change);
    for (const call of [() => planPortableRemoval(p.input()), () => planPortable(p.input()), () => portableDrift(p.input())]) assert.throws(call, code('PORTABLE_STATE_INVALID'), label);
    assert.equal(fs.readFileSync(keep, 'utf8'), 'keep me\n', label);
  }
  // A receipt copied from another project names that project: it is foreign here.
  const a = project(t), b = project(t);
  await projectNow(a.input());
  fs.mkdirSync(b.stateDir, { recursive: true, mode: 0o700 });
  fs.copyFileSync(path.join(a.stateDir, 'receipt.json'), path.join(b.stateDir, 'receipt.json')); fs.chmodSync(path.join(b.stateDir, 'receipt.json'), 0o600);
  assert.throws(() => planPortableRemoval(b.input()), code('PORTABLE_STATE_FOREIGN'));
  assert.throws(() => planPortable(b.input()), code('PORTABLE_STATE_FOREIGN'));
});

test('P1, P15, P28: a forged or corrupt pending marker is refused by recovery; a plan refuses until it is recovered', async t => {
  const p = project(t);
  const { crash, hook } = crashAt(1);
  await assert.rejects(applyPortableWith(p.input(), planPortable(p.input()).revision, signal(), { afterStep: hook }), e => e === crash);
  forge(p.stateDir, 'pending.json', m => { m.steps[0].path = '../escape.md'; });
  assert.throws(() => planPortableRecovery(p.input()), code('PORTABLE_STATE_INVALID'));
  forge(p.stateDir, 'pending.json', m => { m.steps[0].path = '.agents/skills/review/SKILL.md'; m.kind = 'erase'; });
  assert.throws(() => planPortableRecovery(p.input()), code('PORTABLE_STATE_INVALID'));
  fs.writeFileSync(pending(p), '{ not json'); fs.chmodSync(pending(p), 0o600);
  assert.throws(() => planPortableRecovery(p.input()), code('PORTABLE_STATE_INVALID'));
  assert.throws(() => planPortable(p.input()), code('PORTABLE_RECOVERY_REQUIRED'));
});

// ---- P2: a folder swapped for a link mid-run ------------------------------------------------------------------------------

test('P2: a skill folder swapped for a link mid-apply is refused, rolled back, and nothing is written outside', async t => {
  const p = project(t);
  const outside = path.join(p.base, 'outside'); fs.mkdirSync(outside);
  const before = snapshot(p.dir);
  const plan = planPortable(p.input());
  let n = 0;
  const swap = () => {
    if (++n !== 2) return; // both .agents files are written; .claude is next
    fs.renameSync(path.join(p.dir, '.claude/skills'), path.join(p.base, 'moved'));
    fs.symlinkSync(outside, path.join(p.dir, '.claude/skills'));
  };
  await assert.rejects(applyPortableWith(p.input(), plan.revision, signal(), { afterStep: swap }), code('PORTABLE_PATH_UNSAFE'));
  assert.deepEqual(fs.readdirSync(outside), [], 'nothing was written outside');
  assert.equal(fs.existsSync(path.join(p.dir, '.agents/skills/review')), false, 'the written steps were rolled back');
  assert.equal(fs.existsSync(pending(p)), false);
  assert.equal(readPortableReceipt(p.input()), null);
  fs.unlinkSync(path.join(p.dir, '.claude/skills')); fs.renameSync(path.join(p.base, 'moved'), path.join(p.dir, '.claude/skills'));
  fs.rmSync(path.join(p.dir, '.claude'), { recursive: true });
  assert.deepEqual(snapshot(p.dir), before);
});

test('P2: a link put where Bowerloom creates a folder is refused before anything is written through it', async t => {
  const p = project(t);
  const outside = path.join(p.base, 'outside'); fs.mkdirSync(outside);
  const plan = planPortable(p.input());
  const plant = point => { if (point === 'before-steps') fs.symlinkSync(outside, path.join(p.dir, '.claude')); };
  await assert.rejects(applyPortableWith(p.input(), plan.revision, signal(), { at: plant }), code('PORTABLE_PATH_UNSAFE'));
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.existsSync(pending(p)), false);
});

// ---- P3, P24: a file changed or created during the run --------------------------------------------------------------------

test('P3: a file changed after the plan stops the run with drift; the person\'s bytes are kept, in place and saved', async t => {
  const p = project(t);
  fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), 'Old shared rules.\n');
  const plan = planPortable(p.input());
  const edit = () => { fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), 'Edited during the run.\n'); };
  await assert.rejects(applyPortableWith(p.input(), plan.revision, signal(), { at: point => { if (point === 'before-steps') edit(); } }), code('PORTABLE_DRIFT'));
  assert.equal(fs.readFileSync(path.join(p.dir, 'AGENTS.md'), 'utf8'), 'Edited during the run.\n');
  assert.ok(blobs(p).includes(sha('Edited during the run.\n')), 'the new backup is kept');
  assert.equal(fs.existsSync(path.join(p.dir, '.claude/skills/review')), false);
});

test('P24: a file that appears where Bowerloom creates one is never overwritten', async t => {
  const p = project(t);
  const plan = planPortable(p.input());
  const appear = point => { if (point === 'before-steps') fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), 'Mine.\n'); };
  await assert.rejects(applyPortableWith(p.input(), plan.revision, signal(), { at: appear }), code('PORTABLE_DRIFT'));
  assert.equal(fs.readFileSync(path.join(p.dir, 'AGENTS.md'), 'utf8'), 'Mine.\n');
});

// ---- P4: the state folder ---------------------------------------------------------------------------------------------------

test('P4: a state path that is not normalized, or that reaches the project through a link, is refused', t => {
  const p = project(t);
  assert.throws(() => planPortable(p.input({ stateDir: `${p.base}/state/../state/portable` })), code('PORTABLE_STATE_UNSAFE'));
  assert.throws(() => planPortable(p.input({ stateDir: `${p.base}/state//portable` })), code('PORTABLE_STATE_UNSAFE'));
  fs.symlinkSync(p.dir, path.join(p.base, 'alias'));
  assert.throws(() => planPortable(p.input({ stateDir: path.join(p.base, 'alias', 'state') })), code('PORTABLE_STATE_UNSAFE'));
  fs.symlinkSync(p.base, path.join(p.base, 'up'));
  assert.throws(() => planPortable(p.input({ stateDir: path.join(p.base, 'up') })), code('PORTABLE_STATE_UNSAFE'), 'a state folder above the project');
});

test('P28: a state folder with the wrong mode is refused', async t => {
  const p = project(t);
  await projectNow(p.input());
  fs.chmodSync(p.stateDir, 0o755);
  assert.throws(() => planPortable(p.input()), code('PORTABLE_STATE_UNSAFE'));
});

// ---- P5: the README ---------------------------------------------------------------------------------------------------------

test('P5: the package README states what the state folder keeps and what a lost one means', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /backups? .*stay .*until removal/i);
  assert.match(readme, /permission bits only/i);
  assert.match(readme, /lost state folder/i);
});

// ---- P6: case clashes -------------------------------------------------------------------------------------------------------

test('P6: a file or folder that differs only in case from a projected path is refused at plan time', t => {
  const p = project(t);
  fs.writeFileSync(path.join(p.dir, 'agents.md'), 'Lower case.\n');
  assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_CASE_CLASH' && /AGENTS\.md and agents\.md/.test(e.message));
  fs.rmSync(path.join(p.dir, 'agents.md'));
  fs.mkdirSync(path.join(p.dir, '.Claude'));
  assert.throws(() => planPortable(p.input()), code('PORTABLE_CASE_CLASH'));
});

test('P6: two definition files that differ only in case are refused (case-sensitive file systems only)', t => {
  const p = project(t);
  if (!isCaseSensitive(p.base)) { t.skip('this file system folds case, so the pair cannot exist'); return; }
  fs.writeFileSync(path.join(p.def, 'skills/review/references/Notes.md'), 'Other notes.\n');
  assert.throws(() => planPortable(p.input()), code('PORTABLE_CASE_CLASH'));
});

// ---- P7: no hooks in the public API -------------------------------------------------------------------------------------------

test('P7: the index exports applyPortable without hooks, and no hook entry point', () => {
  assert.equal('applyPortableWith' in index, false); assert.equal('applyPortableRemovalWith' in index, false);
  assert.equal(applyPortable.length, 2); assert.equal(applyPortableRemoval.length, 2);
});

// ---- P9: post-run failures and missing folders ------------------------------------------------------------------------------

test('P9: a failure after every file is applied refuses PORTABLE_PARTIAL, keeps the marker, and recovery completes it', async t => {
  const p = project(t);
  const plan = planPortable(p.input());
  const fail = point => { if (point === 'after-receipt') throw new Error('disk full'); };
  await assert.rejects(applyPortableWith(p.input(), plan.revision, signal(), { at: fail }), e => e.code === 'PORTABLE_PARTIAL' && /Every file is applied/.test(e.message));
  assert.ok(fs.existsSync(pending(p)));
  const r = await recover(p);
  assert.equal(r.action, 'complete');
  assert.equal(fs.existsSync(pending(p)), false); assert.equal(readPortableReceipt(p.input()).planRevision, plan.revision);
  assert.equal(planPortable(p.input()).noop, true);
});

test('P9: rollback recreates a folder that was removed, before it restores the file', async t => {
  const p = project(t, { files: { 'skills/deploy/SKILL.md': skill('deploy') } });
  await projectNow(p.input());
  fs.rmSync(path.join(p.def, 'skills/deploy'), { recursive: true });
  const before = snapshot(p.dir);
  const plan = planPortable(p.input());
  const { crash, hook } = crashAt(2); // both deploy files are deleted
  await assert.rejects(applyPortableWith(p.input(), plan.revision, signal(), { afterStep: hook }), e => e === crash);
  for (const root of ['.agents/skills/deploy', '.claude/skills/deploy']) fs.rmdirSync(path.join(p.dir, root));
  const r = await recover(p);
  assert.equal(r.action, 'rollback');
  assert.deepEqual(snapshot(p.dir), before);
});

// ---- P10: rollback past a failing step, and keeping a person's version -----------------------------------------------------

test('P10: rollback keeps going past a path it cannot undo, refuses PORTABLE_PARTIAL, and recovery can keep the person\'s version', async t => {
  const p = project(t);
  const plan = planPortable(p.input());
  let n = 0;
  const hook = () => {
    if (++n !== 3) return;
    fs.writeFileSync(path.join(p.dir, '.agents/skills/review/SKILL.md'), 'Edited by a person.\n');
    throw new Error('a later step failed');
  };
  await assert.rejects(applyPortableWith(p.input(), plan.revision, signal(), { afterStep: hook }), e => e.code === 'PORTABLE_PARTIAL' && e.paths.includes('.agents/skills/review/SKILL.md'));
  assert.equal(fs.existsSync(path.join(p.dir, '.agents/skills/review/references/notes.md')), false, 'the other written step was undone');
  assert.equal(fs.existsSync(path.join(p.dir, '.claude/skills/review/SKILL.md')), false);
  assert.ok(fs.existsSync(pending(p)));
  assert.throws(() => planPortableRecovery(p.input()), e => e.code === 'PORTABLE_DRIFT' && /SKILL\.md \(changed\)/.test(e.message));
  assert.throws(() => planPortableRecovery(p.input({ keep: ['AGENTS.md'] })), code('PORTABLE_DRIFT'));
  const r = await recover(p, { keep: ['.agents/skills/review/SKILL.md'] });
  assert.deepEqual(r.keep, ['.agents/skills/review/SKILL.md']);
  assert.equal(fs.readFileSync(path.join(p.dir, '.agents/skills/review/SKILL.md'), 'utf8'), 'Edited by a person.\n');
  assert.equal(fs.existsSync(pending(p)), false);
});

test('P10, P13, P28: a deleted projected file is drift with reason missing; keeping it drops it from the receipt', async t => {
  const p = project(t);
  await projectNow(p.input());
  fs.rmSync(path.join(p.dir, '.claude/skills/review/references/notes.md'));
  assert.deepEqual(portableDrift(p.input()).map(d => [d.path, d.reason]), [['.claude/skills/review/references/notes.md', 'missing']]);
  assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_DRIFT' && /notes\.md \(missing\)/.test(e.message));
  assert.throws(() => planPortableRemoval(p.input()), code('PORTABLE_DRIFT'));
  assert.throws(() => planPortableRecovery(p.input()), code('PORTABLE_RECOVER_NOTHING'));
  assert.throws(() => planPortableRecovery(p.input({ keep: ['AGENTS.md'] })), code('PORTABLE_USAGE'), 'only a drifted path can be kept');
  const r = await recover(p, { keep: ['.claude/skills/review/references/notes.md'] });
  assert.equal(r.action, 'keep');
  assert.equal(readPortableReceipt(p.input()).files.some(f => f.path.endsWith('.claude/skills/review/references/notes.md')), false);
  assert.equal(planPortable(p.input()).changes.find(c => c.path === '.claude/skills/review/references/notes.md').action, 'create');
});

test('P13: a projected file replaced by a link is drift with reason unsafe', async t => {
  const p = project(t);
  await projectNow(p.input());
  fs.rmSync(path.join(p.dir, 'AGENTS.md')); fs.symlinkSync(path.join(p.base, 'elsewhere.md'), path.join(p.dir, 'AGENTS.md'));
  assert.deepEqual(portableDrift(p.input()).map(d => [d.path, d.reason]), [['AGENTS.md', 'unsafe']]);
});

// ---- P11: a lost lock ---------------------------------------------------------------------------------------------------------

test('P11: after the lock is lost, the run touches no project file, keeps the marker, and refuses PORTABLE_LOCK_LOST', async t => {
  const p = project(t);
  const plan = planPortable(p.input());
  const controller = new AbortController();
  let n = 0;
  await assert.rejects(applyPortableWith(p.input(), plan.revision, controller.signal, { afterStep: () => { if (++n === 2) controller.abort(); } }), code('PORTABLE_LOCK_LOST'));
  assert.ok(fs.existsSync(path.join(p.dir, '.agents/skills/review/references/notes.md')), 'the written steps stay: nothing was rolled back');
  assert.ok(fs.existsSync(pending(p)));
  const r = await recover(p);
  assert.equal(r.action, 'rollback');
  assert.equal(fs.existsSync(path.join(p.dir, '.agents')), false);
});

// ---- P12: folders left behind, temporaries, unused blobs ----------------------------------------------------------------------

test('P12: removal reports a created folder it cannot remove; an update keeps such a folder in the receipt', async t => {
  const p = project(t, { files: { 'skills/deploy/SKILL.md': skill('deploy') } });
  await projectNow(p.input());
  fs.writeFileSync(path.join(p.dir, '.claude/skills/deploy/mine.md'), 'A person\'s file.\n');
  fs.rmSync(path.join(p.def, 'skills/deploy'), { recursive: true });
  const { result } = await projectNow(p.input());
  assert.deepEqual(result.leftBehind, [{ path: '.claude/skills/deploy', reason: 'not-empty' }]);
  assert.ok(result.receipt.createdDirs.includes('.claude/skills/deploy'));
  const removed = await remove(p);
  assert.ok(removed.leftBehind.some(l => l.path === '.claude/skills/deploy' && l.reason === 'not-empty'));
  assert.ok(removed.leftBehind.some(l => l.path === '.claude' && l.reason === 'not-empty'));
  assert.deepEqual(fs.readdirSync(p.dir).filter(n => n !== '.bowerloom').sort(), ['.claude']);
});

test('P12: recovery sweeps writer temporaries beside journaled paths, and a failed run leaves only the originals saved', async t => {
  const p = project(t);
  fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), 'Old shared rules.\n');
  const plan = planPortable(p.input());
  const { crash, hook } = crashAt(1);
  await assert.rejects(applyPortableWith(p.input(), plan.revision, signal(), { afterStep: hook }), e => e === crash);
  const temp = path.join(p.dir, '.agents/skills/review/.SKILL.md.0123456789abcdef.bowerloom-tmp');
  fs.writeFileSync(temp, 'half written');
  await recover(p);
  assert.equal(fs.existsSync(temp), false);
  assert.deepEqual(blobs(p), [], 'no receipt, so no saved original');
});

// ---- P14: the loss report covers every listed part -------------------------------------------------------------------------

test('P14: every listed part gets a line per engine: locked-in parts from their writers, empty parts exact, a filtered tool-guidance skill absent', async t => {
  const p = project(t, {
    engines: [{ id: 'claude-code' }, { id: 'codex' }],
    parts: { mcp: 'mcp.json', hooks: 'hooks.json', 'tool-guidance': ['instructions/AGENTS.md#Tool guidance', 'skills/review'] },
    skills: { review: { engines: ['codex'] } },
    files: { 'mcp.json': json({ servers: [{ name: 'docs', transport: 'stdio', command: 'docs-mcp' }] }), 'hooks.json': json({ hooks: [] }) },
  });
  const plan = planPortable(p.input());
  for (const engine of ['claude-code', 'codex']) {
    const line = (part, entry) => plan.loss.find(l => l.part === part && l.entry === entry && l.engine === engine);
    // Step 3: the MCP writers carry the server, so the line is no longer the absent line of step 2.
    assert.equal(line('mcp', 'docs').result, engine === 'claude-code' ? 'exact' : 'translated'); assert.notEqual(line('mcp', 'docs').reason, LOCKED_IN_REASON);
    assert.equal(line('hooks', NOTHING).result, 'exact'); assert.match(line('hooks', NOTHING).reason, /Nothing to project/);
  }
  const guidance = plan.loss.find(l => l.part === 'tool-guidance' && l.entry === 'skills/review' && l.engine === 'claude-code');
  assert.equal(guidance.result, 'absent'); assert.match(guidance.reason, /filtered out for claude-code/);
  assert.equal(plan.loss.find(l => l.part === 'skills' && l.entry === NOTHING && l.engine === 'claude-code').result, 'exact');
  assert.equal(plan.partial, true); assert.equal(plan.notice, PARTIAL_NOTICE);
  const { result } = await projectNow(p.input());
  assert.equal(result.report.partial, true); assert.equal(result.report.notice, PARTIAL_NOTICE);
  // A harness with portable parts only is not partial.
  const q = project(t);
  assert.equal(planPortable(q.input()).partial, false); assert.equal(planPortable(q.input()).notice, null);
});

// ---- P16, P17: choices that do not apply ---------------------------------------------------------------------------------------

test('P16: a choice that does not apply comes back as ignored, with the reason', t => {
  const p = project(t, { engines: [{ id: 'codex' }] });
  const plan = planPortable(p.input({ reconcile: 'merge', piTrustSaved: true, writeClaudeMd: true }));
  assert.deepEqual(plan.ignored.map(i => [i.option, i.value]), [['reconcile', 'merge'], ['writeClaudeMd', true], ['piTrustSaved', true]]);
  for (const i of plan.ignored) assert.match(i.reason, /\S/);
  assert.equal(planPortable(p.input()).ignored.length, 0);
});

test('P17: with no instructions in the definition, AGENTS.md and CLAUDE.md are not touched and no reconcile is offered', async t => {
  const p = project(t, { noDefaults: true, parts: { skills: 'skills/' }, files: { 'skills/review/SKILL.md': skill('review') } });
  fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), 'Shared.\n'); fs.writeFileSync(path.join(p.dir, 'CLAUDE.md'), 'Claude only.\n');
  const plan = planPortable(p.input({ reconcile: 'accept-agents' }));
  assert.equal(plan.drift, null); assert.equal(plan.reconcile, null);
  assert.equal(plan.changes.some(c => c.path === 'AGENTS.md' || c.path === 'CLAUDE.md'), false);
  assert.equal(plan.ignored[0].option, 'reconcile');
  await applyPortable(p.input({ reconcile: 'accept-agents' }), plan.revision);
  assert.equal(fs.readFileSync(path.join(p.dir, 'CLAUDE.md'), 'utf8'), 'Claude only.\n');
});

// ---- P18, P19, P20 --------------------------------------------------------------------------------------------------------------

test('P18: the receipt records the source, marketplace, and version of each borrowed skill', async t => {
  const p = project(t, { parts: { plugins: 'sources.json' }, files: { 'sources.json': json({ sources: [{ name: 'review-kit', marketplace: 'example-market', version: '1.2.0', items: [{ part: 'skills', id: 'review' }] }] }) } });
  const { result } = await projectNow(p.input());
  assert.deepEqual(result.receipt.sources, [{ skill: 'review', name: 'review-kit', marketplace: 'example-market', version: '1.2.0' }]);
  assert.equal(result.report.loss.find(l => l.part === 'plugins' && l.engine === 'codex').result, 'translated');
});

test('P19, P28: filter leaks count only the engines being projected, with an OpenCode filter and an engine subset', t => {
  const p = project(t, { skills: { review: { engines: ['opencode'] } } });
  const plan = planPortable(p.input({ engines: [{ id: 'claude-code' }, { id: 'opencode' }] }));
  assert.deepEqual(plan.filterLeaks, [{ skill: 'review', path: '.claude/skills/review', engines: ['claude-code'] }]);
  assert.equal(plan.loss.find(l => l.part === 'skills' && l.entry === 'review' && l.engine === 'claude-code').result, 'weakened');
  assert.ok(plan.changes.some(c => c.path === '.agents/skills/review/SKILL.md'), 'OpenCode reads both folders');
  assert.deepEqual(planPortable(p.input({ engines: [{ id: 'opencode' }] })).filterLeaks, []);
});

test('P20: apply returns the receipt and the whole report', async t => {
  const p = project(t);
  const { plan, result } = await projectNow(p.input());
  assert.equal(result.noop, false); assert.equal(result.planRevision, plan.revision);
  for (const k of ['loss', 'partial', 'notice', 'deferred', 'filterLeaks', 'pendingTrust', 'ignored', 'offers']) assert.deepEqual(result.report[k], plan[k], k);
  assert.deepEqual(result.leftBehind, []);
  assert.deepEqual(result.receipt, readPortableReceipt(p.input()));
});

// ---- P21: a crash at each point of removal ----------------------------------------------------------------------------------------

test('P21: a crash at each point of removal recovers without undoing a removal that ran', async t => {
  for (const point of ['step', 'after-steps', 'after-receipt', 'after-finish']) {
    const p = project(t);
    fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), 'Old shared rules.\n');
    const original = snapshot(p.dir);
    await projectNow(p.input());
    const projected = snapshot(p.dir);
    const plan = planPortableRemoval(p.input());
    const crash = Object.assign(new Error('simulated crash'), { crash: true });
    const hooks = point === 'step' ? { afterStep: () => { throw crash; } } : { at: x => { if (x === point) throw crash; } };
    await assert.rejects(applyPortableRemovalWith(p.input(), plan.revision, signal(), hooks), e => e === crash, point);
    if (point === 'after-finish') {
      assert.throws(() => planPortableRecovery(p.input()), code('PORTABLE_RECOVER_NOTHING'), point);
      assert.deepEqual(Object.keys(snapshot(p.dir)).filter(k => !k.endsWith('/')), ['AGENTS.md'], 'only empty created folders are left');
      continue;
    }
    const r = await recover(p);
    if (point === 'step') { assert.equal(r.action, 'rollback', point); assert.deepEqual(snapshot(p.dir), projected, point); continue; }
    assert.equal(r.action, 'complete', point);
    assert.deepEqual(snapshot(p.dir), original, point);
    assert.equal(readPortableReceipt(p.input()), null, point);
  }
});

// ---- P22, P23: CLAUDE.md as a link, and Claude Code with no CLAUDE.md -------------------------------------------------------------

test('P22: a CLAUDE.md link to the project\'s AGENTS.md follows it and stays; any other link is refused', async t => {
  const p = project(t);
  fs.symlinkSync('AGENTS.md', path.join(p.dir, 'CLAUDE.md'));
  assert.equal(instructionDrift(p.dir, ENGINE_IDS, true), null);
  const { plan } = await projectNow(p.input());
  assert.equal(plan.changes.some(c => c.path === 'CLAUDE.md'), false);
  const line = plan.loss.find(l => l.part === 'system-prompt' && l.engine === 'claude-code');
  assert.equal(line.result, 'exact'); assert.match(line.reason, /link to AGENTS\.md/);
  assert.equal(fs.readlinkSync(path.join(p.dir, 'CLAUDE.md')), 'AGENTS.md');
  const q = project(t);
  fs.writeFileSync(path.join(q.base, 'other.md'), 'x\n'); fs.symlinkSync(path.join(q.base, 'other.md'), path.join(q.dir, 'CLAUDE.md'));
  assert.throws(() => planPortable(q.input()), e => e.code === 'PORTABLE_PATH_UNSAFE' && e.paths.includes('CLAUDE.md'));
});

test('P23: with no CLAUDE.md, Claude Code is exact only with no CLAUDE.local.md and a version that reads AGENTS.md; otherwise Bowerloom offers CLAUDE.md', async t => {
  const line = plan => plan.loss.find(l => l.part === 'system-prompt' && l.engine === 'claude-code');
  const p = project(t, { engines: [{ id: 'claude-code', version: '2.1.310' }] });
  assert.equal(line(planPortable(p.input())).result, 'exact'); assert.deepEqual(planPortable(p.input()).offers, []);
  const unknown = project(t, { engines: [{ id: 'claude-code' }] });
  assert.match(line(planPortable(unknown.input())).reason, /version is not known/);
  const old = project(t, { engines: [{ id: 'claude-code', version: '2.1.100' }] });
  const oldPlan = planPortable(old.input());
  assert.equal(line(oldPlan).result, 'weakened'); assert.match(line(oldPlan).reason, /older than 2\.1\.277/);
  assert.equal(oldPlan.offers[0].action, 'write-claude-md');
  const local = project(t, { engines: [{ id: 'claude-code', version: '2.1.310' }] });
  fs.writeFileSync(path.join(local.dir, 'CLAUDE.local.md'), 'Mine.\n');
  assert.equal(line(planPortable(local.input())).result, 'weakened');
  // Accepting the offer writes CLAUDE.md as @AGENTS.md, and the line is exact.
  const { plan, result } = await projectNow(local.input({ writeClaudeMd: true }));
  assert.equal(line(plan).result, 'exact');
  assert.equal(fs.readFileSync(path.join(local.dir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.ok(result.receipt.files.some(f => f.path === 'CLAUDE.md' && f.original === null));
});

// ---- P25: @word imports and fences -------------------------------------------------------------------------------------------------

test('P25: an @word import is refused when the word names a file in the project; a fence closes only with its length or longer', t => {
  const p = project(t, { files: { 'instructions/AGENTS.md': '# A\n\nSee @README for more.\n\n## Tool guidance\n\nx\n' } });
  assert.doesNotThrow(() => planPortable(p.input()), 'no README, so @README is a mention');
  fs.writeFileSync(path.join(p.dir, 'README'), 'Readme.\n');
  assert.throws(() => planPortable(p.input()), code('PORTABLE_AT_IMPORT'));
  assert.deepEqual(atImports('@Makefile\n', name => name === 'Makefile'), [{ line: 1, token: '@Makefile' }]);
  assert.deepEqual(atImports('````\n```\n@docs/a.md\n````\n@docs/b.md\n'), [{ line: 5, token: '@docs/b.md' }]);
  assert.deepEqual(atImports('~~~\n```\n@docs/a.md\n~~~\n'), []);
});

// ---- P27: a 0.7 managed copy -----------------------------------------------------------------------------------------------------

test('P27: a skill folder held by a 0.7 managed copy gets its own refusal that names the item', t => {
  const p = project(t);
  fs.mkdirSync(path.join(p.dir, '.claude/skills/review'), { recursive: true });
  fs.writeFileSync(path.join(p.dir, '.claude/skills/review/SKILL.md'), skill('review'));
  fs.mkdirSync(path.join(p.def, 'managed/catalog'), { recursive: true });
  fs.writeFileSync(path.join(p.def, 'managed/catalog/review.json'), '{}\n');
  assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_MANAGED_COPY' && /0\.7 item review/.test(e.message) && /Adoption \(step 3\)/.test(e.message));
});

test('step 3 contract: a folder a 0.7 managed copy holds is replaced only when sources.json records it with the same content hash', async t => {
  const old = skill('review', 'license: MIT\n').replace('Use review', 'An older review');
  const hashOf = files => skillContentHash('x', Object.entries(files).map(([rel, text]) => ({ path: `skills/x/${rel}`, bytes: Buffer.from(text) }))).slice('sha256:'.length);
  /** A project whose 0.7 copy of review is the canonical copy, a catalog, and the Claude Code folder. Null leaves a file out. */
  const make = (record, { canonical = old, catalog = '{}\n', folder = old, form = 'managed' } = {}) => {
    const v1 = form === 'v1';
    const recorded = v1 ? '.bowerloom-skills/skills/review' : '.bowerloom/managed/skills/review';
    const p = project(t, { engines: [{ id: 'claude-code' }], parts: { plugins: 'sources.json' }, files: { 'sources.json': json({ sources: [], adopted: [{ part: 'skills', id: 'review', adoptedFrom: { kind: '0.7-managed', path: recorded, sha256: record } }] }) } });
    const files = [['.claude/skills/review/SKILL.md', folder], [`${recorded}/SKILL.md`, canonical], [v1 ? '.bowerloom-skills/catalog.json' : '.bowerloom/managed/catalog/review.json', catalog]];
    for (const [rel, text] of files) { if (text === null) continue; fs.mkdirSync(path.dirname(path.join(p.dir, rel)), { recursive: true }); fs.writeFileSync(path.join(p.dir, rel), text); }
    return p;
  };
  const p = make(hashOf({ 'SKILL.md': old }));
  const plan = planPortable(p.input());
  assert.deepEqual(plan.changes.filter(c => c.path.startsWith('.claude/skills/review/')).map(c => [c.path, c.action]), [
    ['.claude/skills/review/SKILL.md', 'replace'], ['.claude/skills/review/references/notes.md', 'create'],
  ]);
  await applyPortable(p.input(), plan.revision);
  await remove(p);
  assert.equal(fs.readFileSync(path.join(p.dir, '.claude/skills/review/SKILL.md'), 'utf8'), old);
  assert.equal(fs.existsSync(path.join(p.dir, '.claude/skills/review/references')), false);
  assert.doesNotThrow(() => planPortable(make(hashOf({ 'SKILL.md': old }), { form: 'v1' }).input()), 'the v1 namespace works the same');
  const refused = (q, what) => assert.throws(() => planPortable(q.input()), e => e.code === 'PORTABLE_MANAGED_COPY', what);
  refused(make(hashOf({ 'SKILL.md': old + 'changed\n' })), 'a record that matches nothing');
  // Review item K2: the record and the marker alone are not enough. The canonical copy must exist and hold the same
  // content, and the catalog must parse.
  const forged = 'forged by a cloned repository\n';
  refused(make(hashOf({ 'SKILL.md': forged }), { canonical: null, folder: forged }), 'no canonical copy');
  refused(make(hashOf({ 'SKILL.md': forged }), { folder: forged }), 'a canonical copy that differs from the record and the folder');
  refused(make(hashOf({ 'SKILL.md': old }), { catalog: 'not json\n' }), 'a catalog that does not parse');
  refused(make(hashOf({ 'SKILL.md': old }), { catalog: null }), 'no catalog');
});

// ---- P28: the remaining gaps -------------------------------------------------------------------------------------------------------

test('P28: recovery of an apply whose receipt is written completes it, and a crash before the first step rolls back nothing', async t => {
  const p = project(t);
  const plan = planPortable(p.input());
  await assert.rejects(applyPortableWith(p.input(), plan.revision, signal(), { at: x => { if (x === 'after-receipt') throw Object.assign(new Error('c'), { crash: true }); } }), /c/);
  const r = await recover(p);
  assert.equal(r.action, 'complete'); assert.equal(planPortable(p.input()).noop, true);
  const q = project(t);
  const before = snapshot(q.dir);
  await assert.rejects(applyPortableWith(q.input(), planPortable(q.input()).revision, signal(), { at: x => { if (x === 'before-steps') throw Object.assign(new Error('c'), { crash: true }); } }), /c/);
  assert.deepEqual(snapshot(q.dir), before);
  const rq = await recover(q);
  assert.equal(rq.action, 'rollback'); assert.ok(rq.steps.every(s => s.decision === 'none'));
  assert.deepEqual(snapshot(q.dir), before); assert.equal(fs.existsSync(pending(q)), false);
});

test('P28: an original is carried across an update and restored by removal', async t => {
  const p = project(t);
  fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), 'The person\'s rules.\n');
  await projectNow(p.input());
  fs.writeFileSync(path.join(p.def, 'instructions/AGENTS.md'), INSTRUCTIONS + '\nMore.\n');
  const { plan } = await projectNow(p.input());
  assert.equal(plan.changes.find(c => c.path === 'AGENTS.md').action, 'update');
  assert.equal(plan.changes.find(c => c.path === 'AGENTS.md').original.sha256, sha('The person\'s rules.\n'));
  await remove(p);
  assert.equal(fs.readFileSync(path.join(p.dir, 'AGENTS.md'), 'utf8'), 'The person\'s rules.\n');
});

test('P28: a changed execute bit is an update; mode-only drift blocks removal (reason mode since decision D5A)', async t => {
  const p = project(t);
  await projectNow(p.input());
  fs.chmodSync(path.join(p.def, 'skills/review/references/notes.md'), 0o755);
  const { plan } = await projectNow(p.input());
  assert.equal(plan.changes.find(c => c.path === '.agents/skills/review/references/notes.md').action, 'update');
  assert.equal(fs.statSync(path.join(p.dir, '.agents/skills/review/references/notes.md')).mode & 0o777, 0o755);
  fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o600);
  assert.throws(() => planPortableRemoval(p.input()), e => e.code === 'PORTABLE_DRIFT' && /AGENTS\.md \(mode\)/.test(e.message));
});

test('P28: switching the engine subset between runs moves the skill to the new engine\'s folder', async t => {
  const p = project(t);
  await projectNow(p.input({ engines: [{ id: 'codex' }] }));
  assert.ok(fs.existsSync(path.join(p.dir, '.agents/skills/review/SKILL.md')));
  const { plan } = await projectNow(p.input({ engines: [{ id: 'claude-code' }] }));
  assert.equal(plan.changes.find(c => c.path === '.agents/skills/review/SKILL.md').action, 'delete');
  assert.equal(fs.existsSync(path.join(p.dir, '.agents')), false, 'the folders it created are gone');
  assert.ok(fs.existsSync(path.join(p.dir, '.claude/skills/review/SKILL.md')));
  assert.deepEqual(readPortableReceipt(p.input()).engines, [{ id: 'claude-code', version: null }]);
});

test('P28: a hard-linked or oversized file is refused as unsafe', t => {
  const p = project(t);
  fs.writeFileSync(path.join(p.base, 'shared.md'), 'Shared.\n'); fs.linkSync(path.join(p.base, 'shared.md'), path.join(p.dir, 'AGENTS.md'));
  assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_PATH_UNSAFE' && e.paths.includes('AGENTS.md'));
  fs.rmSync(path.join(p.dir, 'AGENTS.md'));
  fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), Buffer.alloc(1024 * 1024 + 1, 0x61));
  assert.throws(() => planPortable(p.input()), code('PORTABLE_PATH_UNSAFE'));
});

test('P28: a tampered saved original refuses removal', async t => {
  const p = project(t);
  fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), 'The person\'s rules.\n');
  await projectNow(p.input());
  const saved = path.join(p.stateDir, 'blobs', sha('The person\'s rules.\n'));
  fs.writeFileSync(saved, 'Tampered.\n');
  assert.throws(() => planPortableRemoval(p.input()), code('PORTABLE_STATE_INVALID'));
});

test('P28: a recovery revision that no longer matches refuses STALE_APPROVAL', async t => {
  const p = project(t);
  const { crash, hook } = crashAt(1);
  await assert.rejects(applyPortableWith(p.input(), planPortable(p.input()).revision, signal(), { afterStep: hook }), e => e === crash);
  const r = planPortableRecovery(p.input());
  fs.rmSync(path.join(p.dir, '.agents/skills/review/SKILL.md')); // back at its old state: the plan changes, with no drift
  await assert.rejects(applyPortableRecovery(p.input(), r.revision), code('STALE_APPROVAL'));
  await assert.rejects(applyPortableRecovery(p.input(), 'a'.repeat(64)), code('STALE_APPROVAL'));
  assert.ok(fs.existsSync(pending(p)));
});
