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
