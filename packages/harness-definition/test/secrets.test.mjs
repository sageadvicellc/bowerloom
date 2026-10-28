// Harness definition spec, section 12, check 3: a definition holds no secret value. A scan of every file finds none.
// Section 8, rule 3: a secret is a reference to a variable name or a keychain entry.
// Every planted value is built at run time from pieces, so this file holds no secret-shaped text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDefinition, scanSecrets } from '../../../dist/packages/harness-definition/src/index.js';
import { agent, cleanup, codes, fullFiles, json, makeDefinition, skill } from './fixture.mjs';

test.after(cleanup);

const rep = (s, n) => s.repeat(n);
const FAKE = {
  github: 'gh' + 'p_' + rep('A1b2', 9),
  githubPat: 'github' + '_pat_' + rep('Ab1_', 8),
  anthropic: 'sk-' + 'ant-' + rep('Zx9-', 8),
  openai: 'sk-' + 'proj-' + rep('Qw3E', 8),
  aws: 'AK' + 'IA' + rep('ABCD2345', 2),
  slack: 'xo' + 'xb-' + rep('1234-', 3) + 'abcdefabcdef',
  google: 'AI' + 'za' + rep('Sy0_', 8) + 'abc',
  stripe: 'sk' + '_live_' + rep('a1B2', 6),
  jwt: 'ey' + 'J' + rep('hbGci', 3) + '.' + 'ey' + 'J' + rep('zdWIi', 3) + '.' + rep('sig0', 4),
  privateKey: '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
  urlPassword: 'https://user:' + 'hunter2pass' + '@db.example.com/x',
};

test('check 3: a clean definition with every part has no finding', () => {
  const r = loadDefinition(makeDefinition(fullFiles()));
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(scanSecrets(r.definition.files), []);
});

test('check 3: references to a variable or a keychain entry are not secrets', () => {
  const files = fullFiles({
    'mcp.json': json({ servers: [{
      name: 'api', transport: 'http', url: 'https://api.example.com',
      headers: { Authorization: 'Bearer ${API_TOKEN}', 'X-Api-Key': '${API_KEY}', Cookie: { keychain: 'api-cookie' } },
    }, { name: 'local', transport: 'stdio', command: 'run', env: { API_KEY: '${API_KEY}', SECRET: { keychain: 'local-secret' }, LOG_LEVEL: 'debug' } }] }),
    'instructions/AGENTS.md': '# Demo\n\nSet API_TOKEN in your shell. The token budget is 4000.\n\n## Tool guidance\n\nx\n',
  });
  const r = loadDefinition(makeDefinition(files));
  assert.equal(r.ok, true, JSON.stringify(r.problems));
});

const placements = [
  ['instructions', v => ({ 'instructions/AGENTS.md': `# Demo\n\nUse ${v} to log in.\n\n## Tool guidance\n\nx\n` }), 'instructions/AGENTS.md'],
  ['skill body', v => ({ 'skills/deploy/SKILL.md': skill('deploy', 'Deploys.', '', `Token: ${v}\n`) }), 'skills/deploy/SKILL.md'],
  ['skill resource', v => ({ 'skills/review/references/notes.md': `line one\n${v}\n` }), 'skills/review/references/notes.md'],
  ['script', v => ({ 'scripts/lint.sh': `#!/bin/sh\nexport TOKEN=${v}\n` }), 'scripts/lint.sh'],
  ['engine-private file', v => ({ 'engines/codex/config-extra.toml': `key = "${v}"\n` }), 'engines/codex/config-extra.toml'],
  ['subagent x-block', v => ({ 'agents/reader.md': agent('reader', `x-claude-code:\n  note: "${v.replace(/\n/g, '\\n')}"\n`) }), 'agents/reader.md'],
  ['hook command', v => ({ 'hooks.json': json({ hooks: [{ id: 'h', event: 'Stop', command: `curl -H 'k: ${v}'`, strength: 'advisory' }] }) }), 'hooks.json'],
];

for (const [kind, value] of Object.entries(FAKE)) {
  for (const [where, place, file] of placements) {
    test(`check 3: a ${kind} value in the ${where} is found and refused`, () => {
      const dir = makeDefinition(fullFiles(place(value)));
      const r = loadDefinition(dir);
      assert.equal(r.ok, false, `${kind} in ${where} was not found`);
      assert.ok(codes(r).includes('SECRET_VALUE'), JSON.stringify(r.problems));
      const problem = r.problems.find(p => p.code === 'SECRET_VALUE');
      assert.equal(problem.path, file);
      // A finding never repeats the value it found.
      const secretCore = value.split('\n')[0].slice(4, 20);
      assert.ok(!JSON.stringify(r.problems).includes(secretCore), 'the problem leaks the value');
    });
  }
}

test('check 3: a literal value under a secret-named key in JSON is refused', () => {
  const literal = 'plain' + 'text' + 'value';
  const cases = [
    { name: 's', transport: 'stdio', command: 'run', env: { API_KEY: literal } },
    { name: 's', transport: 'stdio', command: 'run', env: { DB_PASSWORD: 'short' } },
    { name: 's', transport: 'http', url: 'https://x.example.com', headers: { Authorization: 'Bearer ' + literal } },
    { name: 's', transport: 'http', url: 'https://x.example.com', headers: { 'X-Auth-Token': 'prefix-${A}' } },
    { name: 's', transport: 'stdio', command: 'run', 'x-codex': { bearer_token: literal } },
    { name: 's', transport: 'stdio', command: 'run', 'x-claude-code': { clientSecret: literal } },
  ];
  for (const server of cases) {
    const r = loadDefinition(makeDefinition(fullFiles({ 'mcp.json': json({ servers: [server] }) })));
    assert.equal(r.ok, false, JSON.stringify(server));
    const found = r.problems.filter(p => p.code === 'SECRET_VALUE');
    assert.equal(found.length, 1, JSON.stringify(r.problems));
    assert.equal(found[0].path, 'mcp.json');
    assert.match(found[0].message, /\/servers\/0\//);
    assert.ok(!JSON.stringify(r.problems).includes(literal));
  }
});

test('check 3: scanSecrets reads binary files too', () => {
  const bytes = Buffer.concat([Buffer.from([0, 1, 2, 0xff, 0xfe]), Buffer.from(FAKE.aws), Buffer.from([0])]);
  const findings = scanSecrets([{ path: 'scripts/tool.bin', bytes }]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, 'scripts/tool.bin');
  assert.equal(typeof findings[0].rule, 'string');
  assert.ok(!JSON.stringify(findings).includes(FAKE.aws));
});

test('check 3: a finding names the line of a text file', () => {
  const findings = scanSecrets([{ path: 'scripts/a.sh', bytes: Buffer.from(`one\ntwo\nthree ${FAKE.github}\n`) }]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 3);
});

// ---- Fix round 1: S1, S3, C1, silent 1 and 15 ----------------------------------------------------------------------

const MORE = {
  discord: 'M' + 'TA1'.repeat(8) + '.' + 'Gh1x2Y' + '.' + 'abcDEF123_-'.repeat(3),
  telegram: '12345678' + '9:' + 'AAH' + 'x1Y2z3'.repeat(5) + 'ab',
  gitlab: 'gl' + 'pat-' + 'Ab1_'.repeat(6),
  npm: 'np' + 'm_' + 'aB3d'.repeat(9),
  huggingface: 'h' + 'f_' + 'aB3d'.repeat(9),
  supabase: 'sb' + 'p_' + 'a1b2c3d4e5'.repeat(4),
  notion: 'nt' + 'n_' + 'aB3d'.repeat(11),
  notionLegacy: 'sec' + 'ret_' + 'aB3d'.repeat(11),
  twilio: 'S' + 'K' + '0123456789abcdef'.repeat(2),
  discordHook: 'https://discord.com/api/web' + 'hooks/123456789/' + 'aB3d_-'.repeat(12),
  slackHook: 'https://hooks.slack.com/serv' + 'ices/T0123ABCD/B0123ABCD/' + 'aB3dEf9h'.repeat(3),
};

for (const [kind, value] of Object.entries(MORE)) {
  test(`S3: a ${kind} value in a script is found`, () => {
    const findings = scanSecrets([{ path: 'scripts/a.sh', bytes: Buffer.from(`echo start\nrun ${value}\n`) }]);
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0].line, 2);
  });
}

const literal = 'plain' + 'text' + 'value';
const scanJson = (file, value) => scanSecrets([{ path: file, bytes: Buffer.from(JSON.stringify(value)) }]);

test('S3: secret-named keys are found wherever the secret word sits', () => {
  for (const key of ['STRIPE_SECRET_KEY', 'SECRET_KEY_BASE', 'OPENAI_KEY', 'ENCRYPTION_KEY', 'DB_PASS', 'tokens', 'api_keys', 'passwords', 'authToken', 'X-Api-Key', 'ssh_key', 'GITLAB_PAT', 'privateKey']) {
    assert.equal(scanJson('engines/codex/a.json', { [key]: literal }).length, 1, key);
  }
});

test('S3 and C1: keys and values that only describe a secret are not findings', () => {
  const value = {
    LOG_LEVEL: 'debug', max_tokens: 4096, token_url: 'https://auth.example.com/token', auth_type: 'oauth', apiKeyHelper: '/usr/local/bin/helper',
    bearer_token_env_var: 'API_TOKEN', public_key: 'ed25519', sort_key: 'name', AUTH: 'none', password_min_length: 12, keychain: 'entry',
    auth: { type: 'oauth', url: 'https://auth.example.com' }, token: '${TOKEN}', secret: { keychain: 'x' }, cookie: '', pass_through: 'yes',
  };
  assert.deepEqual(scanJson('engines/codex/a.json', value), []);
});

test('silent 15: arrays, nested objects, and numbers under a secret key are found', () => {
  assert.equal(scanJson('engines/codex/a.json', { api_keys: ['first' + 'secretvalue', 'second' + 'secretvalue'] }).length, 2);
  assert.equal(scanJson('engines/codex/a.json', { credentials: { user: 'admin', value: literal } }).length, 2);
  assert.equal(scanJson('engines/codex/a.json', { pin_password: 482913 }).length, 1);
});

test('S3: a JSON escape does not hide a token shape', () => {
  const escaped = '{"note": "gh\\u0070_' + 'A1b2'.repeat(9) + '"}';
  assert.equal(scanSecrets([{ path: 'engines/codex/a.json', bytes: Buffer.from(escaped) }]).length, 1);
});

test('C1: secrets inside JSON strings: assignments, flags, and query strings', () => {
  const cases = [
    { hooks: [{ command: 'API_KEY=lettersonly ./run.sh' }] },
    { args: ['--token=' + literal] },
    { args: ['--password', 'hunter'] },
    { url: 'https://api.example.com/v1?api_key=' + literal + '&x=1' },
    { url: 'https://api.example.com/v1?token=' + literal },
  ];
  for (const value of cases) assert.ok(scanJson('engines/codex/a.json', value).length >= 1, JSON.stringify(value));
  assert.deepEqual(scanJson('engines/codex/a.json', { args: ['--token-file', '/path/to/file'], url: 'https://x.example.com/?page=2' }), []);
});

test('S3: a letters-only password in a script is found; a reference is not', () => {
  assert.equal(scanSecrets([{ path: 'scripts/a.sh', bytes: Buffer.from('export DB_PASSWORD=hunter\n') }]).length, 1);
  assert.equal(scanSecrets([{ path: 'scripts/a.sh', bytes: Buffer.from('export DB_PASSWORD="$DB_PASSWORD"\nTOKEN=${TOKEN}\n') }]).length, 0);
  assert.equal(scanSecrets([{ path: 'engines/codex/c.toml', bytes: Buffer.from('api_key = "lettersonly"\n') }]).length, 1);
  // Prose that names a secret is not one.
  assert.equal(scanSecrets([{ path: 'instructions/AGENTS.md', bytes: Buffer.from('Password: ask the owner for it.\nThe token: never commit it.\n') }]).length, 0);
});

test('silent 1: a .json file that is not strict JSON is a finding, and its text is still scanned', () => {
  const jsonc = '{\n  // comment\n  "password": "' + literal + '",\n}\n';
  const findings = scanSecrets([{ path: 'engines/claude-code/settings.json', bytes: Buffer.from(jsonc) }]);
  assert.ok(findings.some(f => f.rule === 'unparseable-json'));
  assert.ok(findings.some(f => f.rule !== 'unparseable-json' && f.line === 3), JSON.stringify(findings));
  const r = loadDefinition(makeDefinition(fullFiles({ 'engines/codex/settings.json': '{"a": 1,}' })));
  assert.ok(codes(r).includes('SECRET_SCAN_INCOMPLETE'));
});

test('S1: a line over the limit fails closed, and a 1 MiB file scans fast', () => {
  const long = 'a'.repeat(5000);
  assert.deepEqual(scanSecrets([{ path: 'scripts/a.sh', bytes: Buffer.from(`ok\n${long}\n`) }]).map(f => [f.rule, f.line]), [['line-too-long', 2]]);
  const started = Date.now();
  scanSecrets([{ path: 'scripts/big.txt', bytes: Buffer.from(('eyJ' + 'a'.repeat(30) + '.').repeat(100) + '\n').subarray(0, 4000) }]);
  const evil = ['eyJ'.repeat(1300), 'a://b:'.repeat(650), 'TOKEN'.repeat(800), 'x_'.repeat(2000)].map(l => l.slice(0, 4000)).join('\n');
  scanSecrets([{ path: 'scripts/evil.txt', bytes: Buffer.from((evil + '\n').repeat(64)) }]);
  scanSecrets([{ path: 'scripts/one.txt', bytes: Buffer.from('b'.repeat(1024 * 1024)) }]);
  assert.ok(Date.now() - started < 3000, `${Date.now() - started} ms`);
  const r = loadDefinition(makeDefinition(fullFiles({ 'scripts/one.txt': 'b'.repeat(1024 * 1024 - 1) })));
  assert.ok(codes(r).includes('SECRET_SCAN_INCOMPLETE'));
});
