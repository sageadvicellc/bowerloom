// Harness definition spec, section 4.1 (engine filter), decision 7, and section 12 check 8: an engine filter on an entry
// keeps that entry out of the other engines' projections. Engine-private blocks go to their own engine only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appliesTo, entriesOf, loadDefinition, resolveLayers, selectForEngine } from '../../../dist/packages/harness-definition/src/index.js';
import { FULL_PARTS, cleanup, fullFiles, harness, makeDefinition } from './fixture.mjs';

test.after(cleanup);

const load = (files = fullFiles()) => { const r = loadDefinition(makeDefinition(files)); assert.equal(r.ok, true, JSON.stringify(r.problems)); return r.definition; };
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

  assert.deepEqual(ids(claude.subagents), ['reader']);
  assert.deepEqual(ids(codex.subagents), ['reader', 'writer']);
  assert.deepEqual(ids(claude.rules), ['no-push-main', 'git-any', 'ask-rm']);
  assert.deepEqual(ids(codex.rules), ['no-push-main', 'git-any']);
  assert.deepEqual(ids(claude.hooks), ['lint-on-edit']);
  assert.deepEqual(ids(codex.hooks), ['lint-on-edit', 'codex-only']);
  assert.deepEqual(ids(claude.mcp), ['github', 'docs']);
  assert.deepEqual(ids(codex.mcp), ['github']);
  for (const view of [claude, codex]) assert.deepEqual(ids(view.skills), ['deploy', 'review']);
  assert.equal(claude.sandbox.length, 1);
});

test('check 8 and R5: the skill filter in harness.json keeps a skill out of the other engines', () => {
  const d = load(fullFiles({ 'harness.json': harness({ parts: FULL_PARTS, skills: { deploy: { engines: ['codex'], 'x-codex': { note: 'kept' } } } }) }));
  assert.deepEqual(ids(selectForEngine(d, 'claude-code').skills), ['review']);
  const codexDeploy = selectForEngine(d, 'codex').skills.find(s => s.id === 'deploy');
  assert.deepEqual(codexDeploy.privateBlocks, { codex: { note: 'kept' } });
});

test('check 8: engine-private blocks reach only their own engine, unchanged', () => {
  const d = load();
  const claudeReader = selectForEngine(d, 'claude-code').subagents.find(s => s.id === 'reader');
  const codexReader = selectForEngine(d, 'codex').subagents.find(s => s.id === 'reader');
  assert.deepEqual(claudeReader.privateBlocks, { 'claude-code': { color: 'blue', effort: 'high' } });
  assert.deepEqual(codexReader.privateBlocks, {});
  const codexWriter = selectForEngine(d, 'codex').subagents.find(s => s.id === 'writer');
  assert.deepEqual(codexWriter.privateBlocks, { codex: { reasoning_effort: 'medium', nested: { depth: 0.5 } } });
  assert.deepEqual(selectForEngine(d, 'codex').enginePrivate, ['config-extra.toml']);
  assert.deepEqual(selectForEngine(d, 'claude-code').enginePrivate, []);
});

test('silent 7: the view records what it left out and why', () => {
  const d = load();
  assert.deepEqual(selectForEngine(d, 'codex').excluded, [
    { part: 'subagents', id: 'reader', reason: 'private-block', engine: 'claude-code' },
    { part: 'guardrails', id: 'ask-rm', reason: 'engine-filter' },
    { part: 'mcp', id: 'docs', reason: 'engine-filter' },
  ]);
  assert.deepEqual(selectForEngine(d, 'claude-code').excluded, [
    { part: 'subagents', id: 'writer', reason: 'engine-filter' },
    { part: 'hooks', id: 'codex-only', reason: 'engine-filter' },
  ]);
});

test('silent 8: an engine that is not an engine id, or not listed, is a caller fault', () => {
  const d = load();
  assert.throws(() => selectForEngine(d, 'claude'), TypeError);
  assert.throws(() => selectForEngine(d, 'opencode'), RangeError);
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
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  const view = selectForEngine({ entries: entriesOf(r.resolved), engines: r.resolved.engines, enginePrivate: d.enginePrivate }, 'codex');
  assert.deepEqual(ids(view.mcp), ['github']);
});
