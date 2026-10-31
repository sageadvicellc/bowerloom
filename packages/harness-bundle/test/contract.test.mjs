// The stage 1 contract of the harness bundle: the constants, the code table and its words, and the README that states the same table.
// Stage 2 lane A adds the behaviour tests beside this file. The "not built" test below goes when the functions are built.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BUNDLE_CODES, BUNDLE_FILE_SUFFIX, BUNDLE_FORMAT, BUNDLE_LIMITS, BUNDLE_MESSAGES, BundleRefusal, EXPORT_PLAN_FORMAT, IMPORT_PLAN_FORMAT,
  decodeBundle, encodeBundle, exportAcknowledgement, importAcknowledgement, inspectBundle, isEmptyHarness, readBundleFile, targetFromBundle, writeBundleFile,
} from '../../../dist/packages/harness-bundle/src/index.js';
import { DEFINITION_LIMITS } from '../../../dist/packages/harness-definition/src/index.js';
import { DefinitionError } from '../../../dist/packages/contracts/src/index.js';

test('the format strings and the file suffix', () => {
  assert.equal(BUNDLE_FORMAT, 'bowerloom/harness-bundle/v1beta1');
  assert.equal(EXPORT_PLAN_FORMAT, 'bowerloom/harness-export-plan/v1beta1');
  assert.equal(IMPORT_PLAN_FORMAT, 'bowerloom/harness-import-plan/v1beta1');
  assert.equal(BUNDLE_FILE_SUFFIX, '.bowerloom.json');
  const listed = JSON.parse(fs.readFileSync(new URL('../../../apps/docs/tools/after-beta3-formats.json', import.meta.url), 'utf8'));
  for (const format of [BUNDLE_FORMAT, EXPORT_PLAN_FORMAT, IMPORT_PLAN_FORMAT]) assert.ok(listed.includes(format), `${format} is listed for the release notes check`);
});

test('the limits reuse the definition loader limits and add the bundle ones', () => {
  assert.equal(Object.isFrozen(BUNDLE_LIMITS), true);
  assert.deepEqual(
    { files: BUNDLE_LIMITS.files, entryBytes: BUNDLE_LIMITS.entryBytes, totalBytes: BUNDLE_LIMITS.totalBytes, depth: BUNDLE_LIMITS.depth },
    { files: DEFINITION_LIMITS.files, entryBytes: DEFINITION_LIMITS.fileBytes, totalBytes: DEFINITION_LIMITS.totalBytes, depth: DEFINITION_LIMITS.depth },
  );
  assert.deepEqual(
    { fileBytes: BUNDLE_LIMITS.fileBytes, pathChars: BUNDLE_LIMITS.pathChars, segmentBytes: BUNDLE_LIMITS.segmentBytes, jsonDepth: BUNDLE_LIMITS.jsonDepth, notesNames: BUNDLE_LIMITS.notesNames, nameChars: BUNDLE_LIMITS.nameChars, listRows: BUNDLE_LIMITS.listRows, heldBundles: BUNDLE_LIMITS.heldBundles },
    { fileBytes: 48 * 1024 * 1024, pathChars: 1024, segmentBytes: 255, jsonDepth: 6, notesNames: 200, nameChars: 200, listRows: 200, heldBundles: 2 },
  );
  assert.ok(BUNDLE_LIMITS.fileBytes > Math.ceil((BUNDLE_LIMITS.totalBytes * 4) / 3), 'the file limit holds 32 MiB of content in base64 plus the envelope');
});

test('every code has plain words that name what was written and repeat no value', () => {
  assert.deepEqual([...BUNDLE_CODES], Object.keys(BUNDLE_MESSAGES));
  assert.equal(BUNDLE_CODES.length, 12);
  for (const code of BUNDLE_CODES) {
    const words = BUNDLE_MESSAGES[code];
    assert.match(words, /^[A-Z][^\n]*\.$/, code);
    assert.match(words, /Nothing was (?:written|read or written)\.$/, code);
    assert.doesNotMatch(words, /\b(?:can't|don't|doesn't|isn't|won't|cannot)\b/i, `${code}: no contractions`);
    assert.doesNotMatch(words, /[\u0000-\u001f]/, code);
  }
});

test('a BundleRefusal is a DefinitionError with the code, the words and at most 20 paths on one line', () => {
  const plain = new BundleRefusal('BUNDLE_FORMAT');
  assert.ok(plain instanceof DefinitionError && plain instanceof Error);
  assert.equal(plain.code, 'BUNDLE_FORMAT');
  assert.equal(plain.message, BUNDLE_MESSAGES.BUNDLE_FORMAT);
  assert.deepEqual([plain.paths, plain.problems], [[], []]);
  const many = new BundleRefusal('BUNDLE_PATH_UNSAFE', Array.from({ length: 23 }, (_, i) => `skills/s${i}/SKILL.md`));
  assert.match(many.message, /, and 3 more\.$/);
  assert.equal(many.message.includes('\n'), false);
  const hostile = new BundleRefusal('BUNDLE_PATH_UNSAFE', ['a\nb\u001b[31m']);
  assert.equal(/[\u0000-\u001f]/.test(hostile.message), false, 'control characters in a path are escaped');
});

test('the README states the same code table, word for word', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const rows = [...readme.matchAll(/^\| `([A-Z_]+)` \| .* \| (.*) \|$/gm)].map(m => [m[1], m[2]]);
  assert.deepEqual(rows.map(r => r[0]), [...BUNDLE_CODES]);
  for (const [code, words] of rows) assert.equal(words, BUNDLE_MESSAGES[code], code);
});

test('stage 1: every function is declared and throws "not built" until lane A builds it', () => {
  const calls = [
    () => encodeBundle({}), () => decodeBundle(new Uint8Array()), () => inspectBundle({}), () => targetFromBundle({}, { link: {}, leave: [] }), () => isEmptyHarness({}),
    () => exportAcknowledgement({}), () => importAcknowledgement({}, []), () => readBundleFile('/x'), () => writeBundleFile('/x', new Uint8Array()),
  ];
  assert.equal(calls.length, 9);
  for (const call of calls) assert.throws(call, /^Error: not built$/);
});
