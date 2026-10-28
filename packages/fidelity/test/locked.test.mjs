// Locked-in parts spec, sections 5 to 7 and 12: the translations of MCP servers, subagents, and hooks. Pure functions:
// each gives the engine form in memory and one loss line or more per entry. Synthetic entries only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_IDS, checkFidelity, entryHash } from '../../../dist/packages/harness-definition/src/index.js';
import {
  CODEX_HOOK_EVENTS, OPENCODE_HOOK_EVENTS, envDefaultIn, translateHooks, translateMcp, translateSubagents,
} from '../../../dist/packages/fidelity/src/index.js';

const server = (name, extra = {}) => ({ id: name, name, transport: 'stdio', command: 'docs-mcp', privateBlocks: {}, ...extra });
const agent = (id, extra = {}) => ({ id, name: id, description: `The ${id} subagent.`, body: `Act as ${id}.\n`, privateBlocks: {}, ...extra });
const hook = (id, extra = {}) => ({ id, event: 'PreToolUse', matcher: 'Bash', command: '${PROJECT_DIR}/scripts/check.sh', strength: 'enforced', privateBlocks: {}, ...extra });
const lines = (t, entry) => t.lines.filter(l => l.entry === entry);
const entryLine = (t, entry) => t.lines.find(l => l.entry === entry && l.field === undefined);
const fieldLine = (t, entry, field) => t.lines.find(l => l.entry === entry && l.field === field);
const NOW = new Date('2026-10-28T12:00:00Z');
const approval = (part, entry, engine, result, extra = {}) => ({
  part, entry: entry.id, engine, result, entryHash: entryHash(entry), who: 'Test Person', when: '2026-10-28T10:00:00Z', reason: 'Synthetic test approval.', ...extra,
});
const judge = (entries, report, approvals = []) => checkFidelity({ entries: { skills: [], subagents: [], rules: [], sandbox: [], hooks: [], mcp: [], ...entries }, engines: [...ENGINE_IDS] }, report, approvals, { now: NOW });

// ---- check 5: a default such as ${NAME:-x} is never copied ------------------------------------------------------------------

test('check 5: envDefaultIn finds every shell default form and nothing else', () => {
  for (const text of ['${HOME:-/tmp}', 'a ${X-y} b', '${X:=1}', '${X:?gone}', '${X:+set}', '--dir=${PROJECT_DIR:-.}']) assert.equal(envDefaultIn(text), true, text);
  for (const text of ['${HOME}', '$HOME', 'plain', '${A}${B}', 'cost: $5', '{env:X}']) assert.equal(envDefaultIn(text), false, text);
});

test('check 5: an MCP server, a hook, or a subagent that holds ${NAME:-x} gives a problem and no form, in every engine', () => {
  for (const engine of ENGINE_IDS) {
    const m = translateMcp(engine, [server('docs', { args: ['--root', '${ROOT:-.}'] })]);
    assert.deepEqual(m.problems, [{ part: 'mcp', entry: 'docs', code: 'ENV_DEFAULT' }], engine);
    assert.equal(m.servers.length, 0, engine);
    const h = translateHooks(engine, [hook('guard', { command: 'run ${MODE:-strict}' })]);
    assert.deepEqual(h.problems, [{ part: 'hooks', entry: 'guard', code: 'ENV_DEFAULT' }], engine);
    assert.equal(h.hooks.length, 0, engine);
    const s = translateSubagents(engine, [agent('helper', { body: 'Use ${DIR:-.} as the root.\n' })]);
    assert.deepEqual(s.problems, [{ part: 'subagents', entry: 'helper', code: 'ENV_DEFAULT' }], engine);
    assert.equal(s.subagents.length, 0, engine);
  }
});

// ---- MCP servers (section 5) -----------------------------------------------------------------------------------------------

test('MCP in Claude Code and Pi: the .mcp.json shape, ${NAME} kept, and exact', () => {
  const docs = server('docs', { args: ['--port', '7'], env: { TOKEN: '${TOKEN}', MODE: 'read' }, timeout: 30000 });
  const web = server('web', { transport: 'http', command: undefined, url: 'https://mcp.example.test/mcp', headers: { Authorization: 'Bearer ${WEB_TOKEN}' } });
  for (const engine of ['claude-code', 'pi']) {
    const t = translateMcp(engine, [docs, web]);
    const byName = Object.fromEntries(t.servers.map(s => [s.name, s.value]));
    assert.deepEqual(byName.docs.type, 'stdio');
    assert.equal(byName.docs.command, 'docs-mcp'); assert.deepEqual(byName.docs.args, ['--port', '7']);
    assert.deepEqual(byName.docs.env, { TOKEN: '${TOKEN}', MODE: 'read' });
    assert.deepEqual(byName.web, { type: 'http', url: 'https://mcp.example.test/mcp', headers: { Authorization: 'Bearer ${WEB_TOKEN}' } });
    assert.equal(entryLine(t, 'web').result, 'exact', engine);
  }
  assert.equal(entryLine(translateMcp('claude-code', [docs]), 'docs').result, 'exact');
  assert.equal(translateMcp('claude-code', [docs]).servers[0].value.timeout, 30000);
  // Pi documents no timeout field: the field is reported, never dropped silently.
  const pi = translateMcp('pi', [docs]);
  assert.equal(pi.servers[0].value.timeout, undefined);
  assert.equal(fieldLine(pi, 'docs', 'timeout').result, 'absent');
});

test('MCP in Codex: TOML table, timeout in seconds, env split into env and env_vars, bearer token, sse absent', () => {
  const t = translateMcp('codex', [
    server('docs', { args: ['-y'], env: { GITHUB_TOKEN: '${GITHUB_TOKEN}', MODE: 'read' }, timeout: 1500, enabled: false }),
    server('web', { transport: 'http', command: undefined, url: 'https://mcp.example.test/mcp', headers: { Authorization: 'Bearer ${WEB_TOKEN}', 'X-Team': '${TEAM}', 'X-Plain': 'yes' } }),
    server('old', { transport: 'sse', command: undefined, url: 'https://mcp.example.test/sse' }),
  ]);
  const docs = Object.fromEntries(t.servers.find(s => s.name === 'docs').table);
  assert.equal(docs.command, 'docs-mcp'); assert.deepEqual(docs.args, ['-y']);
  assert.deepEqual(docs.env, { MODE: 'read' }); assert.deepEqual(docs.env_vars, ['GITHUB_TOKEN']);
  assert.equal(docs.tool_timeout_sec, 1.5); assert.equal(docs.enabled, false);
  assert.equal(entryLine(t, 'docs').result, 'translated'); assert.match(entryLine(t, 'docs').reason, /seconds/);
  const web = Object.fromEntries(t.servers.find(s => s.name === 'web').table);
  assert.equal(web.url, 'https://mcp.example.test/mcp'); assert.equal(web.bearer_token_env_var, 'WEB_TOKEN');
  assert.deepEqual(web.env_http_headers, { 'X-Team': 'TEAM' }); assert.deepEqual(web.http_headers, { 'X-Plain': 'yes' });
  assert.equal(t.servers.some(s => s.name === 'old'), false);
  assert.equal(entryLine(t, 'old').result, 'absent');
  // A value Codex cannot express: Codex has no expansion, so the server is not written, and the line says why.
  const odd = translateMcp('codex', [server('odd', { env: { A: 'x-${B}' } }), server('arg', { args: ['${HOME}/x'] })]);
  assert.equal(odd.servers.length, 0);
  assert.equal(entryLine(odd, 'odd').result, 'absent'); assert.match(entryLine(odd, 'odd').reason, /expansion/);
  assert.equal(entryLine(odd, 'arg').result, 'absent');
});

test('MCP in OpenCode: command as one array, {env:NAME}, local and remote types, sse absent', () => {
  const t = translateMcp('opencode', [
    server('docs', { args: ['--port', '7'], env: { TOKEN: '${TOKEN}', URL: 'https://x/${PATH_PART}' }, timeout: 30000, enabled: false }),
    server('web', { transport: 'http', command: undefined, url: 'https://mcp.example.test/mcp', headers: { Authorization: 'Bearer ${WEB_TOKEN}' } }),
    server('old', { transport: 'ws', command: undefined, url: 'wss://mcp.example.test/ws' }),
  ]);
  const by = Object.fromEntries(t.servers.map(s => [s.name, s.value]));
  assert.deepEqual(by.docs, { type: 'local', command: ['docs-mcp', '--port', '7'], environment: { TOKEN: '{env:TOKEN}', URL: 'https://x/{env:PATH_PART}' }, enabled: false, timeout: 30000 });
  assert.deepEqual(by.web, { type: 'remote', url: 'https://mcp.example.test/mcp', headers: { Authorization: 'Bearer {env:WEB_TOKEN}' } });
  assert.equal(entryLine(t, 'old').result, 'absent');
  assert.equal(entryLine(t, 'docs').result, 'translated');
  // OpenCode substitutes {env:...} anywhere in its file, so a literal one would change meaning.
  const lit = translateMcp('opencode', [server('lit', { args: ['{env:SECRET}'] })]);
  assert.equal(lit.servers.length, 0); assert.equal(entryLine(lit, 'lit').result, 'absent');
});

test('MCP in DeepSeek Harness: one dsh-mcp-client row per server, !!js for a reference, streamable-http, a name over 32 absent', () => {
  const t = translateMcp('deepseek-harness', [
    server('docs', { args: ['-y'], env: { TOKEN: '${TOKEN}', MODE: 'read', MIXED: 'a-${B}' }, timeout: 30000 }),
    server('web', { transport: 'http', command: undefined, url: 'https://mcp.example.test/mcp', headers: { Authorization: 'Bearer ${WEB_TOKEN}' } }),
    server('a'.repeat(33)), server('old', { transport: 'sse', command: undefined, url: 'https://mcp.example.test/sse' }),
  ]);
  const docs = t.servers.find(s => s.name === 'docs').row;
  assert.equal(docs.name, '@deepseek-ai/dsh-mcp-client'); assert.equal(docs.id, 'bowerloom-mcp-docs');
  assert.deepEqual(docs.config.env, { TOKEN: { js: 'process.env.TOKEN' }, MODE: 'read', MIXED: { js: '`a-${process.env.B}`' } });
  assert.equal(docs.config.transport, 'stdio'); assert.equal(docs.config.toolCallTimeoutMs, 30000);
  const web = t.servers.find(s => s.name === 'web').row.config;
  assert.equal(web.transport, 'streamable-http'); assert.deepEqual(web.headers, { Authorization: { js: '`Bearer ${process.env.WEB_TOKEN}`' } });
  assert.equal(entryLine(t, 'a'.repeat(33)).result, 'absent'); assert.equal(entryLine(t, 'old').result, 'absent');
  assert.match(entryLine(t, 'docs').reason, /--patch/);
  // A literal part that holds a backtick, a backslash, or a $ is escaped for the template literal.
  const esc = translateMcp('deepseek-harness', [server('esc', { env: { A: '`x\\$${B}' } })]);
  assert.deepEqual(esc.servers[0].row.config.env.A, { js: '`\\`x\\\\\\$${process.env.B}`' });
});

test('MCP: a keychain reference is never written; a disabled server is reported, not dropped silently', () => {
  for (const engine of ENGINE_IDS) {
    const t = translateMcp(engine, [server('vault', { env: { TOKEN: { keychain: 'vault-token' } } })]);
    assert.equal(t.servers.length, 0, engine);
    assert.equal(entryLine(t, 'vault').result, 'absent', engine); assert.match(entryLine(t, 'vault').reason, /keychain/, engine);
  }
  for (const engine of ['claude-code', 'pi', 'deepseek-harness']) {
    const t = translateMcp(engine, [server('off', { enabled: false })]);
    assert.equal(t.servers.length, 0, engine);
    assert.equal(entryLine(t, 'off').result, 'translated', engine); assert.match(entryLine(t, 'off').reason, /disabled/, engine);
  }
  // An engine-private block goes into the server's own entry, unchanged; a key Bowerloom writes is not overwritten.
  const t = translateMcp('claude-code', [server('docs', { privateBlocks: { 'claude-code': { alwaysLoad: true, command: 'evil' } } })]);
  assert.equal(t.servers[0].value.alwaysLoad, true); assert.equal(t.servers[0].value.command, 'docs-mcp');
  assert.equal(fieldLine(t, 'docs', 'x-claude-code').result, 'absent');
});

// ---- subagents (section 6; check 3) ------------------------------------------------------------------------------------------

const readOnly = agent('reader', { tools: ['read', 'search'], model: { 'claude-code': 'sonnet', opencode: 'provider/model-a' }, skills: ['review'] });

test('check 3: a read-only subagent is exact in Claude Code', () => {
  const t = translateSubagents('claude-code', [readOnly]);
  const f = Object.fromEntries(t.subagents[0].frontmatter);
  assert.equal(f.name, 'reader'); assert.equal(f.tools, 'Read, Grep, Glob'); assert.equal(f.model, 'sonnet'); assert.deepEqual(f.skills, ['review']);
  assert.equal(t.subagents[0].body, 'Act as reader.\n');
  assert.equal(entryLine(t, 'reader').result, 'exact'); assert.equal(fieldLine(t, 'reader', 'tools').result, 'exact');
});

test('check 3: a read-only subagent is translated with deny keys in OpenCode, and no key allows anything', () => {
  const t = translateSubagents('opencode', [readOnly]);
  const f = Object.fromEntries(t.subagents[0].frontmatter);
  assert.equal(f.mode, 'subagent'); assert.equal(f.model, 'provider/model-a'); assert.equal(f.name, undefined);
  const permission = Object.fromEntries(f.permission);
  for (const key of ['edit', 'bash', 'webfetch', 'websearch', 'task', 'skill', '*_*']) assert.equal(permission[key], 'deny', key);
  for (const key of ['read', 'grep', 'glob', 'list']) assert.equal(permission[key], undefined, key);
  assert.equal(Object.values(permission).includes('allow'), false);
  assert.equal(fieldLine(t, 'reader', 'tools').result, 'translated');
  assert.equal(fieldLine(t, 'reader', 'skills').result, 'translated');
  // A server the limit names keeps its tools; the other servers of the definition are denied by name.
  const mcp = translateSubagents('opencode', [agent('mcp-user', { tools: ['read', 'mcp:docs'] })], { servers: ['docs', 'web'] });
  const p2 = Object.fromEntries(Object.fromEntries(mcp.subagents[0].frontmatter).permission);
  assert.equal(p2.web_ ?? p2['web_*'], 'deny'); assert.equal(p2['docs_*'], undefined); assert.equal(p2['*_*'], undefined);
  assert.equal(fieldLine(mcp, 'mcp-user', 'tools').result, 'weakened');
});

test('check 3: a read-only subagent in Codex is weakened, so it is refused without an override; the override adds advisory text', () => {
  const t = translateSubagents('codex', [readOnly]);
  const table = Object.fromEntries(t.subagents[0].table);
  assert.equal(table.name, 'reader'); assert.equal(table.model, undefined, 'no model named for codex');
  assert.match(table.developer_instructions, /^Act as reader\.\n/);
  assert.match(table.developer_instructions, /advisory/i);
  assert.equal(fieldLine(t, 'reader', 'tools').result, 'weakened');
  assert.equal(fieldLine(t, 'reader', 'model').result, 'absent');
  const report = ENGINE_IDS.flatMap(e => translateSubagents(e, [readOnly]).lines);
  const refused = judge({ subagents: [readOnly] }, report);
  assert.deepEqual(refused.refused.map(l => [l.engine, l.field ?? null, l.result]).sort(), [['codex', 'tools', 'weakened'], ['deepseek-harness', null, 'absent'], ['pi', null, 'absent']]);
  const ok = judge({ subagents: [readOnly] }, report, [
    approval('subagents', readOnly, 'codex', 'weakened', { field: 'tools' }), approval('subagents', readOnly, 'pi', 'absent'), approval('subagents', readOnly, 'deepseek-harness', 'absent'),
  ]);
  assert.equal(ok.ok, true);
});

test('subagents: Pi and DeepSeek Harness have none in core, so a subagent with no tool limit is absent and advisory', () => {
  const plain = agent('helper');
  for (const engine of ['pi', 'deepseek-harness']) {
    const t = translateSubagents(engine, [plain]);
    assert.equal(t.subagents.length, 0); assert.equal(entryLine(t, 'helper').result, 'absent');
  }
  const report = ENGINE_IDS.flatMap(e => translateSubagents(e, [plain]).lines);
  assert.equal(judge({ subagents: [plain] }, report).ok, true);
});

test('subagents: every tool class outside the limit is denied in OpenCode, for every limit (property)', () => {
  const classes = ['read', 'search', 'edit', 'write', 'shell', 'web', 'task', 'skill'];
  const keysOf = { read: ['read'], search: ['grep', 'glob', 'list'], edit: ['edit'], write: ['edit'], shell: ['bash'], web: ['webfetch', 'websearch'], task: ['task'], skill: ['skill'] };
  for (let mask = 0; mask < 1 << classes.length; mask++) {
    const tools = classes.filter((_, i) => mask & (1 << i));
    const t = translateSubagents('opencode', [agent('x', { tools })]);
    const permission = Object.fromEntries(Object.fromEntries(t.subagents[0].frontmatter).permission);
    for (const c of classes.filter(c => !tools.includes(c))) for (const key of keysOf[c]) assert.equal(permission[key], 'deny', `${tools} ${key}`);
    assert.equal(Object.values(permission).some(v => v !== 'deny'), false);
  }
});

// ---- hooks (section 7; checks 7, 8, 12) ----------------------------------------------------------------------------------------

test('hooks in Claude Code: exact, timeout in seconds, ${PROJECT_DIR} rewritten', () => {
  const t = translateHooks('claude-code', [hook('guard', { timeout: 30000 }), hook('late', { event: 'FileChanged', matcher: undefined, strength: 'advisory' })]);
  const g = t.hooks.find(h => h.entry === 'guard');
  assert.equal(g.event, 'PreToolUse'); assert.equal(g.matcher, 'Bash');
  assert.deepEqual(g.handler, { type: 'command', command: '${CLAUDE_PROJECT_DIR}/scripts/check.sh', timeout: 30 });
  assert.equal(entryLine(t, 'guard').result, 'exact');
  assert.equal(entryLine(t, 'late').result, 'exact', 'FileChanged is a Claude Code event');
});

test('check 8: a Codex hook is translated when advisory and weakened when enforced; the matcher uses Codex names', () => {
  const t = translateHooks('codex', [hook('guard'), hook('lint', { event: 'PostToolUse', matcher: 'Edit|Write', strength: 'advisory' })]);
  const g = t.hooks.find(h => h.entry === 'guard');
  assert.equal(g.matcher, 'Bash|exec_command');
  assert.equal(g.handler.command, '$(git rev-parse --show-toplevel)/scripts/check.sh');
  assert.equal(entryLine(t, 'guard').result, 'weakened'); assert.match(entryLine(t, 'guard').reason, /not a complete boundary/);
  assert.equal(t.hooks.find(h => h.entry === 'lint').matcher, 'apply_patch');
  assert.equal(entryLine(t, 'lint').result, 'translated');
  assert.deepEqual([...CODEX_HOOK_EVENTS].sort(), ['Interrupt', 'PermissionRequest', 'PostCompact', 'PostToolUse', 'PreCompact', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit']);
});

test('check 7: an enforced hook whose event the engine lacks is absent and refused for that engine; an approval lets it through', () => {
  const changed = hook('on-change', { event: 'FileChanged', matcher: undefined });
  const prompt = hook('on-prompt', { event: 'UserPromptSubmit', matcher: undefined });
  const report = ENGINE_IDS.flatMap(e => translateHooks(e, [changed, prompt]).lines);
  const verdict = judge({ hooks: [changed, prompt] }, report);
  const refused = verdict.refused.map(l => `${l.entry} ${l.engine} ${l.result}`).sort();
  assert.deepEqual(refused, [
    'on-change codex absent', 'on-change deepseek-harness absent', 'on-change opencode absent', 'on-change pi absent',
    'on-prompt codex weakened', 'on-prompt deepseek-harness absent', 'on-prompt opencode absent', 'on-prompt pi absent',
  ]);
  assert.equal(translateHooks('codex', [changed]).hooks.length, 0, 'nothing is written for an absent event');
  const approvals = verdict.refused.map(l => approval('hooks', l.entry === 'on-change' ? changed : prompt, l.engine, l.result));
  assert.equal(judge({ hooks: [changed, prompt] }, report, approvals).ok, true);
  // An approval of another entry, or of the entry before a change, does not match.
  const edited = { ...changed, command: 'other' };
  assert.equal(judge({ hooks: [edited, prompt] }, ENGINE_IDS.flatMap(e => translateHooks(e, [edited, prompt]).lines), approvals).ok, false);
});

test('check 12: Pi and DeepSeek Harness write no hook files; an enforced hook is refused without an approval, an advisory one is absent', () => {
  for (const engine of ['pi', 'deepseek-harness']) {
    const enforced = hook('guard'), advisory = hook('note', { strength: 'advisory' });
    const t = translateHooks(engine, [enforced, advisory]);
    assert.equal(t.hooks.length, 0);
    assert.deepEqual(t.lines.map(l => [l.entry, l.result]), [['guard', 'absent'], ['note', 'absent']]);
    const report = ENGINE_IDS.flatMap(e => translateHooks(e, [enforced, advisory]).lines);
    const verdict = judge({ hooks: [enforced, advisory] }, report);
    assert.ok(verdict.refused.some(l => l.entry === 'guard' && l.engine === engine));
    assert.equal(verdict.refused.some(l => l.entry === 'note'), false);
  }
});

test('hooks in OpenCode: tool hooks map to the plugin events, with OpenCode tool names; events with no counterpart are absent', () => {
  assert.deepEqual(OPENCODE_HOOK_EVENTS, { PreToolUse: 'tool.execute.before', PostToolUse: 'tool.execute.after', SessionStart: 'session.created', PreCompact: 'experimental.session.compacting', PostCompact: 'session.compacted' });
  const t = translateHooks('opencode', [hook('guard', { matcher: 'Bash|Edit|mcp__docs__search' }), hook('stop', { event: 'Stop', matcher: undefined, strength: 'advisory' })]);
  const g = t.hooks.find(h => h.entry === 'guard');
  assert.equal(g.hook, 'tool.execute.before'); assert.deepEqual(g.tools, { bash: 'Bash', edit: 'Edit', docs_search: 'mcp__docs__search' });
  assert.equal(g.command, '${BOWERLOOM_PROJECT_DIR}/scripts/check.sh'); assert.equal(g.timeoutMs, 600000);
  assert.equal(entryLine(t, 'guard').result, 'translated');
  assert.equal(entryLine(t, 'stop').result, 'absent');
});

test('section 8.4 rule 2: a matcher outside letters, digits, _, and | is absent everywhere; a Codex name with no counterpart is reported', () => {
  for (const engine of ENGINE_IDS) {
    const t = translateHooks(engine, [hook('regex', { matcher: 'Edit.*' }), hook('dash', { matcher: 'mcp__a-b__x' })]);
    assert.equal(t.hooks.length, 0, engine);
    for (const id of ['regex', 'dash']) assert.equal(entryLine(t, id).result, 'absent', `${engine} ${id}`);
  }
  const read = translateHooks('codex', [hook('reads', { matcher: 'Read', strength: 'advisory' })]);
  assert.equal(read.hooks.length, 0); assert.equal(entryLine(read, 'reads').result, 'absent'); assert.match(entryLine(read, 'reads').reason, /Read/);
  const some = translateHooks('codex', [hook('some', { matcher: 'Bash|Read', strength: 'advisory' })]);
  assert.equal(some.hooks[0].matcher, 'Bash|exec_command'); assert.equal(entryLine(some, 'some').result, 'weakened');
});

test('every translation gives a line for every entry in every engine (no silent drop)', () => {
  const servers = [server('docs'), server('off', { enabled: false }), server('old', { transport: 'sse', command: undefined, url: 'https://x.test/sse' })];
  const agents = [readOnly, agent('helper')];
  const hooks = [hook('guard'), hook('late', { event: 'FileChanged', matcher: undefined, strength: 'advisory' })];
  for (const engine of ENGINE_IDS) {
    for (const s of servers) assert.ok(entryLine(translateMcp(engine, servers), s.id), `${engine} ${s.id}`);
    for (const a of agents) assert.ok(entryLine(translateSubagents(engine, agents), a.id), `${engine} ${a.id}`);
    for (const h of hooks) assert.ok(entryLine(translateHooks(engine, hooks), h.id), `${engine} ${h.id}`);
    for (const t of [translateMcp(engine, servers), translateSubagents(engine, agents), translateHooks(engine, hooks)]) {
      for (const l of t.lines) { assert.equal(l.engine, engine); if (l.result !== 'exact') assert.notEqual(l.reason.trim(), ''); }
    }
  }
  assert.equal(lines(translateMcp('codex', servers), 'docs').length >= 1, true);
});
