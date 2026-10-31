// Step 3, lane B: the locked-in writers (locked-in parts spec, sections 5 to 8 and 12). They extend the portable
// projection: one plan, one approval revision, one receipt, one journal, removal, and recovery. Synthetic fixtures only.
import test from 'node:test';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { entryHash } from '../../../dist/packages/harness-definition/src/index.js';
import {
  PORTABLE_RECEIPT_FORMAT, applyPortable, applyPortableRecovery, applyPortableRemoval, planPortable, planPortableRecovery, planPortableRemoval,
  readPortableReceipt,
} from '../../../dist/packages/project-sync/src/index.js';
import { applyPortableWith } from '../../../dist/packages/project-sync/src/portable-run.js';
import { isProjectedDir, isProjectedPath } from '../../../dist/packages/project-sync/src/portable-files.js';
import { assert, code, crashAt, forge, json, projectNow, sha, snapshot, written } from './portable-fixture.mjs';
import { DOCS, PINNED, agentFile, approve, approveAll, entryOf, exists, lockedProject, put, read } from './locked-fixture.mjs';

const signal = () => new AbortController().signal;
const refusal = fn => { try { fn(); } catch (e) { return e; } throw new Error('expected a refusal'); };
const removal = async p => { const plan = planPortableRemoval(p.input()); return applyPortableRemoval(p.input(), plan.revision); };
const line = (plan, part, entry, engine, field) => plan.loss.find(l => l.part === part && l.entry === entry && l.engine === engine && l.field === field);
const engines = (...ids) => PINNED.filter(e => ids.includes(e.id));
/** The approvals for every refused line of a plan, or none when nothing is refused. */
const approvalsFor = (p, extra = {}) => { try { planPortable(p.input(extra)); return []; } catch (e) { if (e.code !== 'PORTABLE_FIDELITY') throw e; return approveAll(p, e); } };

// ---- the path shapes the receipt may name ---------------------------------------------------------------------------------

test('the receipt path list grows by exactly the locked-in files and folders, nothing broader', () => {
  for (const ok of ['.mcp.json', '.claude/settings.json', '.claude/agents/reader.md', '.codex/config.toml', '.codex/hooks.json', '.codex/rules/bowerloom.rules',
    '.codex/agents/reader.toml', 'opencode.json', '.opencode/agents/reader.md', '.opencode/plugins/bowerloom-hooks.js', '.pi/mcp.json', '.dsh/bowerloom.patch.yml']) assert.equal(isProjectedPath(ok), true, ok);
  for (const bad of ['.claude/settings.local.json', '.claude/agents/Reader.md', '.claude/agents/../x.md', '.claude/agents/a/b.md', '.codex/rules/other.rules', '.codex/agents/reader.md',
    '.codex/config.json', 'opencode.jsonc', '.opencode/plugins/other.js', '.opencode/agents/reader.toml', '.pi/settings.json', '.dsh/cordis.patch.yml', '.mcp.json/x', 'mcp.json']) assert.equal(isProjectedPath(bad), false, bad);
  for (const ok of ['.claude', '.claude/agents', '.codex', '.codex/rules', '.codex/agents', '.opencode', '.opencode/agents', '.opencode/plugins', '.pi', '.dsh']) assert.equal(isProjectedDir(ok), true, ok);
  for (const bad of ['.claude/agents/x', '.codex/other', '.opencode/plugins/x', '.pi/agent', '.dsh/profiles', 'opencode']) assert.equal(isProjectedDir(bad), false, bad);
});

test('a forged receipt that names a path outside the list is refused', async t => {
  const p = lockedProject(t, { engines: engines('claude-code') });
  await projectNow(p.input());
  forge(p.stateDir, 'receipt.json', r => { r.files[0].path = '.claude/settings.local.json'; });
  assert.throws(() => planPortable(p.input()), code('PORTABLE_STATE_INVALID'));
});

// ---- MCP servers, every engine ------------------------------------------------------------------------------------------

test('MCP servers go to .mcp.json, .codex/config.toml, opencode.json, .pi/mcp.json, and .dsh/bowerloom.patch.yml', async t => {
  const p = lockedProject(t);
  const { plan, result } = await projectNow(p.input());
  assert.equal(PORTABLE_RECEIPT_FORMAT, 'bowerloom/portable-projection-receipt/v1beta4');
  assert.deepEqual(JSON.parse(read(p, '.mcp.json')).mcpServers.docs, { type: 'stdio', command: 'docs-mcp', args: ['--root', '.'], env: { DOCS_TOKEN: '${DOCS_TOKEN}' } });
  assert.match(read(p, '.codex/config.toml'), /\[mcp_servers\.docs\]\ncommand = "docs-mcp"\nargs = \["--root", "\."\]\nenv_vars = \["DOCS_TOKEN"\]\n/);
  assert.deepEqual(JSON.parse(read(p, 'opencode.json')).mcp.docs, { type: 'local', command: ['docs-mcp', '--root', '.'], environment: { DOCS_TOKEN: '{env:DOCS_TOKEN}' } });
  assert.deepEqual(JSON.parse(read(p, '.pi/mcp.json')).mcpServers.docs.env, { DOCS_TOKEN: '${DOCS_TOKEN}' });
  assert.match(read(p, '.dsh/bowerloom.patch.yml'), /- insert:\n {4}- id: "bowerloom-mcp-docs"\n {6}name: "@deepseek-ai\/dsh-mcp-client"\n {6}config:\n {8}serverName: "docs"\n/);
  assert.match(read(p, '.dsh/bowerloom.patch.yml'), /DOCS_TOKEN: !!js "process\.env\.DOCS_TOKEN"/);
  assert.deepEqual(['claude-code', 'codex', 'opencode', 'pi', 'deepseek-harness'].map(e => line(plan, 'mcp', 'docs', e).result), ['exact', 'translated', 'translated', 'exact', 'translated']);
  for (const f of ['.mcp.json', '.codex/config.toml', 'opencode.json', '.pi/mcp.json', '.dsh/bowerloom.patch.yml']) assert.ok(result.receipt.files.some(r => r.path === f), f);
  assert.equal(plan.deferred.some(d => d.part === 'mcp'), false, 'locked-in parts are no longer deferred');
});

test('check 4: an unmanaged server in .codex/config.toml survives byte for byte; removal restores the file', async t => {
  const p = lockedProject(t, { engines: engines('codex') });
  const original = '# my settings\nmodel = "some-model" # trailing comment\n\n[mcp_servers.mine]\ncommand = "mine-mcp"\nargs = ["--flag", "a]b", \'#x\']\nenv = { A = "1" }\n\n[tui]\nnotifications = true\n';
  put(p, '.codex/config.toml', original);
  await projectNow(p.input());
  const after = read(p, '.codex/config.toml');
  assert.ok(after.includes(original), 'every unmanaged byte is still there, in order');
  assert.match(after, /\[mcp_servers\.docs\]/);
  assert.equal(planPortable(p.input()).noop, true, 'a second projection writes nothing');
  await removal(p);
  assert.equal(read(p, '.codex/config.toml'), original);
});

test('check 4: a managed name that the file already holds, as a table, a key, or an inline table, is refused as a conflict', t => {
  for (const held of ['[mcp_servers.docs]\ncommand = "x"\n', 'mcp_servers = { docs = { command = "x" } }\n', '[mcp_servers]\ndocs.command = "x"\n', '[mcp_servers.docs.env]\nA = "1"\n']) {
    const p = lockedProject(t, { engines: engines('codex') });
    put(p, '.codex/config.toml', held);
    assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_CONFLICT' && /mcp_servers\.docs/.test(e.message), held);
  }
  const bad = lockedProject(t, { engines: engines('codex') });
  put(bad, '.codex/config.toml', '[mcp_servers\nx = 1\n');
  assert.throws(() => planPortable(bad.input()), code('PORTABLE_TARGET_INVALID'));
  // A server that the person's .mcp.json already holds with other content is a conflict; the same content is not.
  const cc = lockedProject(t, { engines: engines('claude-code') });
  put(cc, '.mcp.json', json({ mcpServers: { docs: { command: 'other' } } }));
  assert.throws(() => planPortable(cc.input()), code('PORTABLE_CONFLICT'));
});

test('check 5: ${NAME:-x} is refused, never copied as literal text into any projected file', async t => {
  const p = lockedProject(t, { mcp: [{ ...DOCS, args: ['--root', '${ROOT:-.}'] }] });
  const e = refusal(() => planPortable(p.input()));
  assert.equal(e.code, 'PORTABLE_ENV_DEFAULT'); assert.match(e.message, /mcp\/docs/);
  const h = lockedProject(t, { hooks: [{ id: 'guard', event: 'PreToolUse', matcher: 'Bash', command: 'check ${MODE:-strict}', strength: 'advisory' }] });
  assert.throws(() => planPortable(h.input({ engines: [{ id: 'claude-code' }] })), code('PORTABLE_ENV_DEFAULT'));
  // A full projection of every part writes no such form anywhere.
  const full = lockedProject(t, {
    engines: engines('claude-code', 'codex', 'opencode'), hooks: [{ id: 'lint', event: 'PostToolUse', matcher: 'Edit', command: '${PROJECT_DIR}/scripts/lint.sh', strength: 'advisory' }],
    rules: [{ id: 'no-curl', action: 'shell', pattern: 'curl *', effect: 'deny', strength: 'enforced' }], agents: { helper: agentFile('helper') },
  });
  const input = full.input({ approvals: approvalsFor(full) });
  await applyPortable(input, planPortable(input).revision);
  for (const f of readPortableReceipt(full.input()).files) assert.equal(/\$\{[A-Za-z_][A-Za-z0-9_]*:?[-=?+]/.test(read(full, f.path)), false, f.path);
});

// ---- versions: checks 6 and 13 ---------------------------------------------------------------------------------------------

test('check 6: a projection of locked-in parts for any recorded OpenCode version other than 1.18.30 is refused; a portable-only one proceeds (B18)', t => {
  for (const version of ['1.18.29', '2.0.0', '1.0.0']) {
    const p = lockedProject(t, { engines: [{ id: 'opencode', version }] });
    assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_ENGINE_VERSION' && e.message.includes(`opencode ${version}`), version);
    const portableOnly = lockedProject(t, { engines: [{ id: 'opencode', version }], mcp: null, parts: { mcp: undefined } });
    assert.match(planPortable(portableOnly.input()).loss[0].reason, /OpenCode 1\.18\.30 only/, version);
  }
  const unknown = lockedProject(t, { engines: [{ id: 'opencode' }] });
  assert.throws(() => planPortable(unknown.input()), code('PORTABLE_ENGINE_VERSION'), 'an unknown version cannot pick the 1.x shape for locked-in parts');
  assert.doesNotThrow(() => planPortable(lockedProject(t, { engines: [{ id: 'opencode' }], mcp: null, parts: { mcp: undefined } }).input()), 'portable parts alone need no version');
  assert.doesNotThrow(() => planPortable(lockedProject(t, { engines: engines('opencode') }).input()));
});

test('check 13: a projection for any DeepSeek Harness tag other than the pinned one is refused', t => {
  for (const version of ['0.2.2-alpha.1', '0.2.1-rc.2', '0.3.0']) {
    const p = lockedProject(t, { engines: [{ id: 'deepseek-harness', version }] });
    assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_ENGINE_VERSION' && e.message.includes(`deepseek-harness ${version}`), version);
  }
  assert.throws(() => planPortable(lockedProject(t, { engines: [{ id: 'deepseek-harness' }] }).input()), code('PORTABLE_ENGINE_VERSION'));
  for (const version of ['0.2.2-alpha.2', 'dsh-v0.2.2-alpha.2']) assert.doesNotThrow(() => planPortable(lockedProject(t, { engines: [{ id: 'deepseek-harness', version }] }).input()), version);
});

// ---- checks 14 and 15 ---------------------------------------------------------------------------------------------------------

test('check 14: a Pi MCP entry goes to .pi/mcp.json and is pending trust until a person saves trust', async t => {
  const p = lockedProject(t, { engines: engines('pi') });
  const plan = planPortable(p.input());
  assert.deepEqual(plan.trust.filter(x => x.path === '.pi/mcp.json').map(x => [x.engine, x.state]), [['pi', 'pending trust']]);
  assert.match(line(plan, 'mcp', 'docs', 'pi').reason, /Pending trust/);
  await applyPortable(p.input(), plan.revision);
  assert.ok(exists(p, '.pi/mcp.json'));
  const trusted = planPortable(p.input({ piTrustSaved: true }));
  assert.deepEqual(trusted.trust.filter(x => x.path === '.pi/mcp.json').map(x => x.state), ['trusted']);
  assert.doesNotMatch(line(trusted, 'mcp', 'docs', 'pi').reason, /Pending trust/);
});

test('check 15: a DeepSeek Harness MCP entry goes to a Bowerloom-owned patch file; the person\'s cordis.patch.yml is never touched', async t => {
  const p = lockedProject(t, { engines: engines('deepseek-harness') });
  put(p, '.dsh/cordis.patch.yml', '- insert:\n    - id: mine\n      name: my-plugin\n');
  const before = snapshot(p.dir)['.dsh/cordis.patch.yml'];
  const { plan } = await projectNow(p.input());
  assert.deepEqual(plan.changes.filter(c => c.path.startsWith('.dsh/')).map(c => c.path), ['.dsh/bowerloom.patch.yml']);
  assert.equal(snapshot(p.dir)['.dsh/cordis.patch.yml'], before);
  assert.match(read(p, '.dsh/bowerloom.patch.yml'), /--patch \.dsh\/bowerloom\.patch\.yml/);
  await removal(p);
  assert.equal(exists(p, '.dsh/bowerloom.patch.yml'), false);
  assert.equal(snapshot(p.dir)['.dsh/cordis.patch.yml'], before);
});

// ---- check 3: subagents ---------------------------------------------------------------------------------------------------

test('check 3: a read-only subagent is exact in Claude Code, deny keys in OpenCode, and refused in Codex without an override', async t => {
  const reader = agentFile('reader', 'tools:\n  - read\n  - search\nmodel:\n  claude-code: sonnet\n');
  const p = lockedProject(t, { engines: engines('claude-code', 'codex', 'opencode'), mcp: null, parts: { mcp: undefined }, agents: { reader } });
  const e = refusal(() => planPortable(p.input()));
  assert.equal(e.code, 'PORTABLE_FIDELITY');
  assert.deepEqual(e.refused.map(l => [l.part, l.entry, l.engine, l.field, l.result]), [['subagents', 'reader', 'codex', 'tools', 'weakened'], ['subagents', 'reader', 'opencode', 'tools', 'weakened']]);
  const approvals = approveAll(p, e);
  const { plan, result } = await projectNow(p.input({ approvals }));
  assert.equal(line(plan, 'subagents', 'reader', 'claude-code', 'tools').result, 'exact');
  assert.equal(line(plan, 'subagents', 'reader', 'opencode', 'tools').result, 'weakened');
  assert.match(read(p, '.claude/agents/reader.md'), /^---\nname: "reader"\ndescription: "The reader subagent\."\ntools: "Read, Grep, Glob"\nmodel: "sonnet"\n---\n\nAct as reader\.\n$/);
  assert.match(read(p, '.opencode/agents/reader.md'), /permission:\n {2}"edit": "deny"\n/);
  assert.equal(/"(allow|ask)"/.test(read(p, '.opencode/agents/reader.md')), false);
  assert.match(read(p, '.codex/agents/reader.toml'), /^name = "reader"\ndescription = "The reader subagent\."\ndeveloper_instructions = "Act as reader\.\\n\\nTool limit \(advisory; Codex does not enforce it\)/);
  // The override is recorded in the receipt (section 2).
  assert.deepEqual(result.receipt.approvals, approvals);
  assert.deepEqual(plan.approved, approvals);
  // A change to the subagent voids the approval.
  fs.writeFileSync(path.join(p.def, 'agents/reader.md'), reader.replace('Act as reader.', 'Act as a reader.'));
  assert.throws(() => planPortable(p.input({ approvals })), code('PORTABLE_FIDELITY'));
});

test('a subagent file that a person made is never overwritten', t => {
  const p = lockedProject(t, { engines: engines('claude-code'), mcp: null, parts: { mcp: undefined }, agents: { helper: agentFile('helper') } });
  put(p, '.claude/agents/helper.md', 'mine\n');
  assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_PATH_OCCUPIED' && e.message.includes('.claude/agents/helper.md'));
});

// ---- hooks: checks 7, 8, and 12 --------------------------------------------------------------------------------------------

const GUARD = { id: 'guard', event: 'PreToolUse', matcher: 'Bash', command: '${PROJECT_DIR}/scripts/guard.sh', timeout: 5000, strength: 'enforced' };

test('check 7: an enforced hook whose event the engine lacks is refused for that engine', t => {
  const p = lockedProject(t, { engines: engines('claude-code', 'codex'), hooks: [{ ...GUARD, id: 'on-change', event: 'FileChanged', matcher: undefined }] });
  const e = refusal(() => planPortable(p.input()));
  assert.equal(e.code, 'PORTABLE_FIDELITY');
  assert.deepEqual(e.refused.map(l => [l.entry, l.engine, l.result]), [['on-change', 'codex', 'absent']]);
  assert.doesNotThrow(() => planPortable(p.input({ approvals: approveAll(p, e) })));
});

test('check 8: a Codex hook is weakened when enforced and pending trust until the folder is trusted and the hook reviewed by its hash', async t => {
  const p = lockedProject(t, { engines: engines('codex'), hooks: [GUARD] });
  const e = refusal(() => planPortable(p.input()));
  assert.deepEqual(e.refused.map(l => [l.entry, l.engine, l.result]), [['guard', 'codex', 'weakened']]);
  const approvals = approveAll(p, e);
  const plan = planPortable(p.input({ approvals }));
  const hookTrust = x => x.trust.find(l => l.part === 'hooks' && l.entry === 'guard');
  assert.equal(hookTrust(plan).state, 'pending trust');
  await applyPortable(p.input({ approvals }), plan.revision);
  const hooks = JSON.parse(read(p, '.codex/hooks.json'));
  assert.deepEqual(hooks.hooks.PreToolUse, [{ matcher: 'Bash|exec_command', hooks: [{ type: 'command', command: '$(git rev-parse --show-toplevel)/scripts/guard.sh', timeout: 5 }] }]);
  const hash = entryHash(entryOf(p, 'hooks', 'guard'));
  assert.equal(hookTrust(planPortable(p.input({ approvals, codexTrust: { folderTrusted: true, reviewedHooks: [] } }))).state, 'pending trust');
  assert.equal(hookTrust(planPortable(p.input({ approvals, codexTrust: { folderTrusted: false, reviewedHooks: [hash] } }))).state, 'pending trust');
  assert.equal(hookTrust(planPortable(p.input({ approvals, codexTrust: { folderTrusted: true, reviewedHooks: [hash] } }))).state, 'trusted');
  // B17: the trust line of the folder is there, and it is trusted only once the folder is.
  const folderLine = trusted => planPortable(p.input({ approvals, codexTrust: { folderTrusted: trusted, reviewedHooks: [hash] } })).trust.find(l => l.path === '.codex/config.toml');
  assert.equal(folderLine(true).state, 'trusted');
  assert.equal(folderLine(false).state, 'pending trust');
});

test('check 8: a Codex hook review binds the definition entry, private blocks of other engines included', async t => {
  const p = lockedProject(t, { engines: engines('claude-code', 'codex'), mcp: null, parts: { mcp: undefined }, hooks: [{ ...GUARD, strength: 'advisory', 'x-claude-code': { once: true } }] });
  const full = entryHash(entryOf(p, 'hooks', 'guard'));
  const { 'claude-code': _drop, ...others } = entryOf(p, 'hooks', 'guard').privateBlocks;
  const stripped = entryHash({ ...entryOf(p, 'hooks', 'guard'), privateBlocks: others });
  const state = reviewed => planPortable(p.input({ codexTrust: { folderTrusted: true, reviewedHooks: [reviewed] } })).trust.find(l => l.entry === 'guard').state;
  assert.equal(state(full), 'trusted');
  // The Claude Code hook carries its block in its handler, unchanged; the Codex hook does not get it.
  await projectNow(p.input());
  assert.equal(JSON.parse(read(p, '.claude/settings.json')).hooks.PreToolUse[0].hooks[0].once, true);
  assert.equal(JSON.parse(read(p, '.codex/hooks.json')).hooks.PreToolUse[0].hooks[0].once, undefined);
  assert.equal(state(stripped), 'pending trust');
});

test('check 12: a harness that lists pi or deepseek-harness with an enforced guardrail, hook, or subagent tool limit is refused without a recorded override', async t => {
  const reader = agentFile('reader', 'tools:\n  - read\n');
  for (const engine of ['pi', 'deepseek-harness']) {
    const cases = {
      guardrails: { rules: [{ id: 'no-curl', action: 'shell', pattern: 'curl *', effect: 'deny', strength: 'enforced' }] },
      hooks: { hooks: [GUARD] },
      subagents: { agents: { reader } },
    };
    for (const [part, extra] of Object.entries(cases)) {
      const p = lockedProject(t, { engines: engines(engine), mcp: null, parts: { mcp: undefined }, ...extra });
      const e = refusal(() => planPortable(p.input()));
      assert.equal(e.code, 'PORTABLE_FIDELITY', `${engine} ${part}`);
      assert.deepEqual(e.refused.map(l => [l.part, l.engine, l.result]), [[part, engine, 'absent']], `${engine} ${part}`);
      const { plan } = await projectNow(p.input({ approvals: approveAll(p, e) }));
      assert.equal(plan.changes.some(c => c.path.startsWith('.pi/') || c.path.startsWith('.dsh/')), false, 'no hook, rule, or agent file for these engines');
    }
    // An advisory hook is absent with a loss line, and needs no override.
    const advisory = lockedProject(t, { engines: engines(engine), mcp: null, parts: { mcp: undefined }, hooks: [{ ...GUARD, strength: 'advisory' }] });
    assert.equal(line(planPortable(advisory.input()), 'hooks', 'guard', engine).result, 'absent');
  }
});

test('OpenCode hooks: a generated plugin that the plan shows as code; it throws on exit 2 and lets exit 0 through', async t => {
  const p = lockedProject(t, { engines: engines('opencode'), mcp: null, parts: { mcp: undefined }, hooks: [{ ...GUARD, command: 'cat > "${PROJECT_DIR}/seen.json"; echo "no rm here" >&2; exit 2' }, { id: 'ok', event: 'PreToolUse', matcher: 'Read', command: 'exit 0', strength: 'advisory' }] });
  const { plan } = await projectNow(p.input({ approvals: approvalsFor(p) }));
  const review = plan.review.find(r => r.path === '.opencode/plugins/bowerloom-hooks.js');
  assert.equal(review.kind, 'code'); assert.equal(review.engine, 'opencode');
  assert.equal(review.text, read(p, '.opencode/plugins/bowerloom-hooks.js'));
  const copy = path.join(p.base, 'plugin-copy.mjs');
  fs.copyFileSync(path.join(p.dir, '.opencode/plugins/bowerloom-hooks.js'), copy);
  const mod = await import(pathToFileURL(copy).href);
  // The plugin runs commands through the $ shell of the OpenCode plugin context, never through a module of its own.
  assert.equal(/child_process|worker_threads|cluster|require\(|import\(/.test(review.text), false);
  const calls = [];
  const hooks = await mod.BowerloomHooks({ directory: p.dir, worktree: p.dir, $: bunShell(calls) });
  await assert.rejects(hooks['tool.execute.before']({ tool: 'bash', sessionID: 's1' }, { args: { command: 'rm -rf x' } }), /no rm here/);
  const seen = JSON.parse(read(p, 'seen.json'));
  assert.deepEqual([seen.hook_event_name, seen.tool_name, seen.tool_input.command], ['PreToolUse', 'Bash', 'rm -rf x']);
  assert.equal(calls[0].env.BOWERLOOM_PROJECT_DIR, p.dir);
  await hooks['tool.execute.before']({ tool: 'read', sessionID: 's1' }, { args: { filePath: 'a' } });
  await hooks['tool.execute.before']({ tool: 'glob', sessionID: 's1' }, { args: {} });
  assert.equal(calls.length, 2, 'the glob call matches no hook');
  // A deny decision on standard output blocks as exit 2 does.
  const q = lockedProject(t, { engines: engines('opencode'), mcp: null, parts: { mcp: undefined }, hooks: [{ ...GUARD, command: 'echo \'{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"denied by json"}}\'' }] });
  await projectNow(q.input({ approvals: approvalsFor(q) }));
  const copy2 = path.join(q.base, 'plugin-copy.mjs');
  fs.copyFileSync(path.join(q.dir, '.opencode/plugins/bowerloom-hooks.js'), copy2);
  const hooks2 = await (await import(pathToFileURL(copy2).href)).BowerloomHooks({ directory: q.dir, $: bunShell([]) });
  await assert.rejects(hooks2['tool.execute.before']({ tool: 'bash' }, { args: { command: 'x' } }), /denied by json/);
});

/**
 * A stand-in for the Bun shell that OpenCode passes to a plugin as `$`, with the part of its API the plugin uses: a
 * tagged template whose values are quoted as single words, `< ${Response}` for standard input, and `.env()`, `.quiet()`,
 * and `.nothrow()`. The real shell is checked live in step 5.
 */
function bunShell(calls) {
  return (strings, ...values) => {
    assert.deepEqual([...strings], ['/bin/sh -c ', ' < ', '']);
    const [command, response] = values;
    let env = process.env;
    const run = async () => {
      const input = await response.text();
      calls.push({ command, env });
      const r = childProcess.spawnSync('/bin/sh', ['-c', command], { input, env, encoding: 'utf8' });
      return { exitCode: r.status, stdout: Buffer.from(r.stdout), stderr: Buffer.from(r.stderr) };
    };
    const shell = { env: e => { env = e; return shell; }, quiet: () => shell, nothrow: () => shell, then: (a, b) => run().then(a, b) };
    return shell;
  };
}

// ---- guardrails ------------------------------------------------------------------------------------------------------------

const RULES = [
  { id: 'no-push-main', action: 'shell', pattern: 'git push * main', effect: 'deny', strength: 'enforced' },
  { id: 'git-any', action: 'shell', pattern: 'git *', effect: 'allow', strength: 'advisory' },
  { id: 'no-env', action: 'read', pattern: '.env', effect: 'deny', strength: 'enforced' },
];

test('guardrails: Claude Code permissions merge into a settings file a person keeps; their rules stay', async t => {
  const p = lockedProject(t, { engines: engines('claude-code'), mcp: null, parts: { mcp: undefined }, rules: RULES, sandbox: { id: 'box', files: true, network: true } });
  const mine = '{\n  "permissions": {\n    "deny": ["Bash(rm -rf *)"]\n  },\n  "model": "x"\n}\n';
  put(p, '.claude/settings.json', mine);
  await projectNow(p.input({ approvals: approvalsFor(p) }));
  const s = JSON.parse(read(p, '.claude/settings.json'));
  assert.equal(s.permissions.deny[0], 'Bash(rm -rf *)'); assert.ok(s.permissions.deny.includes('Bash(git push * main)'));
  assert.ok(s.permissions.allow.includes('Bash(git *)')); assert.deepEqual(s.sandbox, { enabled: true, allowUnsandboxedCommands: false }); assert.equal(s.model, 'x');
  assert.ok(read(p, '.claude/settings.json').startsWith('{\n  "permissions": {\n    "deny": ["Bash(rm -rf *)"'), 'the person\'s bytes stay in place');
  await removal(p);
  assert.equal(read(p, '.claude/settings.json'), mine);
});

test('guardrails: Codex gets forbidden prefix rules, no allow rule at all, and the bowerloom permission profile (B6)', async t => {
  const p = lockedProject(t, { engines: engines('codex'), mcp: null, parts: { mcp: undefined }, rules: RULES });
  const { plan } = await projectNow(p.input({ approvals: approvalsFor(p) }));
  const rules = read(p, '.codex/rules/bowerloom.rules');
  assert.match(rules, /prefix_rule\(\n {4}pattern = \["git", "push"\],\n {4}decision = "forbidden",/);
  assert.equal(/decision = "allow"/.test(rules), false);
  const config = read(p, '.codex/config.toml');
  assert.match(config, /^default_permissions = "bowerloom"$/m);
  assert.match(config, /^\[permissions\.bowerloom\]\nextends = ":workspace"$/m);
  assert.match(config, /^\[permissions\.bowerloom\.filesystem\.":workspace_roots"\]\n".env" = "deny"$/m);
  assert.equal(line(plan, 'guardrails', 'no-env', 'codex').result, 'weakened', 'g8 covered no glob entry');
  assert.match(line(plan, 'guardrails', 'no-env', 'codex').reason, /Live check g8/);
  assert.deepEqual(plan.trust.filter(x => x.engine === 'codex').map(x => [x.path, x.state]), [['.codex/config.toml', 'pending trust'], ['.codex/rules/bowerloom.rules', 'pending trust']]);
});

test('guardrails: an MCP deny in Codex disables the tool in the managed server entry; a server the projection does not write is weakened', async t => {
  const p = lockedProject(t, { engines: engines('codex'), rules: [{ id: 'no-docs-delete', action: 'mcp', pattern: 'docs/delete', effect: 'deny', strength: 'enforced' }] });
  const { plan } = await projectNow(p.input());
  assert.equal(line(plan, 'guardrails', 'no-docs-delete', 'codex').result, 'translated');
  assert.match(read(p, '.codex/config.toml'), /\[mcp_servers\.docs\]\n(?:.*\n)*?disabled_tools = \["delete"\]\n/);
  const q = lockedProject(t, { engines: engines('codex'), mcp: null, parts: { mcp: undefined }, rules: [{ id: 'no-gh', action: 'mcp', pattern: 'github', effect: 'deny', strength: 'enforced' }] });
  const e = refusal(() => planPortable(q.input()));
  assert.deepEqual(e.refused.map(l => [l.entry, l.result]), [['no-gh', 'weakened']]);
});

test('guardrails: OpenCode writes the 1.x permission object with the ask default first; a permission the person keeps is a conflict', async t => {
  const p = lockedProject(t, { engines: engines('opencode'), mcp: null, parts: { mcp: undefined }, rules: RULES.slice(0, 2) });
  await projectNow(p.input());
  const text = read(p, 'opencode.json');
  assert.deepEqual(Object.keys(JSON.parse(text).permission), ['*', 'bash']);
  assert.ok(text.indexOf('"git *": "allow"') < text.indexOf('"git*push*main": "deny"'), 'allow first, deny last');
  const q = lockedProject(t, { engines: engines('opencode'), mcp: null, parts: { mcp: undefined }, rules: RULES.slice(0, 2) });
  put(q, 'opencode.json', json({ permission: { bash: 'ask' } }));
  assert.throws(() => planPortable(q.input()), e => e.code === 'PORTABLE_CONFLICT' && /permission/.test(e.message));
  const r = lockedProject(t, { engines: engines('opencode'), mcp: null, parts: { mcp: undefined }, rules: [{ id: 'one', action: 'shell', pattern: '1', effect: 'deny', strength: 'enforced' }] });
  assert.throws(() => planPortable(r.input()), code('PORTABLE_ORDER_UNSAFE'));
});

test('guardrails: a DeepSeek Harness sandbox requirement is absent, because the writer has no confirmed mode row and the mode covers files only', t => {
  const p = lockedProject(t, { engines: engines('deepseek-harness'), mcp: null, parts: { mcp: undefined }, sandbox: { id: 'box', files: true, network: true } });
  const e = refusal(() => planPortable(p.input()));
  assert.deepEqual(e.refused.map(l => [l.entry, l.result]), [['box', 'absent']]);
  assert.match(e.refused[0].reason, /network/);
});

// ---- check 10, recovery, and drift -------------------------------------------------------------------------------------------

function fullProject(t) {
  return lockedProject(t, {
    rules: RULES, sandbox: { id: 'box', files: true, network: false }, hooks: [GUARD, { id: 'lint', event: 'PostToolUse', matcher: 'Edit', command: '${PROJECT_DIR}/scripts/lint.sh', strength: 'advisory' }],
    agents: { reader: agentFile('reader', 'tools:\n  - read\n'), helper: agentFile('helper') },
  });
}
const personFiles = {
  '.mcp.json': json({ mcpServers: { mine: { command: 'mine' } } }), '.claude/settings.json': json({ model: 'x' }), '.codex/config.toml': '[mcp_servers.mine]\ncommand = "mine"\n',
  '.codex/hooks.json': json({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] } }), 'opencode.json': json({ theme: 'dark' }), '.pi/mcp.json': json({ mcpServers: {} }),
};

test('check 10: removal restores every original file, and a second projection with no change writes nothing', async t => {
  const p = fullProject(t);
  for (const [rel, text] of Object.entries(personFiles)) put(p, rel, text);
  const before = snapshot(p.dir);
  const approvals = approvalsFor(p);
  const input = p.input({ approvals });
  const { result } = await projectNow(input);
  const after = snapshot(p.dir);
  for (const rel of Object.keys(personFiles)) assert.notEqual(after[rel], before[rel], `${rel} carries the managed entries`);
  const again = planPortable(input);
  assert.equal(again.noop, true);
  const second = await applyPortable(input, again.revision);
  assert.equal(second.noop, true); assert.deepEqual(written(after, snapshot(p.dir)), []);
  assert.ok(result.receipt.files.length > 10);
  await removal(p);
  assert.deepEqual(snapshot(p.dir), before);
});

test('a crash in the middle of the run is recovered from the journal: the merged files go back to the person\'s bytes', async t => {
  const p = fullProject(t);
  for (const [rel, text] of Object.entries(personFiles)) put(p, rel, text);
  const before = snapshot(p.dir);
  const input = p.input({ approvals: approvalsFor(p) });
  const steps = planPortable(input).changes.filter(c => c.action !== 'unchanged').length;
  assert.ok(steps >= 15, `${steps} steps`);
  for (let n = 1; n <= steps; n++) {
    const { crash, hook } = crashAt(n);
    await assert.rejects(applyPortableWith(input, planPortable(input).revision, signal(), { afterStep: hook }), e => e === crash);
    assert.throws(() => planPortable(input), code('PORTABLE_RECOVERY_REQUIRED'));
    const rec = planPortableRecovery(p.input());
    assert.equal(rec.action, 'rollback');
    await applyPortableRecovery(p.input(), rec.revision);
    assert.deepEqual(snapshot(p.dir), before, `after a crash at step ${n}`);
  }
  // A crash after the receipt completes on recovery.
  const { crash, hook } = crashAt(1);
  await assert.rejects(applyPortableWith(input, planPortable(input).revision, signal(), { at: x => { if (x === 'after-receipt') hook(); } }), e => e === crash);
  const rec = planPortableRecovery(p.input());
  assert.equal(rec.action, 'complete');
  await applyPortableRecovery(p.input(), rec.revision);
  assert.equal(planPortable(input).noop, true);
});

test('a crash in the middle of a removal is recovered: the next removal restores every original file', async t => {
  const p = fullProject(t);
  for (const [rel, text] of Object.entries(personFiles)) put(p, rel, text);
  const before = snapshot(p.dir);
  const input = p.input({ approvals: approvalsFor(p) });
  await projectNow(input);
  const projected = snapshot(p.dir);
  const { applyPortableRemovalWith } = await import('../../../dist/packages/project-sync/src/portable-run.js');
  for (const n of [1, 7]) {
    const { crash, hook } = crashAt(n);
    await assert.rejects(applyPortableRemovalWith(p.input(), planPortableRemoval(p.input()).revision, signal(), { afterStep: hook }), e => e === crash);
    const rec = planPortableRecovery(p.input());
    assert.equal(rec.kind, 'remove'); assert.equal(rec.action, 'rollback');
    await applyPortableRecovery(p.input(), rec.revision);
    assert.deepEqual(snapshot(p.dir), projected, `back to the projection after a crash at step ${n}`);
  }
  await removal(p);
  assert.deepEqual(snapshot(p.dir), before);
});

test('B15: the default scan does not read guardrail patterns', t => {
  const p = lockedProject(t, { engines: engines('claude-code'), mcp: null, parts: { mcp: undefined }, rules: [{ id: 'odd', action: 'shell', pattern: 'echo ${X:-y}', effect: 'deny', strength: 'enforced' }] });
  assert.doesNotThrow(() => planPortable(p.input({ approvals: approvalsFor(p) })));
});

test('drift: a person who edits a merged file after projection stops the next plan and the removal', async t => {
  const p = lockedProject(t, { engines: engines('claude-code', 'codex') });
  await projectNow(p.input());
  put(p, '.codex/config.toml', read(p, '.codex/config.toml') + '\n[tui]\nx = 1\n');
  assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_DRIFT' && e.message.includes('.codex/config.toml'));
  assert.throws(() => planPortableRemoval(p.input()), code('PORTABLE_DRIFT'));
});

test('a file the person changes between the plan and the write is never overwritten', async t => {
  const p = lockedProject(t, { engines: engines('claude-code') });
  put(p, '.mcp.json', json({ mcpServers: {} }));
  const plan = planPortable(p.input());
  await assert.rejects(applyPortableWith(p.input(), plan.revision, signal(), {
    beforePlace: rel => { if (rel === '.mcp.json') fs.writeFileSync(path.join(p.dir, '.mcp.json'), json({ mcpServers: { late: { command: 'x' } } })); },
  }), code('PORTABLE_DRIFT'));
  assert.deepEqual(JSON.parse(read(p, '.mcp.json')), { mcpServers: { late: { command: 'x' } } });
});

test('a symlinked .codex folder is refused, never followed', t => {
  const p = lockedProject(t, { engines: engines('codex') });
  fs.mkdirSync(path.join(p.base, 'elsewhere'));
  fs.symlinkSync(path.join(p.base, 'elsewhere'), path.join(p.dir, '.codex'));
  assert.throws(() => planPortable(p.input()), code('PORTABLE_PATH_UNSAFE'));
  assert.deepEqual(fs.readdirSync(path.join(p.base, 'elsewhere')), []);
});

test('the receipt records approvals strictly: a forged approval is refused', async t => {
  const reader = agentFile('reader', 'tools:\n  - read\n');
  const p = lockedProject(t, { engines: engines('codex'), mcp: null, parts: { mcp: undefined }, agents: { reader } });
  const approvals = approvalsFor(p);
  await projectNow(p.input({ approvals }));
  forge(p.stateDir, 'receipt.json', r => { r.approvals[0].extra = 'x'; });
  assert.throws(() => planPortable(p.input({ approvals })), code('PORTABLE_STATE_INVALID'));
  assert.equal(sha('x').length, 64);
});

test('a step 2 receipt (v1beta2) still reads, as a receipt with no approvals; a v1beta2 receipt that holds approvals is refused', async t => {
  const p = lockedProject(t, { engines: engines('claude-code'), mcp: null, parts: { mcp: undefined } });
  await projectNow(p.input());
  forge(p.stateDir, 'receipt.json', r => { r.format = 'bowerloom/portable-projection-receipt/v1beta2'; delete r.approvals; });
  assert.deepEqual(readPortableReceipt(p.input()).approvals, []);
  assert.equal(planPortable(p.input()).noop, true);
  forge(p.stateDir, 'receipt.json', r => { r.approvals = []; });
  assert.throws(() => planPortable(p.input()), code('PORTABLE_STATE_INVALID'));
});
