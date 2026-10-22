// Spec 01a, section 10.6: applying team agents. The network is denied, and apply starts no process.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { denyNetwork } from './sync-fixture.mjs';
import { applyProjectApply, planItemRecovery, applyItemRecovery } from '../../../dist/packages/project-sync/src/index.js';
import { planManagedItem } from '../../../dist/packages/managed-skills/src/v2-observed.js';
import { applyManagedItem } from '../../../dist/packages/managed-skills/src/v2-transaction.js';
import { withProjectLock } from '../../../dist/packages/project-context/src/index.js';
import { agentProject, createTeam, agentText, agentSource, claudeAgent, target, plan, applied, byId, read, exists, code, exactTree, signal } from './agents-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));
const MARKER = '.bowerloom/managed-pending.json';
const restore = t => { t.mock.restoreAll(); syncBuiltinESMExports(); };
const recoverInput = (f, item, action) => ({ project: f.project(), stateRoot: f.stateRoot, item, action });

test('1. apply writes .claude/agents/<role>.md equal to the source bytes, mode 0644', async t => {
  const f = await agentProject(t), text = agentText('scribe', 'tools: Read, Grep\nmodel: sonnet', 'Take notes.\n\nAnd more.\n'); agentSource(f, 'first-team', 'scribe.md', text);
  const { result } = await applied(f, ['claude']);
  assert.equal(fs.readFileSync(target(f, 'scribe'), 'utf8'), text); assert.equal(fs.statSync(target(f, 'scribe')).mode & 0o777, 0o644);
  assert.deepEqual(result.applied.map(x => [x.kind, x.id, x.action]), [['agent', 'scribe', 'install']]);
});

test('2. the catalog record exists, names kind agent, and lists harnesses ["claude"]', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe')); await applied(f, ['claude']);
  const catalog = JSON.parse(read(f, '.bowerloom/managed/catalog/agent_scribe.json'));
  assert.deepEqual(catalog.item, { kind: 'agent', id: 'scribe' }); assert.deepEqual(catalog.harnesses, ['claude']);
  assert.deepEqual(catalog.source, { kind: 'agent', path: 'teams/first-team/agents/scribe.md' }); assert.equal(catalog.skill, null);
  assert.ok(fs.readdirSync(path.join(f.itemsRoot, 'agent_scribe')).some(n => /^op-[a-f0-9]{64}$/.test(n)));
});

test('3. apply writes no file under .codex, even for both harnesses', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe')); await applied(f, ['claude', 'codex']);
  assert.equal(exists(f, '.codex'), false); assert.equal(exists(f, '.agents'), false); assert.ok(exists(f, '.claude/agents/scribe.md'));
});

test('4. the result has format v1beta2 and its items carry kind agent', async t => {
  const f = await agentProject(t); await createTeam(f, 'desk'); agentSource(f, 'first-team', 'scribe.md', agentText('scribe')); agentSource(f, 'desk', 'editor.md', agentText('editor'));
  const { result } = await applied(f, ['claude']);
  assert.equal(result.format, 'bowerloom/project-apply-result/v1beta2'); assert.deepEqual(result.applied.map(x => [x.kind, x.id]), [['agent', 'editor'], ['agent', 'scribe']]);
  const again = await applied(f, ['claude']); assert.deepEqual(again.result.upToDate, [{ kind: 'agent', id: 'editor', origin: 'project', resolvedFrom: 'project' }, { kind: 'agent', id: 'scribe', origin: 'project', resolvedFrom: 'project' }]);
  agentSource(f, 'first-team', 'scribe.md', agentText('scribe', '', 'Held.\n')); fs.appendFileSync(target(f, 'editor'), 'Mine.\n');
  assert.deepEqual((await applied(f, ['claude'])).result.held.map(h => [h.kind, h.id, h.code]), [['agent', 'editor', 'MANAGED_SKILL_LOCAL_DRIFT']]);
});

test('5. an interrupt between two agents leaves the first complete and the second untouched', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'alpha.md', agentText('alpha')); agentSource(f, 'first-team', 'bravo.md', agentText('bravo'));
  const controller = new AbortController(), seen = [];
  const managed = { plan: planManagedItem, async apply(held, req, revision, options) { const r = await applyManagedItem(held, req, revision, options); seen.push(req.item.id); controller.abort(); return r; } };
  const p = await plan(f, ['claude']);
  await assert.rejects(applyProjectApply(f.input(['claude']), p.revision, controller.signal, { managed }), e => e.code === 'SKILLS_SYNC_INTERRUPTED' && /bowerloom apply/.test(e.message) && /agent_alpha/.test(e.message) && /agent_bravo/.test(e.message));
  assert.deepEqual(seen, ['alpha']); assert.equal(exists(f, '.claude/agents/alpha.md'), true); assert.equal(exists(f, '.claude/agents/bravo.md'), false); assert.equal(exists(f, MARKER), false);
  const next = byId((await plan(f, ['claude'])).agents); assert.deepEqual([next.alpha.state, next.bravo.action], ['up-to-date', 'install']);
  assert.equal((await applied(f, ['claude'])).result.applied[0].id, 'bravo');
});

test('6. a crash inside a transaction leaves the marker, and skills recover plan --item agent_<role> resumes it', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe'));
  const p = await plan(f, ['claude']), rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => { rename(from, to); if (path.basename(String(from)) === 'new-catalog') throw Error('stop after catalog'); }); syncBuiltinESMExports();
  await assert.rejects(applyProjectApply(f.input(['claude']), p.revision, signal()), e => e.code === 'MANAGED_SKILL_RECOVERY_REQUIRED' && /bowerloom skills recover plan --item agent_scribe/.test(e.message));
  restore(t); assert.equal(exists(f, MARKER), true);
  await assert.rejects(plan(f, ['claude']), e => e.code === 'MANAGED_SKILL_RECOVERY_REQUIRED' && /--item agent_scribe/.test(e.message));
  const recovery = await planItemRecovery(recoverInput(f, 'agent_scribe', 'resume')); assert.equal(recovery.action, 'resume');
  const receipt = await applyItemRecovery(recoverInput(f, 'agent_scribe', 'resume'), recovery.revision); assert.equal(receipt.state, 'committed');
  assert.equal(exists(f, MARKER), false); assert.equal(read(f, '.claude/agents/scribe.md'), agentText('scribe')); assert.equal((await plan(f, ['claude'])).agents[0].state, 'up-to-date');
});

test('7. a crash after the backup move of an adopt: a rollback restores the hand-made file byte for byte', async t => {
  const f = await agentProject(t), text = agentText('scribe'); agentSource(f, 'first-team', 'scribe.md', text); const mine = claudeAgent(f, 'scribe.md', text);
  const before = exactTree(path.join(f.projectDir, '.claude')), p = await plan(f, ['claude']); assert.equal(p.agents[0].state, 'adopt');
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => { rename(from, to); if (path.basename(String(to)) === 'old-agent-claude') throw Error('stop after the backup move'); }); syncBuiltinESMExports();
  await assert.rejects(applyProjectApply(f.input(['claude']), p.revision, signal()), code('MANAGED_SKILL_RECOVERY_REQUIRED'));
  restore(t); assert.equal(fs.existsSync(mine), false);
  const recovery = await planItemRecovery(recoverInput(f, 'agent_scribe', 'rollback')); assert.equal(recovery.action, 'rollback');
  const receipt = await applyItemRecovery(recoverInput(f, 'agent_scribe', 'rollback'), recovery.revision); assert.equal(receipt.state, 'rolled-back');
  assert.equal(fs.readFileSync(mine, 'utf8'), text); assert.equal(fs.statSync(mine).mode & 0o777, 0o644); assert.equal(exists(f, MARKER), false);
  assert.equal(exactTree(path.join(f.projectDir, '.claude/agents')).includes('scribe.md'), true); assert.equal(exists(f, '.bowerloom/managed/catalog/agent_scribe.json'), false);
  assert.equal(fs.readFileSync(mine, 'utf8'), text); void before;
});

test('8. drift on the Claude copy holds with MANAGED_SKILL_LOCAL_DRIFT and nothing is overwritten', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe')); await applied(f, ['claude']);
  fs.appendFileSync(target(f, 'scribe'), 'My own line.\n'); const mine = read(f, '.claude/agents/scribe.md');
  agentSource(f, 'first-team', 'scribe.md', agentText('scribe', '', 'Changed.\n'));
  const { plan: p, result } = await applied(f, ['claude']), a = p.agents[0];
  assert.deepEqual([a.state, a.action, a.hold.code], ['drift', 'hold', 'MANAGED_SKILL_LOCAL_DRIFT']);
  assert.match(a.hold.next, /\.claude\/agents\/scribe\.md/); assert.match(a.hold.next, /\.bowerloom\/teams\/first-team\/agents\/scribe\.md/); assert.match(a.hold.next, /bowerloom apply/); assert.doesNotMatch(a.hold.next, /skills sync/);
  assert.deepEqual(result.held.map(h => [h.kind, h.id, h.code]), [['agent', 'scribe', 'MANAGED_SKILL_LOCAL_DRIFT']]); assert.equal(read(f, '.claude/agents/scribe.md'), mine);
});

test('9. apply never removes a copy when the source is removed', async t => {
  const f = await agentProject(t); const file = agentSource(f, 'first-team', 'scribe.md', agentText('scribe')); await applied(f, ['claude']);
  fs.rmSync(file); const before = exactTree(path.join(f.projectDir, '.claude')), catalog = read(f, '.bowerloom/managed/catalog/agent_scribe.json');
  await applied(f, ['claude']); assert.equal(exactTree(path.join(f.projectDir, '.claude')), before); assert.equal(read(f, '.bowerloom/managed/catalog/agent_scribe.json'), catalog);
});

test('10. other files in .claude/agents stay unchanged', async t => {
  const f = await agentProject(t); const other = claudeAgent(f, 'other.md', 'Another tool\'s file.\n', 0o600); const stat = fs.lstatSync(other, { bigint: true });
  agentSource(f, 'first-team', 'scribe.md', agentText('scribe')); await applied(f, ['claude']);
  const after = fs.lstatSync(other, { bigint: true });
  assert.equal(fs.readFileSync(other, 'utf8'), 'Another tool\'s file.\n'); assert.equal(after.ino, stat.ino); assert.equal(after.mtimeNs, stat.mtimeNs); assert.equal(Number(after.mode) & 0o777, 0o600);
});

test('11. a concurrent apply is refused by the project lock, as a prompt apply is', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', agentText('scribe')); const p = await plan(f, ['claude']);
  await withProjectLock(f.projectDir, signal(), async () => {
    await assert.rejects(applyProjectApply(f.input(['claude']), p.revision, signal()), e => ['PROJECT_LOCKED', 'MANAGED_SKILL_LOCKED'].includes(e.code));
  });
  assert.equal(exists(f, '.claude/agents/scribe.md'), false);
  await applyProjectApply(f.input(['claude']), p.revision, signal()); assert.ok(exists(f, '.claude/agents/scribe.md'));
});
