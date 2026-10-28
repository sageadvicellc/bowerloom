// Harness definition spec, section 4.1 (engine filter), decision 7, and section 12 check 8: an engine filter on an entry
// keeps that entry out of the other engines' projections. Engine-private blocks go to their own engine only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appliesTo, entriesOf, loadDefinition, resolveLayers, selectForEngine } from '../../../dist/packages/harness-definition/src/index.js';
import { cleanup, fullFiles, makeDefinition } from './fixture.mjs';

test.after(cleanup);

const load = () => { const r = loadDefinition(makeDefinition(fullFiles())); assert.equal(r.ok, true, JSON.stringify(r.problems)); return r.definition; };
const ids = list => list.map(e => e.id);

test('appliesTo: no filter means every engine; a filter means only the engines it lists', () => {
  assert.equal(appliesTo({}, 'pi'), true);
  assert.equal(appliesTo({ engines: ['codex'] }, 'codex'), true);
  assert.equal(appliesTo({ engines: ['codex'] }, 'claude-code'), false);
});

test('check 8: a filtered entry stays out of every other engine, in every part', () => {
  const d = load();
  const claude = selectForEngine(d, 'claude-code');
  const codex = selectForEngine(d, 'codex');
  const opencode = selectForEngine(d, 'opencode');

  assert.deepEqual(ids(claude.subagents), ['reader']);
  assert.deepEqual(ids(codex.subagents), ['reader', 'writer']);
  assert.deepEqual(ids(claude.rules), ['no-push-main', 'git-any', 'ask-rm']);
  assert.deepEqual(ids(codex.rules), ['no-push-main', 'git-any']);
  assert.deepEqual(ids(claude.hooks), ['lint-on-edit']);
  assert.deepEqual(ids(codex.hooks), ['lint-on-edit', 'codex-only']);
  assert.deepEqual(ids(claude.mcp), ['github', 'docs']);
  assert.deepEqual(ids(codex.mcp), ['github']);
  assert.deepEqual(ids(opencode.mcp), ['github']);
  // Skills carry no filter (see the report on the open question), so they reach every engine.
  for (const view of [claude, codex, opencode]) assert.deepEqual(ids(view.skills), ['deploy', 'review']);
  assert.equal(claude.sandbox.length, 1);
});

test('check 8: engine-private blocks reach only their own engine, unchanged', () => {
  const d = load();
  const claudeReader = selectForEngine(d, 'claude-code').subagents.find(s => s.id === 'reader');
  const codexReader = selectForEngine(d, 'codex').subagents.find(s => s.id === 'reader');
  assert.deepEqual(claudeReader.privateBlocks, { 'claude-code': { color: 'blue', permissionMode: 'plan' } });
  assert.deepEqual(codexReader.privateBlocks, {});
  const codexWriter = selectForEngine(d, 'codex').subagents.find(s => s.id === 'writer');
  assert.deepEqual(codexWriter.privateBlocks, { codex: { sandbox_mode: 'workspace-write', nested: { depth: 0.5 } } });
  assert.deepEqual(selectForEngine(d, 'codex').enginePrivate, ['config-extra.toml']);
  assert.deepEqual(selectForEngine(d, 'claude-code').enginePrivate, []);
});

test('check 8: selecting does not change the definition', () => {
  const d = load();
  const before = JSON.stringify(d.entries);
  selectForEngine(d, 'codex');
  selectForEngine(d, 'claude-code');
  assert.equal(JSON.stringify(d.entries), before);
});

test('check 8: the filter applies after layers resolve', () => {
  const d = load();
  const r = resolveLayers([d]);
  assert.equal(r.ok, true);
  const view = selectForEngine({ entries: entriesOf(r.resolved), enginePrivate: d.enginePrivate }, 'codex');
  assert.deepEqual(ids(view.mcp), ['github']);
});
