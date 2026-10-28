// Step 0 of Bowerloom 0.8: the engine rename. `Harness` in the sense of a coding tool became `Engine`, the field
// `harnesses` became `engines`, and the id `claude` became `claude-code`. Old files still read, are never changed by a
// read, and keep their form when Bowerloom writes them back. New files use the new names.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  ENGINE_IDS, WRITER_ENGINE_IDS, DEFAULT_ENGINES, isEngine, isWriterEngine, parseEngineId, engineFromOldId, oldIdOf, writerEngines, EngineWriterRefusal,
} from '../../../dist/packages/skill-manifest/src/engine.js';
import { addLocalEntry, planManifestChange, applyManifestChange, readManifestState } from '../../../dist/packages/skill-manifest/src/add.js';
import { parseManifest, serializeManifest, MANIFEST_LIMITS } from '../../../dist/packages/skill-manifest/src/schema.js';
import { checkManifest } from '../../../dist/packages/skill-manifest/src/check.js';
import { withProjectLock } from '../../../dist/packages/project-context/src/index.js';

const code = expected => error => error?.code === expected;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const LOCAL = [{ id: 'house-style', source: { kind: 'local', path: 'skills/house-style' } }];
const text = value => JSON.stringify(value, null, 2) + '\n';
const OLD = text({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: LOCAL });
const OLD_CLAUDE_ONLY = text({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude'], skills: LOCAL });
const NEW = text({ format: 'bowerloom/skills/v1beta1', engines: ['claude-code', 'codex'], skills: LOCAL });
const FIVE = text({ format: 'bowerloom/skills/v1beta1', engines: ['claude-code', 'codex', 'deepseek-harness', 'opencode', 'pi'], skills: LOCAL });
const parse = value => parseManifest(Buffer.from(value), MANIFEST_LIMITS);
function project(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-engines-'))); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.bowerloom'), { mode: 0o755 }); fs.chmodSync(path.join(dir, '.bowerloom'), 0o755);
  return { dir, file: path.join(dir, '.bowerloom', 'skills.json') };
}
const locked = (dir, work) => withProjectLock(dir, new AbortController().signal, async held => work(held));
const newEntry = { id: 'brand-voice', source: { kind: 'local', path: 'skills/brand-voice' } };

test('the canonical engine list holds the five ids of the 0.8 definition, once, and cannot be changed', () => {
  assert.deepEqual([...ENGINE_IDS], ['claude-code', 'codex', 'opencode', 'pi', 'deepseek-harness']);
  assert.ok(Object.isFrozen(ENGINE_IDS) && Object.isFrozen(WRITER_ENGINE_IDS));
  assert.deepEqual([...WRITER_ENGINE_IDS], ['claude-code', 'codex'], 'only Claude Code and Codex have a writer today');
  assert.deepEqual([...DEFAULT_ENGINES], ['claude-code', 'codex']);
  for (const id of ENGINE_IDS) assert.equal(isEngine(id), true, id);
  for (const id of ['claude', 'hermes', 'Claude-Code', '', 'harness', null, undefined, 7]) assert.equal(isEngine(id), false, String(id));
  assert.deepEqual(ENGINE_IDS.filter(isWriterEngine), ['claude-code', 'codex']);
});

test('the old ids map to the new ones, and only claude and codex ever existed', () => {
  assert.equal(engineFromOldId('claude'), 'claude-code'); assert.equal(engineFromOldId('codex'), 'codex');
  for (const id of ['claude-code', 'opencode', 'pi', 'deepseek-harness', 'hermes', '', null]) assert.equal(engineFromOldId(id), undefined, String(id));
  assert.equal(oldIdOf('claude-code'), 'claude'); assert.equal(oldIdOf('codex'), 'codex'); assert.equal(oldIdOf('pi'), 'pi');
  assert.equal(parseEngineId('claude'), 'claude-code'); assert.equal(parseEngineId('claude-code'), 'claude-code'); assert.equal(parseEngineId('pi'), 'pi'); assert.equal(parseEngineId('hermes'), undefined);
});

test('an engine without a writer is refused with a typed refusal that names it', () => {
  assert.deepEqual(writerEngines(['claude-code', 'codex']), ['claude-code', 'codex']);
  for (const id of ['opencode', 'pi', 'deepseek-harness']) {
    assert.throws(() => writerEngines(['claude-code', id]), error => error instanceof EngineWriterRefusal && error.code === 'ENGINE_NO_WRITER' && error.engine === id && error.message === `no writer for engine ${id} yet`, id);
  }
});

test('an old skills.json reads through the mapping: harnesses becomes engines and claude becomes claude-code', () => {
  assert.deepEqual([...parse(OLD).engines], ['claude-code', 'codex']);
  assert.deepEqual([...parse(OLD_CLAUDE_ONLY).engines], ['claude-code']);
  assert.deepEqual([...parse(NEW).engines], ['claude-code', 'codex']);
  assert.deepEqual([...parse(FIVE).engines], ['claude-code', 'codex', 'deepseek-harness', 'opencode', 'pi'], 'a current file may name any engine; the writers refuse the ones without a writer');
  assert.equal(parse(OLD).harnesses, undefined, 'the old name is gone from the value in memory');
});

test('serialize after parse keeps the form of the file: an old file stays old, a current file stays current', () => {
  for (const bytes of [OLD, OLD_CLAUDE_ONLY, NEW, FIVE]) assert.equal(serializeManifest(parse(bytes), MANIFEST_LIMITS), bytes);
});

test('the old form accepts claude and codex only, and the current form accepts current ids only', () => {
  const bad = engines => key => () => parse(text({ format: 'bowerloom/skills/v1beta1', [key]: engines, skills: LOCAL }));
  for (const engines of [['opencode'], ['pi'], ['claude-code'], ['claude', 'claude-code'], ['codex', 'claude'], ['claude', 'claude'], []]) assert.throws(bad(engines)('harnesses'), code('MANIFEST_INVALID'), `harnesses ${JSON.stringify(engines)}`);
  for (const engines of [['claude'], ['claude', 'codex'], ['codex', 'claude-code'], ['claude-code', 'claude-code'], ['hermes'], [], 'claude-code']) assert.throws(bad(engines)('engines'), code('MANIFEST_INVALID'), `engines ${JSON.stringify(engines)}`);
  assert.throws(() => parse(text({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude'], engines: ['claude-code'], skills: LOCAL })), code('MANIFEST_INVALID'), 'both keys');
  assert.throws(() => parse(text({ format: 'bowerloom/skills/v1beta1', skills: LOCAL })), code('MANIFEST_INVALID'), 'neither key');
});

test('a new manifest uses engines and claude-code; one built from an old manifest keeps harnesses and claude', () => {
  const fresh = addLocalEntry(null, 'house-style', [], MANIFEST_LIMITS);
  assert.deepEqual(JSON.parse(serializeManifest(fresh, MANIFEST_LIMITS)), { format: 'bowerloom/skills/v1beta1', engines: ['claude-code', 'codex'], skills: LOCAL });
  assert.deepEqual([...fresh.engines], ['claude-code', 'codex']);
  const grown = addLocalEntry(parse(OLD), 'brand-voice', [], MANIFEST_LIMITS);
  assert.deepEqual(JSON.parse(serializeManifest(grown, MANIFEST_LIMITS)), { format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: [{ id: 'brand-voice', source: { kind: 'local', path: 'skills/brand-voice' } }, ...LOCAL] });
  const current = addLocalEntry(parse(NEW), 'brand-voice', [], MANIFEST_LIMITS);
  assert.ok(JSON.parse(serializeManifest(current, MANIFEST_LIMITS)).engines);
});

test('reading an old skills.json never changes it, byte for byte', t => {
  const p = project(t); fs.writeFileSync(p.file, OLD, { mode: 0o644 }); fs.chmodSync(p.file, 0o644);
  const before = fs.readFileSync(p.file), stat = fs.statSync(p.file);
  const check = checkManifest(p.dir);
  assert.deepEqual(check.engines, ['claude-code', 'codex']); assert.equal(check.harnesses, undefined);
  assert.equal(check.sha256, sha(before));
  readManifestState(p.dir); planManifestChange(p.dir, { add: newEntry });
  assert.deepEqual(fs.readFileSync(p.file), before);
  assert.equal(fs.statSync(p.file).mtimeMs, stat.mtimeMs); assert.equal(fs.statSync(p.file).ino, stat.ino);
  assert.deepEqual(fs.readdirSync(path.join(p.dir, '.bowerloom')), ['skills.json'], 'no temporary file is left behind');
});

test('writing back an old skills.json keeps the old form; creating one uses the new form', async t => {
  const old = project(t); fs.writeFileSync(old.file, OLD, { mode: 0o644 }); fs.chmodSync(old.file, 0o644);
  const plan = planManifestChange(old.dir, { add: newEntry });
  await locked(old.dir, held => applyManifestChange(plan, plan.revision, held));
  const written = JSON.parse(fs.readFileSync(old.file, 'utf8'));
  assert.deepEqual(written.harnesses, ['claude', 'codex']); assert.equal(written.engines, undefined);
  assert.deepEqual(written.skills.map(s => s.id), ['brand-voice', 'house-style']);
  assert.deepEqual([...checkManifest(old.dir).engines], ['claude-code', 'codex']);

  const fresh = project(t);
  const first = planManifestChange(fresh.dir, { add: newEntry });
  await locked(fresh.dir, held => applyManifestChange(first, first.revision, held));
  const created = JSON.parse(fs.readFileSync(fresh.file, 'utf8'));
  assert.deepEqual(created.engines, ['claude-code', 'codex']); assert.equal(created.harnesses, undefined);
  // And a second write to the file Bowerloom created stays in the new form.
  const second = planManifestChange(fresh.dir, { add: { id: 'house-style', source: { kind: 'local', path: 'skills/house-style' } } });
  await locked(fresh.dir, held => applyManifestChange(second, second.revision, held));
  assert.deepEqual(JSON.parse(fs.readFileSync(fresh.file, 'utf8')).engines, ['claude-code', 'codex']);
});

test('removing an entry from an old skills.json keeps the old form', async t => {
  const p = project(t); fs.writeFileSync(p.file, text({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude'], skills: [...LOCAL, newEntry] }), { mode: 0o644 }); fs.chmodSync(p.file, 0o644);
  const plan = planManifestChange(p.dir, { remove: 'brand-voice' });
  await locked(p.dir, held => applyManifestChange(plan, plan.revision, held));
  assert.equal(fs.readFileSync(p.file, 'utf8'), OLD_CLAUDE_ONLY);
});
