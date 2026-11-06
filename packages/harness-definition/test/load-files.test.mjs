// `loadDefinitionFiles` runs the package loader over files held in memory. It gives the result the disk loader gives for the
// same files, so a caller can check a target file set before it writes anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFINITION_LIMITS, loadDefinition, loadDefinitionFiles } from '../../../dist/packages/harness-definition/src/index.js';
import { agent, cleanup, codes, fullFiles, harness, makeDefinition, skill } from './fixture.mjs';

test.after(cleanup);

const toFiles = files => Object.entries(files).filter(([, v]) => v !== undefined).map(([path, v]) => ({ path, bytes: Buffer.from(v) }));
const both = files => ({ disk: loadDefinition(makeDefinition(files)), memory: loadDefinitionFiles(toFiles(files)) });

test('a full definition loads in memory with the revision, entries, and files the disk loader gives', () => {
  const { disk, memory } = both(fullFiles());
  assert.equal(memory.ok, true, JSON.stringify(memory.ok ? null : memory.problems));
  assert.equal(memory.definition.revision, disk.definition.revision);
  assert.deepEqual(memory.definition.entries, disk.definition.entries);
  assert.deepEqual(memory.definition.harness, disk.definition.harness);
  assert.equal(memory.definition.instructions, disk.definition.instructions);
  assert.deepEqual(memory.definition.scriptEntries, disk.definition.scriptEntries);
  assert.deepEqual(memory.definition.enginePrivate, disk.definition.enginePrivate);
  assert.deepEqual(memory.definition.files.map(f => f.path), disk.definition.files.map(f => f.path));
});

test('the order of the files given does not change the result', () => {
  const list = toFiles(fullFiles());
  const a = loadDefinitionFiles(list), b = loadDefinitionFiles([...list].reverse());
  assert.equal(a.definition.revision, b.definition.revision);
});

test('the execute bit given is kept, and the folder label is the one given', () => {
  const list = toFiles(fullFiles()).map(f => f.path === 'scripts/lint.sh' ? { ...f, executable: true } : f);
  const r = loadDefinitionFiles(list, 'memory');
  assert.equal(r.definition.folder, 'memory');
  assert.equal(r.definition.files.find(f => f.path === 'scripts/lint.sh').executable, true);
  assert.equal(r.definition.scriptEntries[0].executable, true);
});

test('the same faults are found as on disk, with the same codes and paths', () => {
  const cases = [
    fullFiles({ 'skills/deploy/SKILL.md': skill('other') }),
    fullFiles({ 'agents/reader.md': agent('reader', 'tools:\n  - teleport\n') }),
    fullFiles({ 'guardrail.json': '{}' }),
    fullFiles({ 'harness.json': undefined }),
    fullFiles({ 'hooks.json': '{ not json' }),
    fullFiles({ 'skills/Bad_Name/SKILL.md': skill('Bad_Name') }),
    fullFiles({ 'skills/empty/notes.md': 'No SKILL.md here.\n' }),
    fullFiles({ 'instructions/OTHER.md': 'x\n' }),
    fullFiles({ 'engines/notepad/x.txt': 'x\n' }),
    fullFiles({ 'instructions/AGENTS.md': 'a\u0000b' }),
  ];
  for (const files of cases) {
    const disk = loadDefinition(makeDefinition(files)), memory = loadDefinitionFiles(toFiles(files));
    assert.equal(memory.ok, disk.ok);
    if (!disk.ok) assert.deepEqual(memory.problems.map(p => `${p.code} ${p.path}`), disk.problems.map(p => `${p.code} ${p.path}`));
  }
});

test('legacy names are accepted at the top and a hidden or odd name is refused', () => {
  assert.equal(loadDefinitionFiles(toFiles(fullFiles({ 'skills.json': '{}' }))).ok, true);
  assert.ok(codes(loadDefinitionFiles(toFiles(fullFiles({ 'skills/deploy/.hidden': 'x' })))).includes('UNEXPECTED_FILE'));
  assert.ok(codes(loadDefinitionFiles(toFiles(fullFiles({ 'skills/deploy/a\\b': 'x' })))).includes('UNEXPECTED_FILE'));
});

test('a path that is not a plain relative path is refused', () => {
  for (const path of ['', '/harness.json', '../harness.json', 'skills/../harness.json', 'skills//x/SKILL.md', './harness.json', 'skills/x/', 'a\\b', 'a\u0000b']) {
    const list = [...toFiles({ 'harness.json': harness() }), { path, bytes: Buffer.from('x') }];
    const r = loadDefinitionFiles(list);
    assert.equal(r.ok, false, JSON.stringify(path));
    assert.ok(codes(r).includes('UNEXPECTED_FILE'), JSON.stringify(path));
  }
});

test('a path used as both a file and a folder, and two paths in different Unicode forms, are refused', () => {
  const base = toFiles({ 'harness.json': harness() });
  assert.ok(codes(loadDefinitionFiles([...base, { path: 'skills', bytes: Buffer.from('x') }, { path: 'skills/a/SKILL.md', bytes: Buffer.from('x') }])).length > 0);
  const composed = 'é.md', decomposed = 'é.md';
  const r = loadDefinitionFiles([...base, { path: `scripts/${composed}`, bytes: Buffer.from('x') }, { path: `scripts/${decomposed}`, bytes: Buffer.from('y') }]);
  assert.ok(codes(r).includes('DUPLICATE_PATH'));
});

test('the same path twice is refused', () => {
  const base = toFiles({ 'harness.json': harness() });
  const r = loadDefinitionFiles([...base, ...base]);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('DUPLICATE_PATH'));
});

test('a definition with no harness.json is refused', () => {
  assert.deepEqual(codes(loadDefinitionFiles([])), ['HARNESS_MISSING']);
  assert.deepEqual(codes(loadDefinitionFiles(toFiles({ 'skills/a/SKILL.md': skill('a') }))), ['HARNESS_MISSING']);
});

test('the file, size, and total limits hold in memory', () => {
  const base = toFiles({ 'harness.json': harness() });
  const huge = { path: 'scripts/huge.bin', bytes: Buffer.alloc(DEFINITION_LIMITS.fileBytes + 1, 97) };
  assert.ok(codes(loadDefinitionFiles([...base, huge])).includes('TOO_LARGE'));
  const many = Array.from({ length: 33 }, (_, i) => ({ path: `scripts/f${i}.bin`, bytes: Buffer.alloc(DEFINITION_LIMITS.fileBytes, 97) }));
  assert.ok(codes(loadDefinitionFiles([...base, ...many])).includes('TOO_LARGE'));
  const tiny = Array.from({ length: DEFINITION_LIMITS.files + 1 }, (_, i) => ({ path: `scripts/d${i % 40}/f${i}.txt`, bytes: Buffer.from('x') }));
  assert.ok(codes(loadDefinitionFiles([...base, ...tiny])).includes('TOO_LARGE'));
});

test('a secret value in memory is found', () => {
  const secret = 'AK' + 'IA' + 'ABCD2345'.repeat(2);
  const r = loadDefinitionFiles(toFiles(fullFiles({ 'scripts/lint.sh': `export K=${secret}\n` })));
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('SECRET_VALUE'));
  assert.ok(!JSON.stringify(r).includes(secret));
});

test('the files given are not changed', () => {
  const list = toFiles(fullFiles());
  const before = list.map(f => Buffer.from(f.bytes).toString('base64'));
  loadDefinitionFiles(list);
  assert.deepEqual(list.map(f => Buffer.from(f.bytes).toString('base64')), before);
});

test('files that are not an array of path and bytes are a refusal, not a throw', () => {
  for (const input of [undefined, null, 'x', {}, [null], [{}], [{ path: 5, bytes: Buffer.from('x') }], [{ path: 'harness.json' }], [{ path: 'harness.json', bytes: 'text' }]]) {
    let r;
    assert.doesNotThrow(() => { r = loadDefinitionFiles(input); });
    assert.equal(r.ok, false);
    assert.ok(r.problems.length > 0);
  }
});
