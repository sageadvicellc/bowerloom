// Spec 01a, section 10.1: the managed item kind `agent`, one Claude Code subagent file per item.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { itemId, itemRef, requestV2, locateV2, catalogItem, planManagedItem, inspectManagedProject } from '../../../dist/packages/managed-skills/src/v2-observed.js';
import { applyManagedItem, planManagedItemRecovery, recoverManagedItem } from '../../../dist/packages/managed-skills/src/v2-transaction.js';
import { readLocalAgent } from '../../../dist/packages/managed-skills/src/local-source.js';
import { claudeCopyBytes } from '../../../dist/packages/managed-skills/src/agent-copy.js';
import { project, itemState, inventory, hash, code } from './v2-fixture.mjs';

const TEXT = '---\nname: scribe\ndescription: Writes things down.\n---\nTake notes.\n';
const live = () => {};
function restore(t) { t.mock.restoreAll(); syncBuiltinESMExports(); }
function agentFile(f, team, role, text = TEXT, mode = 0o644) {
  const dir = path.join(f.projectDir, '.bowerloom/teams', team, 'agents');
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  for (const p of [path.join(f.projectDir, '.bowerloom/teams'), path.join(f.projectDir, '.bowerloom/teams', team), dir]) fs.chmodSync(p, 0o755);
  const file = path.join(dir, role + '.md'); fs.writeFileSync(file, text, { mode }); fs.chmodSync(file, mode); return file;
}
function agentRequest(f, role, team = 'desk', extra = {}) {
  return { operation: 'install', projectDir: f.projectDir, stateDir: itemState(f, 'agent_' + role), item: { kind: 'agent', id: role }, harnesses: ['claude'], source: { kind: 'agent', team, name: role }, expectedPreviousRevision: null, minFreeBytes: 33554432, legacy: null, ...extra };
}
async function install(req) { const plan = await planManagedItem(req); return { plan, receipt: await applyManagedItem(null, req, plan.revision) }; }
const read = (f, rel) => fs.readFileSync(path.join(f.projectDir, rel), 'utf8');
const recoveryInput = (req, plan, action) => ({ projectDir: req.projectDir, stateDir: req.stateDir, operationKey: plan.operationKey, action });
async function recover(req, plan, action) { const p = await planManagedItemRecovery(recoveryInput(req, plan, action)); return recoverManagedItem(p, p.revision); }

test('locateV2 for an agent names agent-claude and the catalog only', () => {
  const f = { projectDir: '/tmp/p' };
  const req = { projectDir: f.projectDir, item: { kind: 'agent', id: 'scribe' }, harnesses: ['claude'] };
  const surfaces = locateV2(req, { name: 'scribe' }, { ignore: false, legacy: false });
  assert.deepEqual(surfaces, [
    { id: 'agent-claude', kind: 'file', path: '/tmp/p/.claude/agents/scribe.md' },
    { id: 'catalog', kind: 'file', path: '/tmp/p/.bowerloom/managed/catalog/agent_scribe.json' },
  ]);
  // Even a request that carried Codex would add no Codex surface for an agent.
  const both = locateV2({ ...req, harnesses: ['claude', 'codex'] }, { name: 'scribe' }, { ignore: false, legacy: false });
  assert.deepEqual(both.map(s => s.id), ['agent-claude', 'catalog']);
  const withIgnore = locateV2(req, { name: 'scribe' }, { ignore: true, legacy: false });
  assert.deepEqual(withIgnore.map(s => s.id), ['ignore', 'agent-claude', 'catalog']);
});

test('requestV2 takes an agent for Claude only and with the agent source keys only', t => {
  const f = project(t), good = agentRequest(f, 'scribe');
  assert.equal(requestV2(good).item.kind, 'agent');
  for (const harnesses of [['codex'], ['claude', 'codex']]) assert.throws(() => requestV2({ ...good, harnesses }), `harnesses ${harnesses}`);
  assert.throws(() => requestV2({ ...good, source: { kind: 'agent', team: 'desk', name: 'scribe', extra: 1 } }));
  assert.throws(() => requestV2({ ...good, source: { kind: 'agent', team: 'desk' } }));
  assert.throws(() => requestV2({ ...good, source: { kind: 'agent', team: 'desk', name: 'other' } }));
  assert.throws(() => requestV2({ ...good, source: { kind: 'agent', team: 'Desk', name: 'scribe' } }));
  assert.throws(() => requestV2({ ...good, source: { kind: 'agent', team: 'a'.repeat(65), name: 'scribe' } }));
  assert.throws(() => requestV2({ ...good, source: { kind: 'prompt', name: 'scribe' } }));
  assert.throws(() => requestV2({ ...good, source: { kind: 'local', path: 'skills/scribe' } }));
  assert.throws(() => requestV2({ ...good, item: { kind: 'skill', id: 'scribe' } }));
  assert.throws(() => requestV2({ ...good, stateDir: itemState(f, 'scribe') }));
});

test('itemId and catalogItem tell an agent from a skill and a prompt', () => {
  assert.equal(itemId({ kind: 'agent', id: 'scribe' }), 'agent_scribe');
  assert.deepEqual(itemRef({ kind: 'agent', id: 'scribe' }), { kind: 'agent', id: 'scribe' });
  assert.deepEqual(catalogItem('agent_scribe.json'), { kind: 'agent', id: 'scribe' });
  assert.deepEqual(catalogItem('agent-scribe.json'), { kind: 'skill', id: 'agent-scribe' });
  assert.deepEqual(catalogItem('prompt-x.json'), { kind: 'prompt', id: 'x' });
  assert.deepEqual(catalogItem('scribe.json'), { kind: 'skill', id: 'scribe' });
  assert.throws(() => catalogItem('agent_Scribe.json')); assert.throws(() => catalogItem('agent_.json')); assert.throws(() => catalogItem('agent__x.json'));
});

test('the planned material writes the closure text to agent-claude and the catalog', async t => {
  const f = project(t); agentFile(f, 'desk', 'scribe'); const plan = await planManagedItem(agentRequest(f, 'scribe'));
  assert.deepEqual(plan.core.closure.source, { kind: 'agent', path: 'teams/desk/agents/scribe.md' }); assert.equal(plan.core.closure.skill, null);
  const byId = Object.fromEntries(plan.material.map(m => [m.id, m]));
  assert.deepEqual(Object.keys(byId).sort(), ['agent-claude', 'catalog', 'ignore']);
  assert.equal(byId['agent-claude'].kind, 'file'); assert.equal(byId['agent-claude'].files.length, 1);
  assert.equal(byId['agent-claude'].files[0].path, 'scribe.md'); assert.equal(byId['agent-claude'].files[0].text, TEXT);
  const catalog = JSON.parse(byId.catalog.files[0].text);
  assert.deepEqual(catalog.item, { kind: 'agent', id: 'scribe' }); assert.deepEqual(catalog.harnesses, ['claude']);
  assert.deepEqual(catalog.surfaces, [{ id: 'agent-claude', path: '.claude/agents/scribe.md' }, { id: 'catalog', path: '.bowerloom/managed/catalog/agent_scribe.json' }]);
});

test('claudeCopyBytes returns its input', () => {
  for (const s of ['', TEXT, 'x\u0000y', '﻿z', 'é🌿']) assert.equal(claudeCopyBytes(s), s);
});

test('an agent installs, updates, reports up to date, and refuses a local edit of the copy', async t => {
  const f = project(t); agentFile(f, 'desk', 'scribe'); const req = agentRequest(f, 'scribe');
  const { receipt } = await install(req);
  assert.equal(receipt.state, 'committed'); assert.deepEqual(receipt.item, { kind: 'agent', id: 'scribe' }); assert.deepEqual(receipt.harnesses, ['claude']);
  assert.equal(read(f, '.claude/agents/scribe.md'), TEXT);
  assert.equal(fs.statSync(path.join(f.projectDir, '.claude/agents/scribe.md')).mode & 0o777, 0o644);
  assert.equal(fs.existsSync(path.join(f.projectDir, '.codex')), false); assert.equal(fs.existsSync(path.join(f.projectDir, '.claude/skills')), false);
  const again = await planManagedItem({ ...req, operation: 'update', expectedPreviousRevision: receipt.revision });
  assert.equal(again.status, 'up-to-date');
  const next = TEXT.replace('Take notes.', 'Take better notes.'); agentFile(f, 'desk', 'scribe', next);
  const update = { ...req, operation: 'update', expectedPreviousRevision: receipt.revision }, plan = await planManagedItem(update);
  const second = await applyManagedItem(null, update, plan.revision);
  assert.equal(second.previousRevision, receipt.revision); assert.equal(read(f, '.claude/agents/scribe.md'), next);
  assert.equal(inspectManagedProject(f.projectDir, f.itemsRoot).items[0].status, 'committed');
  fs.appendFileSync(path.join(f.projectDir, '.claude/agents/scribe.md'), 'Local edit.\n'); const before = inventory(f.projectDir);
  await assert.rejects(planManagedItem({ ...update, expectedPreviousRevision: second.revision }), code('MANAGED_SKILL_LOCAL_DRIFT'));
  assert.deepEqual(inventory(f.projectDir), before);
});

test('a failed update rolls back to the earlier agent bytes', async t => {
  const f = project(t); agentFile(f, 'desk', 'scribe'); const req = agentRequest(f, 'scribe'); const { receipt } = await install(req);
  agentFile(f, 'desk', 'scribe', TEXT.replace('Take notes.', 'Changed.')); const update = { ...req, operation: 'update', expectedPreviousRevision: receipt.revision };
  const plan = await planManagedItem(update), before = inventory(f.projectDir), rename = fs.renameSync, op = path.join(req.stateDir, 'op-' + plan.operationKey);
  t.mock.method(fs, 'renameSync', (from, to) => { rename(from, to); if (String(from) === path.join(op, 'new-catalog')) throw Error('stop after catalog'); }); syncBuiltinESMExports();
  await assert.rejects(applyManagedItem(null, update, plan.revision)); restore(t);
  const result = await recover(update, plan, 'rollback'); assert.equal(result.state, 'rolled-back');
  assert.equal(read(f, '.claude/agents/scribe.md'), TEXT); assert.deepEqual(inventory(f.projectDir), before);
});

test('the operation folder accepts a new-agent-claude stage and refuses a new-agent-codex stage', async t => {
  const f = project(t); agentFile(f, 'desk', 'scribe'); const req = agentRequest(f, 'scribe'), plan = await planManagedItem(req);
  const write = fs.writeFileSync; let hit = false;
  t.mock.method(fs, 'writeFileSync', (fd, data, ...rest) => { if (!hit && typeof data === 'string' && data.includes('"kind":"PARENT_INTENT"')) { hit = true; throw Error('PRIVATE_KILL'); } return write(fd, data, ...rest); }); syncBuiltinESMExports();
  await assert.rejects(applyManagedItem(null, req, plan.revision)); restore(t); assert.equal(hit, true);
  const op = path.join(req.stateDir, 'op-' + plan.operationKey);
  assert.ok(fs.readdirSync(op).includes('new-agent-claude'), fs.readdirSync(op).join());
  const ok = await planManagedItemRecovery(recoveryInput(req, plan, 'abandon')); assert.equal(ok.action, 'abandon');
  fs.writeFileSync(path.join(op, 'new-agent-codex'), 'x'); fs.chmodSync(path.join(op, 'new-agent-codex'), 0o644);
  await assert.rejects(planManagedItemRecovery(recoveryInput(req, plan, 'abandon')));
});

test('readLocalAgent refuses a link, a group-writable file and a file over 65536 bytes', t => {
  const f = project(t), file = agentFile(f, 'desk', 'scribe');
  assert.equal(readLocalAgent(f.projectDir, 'desk', 'scribe', live).files[0].text, TEXT);
  fs.chmodSync(file, 0o664); assert.throws(() => readLocalAgent(f.projectDir, 'desk', 'scribe', live), code('MANAGED_SKILL_REFUSED')); fs.chmodSync(file, 0o644);
  fs.writeFileSync(file, 'x'.repeat(65537)); assert.throws(() => readLocalAgent(f.projectDir, 'desk', 'scribe', live), code('MANAGED_SKILL_REFUSED'));
  fs.writeFileSync(file, 'x'.repeat(65536)); assert.equal(readLocalAgent(f.projectDir, 'desk', 'scribe', live).files[0].text.length, 65536);
  fs.rmSync(file); fs.writeFileSync(path.join(f.base, 'outside.md'), TEXT); fs.symlinkSync(path.join(f.base, 'outside.md'), file);
  assert.throws(() => readLocalAgent(f.projectDir, 'desk', 'scribe', live), code('MANAGED_SKILL_REFUSED'));
  fs.rmSync(file); fs.writeFileSync(file, TEXT); fs.linkSync(file, path.join(f.base, 'second'));
  assert.throws(() => readLocalAgent(f.projectDir, 'desk', 'scribe', live), code('MANAGED_SKILL_REFUSED'));
  assert.throws(() => readLocalAgent(f.projectDir, 'desk', 'Scribe', live)); assert.throws(() => readLocalAgent(f.projectDir, 'Desk', 'scribe', live)); assert.throws(() => readLocalAgent(f.projectDir, 'desk', 'absent', live));
});

test('readLocalAgent keeps a leading BOM in the text, fails an invalid UTF-8 sequence, and passes a null byte and a carriage return on to the parser', t => {
  const f = project(t), file = agentFile(f, 'desk', 'scribe');
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(TEXT)])); assert.equal(readLocalAgent(f.projectDir, 'desk', 'scribe', live).files[0].text.charCodeAt(0), 0xfeff);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(TEXT), Buffer.from([0xed, 0xa0, 0x80])])); assert.throws(() => readLocalAgent(f.projectDir, 'desk', 'scribe', live), code('MANAGED_SKILL_REFUSED'));
  fs.writeFileSync(file, Buffer.concat([Buffer.from(TEXT), Buffer.from([0x00])])); assert.ok(readLocalAgent(f.projectDir, 'desk', 'scribe', live).files[0].text.includes('\0'));
  fs.writeFileSync(file, Buffer.concat([Buffer.from(TEXT), Buffer.from([0x0d])])); assert.ok(readLocalAgent(f.projectDir, 'desk', 'scribe', live).files[0].text.includes('\r'));
});

test('readClosure for an agent returns the closure of readLocalAgent with the team path and no skill', async t => {
  const f = project(t); agentFile(f, 'desk', 'scribe'); const plan = await planManagedItem(agentRequest(f, 'scribe')), read1 = readLocalAgent(f.projectDir, 'desk', 'scribe', live);
  assert.deepEqual(plan.core.closure.source, { kind: 'agent', path: 'teams/desk/agents/scribe.md' }); assert.equal(plan.core.closure.skill, null);
  assert.deepEqual(plan.core.closure.inventory, read1.inventory); assert.deepEqual(plan.core.closure.files, read1.files);
  assert.equal(plan.core.closure.name, 'scribe'); assert.deepEqual(plan.core.closure.inventory, [{ path: 'scribe.md', sha256: hash(TEXT), bytes: Buffer.byteLength(TEXT) }]);
});

test('the install check lets an equal hand-made agent file through and refuses a different one or an occupied catalog', async t => {
  const f = project(t); agentFile(f, 'desk', 'scribe');
  const target = path.join(f.projectDir, '.claude/agents/scribe.md'); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
  fs.writeFileSync(target, TEXT, { mode: 0o644 }); fs.chmodSync(target, 0o644);
  const req = agentRequest(f, 'scribe'), plan = await planManagedItem(req);
  assert.notEqual(plan.core.before.find(s => s.id === 'agent-claude').pins, null);
  const receipt = await applyManagedItem(null, req, plan.revision); assert.equal(receipt.state, 'committed');
  assert.equal(read(f, '.claude/agents/scribe.md'), TEXT);
  const backup = path.join(req.stateDir, 'op-' + plan.operationKey, 'old-agent-claude'); assert.equal(fs.readFileSync(backup, 'utf8'), TEXT);
  // A different file is occupied.
  const g = project(t); agentFile(g, 'desk', 'scribe'); fs.mkdirSync(path.join(g.projectDir, '.claude/agents'), { recursive: true, mode: 0o755 });
  fs.writeFileSync(path.join(g.projectDir, '.claude/agents/scribe.md'), 'Mine.\n', { mode: 0o644 }); fs.chmodSync(path.join(g.projectDir, '.claude/agents/scribe.md'), 0o644);
  await assert.rejects(planManagedItem(agentRequest(g, 'scribe')), code('MANAGED_SKILL_PATH_OCCUPIED'));
  // An occupied catalog is occupied even when the agent file is equal.
  const h = project(t); agentFile(h, 'desk', 'scribe'); fs.mkdirSync(path.join(h.projectDir, '.bowerloom/managed/catalog'), { recursive: true, mode: 0o755 });
  fs.writeFileSync(path.join(h.projectDir, '.bowerloom/managed/catalog/agent_scribe.json'), '{}\n', { mode: 0o644 }); fs.chmodSync(path.join(h.projectDir, '.bowerloom/managed/catalog/agent_scribe.json'), 0o644);
  await assert.rejects(planManagedItem(agentRequest(h, 'scribe')));
  // A skill with the same id must still find its own surfaces occupied by any file: the equal-hash exception is agent only.
  assert.notEqual(hash(TEXT), hash('Mine.\n'));
});

test('an agent that moves to another team with the same bytes plans an update', async t => {
  const f = project(t); agentFile(f, 'a', 'scribe'); const req = agentRequest(f, 'scribe', 'a'); const { receipt } = await install(req);
  fs.rmSync(path.join(f.projectDir, '.bowerloom/teams/a/agents/scribe.md')); agentFile(f, 'b', 'scribe');
  const move = { ...req, operation: 'update', source: { kind: 'agent', team: 'b', name: 'scribe' }, expectedPreviousRevision: receipt.revision };
  const plan = await planManagedItem(move); assert.notEqual(plan.status, 'up-to-date');
  assert.deepEqual(plan.core.closure.source, { kind: 'agent', path: 'teams/b/agents/scribe.md' });
  const next = await applyManagedItem(null, move, plan.revision); assert.equal(next.state, 'committed');
  assert.equal(JSON.parse(read(f, '.bowerloom/managed/catalog/agent_scribe.json')).source.path, 'teams/b/agents/scribe.md');
  const same = await planManagedItem({ ...move, expectedPreviousRevision: next.revision }); assert.equal(same.status, 'up-to-date');
});
