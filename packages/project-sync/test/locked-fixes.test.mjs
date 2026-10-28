// Fix round of the step 3 writers: rulings B1, B2, B4 to B7, B10 to B12, B16 to B18, and B20 of the step 3 lane B
// review. Synthetic fixtures only.
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  PortableRefusal, applyPortableRemoval, planPortable, planPortableRemoval,
} from '../../../dist/packages/project-sync/src/index.js';
import { CODEX_PROFILE_ENABLED, codexProfile } from '../../../dist/packages/project-sync/src/locked.js';
import { editJson, editToml, frontmatter, scanToml } from '../../../dist/packages/project-sync/src/locked-text.js';
import { PermissionPairs, translateGuardrails } from '../../../dist/packages/fidelity/src/index.js';
import { assert, code, json, projectNow } from './portable-fixture.mjs';
import { DOCS, PINNED, agentFile, approveAll, exists, lockedProject, put, read } from './locked-fixture.mjs';

const engines = (...ids) => PINNED.filter(e => ids.includes(e.id));
const none = { mcp: null, parts: { mcp: undefined } };
const approvalsFor = (p, extra = {}) => { try { planPortable(p.input(extra)); return []; } catch (e) { if (e.code !== 'PORTABLE_FIDELITY') throw e; return approveAll(p, e); } };
const line = (plan, part, entry, engine, field) => plan.loss.find(l => l.part === part && l.entry === entry && l.engine === engine && l.field === field);
const mode = (p, rel) => fs.statSync(path.join(p.dir, rel)).mode & 0o777;
const removal = async p => { const plan = planPortableRemoval(p.input()); return applyPortableRemoval(p.input(), plan.revision); };
const GUARD = { id: 'guard', event: 'PreToolUse', matcher: 'Bash', command: '${PROJECT_DIR}/scripts/guard.sh', strength: 'enforced' };
const RULES = [
  { id: 'no-push-main', action: 'shell', pattern: 'git push * main', effect: 'deny', strength: 'enforced' },
  { id: 'no-env', action: 'read', pattern: '.env', effect: 'deny', strength: 'enforced' },
];

// ---- B1: modes -------------------------------------------------------------------------------------------------------------

test('B1: a merged file keeps the mode of the person\'s file; a new file is 0644', async t => {
  const p = lockedProject(t, { engines: engines('claude-code', 'codex', 'opencode') });
  for (const rel of ['.mcp.json', 'opencode.json']) { put(p, rel, json({})); fs.chmodSync(path.join(p.dir, rel), 0o600); }
  put(p, '.codex/config.toml', 'model = "x"\n'); fs.chmodSync(path.join(p.dir, '.codex/config.toml'), 0o600);
  await projectNow(p.input());
  for (const rel of ['.mcp.json', 'opencode.json', '.codex/config.toml']) assert.equal(mode(p, rel), 0o600, rel);
  assert.equal(planPortable(p.input()).noop, true);
  const q = lockedProject(t, { engines: engines('claude-code') });
  await projectNow(q.input());
  assert.equal(mode(q, '.mcp.json'), 0o644);
});

// ---- B2, B12: review ---------------------------------------------------------------------------------------------------------

test('B12: review lists every command Bowerloom writes, the OpenCode plugin, and the DeepSeek Harness patch', async t => {
  const p = lockedProject(t, { hooks: [GUARD], rules: [] });
  const plan = planPortable(p.input({ approvals: approvalsFor(p) }));
  const items = plan.review.map(r => `${r.kind} ${r.engine} ${r.path} ${r.part ?? ''} ${r.entry ?? ''}`);
  for (const want of [
    'command claude-code .mcp.json mcp docs', 'command codex .codex/config.toml mcp docs', 'command opencode opencode.json mcp docs', 'command pi .pi/mcp.json mcp docs',
    'command deepseek-harness .dsh/bowerloom.patch.yml mcp docs', 'command claude-code .claude/settings.json hooks guard', 'command codex .codex/hooks.json hooks guard',
    'code opencode .opencode/plugins/bowerloom-hooks.js  ', 'code deepseek-harness .dsh/bowerloom.patch.yml  ',
  ]) assert.ok(items.includes(want), want);
  const cc = plan.review.find(r => r.engine === 'claude-code' && r.part === 'mcp');
  assert.equal(cc.text, JSON.stringify(['docs-mcp', '--root', '.']));
  assert.equal(plan.review.find(r => r.engine === 'claude-code' && r.part === 'hooks').text, '${CLAUDE_PROJECT_DIR}/scripts/guard.sh');
});

test('B2: an MCP env named js is written as plain YAML, never as !!js', async t => {
  const p = lockedProject(t, { engines: engines('deepseek-harness'), mcp: [{ ...DOCS, env: { js: 'plain' } }] });
  await projectNow(p.input());
  assert.match(read(p, '.dsh/bowerloom.patch.yml'), /\n {10}js: "plain"\n/);
  assert.doesNotMatch(read(p, '.dsh/bowerloom.patch.yml'), /!!js/);
  const q = lockedProject(t, { engines: engines('deepseek-harness'), mcp: [{ ...DOCS, 'x-deepseek-harness': { reconnect: { js: 'process.exit(1)' } } }] });
  assert.throws(() => planPortable(q.input()), e => e.code === 'PORTABLE_UNSAFE_VALUE' && e.message.includes('mcp/docs'));
});

// ---- B4 ------------------------------------------------------------------------------------------------------------------------

test('B4: a guardrail pattern with {env: or {file: is refused for OpenCode, since it would be written into opencode.json', t => {
  for (const pattern of ['cat {env:HOME}', 'cat {file:x}']) {
    const p = lockedProject(t, { engines: engines('opencode'), ...none, rules: [{ id: 'odd', action: 'shell', pattern, effect: 'deny', strength: 'enforced' }] });
    assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_UNSAFE_VALUE' && e.message.includes('guardrails/odd'), pattern);
  }
});

// ---- B5: TOML ----------------------------------------------------------------------------------------------------------------

test('B5: the TOML scan decodes \\U escapes, so a managed name spelled with one is a conflict', () => {
  const d = scanToml('[mcp_servers."\\U00000064ocs"]\ncommand = "x"\n');
  assert.deepEqual(d.headers, [['mcp_servers', 'docs']]);
  const r = editToml('[mcp_servers."\\U00000064ocs"]\ncommand = "x"\n', [], [{ path: ['mcp_servers', 'docs'], entries: [['command', 'y']] }]);
  assert.equal(r.ok, false); assert.equal(r.reason, 'conflict');
});

test('B5: a person\'s TOML that defines a key or a table twice does not parse, and Bowerloom refuses to merge into it', () => {
  for (const text of ['a = 1\na = 2\n', '[t]\n[t]\n', 'a = 1\n[a]\n', 'a = 1\na.b = 2\n', '[t]\nx = 1\n[t.x]\n', 'a = 1 2\n', 'a = nope\n']) {
    assert.equal(scanToml(text), null, text);
    assert.deepEqual(editToml(text, [], [{ path: ['mcp_servers', 'docs'], entries: [['command', 'y']] }]), { ok: false, reason: 'invalid' }, text);
  }
  for (const text of ['a = 1\nb = "x"\n[t]\nc = 2026-10-28T10:00:00Z\nd = 1_000\ne = 0x1f\nf = -inf\ng = 1.5e3\n', '[[x]]\n[[x]]\n', 'a.b = 1\na.c = 2\n']) assert.notEqual(scanToml(text), null, text);
});

test('B5, B17: a TOML file with a byte order mark keeps it first; the merged result parses', () => {
  const r = editToml('\ufeffmodel = "x"\n', [], [{ path: ['mcp_servers', 'docs'], entries: [['command', 'y']] }]);
  assert.equal(r.ok, true); assert.ok(r.text.startsWith('\ufeffmodel = "x"\n')); assert.notEqual(scanToml(r.text), null);
  // Managed top-level keys go after the mark, never before it.
  const k = editToml('\ufeffmodel = "x"\n', [['k', 'v']], []);
  assert.ok(k.text.startsWith('\ufeff# Bowerloom')); assert.equal(k.text.indexOf('\ufeff', 1), -1); assert.notEqual(scanToml(k.text), null);
});

// ---- B6: the Codex profile is held back -------------------------------------------------------------------------------------

test('B6: Codex gets no default_permissions and no profile; path rules and the sandbox are weakened until step 5', async t => {
  assert.equal(CODEX_PROFILE_ENABLED, false);
  const p = lockedProject(t, { engines: engines('codex'), ...none, rules: RULES, sandbox: { id: 'box', files: true, network: true } });
  const e = (() => { try { planPortable(p.input()); } catch (err) { return err; } })();
  assert.deepEqual(e.refused.map(l => [l.entry, l.result]).sort(), [['box', 'weakened'], ['no-env', 'weakened'], ['no-push-main', 'weakened']]);
  for (const l of e.refused.filter(x => x.entry !== 'no-push-main')) assert.match(l.reason, /step 5/);
  await projectNow(p.input({ approvals: approveAll(p, e) }));
  assert.equal(exists(p, '.codex/config.toml'), false, 'nothing else goes to config.toml here');
  assert.ok(exists(p, '.codex/rules/bowerloom.rules'));
  // A sandbox_mode the person keeps is no longer a conflict: Bowerloom writes no profile.
  const q = lockedProject(t, { engines: engines('codex'), rules: RULES });
  put(q, '.codex/config.toml', 'sandbox_mode = "workspace-write"\n');
  assert.doesNotMatch(read(q, '.codex/config.toml'), /default_permissions/);
  await projectNow(q.input({ approvals: approvalsFor(q) }));
  assert.doesNotMatch(read(q, '.codex/config.toml'), /default_permissions|\[permissions/);
});

test('B6: the profile code stays behind the switch: it gives the profile when called', () => {
  const form = translateGuardrails('codex', { rules: [{ ...RULES[1], privateBlocks: {} }], sandbox: [] }).form;
  const profile = codexProfile(form);
  assert.deepEqual(profile.root, [['default_permissions', 'bowerloom']]);
  assert.deepEqual(profile.tables.map(x => x.path.join('.')), ['permissions.bowerloom', 'permissions.bowerloom.filesystem.:workspace_roots']);
  assert.deepEqual(profile.forbid, ['sandbox_mode']);
});

// ---- B7, B18: versions --------------------------------------------------------------------------------------------------------

test('B7: an older recorded Claude Code, Codex, or Pi version is refused; a newer one is noted on every line of that engine', t => {
  for (const [engine, older, newer, pinned] of [['claude-code', '2.1.300', '2.2.0', '2.1.310'], ['codex', '0.150.0', '0.158.1', '0.157.0'], ['pi', '1.3.9', '1.5.0', '1.4.0']]) {
    assert.throws(() => planPortable(lockedProject(t, { engines: [{ id: engine, version: older }] }).input()), e => e.code === 'PORTABLE_ENGINE_VERSION' && e.message.includes(`${engine} ${older}`), engine);
    const plan = planPortable(lockedProject(t, { engines: [{ id: engine, version: newer }] }).input());
    for (const l of plan.loss) assert.match(l.reason, new RegExp(`file shape checked at ${pinned.replaceAll('.', '\\.')}`), `${engine} ${l.part} ${l.entry}`);
    const same = planPortable(lockedProject(t, { engines: [{ id: engine, version: pinned }] }).input());
    for (const l of same.loss) assert.doesNotMatch(l.reason, /file shape checked/);
  }
});

test('B18: a portable-only projection for another OpenCode or DeepSeek Harness version proceeds, with a note naming the pinned version', async t => {
  for (const [engine, pinned] of [['opencode', '1.18.30'], ['deepseek-harness', '0.2.2-alpha.2']]) {
    const p = lockedProject(t, { engines: [{ id: engine, version: '0.1.0' }], ...none });
    const { plan } = await projectNow(p.input());
    assert.ok(plan.loss.length > 0);
    for (const l of plan.loss) assert.match(l.reason, new RegExp(pinned.replaceAll('.', '\\.')), `${engine} ${l.part}`);
    assert.throws(() => planPortable(lockedProject(t, { engines: [{ id: engine, version: '0.1.0' }] }).input()), code('PORTABLE_ENGINE_VERSION'));
  }
});

// ---- B10 ---------------------------------------------------------------------------------------------------------------------

test('B10, B17: an OpenCode settings file in .opencode/, or a root opencode.jsonc, is a conflict', t => {
  for (const rel of ['.opencode/opencode.json', '.opencode/opencode.jsonc', 'opencode.jsonc']) {
    const p = lockedProject(t, { engines: engines('opencode') });
    put(p, rel, '{}\n');
    assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_CONFLICT' && e.message.includes(rel), rel);
  }
});

// ---- B11 ---------------------------------------------------------------------------------------------------------------------

test('B11: disableAllHooks or a defaultMode in the person\'s Claude settings weakens the hook lines; the sandbox forbids unsandboxed commands', async t => {
  for (const settings of [{ disableAllHooks: true }, { permissions: { defaultMode: 'acceptEdits' } }]) {
    const p = lockedProject(t, { engines: engines('claude-code'), ...none, hooks: [{ ...GUARD, strength: 'advisory' }] });
    put(p, '.claude/settings.json', json(settings));
    const l = line(planPortable(p.input()), 'hooks', 'guard', 'claude-code');
    assert.equal(l.result, 'weakened'); assert.match(l.reason, /disableAllHooks|defaultMode/);
  }
  const q = lockedProject(t, { engines: engines('claude-code'), ...none, sandbox: { id: 'box', files: true, network: true } });
  await projectNow(q.input());
  assert.deepEqual(JSON.parse(read(q, '.claude/settings.json')).sandbox, { enabled: true, allowUnsandboxedCommands: false });
});

// ---- B16 ---------------------------------------------------------------------------------------------------------------------

test('B16: frontmatter writes a PermissionPairs marker as a block, an empty one as {}, and keeps a plain list of pairs as data', () => {
  assert.equal(frontmatter([['permission', new PermissionPairs([['edit', 'deny']])]], ''), '---\npermission:\n  "edit": "deny"\n---\n');
  assert.equal(frontmatter([['permission', new PermissionPairs([])]], ''), '---\npermission: {}\n---\n');
  assert.equal(frontmatter([['tags', [['a', 'b']]]], ''), '---\ntags: [["a","b"]]\n---\n');
});

// ---- B17: the JSON editor and the plugin -------------------------------------------------------------------------------------

test('B17: the JSON editor refuses a repeated key, refuses a path step that is not an object, and never repeats an item', () => {
  assert.deepEqual(editJson('{"a": 1, "a": 2}', [{ kind: 'members', path: ['x'], members: [['k', 1]] }]), { ok: false, reason: 'invalid' });
  assert.deepEqual(editJson('{"permissions": []}', [{ kind: 'items', path: ['permissions', 'deny'], items: ['X'] }]), { ok: false, reason: 'conflict', at: ['permissions'] });
  const r = editJson('{"permissions": {"deny": ["X"]}}', [{ kind: 'items', path: ['permissions', 'deny'], items: ['X', 'Y'] }]);
  assert.deepEqual(JSON.parse(r.text).permissions.deny, ['X', 'Y']);
});

test('B17: the OpenCode plugin blocks on a decision of block', async t => {
  const p = lockedProject(t, { engines: engines('opencode'), ...none, hooks: [{ ...GUARD, command: 'echo \'{"decision":"block","reason":"blocked by decision"}\'' }] });
  await projectNow(p.input({ approvals: approvalsFor(p) }));
  const copy = path.join(p.base, 'plugin-copy.mjs');
  fs.copyFileSync(path.join(p.dir, '.opencode/plugins/bowerloom-hooks.js'), copy);
  const { spawnSync } = await import('node:child_process');
  const $ = (strings, command, response) => {
    const shell = { env: () => shell, quiet: () => shell, nothrow: () => shell, then: (a, b) => response.text().then(input => { const r = spawnSync('/bin/sh', ['-c', command], { input, encoding: 'utf8' }); return { exitCode: r.status, stdout: r.stdout, stderr: r.stderr }; }).then(a, b) };
    return shell;
  };
  const hooks = await (await import(pathToFileURL(copy).href)).BowerloomHooks({ directory: p.dir, $ });
  await assert.rejects(hooks['tool.execute.before']({ tool: 'bash' }, { args: { command: 'x' } }), /blocked by decision/);
});

// ---- B20 ---------------------------------------------------------------------------------------------------------------------

test('B20: a zero-byte config.toml is refused like a zero-byte JSON file', t => {
  for (const [engine, rel] of [['codex', '.codex/config.toml'], ['claude-code', '.mcp.json']]) {
    const p = lockedProject(t, { engines: engines(engine) });
    put(p, rel, '');
    assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_TARGET_INVALID' && e.message.includes(rel), rel);
  }
});

test('B20: a file Bowerloom did not write at one of its own paths is occupied', t => {
  const cases = [
    ['.codex/rules/bowerloom.rules', { engines: engines('codex'), ...none, rules: [RULES[0]] }],
    ['.opencode/plugins/bowerloom-hooks.js', { engines: engines('opencode'), ...none, hooks: [{ ...GUARD, strength: 'advisory' }] }],
    ['.dsh/bowerloom.patch.yml', { engines: engines('deepseek-harness') }],
  ];
  for (const [rel, setup] of cases) {
    const p = lockedProject(t, setup);
    put(p, rel, 'mine\n');
    assert.throws(() => planPortable(p.input({ approvals: approvalsFor(p) })), e => e.code === 'PORTABLE_PATH_OCCUPIED' && e.message.includes(rel), rel);
  }
});

test('B20: Claude Code project MCP servers are pending trust, because Claude Code asks the person to approve them', t => {
  const plan = planPortable(lockedProject(t, { engines: engines('claude-code') }).input());
  assert.deepEqual(plan.trust.map(x => [x.engine, x.path, x.state]), [['claude-code', '.mcp.json', 'pending trust']]);
  assert.match(line(plan, 'mcp', 'docs', 'claude-code').reason, /approve/);
});

test('removal of a projection with a 0600 merged file restores the person\'s bytes and mode', async t => {
  const p = lockedProject(t, { engines: engines('claude-code') });
  put(p, '.mcp.json', json({ mcpServers: {} })); fs.chmodSync(path.join(p.dir, '.mcp.json'), 0o600);
  await projectNow(p.input());
  await removal(p);
  assert.equal(mode(p, '.mcp.json'), 0o600); assert.equal(read(p, '.mcp.json'), json({ mcpServers: {} }));
  assert.ok(PortableRefusal);
});

// ---- B21: the no-link fallback never leaves a truncated file -------------------------------------------------------------------

test('B21: when the write fails after the O_EXCL create of the no-link fallback, the new file is removed and the run rolls back cleanly', async t => {
  const { applyPortableWith } = await import('../../../dist/packages/project-sync/src/portable-run.js');
  const p = lockedProject(t, { engines: engines('claude-code') });
  const plan = planPortable(p.input());
  const noLink = () => { throw Object.assign(new Error('no link here'), { code: 'EPERM' }); };
  const fail = rel => { if (rel === '.mcp.json') throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
  await assert.rejects(applyPortableWith(p.input(), plan.revision, new AbortController().signal, { link: noLink, afterCreate: fail }), e => e.code === 'ENOSPC');
  assert.equal(exists(p, '.mcp.json'), false, 'no truncated file is left');
  assert.equal(fs.readdirSync(p.dir).some(n => n.includes('bowerloom-tmp')), false);
  // Nothing is left for recovery, and the next apply writes the file whole.
  const again = planPortable(p.input());
  await (await import('../../../dist/packages/project-sync/src/index.js')).applyPortable(p.input(), again.revision);
  assert.deepEqual(JSON.parse(read(p, '.mcp.json')).mcpServers.docs.command, 'docs-mcp');
});
