// What the real-setup reader hides, and how fast it hides it. Every secret here is made up. A hostile text must not hang the main process (a 2 MB text in under 2 s,
// with a loose bound so a slow machine does not make the test flaky; the old patterns took 3 to 5 s for 80 KB), and a secret of any shape must not come out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classify, recordsOfFile } from '../shared/real/adapters.js';
import { HIDDEN, SCRUB_CHUNK, commandName, keyNames, looksLikeValue, scrubText } from '../shared/real/redact.js';
import { createScanner } from '../main/real-scan.js';
import { tempDir } from './support.js';

const TWO_MB = 2 * 1024 * 1024;
const LOOSE_MS = 2000;
const repeat = (unit: string, bytes: number): string => unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);

/** A long run of base64-looking text that is not periodic (a simple generator, so the test is the same every time). */
function base64Run(length: number): string {
  const digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let seed = 12345, out = '';
  for (let i = 0; i < length; i += 1) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; out += digits[seed % 64]; }
  return out;
}

const HOSTILE: readonly (readonly [string, string])[] = [
  ['"a." x 1M', repeat('a.', TWO_MB)],
  ['"eyJ-" x 500k', repeat('eyJ-', TWO_MB)],
  ['"eyJ." x 500k', repeat('eyJ.', TWO_MB)],
  ['"password=" x 200k', repeat('password=', TWO_MB)],
  ['"api_key=\\"" x 200k', repeat('api_key="', TWO_MB)],
  ['"token: " x 300k', repeat('token: ', TWO_MB)],
  ['"Authorization: " x 100k', repeat('Authorization: ', TWO_MB)],
  ['"sk-" x 700k', repeat('sk-', TWO_MB)],
  ['"sk-ab" x 400k', repeat('sk-ab', TWO_MB)],
  ['"AKIA" x 500k', repeat('AKIA', TWO_MB)],
  ['"Bearer " x 300k', repeat('Bearer ', TWO_MB)],
  ['"Bearer" then 2 MB of spaces', `Bearer${' '.repeat(TWO_MB)}`],
  ['"://" x 700k', repeat('://', TWO_MB)],
  ['"://a:" x 500k', repeat('://a:', TWO_MB)],
  ['"-----BEGIN PRIVATE KEY-----" x 70k', repeat('-----BEGIN PRIVATE KEY-----', TWO_MB)],
  ['one 2 MB base64 run', base64Run(TWO_MB)],
  ['base64 runs of 39 characters', repeat(`${base64Run(39)} `, TWO_MB)],
  ['2 MB of spaces', ' '.repeat(TWO_MB)],
  ['2 MB of dots', '.'.repeat(TWO_MB)],
  ['spaces and dots', repeat(' . ', TWO_MB)],
  ['2 MB of one letter', 'k'.repeat(TWO_MB)],
  ['"key " x 500k', repeat('key ', TWO_MB)],
  ['"keykeykey" x 230k', repeat('keykey', TWO_MB)],
  ['"hooks.slack.com/services/" x 80k', repeat('hooks.slack.com/services/', TWO_MB)],
  ['"\\"" x 2M', '"'.repeat(TWO_MB)],
];

for (const [label, text] of HOSTILE) {
  test(`a hostile text finishes fast: ${label}`, t => {
    assert.ok(text.length >= TWO_MB - 40, `the text is about 2 MB (${text.length})`);
    const start = performance.now();
    const out = scrubText(text);
    const ms = performance.now() - start;
    t.diagnostic(`${label}: ${Math.round(ms)} ms`);
    assert.ok(ms < LOOSE_MS, `${label} took ${Math.round(ms)} ms`);
    assert.equal(typeof out, 'string');
  });
}

test('a hostile skill file of 2 MB is read into a record in under 2 s, whatever its shape', t => {
  const role = classify('claude-code', 'skills/x/SKILL.md')!;
  for (const [label, body] of [['a.', repeat('a.', TWO_MB)], ['eyJ-', repeat('eyJ-', TWO_MB)], ['password=', repeat('password=', TWO_MB)]] as const) {
    const text = `---\nname: Hostile\ndescription: ${body.slice(0, 100)}\n---\n${body}`.slice(0, TWO_MB);
    const start = performance.now();
    const r = recordsOfFile('claude-code', role, '.claude/skills/x/SKILL.md', 'skills/x/SKILL.md', text);
    const ms = performance.now() - start;
    t.diagnostic(`record of a 2 MB skill (${label}): ${Math.round(ms)} ms`);
    assert.ok(ms < LOOSE_MS, `${label} took ${Math.round(ms)} ms`);
    assert.equal(r.records.length, 1);
  }
  const agent = classify('claude-code', 'agents/x.md')!;
  const start = performance.now();
  recordsOfFile('claude-code', agent, '.claude/agents/x.md', 'agents/x.md', `---\nname: a\n---\n${repeat('eyJ-', TWO_MB)}`);
  assert.ok(performance.now() - start < LOOSE_MS, 'an agent body is scrubbed in time too');
});

test('a long text is scrubbed in pieces, and a secret near a piece end is still hidden', () => {
  const secret = 'sk-FAKEFAKEFAKE1234567890abcd';
  const filler = 'plain words here\n';
  const head = filler.repeat(Math.floor((SCRUB_CHUNK - 40) / filler.length));
  const text = `${head}api_key = ${secret}\n${filler.repeat(1000)}token: hunter2\n${filler.repeat(Math.floor(SCRUB_CHUNK * 2 / filler.length))}password=abc123xyz\n`;
  const out = scrubText(text);
  for (const piece of ['sk-FAKE', 'hunter2', 'abc123xyz']) assert.ok(!out.includes(piece), `${piece} is still in the text`);
  assert.ok(out.includes('plain words here'), 'the rest is kept');
  assert.ok(out.length > text.length / 2);
});

// ---------------------------------------------------------------------------------------------------------------------- every shape of secret

const AWS_STYLE = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const HEX_BLOB = 'a3f5c9d1e7b2a4f6c8d0e2b4a6f8c0d2e4b6a8f0';
const B64_BLOB = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6QUJDREVG';
const SLACK = ['https://hooks.sl', 'ack.com/services/T0FAKE123/B0FAKE456/abcdEFGHijklMNOPqrstUVWX'].join('');
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.c2lnbmF0dXJlLWZha2U';

/** Each text and the pieces of it that must not come out. */
const SECRETS: readonly (readonly [string, readonly string[]])[] = [
  ['password: hunter2', ['hunter2']],
  ['password = hunter2', ['hunter2']],
  ['PASSWORD=x9', ['x9']],
  ['pwd=$ecretPass123', ['ecretPass123']],
  ['token: {abcdefgh1234}', ['abcdefgh1234']],
  ['secret: %ecretValue99', ['ecretValue99']],
  ['key: <abcdefgh1234>x', ['abcdefgh1234']],
  ['password=abc;defgh1234', ['defgh1234', 'abc;']],
  ['password=abc;defgh1234;', ['defgh1234']],
  ['DATABASE_URL=postgres://u:p4ssw0rd@db/x', ['p4ssw0rd']],
  ['postgresql://app:p4ssw0rd@db.example.test:5432/x', ['p4ssw0rd']],
  ['mysql://root:p4ssw0rd@127.0.0.1/x', ['p4ssw0rd']],
  ['mongodb+srv://app:p4ssw0rd@cluster.example.test/x', ['p4ssw0rd']],
  ['redis://:p4ssw0rd@cache:6379', ['p4ssw0rd']],
  ['https://user:pass1234@host/x', ['pass1234']],
  ['fetch from ftp://anon:letmein@files.example.test/pub', ['letmein']],
  ['Authorization: Token abcdef1234567890', ['abcdef1234567890']],
  ['Authorization: Bearer abcdef1234567890', ['abcdef1234567890']],
  ['Authorization: Basic dXNlcjpwYXNz', ['dXNlcjpwYXNz']],
  ['authorization: Digest realm=x', ['realm=x']],
  ['Authorization: s3cr3t', ['s3cr3t']],
  ['"Authorization": "ApiKey abcdef1234567890"', ['abcdef1234567890']],
  ['Proxy-Authorization: Negotiate abcdef1234567890', ['abcdef1234567890']],
  ['api_key: "my long pass phrase"', ['my long pass phrase', 'pass phrase']],
  ["api_key: 'my long pass phrase'", ['pass phrase']],
  ['{"password": "two words"}', ['two words']],
  ['curl -H "X-Api-Key: abc" https://x.test', ['abc"']],
  ['apiKey=Ab1', ['Ab1']],
  ['?token=abc&other=1', ['abc']],
  [`webhook ${SLACK}`, ['abcdEFGHijklMNOPqrstUVWX', 'T0FAKE123']],
  ['https://discord.com/api/webhooks/123456789012345678/abcDEF-ghiJKL_mnoPQR', ['abcDEF-ghiJKL_mnoPQR']],
  [`aws secret ${AWS_STYLE} in text`, [AWS_STYLE]],
  [`sha ${HEX_BLOB} in text`, [HEX_BLOB]],
  [`blob ${B64_BLOB} in text`, [B64_BLOB]],
  [`jwt ${JWT} here`, ['c2lnbmF0dXJl', 'eyJzdWIi']],
  ['id AKIAABCDEFGHIJKLMNOP end', ['AKIAABCDEFGHIJKLMNOP']],
  ['x xoxb-1234567890-abcdefghij y', ['xoxb-1234567890']],
  ['npm_abcdefghijklmnopqrstuvwxyz0123', ['npm_abcdefghijkl']],
  ['-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----', ['MIIabc']],
  ['-----BEGIN OPENSSH PRIVATE KEY-----\nabc', ['abc']],
  ['Bearer abc123def456ghi', ['abc123def456ghi']],
  ['export OPENAI_API_KEY=sk-FAKEFAKEFAKE1234567890abcd', ['FAKEFAKEFAKE']],
];

for (const [text, pieces] of SECRETS) {
  test(`a secret does not come out: ${text.slice(0, 60).replace(/\n/g, ' ')}`, () => {
    const out = scrubText(text);
    for (const piece of pieces) assert.ok(!out.includes(piece), `"${piece}" is still in: ${out}`);
    assert.ok(out.includes(HIDDEN), `something is marked hidden: ${out}`);
    assert.equal(scrubText(out), out, 'scrubbing twice changes nothing more');
  });
}

test('the name of a key stays, and the text around a secret is kept', () => {
  assert.equal(scrubText('password: hunter2'), `password: ${HIDDEN}`);
  assert.equal(scrubText('Set api_key = "abcd1234efgh5678" now'), `Set api_key = "${HIDDEN}" now`);
  assert.equal(scrubText('DATABASE_URL=postgres://u:p4ssw0rd@db/x'), `DATABASE_URL=postgres://${HIDDEN}@db/x`);
  assert.equal(scrubText('Authorization: Token abcdef1234567890.'), `Authorization: Token ${HIDDEN}.`);
});

test('ordinary prose, paths, references and short hashes are left alone', () => {
  const same = [
    'Use a password manager.', 'API design notes', 'The key idea is to keep tokens short.', 'A monkey: banana', 'author: Hanna Sage', 'Basic configuration of the thing',
    'knowledge-base/specs/2026-10-12-resume-cms-completion.md is the spec', 'See https://example.test/docs/Getting-Started-Guide-2/overview for details',
    'password: ${PASSWORD} stays', 'Set API_KEY=$API_KEY before running', 'token: $GITHUB_TOKEN', 'key: <YOUR_API_KEY>', 'Authorization: Bearer ${TOKEN}', 'api_key: {{ secrets.API_KEY }}',
    'bearer_token_env_var = "DOCS_TOKEN"', 'Commit 3f2a9c1 fixed it', 'git@github.com:org/repo.git', 'ssh://git@github.com/org/repo', 'if (token == null) return', 'token: true',
    'The turkey sandwich', 'Keyboard shortcuts: Cmd+K', 'Passwords are never stored.', 'Pneumonoultramicroscopicsilicovolcanoconiosis is a word',
    '# Heading\n\n- first\n- second\n\nSecrets:\n  - none yet',
  ];
  for (const text of same) assert.equal(scrubText(text), text, text);
});

// ---------------------------------------------------------------------------------------------------------------------- names that are really values

test('a key name that looks like a pasted value is shown as [hidden key]', () => {
  const pasted = ['sk-FAKEFAKEFAKE1234567890abcd', 'ghp_abcdefghijklmnopqrstuv', 'eyJhbGciOiJIUzI1NiJ9', 'Xk9fQ2mZpL4vB7nW', 'A'.repeat(41), 'KEY_123456789', 'AKIAABCDEFGHIJKLMNOP', 'password=abc', 'xoxb-12345-abc'];
  const names = keyNames(Object.fromEntries([...pasted, 'TRACKER_API_KEY', 'Authorization', 'X-Api-Key', 'REGION', 'S3_BUCKET', 'OAUTH2_CLIENT_ID'].map(k => [k, 1])));
  assert.deepEqual(names, ['Authorization', 'OAUTH2_CLIENT_ID', 'REGION', 'S3_BUCKET', 'TRACKER_API_KEY', 'X-Api-Key', HIDDEN]);
  for (const value of pasted) assert.equal(looksLikeValue(value), true, value);
  for (const name of ['TRACKER_API_KEY', 'Authorization', 'X-Api-Key', 'DOCS_TOKEN', 'npm_config_registry', 'HTTP2_PORT']) assert.equal(looksLikeValue(name), false, name);
});

test('a command that is an address with a login gives no name', () => {
  assert.equal(commandName('https://user:pass1234@host.example.test/run'), '');
  assert.equal(commandName('user:pass1234@host.example.test'), '');
  assert.equal(commandName('git@host.example.test:org/repo'), '');
  assert.equal(commandName('/usr/local/bin/node server.js'), 'node');
  assert.equal(commandName('sk-FAKEFAKEFAKE1234567890abcd --run'), '');
});

function config(role: 'claude-json' | 'codex-toml' | 'hermes-yaml', text: string): string {
  const r = recordsOfFile(role === 'claude-json' ? 'claude-code' : role === 'codex-toml' ? 'codex' : 'hermes', { what: 'config', config: role }, 'c', 'c', text);
  return JSON.stringify(r.records);
}

test('an environment or header NAME that is a pasted value, and a pasted bearer variable, are hidden everywhere they could be shown', () => {
  const token = 'sk-FAKEFAKEFAKE1234567890abcd';
  const json = config('claude-json', JSON.stringify({ mcpServers: { s: { command: 'node', env: { [token]: 'v', REGION: 'eu' }, headers: { [`Bearer ${token}`]: 'x' } } } }));
  assert.doesNotMatch(json, /FAKEFAKE/); assert.match(json, /REGION/);
  const toml = config('codex-toml', `[mcp_servers.a]\ncommand = "node"\nbearer_token_env_var = "${token}"\n\n[mcp_servers.b]\nurl = "https://x.test/mcp"\nbearer_token_env_var = "Xk9fQ2mZpL4vB7nW"\n\n[mcp_servers.c]\nurl = "https://x.test/mcp"\nbearer_token_env_var = "hunter2xyz"\n\n[mcp_servers.d]\nurl = "https://x.test/mcp"\nbearer_token_env_var = "DOCS_TOKEN"\n`);
  assert.doesNotMatch(toml, /FAKEFAKE|Xk9fQ2|hunter2xyz/); assert.match(toml, /DOCS_TOKEN/);
  const hermes = config('hermes-yaml', `mcp_servers:\n  files:\n    command: npx\n    env:\n      - ${token}\n      - FILES_TOKEN=abc\n      - REGION\n`);
  assert.doesNotMatch(hermes, /FAKEFAKE/); assert.match(hermes, /FILES_TOKEN/); assert.match(hermes, /REGION/);
  const bare = config('claude-json', JSON.stringify({ mcpServers: { s: { command: 'https://user:pass1234@host.example.test/run' } } }));
  assert.doesNotMatch(bare, /pass1234|user:/);
});

test('a name, a model, a skill list and a tool list in the front matter of an agent are scrubbed', () => {
  const secret = 'sk-FAKEFAKEFAKE1234567890abcd';
  const text = `---\nname: helper password=hunter2\ndescription: Helps. api_key: abc\nmodel: ${secret}\nskills: [${secret}, token=zzz999]\ntools: Read, ${secret}, password: hunter2\n---\nBody ${secret}\n`;
  const r = recordsOfFile('claude-code', classify('claude-code', 'agents/x.md')!, '.claude/agents/x.md', 'agents/x.md', text);
  const all = JSON.stringify(r.records);
  assert.doesNotMatch(all, /FAKEFAKE|hunter2|zzz999|api_key: abc/);
  assert.match(all, /helper/);
});

test('a note title, summary, tags and type are scrubbed before they reach the page', async t => {
  const home = tempDir(t), proj = join(home, 'work', 'proj');
  mkdirSync(join(proj, 'notes'), { recursive: true });
  writeFileSync(join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { a: { command: 'node' } } }));
  writeFileSync(join(proj, 'notes', 'one.md'), '---\ntitle: Rotate password=hunter2 weekly\ndescription: Use token: abcdef123456 and https://u:pw99@h.test/x\ntags: [api_key=zzz999, fine]\ntype: password: swordfish\n---\nBody.\n');
  writeFileSync(join(proj, 'notes', 'two.md'), '# Heading with secret: hunter2\n\nA line with Authorization: Token abcdef1234567890.\n');
  const scanner = createScanner({ home });
  const picked = await scanner.addFolder(join(home, 'work'));
  const batch = await scanner.read(picked.places.map(p => p.id));
  const all = JSON.stringify(batch.reads.map(r => ({ notes: r.notes, place: r.place })));
  assert.doesNotMatch(all, /hunter2|abcdef123456|pw99|zzz999|swordfish|abcdef1234567890/);
  assert.match(all, /Rotate/); assert.match(all, /fine/);
});
