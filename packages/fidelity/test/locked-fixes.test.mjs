// Fix round of the step 3 translations: rulings B2, B3, B4, B8, B9, B13, B14, B15, B16, B17, and B19 of the step 3
// lane B review. Synthetic entries only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_IDS } from '../../../dist/packages/harness-definition/src/index.js';
import {
  JsExpression, PermissionPairs, translateGuardrails, translateHooks, translateMcp, translateSubagents,
} from '../../../dist/packages/fidelity/src/index.js';

const server = (name, extra = {}) => ({ id: name, name, transport: 'stdio', command: 'docs-mcp', privateBlocks: {}, ...extra });
const web = (name, extra = {}) => ({ id: name, name, transport: 'http', url: 'https://mcp.example.test/mcp', privateBlocks: {}, ...extra });
const agent = (id, extra = {}) => ({ id, name: id, description: `The ${id} subagent.`, body: `Act as ${id}.\n`, privateBlocks: {}, ...extra });
const hook = (id, extra = {}) => ({ id, event: 'PreToolUse', matcher: 'Bash', command: 'check', strength: 'enforced', privateBlocks: {}, ...extra });
const entryLine = (t, entry) => t.lines.find(l => l.entry === entry && l.field === undefined);
const fieldLine = (t, entry, field) => t.lines.find(l => l.entry === entry && l.field === field);

// ---- B2: only a marked expression is JavaScript ----------------------------------------------------------------------------

test('B2: a DeepSeek Harness expression is a JsExpression instance; plain data shaped like one stays data', () => {
  const t = translateMcp('deepseek-harness', [server('docs', { env: { js: 'plain', TOKEN: '${TOKEN}' } })]);
  const env = t.servers[0].row.config.env;
  assert.equal(env.js, 'plain', 'an env named js is a plain value');
  assert.ok(env.TOKEN instanceof JsExpression); assert.equal(env.TOKEN.js, 'process.env.TOKEN');
  // A private block that holds an object shaped like an expression is refused, never evaluated.
  const forged = translateMcp('deepseek-harness', [server('docs', { privateBlocks: { 'deepseek-harness': { reconnect: { js: 'process.exit(1)' } } } })]);
  assert.deepEqual(forged.problems, [{ part: 'mcp', entry: 'docs', code: 'PRIVATE_JS' }]);
  assert.equal(forged.servers.length, 0);
});

// ---- B3: an empty tool limit writes no Claude Code subagent ----------------------------------------------------------------

test('B3: an empty tool limit writes no Claude Code subagent file, and the line says so', () => {
  const t = translateSubagents('claude-code', [agent('none', { tools: [] })]);
  assert.equal(t.subagents.length, 0);
  assert.equal(fieldLine(t, 'none', 'tools').result, 'absent');
  assert.equal(entryLine(t, 'none').result, 'absent'); assert.match(entryLine(t, 'none').reason, /not written/);
});

// ---- B4: no {env: or {file: reaches opencode.json --------------------------------------------------------------------------

test('B4: an OpenCode MCP value or private block with {env: or {file: is refused', () => {
  for (const s of [server('a', { args: ['{env:X}'] }), server('b', { privateBlocks: { opencode: { oauth: { clientId: '{file:/etc/x}' } } } }), web('c', { headers: { A: 'x{env:Y}' } })]) {
    const t = translateMcp('opencode', [s]);
    assert.deepEqual(t.problems, [{ part: 'mcp', entry: s.id, code: 'OPENCODE_SUBSTITUTION' }], s.id);
    assert.equal(t.servers.length, 0);
  }
});

// ---- B8, B19: OpenCode hooks ------------------------------------------------------------------------------------------------

test('B8: an enforced OpenCode hook is weakened with its reasons; an advisory one stays translated; apply_patch is mapped', () => {
  const t = translateHooks('opencode', [hook('guard', { matcher: 'Edit|Write' }), hook('note', { strength: 'advisory' })]);
  const g = entryLine(t, 'guard');
  assert.equal(g.result, 'weakened');
  for (const why of [/timeout/, /exit code/i, /tool/, /subagent/]) assert.match(g.reason, why);
  assert.equal(entryLine(t, 'note').result, 'translated');
  assert.deepEqual(t.hooks.find(h => h.entry === 'guard').tools, { edit: 'Edit', write: 'Write', apply_patch: 'Write' });
  // B19: the input shapes the plugin reads are unverified until step 5.
  for (const l of t.lines) assert.match(l.reason, /step 5/);
});

// ---- B9: the OpenCode subagent deny list -----------------------------------------------------------------------------------

test('B9: the OpenCode subagent limit denies every listed tool key the source does not allow, and is weakened', () => {
  const t = translateSubagents('opencode', [agent('reader', { tools: ['read', 'search'] })]);
  const permission = Object.fromEntries(Object.fromEntries(t.subagents[0].frontmatter).permission.pairs);
  for (const key of ['edit', 'bash', 'webfetch', 'websearch', 'task', 'skill', 'codesearch', 'lsp', 'todowrite', 'todoread', '*_*']) assert.equal(permission[key], 'deny', key);
  for (const key of ['read', 'grep', 'glob', 'list']) assert.equal(permission[key], undefined, key);
  assert.equal(fieldLine(t, 'reader', 'tools').result, 'weakened'); assert.match(fieldLine(t, 'reader', 'tools').reason, /later/);
  // With every class allowed, the tools that no class names are still denied.
  const all = translateSubagents('opencode', [agent('all', { tools: ['read', 'search', 'edit', 'write', 'shell', 'web', 'task', 'skill'] })]);
  assert.deepEqual(Object.fromEntries(all.subagents[0].frontmatter).permission.pairs.map(([k]) => k), ['codesearch', 'lsp', 'todowrite', 'todoread', '*_*']);
});

// ---- B13: the DeepSeek Harness sandbox ---------------------------------------------------------------------------------------

test('B13: a DeepSeek Harness sandbox requirement is absent in the fidelity translation itself', () => {
  const t = translateGuardrails('deepseek-harness', { rules: [], sandbox: [{ id: 'box', strength: 'enforced', files: true, network: true, privateBlocks: {} }] });
  assert.equal(t.lines[0].result, 'absent'); assert.match(t.lines[0].reason, /network/);
  assert.equal(t.form.sandbox, undefined);
  assert.deepEqual(t.written, []);
});

// ---- B14: fields that do not fit the transport -------------------------------------------------------------------------------

test('B14: env on an HTTP server and headers on a stdio server are never written; each gets a field line', () => {
  const both = [server('local', { env: { A: 'a' }, headers: { H: 'h' } }), web('remote', { env: { A: 'a' }, headers: { H: 'h' } })];
  const keysOf = (engine, f) => engine === 'codex' ? f.table.map(([k]) => k) : engine === 'deepseek-harness' ? Object.keys(f.row.config) : Object.keys(f.value);
  const bad = { 'claude-code': ['headers', 'env'], pi: ['headers', 'env'], codex: [['http_headers', 'env_http_headers', 'bearer_token_env_var'], ['env', 'env_vars']], opencode: ['headers', 'environment'], 'deepseek-harness': ['headers', 'env'] };
  for (const engine of ENGINE_IDS) {
    const t = translateMcp(engine, both);
    const local = t.servers.find(s => s.name === 'local'), remote = t.servers.find(s => s.name === 'remote');
    const [noLocal, noRemote] = bad[engine].map(x => [x].flat());
    for (const k of noLocal) assert.equal(keysOf(engine, local).includes(k), false, `${engine} local ${k}`);
    for (const k of noRemote) assert.equal(keysOf(engine, remote).includes(k), false, `${engine} remote ${k}`);
    assert.equal(fieldLine(t, 'local', 'headers').result, 'absent', engine);
    assert.equal(fieldLine(t, 'remote', 'env').result, 'absent', engine);
  }
});

// ---- B15: the ${NAME:-x} scan --------------------------------------------------------------------------------------------------

test('B15: the default scan reads MCP env, headers, command, args, and url, and hook commands; subagent prose is written', () => {
  const s = translateSubagents('claude-code', [agent('helper', { description: 'Use ${DIR:-.}.', body: 'Run ${X:-y} first.\n' })]);
  assert.deepEqual(s.problems, []); assert.equal(s.subagents.length, 1);
  for (const extra of [{ command: 'x${A:-b}' }, { url: undefined, env: { A: '${B:-c}' } }]) assert.equal(translateMcp('claude-code', [server('a', extra)]).problems.length, 1, JSON.stringify(extra));
  assert.equal(translateMcp('claude-code', [web('w', { url: 'https://x.test/${P:-q}' })]).problems.length, 1);
  assert.equal(translateMcp('claude-code', [web('w', { headers: { H: '${P:-q}' } })]).problems.length, 1);
  assert.equal(translateMcp('claude-code', [server('a', { args: ['${P:-q}'] })]).problems.length, 1);
  assert.equal(translateHooks('claude-code', [hook('h', { command: 'run ${M:-s}' })]).problems.length, 1);
});

// ---- B16: the permission marker ----------------------------------------------------------------------------------------------

test('B16: the OpenCode permission is a PermissionPairs marker, not a list that looks like pairs', () => {
  const t = translateSubagents('opencode', [agent('x', { tools: ['read'], privateBlocks: { opencode: { tags: [['a', 'b']] } } })]);
  const front = Object.fromEntries(t.subagents[0].frontmatter);
  assert.ok(front.permission instanceof PermissionPairs);
  assert.deepEqual(front.tags, [['a', 'b']], 'a private value stays plain data');
});

// ---- B17: surviving mutants ----------------------------------------------------------------------------------------------------

test('B17: Claude Code has no Interrupt event, so such a hook is absent there', () => {
  const t = translateHooks('claude-code', [hook('stop', { event: 'Interrupt', matcher: undefined, strength: 'advisory' })]);
  assert.equal(t.hooks.length, 0); assert.equal(entryLine(t, 'stop').result, 'absent');
});

test('B17: a timeout that is not whole seconds is rounded up and reported; a whole one is exact', () => {
  for (const engine of ['claude-code', 'codex']) {
    const t = translateHooks(engine, [hook('a', { timeout: 1500, strength: 'advisory' }), hook('b', { timeout: 2000, strength: 'advisory' })]);
    assert.equal(t.hooks[0].handler.timeout, 2); assert.equal(t.hooks[1].handler.timeout, 2);
    assert.match(entryLine(t, 'a').reason, /rounded up to 2 seconds/);
    assert.doesNotMatch(entryLine(t, 'b').reason, /rounded/);
  }
  assert.equal(entryLine(translateHooks('claude-code', [hook('a', { timeout: 1500 })]), 'a').result, 'translated');
});

test('B17: a hook private block: kept keys go into the handler, taken keys are named, and no block gives no note', () => {
  const t = translateHooks('claude-code', [hook('a', { privateBlocks: { 'claude-code': { once: true, command: 'evil' } } }), hook('b')]);
  assert.equal(t.hooks[0].handler.once, true); assert.equal(t.hooks[0].handler.command, 'check');
  assert.match(entryLine(t, 'a').reason, /not written: command/);
  assert.equal(entryLine(t, 'b').result, 'exact'); assert.doesNotMatch(entryLine(t, 'b').reason, /x-claude-code/);
  const oc = translateHooks('opencode', [hook('a', { privateBlocks: { opencode: { x: 1 } } })]);
  assert.match(entryLine(oc, 'a').reason, /no place/);
});

test('B17: OpenCode with no tool name for the matcher is absent; a partial matcher names the gap', () => {
  assert.equal(entryLine(translateHooks('opencode', [hook('a', { matcher: 'NotebookEdit' })]), 'a').result, 'absent');
  const some = translateHooks('opencode', [hook('a', { matcher: 'Bash|NotebookEdit', strength: 'advisory' })]);
  assert.equal(entryLine(some, 'a').result, 'weakened'); assert.match(entryLine(some, 'a').reason, /no tool name for NotebookEdit/);
  assert.equal(entryLine(translateHooks('codex', [hook('a', { matcher: 'Read|Grep', strength: 'advisory' })]), 'a').result, 'absent');
  assert.match(entryLine(translateHooks('codex', [hook('a', { matcher: 'Bash|Read', strength: 'advisory' })]), 'a').reason, /no hook tool name for Read/);
});

test('B17: Codex references: a reference in a URL or a mixed header refuses the server; plain values are written', () => {
  const t = translateMcp('codex', [
    web('plain', { headers: { 'X-A': 'yes' } }), web('url', { url: 'https://x.test/${P}' }), web('mixed', { headers: { 'X-A': 'a-${B}' } }),
    web('nobearer', { headers: { 'X-Token': '${T}' } }),
  ]);
  assert.ok(t.servers.some(s => s.name === 'plain'));
  assert.equal(entryLine(t, 'url').result, 'absent'); assert.equal(entryLine(t, 'mixed').result, 'absent');
  const nb = Object.fromEntries(t.servers.find(s => s.name === 'nobearer').table);
  assert.equal(nb.bearer_token_env_var, undefined); assert.deepEqual(nb.env_http_headers, { 'X-Token': 'T' });
  const pi = translateMcp('pi', [server('cmd', { command: '${BIN}' }), server('env', { env: { A: '${B}' } })]);
  assert.equal(entryLine(pi, 'cmd').result, 'absent'); assert.ok(pi.servers.some(s => s.name === 'env'));
});

test('B17: Codex drops a private-block null with a field line; the instructions lose only leading blank lines', () => {
  const t = translateMcp('codex', [server('a', { privateBlocks: { codex: { required: true, startup: null } } })]);
  const table = Object.fromEntries(t.servers[0].table);
  assert.equal(table.required, true); assert.equal('startup' in table, false);
  assert.match(fieldLine(t, 'a', 'x-codex').reason, /startup/);
  const s = translateSubagents('codex', [agent('x', { body: '\n\nLine one.\n\nLine two.\n' })]);
  assert.equal(Object.fromEntries(s.subagents[0].table).developer_instructions, 'Line one.\n\nLine two.\n');
});

test('B17: in OpenCode, a limit that allows edit or write but not both denies the shared edit key and says so', () => {
  for (const tools of [['edit'], ['write']]) {
    const t = translateSubagents('opencode', [agent('x', { tools })]);
    assert.equal(Object.fromEntries(Object.fromEntries(t.subagents[0].frontmatter).permission.pairs).edit, 'deny');
    assert.match(fieldLine(t, 'x', 'tools').reason, /one edit key/);
  }
  const both = translateSubagents('opencode', [agent('x', { tools: ['edit', 'write'] })]);
  assert.equal(Object.fromEntries(Object.fromEntries(both.subagents[0].frontmatter).permission.pairs).edit, undefined);
  assert.doesNotMatch(fieldLine(both, 'x', 'tools').reason, /one edit key/);
});

// ---- check 2: every neutral MCP field is written or has a line (property) ----------------------------------------------------

test('check 2: every MCP field present in the source is written, or its entry or field has a line that is not exact', () => {
  let seed = 7;
  const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const values = ['plain', '${TOKEN}', 'a-${B}', { keychain: 'k' }];
  const written = {
    'claude-code': { command: ['command'], args: ['args'], env: ['env'], url: ['url'], headers: ['headers'], timeout: ['timeout'], enabled: [] },
    pi: { command: ['command'], args: ['args'], env: ['env'], url: ['url'], headers: ['headers'], timeout: ['timeout'], enabled: [] },
    codex: { command: ['command'], args: ['args'], env: ['env', 'env_vars'], url: ['url'], headers: ['http_headers', 'env_http_headers', 'bearer_token_env_var'], timeout: ['tool_timeout_sec'], enabled: ['enabled'] },
    opencode: { command: ['command'], args: ['command'], env: ['environment'], url: ['url'], headers: ['headers'], timeout: ['timeout'], enabled: ['enabled'] },
    'deepseek-harness': { command: ['command'], args: ['args'], env: ['env'], url: ['url'], headers: ['headers'], timeout: ['toolCallTimeoutMs'], enabled: [] },
  };
  for (let i = 0; i < 300; i++) {
    const transport = ['stdio', 'http', 'sse'][rand(3)];
    const s = transport === 'stdio' ? server(`s${i}`, { args: rand(2) ? ['-y'] : undefined }) : { ...web(`s${i}`), transport };
    if (rand(2)) s.env = { A: values[rand(4)] };
    if (rand(2)) s.headers = { Authorization: rand(2) ? 'Bearer ${T}' : values[rand(4)] };
    if (rand(2)) s.timeout = 1000 + rand(3) * 500;
    if (rand(3) === 0) s.enabled = rand(2) === 0;
    for (const key of Object.keys(s)) if (s[key] === undefined) delete s[key];
    for (const engine of ENGINE_IDS) {
      const t = translateMcp(engine, [s]);
      const line = entryLine(t, s.id);
      assert.ok(line, `${engine} ${i}`);
      const form = t.servers[0];
      if (!form) { assert.notEqual(line.result, 'exact', `${engine} ${i}: a server that is not written is never exact`); continue; }
      const keys = engine === 'codex' ? form.table.map(([k]) => k) : engine === 'deepseek-harness' ? Object.keys(form.row.config) : Object.keys(form.value);
      for (const field of ['command', 'args', 'env', 'url', 'headers', 'timeout', 'enabled']) {
        if (s[field] === undefined) continue;
        const carried = written[engine][field].some(k => keys.includes(k));
        const reported = fieldLine(t, s.id, field) !== undefined || (field === 'enabled' && line.result !== 'exact' && /disabled|enabled/.test(line.reason));
        assert.ok(carried || reported || (field === 'enabled' && s.enabled === true && engine !== 'codex' && engine !== 'opencode'), `${engine} ${i} ${field}: neither written nor reported`);
      }
    }
  }
});
