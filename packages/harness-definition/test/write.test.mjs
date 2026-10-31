// The save step, lane B: `editDefinition` applies a closed set of edits to a loaded definition and returns the full target
// file set. It is pure, it leaves untouched files byte-identical, and its result loads with the package loader.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEFINITION_LIMITS, editDefinition, loadDefinition, readFrontmatter } from '../../../dist/packages/harness-definition/src/index.js';
import { agent, cleanup, fullFiles, harness, json, makeDefinition, skill, tempRoot } from './fixture.mjs';

test.after(cleanup);

const load = files => {
  const r = loadDefinition(makeDefinition(files));
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems));
  return r.definition;
};
/** Text of exactly this many bytes, in lines short enough for the secret scan. */
const lines = bytes => {
  const row = 'a'.repeat(99) + '\n';
  return row.repeat(Math.floor(bytes / 100)) + 'a'.repeat(bytes % 100);
};
const text = file => Buffer.from(file.bytes).toString('utf8');
const byPath = result => new Map(result.files.map(f => [f.path, f]));
const done = (def, edits) => {
  const r = editDefinition(def, edits);
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r));
  return r;
};
const refused = (def, edits, code) => {
  const r = editDefinition(def, edits);
  assert.equal(r.ok, false, 'the edit should be refused');
  assert.equal(r.code, code, JSON.stringify(r));
  assert.equal(typeof r.message, 'string');
  return r;
};

/** Writes a result into a fresh folder and loads it with the package loader. */
function loadFromDisk(result) {
  const dir = path.join(tempRoot(), '.bowerloom');
  for (const f of result.files) {
    const at = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, f.bytes);
  }
  const r = loadDefinition(dir);
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems));
  return r.definition;
}

/** Every file the change list does not name is byte-identical, and every named file differs as its kind says. */
function assertOnlyChanged(def, result) {
  const before = new Map(def.files.map(f => [f.path, f]));
  const after = byPath(result);
  const named = new Map(result.changes.map(c => [c.path, c.kind]));
  assert.equal(named.size, result.changes.length, 'a path is listed once');
  for (const [p, f] of before) {
    const now = after.get(p);
    if (!named.has(p)) {
      assert.ok(now, `${p} stays`);
      assert.ok(Buffer.from(f.bytes).equals(Buffer.from(now.bytes)), `${p} stays byte-identical`);
      assert.equal(now.executable ?? false, f.executable ?? false, `${p} keeps its execute bit`);
    }
  }
  for (const [p, kind] of named) {
    if (kind === 'create') assert.ok(!before.has(p) && after.has(p), `${p} is new`);
    else if (kind === 'delete') assert.ok(before.has(p) && !after.has(p), `${p} is gone`);
    else {
      assert.ok(before.has(p) && after.has(p), `${p} is kept`);
      assert.ok(!Buffer.from(before.get(p).bytes).equals(Buffer.from(after.get(p).bytes)), `${p} differs`);
    }
  }
  for (const p of after.keys()) assert.ok(before.has(p) || named.get(p) === 'create', `${p} is not an unlisted new file`);
}

// ---- every edit kind ------------------------------------------------------------------------------------------------

test('set-skill replaces the full text of one SKILL.md and nothing else', () => {
  const def = load(fullFiles());
  const next = skill('deploy', 'Ships the demo to staging.', '', 'Run the deploy steps.\n');
  const r = done(def, [{ kind: 'set-skill', id: 'deploy', text: next }]);
  assert.deepEqual(r.changes, [{ path: 'skills/deploy/SKILL.md', kind: 'update' }]);
  assert.equal(text(byPath(r).get('skills/deploy/SKILL.md')), next);
  assertOnlyChanged(def, r);
  const loaded = loadFromDisk(r);
  assert.equal(loaded.revision, r.revision);
  assert.notEqual(r.revision, def.revision);
  assert.equal(r.base, def.revision);
  const entry = loaded.entries.skills.find(s => s.id === 'deploy');
  assert.equal(entry.description, 'Ships the demo to staging.');
  assert.equal(entry.body.trim(), 'Run the deploy steps.');
});

test('set-skill keeps the other files of the skill folder and its execute bit', () => {
  const def = load(fullFiles());
  const r = done(def, [{ kind: 'set-skill', id: 'review', text: skill('review', 'Reviews a change more closely.', 'license: MIT\n') }]);
  assert.deepEqual(r.changes.map(c => c.path), ['skills/review/SKILL.md']);
  assert.equal(text(byPath(r).get('skills/review/references/notes.md')), 'Review notes.\n');
  assertOnlyChanged(def, r);
});

test('set-skill with the text it already has changes nothing', () => {
  const def = load(fullFiles());
  const same = text(def.files.find(f => f.path === 'skills/deploy/SKILL.md'));
  const r = done(def, [{ kind: 'set-skill', id: 'deploy', text: same }]);
  assert.deepEqual(r.changes, []);
  assert.equal(r.revision, def.revision);
  assertOnlyChanged(def, r);
});

test('add-skill creates the folder and keeps harness.json when the skills part is already listed', () => {
  const def = load(fullFiles());
  const r = done(def, [{ kind: 'add-skill', id: 'triage', text: skill('triage', 'Sorts new issues.') }]);
  assert.deepEqual(r.changes, [{ path: 'skills/triage/SKILL.md', kind: 'create' }]);
  assertOnlyChanged(def, r);
  assert.deepEqual(loadFromDisk(r).entries.skills.map(s => s.id), ['deploy', 'review', 'triage']);
});

test('add-skill lists the skills part in harness.json when the definition had none', () => {
  const def = load({ 'harness.json': harness() });
  const r = done(def, [{ kind: 'add-skill', id: 'triage', text: skill('triage', 'Sorts new issues.') }]);
  assert.deepEqual(r.changes, [{ path: 'harness.json', kind: 'update' }, { path: 'skills/triage/SKILL.md', kind: 'create' }]);
  assert.equal(text(byPath(r).get('harness.json')), json({ ...JSON.parse(harness()), parts: { skills: 'skills/' } }));
  assertOnlyChanged(def, r);
  assert.equal(loadFromDisk(r).revision, r.revision);
});

test('remove-skill deletes every file of the skill folder and its settings', () => {
  const files = fullFiles({
    'harness.json': harness({
      parts: { ...JSON.parse(harness()).parts, skills: 'skills/', subagents: 'agents/' },
      skills: { review: { engines: ['codex'], 'x-codex': { note: 'kept' } }, deploy: { engines: ['claude-code'] } },
    }),
    'instructions/AGENTS.md': undefined, 'guardrails.json': undefined, 'hooks.json': undefined, 'mcp.json': undefined,
    'scripts/lint.sh': undefined, 'sources.json': undefined, 'engines/codex/config-extra.toml': undefined,
    'agents/reader.md': agent('reader'), 'agents/writer.md': undefined,
  });
  const def = load(files);
  const r = done(def, [{ kind: 'remove-skill', id: 'review' }]);
  assert.deepEqual(r.changes, [
    { path: 'harness.json', kind: 'update' },
    { path: 'skills/review/SKILL.md', kind: 'delete' },
    { path: 'skills/review/references/notes.md', kind: 'delete' },
  ]);
  assertOnlyChanged(def, r);
  const loaded = loadFromDisk(r);
  assert.deepEqual(loaded.entries.skills.map(s => s.id), ['deploy']);
  assert.deepEqual(Object.keys(loaded.harness.skills), ['deploy']);
  assert.deepEqual(loaded.harness.skills.deploy.engines, ['claude-code']);
});

test('remove-skill of the last skill drops the skills part from harness.json', () => {
  const def = load({ 'harness.json': harness({ parts: { skills: 'skills/' } }), 'skills/only/SKILL.md': skill('only') });
  const r = done(def, [{ kind: 'remove-skill', id: 'only' }]);
  assert.deepEqual(r.changes, [{ path: 'harness.json', kind: 'update' }, { path: 'skills/only/SKILL.md', kind: 'delete' }]);
  const loaded = loadFromDisk(r);
  assert.deepEqual(loaded.harness.parts, {});
  assert.equal(loaded.entries.skills.length, 0);
});

test('remove-skill takes the skill out of the agents that link it and leaves the rest of each agent alone', () => {
  const files = fullFiles({
    'agents/reader.md': agent('reader', 'model:\n  claude-code: model-a\ntools:\n  - read\nskills:\n  - review\n  - deploy\nx-claude-code:\n  color: blue\n', 'Read the files.\n'),
    'sources.json': undefined, 'harness.json': harness({ parts: { ...JSON.parse(harness()).parts, skills: 'skills/', subagents: 'agents/' } }),
    'instructions/AGENTS.md': undefined, 'engines/codex/config-extra.toml': undefined, 'scripts/lint.sh': undefined,
    'guardrails.json': undefined, 'hooks.json': undefined, 'mcp.json': undefined, 'agents/writer.md': undefined,
  });
  const def = load(files);
  const r = done(def, [{ kind: 'remove-skill', id: 'deploy' }]);
  assert.deepEqual(r.changes, [{ path: 'agents/reader.md', kind: 'update' }, { path: 'skills/deploy/SKILL.md', kind: 'delete' }]);
  assertOnlyChanged(def, r);
  const reader = loadFromDisk(r).entries.subagents.find(s => s.id === 'reader');
  assert.deepEqual(reader.skills, ['review']);
  assert.deepEqual(reader.tools, ['read']);
  assert.deepEqual(reader.model, { 'claude-code': 'model-a' });
  assert.deepEqual(reader.privateBlocks, { 'claude-code': { color: 'blue' } });
  assert.equal(reader.body, '\nRead the files.\n');
});

test('set-agent sets the linked skills and tools and keeps the model, private blocks, and body', () => {
  const def = load(fullFiles());
  const r = done(def, [{ kind: 'set-agent', id: 'reader', skills: ['deploy', 'review'], tools: ['read', 'shell', 'mcp:github'] }]);
  assert.deepEqual(r.changes, [{ path: 'agents/reader.md', kind: 'update' }]);
  assertOnlyChanged(def, r);
  const reader = loadFromDisk(r).entries.subagents.find(s => s.id === 'reader');
  assert.deepEqual(reader.skills, ['deploy', 'review']);
  assert.deepEqual(reader.tools, ['read', 'shell', 'mcp:github']);
  assert.deepEqual(reader.model, { 'claude-code': 'model-a', codex: 'model-b' });
  assert.deepEqual(reader.privateBlocks, { 'claude-code': { color: 'blue', effort: 'high' } });
  assert.equal(reader.body, def.entries.subagents.find(s => s.id === 'reader').body);
});

test('set-agent with only skills leaves the tools alone, and null removes a field', () => {
  const def = load(fullFiles());
  const first = done(def, [{ kind: 'set-agent', id: 'reader', skills: [] }]);
  const reader = loadFromDisk(first).entries.subagents.find(s => s.id === 'reader');
  assert.deepEqual(reader.skills, []);
  assert.deepEqual(reader.tools, ['read', 'search', 'mcp:github']);
  const second = done(def, [{ kind: 'set-agent', id: 'reader', skills: null, tools: null }]);
  const bare = loadFromDisk(second).entries.subagents.find(s => s.id === 'reader');
  assert.equal(bare.skills, undefined);
  assert.equal(bare.tools, undefined);
  assert.deepEqual(bare.model, { 'claude-code': 'model-a', codex: 'model-b' });
});

test('set-agent can add a field the agent did not have', () => {
  const def = load(fullFiles());
  const r = done(def, [{ kind: 'set-agent', id: 'writer', skills: ['review'], tools: ['edit'] }]);
  const writer = loadFromDisk(r).entries.subagents.find(s => s.id === 'writer');
  assert.deepEqual(writer.skills, ['review']);
  assert.deepEqual(writer.tools, ['edit']);
  assert.deepEqual(writer.engines, ['codex']);
  assert.deepEqual(writer.privateBlocks, { codex: { reasoning_effort: 'medium', nested: { depth: 0.5 } } });
});

test('set-agent that changes nothing changes no file', () => {
  const def = load(fullFiles());
  const r = done(def, [{ kind: 'set-agent', id: 'reader', skills: ['review'], tools: ['read', 'search', 'mcp:github'] }]);
  assert.deepEqual(r.changes, []);
  assert.equal(r.revision, def.revision);
});

test('set-instructions replaces the instructions text', () => {
  const def = load(fullFiles());
  const next = '# Demo\n\nStanding fact: the demo uses pnpm.\n\n## Tool guidance\n\nRead before you edit.\n';
  const r = done(def, [{ kind: 'set-instructions', text: next }]);
  assert.deepEqual(r.changes, [{ path: 'instructions/AGENTS.md', kind: 'update' }]);
  assert.equal(text(byPath(r).get('instructions/AGENTS.md')), next);
  assertOnlyChanged(def, r);
  assert.equal(loadFromDisk(r).instructions, next);
});

test('set-instructions creates the file and lists the part when the definition had none', () => {
  const def = load({ 'harness.json': harness() });
  const r = done(def, [{ kind: 'set-instructions', text: '# Notes\n' }]);
  assert.deepEqual(r.changes, [{ path: 'harness.json', kind: 'update' }, { path: 'instructions/AGENTS.md', kind: 'create' }]);
  const loaded = loadFromDisk(r);
  assert.equal(loaded.instructions, '# Notes\n');
  assert.equal(loaded.harness.parts['system-prompt'], 'instructions/AGENTS.md');
});

test('set-engines replaces the engine list and keeps the rest of harness.json', () => {
  const def = load(fullFiles({ 'agents/writer.md': undefined, 'guardrails.json': json({ rules: [] }), 'hooks.json': undefined, 'mcp.json': undefined, 'harness.json': harness({ parts: { ...JSON.parse(harness()).parts, skills: 'skills/', subagents: 'agents/', guardrails: 'guardrails.json' }, skills: { review: { 'x-claude-code': { note: 'kept' } } } }), 'sources.json': undefined, 'instructions/AGENTS.md': undefined, 'scripts/lint.sh': undefined, 'engines/codex/config-extra.toml': undefined, 'agents/reader.md': agent('reader', 'x-claude-code:\n  color: blue\nmodel:\n  claude-code: model-a\n') }));
  const r = done(def, [{ kind: 'set-engines', engines: [{ id: 'claude-code', version: '2.1', model: 'model-a' }] }]);
  assert.deepEqual(r.changes, [{ path: 'harness.json', kind: 'update' }]);
  assertOnlyChanged(def, r);
  const loaded = loadFromDisk(r);
  assert.deepEqual(loaded.harness.engines, [{ id: 'claude-code', version: '2.1', model: 'model-a' }]);
  assert.deepEqual(loaded.harness.skills.review.privateBlocks, { 'claude-code': { note: 'kept' } });
  assert.deepEqual(loaded.harness.parts, def.harness.parts);
});

test('set-engines can add an engine', () => {
  const def = load({ 'harness.json': harness({ engines: [{ id: 'claude-code' }] }) });
  const r = done(def, [{ kind: 'set-engines', engines: [{ id: 'claude-code' }, { id: 'codex' }] }]);
  assert.deepEqual(loadFromDisk(r).harness.engines, [{ id: 'claude-code' }, { id: 'codex' }]);
});

// ---- untouched parts ------------------------------------------------------------------------------------------------

test('every part an edit does not touch stays byte-identical: x-blocks, hooks, mcp, guardrails, sources, scripts, engines', () => {
  const files = fullFiles({ 'scripts/lint.sh': '#!/bin/sh\nexit 0\n\r\n' });
  const dir = makeDefinition(files);
  fs.chmodSync(path.join(dir, 'scripts', 'lint.sh'), 0o755);
  const def = loadDefinition(dir).definition;
  const r = done(def, [
    { kind: 'set-skill', id: 'deploy', text: skill('deploy', 'Changed.') },
    { kind: 'set-agent', id: 'reader', skills: ['review', 'deploy'] },
    { kind: 'set-instructions', text: '# Demo\n\n## Tool guidance\n\nChanged.\n' },
  ]);
  assertOnlyChanged(def, r);
  const after = byPath(r);
  for (const p of ['harness.json', 'guardrails.json', 'hooks.json', 'mcp.json', 'sources.json', 'scripts/lint.sh', 'engines/codex/config-extra.toml', 'agents/writer.md', 'skills/review/SKILL.md']) {
    assert.ok(Buffer.from(after.get(p).bytes).equals(Buffer.from(def.files.find(f => f.path === p).bytes)), p);
  }
  assert.equal(after.get('scripts/lint.sh').executable, true);
  assert.equal(loadFromDisk(r).revision, r.revision);
});

test('the files come back in byte order of path', () => {
  const def = load(fullFiles());
  const r = done(def, [{ kind: 'add-skill', id: 'aaa', text: skill('aaa') }]);
  const paths = r.files.map(f => f.path);
  assert.deepEqual(paths, [...paths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
});

// ---- several edits, purity, determinism -----------------------------------------------------------------------------

test('edits apply in order: a skill added by one edit can be linked by the next', () => {
  const def = load(fullFiles());
  const r = done(def, [
    { kind: 'add-skill', id: 'triage', text: skill('triage', 'Sorts new issues.') },
    { kind: 'set-agent', id: 'writer', skills: ['triage'] },
    { kind: 'set-skill', id: 'triage', text: skill('triage', 'Sorts and labels new issues.') },
  ]);
  const loaded = loadFromDisk(r);
  assert.deepEqual(loaded.entries.subagents.find(s => s.id === 'writer').skills, ['triage']);
  assert.equal(loaded.entries.skills.find(s => s.id === 'triage').description, 'Sorts and labels new issues.');
  assert.deepEqual(r.changes.map(c => `${c.kind} ${c.path}`), ['update agents/writer.md', 'create skills/triage/SKILL.md']);
});

test('an add that a later edit removes leaves no trace', () => {
  const def = load(fullFiles());
  const r = done(def, [{ kind: 'add-skill', id: 'temp', text: skill('temp') }, { kind: 'remove-skill', id: 'temp' }]);
  assert.deepEqual(r.changes, []);
  assert.equal(r.revision, def.revision);
});

test('the same input gives the same files, the same changes, and the same revision', () => {
  const edits = [
    { kind: 'set-skill', id: 'deploy', text: skill('deploy', 'Changed.') },
    { kind: 'set-agent', id: 'reader', skills: ['deploy', 'review'], tools: ['read'] },
    { kind: 'set-instructions', text: '# Demo\n\n## Tool guidance\n\nChanged.\n' },
  ];
  const a = done(load(fullFiles()), edits), b = done(load(fullFiles()), edits);
  assert.equal(a.revision, b.revision);
  assert.deepEqual(a.changes, b.changes);
  assert.deepEqual(a.files.map(f => [f.path, text(f)]), b.files.map(f => [f.path, text(f)]));
  assert.equal(a.base, b.base);
});

test('the definition and the edits given are not changed', () => {
  const def = load(fullFiles());
  const snapshot = def.files.map(f => [f.path, Buffer.from(f.bytes).toString('base64')]);
  const harnessBefore = JSON.stringify(def.harness);
  const entriesBefore = JSON.stringify(def.entries);
  const edits = Object.freeze([
    Object.freeze({ kind: 'set-agent', id: 'reader', skills: Object.freeze(['deploy']), tools: Object.freeze(['read']) }),
    Object.freeze({ kind: 'remove-skill', id: 'deploy' }),
  ]);
  editDefinition(def, edits);
  assert.deepEqual(def.files.map(f => [f.path, Buffer.from(f.bytes).toString('base64')]), snapshot);
  assert.equal(JSON.stringify(def.harness), harnessBefore);
  assert.equal(JSON.stringify(def.entries), entriesBefore);
});

test('a result file does not share its buffer with the definition', () => {
  const def = load(fullFiles());
  const r = done(def, []);
  const first = r.files.find(f => f.path === 'harness.json');
  first.bytes[0] = 0x20;
  assert.notEqual(def.files.find(f => f.path === 'harness.json').bytes[0], 0x20);
});

test('no edits give the same files and revision', () => {
  const def = load(fullFiles());
  const r = done(def, []);
  assert.deepEqual(r.changes, []);
  assert.equal(r.revision, def.revision);
  assert.equal(r.files.length, def.files.length);
});

// ---- refusals -------------------------------------------------------------------------------------------------------

test('an unknown id is refused with the index of the edit', () => {
  const def = load(fullFiles());
  const r = refused(def, [{ kind: 'set-skill', id: 'deploy', text: skill('deploy') }, { kind: 'set-skill', id: 'ghost', text: skill('ghost') }], 'EDIT_UNKNOWN_ID');
  assert.equal(r.edit, 1);
  refused(def, [{ kind: 'remove-skill', id: 'ghost' }], 'EDIT_UNKNOWN_ID');
  refused(def, [{ kind: 'set-agent', id: 'ghost', skills: [] }], 'EDIT_UNKNOWN_ID');
});

test('linking a skill the folder does not hold is refused, and a link the agent already had is kept', () => {
  const def = load(fullFiles({ 'agents/writer.md': agent('writer', 'skills:\n  - elsewhere\n') }));
  refused(def, [{ kind: 'set-agent', id: 'reader', skills: ['review', 'ghost'] }], 'EDIT_UNKNOWN_ID');
  const r = done(def, [{ kind: 'set-agent', id: 'writer', skills: ['elsewhere', 'review'] }]);
  assert.deepEqual(loadFromDisk(r).entries.subagents.find(s => s.id === 'writer').skills, ['elsewhere', 'review']);
});

test('adding a skill that exists is refused', () => {
  refused(load(fullFiles()), [{ kind: 'add-skill', id: 'deploy', text: skill('deploy') }], 'EDIT_DUPLICATE_ID');
});

test('text over the file limit is refused for a skill, a new skill, and the instructions', () => {
  const def = load(fullFiles());
  const big = 'a'.repeat(DEFINITION_LIMITS.fileBytes + 1);
  const body = n => skill('deploy', 'Deploys.', '', 'a'.repeat(n));
  refused(def, [{ kind: 'set-skill', id: 'deploy', text: body(DEFINITION_LIMITS.fileBytes) }], 'EDIT_TOO_LARGE');
  refused(def, [{ kind: 'add-skill', id: 'deploy-two', text: big }], 'EDIT_TOO_LARGE');
  refused(def, [{ kind: 'set-instructions', text: big }], 'EDIT_TOO_LARGE');
  // The limit counts bytes, not characters.
  refused(def, [{ kind: 'set-instructions', text: 'é'.repeat(DEFINITION_LIMITS.fileBytes / 2 + 1) }], 'EDIT_TOO_LARGE');
});

test('text of exactly the file limit is accepted', () => {
  const edge = '# x\n' + lines(DEFINITION_LIMITS.fileBytes - 4);
  assert.equal(Buffer.byteLength(edge), DEFINITION_LIMITS.fileBytes);
  const r = done(load({ 'harness.json': harness() }), [{ kind: 'set-instructions', text: edge }]);
  assert.equal(r.files.find(f => f.path === 'instructions/AGENTS.md').bytes.length, DEFINITION_LIMITS.fileBytes);
});

test('more edits than the entry limit are refused', () => {
  const def = load(fullFiles());
  const edits = Array.from({ length: DEFINITION_LIMITS.entries + 1 }, () => ({ kind: 'set-instructions', text: '# x\n\n## Tool guidance\n' }));
  refused(def, edits, 'EDIT_TOO_LARGE');
});

test('a result over the whole definition limit is refused', () => {
  const def = load(fullFiles());
  const chunk = lines(DEFINITION_LIMITS.fileBytes - 200);
  const edits = Array.from({ length: 34 }, (_, i) => ({ kind: 'add-skill', id: `big-${i}`, text: skill(`big-${i}`, 'Big.', '', chunk) }));
  refused(def, edits, 'EDIT_TOO_LARGE');
});

test('an invalid result is refused with the loader problems and no secret value', () => {
  const def = load(fullFiles());
  const wrongName = refused(def, [{ kind: 'set-skill', id: 'deploy', text: skill('other') }], 'EDIT_INVALID');
  assert.ok(wrongName.problems.some(p => p.code === 'SKILL_NAME_MISMATCH' && p.path === 'skills/deploy/SKILL.md'));
  const noFrontmatter = refused(def, [{ kind: 'set-skill', id: 'deploy', text: 'Just words.\n' }], 'EDIT_INVALID');
  assert.ok(noFrontmatter.problems.some(p => p.code === 'FRONTMATTER_MISSING'));
  refused(def, [{ kind: 'set-skill', id: 'deploy', text: skill('deploy', 'ok', 'color: red\n') }], 'EDIT_INVALID');
  refused(def, [{ kind: 'set-agent', id: 'reader', tools: ['read', 'teleport'] }], 'EDIT_INVALID');
  refused(def, [{ kind: 'set-agent', id: 'reader', tools: ['read', 'read'] }], 'EDIT_INVALID');
  refused(def, [{ kind: 'set-skill', id: 'deploy', text: 'a\u0000b' }], 'EDIT_INVALID');
  refused(def, [{ kind: 'set-skill', id: 'deploy', text: '﻿' + skill('deploy') }], 'EDIT_INVALID');
});

test('a result the loader would refuse for a dangling reference is refused', () => {
  const def = load(fullFiles());
  // `review` is named by the tool guidance and by sources.json.
  const r = refused(def, [{ kind: 'remove-skill', id: 'review' }], 'EDIT_INVALID');
  assert.ok(r.problems.some(p => p.code === 'PART_POINTER'));
  assert.ok(r.problems.some(p => p.code === 'SOURCE_ITEM_MISSING'));
  // The heading the tool guidance points to.
  refused(def, [{ kind: 'set-instructions', text: '# Demo\n' }], 'EDIT_INVALID');
});

test('set-engines is refused when it drops an engine that an entry still targets, or is empty or unknown', () => {
  const def = load(fullFiles());
  const r = refused(def, [{ kind: 'set-engines', engines: [{ id: 'claude-code' }] }], 'EDIT_INVALID');
  assert.ok(r.problems.some(p => p.code === 'ENGINE_NOT_LISTED'));
  refused(def, [{ kind: 'set-engines', engines: [] }], 'EDIT_INVALID');
  refused(def, [{ kind: 'set-engines', engines: [{ id: 'notepad' }] }], 'EDIT_INVALID');
  refused(def, [{ kind: 'set-engines', engines: [{ id: 'codex' }, { id: 'codex' }] }], 'EDIT_INVALID');
});

test('a secret value in any edited text is refused as a secret', () => {
  const def = load(fullFiles());
  const secret = 'AK' + 'IA' + 'ABCD2345'.repeat(2);
  const r = refused(def, [{ kind: 'set-skill', id: 'deploy', text: skill('deploy', 'Deploys.', '', `Key: ${secret}\n`) }], 'EDIT_SECRET_FOUND');
  assert.ok(r.problems.some(p => p.code === 'SECRET_VALUE' && p.path === 'skills/deploy/SKILL.md'));
  assert.ok(!JSON.stringify(r).includes(secret));
  refused(def, [{ kind: 'set-instructions', text: `# Demo\n\n## Tool guidance\n\n${secret}\n` }], 'EDIT_SECRET_FOUND');
  refused(def, [{ kind: 'add-skill', id: 'leak', text: skill('leak', 'Leaks.', '', `${secret}\n`) }], 'EDIT_SECRET_FOUND');
});

const PATHY = ['../escape', 'a/b', '..', '.', '', 'A', 'two  words', 'a\\b', 'a\u0000b', '/abs', 'skills/review', 'a'.repeat(65), '-lead', 'trail-', 'a--b', 'café', 7, null, { toString: () => 'x' }, ['x']];

test('an id with a path character, or no valid id shape, is refused on every edit that takes one', () => {
  const def = load(fullFiles());
  for (const id of PATHY) {
    refused(def, [{ kind: 'set-skill', id, text: skill('deploy') }], 'EDIT_UNSAFE_ID');
    refused(def, [{ kind: 'add-skill', id, text: skill('deploy') }], 'EDIT_UNSAFE_ID');
    refused(def, [{ kind: 'remove-skill', id }], 'EDIT_UNSAFE_ID');
    refused(def, [{ kind: 'set-agent', id, skills: [] }], 'EDIT_UNSAFE_ID');
    refused(def, [{ kind: 'set-agent', id: 'reader', skills: [id] }], 'EDIT_UNSAFE_ID');
  }
});

test('an unsafe id never reaches a result path', () => {
  const def = load(fullFiles());
  for (const id of PATHY) {
    const r = editDefinition(def, [{ kind: 'add-skill', id, text: skill('x') }]);
    assert.equal(r.ok, false);
    assert.equal(r.files, undefined);
  }
});

test('a malformed edit is refused, never thrown', () => {
  const def = load(fullFiles());
  const bad = [
    null, undefined, 3, 'set-skill', [], {}, { kind: 'rename-skill', id: 'deploy' }, { kind: 'set-skill', id: 'deploy' },
    { kind: 'set-skill', id: 'deploy', text: 5 }, { kind: 'set-skill', id: 'deploy', text: skill('deploy'), extra: true },
    { kind: 'remove-skill' }, { kind: 'remove-skill', id: 'deploy', text: 'x' }, { kind: 'set-agent', id: 'reader' }, { kind: 'set-agent', id: 'reader', skills: 'review' },
    { kind: 'set-agent', id: 'reader', tools: [5] }, { kind: 'set-instructions' }, { kind: 'set-instructions', text: null },
    { kind: 'set-engines' }, { kind: 'set-engines', engines: 'codex' }, { kind: 'set-engines', engines: [null] },
    { kind: 'set-engines', engines: [{ id: 'codex', version: 3 }] }, { kind: 'set-engines', engines: [{ id: 'codex', extra: 1 }] },
    { kind: 'set-engines', engines: [{ id: 'codex', model: 10n }] },
    { kind: 'set-skill', id: 'deploy', text: 'lone \ud800 surrogate' },
    Object.create({ kind: 'set-instructions', text: 'x' }),
  ];
  for (const edit of bad) {
    let r;
    assert.doesNotThrow(() => { r = editDefinition(def, [edit]); }, String(edit));
    assert.equal(r.ok, false, JSON.stringify(edit, (_, v) => typeof v === 'bigint' ? 'big' : v));
    assert.equal(r.code, 'EDIT_BAD_EDIT');
    assert.equal(r.edit, 0);
  }
  for (const edits of [undefined, null, 'x', {}, 7]) {
    let r;
    assert.doesNotThrow(() => { r = editDefinition(def, edits); });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_BAD_EDIT');
  }
});

test('a refusal leaves nothing on disk and holds no file set', () => {
  const def = load(fullFiles());
  const r = editDefinition(def, [{ kind: 'remove-skill', id: 'ghost' }]);
  assert.equal(r.ok, false);
  assert.equal(r.files, undefined);
  assert.equal(r.revision, undefined);
});

test('a refusal message names the kind of fault and never repeats the text it was given', () => {
  const def = load(fullFiles());
  const marker = 'zz-marker-' + 'q'.repeat(12);
  for (const id of [`../${marker}`, `${marker}/x`]) {
    const r = editDefinition(def, [{ kind: 'set-skill', id, text: skill('deploy') }, { kind: 'set-agent', id: 'reader', skills: [id] }]);
    assert.equal(r.ok, false);
    assert.ok(!JSON.stringify(r).includes(marker));
  }
  const missing = editDefinition(def, [{ kind: 'set-agent', id: 'reader', skills: [undefined] }]);
  assert.equal(missing.code, 'EDIT_UNSAFE_ID');
});

test('a large definition is edited in bounded time', () => {
  const files = fullFiles();
  const skills = {};
  for (let i = 0; i < 400; i++) skills[`skills/gen-${i}/SKILL.md`] = skill(`gen-${i}`, `Generated skill ${i}.`);
  const def = load({ ...files, ...skills });
  const started = Date.now();
  const r = done(def, [{ kind: 'set-skill', id: 'gen-399', text: skill('gen-399', 'Changed.') }, { kind: 'remove-skill', id: 'gen-0' }]);
  assert.ok(Date.now() - started < 5000);
  assert.equal(r.changes.length, 2);
  assert.equal(loadFromDisk(r).revision, r.revision);
});

test('the agent frontmatter round trips through an edit', () => {
  const def = load(fullFiles());
  const r = done(def, [{ kind: 'set-agent', id: 'reader', skills: ['deploy'] }]);
  const parsed = readFrontmatter(text(byPath(r).get('agents/reader.md')));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.data.skills, ['deploy']);
  assert.equal(parsed.data.name, 'reader');
  assert.equal(parsed.body, def.entries.subagents.find(s => s.id === 'reader').body);
});

test('special characters survive an edit unchanged', () => {
  const def = load(fullFiles());
  const body = 'Use ☃ and 😀, éè, "quotes", \'single\', and a line ending in a space \n';
  const r = done(def, [{ kind: 'set-skill', id: 'deploy', text: skill('deploy', 'Snowman ☃ and emoji 😀.', '', body) }]);
  assert.equal(text(byPath(r).get('skills/deploy/SKILL.md')), skill('deploy', 'Snowman ☃ and emoji 😀.', '', body));
  assert.equal(loadFromDisk(r).entries.skills.find(s => s.id === 'deploy').body, '\n' + body);
});

test('an agent edit keeps the frontmatter comments and key order through a link, an unlink, and a remove-skill', () => {
  const commented = [
    '---',
    '# The reader agent. Keep this note.',
    'name: reader',
    'description: A read-only reader. # why it is read-only',
    'model:',
    '  claude-code: model-a # the fast one',
    'tools:',
    '  - read # always',
    '  - search',
    'skills:',
    '  - review # first',
    'x-claude-code:',
    '  color: blue # the colour in the menu',
    '---',
    '',
    'Read the files.',
    '',
  ].join('\n');
  const def = load(fullFiles({ 'agents/reader.md': commented }));
  const keyOrder = t => t.split('\n').filter(l => /^[a-z-]+:/.test(l)).map(l => l.slice(0, l.indexOf(':')));
  const original = keyOrder(commented);
  const comments = ['# The reader agent. Keep this note.', '# why it is read-only', '# the fast one', '# always', '# the colour in the menu'];
  const check = (r, label) => {
    const out = text(byPath(r).get('agents/reader.md'));
    for (const c of comments) assert.ok(out.includes(c), `${label}: the comment "${c}" survives`);
    assert.deepEqual(keyOrder(out), original, `${label}: the keys keep their order`);
    assert.ok(out.endsWith('---\n\nRead the files.\n'), `${label}: the body is the same`);
    return out;
  };
  const linked = check(done(def, [{ kind: 'set-agent', id: 'reader', skills: ['review', 'deploy'] }]), 'link');
  assert.ok(linked.includes('# first'), 'link: a kept item keeps its comment');
  assert.deepEqual(readFrontmatter(linked).data.skills, ['review', 'deploy']);
  const relinked = load(fullFiles({ 'agents/reader.md': linked }));
  const unlinked = check(done(relinked, [{ kind: 'set-agent', id: 'reader', skills: ['review'] }]), 'unlink');
  assert.ok(unlinked.includes('# first'), 'unlink: a kept item keeps its comment');
  assert.deepEqual(readFrontmatter(unlinked).data.skills, ['review']);
  const removed = check(done(relinked, [{ kind: 'remove-skill', id: 'deploy' }]), 'remove-skill');
  assert.ok(removed.includes('# first'), 'remove-skill: a kept item keeps its comment');
  assert.deepEqual(readFrontmatter(removed).data.skills, ['review']);
});
