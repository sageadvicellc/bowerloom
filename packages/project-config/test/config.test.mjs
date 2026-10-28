import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import '../../../dist/tests/support/isolate-home.js';
import { CONFIG_FILE, CONFIG_FORMAT, CONFIG_LIMITS, parseConfig, serializeConfig, readConfig } from '../../../dist/packages/project-config/src/index.js';
import { discoverProject } from '../../../dist/packages/project-context/src/index.js';

const code = expected => error => error?.code === expected;
const EXAMPLE = {
  format: 'bowerloom/project/v1beta1', engines: ['claude-code', 'codex'],
  skills: [{ id: 'house-style', source: 'store' }, { id: 'local-tool', source: 'project' }, { id: 'team-notes', source: 'store', via: ['research'] }],
  prompts: [{ id: 'weekly-update', source: 'store' }],
  teams: [{ id: 'first-team', source: 'project' }, { id: 'research', source: 'store' }],
};
const parse = value => parseConfig(Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)));
const make = patch => ({ ...EXAMPLE, skills: [], prompts: [], teams: [], ...patch });
const ids = (n, prefix = 's') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${String(i).padStart(4, '0')}`, source: 'project' }));

test('constants', () => {
  assert.equal(CONFIG_FILE, 'bowerloom.json'); assert.equal(CONFIG_FORMAT, 'bowerloom/project/v1beta1');
  assert.deepEqual({ ...CONFIG_LIMITS }, { bytes: 1048576, skills: 128, prompts: 128, teams: 32, idLength: 64 });
  assert.ok(Object.isFrozen(CONFIG_LIMITS));
});

test('1. a full example parses and serializeConfig returns the exact bytes', () => {
  const config = parse(EXAMPLE);
  assert.deepEqual(config, EXAMPLE);
  assert.equal(serializeConfig(config), JSON.stringify(EXAMPLE, null, 2) + '\n');
});

test('2. parse then serialize then parse returns an equal value', () => {
  const a = parse(EXAMPLE), b = parse(serializeConfig(a));
  assert.deepEqual(b, a);
  assert.equal(serializeConfig(b), serializeConfig(a));
});

test('3. whitespace variants of the same value parse equal', () => {
  const a = parse(JSON.stringify(EXAMPLE)), b = parse(JSON.stringify(EXAMPLE, null, 4)), c = parse(`\n\t ${JSON.stringify(EXAMPLE, null, '\t')} \r\n`);
  assert.deepEqual(b, a); assert.deepEqual(c, a);
});

test('4. an unknown key, a missing key, a wrong format, a duplicate key, a BOM and invalid UTF-8 each give CONFIG_INVALID', () => {
  const base = JSON.stringify(EXAMPLE);
  for (const [name, bytes] of Object.entries({
    'unknown key': Buffer.from(JSON.stringify({ ...EXAMPLE, extra: 1 })),
    'missing key': Buffer.from(JSON.stringify({ format: EXAMPLE.format, engines: ['claude-code'], skills: [], prompts: [] })),
    'wrong format': Buffer.from(JSON.stringify(make({ format: 'bowerloom/project/v2' }))),
    'duplicate key': Buffer.from(base.replace('"engines"', '"skills":[],"engines"')),
    'bom': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(base)]),
    'invalid utf-8': Buffer.concat([Buffer.from('{"format":"'), Buffer.from([0xff]), Buffer.from('"}')]),
    'not json': Buffer.from('nope'), 'array': Buffer.from('[]'), 'null': Buffer.from('null'), 'empty': Buffer.alloc(0),
    'entry unknown key': Buffer.from(JSON.stringify(make({ skills: [{ id: 'a', source: 'store', extra: 1 }] }))),
    'entry missing source': Buffer.from(JSON.stringify(make({ skills: [{ id: 'a' }] }))),
    'entry not an object': Buffer.from(JSON.stringify(make({ skills: ['a'] }))),
    'list not an array': Buffer.from(JSON.stringify(make({ skills: {} }))),
    'bad source': Buffer.from(JSON.stringify(make({ skills: [{ id: 'a', source: 'elsewhere' }] }))),
    'bad id': Buffer.from(JSON.stringify(make({ skills: [{ id: 'A_b', source: 'project' }] }))),
    'id too long': Buffer.from(JSON.stringify(make({ skills: [{ id: 'a'.repeat(65), source: 'project' }] }))),
    'id not a string': Buffer.from(JSON.stringify(make({ skills: [{ id: 1, source: 'project' }] }))),
  })) assert.throws(() => parseConfig(bytes), code('CONFIG_INVALID'), name);
  assert.throws(() => parseConfig('{}'), code('CONFIG_INVALID'), 'not a buffer');
});

test('5. engines empty, unsorted, repeated or with gemini give CONFIG_INVALID', () => {
  for (const engines of [[], ['codex', 'claude-code'], ['claude-code', 'claude-code'], ['gemini'], ['claude-code', 'codex', 'claude-code'], 'claude-code', [1], ['claude'], ['hermes']]) assert.throws(() => parse(make({ engines })), code('CONFIG_INVALID'), JSON.stringify(engines));
  assert.deepEqual(parse(make({ engines: ['codex'] })).engines, ['codex']);
  assert.deepEqual(parse(make({ engines: ['claude-code', 'codex', 'deepseek-harness', 'opencode', 'pi'] })).engines, ['claude-code', 'codex', 'deepseek-harness', 'opencode', 'pi']);
});

test('6. a list not sorted by id gives CONFIG_INVALID', () => {
  assert.throws(() => parse(make({ skills: [{ id: 'b', source: 'project' }, { id: 'a', source: 'project' }] })), code('CONFIG_INVALID'));
  assert.throws(() => parse(make({ prompts: [{ id: 'b', source: 'project' }, { id: 'a', source: 'project' }] })), code('CONFIG_INVALID'));
  assert.throws(() => parse(make({ teams: [{ id: 'research', source: 'store' }, { id: 'first-team', source: 'project' }] })), code('CONFIG_INVALID'));
});

test('7. a repeated id in one list gives CONFIG_DUPLICATE_ID and the message names it', () => {
  try { parse(make({ skills: [{ id: 'a', source: 'project' }, { id: 'a', source: 'project' }] })); assert.fail('expected a refusal'); }
  catch (e) { assert.equal(e.code, 'CONFIG_DUPLICATE_ID'); assert.equal(e.message, 'bowerloom.json lists skill a twice.'); }
  try { parse(make({ prompts: [{ id: 'p', source: 'store' }, { id: 'p', source: 'store' }] })); assert.fail('expected a refusal'); }
  catch (e) { assert.equal(e.message, 'bowerloom.json lists prompt p twice.'); }
});

test('8. the same id with store and project in one list gives the two-source message', () => {
  try { parse(make({ teams: [{ id: 'dup', source: 'project' }, { id: 'dup', source: 'store' }] })); assert.fail('expected a refusal'); }
  catch (e) { assert.equal(e.code, 'CONFIG_DUPLICATE_ID'); assert.equal(e.message, 'bowerloom.json lists team dup twice: once from store and once from project.'); }
});

test('9. a skill and a prompt with the same id is valid', () => {
  const config = parse(make({ skills: [{ id: 'same', source: 'store' }], prompts: [{ id: 'same', source: 'store' }] }));
  assert.equal(config.skills[0].id, 'same'); assert.equal(config.prompts[0].id, 'same');
});

test('10. via on a project entry, an empty via, an unsorted via, or a via team that is missing or a project team give CONFIG_INVALID', () => {
  const teams = [{ id: 'alpha', source: 'store' }, { id: 'beta', source: 'store' }, { id: 'mine', source: 'project' }];
  const withVia = via => make({ teams, skills: [{ id: 'x', source: 'store', via }] });
  assert.deepEqual(parse(withVia(['alpha', 'beta'])).skills[0].via, ['alpha', 'beta']);
  assert.throws(() => parse(make({ teams, skills: [{ id: 'x', source: 'project', via: ['alpha'] }] })), code('CONFIG_INVALID'), 'via on project entry');
  assert.throws(() => parse(withVia([])), code('CONFIG_INVALID'), 'empty via');
  assert.throws(() => parse(withVia(['beta', 'alpha'])), code('CONFIG_INVALID'), 'unsorted via');
  assert.throws(() => parse(withVia(['alpha', 'alpha'])), code('CONFIG_INVALID'), 'repeated via');
  assert.throws(() => parse(withVia(['ghost'])), code('CONFIG_INVALID'), 'team not in teams');
  assert.throws(() => parse(withVia(['mine'])), code('CONFIG_INVALID'), 'project team');
  assert.throws(() => parse(withVia('alpha')), code('CONFIG_INVALID'), 'not a list');
  assert.throws(() => parse(withVia([1])), code('CONFIG_INVALID'), 'not ids');
  assert.throws(() => parse(make({ teams, teams2: 1 })), code('CONFIG_INVALID'));
});

test('11. a store skill with the id personal-assistant, or the prefix prompt-, gives CONFIG_INVALID; a project skill with it is valid', () => {
  assert.throws(() => parse(make({ skills: [{ id: 'personal-assistant', source: 'store' }] })), code('CONFIG_INVALID'));
  assert.throws(() => parse(make({ skills: [{ id: 'prompt-x', source: 'store' }] })), code('CONFIG_INVALID'));
  assert.equal(parse(make({ skills: [{ id: 'personal-assistant', source: 'project' }] })).skills[0].id, 'personal-assistant');
  assert.throws(() => parse(make({ teams: [{ id: 'first-team', source: 'store' }] })), code('CONFIG_INVALID'));
  assert.equal(parse(make({ teams: [{ id: 'first-team', source: 'project' }] })).teams[0].id, 'first-team');
});

test('12. a store prompt id of 58 characters gives CONFIG_INVALID; 57 is valid', () => {
  assert.throws(() => parse(make({ prompts: [{ id: 'a'.repeat(58), source: 'store' }] })), code('CONFIG_INVALID'));
  assert.equal(parse(make({ prompts: [{ id: 'a'.repeat(57), source: 'store' }] })).prompts[0].id.length, 57);
  assert.equal(parse(make({ prompts: [{ id: 'a'.repeat(64), source: 'project' }] })).prompts[0].id.length, 64);
});

test('13. the list limits: 128 skills, 128 prompts and 32 teams are valid; one more gives CONFIG_LIMIT', () => {
  assert.equal(parse(make({ skills: ids(128) })).skills.length, 128);
  assert.throws(() => parse(make({ skills: ids(129) })), code('CONFIG_LIMIT'));
  assert.equal(parse(make({ prompts: ids(128, 'p') })).prompts.length, 128);
  assert.throws(() => parse(make({ prompts: ids(129, 'p') })), code('CONFIG_LIMIT'));
  assert.equal(parse(make({ teams: ids(32, 't') })).teams.length, 32);
  assert.throws(() => parse(make({ teams: ids(33, 't') })), code('CONFIG_LIMIT'));
});

test('14. parseConfig of 1048576 bytes passes the size check and 1048577 gives CONFIG_LIMIT', () => {
  const pad = n => Buffer.from(JSON.stringify(EXAMPLE) + ' '.repeat(n - JSON.stringify(EXAMPLE).length));
  assert.deepEqual(parseConfig(pad(1048576)), EXAMPLE);
  assert.throws(() => parseConfig(pad(1048577)), code('CONFIG_LIMIT'));
});

function project(t, text, mode = 0o600) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-config-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = path.join(base, 'home'), dir = path.join(home, 'app'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'bowerloom.json');
  if (text !== null) { fs.writeFileSync(file, text, { mode }); fs.chmodSync(file, mode); } else fs.mkdirSync(path.join(dir, '.bowerloom'), { mode: 0o700 });
  return { base, home, dir, file, found: discoverProject(dir, home) };
}

test('15. readConfig: a valid file, a missing file, a parse failure, and the guard failures', t => {
  const text = serializeConfig(parse(EXAMPLE));
  const p = project(t, text);
  const read = readConfig(p.found);
  assert.equal(read.state, 'valid'); assert.deepEqual(read.config, EXAMPLE);
  assert.equal(read.sha256, createHash('sha256').update(text).digest('hex')); assert.equal(read.bytes, Buffer.byteLength(text));
  const none = project(t, null);
  assert.deepEqual(readConfig(none.found), { state: 'absent' });
  for (const [bad, expected] of [['{}', 'CONFIG_INVALID'], [JSON.stringify(make({ skills: ids(129) })), 'CONFIG_LIMIT'], [JSON.stringify(make({ skills: [{ id: 'a', source: 'project' }, { id: 'a', source: 'project' }] })), 'CONFIG_DUPLICATE_ID']]) {
    const q = project(t, bad), r = readConfig(q.found);
    assert.deepEqual(r, { state: 'invalid', code: expected, sha256: createHash('sha256').update(bad).digest('hex'), bytes: Buffer.byteLength(bad) });
  }
  // The file turns unsafe after discovery.
  fs.chmodSync(p.file, 0o660);
  assert.throws(() => readConfig(p.found), code('CONFIG_UNSAFE'));
  fs.chmodSync(p.file, 0o600);
  const big = project(t, text); fs.writeFileSync(big.file, ' '.repeat(1048577));
  assert.throws(() => readConfig(big.found), code('CONFIG_UNSAFE'), 'over 1 MiB');
  // The file is gone after discovery.
  fs.rmSync(p.file); assert.throws(() => readConfig(p.found), code('PROJECT_UNSAFE'));
  // A file that appears in a project that had none.
  fs.writeFileSync(path.join(none.dir, 'bowerloom.json'), text, { mode: 0o600 });
  assert.throws(() => readConfig(none.found), code('PROJECT_UNSAFE'));
});

test('15b. readConfig refuses a file that is swapped for a link between discovery and the read', t => {
  const p = project(t, serializeConfig(parse(EXAMPLE)));
  fs.writeFileSync(path.join(p.base, 'real.json'), serializeConfig(parse(EXAMPLE))); fs.rmSync(p.file); fs.symlinkSync(path.join(p.base, 'real.json'), p.file);
  assert.throws(() => readConfig(p.found), code('CONFIG_UNSAFE'));
});

test('16. the validation order: a file with two faults gives the code of the earlier step (step 5 beats step 7 among them)', () => {
  // A long list (4: limit) and an unknown key (1: keys): keys first.
  assert.throws(() => parse({ ...make({ skills: ids(129) }), extra: 1 }), code('CONFIG_INVALID'));
  // A bad format (2) beats a long list (4).
  assert.throws(() => parse(make({ format: 'x', skills: ids(129) })), code('CONFIG_INVALID'));
  // A long list (4) beats a bad id in the first entry (5).
  assert.throws(() => parse(make({ skills: [{ id: 'BAD', source: 'project' }, ...ids(128)] })), code('CONFIG_LIMIT'));
  // A bad entry (5) beats unsorted (6) and duplicates (7).
  assert.throws(() => parse(make({ skills: [{ id: 'b', source: 'project' }, { id: 'a', source: 'project', x: 1 }, { id: 'a', source: 'project' }] })), code('CONFIG_INVALID'));
  // Unsorted (6) beats duplicates (7).
  assert.throws(() => parse(make({ skills: [{ id: 'b', source: 'project' }, { id: 'a', source: 'project' }, { id: 'a', source: 'project' }] })), code('CONFIG_INVALID'));
  // Duplicates (7) beat a missing via team (8).
  assert.throws(() => parse(make({ skills: [{ id: 'a', source: 'store', via: ['ghost'] }, { id: 'a', source: 'store', via: ['ghost'] }] })), code('CONFIG_DUPLICATE_ID'));
  // Skills are checked before prompts and teams.
  assert.throws(() => parse(make({ skills: [{ id: 'a', source: 'project' }, { id: 'a', source: 'project' }], prompts: [{ id: 'B', source: 'project' }] })), code('CONFIG_INVALID'));
  // The size (0) beats everything.
  assert.throws(() => parseConfig(Buffer.from('x'.repeat(1048577))), code('CONFIG_LIMIT'));
});
