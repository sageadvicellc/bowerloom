import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateSkillSource, parseSkillSource, SkillSourceError } from '../../../dist/packages/skill-sources/src/validation.js';
const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const file = (path, text, sourcePath = `skills/example/${path}`) => ({ path, sourcePath, text, sha256: hash(text), mode: 0o644 });
function fixture(kind = 'npm') {
  return {
    format: 'bowerloom/synthetic-skill-source/v1beta1', synthetic: true,
    source: kind === 'npm' ? { kind, registry: 'https://registry.npmjs.org', package: '@synthetic/example', version: '1.0.0', integrity: 'sha512-' + Buffer.alloc(64, 1).toString('base64'), archiveSha256: 'a'.repeat(64), metadataSha256: 'b'.repeat(64), publisher: 'synthetic-fixture', declaredLicense: 'MIT' } : { kind, host: 'github.com', repository: 'synthetic/example', commit: 'a'.repeat(40), tree: 'b'.repeat(40), metadataSha256: 'c'.repeat(64), declaredLicense: 'MIT' },
    skill: { id: 'synthetic-example', name: 'example', sourceRoot: 'skills/example' },
    files: [file('SKILL.md', '---\nname: example\ndescription: Synthetic review fixture.\n---\n# Example\nRead [reference](references/guide.md).\n'), file('references/guide.md', '# Reference\nSynthetic text, never invoked.\n'), file('LICENSE.txt', 'MIT License\nSynthetic license custody fixture; not a real distribution.\n', 'LICENSE')],
    references: [{ from: 'SKILL.md', to: 'references/guide.md' }], license: { spdx: 'MIT', origin: 'included', files: ['LICENSE.txt'] },
  };
}
function refused(value, expected) { assert.throws(() => validateSkillSource(value), e => e instanceof SkillSourceError && (expected ? e.code === expected : /^SKILL_[A-Z_]+$/.test(e.code)) && e.message === e.code); }

test('npm and Git accept only synthetic claims with detached, immutable, deterministic output', () => {
  for (const kind of ['npm', 'git']) {
    const input = fixture(kind), result = validateSkillSource(input);
    assert.equal(result.evidence, 'synthetic-caller-supplied');
    for (const field of ['acquisitionVerified', 'publisherAuthenticated', 'executionAuthorized', 'writesAuthorized', 'grantsAuthority']) assert.equal(result[field], false);
    assert.ok(Object.isFrozen(result.input.files[0]));
    const reversed = clone(input); reversed.files.reverse(); reversed.references.reverse();
    assert.deepEqual(validateSkillSource(reversed), result);
    assert.deepEqual(parseSkillSource(JSON.stringify(input)), result);
    input.files[0].text = 'caller mutation'; assert.notEqual(result.input.files.find(f => f.path === 'SKILL.md').text, input.files[0].text);
  }
});
test('npm immutable identity fields and Git commit/tree affect revisions', () => {
  const mutations = [x => x.source.package = '@synthetic/other', x => x.source.version = '1.0.1', x => x.source.integrity = 'sha512-' + Buffer.alloc(64, 2).toString('base64'), x => x.source.archiveSha256 = 'd'.repeat(64), x => x.source.metadataSha256 = 'e'.repeat(64), x => x.source.publisher = 'other-publisher'];
  const baseline = validateSkillSource(fixture()).revision;
  for (const mutate of mutations) { const x = fixture(); mutate(x); assert.notEqual(validateSkillSource(x).revision, baseline); }
  for (const key of ['commit', 'tree', 'metadataSha256', 'repository']) { const x = fixture('git'), before = validateSkillSource(x).revision; x.source[key] = key === 'repository' ? 'synthetic/other' : 'd'.repeat(key === 'metadataSha256' ? 64 : 40); assert.notEqual(validateSkillSource(x).revision, before); }
});
test('unknown versions, source kinds, ranges, aliases and ambiguous integrity refuse', () => {
  for (const mutate of [x => x.synthetic = false, x => x.format += '-future', x => x.source.token = 'PRIVATE', x => x.source.registry = 'https://other.example', x => x.source.version = 'latest', x => x.source.version = '^1.0.0', x => x.source.version = '01.0.0', x => x.source.version = '1.0.0-01', x => x.source.integrity = 'sha1-abc', x => x.source.integrity += ' ', x => x.source.package = 'https://example.com/x']) { const x = fixture(); mutate(x); refused(x); }
  for (const mutate of [x => x.source.commit = 'main', x => x.source.tree = 'a'.repeat(39), x => x.source.host = 'localhost', x => x.source.repository = 'synthetic/../other']) { const x = fixture('git'); mutate(x); refused(x); }
});
test('Proxy traps, accessors, inherited objects and serialization hooks are inert', () => {
  let touched = 0;
  const proxy = new Proxy({}, { ownKeys() { touched++; throw Error('PRIVATE'); }, get() { touched++; throw Error('PRIVATE'); }, getPrototypeOf() { touched++; throw Error('PRIVATE'); } });
  refused(proxy, 'SKILL_OBJECT'); const x = fixture(); x.files = proxy; refused(x, 'SKILL_OBJECT');
  const getter = fixture(); Object.defineProperty(getter, 'source', { enumerable: true, get() { touched++; throw Error('PRIVATE'); } }); refused(getter, 'SKILL_ACCESSOR');
  const hook = fixture(); hook.toJSON = () => { touched++; throw Error('PRIVATE'); }; refused(hook);
  const exotic = Object.create(fixture()); refused(exotic, 'SKILL_OBJECT'); assert.equal(touched, 0);
  const circular = fixture(); circular.files.push(circular); refused(circular, 'SKILL_OBJECT');
});
test('strict JSON rejects duplicate keys, invalid Unicode and oversized text with fixed diagnostics', () => {
  for (const text of ['{"format":1,"format":2}', '{"x":"\\ud800"}', '{"secret":', ' '.repeat(4 * 1024 * 1024 + 1)]) assert.throws(() => parseSkillSource(text), e => e.code === 'SKILL_JSON' && e.message === 'SKILL_JSON');
  const x = fixture(); x.files[0].text = '\ud800'; refused(x, 'SKILL_ENCODING');
});
test('complete declared closure is mandatory, including backtick and transitive references', () => {
  for (const mutate of [x => x.references = [], x => x.files = x.files.filter(f => f.path !== 'references/guide.md'), x => x.references.push({ from: 'SKILL.md', to: 'absent.md' }), x => x.references.push(clone(x.references[0]))]) { const x = fixture(); mutate(x); refused(x, 'SKILL_REFERENCE'); }
  const x = fixture(); x.files[0] = file('SKILL.md', '---\nname: example\ndescription: Fixture\n---\nRead `references/missing.md`.\n'); refused(x, 'SKILL_REFERENCE');
  const transitive = fixture(); transitive.files[1] = file('references/guide.md', '[missing](other.md)'); refused(transitive, 'SKILL_REFERENCE');
  const traversal = fixture(); traversal.files[1] = file('references/guide.md', '[outside](../../outside.md)'); refused(traversal);
});
test('missing, conflicting, foreign and undeclared license attachments refuse', () => {
  for (const mutate of [x => x.license.files = [], x => { x.license.files = ['absent.txt']; x.files = x.files.filter(f => f.path !== 'LICENSE.txt'); }, x => x.license.spdx = 'Apache-2.0', x => x.license.origin = 'inferred-from-github', x => x.license.files.push('LICENSE.txt'), x => x.files = x.files.filter(f => f.path !== 'LICENSE.txt')]) { const x = fixture(); mutate(x); refused(x, 'SKILL_LICENSE'); }
  // An undeclared package-root attachment fails source custody before missing-license validation.
  const undeclared = fixture(); undeclared.license.files = ['absent.txt']; refused(undeclared, 'SKILL_SOURCE_PATH');
  const x = fixture(); x.files[2] = file('LICENSE.txt', 'Not a license', 'LICENSE'); refused(x, 'SKILL_LICENSE');
  const changed = fixture(); changed.files[2].text += 'Notice changed.\n'; changed.files[2].sha256 = hash(changed.files[2].text); assert.notEqual(validateSkillSource(changed).revision, validateSkillSource(fixture()).revision);
});
test('paths, modes, exact bytes and frontmatter cannot enable scripts or tool authority', () => {
  const edits = [x => x.files[0].path = '../SKILL.md', x => x.files[0].path = '/SKILL.md', x => x.files[0].sourcePath = 'elsewhere/SKILL.md', x => x.files[1].mode = 0o755, x => x.files[1].sha256 = 'a'.repeat(64), x => x.files.push(file('run.sh', 'echo PRIVATE')), x => x.files.push(file('skill.md', 'duplicate')), x => x.files.push(clone(x.files[0]))];
  for (const edit of edits) { const x = fixture(); edit(x); refused(x); }
  for (const header of ['name: other\ndescription: fixture', 'name: example\nname: example\ndescription: fixture', 'name: example\ndescription: fixture\nallowed-tools: Bash', 'name: example\ndescription: fixture\nhooks: {}', 'name: example\ndescription: &a example\nlicense: *a']) { const x = fixture(); x.files[0] = file('SKILL.md', `---\n${header}\n---\n# Body\n`); refused(x, 'SKILL_FRONTMATTER'); }
});
test('bounds refuse sparse arrays, excessive nodes, files and file bytes', () => {
  const sparse = fixture(); sparse.files = new Array(5); refused(sparse, 'SKILL_ARRAY');
  const huge = fixture(); huge.files[0] = file('SKILL.md', 'x'.repeat(65537)); refused(huge, 'SKILL_FILE_BOUND');
  const count = fixture(); count.files = Array.from({ length: 129 }, (_, i) => file(`a${i}.md`, 'x')); refused(count, 'SKILL_FILES');
  const depth = fixture(); let node = depth; for (let i = 0; i < 25; i++) { node.extra = {}; node = node.extra; } refused(depth, 'SKILL_INPUT_BOUND');
});

test('explicit known SPDX frontmatter must agree with declared and attached license', () => {
  const consistent = fixture();
  consistent.files[0] = file('SKILL.md', consistent.files[0].text.replace('description:', 'license: MIT\ndescription:'));
  assert.equal(validateSkillSource(consistent).input.license.spdx, 'MIT');
  const conflicting = clone(consistent); conflicting.files[0].text = conflicting.files[0].text.replace('license: MIT', 'license: Apache-2.0'); conflicting.files[0].sha256 = hash(conflicting.files[0].text);
  refused(conflicting, 'SKILL_FRONTMATTER');
  const pointer = fixture(); pointer.files[0] = file('SKILL.md', pointer.files[0].text.replace('description:', 'license: Complete terms in LICENSE.txt\ndescription:'));
  assert.equal(validateSkillSource(pointer).input.license.origin, 'included');
});
test('SKILL, references and license refuse terminal/control/bidi text while keeping newline and tabs', () => {
  for (const index of [0, 1, 2]) for (const control of ['\u001b[31m', '\u0007', '\u0008', '\u007f', '\u0085', '\u202e', '\u2066', '\u200b', '\r']) {
    const x = fixture(); x.files[index].text += control; x.files[index].sha256 = hash(x.files[index].text); refused(x, 'SKILL_TEXT_CONTROL');
  }
  const okay = fixture();
  for (const f of okay.files) { f.text = f.text.replaceAll('\n', '\r\n') + '\tIndented ordinary text.\r\n'; f.sha256 = hash(f.text); }
  const result = validateSkillSource(okay); assert.ok(result.input.files.every(f => f.text.endsWith('\tIndented ordinary text.\r\n')));
  const decoded = fixture(); decoded.files[0] = file('SKILL.md', '---\nname: example\ndescription: "\\u001b[31m"\n---\nText\n'); refused(decoded, 'SKILL_FRONTMATTER');
});
