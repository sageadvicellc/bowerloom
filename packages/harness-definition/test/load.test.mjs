// Harness definition spec, sections 3, 4, 8, and 13; portable parts spec 4.2 and decision 2.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ENGINE_IDS, HARNESS_FORMAT, isEngineId, loadDefinition, parseStrictJson,
} from '../../../dist/packages/harness-definition/src/index.js';
import { FULL_PARTS, agent, cleanup, codes, fullFiles, harness, json, makeDefinition, skill } from './fixture.mjs';

test.after(cleanup);

const ok = files => {
  const r = loadDefinition(makeDefinition(files));
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems));
  return r.definition;
};
const refused = (files, code) => {
  const r = loadDefinition(makeDefinition(files));
  assert.equal(r.ok, false, `expected ${code}`);
  assert.ok(codes(r).includes(code), `expected ${code}, got ${JSON.stringify(r.problems)}`);
  for (const p of r.problems) {
    assert.equal(typeof p.path, 'string');
    assert.equal(typeof p.message, 'string');
    assert.ok(p.message.length > 0);
  }
  return r.problems;
};

test('engine ids are the five of decision 2, in one set', () => {
  assert.deepEqual([...ENGINE_IDS], ['claude-code', 'codex', 'opencode', 'pi', 'deepseek-harness']);
  assert.ok(Object.isFrozen(ENGINE_IDS));
  for (const id of ENGINE_IDS) assert.equal(isEngineId(id), true);
  for (const id of ['claude', 'hermes', 'Codex', '', null, undefined, 1]) assert.equal(isEngineId(id), false);
  assert.equal(HARNESS_FORMAT, 'bowerloom/harness/v1beta1');
});

test('strict JSON: a plain document parses', () => {
  const r = parseStrictJson('{"a": [1, 2.5, true, null, "x"], "b": {}}');
  assert.equal(r.ok, true);
  assert.deepEqual({ ...r.value }, { a: [1, 2.5, true, null, 'x'], b: {} });
});

test('strict JSON: duplicate keys, comments, and trailing commas are refused', () => {
  const cases = {
    '{"a": 1, "a": 2}': 'DUPLICATE_JSON_KEY',
    '{"a": {"b": 1, "b": 1}}': 'DUPLICATE_JSON_KEY',
    '{"a": 1 // note\n}': 'INVALID_JSON',
    '// note\n{"a": 1}': 'INVALID_JSON',
    '{"a": /* note */ 1}': 'INVALID_JSON',
    '{"a": 1,}': 'INVALID_JSON',
    '[1, 2,]': 'INVALID_JSON',
    "{'a': 1}": 'INVALID_JSON',
    '{"a": NaN}': 'INVALID_JSON',
    '': 'INVALID_JSON',
  };
  for (const [text, code] of Object.entries(cases)) {
    const r = parseStrictJson(text);
    assert.equal(r.ok, false, text);
    assert.equal(r.code, code, text);
  }
});

test('a definition with every part loads into neutral entries', () => {
  const d = ok(fullFiles());
  assert.equal(d.harness.format, HARNESS_FORMAT);
  assert.equal(d.harness.id, 'demo');
  assert.deepEqual(d.harness.engines.map(e => e.id), ['claude-code', 'codex']);
  assert.deepEqual(d.harness.overrides, []);
  assert.match(d.instructions, /Standing fact/);
  assert.deepEqual(d.entries.skills.map(s => s.id), ['deploy', 'review']);
  const review = d.entries.skills.find(s => s.id === 'review');
  assert.equal(review.description, 'Reviews a change.');
  assert.equal(review.license, 'MIT');
  assert.deepEqual({ ...review.metadata }, { owner: 'demo' });
  // Byte order of the UTF-8 path, the same on every machine.
  assert.deepEqual(review.files, ['SKILL.md', 'references/notes.md']);
  assert.match(review.body, /Body of review/);

  const reader = d.entries.subagents.find(s => s.id === 'reader');
  assert.deepEqual({ ...reader.model }, { 'claude-code': 'model-a', codex: 'model-b' });
  assert.deepEqual(reader.tools, ['read', 'search', 'mcp:github']);
  assert.deepEqual(reader.skills, ['review']);
  assert.match(reader.body, /Read the files/);

  assert.deepEqual(d.entries.rules.map(r => [r.id, r.action, r.effect, r.strength]), [
    ['no-push-main', 'shell', 'deny', 'enforced'],
    ['git-any', 'shell', 'allow', 'advisory'],
    ['ask-rm', 'shell', 'ask', 'enforced'],
  ]);
  assert.equal(d.entries.sandbox.length, 1);
  assert.equal(d.entries.sandbox[0].files, true);
  assert.deepEqual(d.entries.hooks.map(h => h.id), ['lint-on-edit', 'codex-only']);
  assert.equal(d.entries.hooks[0].timeout, 30000);
  assert.deepEqual(d.entries.mcp.map(m => [m.id, m.transport]), [['github', 'stdio'], ['docs', 'http']]);
  assert.deepEqual(d.entries.mcp[1].headers['X-Key'], { keychain: 'docs-api' });
  assert.deepEqual(d.scripts, ['lint.sh']);
  assert.deepEqual(d.sources, [{ name: 'review-kit', marketplace: 'example-market', version: '1.2.0', items: [{ part: 'skills', id: 'review' }] }]);
  assert.deepEqual(d.enginePrivate, { codex: ['config-extra.toml'] });
  assert.match(d.revision, /^sha256:[0-9a-f]{64}$/);
  assert.ok(d.files.some(f => f.path === 'engines/codex/config-extra.toml'));
});

test('engine-private x-blocks pass through untouched', () => {
  const d = ok(fullFiles());
  const reader = d.entries.subagents.find(s => s.id === 'reader');
  assert.deepEqual(reader.privateBlocks, { 'claude-code': { color: 'blue', permissionMode: 'plan' } });
  const writer = d.entries.subagents.find(s => s.id === 'writer');
  assert.deepEqual(writer.privateBlocks, { codex: { sandbox_mode: 'workspace-write', nested: { depth: 0.5 } } });
  const askRm = d.entries.rules.find(r => r.id === 'ask-rm');
  assert.deepEqual(askRm.privateBlocks, { 'claude-code': { note: 'kept' } });
  assert.deepEqual(d.entries.rules[0].privateBlocks, {});
});

test('legacy files in the layer are not read and stay byte for byte', () => {
  const legacy = '{"harnesses": ["claude"], "skills": []}';
  const dir = makeDefinition({ ...fullFiles(), 'skills.json': legacy, 'bowerloom.json': legacy, 'authoring/receipt.json': '{}' });
  const before = fs.readFileSync(path.join(dir, 'skills.json'));
  const r = loadDefinition(dir);
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.ok(!r.definition.files.some(f => f.path === 'skills.json' || f.path.startsWith('authoring/')));
  assert.deepEqual(fs.readFileSync(path.join(dir, 'skills.json')), before);
});

test('a folder with no harness.json is refused', () => {
  refused({ 'skills.json': '{}' }, 'HARNESS_MISSING');
});

test('harness.json: strict JSON faults surface as problems', () => {
  refused({ 'harness.json': '{"format": "x", "format": "y"}' }, 'DUPLICATE_JSON_KEY');
  refused({ 'harness.json': harness().replace(/\n}\n$/, ',\n}\n') }, 'INVALID_JSON');
  refused({ 'harness.json': '// c\n' + harness() }, 'INVALID_JSON');
});

test('harness.json: fields are checked', () => {
  refused({ 'harness.json': harness({ format: 'bowerloom/harness/v2' }) }, 'FORMAT_UNSUPPORTED');
  refused({ 'harness.json': harness({ id: 'Demo' }) }, 'INVALID_ID');
  refused({ 'harness.json': harness({ id: 'a'.repeat(65) }) }, 'INVALID_ID');
  refused({ 'harness.json': harness({ id: 'double--hyphen' }) }, 'INVALID_ID');
  refused({ 'harness.json': harness({ description: '' }) }, 'INVALID_FIELD');
  refused({ 'harness.json': harness({ engines: [] }) }, 'INVALID_FIELD');
  refused({ 'harness.json': harness({ engines: [{ id: 'claude' }] }) }, 'UNKNOWN_ENGINE');
  refused({ 'harness.json': harness({ engines: [{ id: 'codex' }, { id: 'codex' }] }) }, 'DUPLICATE_ID');
  refused({ 'harness.json': harness({ engines: [{ id: 'codex', alias: 'x' }] }) }, 'UNKNOWN_FIELD');
  refused({ 'harness.json': harness({ sources: [] }) }, 'UNKNOWN_FIELD');
  refused({ 'harness.json': harness({ extra: true }) }, 'UNKNOWN_FIELD');
  refused({ 'harness.json': harness({ 'x-codex': {} }) }, 'UNKNOWN_FIELD');
  const d = ok({ 'harness.json': harness({ engines: [{ id: 'pi', version: '1.4.0', model: 'model-p' }] }) });
  assert.deepEqual(d.harness.engines, [{ id: 'pi', version: '1.4.0', model: 'model-p' }]);
});

test('parts: a file on disk that harness.json does not point to is refused, and the reverse', () => {
  refused({ 'harness.json': harness(), 'guardrails.json': json({ rules: [] }) }, 'PART_NOT_LISTED');
  refused({ 'harness.json': harness({ parts: { guardrails: 'guardrails.json' } }) }, 'PART_MISSING');
  refused({ 'harness.json': harness({ parts: { guardrails: 'rules/guardrails.json' } }), 'rules/guardrails.json': json({ rules: [] }) }, 'PART_POINTER');
  refused({ 'harness.json': harness({ parts: { teams: 'team.yaml' } }) }, 'UNKNOWN_FIELD');
  refused({ ...fullFiles(), 'harness.json': harness({ parts: { ...FULL_PARTS, 'tool-guidance': ['instructions/AGENTS.md#No such heading'] } }) }, 'PART_POINTER');
  refused({ ...fullFiles(), 'harness.json': harness({ parts: { ...FULL_PARTS, 'tool-guidance': ['skills/absent'] } }) }, 'PART_POINTER');
  refused({ ...fullFiles(), 'harness.json': harness({ parts: { ...FULL_PARTS, memory: 'knowledge-base' } }) }, 'PART_POINTER');
});

test('unexpected files inside part folders are refused, not dropped', () => {
  refused({ ...fullFiles(), 'instructions/OTHER.md': 'x\n' }, 'UNEXPECTED_FILE');
  refused({ ...fullFiles(), 'agents/notes.txt': 'x\n' }, 'UNEXPECTED_FILE');
  refused({ ...fullFiles(), 'skills/loose.md': 'x\n' }, 'UNEXPECTED_FILE');
  refused({ ...fullFiles(), 'engines/hermes/x.yaml': 'a: 1\n' }, 'UNKNOWN_ENGINE');
  refused({ ...fullFiles(), 'scripts/.env': 'A=1\n' }, 'UNEXPECTED_FILE');
  // Finder metadata is not content.
  ok({ ...fullFiles(), 'skills/.DS_Store': 'x', 'scripts/.DS_Store': 'x' });
});

test('a symbolic link inside the definition is refused', () => {
  const dir = makeDefinition(fullFiles());
  fs.symlinkSync(path.join(dir, 'scripts', 'lint.sh'), path.join(dir, 'scripts', 'link.sh'));
  const r = loadDefinition(dir);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('SYMLINK'));
});

test('portable skill frontmatter: an extra key is refused before projection (decision 2)', () => {
  const base = fullFiles();
  refused({ ...base, 'skills/deploy/SKILL.md': skill('deploy', 'Deploys.', 'allowed-tools: Bash\n') }, 'SKILL_UNKNOWN_FIELD');
  refused({ ...base, 'skills/deploy/SKILL.md': skill('deploy', 'Deploys.', 'x-codex:\n  a: 1\n') }, 'SKILL_UNKNOWN_FIELD');
  refused({ ...base, 'skills/deploy/SKILL.md': skill('deploy', 'Deploys.', 'engines:\n  - codex\n') }, 'SKILL_UNKNOWN_FIELD');
  refused({ ...base, 'skills/deploy/SKILL.md': skill('other', 'Deploys.') }, 'SKILL_NAME_MISMATCH');
  refused({ ...base, 'skills/deploy/SKILL.md': skill('deploy', '""') }, 'INVALID_FIELD');
  refused({ ...base, 'skills/deploy/SKILL.md': skill('deploy', 'x'.repeat(1025)) }, 'INVALID_FIELD');
  refused({ ...base, 'skills/deploy/SKILL.md': skill('deploy', 'Deploys.', 'metadata:\n  n: 1\n') }, 'INVALID_FIELD');
  refused({ ...base, 'skills/deploy/SKILL.md': 'No frontmatter.\n' }, 'FRONTMATTER_MISSING');
  refused({ ...base, 'skills/deploy/SKILL.md': skill('deploy', 'Deploys.', 'name: deploy\n') }, 'FRONTMATTER_INVALID');
  refused({ ...base, 'skills/Bad_Name/SKILL.md': skill('Bad_Name') }, 'INVALID_ID');
  refused({ ...base, 'skills/empty/notes.md': 'x\n' }, 'SKILL_MISSING');
  ok({ ...base, 'skills/deploy/SKILL.md': skill('deploy', 'x'.repeat(1024), 'compatibility: Needs git.\n') });
});

test('subagent frontmatter: neutral fields, x-blocks kept, anything else refused', () => {
  const base = fullFiles();
  refused({ ...base, 'agents/reader.md': agent('reader', 'color: blue\n') }, 'UNKNOWN_FIELD');
  refused({ ...base, 'agents/reader.md': agent('reader', 'x-hermes:\n  a: 1\n') }, 'UNKNOWN_ENGINE');
  refused({ ...base, 'agents/reader.md': agent('reader', 'tools:\n  - Bash\n') }, 'INVALID_FIELD');
  refused({ ...base, 'agents/reader.md': agent('reader', 'model:\n  claude: m\n') }, 'UNKNOWN_ENGINE');
  refused({ ...base, 'agents/reader.md': agent('reader', 'skills:\n  - Not An Id\n') }, 'INVALID_FIELD');
  refused({ ...base, 'agents/reader.md': agent('other') }, 'SUBAGENT_NAME_MISMATCH');
  refused({ ...base, 'agents/reader.md': agent('reader', '', '') }, 'INVALID_FIELD');
  refused({ ...base, 'agents/reader.md': agent('reader', 'x-codex: &a\n  k: 1\ny: *a\n') }, 'FRONTMATTER_INVALID');
});

test('guardrails, hooks, and MCP servers: shapes are checked and unknown fields refused', () => {
  const base = fullFiles();
  const rule = { id: 'r', action: 'shell', pattern: 'ls', effect: 'deny', strength: 'enforced' };
  refused({ ...base, 'guardrails.json': json({ rules: [{ ...rule, effect: 'forbid' }] }) }, 'INVALID_FIELD');
  refused({ ...base, 'guardrails.json': json({ rules: [{ ...rule, strength: 'strong' }] }) }, 'INVALID_FIELD');
  refused({ ...base, 'guardrails.json': json({ rules: [{ ...rule, action: 'Bash' }] }) }, 'INVALID_FIELD');
  refused({ ...base, 'guardrails.json': json({ rules: [{ ...rule, priority: 1 }] }) }, 'UNKNOWN_FIELD');
  refused({ ...base, 'guardrails.json': json({ rules: [rule, rule] }) }, 'DUPLICATE_ID');
  refused({ ...base, 'guardrails.json': json({ rules: [{ ...rule, engines: [] }] }) }, 'INVALID_FIELD');
  refused({ ...base, 'guardrails.json': json({ rules: [{ ...rule, engines: ['hermes'] }] }) }, 'UNKNOWN_ENGINE');
  refused({ ...base, 'guardrails.json': json({ rules: [], sandbox: { files: false, network: false } }) }, 'INVALID_FIELD');
  refused({ ...base, 'guardrails.json': json({ rules: [], extra: 1 }) }, 'UNKNOWN_FIELD');

  const hook = { id: 'h', event: 'PreToolUse', command: 'true', strength: 'enforced' };
  refused({ ...base, 'hooks.json': json({ hooks: [{ ...hook, type: 'http' }] }) }, 'UNKNOWN_FIELD');
  refused({ ...base, 'hooks.json': json({ hooks: [{ ...hook, timeout: -1 }] }) }, 'INVALID_FIELD');
  refused({ ...base, 'hooks.json': json({ hooks: [{ ...hook, command: '' }] }) }, 'INVALID_FIELD');
  ok({ ...base, 'hooks.json': json({ hooks: [{ ...hook, 'x-claude-code': { type: 'http', url: 'https://hooks.example.com' } }] }) });

  const server = { name: 's', transport: 'stdio', command: 'run' };
  refused({ ...base, 'mcp.json': json({ servers: [{ ...server, transport: 'pipe' }] }) }, 'INVALID_FIELD');
  refused({ ...base, 'mcp.json': json({ servers: [{ name: 's', transport: 'stdio' }] }) }, 'INVALID_FIELD');
  refused({ ...base, 'mcp.json': json({ servers: [{ ...server, url: 'https://x.example.com' }] }) }, 'INVALID_FIELD');
  refused({ ...base, 'mcp.json': json({ servers: [{ name: 's', transport: 'http', command: 'x' }] }) }, 'INVALID_FIELD');
  refused({ ...base, 'mcp.json': json({ servers: [{ ...server, env: { A: '${A:-fallback}' } }] }) }, 'ENV_REFERENCE');
  refused({ ...base, 'mcp.json': json({ servers: [{ ...server, env: { A: '$A' } }] }) }, 'ENV_REFERENCE');
  refused({ ...base, 'mcp.json': json({ servers: [{ ...server, env: { A: { vault: 'x' } } }] }) }, 'INVALID_FIELD');
  refused({ ...base, 'mcp.json': json({ servers: [server, server] }) }, 'DUPLICATE_ID');
  const d = ok({ ...base, 'mcp.json': json({ servers: [{ name: 'ws-one', transport: 'ws', url: 'wss://x.example.com', timeout: 5000, enabled: false }] }) });
  assert.equal(d.entries.mcp[0].enabled, false);
});

test('sources: a borrowed item records a pinned version and must exist', () => {
  const base = fullFiles();
  const src = { name: 'kit', marketplace: 'market', version: '1.0.0', items: [{ part: 'skills', id: 'review' }] };
  refused({ ...base, 'sources.json': json({ sources: [{ ...src, version: '^1.0.0' }] }) }, 'SOURCE_NOT_PINNED');
  refused({ ...base, 'sources.json': json({ sources: [{ ...src, version: 'latest' }] }) }, 'SOURCE_NOT_PINNED');
  refused({ ...base, 'sources.json': json({ sources: [{ ...src, items: [{ part: 'skills', id: 'absent' }] }] }) }, 'SOURCE_ITEM_MISSING');
  refused({ ...base, 'sources.json': json({ sources: [{ ...src, marketplace: '' }] }) }, 'INVALID_FIELD');
});

test('overrides in harness.json are checked for shape', () => {
  refused({ 'harness.json': harness({ overrides: [{ part: 'skills', id: 'a', action: 'remove' }] }) }, 'INVALID_FIELD');
  refused({ 'harness.json': harness({ overrides: [{ part: 'instructions', id: 'a', action: 'hide' }] }) }, 'INVALID_FIELD');
  refused({ 'harness.json': harness({ overrides: [{ part: 'skills', id: 'a', action: 'hide' }, { part: 'skills', id: 'a', action: 'replace' }] }) }, 'DUPLICATE_ID');
  const d = ok({ 'harness.json': harness({ overrides: [{ part: 'guardrails', id: 'a', action: 'hide' }] }) });
  assert.deepEqual(d.harness.overrides, [{ part: 'guardrails', id: 'a', action: 'hide' }]);
});

test('every problem names the file it came from', () => {
  const problems = refused({ ...fullFiles(), 'hooks.json': json({ hooks: [{ id: 'h', event: 'PreToolUse', command: 'true', strength: 'hard' }] }) }, 'INVALID_FIELD');
  assert.ok(problems.some(p => p.path === 'hooks.json'));
});

test('the folder itself must exist and be a folder', () => {
  assert.deepEqual(codes(loadDefinition('/nonexistent-bowerloom-definition-folder')), ['FOLDER_MISSING']);
  const dir = makeDefinition(fullFiles());
  assert.deepEqual(codes(loadDefinition(path.join(dir, 'harness.json'))), ['FOLDER_MISSING']);
});

test('text parts must be UTF-8 with no byte order mark', () => {
  refused({ ...fullFiles(), 'skills/deploy/SKILL.md': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(skill('deploy'))]) }, 'TEXT_ENCODING');
  refused({ ...fullFiles(), 'instructions/AGENTS.md': Buffer.from([0x23, 0x20, 0xff, 0x0a]) }, 'TEXT_ENCODING');
  refused({ ...fullFiles(), 'hooks.json': Buffer.from([0x7b, 0xff, 0x7d]) }, 'TEXT_ENCODING');
});

test('a part with the wrong kind of entry is refused', () => {
  const files = fullFiles();
  delete files['instructions/AGENTS.md'];
  refused({ ...files, instructions: '# Not a folder\n' }, 'UNEXPECTED_FILE');
  refused({ ...fullFiles(), 'hooks.json/inner.json': '{}' , 'hooks.json': undefined }, 'UNEXPECTED_FILE');
  refused({ ...fullFiles(), 'agents/nested/x.md': agent('x') }, 'UNEXPECTED_FILE');
  refused({ ...fullFiles(), 'agents/Bad.md': agent('Bad') }, 'INVALID_ID');
  refused({ ...fullFiles(), 'engines/codex.toml': 'a = 1\n' }, 'UNEXPECTED_FILE');
  refused({ ...fullFiles(), 'scripts/bad\\name.sh': 'x\n' }, 'UNEXPECTED_FILE');
});

test('a file over 1 MiB is refused', () => {
  refused({ ...fullFiles(), 'scripts/big.txt': Buffer.alloc(1024 * 1024 + 1, 0x61) }, 'TOO_LARGE');
});

test('a subagent or skill with broken frontmatter names the fault', () => {
  refused({ ...fullFiles(), 'agents/reader.md': '---\nname: reader\n' }, 'FRONTMATTER_MISSING');
  refused({ ...fullFiles(), 'agents/reader.md': '---\n- a list\n---\nbody\n' }, 'FRONTMATTER_INVALID');
  refused({ ...fullFiles(), 'agents/reader.md': '---\nname: !!binary aGVsbG8=\ndescription: x\n---\nbody\n' }, 'FRONTMATTER_INVALID');
  refused({ ...fullFiles(), 'agents/reader.md': agent('reader', 'model: {}\n') }, 'INVALID_FIELD');
  refused({ ...fullFiles(), 'agents/reader.md': agent('reader', 'model:\n  codex: ""\n') }, 'INVALID_FIELD');
});
