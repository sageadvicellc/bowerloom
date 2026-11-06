// Spec 01a, section 10.7: a hand-made .claude/agents file meets the first beta.3 apply (adopt or hold).
import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { denyNetwork } from './sync-fixture.mjs';
import { applyProjectApply } from '../../../dist/packages/project-sync/src/index.js';
import { agentProject, agentText, agentSource, claudeAgent, target, plan, applied, review, byId, read, exists, exactTree, signal } from './agents-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));
const TEXT = agentText('scribe');
const occupied = (p, next) => { const a = p.agents.find(x => x.id === 'scribe'); assert.deepEqual([a.state, a.action, a.hold?.code], ['held', 'hold', 'AGENT_TARGET_OCCUPIED']); if (next) assert.match(a.hold.next, next); return a; };

test('1. a byte-identical, mode 0644, one-link file owned by the user is adopted and becomes managed', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', TEXT); const mine = claudeAgent(f, 'scribe.md', TEXT);
  const { plan: p, result } = await applied(f, ['claude-code']);
  assert.deepEqual([p.agents[0].state, p.agents[0].action], ['adopt', 'install']); assert.match(review(p), /^ {2}scribe +adopt agent: \.claude\/agents\/scribe\.md$/m);
  assert.deepEqual(result.applied.map(x => [x.kind, x.id, x.action]), [['agent', 'scribe', 'install']]);
  assert.equal(fs.readFileSync(mine, 'utf8'), TEXT); assert.equal(fs.statSync(mine).mode & 0o777, 0o644); assert.ok(exists(f, '.bowerloom/managed/catalog/agent_scribe.json'));
  const ops = fs.readdirSync(path.join(f.itemsRoot, 'agent_scribe')).filter(n => n.startsWith('op-')); assert.equal(ops.length, 1);
  assert.ok(fs.existsSync(path.join(f.itemsRoot, 'agent_scribe', ops[0], 'receipt.json')));
  assert.equal(fs.readFileSync(path.join(f.itemsRoot, 'agent_scribe', ops[0], 'old-agent-claude'), 'utf8'), TEXT);
  const again = await plan(f, ['claude-code']); assert.deepEqual([again.agents[0].state, again.actionable], ['up-to-date', false]);
});

test('2. a differing file holds with AGENT_TARGET_OCCUPIED and nothing is written for that agent', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', TEXT); const mine = claudeAgent(f, 'scribe.md', TEXT + 'Extra.\n');
  const before = exactTree(path.join(f.projectDir, '.claude'));
  const { plan: p, result } = await applied(f, ['claude-code']); occupied(p, /differs from \.bowerloom\/teams\/first-team\/agents\/scribe\.md/);
  assert.deepEqual(result.applied, []); assert.equal(exactTree(path.join(f.projectDir, '.claude')), before); assert.equal(fs.readFileSync(mine, 'utf8'), TEXT + 'Extra.\n');
  assert.equal(exists(f, '.bowerloom/managed/catalog/agent_scribe.json'), false); assert.equal(exists(f, '.bowerloom/managed-pending.json'), false);
});

test('3. a link, mode 0600, mode 0664, two hard links, and a case alias hold and are never adopted, even with equal bytes', async t => {
  const forms = {
    link: f => { fs.writeFileSync(path.join(f.base, 'real.md'), TEXT, { mode: 0o644 }); fs.mkdirSync(path.join(f.projectDir, '.claude/agents'), { recursive: true }); fs.symlinkSync(path.join(f.base, 'real.md'), target(f, 'scribe')); },
    'mode 0600': f => claudeAgent(f, 'scribe.md', TEXT, 0o600),
    'mode 0664': f => claudeAgent(f, 'scribe.md', TEXT, 0o664),
    'two hard links': f => { const file = claudeAgent(f, 'scribe.md', TEXT); fs.linkSync(file, path.join(f.base, 'second-link.md')); },
    folder: f => { fs.mkdirSync(target(f, 'scribe'), { recursive: true }); },
  };
  for (const [name, make] of Object.entries(forms)) {
    const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', TEXT); make(f);
    const p = await plan(f, ['claude-code']); occupied(p, /^\.claude\/agents\/scribe\.md was not installed by Bowerloom and cannot be read as a plain file that you own \(MANAGED_SKILL_[A-Z_]+\)\. Move it aside, then run bowerloom apply\.$/); assert.equal(p.actionable, false, name);
    const result = await applyProjectApply(f.input(['claude-code']), p.revision, signal()); assert.deepEqual(result.applied, [], name); assert.equal(exists(f, '.bowerloom/managed/catalog/agent_scribe.json'), false, name);
  }
  const alias = await agentProject(t); agentSource(alias, 'first-team', 'scribe.md', TEXT); claudeAgent(alias, 'Scribe.md', TEXT);
  const a = occupied(await plan(alias, ['claude-code']), /\.claude\/agents\/Scribe\.md/); assert.match(a.hold.next, /case/i);
  if (process.getuid?.() === 0) {
    const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', TEXT); const file = claudeAgent(f, 'scribe.md', TEXT); fs.chownSync(file, 12345, 12345); occupied(await plan(f, ['claude-code']));
  } else t.diagnostic('A foreign owner needs root to set up, so that form is skipped here.');
});

test('4. after the user moves the file aside, the next plan says install agent', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', TEXT); const mine = claudeAgent(f, 'scribe.md', 'Mine.\n');
  occupied(await plan(f, ['claude-code'])); fs.renameSync(mine, mine + '.old');
  const p = await plan(f, ['claude-code']); assert.deepEqual([p.agents[0].state, p.agents[0].action], ['new', 'install']); assert.match(review(p), /install agent/);
  await applyProjectApply(f.input(['claude-code']), p.revision, signal()); assert.equal(read(f, '.claude/agents/scribe.md'), TEXT); assert.equal(fs.readFileSync(mine + '.old', 'utf8'), 'Mine.\n');
});

test('5. the other agents in the same plan still apply when one is held', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', TEXT); agentSource(f, 'first-team', 'editor.md', agentText('editor')); agentSource(f, 'first-team', 'writer.md', agentText('writer'));
  claudeAgent(f, 'scribe.md', 'Mine.\n'); claudeAgent(f, 'writer.md', agentText('writer'));
  const { plan: p, result } = await applied(f, ['claude-code']), agents = byId(p.agents);
  assert.deepEqual([agents.scribe.action, agents.editor.state, agents.writer.state], ['hold', 'new', 'adopt']);
  assert.deepEqual(result.applied.map(x => x.id), ['editor', 'writer']); assert.deepEqual(result.held.map(h => h.id), ['scribe']); assert.equal(read(f, '.claude/agents/scribe.md'), 'Mine.\n');
});

test('6. a hand-made .codex/agents/<role>.toml is not read, changed, or reported', async t => {
  const f = await agentProject(t); agentSource(f, 'first-team', 'scribe.md', TEXT);
  const dir = path.join(f.projectDir, '.codex/agents'); fs.mkdirSync(dir, { recursive: true, mode: 0o755 }); const toml = path.join(dir, 'scribe.toml'), odd = path.join(dir, 'odd.toml');
  fs.writeFileSync(toml, 'name = "scribe"\n', { mode: 0o644 }); fs.writeFileSync(odd, 'x', { mode: 0o666 }); fs.chmodSync(odd, 0o666);
  const before = exactTree(path.join(f.projectDir, '.codex'));
  const { plan: p } = await applied(f, ['claude-code', 'codex']);
  assert.equal(exactTree(path.join(f.projectDir, '.codex')), before); assert.doesNotMatch(JSON.stringify(p), /scribe\.toml|odd\.toml|\.codex/); assert.doesNotMatch(review(p), /toml|\.codex\/agents/);
  assert.deepEqual(p.agents.map(a => [a.id, a.action]), [['scribe', 'install']]);
});
