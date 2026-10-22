// Spec 01a, section 10.2: parseAgent, the pure validation of one team agent file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAgent, parseAgentOrRefuse, ALLOWED_AGENT_KEYS } from '../../../dist/packages/project-authoring/src/agent-file.js';
import { isAuthoringRefusal } from '../../../dist/packages/project-authoring/src/refusal.js';

const BODY = 'Do the work.\n';
const file = (front, body = BODY) => `---\n${front}\n---\n${body}`;
const base = (extra = '') => `name: scribe\ndescription: Writes things down.${extra ? '\n' + extra : ''}`;
const parse = (text, stem = 'scribe') => parseAgent(text, stem, 'desk');
const ok = (text, stem) => { const r = parse(text, stem); assert.equal(r.ok, true, JSON.stringify(r)); return r.agent; };
const bad = (text, code, stem) => { const r = parse(text, stem); assert.equal(r.ok, false, 'expected a failure'); assert.equal(r.code, code, JSON.stringify(r)); return r; };

test('the allowed keys are the documented list, in order', () => {
  assert.deepEqual([...ALLOWED_AGENT_KEYS], ['name', 'description', 'tools', 'disallowedTools', 'model', 'permissionMode', 'maxTurns', 'autoCompactWindow', 'skills', 'mcpServers', 'hooks', 'memory', 'background', 'omitClaudeMd', 'effort', 'isolation', 'color', 'initialPrompt', 'experimental']);
});

test('each allowed key passes with a valid value', () => {
  const good = [
    'tools: Read, Grep', 'tools:\n  - Read\n  - Bash(npm run *)', 'tools: []', 'disallowedTools: Write, Edit', 'model: sonnet', 'model: claude-opus-4-1', 'model: claude-sonnet-4-5[1m]',
    'permissionMode: default', 'permissionMode: acceptEdits', 'permissionMode: auto', 'permissionMode: dontAsk', 'permissionMode: bypassPermissions', 'permissionMode: plan', 'permissionMode: manual',
    'maxTurns: 1', 'maxTurns: 10000', 'autoCompactWindow: 100000', 'autoCompactWindow: 1000000', 'skills: house-style, review', 'skills:\n  - house-style',
    'mcpServers:\n  docs:\n    command: docs-server', 'mcpServers:\n  - docs', 'hooks:\n  PreToolUse:\n    - matcher: Bash', 'memory: user', 'memory: project', 'memory: local',
    'background: true', 'background: false', 'omitClaudeMd: true', 'effort: low', 'effort: medium', 'effort: high', 'effort: xhigh', 'effort: max', 'isolation: worktree',
    'color: red', 'color: blue', 'color: green', 'color: yellow', 'color: purple', 'color: orange', 'color: pink', 'color: cyan',
    'initialPrompt: Start with the plan.', 'experimental:\n  cacheTtl: 5m', 'experimental:\n  cacheTtl: 1h',
  ];
  for (const line of good) ok(file(base(line)));
  const agent = ok(file(base('tools: Read')));
  assert.equal(agent.stem, 'scribe'); assert.equal(agent.team, 'desk'); assert.equal(agent.description, 'Writes things down.');
});

test('each value rule fails with AGENT_INVALID for one bad value, and a null value fails for every optional key', () => {
  const badValues = [
    'tools: null', "tools: ''", 'tools: Bash(a', 'tools: Read)', 'tools: 5', 'tools:\n  - 5', 'tools: Read,, Grep', 'tools: has space', 'disallowedTools: ""', 'disallowedTools: bad entry!',
    'model: ""', 'model: -x', 'model: 5', 'permissionMode: root', 'permissionMode: Plan', 'maxTurns: 0', 'maxTurns: 10001', 'maxTurns: 1.5', 'maxTurns: many',
    'autoCompactWindow: 99999', 'autoCompactWindow: 1000001', 'skills: House', 'skills:\n  - ok\n  - Bad_Skill', 'mcpServers: text', 'mcpServers: 5', 'hooks: yes please', 'memory: global',
    'background: maybe', 'background: 1', 'omitClaudeMd: "true"', 'effort: extreme', 'isolation: container', 'color: black', 'initialPrompt: 5', 'experimental: 5', 'experimental:\n  cacheTtl: 2h', 'experimental:\n  other: 5', 'experimental:\n  cacheTtl: 5m\n  extra: 1',
  ];
  for (const line of badValues) bad(file(base(line)), 'AGENT_INVALID');
  for (const key of ALLOWED_AGENT_KEYS.filter(k => k !== 'name' && k !== 'description')) bad(file(`${base()}\n${key}:`), 'AGENT_INVALID');
  bad(file('name: scribe\ndescription:'), 'AGENT_INVALID');
  bad(file('name:\ndescription: x'), 'AGENT_INVALID');
});

test('an unknown key is AGENT_KEY_UNKNOWN and its name appears only when it is plain', () => {
  const typo = bad(file(base('tool: Read')), 'AGENT_KEY_UNKNOWN');
  assert.match(typo.detail, /tool/);
  const odd = bad(file(base('"evil\\u001b[31mkey": 1')), 'AGENT_KEY_UNKNOWN');
  assert.doesNotMatch(odd.detail, /evil/); assert.match(odd.detail, /a key with unsupported characters/);
  // Keys are checked before values, so an unknown key wins over a bad value.
  bad(file(base('maxTurns: 0\ntool: Read')), 'AGENT_KEY_UNKNOWN');
  bad(file(base('x'.repeat(65) + ': 1')), 'AGENT_KEY_UNKNOWN');
});

test('a name that differs from the stem is AGENT_NAME_MISMATCH', () => {
  bad(file('name: Scribe\ndescription: x'), 'AGENT_NAME_MISMATCH');
  bad(file('name: other\ndescription: x'), 'AGENT_NAME_MISMATCH');
  bad(file('description: x'), 'AGENT_INVALID');
  bad(file('name: 5\ndescription: x'), 'AGENT_INVALID');
});

test('a bad stem is AGENT_NAME_MISMATCH', () => {
  for (const stem of ['Scribe', 'scribe_two', 'scribe:two', 'a'.repeat(65), '', '-scribe', 'scribe-', 'two--hyphens', 'prompt-x', 'notes.txt']) {
    bad(file(`name: ${stem || 'x'}\ndescription: x`), 'AGENT_NAME_MISMATCH', stem);
  }
  ok(file(`name: ${'a'.repeat(64)}\ndescription: x`), 'a'.repeat(64));
  ok(file('name: a1-b2\ndescription: x'), 'a1-b2');
});

test('a missing description, an empty body, and a blank body are AGENT_INVALID', () => {
  bad(file('name: scribe'), 'AGENT_INVALID');
  bad(file(base(), ''), 'AGENT_INVALID');
  bad(file(base(), '\n\n  \n\t\n'), 'AGENT_INVALID');
  bad(file('name: scribe\ndescription: ""'), 'AGENT_INVALID');
  ok(file(base(), 'x'));
});

test('a leading BOM, a carriage return, and a null byte are AGENT_INVALID', () => {
  bad('\uFEFF' + file(base()), 'AGENT_INVALID');
  bad(file(base()).replace(/\n/g, '\r\n'), 'AGENT_INVALID');
  bad(file(base(), 'Body\0here\n'), 'AGENT_INVALID');
});

test('frontmatter fences: the first line must be a fence, trailing blanks are allowed, and an unclosed block fails', () => {
  bad(`name: scribe\ndescription: x\n---\n${BODY}`, 'AGENT_INVALID');
  bad(`---\nname: scribe\ndescription: x\n${BODY}`, 'AGENT_INVALID');
  bad(` ---\n${base()}\n---\n${BODY}`, 'AGENT_INVALID');
  ok(`---  \t\n${base()}\n---\t \n${BODY}`);
  bad('---\n---\n' + BODY, 'AGENT_INVALID');
  bad('---\n- a\n- b\n---\n' + BODY, 'AGENT_INVALID');
  bad('---\njust text\n---\n' + BODY, 'AGENT_INVALID');
});

test('a duplicate YAML key, an alias, and a merge key are AGENT_INVALID', () => {
  bad(file(base('description: again')), 'AGENT_INVALID');
  bad(file(base('mcpServers: &a\n  one: 1\nhooks: *a')), 'AGENT_INVALID');
  bad(file(base('hooks:\n  <<: {a: 1}')), 'AGENT_INVALID');
  bad(file(base('<<: {model: sonnet}')), 'AGENT_INVALID');
  bad(file('name: scribe\ndescription: [unclosed'), 'AGENT_INVALID');
});

test('tools as a comma string and as a list give the same entries; parentheses protect commas', () => {
  const a = ok(file(base('tools: Read, Grep, Bash(npm run *)'))), b = ok(file(base('tools:\n  - Read\n  - Grep\n  - Bash(npm run *)')));
  assert.deepEqual(a.tools, ['Read', 'Grep', 'Bash(npm run *)']); assert.deepEqual(b.tools, a.tools);
  assert.deepEqual(ok(file(base('tools: Bash(a, b)'))).tools, ['Bash(a, b)']);
  assert.deepEqual(ok(file(base('tools: []'))).tools, []);
  assert.equal(ok(file(base())).tools, null);
  assert.deepEqual(ok(file(base('skills: house-style, review'))).skills, ['house-style', 'review']);
  bad(file(base('tools: Bash(a')), 'AGENT_INVALID');
  bad(file(base(`tools: ${Array.from({ length: 65 }, (_, i) => 'T' + i).join(', ')}`)), 'AGENT_INVALID');
  ok(file(base(`tools: ${Array.from({ length: 64 }, (_, i) => 'T' + i).join(', ')}`)));
  bad(file(base(`tools: ${'T'.repeat(129)}`)), 'AGENT_INVALID');
});

test('tool entries: pattern forms are valid and names are case-sensitive', () => {
  assert.deepEqual(ok(file(base('tools: Bash(npm run *), Edit(/src/**), mcp__server__tool, Agent'))).tools, ['Bash(npm run *)', 'Edit(/src/**)', 'mcp__server__tool', 'Agent']);
  assert.deepEqual(ok(file(base('tools: bash'))).tools, ['bash']);
  assert.notEqual(ok(file(base('tools: bash'))).tools[0], 'Bash');
  bad(file(base(`tools: Bash(${'x'.repeat(101)})`)), 'AGENT_INVALID');
});

test('hooks and mcpServers depth: six levels pass and seven fail; the size cap is 4096 bytes of JSON', () => {
  const nest = n => { let v = 'x'; for (let i = 0; i < n; i++) v = { k: v }; return JSON.stringify(v); };
  ok(file(base(`hooks: ${nest(6)}`))); bad(file(base(`hooks: ${nest(7)}`)), 'AGENT_INVALID');
  ok(file(base(`mcpServers: ${nest(6)}`))); bad(file(base(`mcpServers: ${nest(7)}`)), 'AGENT_INVALID');
  ok(file(base(`mcpServers: ${JSON.stringify({ a: 'x'.repeat(4000) })}`)));
  bad(file(base(`mcpServers: ${JSON.stringify({ a: 'x'.repeat(4100) })}`)), 'AGENT_INVALID');
});

test('description: 2048 characters pass and 2049 fail; initialPrompt is capped at 8192 bytes', () => {
  ok(file(`name: scribe\ndescription: ${'d'.repeat(2048)}`)); bad(file(`name: scribe\ndescription: ${'d'.repeat(2049)}`), 'AGENT_INVALID');
  ok(file(base(`initialPrompt: ${'p'.repeat(8192)}`))); bad(file(base(`initialPrompt: ${'p'.repeat(8193)}`)), 'AGENT_INVALID');
});

test('the parse result reports what the notices need: present keys, permissionMode, tools', () => {
  const agent = ok(file(base('hooks:\n  a: 1\nmcpServers:\n  b: 1\npermissionMode: dontAsk\ntools: Read')));
  assert.deepEqual(agent.keys, ['name', 'description', 'hooks', 'mcpServers', 'permissionMode', 'tools']);
  assert.equal(agent.permissionMode, 'dontAsk'); assert.deepEqual(agent.tools, ['Read']);
});

test('parseAgentOrRefuse returns the agent or throws an authoring refusal with the same code', () => {
  assert.equal(parseAgentOrRefuse(file(base()), 'scribe', 'desk').stem, 'scribe');
  for (const [text, code] of [[file(base('tool: x')), 'AGENT_KEY_UNKNOWN'], [file('name: other\ndescription: x'), 'AGENT_NAME_MISMATCH'], ['nope', 'AGENT_INVALID']]) {
    assert.throws(() => parseAgentOrRefuse(text, 'scribe', 'desk'), e => isAuthoringRefusal(e) && e.code === code);
  }
});

test('large and odd input does not throw out of parseAgent', () => {
  for (const text of ['', '---', '---\n', 'x'.repeat(100000), '---\n' + 'a: 1\n'.repeat(20000) + '---\nb\n', '---\n{{{{\n---\nb\n']) assert.equal(parse(text).ok, false);
});

test('S3: an explicit YAML tag is AGENT_INVALID, and the opaque size is measured from the source text', () => {
  bad(file(base('hooks: !!omap [ {a: 1} ]')), 'AGENT_INVALID');
  bad(file(base('mcpServers: !!set {x: ~}')), 'AGENT_INVALID');
  bad(file(base('initialPrompt: !!binary aGVsbG8=')), 'AGENT_INVALID');
  bad(file(base('model: !!str sonnet')), 'AGENT_INVALID');
  bad(file(base('model: !custom sonnet')), 'AGENT_INVALID');
  // The JSON of this value is tiny, and its source text is larger than 4096 bytes.
  bad(file(base(`hooks: {a: ${' '.repeat(4200)}1}`)), 'AGENT_INVALID');
  ok(file(base(`hooks: {a: ${' '.repeat(100)}1}`)));
});

test('F6: a YAML warning is AGENT_INVALID', () => {
  bad(file(base('model: sonnet\nhooks: !unknown {a: 1}')), 'AGENT_INVALID');
});

test('R1: a --- inside the frontmatter block, or a leading tab, is AGENT_INVALID', () => {
  // Claude Code ends the frontmatter at the first --- anywhere, so this comment would hide the tools line from it.
  bad('---\nname: scribe\ndescription: x\n# ---\ntools: Read\n---\nBody\n', 'AGENT_INVALID');
  bad(file(base('model: a---b')), 'AGENT_INVALID');
  bad(file(base('initialPrompt: "Start --- now"')), 'AGENT_INVALID');
  bad(file(base('hooks:\n  a: 1 # ---')), 'AGENT_INVALID');
  bad(file(base('tools: Read\n\tmodel: sonnet')), 'AGENT_INVALID');
  ok(file(base('tools: Read')));
  // A --- in the body is fine: Claude Code has already ended the frontmatter.
  ok(file(base('tools: Read'), 'Body\n---\nmore\n'));
});
