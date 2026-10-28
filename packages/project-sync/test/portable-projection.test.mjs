// Step 2, lane A of Bowerloom 0.8: the portable projection. Portable parts spec, section 7, checks 2 to 9, and the
// receipt and removal of the harness definition spec, section 9. Checks 1, 10, and 11 need a real engine: they are in
// portable-live.test.mjs and run only on an explicit opt-in.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FOLLOW_TEXT, HIDDEN_FILE, PORTABLE_REFUSAL_CODES, SKILL_ROOTS, applyPortable, applyPortableRecovery, applyPortableRemoval, atImports,
  instructionDrift, planPortable, planPortableRecovery, planPortableRemoval, portableDrift, readPortableReceipt,
} from '../../../dist/packages/project-sync/src/index.js';
import { applyPortableWith } from '../../../dist/packages/project-sync/src/portable-run.js';
import { ENGINE_IDS, checkFidelity } from '../../../dist/packages/harness-definition/src/index.js';
import { FIVE, INSTRUCTIONS, code, json, project, projectNow as project_, sha, skill, snapshot, stamp, written } from './portable-fixture.mjs';

// ---- check 2: the drift report ---------------------------------------------------------------------------------------------

test('check 2: a tree with both CLAUDE.md and AGENTS.md gives a drift report that names the hidden file per engine', t => {
  const p = project(t);
  fs.writeFileSync(path.join(p.dir, 'CLAUDE.md'), 'Old Claude rules.\n');
  fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), 'Old shared rules.\n');
  const report = instructionDrift(p.dir, ENGINE_IDS);
  assert.ok(report);
  assert.equal(report.defaultAction, 'accept-agents');
  assert.deepEqual(report.actions, ['accept-agents', 'merge', 'keep-both']);
  assert.deepEqual(report.engines.map(e => [e.engine, e.hidden]), [
    ['claude-code', 'AGENTS.md'], ['codex', 'CLAUDE.md'], ['opencode', 'CLAUDE.md'], ['pi', 'CLAUDE.md'], ['deepseek-harness', null],
  ]);
  for (const e of report.engines) assert.match(e.rule, /\S/, e.engine);
  // The plan carries the same report, and by default it accepts AGENTS.md.
  const plan = planPortable(p.input());
  assert.deepEqual(plan.drift.engines, report.engines);
  assert.equal(plan.reconcile, 'accept-agents');
  // Only the engines of the harness are named.
  assert.deepEqual(instructionDrift(p.dir, ['codex', 'pi']).engines.map(e => e.engine), ['codex', 'pi']);
});

test('check 2: no drift for a CLAUDE.md that follows AGENTS.md, for a tree with no CLAUDE.md, or with no AGENTS.md at all', t => {
  const p = project(t);
  assert.equal(instructionDrift(p.dir, ENGINE_IDS), null);
  fs.writeFileSync(path.join(p.dir, 'CLAUDE.md'), 'Only Claude rules.\n');
  assert.equal(instructionDrift(p.dir, ENGINE_IDS), null, 'no AGENTS.md exists or is planned');
  assert.ok(instructionDrift(p.dir, ENGINE_IDS, true), 'a planned AGENTS.md makes it drift');
  fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), 'x\n');
  for (const text of ['@AGENTS.md\n', '@AGENTS.md']) { fs.writeFileSync(path.join(p.dir, 'CLAUDE.md'), text); assert.equal(instructionDrift(p.dir, ENGINE_IDS), null, JSON.stringify(text)); }
  assert.deepEqual(Object.keys(HIDDEN_FILE), [...ENGINE_IDS]);
});

// ---- check 3: Accept AGENTS.md, and removal ---------------------------------------------------------------------------------

test('check 3: Accept AGENTS.md leaves CLAUDE.md as the single line @AGENTS.md, and removal restores the original file', async t => {
  const p = project(t);
  fs.writeFileSync(path.join(p.dir, 'CLAUDE.md'), 'Old Claude rules.\n', { mode: 0o640 }); fs.chmodSync(path.join(p.dir, 'CLAUDE.md'), 0o640);
  fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), 'Old shared rules.\n');
  const before = snapshot(p.dir);
  const { plan } = await project_(p.input());
  assert.deepEqual(plan.changes.filter(c => c.path === 'CLAUDE.md' || c.path === 'AGENTS.md').map(c => [c.path, c.action]), [['AGENTS.md', 'replace'], ['CLAUDE.md', 'replace']]);
  assert.equal(fs.readFileSync(path.join(p.dir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.equal(FOLLOW_TEXT.split('\n').filter(Boolean).length, 1);
  assert.equal(fs.readFileSync(path.join(p.dir, 'AGENTS.md'), 'utf8'), INSTRUCTIONS);
  assert.equal(instructionDrift(p.dir, ENGINE_IDS), null, 'the drift is reconciled');
  const removal = planPortableRemoval(p.input());
  assert.deepEqual(removal.changes.filter(c => c.action === 'restore').map(c => c.path), ['AGENTS.md', 'CLAUDE.md']);
  const result = await applyPortableRemoval(p.input(), removal.revision);
  assert.deepEqual(result.restored, ['AGENTS.md', 'CLAUDE.md']);
  assert.equal(fs.readFileSync(path.join(p.dir, 'CLAUDE.md'), 'utf8'), 'Old Claude rules.\n');
  assert.deepEqual(snapshot(p.dir), before, 'every file, folder, and mode is as it was');
  assert.equal(readPortableReceipt(p.input()), null);
});

test('check 3: Keep both leaves CLAUDE.md and reports the drift; Merge is refused, not guessed', async t => {
  const p = project(t);
  fs.writeFileSync(path.join(p.dir, 'CLAUDE.md'), 'Old Claude rules.\n');
  const plan = planPortable(p.input({ reconcile: 'keep-both' }));
  assert.equal(plan.reconcile, 'keep-both'); assert.ok(plan.drift);
  assert.equal(plan.changes.some(c => c.path === 'CLAUDE.md'), false);
  const line = plan.loss.find(l => l.part === 'system-prompt' && l.engine === 'claude-code');
  assert.equal(line.result, 'weakened'); assert.match(line.reason, /Keep both/);
  await applyPortable(p.input({ reconcile: 'keep-both' }), plan.revision);
  assert.equal(fs.readFileSync(path.join(p.dir, 'CLAUDE.md'), 'utf8'), 'Old Claude rules.\n');
  assert.ok(planPortable(p.input({ reconcile: 'keep-both' })).drift, 'the drift stays reported');
  assert.throws(() => planPortable(p.input({ reconcile: 'merge' })), code('PORTABLE_MERGE_NOT_BUILT'));
});

// ---- checks 4, 7, and 9: skills, paths, and the shared copy ----------------------------------------------------------------

test('checks 4, 7, 9: projection writes only the section 4.2 paths, one shared .agents/skills copy, and removal restores the tree', async t => {
  const p = project(t, { files: { 'skills/review/scripts/run.sh': '#!/bin/sh\nexit 0\n' } });
  fs.chmodSync(path.join(p.def, 'skills/review/scripts/run.sh'), 0o755);
  fs.mkdirSync(path.join(p.dir, '.agents/skills/mine'), { recursive: true });
  fs.writeFileSync(path.join(p.dir, '.agents/skills/mine/SKILL.md'), skill('mine'));
  fs.writeFileSync(path.join(p.dir, 'README.md'), 'Readme.\n');
  const before = snapshot(p.dir);
  const plan = planPortable(p.input());
  const shared = plan.changes.filter(c => c.path === '.agents/skills/review/SKILL.md');
  assert.equal(shared.length, 1, 'one copy in .agents/skills');
  assert.deepEqual(shared[0].engines, ['codex', 'opencode', 'pi', 'deepseek-harness']);
  assert.deepEqual(plan.changes.find(c => c.path === '.claude/skills/review/SKILL.md').engines, ['claude-code', 'opencode']);
  assert.deepEqual(SKILL_ROOTS.pi, ['.agents/skills']); assert.deepEqual(SKILL_ROOTS['deepseek-harness'], ['.agents/skills']);
  await applyPortable(p.input(), plan.revision);
  const after = snapshot(p.dir);
  const changed = written(before, after);
  const allowed = /^(?:AGENTS\.md|CLAUDE\.md|\.claude\/|\.claude\/skills\/(?:review\/.*)?|\.agents\/skills\/(?:review\/.*)?)$/;
  for (const rel of changed) assert.match(rel, allowed, rel);
  for (const rel of Object.keys(after)) assert.doesNotMatch(rel, /^\.(?:pi|dsh|opencode)\//, 'no private skill path for Pi, DeepSeek Harness, or OpenCode');
  assert.equal(after['.agents/skills/mine/SKILL.md'], before['.agents/skills/mine/SKILL.md'], 'a skill Bowerloom did not write stays');
  // Check 4: the skill is copied byte for byte, with only the portable fields, into each engine's path.
  for (const root of ['.claude/skills', '.agents/skills']) {
    assert.equal(fs.readFileSync(path.join(p.dir, root, 'review/SKILL.md'), 'utf8'), fs.readFileSync(path.join(p.def, 'skills/review/SKILL.md'), 'utf8'));
    assert.equal(fs.statSync(path.join(p.dir, root, 'review/scripts/run.sh')).mode & 0o777, 0o755);
    assert.equal(fs.statSync(path.join(p.dir, root, 'review/SKILL.md')).mode & 0o777, 0o644);
  }
  const removal = planPortableRemoval(p.input());
  await applyPortableRemoval(p.input(), removal.revision);
  assert.deepEqual(snapshot(p.dir), before, 'removal restores the previous files and removes the folders it made');
});

test('check 4: each engine gets the skill where it reads skills, and the loss report passes the fidelity check', t => {
  const p = project(t);
  const plan = planPortable(p.input());
  for (const engine of ENGINE_IDS) {
    for (const root of SKILL_ROOTS[engine]) assert.ok(plan.changes.find(c => c.path === `${root}/review/SKILL.md`).engines.includes(engine), `${engine} ${root}`);
    assert.equal(plan.loss.find(l => l.part === 'skills' && l.entry === 'review' && l.engine === engine).result, 'exact', engine);
    assert.equal(plan.loss.find(l => l.part === 'system-prompt' && l.engine === engine).result, 'exact', engine);
  }
  const loaded = { entries: { skills: [{ id: 'review' }], subagents: [], rules: [], sandbox: [], hooks: [], mcp: [] }, engines: ENGINE_IDS };
  const verdict = checkFidelity(loaded, plan.loss, []);
  assert.equal(verdict.ok, true, JSON.stringify(verdict.problems));
});

// ---- check 5: extra frontmatter keys ----------------------------------------------------------------------------------------

test('check 5: a skill with an extra frontmatter key is refused before projection, and nothing is written', async t => {
  for (const extra of ['allowed-tools: Bash\n', 'x-claude-code:\n  color: blue\n', 'engines:\n  - codex\n']) {
    const p = project(t, { files: { 'skills/review/SKILL.md': skill('review', extra) } });
    const before = snapshot(p.dir);
    assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_DEFINITION_INVALID' && e.problems.some(x => x.code === 'SKILL_UNKNOWN_FIELD'), extra);
    await assert.rejects(applyPortable(p.input(), 'a'.repeat(64)), code('PORTABLE_DEFINITION_INVALID'));
    assert.deepEqual(snapshot(p.dir), before); assert.equal(fs.existsSync(p.stateDir), false);
  }
});

// ---- check 6: @path imports -------------------------------------------------------------------------------------------------

test('check 6: an @path import in AGENTS.md is refused', t => {
  for (const text of ['# A\n\nSee @docs/rules.md for more.\n', '@AGENTS.local.md\n', 'Read (@~/notes) first.\n', 'Also *@CLAUDE.md*.\n']) {
    const p = project(t, { files: { 'instructions/AGENTS.md': text + '\n## Tool guidance\n\nx\n' } });
    assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_AT_IMPORT' && /line \d/.test(e.message), text);
  }
  // Code, mentions, and addresses are not imports.
  assert.deepEqual(atImports('Mail a@b.dev or ask @someone.\n\n```\n@docs/x.md\n```\n\nUse `@types/node`.\n'), []);
  assert.deepEqual(atImports('one\nSee @a/b.md, then @c.md.\n'), [{ line: 2, token: '@a/b.md' }, { line: 2, token: '@c.md' }]);
});

test('section 4.1 rule 3: an AGENTS.md over 32 KiB is refused', t => {
  const p = project(t, { files: { 'instructions/AGENTS.md': '# Big\n\n' + 'Keep each line short.\n'.repeat(1700) + '\n## Tool guidance\n\nx\n' } });
  assert.throws(() => planPortable(p.input()), code('PORTABLE_INSTRUCTIONS_TOO_LARGE'));
});

// ---- check 8: memory and commands -------------------------------------------------------------------------------------------

test('check 8: memory projects as instructions and a command as a skill, and the report says translated', async t => {
  const p = project(t, {
    parts: { memory: 'instructions/AGENTS.md' },
    files: { 'skills/release-notes/SKILL.md': skill('release-notes', 'metadata:\n  bowerloom-kind: command\n', 'Write the release notes for $ARGUMENTS.\n') },
  });
  const plan = planPortable(p.input());
  for (const engine of ENGINE_IDS) {
    const memory = plan.loss.find(l => l.part === 'memory' && l.engine === engine);
    assert.equal(memory.result, 'translated', engine); assert.match(memory.reason, /instructions/);
    const command = plan.loss.find(l => l.part === 'skills' && l.entry === 'release-notes' && l.engine === engine);
    assert.equal(command.result, 'translated', engine); assert.match(command.reason, /command projects as a skill/);
    assert.equal(plan.loss.find(l => l.part === 'skills' && l.entry === 'review' && l.engine === engine).result, 'exact');
  }
  await applyPortable(p.input(), plan.revision);
  assert.match(fs.readFileSync(path.join(p.dir, 'AGENTS.md'), 'utf8'), /Standing fact: the demo uses npm\./, 'the standing facts are in the instructions');
  assert.ok(fs.existsSync(path.join(p.dir, '.claude/skills/release-notes/SKILL.md')));
  assert.ok(fs.existsSync(path.join(p.dir, '.agents/skills/release-notes/SKILL.md')));
  for (const gone of ['.claude/commands', '.codex', '.opencode']) assert.equal(fs.existsSync(path.join(p.dir, gone)), false, gone);
});

// ---- Pi trust, the engine filter, locked-in parts ---------------------------------------------------------------------------

test('Pi project skills are pending trust until a person saves trust', t => {
  const p = project(t);
  const plan = planPortable(p.input());
  assert.deepEqual(plan.pendingTrust, ['review']);
  assert.match(plan.loss.find(l => l.engine === 'pi' && l.part === 'skills').reason, /Pending trust/);
  assert.doesNotMatch(plan.loss.find(l => l.engine === 'codex' && l.part === 'skills').reason, /Pending trust/);
  assert.deepEqual(planPortable(p.input({ piTrustSaved: true })).pendingTrust, []);
  assert.deepEqual(planPortable(p.input({ engines: [{ id: 'codex' }] })).pendingTrust, []);
});

test('the skill engine filter in harness.json keeps a skill out of other engines, and reports engines that still read it', t => {
  const p = project(t, { skills: { review: { engines: ['codex'] } }, files: { 'skills/deploy/SKILL.md': skill('deploy') } });
  const plan = planPortable(p.input());
  assert.equal(plan.changes.some(c => c.path.startsWith('.claude/skills/review/')), false);
  assert.deepEqual(plan.changes.find(c => c.path === '.agents/skills/review/SKILL.md').engines, ['codex']);
  // Ruling P19: an engine being projected that still reads the folder gets a weakened line, not an exact one.
  for (const engine of ['opencode', 'pi', 'deepseek-harness']) {
    const lines = plan.loss.filter(l => l.entry === 'review' && l.engine === engine);
    assert.deepEqual(lines.map(l => l.result), ['weakened'], engine); assert.match(lines[0].reason, /filter of review leaves/);
  }
  assert.deepEqual(plan.filterLeaks, [{ skill: 'review', path: '.agents/skills/review', engines: ['opencode', 'pi', 'deepseek-harness'] }]);
  assert.ok(plan.changes.some(c => c.path === '.claude/skills/deploy/SKILL.md'));
});

test('ENGINE_NO_WRITER is lifted for portable parts only: locked-in parts still refuse for opencode, pi, and deepseek-harness', async t => {
  for (const engine of ['opencode', 'pi', 'deepseek-harness']) {
    const p = project(t, { engines: [{ id: engine, version: '1.0.0' }] });
    const { result } = await project_(p.input());
    assert.deepEqual(result.receipt.engines, [{ id: engine, version: '1.0.0' }], engine);
    const locked = project(t, { engines: [{ id: engine }], parts: { mcp: 'mcp.json' }, files: { 'mcp.json': json({ servers: [{ name: 'docs', transport: 'stdio', command: 'docs-mcp' }] }) } });
    assert.throws(() => planPortable(locked.input()), e => e.code === 'ENGINE_NO_WRITER' && e.message === `no writer for engine ${engine} yet`, engine);
  }
  // Claude Code and Codex keep their own writers for locked-in parts: the portable plan lists those entries as deferred.
  const both = project(t, { engines: [{ id: 'claude-code' }, { id: 'codex' }], parts: { mcp: 'mcp.json' }, files: { 'mcp.json': json({ servers: [{ name: 'docs', transport: 'stdio', command: 'docs-mcp' }] }) } });
  assert.deepEqual(planPortable(both.input()).deferred, [{ engine: 'claude-code', part: 'mcp', id: 'docs' }, { engine: 'codex', part: 'mcp', id: 'docs' }]);
});

test('an engine that harness.json does not list is refused', t => {
  const p = project(t, { engines: [{ id: 'codex' }] });
  assert.throws(() => planPortable(p.input({ engines: [{ id: 'pi' }] })), code('PORTABLE_ENGINE_NOT_LISTED'));
  assert.throws(() => planPortable(p.input({ engines: [{ id: 'hermes' }] })), code('PORTABLE_USAGE'));
});

// ---- the receipt, a second run, staleness, and drift ------------------------------------------------------------------------

test('the receipt records engine, engine version, definition revision, and each path, hash, and mode; a second run writes nothing', async t => {
  const p = project(t, { engines: [{ id: 'claude-code', version: '2.1.310' }, { id: 'codex', version: '0.157.0' }] });
  const { plan, result } = await project_(p.input());
  const r = result.receipt;
  assert.deepEqual(r.engines, [{ id: 'claude-code', version: '2.1.310' }, { id: 'codex', version: '0.157.0' }]);
  assert.match(r.definition.revision, /^sha256:[0-9a-f]{64}$/); assert.equal(r.definition.revision, plan.definition.revision);
  assert.deepEqual(readPortableReceipt(p.input()), r);
  for (const f of r.files) {
    const bytes = fs.readFileSync(path.join(p.dir, f.path));
    assert.equal(f.sha256, sha(bytes), f.path); assert.equal(f.mode, fs.statSync(path.join(p.dir, f.path)).mode & 0o777, f.path);
  }
  assert.deepEqual(r.files.map(f => f.path), ['.agents/skills/review/SKILL.md', '.agents/skills/review/references/notes.md', '.claude/skills/review/SKILL.md', '.claude/skills/review/references/notes.md', 'AGENTS.md']);
  assert.equal(fs.statSync(p.stateDir).mode & 0o777, 0o700);
  // A second run with no change writes nothing: no project file and not the receipt.
  const stamps = Object.fromEntries([...r.files.map(f => path.join(p.dir, f.path)), path.join(p.stateDir, 'receipt.json')].map(f => [f, stamp(f)]));
  const again = planPortable(p.input());
  assert.equal(again.noop, true); assert.ok(again.changes.every(c => c.action === 'unchanged'));
  const noop = await applyPortable(p.input(), again.revision);
  assert.equal(noop.noop, true); assert.equal(noop.planRevision, again.revision); assert.deepEqual(noop.receipt, r);
  for (const [f, s] of Object.entries(stamps)) assert.equal(stamp(f), s, f);
});

test('a change to the definition after the plan refuses STALE_APPROVAL and writes nothing', async t => {
  const p = project(t);
  const plan = planPortable(p.input());
  fs.writeFileSync(path.join(p.def, 'instructions/AGENTS.md'), INSTRUCTIONS + '\nMore.\n');
  const before = snapshot(p.dir);
  await assert.rejects(applyPortable(p.input(), plan.revision), code('STALE_APPROVAL'));
  assert.deepEqual(snapshot(p.dir), before);
});

test('an update replaces what changed, and a skill dropped from the definition is removed', async t => {
  const p = project(t, { files: { 'skills/deploy/SKILL.md': skill('deploy') } });
  await project_(p.input());
  fs.rmSync(path.join(p.def, 'skills/deploy'), { recursive: true });
  fs.writeFileSync(path.join(p.def, 'skills/review/references/notes.md'), 'New notes.\n');
  const plan = planPortable(p.input());
  const by = Object.fromEntries(plan.changes.map(c => [c.path, c.action]));
  assert.equal(by['.claude/skills/deploy/SKILL.md'], 'delete'); assert.equal(by['.claude/skills/review/references/notes.md'], 'update'); assert.equal(by['AGENTS.md'], 'unchanged');
  await applyPortable(p.input(), plan.revision);
  assert.equal(fs.existsSync(path.join(p.dir, '.claude/skills/deploy')), false, 'the folder it created goes when it is empty');
  assert.ok(fs.existsSync(path.join(p.dir, '.claude/skills/review/SKILL.md')));
  assert.equal(fs.readFileSync(path.join(p.dir, '.agents/skills/review/references/notes.md'), 'utf8'), 'New notes.\n');
  await applyPortableRemoval(p.input(), planPortableRemoval(p.input()).revision);
  assert.deepEqual(snapshot(p.dir), {});
});

test('a projected file changed by hand is drift: it is reported, and plan and removal refuse', async t => {
  const p = project(t);
  await project_(p.input());
  assert.deepEqual(portableDrift(p.input()), []);
  fs.appendFileSync(path.join(p.dir, '.claude/skills/review/SKILL.md'), 'Edited.\n');
  fs.chmodSync(path.join(p.dir, 'AGENTS.md'), 0o600);
  assert.deepEqual(portableDrift(p.input()).map(d => d.path), ['.claude/skills/review/SKILL.md', 'AGENTS.md'], 'content and mode drift');
  assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_DRIFT' && e.paths.length === 2);
  assert.throws(() => planPortableRemoval(p.input()), code('PORTABLE_DRIFT'));
});

// ---- unsafe paths, occupied folders, recovery -------------------------------------------------------------------------------

test('a skill folder Bowerloom did not project, and a linked .claude folder, are refused', t => {
  const p = project(t);
  fs.mkdirSync(path.join(p.dir, '.claude/skills/review'), { recursive: true });
  fs.writeFileSync(path.join(p.dir, '.claude/skills/review/SKILL.md'), skill('review'));
  assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_PATH_OCCUPIED' && e.paths.includes('.claude/skills/review'));
  fs.rmSync(path.join(p.dir, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(p.base, 'elsewhere'));
  fs.symlinkSync(path.join(p.base, 'elsewhere'), path.join(p.dir, '.claude'));
  assert.throws(() => planPortable(p.input()), code('PORTABLE_PATH_UNSAFE'));
  assert.throws(() => planPortable(p.input({ stateDir: path.join(p.dir, 'state') })), code('PORTABLE_STATE_UNSAFE'));
});

test('a failure part way rolls back every step, and leaves no receipt and no marker', async t => {
  const p = project(t);
  fs.mkdirSync(path.join(p.dir, '.claude')); fs.mkdirSync(path.join(p.dir, '.agents'));
  fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), 'Old shared rules.\n');
  const before = snapshot(p.dir);
  const plan = planPortable(p.input());
  fs.chmodSync(p.dir, 0o555); // AGENTS.md, the last file, cannot be written: the skill files before it were.
  try { await assert.rejects(applyPortable(p.input(), plan.revision), e => e.code === 'EACCES' || e.code === 'EPERM'); } finally { fs.chmodSync(p.dir, 0o755); }
  assert.deepEqual(snapshot(p.dir), before);
  assert.equal(readPortableReceipt(p.input()), null);
  assert.equal(fs.existsSync(path.join(p.stateDir, 'pending.json')), false);
  assert.throws(() => planPortableRecovery(p.input()), code('PORTABLE_RECOVER_NOTHING'));
});

test('a run that stopped part way blocks every plan until recovery rolls it back', async t => {
  const p = project(t);
  fs.writeFileSync(path.join(p.dir, 'AGENTS.md'), 'Old shared rules.\n');
  const before = snapshot(p.dir);
  const plan = planPortable(p.input());
  let steps = 0;
  const crash = Object.assign(new Error('simulated crash'), { crash: true });
  await assert.rejects(applyPortableWith(p.input(), plan.revision, new AbortController().signal, { afterStep: () => { if (++steps === 3) throw crash; } }), e => e === crash);
  assert.notDeepEqual(snapshot(p.dir), before, 'the crash left the project part way');
  assert.throws(() => planPortable(p.input()), code('PORTABLE_RECOVERY_REQUIRED'));
  assert.throws(() => planPortableRemoval(p.input()), code('PORTABLE_RECOVERY_REQUIRED'));
  const recovery = planPortableRecovery(p.input());
  assert.equal(recovery.action, 'rollback');
  await applyPortableRecovery(p.input(), recovery.revision);
  assert.deepEqual(snapshot(p.dir), before);
  assert.equal(planPortable(p.input()).noop, false, 'plans again after recovery');
});

test('every refusal code has words', () => {
  for (const c of PORTABLE_REFUSAL_CODES) assert.match(c, /^PORTABLE_[A-Z_]+$/);
});
