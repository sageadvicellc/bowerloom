// A Codex [mcp_servers.<id>] table that already means what Bowerloom would write is taken over, whatever its layout:
// a multi-line array with a trailing comma, a literal string, an env sub-table, dotted keys, another key order. Any real
// difference still refuses. Synthetic names and values only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ordered, editToml } from '../../../dist/packages/project-sync/src/locked-text.js';

const ARG = '. "$HOME/.config/example/.env"; EXAMPLE_TOKEN="$EXAMPLE_TOKEN" exec some-mcp-server';
const stdio = (extra = []) => ({
  path: ['mcp_servers', 'example'],
  entries: [['command', 'sh'], ['args', ['-c', ARG]], ['env', new Ordered([['EXAMPLE_FLAG_A', 'true'], ['EXAMPLE_FLAG_B', 'false'], ['EXAMPLE_TOOLSETS', 'messages,channels']])], ...extra],
});
const remote = { path: ['mcp_servers', 'other'], entries: [['url', 'https://example.invalid/mcp']] };

const REAL = `model = "model-a"

[mcp_servers.example]
command = "sh"
args = [
    "-c",
    '. "$HOME/.config/example/.env"; EXAMPLE_TOKEN="$EXAMPLE_TOKEN" exec some-mcp-server',
]

[mcp_servers.example.env]
EXAMPLE_FLAG_A = "true"
EXAMPLE_FLAG_B = "false"
EXAMPLE_TOOLSETS = "messages,channels"

[mcp_servers.other]
url = "https://example.invalid/mcp"
`;

const taken = (text, tables) => { const r = editToml(text, [], tables); assert.equal(r.ok, true, JSON.stringify(r)); return r; };
const refused = (text, tables) => { const r = editToml(text, [], tables); assert.equal(r.ok, false, 'a real difference must refuse'); assert.equal(r.reason, 'conflict'); return r; };

test('the real shape (multi-line array, trailing comma, literal string, env sub-table) and a URL server are taken over, byte for byte', () => {
  const r = taken(REAL, [stdio(), remote]);
  assert.equal(r.text, REAL, 'nothing is added or changed');
  assert.deepEqual(r.kept, ['mcp_servers.example', 'mcp_servers.other']);
});

test('formatting, quoting, key order, and table layout do not matter', () => {
  const layouts = [
    // inline env, double-quoted strings, other key order
    `[mcp_servers.example]\nenv = { EXAMPLE_TOOLSETS = "messages,channels", EXAMPLE_FLAG_A = 'true', EXAMPLE_FLAG_B = "false" }\nargs = ["-c", "${ARG.replace(/"/g, '\\"')}"]\ncommand = 'sh'\n`,
    // dotted env keys
    `[mcp_servers.example]\ncommand = "sh"\nargs = ["-c", '${ARG}']\nenv.EXAMPLE_FLAG_A = "true"\nenv.EXAMPLE_FLAG_B = "false"\nenv.EXAMPLE_TOOLSETS = "messages,channels"\n`,
    // the env table written before the parent keys, quoted keys, comments, and a header with spaces
    `# a note\n[ mcp_servers . example . env ]\n"EXAMPLE_FLAG_A" = "true" # a\n'EXAMPLE_FLAG_B' = "false"\nEXAMPLE_TOOLSETS = "messages,channels"\n\n[mcp_servers.example]\n"command" = "sh"\nargs = [ # list\n  "-c",\n  '${ARG}'\n]\n`,
    // everything under one header chain written as dotted keys from the root
    `mcp_servers.example.command = "sh"\nmcp_servers.example.args = ["-c", '${ARG}']\nmcp_servers.example.env = { EXAMPLE_FLAG_A = "true", EXAMPLE_FLAG_B = "false", EXAMPLE_TOOLSETS = "messages,channels" }\n`,
    // an inline table for the whole server
    `[mcp_servers]\nexample = { command = "sh", args = ["-c", '${ARG}'], env = { EXAMPLE_FLAG_A = "true", EXAMPLE_FLAG_B = "false", EXAMPLE_TOOLSETS = "messages,channels" } }\n`,
    // CRLF line endings
    REAL.replace(/\n/g, '\r\n'),
  ];
  for (const [i, text] of layouts.entries()) { const r = taken(text, [stdio()]); assert.equal(r.text, text, `layout ${i}`); assert.deepEqual(r.kept, ['mcp_servers.example'], `layout ${i}`); }
});

test('a table is taken over next to a table Bowerloom adds, and the person bytes stay', () => {
  const extra = { path: ['mcp_servers', 'added'], entries: [['command', 'echo']] };
  const r = taken(REAL, [stdio(), extra]);
  assert.ok(r.text.startsWith(REAL), 'the person text is first, unchanged');
  assert.deepEqual(r.kept, ['mcp_servers.example']);
  assert.match(r.text.slice(REAL.length), /\[mcp_servers\.added\]\ncommand = "echo"\n/);
});

test('any real difference still refuses', () => {
  const cases = {
    'a different command': REAL.replace('command = "sh"', 'command = "bash"'),
    'arguments in another order': REAL.replace(/args = \[[^\]]*\]/, `args = ['${ARG}', "-c"]`),
    'one argument fewer': REAL.replace(/args = \[[^\]]*\]/, 'args = ["-c"]'),
    'an env value': REAL.replace('EXAMPLE_FLAG_B = "false"', 'EXAMPLE_FLAG_B = "true"'),
    'an env key more': REAL.replace('[mcp_servers.other]', 'EXAMPLE_FLAG_C = "x"\n\n[mcp_servers.other]'),
    'an env key fewer': REAL.replace('EXAMPLE_FLAG_B = "false"\n', ''),
    'an env key renamed': REAL.replace('EXAMPLE_FLAG_B', 'EXAMPLE_FLAG_Z'),
    'a key more in the table': REAL.replace('command = "sh"', 'command = "sh"\nstartup_timeout_sec = 30'),
    'a different url': REAL.replace('https://example.invalid/mcp', 'https://example.invalid/other'),
    'an integer where text is planned': REAL.replace('EXAMPLE_FLAG_A = "true"', 'EXAMPLE_FLAG_A = true'),
    'a second sub-table that adds a key': `${REAL}\n[mcp_servers.example.http_headers]\nX-Test = "1"\n`,
  };
  for (const [label, text] of Object.entries(cases)) {
    const r = refused(text, [stdio(), remote]);
    assert.ok(r.at.some(p => p.startsWith('mcp_servers.')), label);
  }
});

test('a part of the table the reader cannot compare keeps the conflict', () => {
  const cases = [
    `${REAL}\n[[mcp_servers.example.hooks]]\nname = "x"\n`,
    REAL.replace('command = "sh"', 'command = """sh"""'),
    REAL.replace('EXAMPLE_FLAG_A = "true"', 'EXAMPLE_FLAG_A = 0x10'),
  ];
  for (const text of cases) refused(text, [stdio()]);
  const whole = { path: ['mcp_servers', 'n'], entries: [['startup_timeout_sec', 20]] };
  taken('[mcp_servers.n]\nstartup_timeout_sec = 20\n', [whole]);
  refused('[mcp_servers.n]\nstartup_timeout_sec = 20.0\n', [whole]);
  refused('[mcp_servers.n]\nstartup_timeout_sec = 20.5\n', [whole]);
});

test('a text that is not TOML is still invalid, and a missing table is still added', () => {
  assert.equal(editToml('[mcp_servers.example\n', [], [stdio()]).ok, false);
  const r = editToml('model = "a"\n', [], [remote]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.kept, []);
  assert.match(r.text, /\[mcp_servers\.other\]\nurl = "https:\/\/example\.invalid\/mcp"\n/);
});
