// Spec 06, section 4.1: bowerloom.lock.json, its strict parser, its writer, its reader and its agreement with the config.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import '../../../dist/tests/support/isolate-home.js';
import { LOCK_FILE, LOCK_FORMAT, LOCK_LIMITS, parseLock, serializeLock, readLock, lockAgrees } from '../../../dist/packages/project-config/src/lock.js';
import { parseConfig } from '../../../dist/packages/project-config/src/index.js';
import { discoverProject } from '../../../dist/packages/project-context/src/index.js';
import { serializeEntry, validateEntry } from '../../../dist/packages/skill-manifest/src/schema.js';
import { revisionOf } from '../../../dist/packages/skill-sources/src/validation.js';
import { entryRequest } from '../../../dist/packages/project-sync/src/cache-index.js';
import { npmCollections, gitVerificationLoop } from '../../skill-manifest/test/support/expected.mjs';

const code = expected => error => { if (error?.code !== expected) throw new Error(`expected ${expected}, got ${error?.code ?? error}`); return true; };
const sha = text => createHash('sha256').update(text).digest('hex');
const row = (p, text) => ({ path: p, sha256: sha(text), bytes: Buffer.byteLength(text) });
const REMOTE = 'https://github.com/sageadvicellc/store', COMMIT = '0123456789abcdef0123456789abcdef01234567', TREE = '89abcdef0123456789abcdef0123456789abcdef';
const authored = (kind, id, files, extra = {}) => ({ remote: REMOTE, commit: COMMIT, path: kind === 'prompt' ? `prompts/${id}.md` : `${kind}s/${id}`, tree: TREE, files, hash: revisionOf(files), ...extra });
const NPM_PIN = { id: 'tanstack-db', ...npmCollections() };
const GIT_PIN = { id: 'verification-loop', teams: ['research'], ...gitVerificationLoop() };
function example() {
  return {
    format: LOCK_FORMAT,
    skills: [
      { id: 'house-style', from: 'store', authored: authored('skill', 'house-style', [row('SKILL.md', '---\nname: house-style\n---\nx\n')], { teams: ['research'] }) },
      { id: 'tanstack-db', from: 'store', pin: NPM_PIN },
      { id: 'verification-loop', from: 'store', pin: GIT_PIN },
    ],
    prompts: [{ id: 'weekly-update', from: 'store', authored: authored('prompt', 'weekly-update', [row('weekly-update.md', 'Summarize.\n')]) }],
    teams: [{ id: 'research', from: 'store', authored: authored('team', 'research', [row('agents/lead.md', 'lead\n'), row('team.yaml', 'id: research\n')]) }],
  };
}
/** The exact bytes of 4.1: keys in the order shown, two-space indent, a final newline, each pin as serializeEntry writes it. */
function expectedText(lock) {
  const item = i => i.pin ? { id: i.id, from: i.from, pin: serializeEntry(validateEntry(i.pin)) } : { id: i.id, from: i.from, authored: (({ remote, commit, path: p, tree, files, hash, teams }) => ({ remote, commit, path: p, tree, files, hash, ...(teams ? { teams } : {}) }))(i.authored) };
  return `${JSON.stringify({ format: lock.format, skills: lock.skills.map(item), prompts: lock.prompts.map(item), teams: lock.teams.map(item) }, null, 2)}\n`;
}
const parse = value => parseLock(Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)));
const withSkill = (patch, list = 'skills') => { const lock = example(); lock[list] = [patch]; if (list !== 'skills') lock.skills = []; return lock; };

test('constants', () => {
  assert.equal(LOCK_FILE, 'bowerloom.lock.json'); assert.equal(LOCK_FORMAT, 'bowerloom/lock/v1beta1');
  assert.deepEqual({ ...LOCK_LIMITS }, { bytes: 4194304, skills: 128, prompts: 128, teams: 32, files: 126, fileBytes: 65536, totalBytes: 2097152 });
  assert.ok(Object.isFrozen(LOCK_LIMITS));
});

test('1. a full example with a pin item and an authored item parses, and serializeLock returns the exact bytes of 4.1', () => {
  const lock = parse(example());
  assert.equal(serializeLock(lock), expectedText(example()));
  assert.deepEqual(lock.skills.map(i => i.id), ['house-style', 'tanstack-db', 'verification-loop']);
  assert.equal(lock.skills[1].pin.source.kind, 'npm');
  assert.deepEqual(lock.skills[0].authored.teams, ['research']);
});

test('2. parse, serialize, parse gives an equal value', () => {
  const once = parse(example()), twice = parseLock(Buffer.from(serializeLock(once)));
  assert.deepEqual(twice, once);
  assert.equal(serializeLock(twice), serializeLock(once));
});

test('3. an unknown key, a missing key, both pin and authored, neither, a pin in prompts, and from project each give LOCK_INVALID', () => {
  const pinItem = { id: 'tanstack-db', from: 'store', pin: NPM_PIN }, authoredItem = example().skills[0];
  for (const bad of [
    { ...example(), extra: 1 },
    (({ teams, ...rest }) => rest)(example()),
    withSkill({ ...pinItem, extra: 1 }),
    withSkill({ id: 'tanstack-db', pin: NPM_PIN }),
    withSkill({ ...pinItem, authored: authoredItem.authored }),
    withSkill({ id: 'tanstack-db', from: 'store' }),
    withSkill({ id: 'weekly-update', from: 'store', pin: { ...NPM_PIN, id: 'weekly-update' } }, 'prompts'),
    withSkill({ ...pinItem, from: 'project' }),
    withSkill({ ...authoredItem, authored: { ...authoredItem.authored, extra: 1 } }),
    withSkill({ ...authoredItem, authored: (({ tree, ...rest }) => rest)(authoredItem.authored) }),
    { ...example(), format: 'bowerloom/lock/v1beta2' },
  ]) assert.throws(() => parse(bad), code('LOCK_INVALID'), JSON.stringify(bad).slice(0, 120));
});

test('4. a pin whose id differs from the item id gives LOCK_INVALID', () => {
  assert.throws(() => parse(withSkill({ id: 'other-id', from: 'store', pin: NPM_PIN })), code('LOCK_INVALID'));
});

test('5. a pin that fails validateEntry gives LOCK_INVALID', () => {
  for (const pin of [{ ...NPM_PIN, source: { ...NPM_PIN.source, version: '^1.0.0' } }, { ...NPM_PIN, files: [] }, { id: 'tanstack-db', source: { kind: 'local', path: 'skills/tanstack-db' } }]) {
    assert.throws(() => parse(withSkill({ id: 'tanstack-db', from: 'store', pin })), code('LOCK_INVALID'), JSON.stringify(pin.source));
  }
});

test('6. an authored.hash that is not revisionOf(files) gives LOCK_INVALID', () => {
  const item = example().skills[0];
  assert.throws(() => parse(withSkill({ ...item, authored: { ...item.authored, hash: 'f'.repeat(64) } })), code('LOCK_INVALID'));
  assert.throws(() => parse(withSkill({ ...item, authored: { ...item.authored, hash: 'F'.repeat(64) } })), code('LOCK_INVALID'));
});

test('7. a short commit, an upper-case commit, a path that does not match, .git, a port, or user information in the remote give LOCK_INVALID', () => {
  const item = example().skills[0], a = item.authored;
  for (const authoredValue of [
    { ...a, commit: a.commit.slice(0, 39) },
    { ...a, commit: a.commit.toUpperCase() },
    { ...a, path: 'skills/other' },
    { ...a, path: 'prompts/house-style.md' },
    { ...a, remote: `${REMOTE}.git` },
    { ...a, remote: 'https://github.com:443/sageadvicellc/store' },
    { ...a, remote: 'https://user:pass@github.com/sageadvicellc/store' },
    { ...a, remote: 'https://github.com/SageAdviceLLC/store' },
    { ...a, tree: 'g'.repeat(40) },
  ]) assert.throws(() => parse(withSkill({ ...item, authored: authoredValue })), code('LOCK_INVALID'), JSON.stringify(authoredValue).slice(0, 160));
});

test('8. an empty or unsorted files list gives LOCK_INVALID; more than 126 rows, a file over 65536 bytes, or more than 2 MiB gives LOCK_LIMIT', () => {
  const lockWith = files => withSkill({ id: 'house-style', from: 'store', authored: authored('skill', 'house-style', files) });
  assert.throws(() => parse(lockWith([])), code('LOCK_INVALID'));
  assert.throws(() => parse(lockWith([row('b.md', 'b'), row('a.md', 'a')])), code('LOCK_INVALID'));
  assert.throws(() => parse(lockWith([row('a.md', 'a'), row('a.md', 'a')])), code('LOCK_INVALID'));
  assert.throws(() => parse(lockWith([{ path: 'a.md', sha256: 'a'.repeat(63), bytes: 1 }])), code('LOCK_INVALID'));
  assert.throws(() => parse(lockWith([{ path: 'a.md', sha256: 'a'.repeat(64), bytes: 0 }])), code('LOCK_INVALID'));
  assert.throws(() => parse(lockWith([{ path: 'run.sh', sha256: 'a'.repeat(64), bytes: 1 }])), code('LOCK_INVALID'));
  const many = Array.from({ length: 127 }, (_, i) => ({ path: `f${String(i).padStart(3, '0')}.md`, sha256: 'a'.repeat(64), bytes: 1 }));
  assert.throws(() => parse(lockWith(many)), code('LOCK_LIMIT'));
  assert.equal(parse(lockWith(many.slice(0, 126))).skills[0].authored.files.length, 126);
  assert.throws(() => parse(lockWith([{ path: 'a.md', sha256: 'a'.repeat(64), bytes: 65537 }])), code('LOCK_LIMIT'));
  const big = Array.from({ length: 33 }, (_, i) => ({ path: `f${String(i).padStart(3, '0')}.md`, sha256: 'a'.repeat(64), bytes: 65536 }));
  assert.throws(() => parse(lockWith(big)), code('LOCK_LIMIT'));
  assert.equal(parse(lockWith(big.slice(0, 32))).skills[0].authored.files.length, 32);
});

test('9. teams on a team item gives LOCK_INVALID; an unsorted or empty teams tag too', () => {
  const lock = example();
  lock.teams[0].authored.teams = ['research'];
  assert.throws(() => parse(lock), code('LOCK_INVALID'));
  const item = example().skills[0];
  for (const teams of [['b', 'a'], [], ['a', 'a'], ['Bad']]) assert.throws(() => parse(withSkill({ ...item, authored: { ...item.authored, teams } })), code('LOCK_INVALID'), JSON.stringify(teams));
});

test('10. 129 skills, 129 prompts, 33 teams give LOCK_LIMIT; a file of 4194304 bytes passes and one byte more gives LOCK_LIMIT', () => {
  const item = (kind, i) => { const id = `x-${String(i).padStart(3, '0')}`; return { id, from: 'store', authored: authored(kind, id, [row(kind === 'prompt' ? `${id}.md` : 'a.md', 'x')]) }; };
  const list = (kind, n) => Array.from({ length: n }, (_, i) => item(kind, i));
  assert.throws(() => parse({ format: LOCK_FORMAT, skills: list('skill', 129), prompts: [], teams: [] }), code('LOCK_LIMIT'));
  assert.throws(() => parse({ format: LOCK_FORMAT, skills: [], prompts: list('prompt', 129), teams: [] }), code('LOCK_LIMIT'));
  assert.throws(() => parse({ format: LOCK_FORMAT, skills: [], prompts: [], teams: list('team', 33) }), code('LOCK_LIMIT'));
  assert.equal(parse({ format: LOCK_FORMAT, skills: list('skill', 128), prompts: list('prompt', 128), teams: list('team', 32) }).teams.length, 32);
  const text = serializeLock(parse(example())), padded = text.slice(0, -1) + ' '.repeat(LOCK_LIMITS.bytes - Buffer.byteLength(text)) + '\n';
  assert.equal(Buffer.byteLength(padded), 4194304);
  assert.equal(parseLock(Buffer.from(padded)).skills.length, 3);
  assert.throws(() => parseLock(Buffer.from(padded.slice(0, -1) + ' \n')), code('LOCK_LIMIT'));
});

test('11. merge conflict markers, a byte order mark, a duplicate key, and bytes that are not UTF-8 give LOCK_INVALID', () => {
  const text = serializeLock(parse(example()));
  const lines = text.split('\n'), at = lines.findIndex(l => l.includes('"prompts"'));
  const conflict = [...lines.slice(0, at), '<<<<<<< HEAD', ...lines.slice(at, at + 2), '=======', ...lines.slice(at, at + 2), '>>>>>>> other', ...lines.slice(at + 2)].join('\n');
  assert.throws(() => parseLock(Buffer.from(conflict)), code('LOCK_INVALID'));
  assert.throws(() => parseLock(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)])), code('LOCK_INVALID'));
  assert.throws(() => parseLock(Buffer.from(text.replace('"format": "bowerloom/lock/v1beta1",', '"format": "bowerloom/lock/v1beta1",\n  "format": "bowerloom/lock/v1beta1",'))), code('LOCK_INVALID'));
  assert.throws(() => parseLock(Buffer.from([0x7b, 0xff, 0x7d])), code('LOCK_INVALID'));
  assert.throws(() => parseLock(Buffer.from('')), code('LOCK_INVALID'));
});

/** A project folder with a bowerloom.json, discovered. */
function project(t) {
  const dir = fs.mkdtempSync(path.join(process.env.HOME, 'lock-project-')); fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'bowerloom.json'), JSON.stringify({ format: 'bowerloom/project/v1beta1', harnesses: ['claude', 'codex'], skills: [], prompts: [], teams: [] }), { mode: 0o644 });
  return { dir, context: () => discoverProject(dir, process.env.HOME) };
}

test('12. readLock: a missing file is absent; a link, a folder, two hard links, group write, and another owner each give LOCK_UNSAFE', t => {
  const p = project(t), file = path.join(p.dir, LOCK_FILE), text = serializeLock(parse(example()));
  assert.deepEqual(readLock(p.context()), { state: 'absent' });
  fs.writeFileSync(file, text, { mode: 0o644 });
  const read = readLock(p.context());
  assert.equal(read.state, 'present'); assert.equal(read.sha256, sha(text)); assert.equal(read.bytes, Buffer.byteLength(text));
  assert.deepEqual(read.lock, parse(example()));
  const reset = () => { let s = null; try { s = fs.lstatSync(file); } catch { return; } if (s.isDirectory()) fs.rmSync(file, { recursive: true }); else fs.unlinkSync(file); };
  for (const [name, make] of [
    ['a link', () => { fs.writeFileSync(path.join(p.dir, 'target.json'), text); fs.symlinkSync(path.join(p.dir, 'target.json'), file); }],
    ['a folder', () => { fs.mkdirSync(file); }],
    ['two hard links', () => { fs.writeFileSync(file, text, { mode: 0o644 }); fs.linkSync(file, path.join(p.dir, 'second-link')); }],
    ['group write', () => { fs.writeFileSync(file, text, { mode: 0o664 }); fs.chmodSync(file, 0o664); }],
  ]) {
    reset(); make();
    assert.throws(() => readLock(p.context()), code('LOCK_UNSAFE'), name);
    for (const extra of ['target.json', 'second-link']) fs.rmSync(path.join(p.dir, extra), { force: true });
  }
  reset(); fs.writeFileSync(file, text, { mode: 0o644 });
  const lstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (p2, ...args) => { const s = lstat(p2, ...args); if (String(p2) !== file) return s; const copy = Object.create(Object.getPrototypeOf(s)); Object.assign(copy, s, { uid: typeof s.uid === 'bigint' ? s.uid + 1n : s.uid + 1 }); return copy; });
  syncBuiltinESMExports();
  try { assert.throws(() => readLock(p.context()), code('LOCK_UNSAFE'), 'another owner'); } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  // Too large is LOCK_LIMIT; not parsable is LOCK_INVALID.
  fs.writeFileSync(file, '{"format":');
  assert.throws(() => readLock(p.context()), code('LOCK_INVALID'));
});

test('13. lockAgrees compares the (kind, id) pairs of the store entries only, ignoring via, project entries and harnesses', () => {
  const lock = parse(example());
  const config = parseConfig(Buffer.from(JSON.stringify({
    format: 'bowerloom/project/v1beta1', harnesses: ['codex'],
    skills: [{ id: 'house-style', source: 'store', via: ['research'] }, { id: 'local-tool', source: 'project' }, { id: 'tanstack-db', source: 'store' }, { id: 'verification-loop', source: 'store' }],
    prompts: [{ id: 'weekly-update', source: 'store' }], teams: [{ id: 'first-team', source: 'project' }, { id: 'research', source: 'store' }],
  })));
  assert.deepEqual(lockAgrees(lock, config), { agrees: true, added: [], removed: [] });
  const other = parseConfig(Buffer.from(JSON.stringify({ ...JSON.parse(JSON.stringify(config)), skills: [{ id: 'house-style', source: 'store' }, { id: 'new-skill', source: 'store' }, { id: 'tanstack-db', source: 'project' }, { id: 'verification-loop', source: 'store' }] })));
  assert.deepEqual(lockAgrees(lock, other), { agrees: false, added: ['skill new-skill'], removed: ['skill tanstack-db'] });
});

test('14. for a pin item, entryRequest(pin).digest equals the digest of the store entry it came from', () => {
  const lock = parse(example());
  for (const item of lock.skills.filter(i => i.pin)) {
    const storeEntry = validateEntry(item.id === 'tanstack-db' ? NPM_PIN : GIT_PIN);
    assert.equal(entryRequest(item.pin).digest, entryRequest(storeEntry).digest, item.id);
  }
});

test('15. serializeLock writes pin with serializeEntry, and the bytes match the store entry', () => {
  const text = serializeLock(parse(example())), written = JSON.parse(text).skills.find(i => i.id === 'tanstack-db').pin;
  assert.equal(JSON.stringify(written), JSON.stringify(serializeEntry(validateEntry(NPM_PIN))));
  // The store skills.json writes the same entry with the same bytes, two levels less indented.
  const entryText = JSON.stringify(serializeEntry(validateEntry(NPM_PIN)), null, 2).split('\n').map((l, i) => i === 0 ? l : `      ${l}`).join('\n');
  assert.ok(text.includes(`"pin": ${entryText}`));
});

/** A pinned npm entry of `files` files: LICENSE, SKILL.md, and reference notes. */
function bigPin(id, files) {
  const base = npmCollections(), root = base.skill.sourceRoot;
  const rows = [base.files.find(f => f.path === 'LICENSE'), base.files.find(f => f.path === 'SKILL.md')];
  for (let i = 0; rows.length < files; i++) { const p = `references/note-${String(i).padStart(3, '0')}.md`; rows.push({ path: p, sourcePath: `${root}/${p}`, sha256: sha(p), bytes: 100 + i }); }
  return { id, ...base, files: rows, references: [] };
}

test('16. a lock of 128 pinned items with 64 files each parses; its size is recorded for section 12, item 7', t => {
  const skills = Array.from({ length: 128 }, (_, i) => { const id = `skill-${String(i).padStart(3, '0')}`; return { id, from: 'store', pin: bigPin(id, 64) }; });
  const lock = parse({ format: LOCK_FORMAT, skills, prompts: [], teams: [] });
  const text = serializeLock(lock);
  assert.equal(lock.skills.length, 128);
  assert.ok(Buffer.byteLength(text) <= LOCK_LIMITS.bytes, `the lock is ${Buffer.byteLength(text)} bytes`);
  t.diagnostic(`section 12 item 7: a lock of 128 pins with 64 files each is ${Buffer.byteLength(text)} bytes`);
});

test('17. a lock with 8 distinct authored remotes parses; with 9 it gives LOCK_LIMIT', () => {
  const item = i => { const id = `x-${i}`; return { id, from: 'store', authored: { ...authored('skill', id, [row('SKILL.md', 'x')]), remote: `https://github.com/owner-${i}/store` } }; };
  assert.equal(parse({ format: LOCK_FORMAT, skills: Array.from({ length: 8 }, (_, i) => item(i)), prompts: [], teams: [] }).skills.length, 8);
  assert.throws(() => parse({ format: LOCK_FORMAT, skills: Array.from({ length: 9 }, (_, i) => item(i)), prompts: [], teams: [] }), code('LOCK_LIMIT'));
});

test('lists are sorted by id in byte order with one item per id, and ids follow the store id rules', () => {
  const lock = example();
  lock.skills = [lock.skills[1], lock.skills[0], lock.skills[2]];
  assert.throws(() => parse(lock), code('LOCK_INVALID'));
  const dup = example(); dup.skills = [dup.skills[0], dup.skills[0]];
  assert.throws(() => parse(dup), code('LOCK_INVALID'));
  const reserved = example(); reserved.teams = [{ ...reserved.teams[0], id: 'first-team', authored: { ...reserved.teams[0].authored, path: 'teams/first-team' } }];
  assert.throws(() => parse(reserved), code('LOCK_INVALID'));
});
