// The TOML subset that adoption reads from Codex files. Anything outside the subset is a refusal, never a guess.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTomlSubset } from '../../../dist/packages/adoption/src/index.js';

const ok = text => { const r = parseTomlSubset(text); assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const no = text => { const r = parseTomlSubset(text); assert.equal(r.ok, false, `expected a refusal for ${JSON.stringify(text)}`); return r; };

test('tables, dotted keys, quoted keys, and scalars', () => {
  const v = ok([
    '# a comment',
    'model = "model-a" # trailing comment',
    'sandbox_mode = \'workspace-write\'',
    '',
    '[mcp_servers.docs]',
    'command = "npx"',
    'args = ["-y", "example-docs-mcp"]',
    'tool_timeout_sec = 30',
    'startup_timeout_sec = 2.5',
    'enabled = true',
    'env = { LOG_LEVEL = "info", "X-Y" = "z" }',
    '',
    '[mcp_servers."odd.name"]',
    'url = "https://mcp.example.test/mcp"',
    'features.shell_tool = false',
  ].join('\n'));
  assert.deepEqual(v, {
    model: 'model-a',
    sandbox_mode: 'workspace-write',
    mcp_servers: {
      docs: { command: 'npx', args: ['-y', 'example-docs-mcp'], tool_timeout_sec: 30, startup_timeout_sec: 2.5, enabled: true, env: { LOG_LEVEL: 'info', 'X-Y': 'z' } },
      'odd.name': { url: 'https://mcp.example.test/mcp', features: { shell_tool: false } },
    },
  });
});

test('arrays of tables and escapes in basic strings', () => {
  const v = ok('[[hooks.PreToolUse]]\nmatcher = "Bash"\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "echo \\"hi\\"\\tthere"\n[[hooks.PreToolUse]]\nmatcher = "Edit"\n');
  assert.deepEqual(v, { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo "hi"\tthere' }] }, { matcher: 'Edit' }] } });
});

test('arrays may span lines and end with a comma', () => {
  assert.deepEqual(ok('args = [\n  "a", # one\n  "b",\n]\n'), { args: ['a', 'b'] });
});

test('a repeated key or table is refused', () => {
  assert.equal(no('a = 1\na = 2\n').code, 'TOML_DUPLICATE');
  assert.equal(no('[t]\nx = 1\n[t]\ny = 2\n').code, 'TOML_DUPLICATE');
  assert.equal(no('t.x = 1\n[t]\ny = 2\n').code, 'TOML_DUPLICATE');
});

test('forms outside the subset are refused, never guessed', () => {
  for (const text of [
    's = """multi\nline"""\n', "s = '''raw'''\n", 'd = 1979-05-27T07:32:00Z\n', 'n = 0x1f\n', 'n = 1_000\n', 'n = inf\n',
    'bare\n', '[bad table\n', 'x = "unterminated\n', 'x = [1, "a"]\n', 'x = { a = 1\n', 'x = "\\u{1F600}"\n', '__proto__ = 1\n',
  ]) assert.equal(no(text).code, 'TOML_UNSUPPORTED', text);
});

test('a refusal never repeats the input', () => {
  const r = no('secret = "sk-ant-abcdefghijklmnopqrstuvwxyz0123"\nsecret = "x"\n');
  assert.equal(JSON.stringify(r).includes('sk-ant'), false);
});
