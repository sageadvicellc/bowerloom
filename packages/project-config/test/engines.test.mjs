// Step 0 of Bowerloom 0.8: bowerloom.json and the engine rename. See packages/skill-manifest/test/engines.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import '../../../dist/tests/support/isolate-home.js';
import { CONFIG_FILE, parseConfig, serializeConfig, readConfig } from '../../../dist/packages/project-config/src/index.js';
import { discoverProject } from '../../../dist/packages/project-context/src/index.js';

const code = expected => error => error?.code === expected;
const BODY = { skills: [{ id: 'house-style', source: 'store' }], prompts: [], teams: [] };
const text = value => JSON.stringify(value, null, 2) + '\n';
const OLD = text({ format: 'bowerloom/project/v1beta1', harnesses: ['claude', 'codex'], ...BODY });
const NEW = text({ format: 'bowerloom/project/v1beta1', engines: ['claude-code', 'codex'], ...BODY });
const FIVE = text({ format: 'bowerloom/project/v1beta1', engines: ['claude-code', 'codex', 'deepseek-harness', 'opencode', 'pi'], ...BODY });
const parse = value => parseConfig(Buffer.from(value));

test('an old bowerloom.json reads through the mapping', () => {
  const config = parse(OLD);
  assert.deepEqual([...config.engines], ['claude-code', 'codex']); assert.equal(config.harnesses, undefined);
  assert.deepEqual([...parse(NEW).engines], ['claude-code', 'codex']);
  assert.deepEqual([...parse(FIVE).engines], ['claude-code', 'codex', 'deepseek-harness', 'opencode', 'pi']);
  assert.deepEqual([...parse(text({ format: 'bowerloom/project/v1beta1', harnesses: ['codex'], ...BODY })).engines], ['codex']);
});

test('serialize after parse gives the bytes of the file: the form is kept', () => {
  for (const bytes of [OLD, NEW, FIVE]) assert.equal(serializeConfig(parse(bytes)), bytes);
});

test('a copy of an old config with a new list of skills is written in the old form; a config made from nothing is written in the new form', () => {
  const grown = { ...parse(OLD), skills: [{ id: 'a-skill', source: 'project' }, { id: 'house-style', source: 'store' }] };
  assert.deepEqual(JSON.parse(serializeConfig(grown)).harnesses, ['claude', 'codex']); assert.equal(JSON.parse(serializeConfig(grown)).engines, undefined);
  const made = { format: 'bowerloom/project/v1beta1', engines: ['claude-code', 'codex'], skills: [], prompts: [], teams: [] };
  assert.deepEqual(JSON.parse(serializeConfig(made)), { format: 'bowerloom/project/v1beta1', engines: ['claude-code', 'codex'], skills: [], prompts: [], teams: [] });
});

test('the old form takes claude and codex only; the current form takes current ids only; one key, not two', () => {
  const make = (key, list) => text({ format: 'bowerloom/project/v1beta1', [key]: list, ...BODY });
  for (const list of [['opencode'], ['claude-code'], ['codex', 'claude'], ['claude', 'claude'], []]) assert.throws(() => parse(make('harnesses', list)), code('CONFIG_INVALID'), `harnesses ${JSON.stringify(list)}`);
  for (const list of [['claude'], ['claude', 'codex'], ['pi', 'opencode'], ['claude-code', 'claude-code'], ['hermes'], []]) assert.throws(() => parse(make('engines', list)), code('CONFIG_INVALID'), `engines ${JSON.stringify(list)}`);
  assert.throws(() => parse(text({ format: 'bowerloom/project/v1beta1', harnesses: ['claude'], engines: ['claude-code'], ...BODY })), code('CONFIG_INVALID'));
});

test('reading an old bowerloom.json from a project never changes it, byte for byte', t => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.homedir()), '.bowerloom-engines-'))); fs.chmodSync(base, 0o700); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = path.join(base, 'home'), dir = path.join(base, 'project'); fs.mkdirSync(home, { mode: 0o700 }); fs.mkdirSync(dir, { mode: 0o755 });
  const file = path.join(dir, CONFIG_FILE); fs.writeFileSync(file, OLD, { mode: 0o644 }); fs.chmodSync(file, 0o644);
  const before = fs.readFileSync(file), stat = fs.statSync(file);
  const read = readConfig(discoverProject(dir, home));
  assert.equal(read.state, 'valid'); assert.deepEqual([...read.config.engines], ['claude-code', 'codex']);
  assert.equal(read.sha256, createHash('sha256').update(before).digest('hex'));
  assert.deepEqual(fs.readFileSync(file), before); assert.equal(fs.statSync(file).mtimeMs, stat.mtimeMs); assert.equal(fs.statSync(file).ino, stat.ino);
});

// ---- Review of e1bbce9: L5 and I2.
import { serializeConfigFrom } from '../../../dist/packages/project-config/src/index.js';

test('L5. a refused engine list names the first id it does not take', () => {
  const refusal = (key, list) => { try { parse(text({ format: 'bowerloom/project/v1beta1', [key]: list, ...BODY })); } catch (error) { return error; } assert.fail('expected a refusal'); };
  assert.equal(refusal('harnesses', ['pi']).code, 'CONFIG_INVALID'); assert.match(refusal('harnesses', ['pi']).message, /"pi"/);
  assert.match(refusal('engines', ['claude']).message, /"claude"/);
  assert.match(refusal('engines', ['codex', 'claude-code']).message, /sorted/);
  assert.doesNotMatch(refusal('engines', ['x\u001b[31m']).message, /\u001b/);
});

test('I2. a config rebuilt without the form of the file it came from is refused on write', () => {
  const before = parse(OLD), next = { ...before, skills: [{ id: 'a-skill', source: 'project' }, ...before.skills] };
  assert.equal(JSON.parse(serializeConfigFrom(before, next)).harnesses.length, 2, 'a copy made the usual way keeps the old form');
  const flipped = { ...next }; delete flipped.oldForm;
  assert.throws(() => serializeConfigFrom(before, flipped), code('CONFIG_INVALID'));
  const fresh = parse(NEW);
  assert.throws(() => serializeConfigFrom(fresh, { ...fresh, oldForm: true }), code('CONFIG_INVALID'));
  assert.equal(JSON.parse(serializeConfigFrom(null, flipped)).engines.length, 2, 'a file that does not exist yet takes the form it is given');
});
