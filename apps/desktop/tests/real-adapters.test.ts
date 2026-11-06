// The adapters of the real-setup reader: what a path means, what a file gives, and that no key value ever comes out. All text here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTERS, classify, nameFromPath, recordsOfFile, secretNameOf } from '../shared/real/adapters.js';
import type { FileRole, RawRecord } from '../shared/real/adapters.js';
import { firstSentence, parseFrontmatter, parseJsonLoose } from '../shared/real/frontmatter.js';
import { commandName, cut, hostOf, keyNames, scrubText } from '../shared/real/redact.js';
import { parseToml } from '../shared/real/toml.js';
import { parseYaml } from '../shared/real/yaml.js';

/** A made-up value that none of the scrub patterns would catch: if it comes out, the parser kept a value it should have dropped. */
export const FAKE_SECRET = 'zq9-NOT-A-REAL-VALUE-7731';

const read = (app: Parameters<typeof classify>[0], rel: string, text: string | null, role?: FileRole): ReturnType<typeof recordsOfFile> => {
  const r = role ?? classify(app, rel);
  assert.ok(r !== null, `${app} ${rel} means something`);
  return recordsOfFile(app, r, `.x/${rel}`, rel, text);
};
const only = (records: readonly RawRecord[]): RawRecord => { assert.equal(records.length, 1); return records[0]!; };

test('the table knows five programs, and only three of them are interfaces of the sample world', () => {
  assert.deepEqual(ADAPTERS.map(a => a.id), ['claude-code', 'codex', 'opencode', 'hermes', 'bowerloom']);
  assert.deepEqual(ADAPTERS.find(a => a.id === 'opencode')!.homeFolders, ['.config/opencode']);
  assert.deepEqual(ADAPTERS.find(a => a.id === 'hermes')!.homeFolders, ['.hermes']);
  for (const a of ADAPTERS) for (const folder of [...a.homeFolders, ...a.projectFolders]) assert.doesNotMatch(folder, /^\/|\.\./, 'a relative folder name');
});

test('a path means a skill, an agent, a prompt, a config file or nothing, per program', () => {
  const kinds = (app: Parameters<typeof classify>[0], rels: string[]): (string | null)[] => rels.map(r => classify(app, r)?.what ?? null);
  assert.deepEqual(kinds('claude-code', ['skills/a/SKILL.md', 'skills/deep/b/SKILL.md', 'skills/flat.md', 'skills/README.md', 'agents/x.md', 'commands/ns/y.md', 'settings.json', 'projects/s.jsonl', 'plugins/p/SKILL.md']),
    ['skill', 'skill', 'skill', null, 'agent', 'prompt', 'config', null, null]);
  assert.deepEqual(kinds('codex', ['skills/a/SKILL.md', 'agents/x.toml', 'agents/y.md', 'prompts/p.md', 'config.toml', 'sessions/1.jsonl']), ['skill', 'agent', 'agent', 'prompt', 'config', null]);
  assert.deepEqual(kinds('opencode', ['agent/x.md', 'agents/x.md', 'command/c.md', 'commands/c.md', 'skill/s/SKILL.md', 'plugins/p.ts', 'opencode.jsonc']), ['agent', 'agent', 'prompt', 'prompt', 'skill', 'plugin', 'config']);
  assert.deepEqual(kinds('hermes', ['skills/cat/s/SKILL.md', 'profiles/pixel/SOUL.md', 'profiles/pixel/skills/s/SKILL.md', 'config.yaml', 'memories/a.md', 'auth.json']), ['skill', 'profile', 'skill', 'config', 'note', null]);
  assert.deepEqual(kinds('bowerloom', ['skills/s/SKILL.md', 'teams/t/agents/r.md', 'prompts/p.md', 'managed/x.md']), ['skill', 'agent', 'prompt', null]);
});

test('a name comes from the path: the skill folder, the file name, the command folder prefix, the profile folder', () => {
  assert.equal(nameFromPath('claude-code', 'skill', 'skills/write-reply/SKILL.md'), 'write-reply');
  assert.equal(nameFromPath('claude-code', 'skill', 'skills/cat/deep/SKILL.md'), 'deep');
  assert.equal(nameFromPath('claude-code', 'skill', 'skills/flat-one.md'), 'flat-one');
  assert.equal(nameFromPath('claude-code', 'prompt', 'commands/git/commit.md'), 'git:commit');
  assert.equal(nameFromPath('hermes', 'profile', 'profiles/pixel/SOUL.md'), 'pixel');
  assert.equal(nameFromPath('hermes', 'profile', 'SOUL.md'), 'Hermes');
});

test('step one reads no text: a skill is a name from its path and nothing more', () => {
  const r = only(read('claude-code', 'skills/write-reply/SKILL.md', null).records);
  assert.deepEqual([r.kind, r.name, r.description, r.text], ['skill', 'write-reply', '', '']);
});

test('a skill takes its name and description from the front matter, a folded description over several lines, else the first sentence', () => {
  const folded = '---\nname: Weekly summary\ndescription: >\n  Sums up the week\n  from the notes.\nmodel: small\n---\n\n# Weekly\nBody line.\n';
  const a = only(read('claude-code', 'skills/x/SKILL.md', folded).records);
  assert.deepEqual([a.name, a.description, a.partial], ['Weekly summary', 'Sums up the week from the notes.', false]);
  const b = only(read('claude-code', 'skills/y/SKILL.md', '# Title\n\nCheck the totals again. Then stop.\n').records);
  assert.deepEqual([b.name, b.description], ['y', 'Check the totals again.']);
  const c = only(read('claude-code', 'skills/z/SKILL.md', '---\ndescription: "Quoted: with a colon"\n---\nText').records);
  assert.equal(c.description, 'Quoted: with a colon');
});

test('malformed front matter is not an error: the file is listed with a name from its path, flagged as partly read, and simple lines are kept', () => {
  const bad = '---\nname: Broken one\ndescription: fine so far\nthis line has no key\n---\nBody.\n';
  const r = read('claude-code', 'skills/broken/SKILL.md', bad);
  assert.equal(r.partial, true);
  const rec = only(r.records);
  assert.equal(rec.partial, true);
  assert.equal(rec.name, 'Broken one');
  const unclosed = read('claude-code', 'skills/open/SKILL.md', '---\nname: Open\nno end marker\n');
  assert.equal(only(unclosed.records).partial, true);
  assert.equal(parseFrontmatter('no block at all').state, 'none');
});

test('an agent file gives a role, a model, skills, and the tool names it lists', () => {
  const text = '---\nname: reviewer\ndescription: Reads a change and says what is risky.\nmodel: sonnet\nskills: [check-totals, write-reply]\ntools: Read, Grep, mcp__tracker__search\n---\nYou review changes.\n';
  const a = only(read('claude-code', 'agents/reviewer.md', text).records);
  assert.equal(a.kind, 'agent');
  assert.deepEqual([a.meta.role, a.meta.model, a.meta.skills, a.meta.toolNames], ['Reads a change and says what is risky.', 'sonnet', ['check-totals', 'write-reply'], ['Read', 'Grep', 'mcp__tracker__search']]);
});

test('a Codex agent is a TOML file: name, description, model, and the long instruction text', () => {
  const text = 'name = "planner"\ndescription = "Breaks work into steps."\nmodel = "gpt-x"\ndeveloper_instructions = """\nPlan first.\nThen stop.\n"""\n';
  const a = only(read('codex', 'agents/planner.toml', text).records);
  assert.deepEqual([a.kind, a.name, a.description, a.meta.model], ['agent', 'planner', 'Breaks work into steps.', 'gpt-x']);
});

test('connections: only the server name, the program name, the host and the NAMES of variables and headers come out', () => {
  const json = JSON.stringify({ mcpServers: {
    tracker: { command: '/usr/local/bin/node', args: ['server.js', `--token=${FAKE_SECRET}`], env: { TRACKER_API_KEY: FAKE_SECRET, REGION: 'eu' } },
    remote: { type: 'http', url: `https://user:${FAKE_SECRET}@api.example.test/v1/mcp?key=${FAKE_SECRET}`, headers: { Authorization: `Bearer ${FAKE_SECRET}` } },
    inlined: { command: `API_KEY=${FAKE_SECRET} node run.js` },
  } });
  const r = read('claude-code', '.mcp.json', json, { what: 'config', config: 'mcp-json' });
  assert.equal(r.records.length, 3);
  const [tracker, remote, inlined] = r.records;
  assert.deepEqual([tracker!.meta.command, tracker!.meta.envNames], ['node', ['REGION', 'TRACKER_API_KEY']]);
  assert.deepEqual([remote!.meta.host, remote!.meta.headerNames], ['api.example.test', ['Authorization']]);
  assert.equal(inlined!.meta.command, undefined, 'a line that starts with an assignment names no program');
  assert.equal(secretNameOf(tracker!.meta.envNames ?? [], tracker!.meta.headerNames ?? []), 'TRACKER_API_KEY');
  assert.doesNotMatch(JSON.stringify(r), new RegExp(FAKE_SECRET), 'the value is nowhere in the result');
  assert.doesNotMatch(JSON.stringify(r), /user:|--token|server\.js|\/usr\/local/, 'no argument, no login, no folder');
});

test('the home config of Claude Code gives its servers and ignores everything else in the file', () => {
  const json = JSON.stringify({ userID: FAKE_SECRET, oauthAccount: { emailAddress: 'someone@example.test', token: FAKE_SECRET }, projects: { '/a/b': { mcpServers: { hidden: { command: 'x' } } } }, mcpServers: { files: { command: 'npx' } } });
  const r = read('claude-code', '', json, { what: 'config', config: 'claude-json' });
  assert.deepEqual(r.records.map(x => x.name), ['files']);
  assert.doesNotMatch(JSON.stringify(r), new RegExp(`${FAKE_SECRET}|someone@`));
});

test('Codex servers come from TOML tables, inline tables and sub-tables; the notify setting is a hook', () => {
  const toml = [
    'notify = ["/bin/sh", "-c", "echo hi"]', '', '[mcp_servers.docs]', 'command = "npx"', `args = ["-y", "docs", "--key=${FAKE_SECRET}"]`, `env = { DOCS_TOKEN = "${FAKE_SECRET}", MODE = "x" }`, '',
    '[mcp_servers.web]', 'url = "https://web.example.test/mcp?k=1"', 'bearer_token_env_var = "WEB_TOKEN"', '', '[mcp_servers.web.http_headers]', `X-Api-Key = "${FAKE_SECRET}"`, '',
  ].join('\n');
  const r = read('codex', 'config.toml', toml);
  const byName = new Map(r.records.map(x => [x.name, x]));
  assert.deepEqual([...byName.keys()].sort(), ['Notify', 'docs', 'web']);
  assert.deepEqual(byName.get('docs')!.meta.envNames, ['DOCS_TOKEN', 'MODE']);
  assert.deepEqual([byName.get('web')!.meta.host, byName.get('web')!.meta.envNames, byName.get('web')!.meta.headerNames], ['web.example.test', ['WEB_TOKEN'], ['X-Api-Key']]);
  assert.equal(byName.get('Notify')!.kind, 'hook');
  assert.doesNotMatch(JSON.stringify(r), new RegExp(`${FAKE_SECRET}|echo hi|/bin/sh`));
});

test('OpenCode config may hold comments and trailing commas, and gives servers, agents and commands', () => {
  const text = `{\n // a comment\n "mcp": { "search": { "type": "remote", "url": "https://s.example.test/x?t=${FAKE_SECRET}", "headers": { "Authorization": "${FAKE_SECRET}" }, }, "local": { "type": "local", "command": ["node", "a.js"], "environment": { "SEARCH_KEY": "${FAKE_SECRET}" } } },\n "agent": { "docs": { "description": "Writes docs.", "model": "m1", "tools": { "write": false } } },\n "command": { "ship": { "template": "Run the checks", "description": "Ship it" } },\n}`;
  const r = read('opencode', 'opencode.jsonc', text);
  assert.deepEqual(r.records.map(x => `${x.kind}:${x.name}`), ['mcp:search', 'mcp:local', 'agent:docs', 'prompt:ship']);
  assert.doesNotMatch(JSON.stringify(r), new RegExp(FAKE_SECRET));
  assert.equal(r.records[0]!.meta.host, 's.example.test');
});

test('Claude Code hooks give their event and matcher and never the command', () => {
  const text = JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: `./fmt.sh ${FAKE_SECRET}` }] }], Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] }, env: { X: FAKE_SECRET } });
  const r = read('claude-code', 'settings.json', text);
  assert.deepEqual(r.records.map(x => x.name), ['PostToolUse: Edit|Write', 'Stop']);
  assert.ok(r.records.every(x => x.kind === 'hook'));
  assert.doesNotMatch(JSON.stringify(r), /fmt\.sh|say done|zq9/);
});

test('Hermes config lists its servers by name, program and variable names only', () => {
  const yaml = ['model: x', 'mcp_servers:', '  github:', '    command: npx', '    args: ["-y", "gh"]', '    env:', `      GITHUB_TOKEN: ${FAKE_SECRET}`, '  site:', '    url: https://site.example.test/mcp', ''].join('\n');
  const r = read('hermes', 'config.yaml', yaml);
  assert.deepEqual(r.records.map(x => [x.name, x.meta.command ?? '', x.meta.host ?? '', (x.meta.envNames ?? []).join()]), [['github', 'npx', '', 'GITHUB_TOKEN'], ['site', '', 'site.example.test', '']]);
  assert.doesNotMatch(JSON.stringify(r), new RegExp(FAKE_SECRET));
});

test('a file that does not parse gives no record and a flag, never a throw', () => {
  for (const [app, rel, text] of [['claude-code', '.mcp.json', '{not json'], ['codex', 'config.toml', '\u0000\u0001 = = ['], ['hermes', 'config.yaml', 'a: [unclosed\n  b: ]\n- x']] as const) {
    const role = app === 'claude-code' ? { what: 'config', config: 'mcp-json' } as const : classify(app, rel)!;
    const r = recordsOfFile(app, role, rel, rel, text);
    assert.ok(Array.isArray(r.records));
  }
  assert.equal(recordsOfFile('claude-code', { what: 'config', config: 'mcp-json' }, 'a', 'a', '{not json').unreadable, true);
});

test('scrubText hides keys in text and leaves ordinary words alone', () => {
  const text = 'Use sk-abcdefghijklmnop1234 and ghp_abcdefghijklmnopqrstuv. Authorization: Bearer abcdefghijklmnopqrstuv. api_key = "abcd1234efgh5678". password: ${PASSWORD} stays. Plain words stay.';
  const out = scrubText(text);
  assert.doesNotMatch(out, /sk-abcdef|ghp_abcdef|abcdefghijklmnopqrstuv|abcd1234efgh5678/);
  assert.match(out, /password: \$\{PASSWORD\} stays\. Plain words stay\./);
  assert.match(out, /api_key = "\[hidden key\]/);
  assert.equal(scrubText('-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----'), '[hidden key]');
});

test('small helpers: command names, hosts, key names, cut, first sentence', () => {
  assert.equal(commandName('/opt/bin/tool --flag x'), 'tool'); assert.equal(commandName('A=1 tool'), ''); assert.equal(commandName(''), '');
  assert.equal(hostOf('https://u:p@h.example.test:8080/a?b=c'), 'h.example.test'); assert.equal(hostOf('file:///etc/passwd'), ''); assert.equal(hostOf('nope'), '');
  assert.deepEqual(keyNames({ b: 1, a: 2, '': 3 }), ['a', 'b']); assert.deepEqual(keyNames([1]), []); assert.deepEqual(keyNames(null), []);
  assert.equal(cut('one two three four', 100), 'one two three four'); assert.match(cut('word '.repeat(60), 40), /…$/);
  assert.equal(firstSentence('```\ncode\n```\n# H\n\n- First point. Second.'), 'First point.');
  assert.equal(firstSentence(''), '');
});

test('the YAML reader handles maps, lists, flow forms, block text and refuses anchors', () => {
  const y = parseYaml('a: 1\nb:\n  - x\n  - y: 2\n    z: 3\nc: {k: v, "q r": "s"}\nd: |\n  line1\n  line2\ne: # comment\n  f: g\nlong: one\n  two\n');
  assert.deepEqual(y, { a: '1', b: ['x', { y: '2', z: '3' }], c: { k: 'v', 'q r': 's' }, d: 'line1\nline2', e: { f: 'g' }, long: 'one two' });
  assert.throws(() => parseYaml('a: &x 1'));
  assert.throws(() => parseYaml('- a'));
  assert.deepEqual(parseYaml(''), {});
  assert.equal(Object.keys(parseYaml('__proto__: x\na: b')).includes('__proto__'), false);
});

test('the TOML reader handles tables, quoted names, multi-line text, lists and inline tables', () => {
  const t = parseToml('top = "x"\n[a.b]\nk = \'lit\'\n[["c d".e]]\nl = [\n "p",\n "q",\n]\nm = { one = 1, two = "2" }\ns = """\nhello\n"""\n');
  assert.deepEqual(t.map(x => x.path), [[], ['a', 'b'], ['c d', 'e']]);
  assert.deepEqual(t[1]!.values.get('k'), { t: 'str', v: 'lit' });
  assert.deepEqual(t[2]!.values.get('l'), { t: 'arr', v: ['p', 'q'] });
  assert.deepEqual(t[2]!.values.get('m'), { t: 'tbl', keys: ['one', 'two'] });
  assert.deepEqual(t[2]!.values.get('s'), { t: 'str', v: 'hello\n' });
});

test('JSON with comments and trailing commas parses; a comment marker inside a string is kept', () => {
  assert.deepEqual(parseJsonLoose('{ /* c */ "a": "http://x // y", // t\n "b": [1,2,], }'), { a: 'http://x // y', b: [1, 2] });
  assert.throws(() => parseJsonLoose('{'));
});
