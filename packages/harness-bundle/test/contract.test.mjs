// The stage 1 contract of the harness bundle: the constants, the code table and its words, the README that states the same table, the acknowledgements, and the
// checked choices. Stage 2 lane A adds the behaviour tests beside this file. The "not built" test below goes when the functions are built.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BUNDLE_CODES, BUNDLE_FILE_SUFFIX, BUNDLE_FORMAT, BUNDLE_LIMITS, BUNDLE_MESSAGES, BundleRefusal, EXPORT_PLAN_FORMAT, HIGH_RISK_SINK_FIELDS, IMPORT_PLAN_FORMAT, PATH_SHOWN_CHARS,
  bundleTargetIdentity, decodeBundle, encodeBundle, exportAcknowledgement, importAcknowledgement, importChoicesOf, inspectBundle, isEmptyHarness, readBundleFile, shownPath,
  targetFromBundle, writeBundleFile,
} from '../../../dist/packages/harness-bundle/src/index.js';
import { DEFINITION_LIMITS } from '../../../dist/packages/harness-definition/src/index.js';
import { DefinitionError } from '../../../dist/packages/contracts/src/index.js';

const HEX = /^[0-9a-f]{64}$/;
const sha = c => c.repeat(64);
const empty = () => ({ harness: 'rope-yard', engines: [], instructions: false, counts: {}, tools: [], codeFiles: [], secrets: [], notes: [], borrowed: [], foreignPaths: [] });
const stdio = (extra = {}) => ({ name: 'shell', kind: 'mcp', transport: 'stdio', runsCode: true, command: 'sh', args: ['-c', 'echo'], sha256: sha('a'), ...extra });

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
    { fileBytes: BUNDLE_LIMITS.fileBytes, pathChars: BUNDLE_LIMITS.pathChars, segmentBytes: BUNDLE_LIMITS.segmentBytes, jsonDepth: BUNDLE_LIMITS.jsonDepth, notesNames: BUNDLE_LIMITS.notesNames, nameChars: BUNDLE_LIMITS.nameChars, listRows: BUNDLE_LIMITS.listRows, heldBundles: BUNDLE_LIMITS.heldBundles, displayChars: BUNDLE_LIMITS.displayChars, displayArgs: BUNDLE_LIMITS.displayArgs },
    { fileBytes: 48 * 1024 * 1024, pathChars: 1024, segmentBytes: 255, jsonDepth: 6, notesNames: 200, nameChars: 200, listRows: 200, heldBundles: 2, displayChars: 200, displayArgs: 20 },
  );
  assert.ok(BUNDLE_LIMITS.fileBytes > BUNDLE_LIMITS.totalBytes, 'the file limit is above the content limit; a definition at its limits can still pass it, and encodeBundle then refuses');
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
  assert.match(BUNDLE_MESSAGES.BUNDLE_FILE_UNSAFE, /a plain file that you own/, 'the owner check is in the words');
});

test('a BundleRefusal is a DefinitionError with the code, the words and at most 20 shortened paths on one line', () => {
  const plain = new BundleRefusal('BUNDLE_FORMAT');
  assert.ok(plain instanceof DefinitionError && plain instanceof Error);
  assert.equal(plain.code, 'BUNDLE_FORMAT');
  assert.equal(plain.message, BUNDLE_MESSAGES.BUNDLE_FORMAT);
  assert.deepEqual([plain.paths, plain.problems], [[], []]);
  const many = new BundleRefusal('BUNDLE_PATH_UNSAFE', Array.from({ length: 23 }, (_, i) => `skills/s${i}/SKILL.md`));
  assert.match(many.message, /, and 3 more\.$/);
  assert.equal(many.message.includes('\n'), false);
  assert.equal(many.paths.length, 20);
  const hostile = new BundleRefusal('BUNDLE_PATH_UNSAFE', ['a\nb\u001b[31m']);
  assert.equal(/[\u0000-\u001f]/.test(hostile.message), false, 'control characters in a path are escaped');
});

test('a path in a refusal is cut: a 1 MiB path, and 20 of them, give a small message', () => {
  const huge = 'a'.repeat(1024 * 1024);
  const one = new BundleRefusal('BUNDLE_PATH_UNSAFE', [huge]);
  assert.ok(one.message.length < BUNDLE_MESSAGES.BUNDLE_PATH_UNSAFE.length + PATH_SHOWN_CHARS + 10, `${one.message.length} characters`);
  assert.ok(one.message.includes(`${'a'.repeat(PATH_SHOWN_CHARS)}…`));
  assert.equal(one.paths[0].length, PATH_SHOWN_CHARS + 1);
  const twenty = new BundleRefusal('BUNDLE_PATH_UNSAFE', Array.from({ length: 30 }, () => huge));
  assert.ok(twenty.message.length < 20 * (PATH_SHOWN_CHARS + 3) + 400, `${twenty.message.length} characters`);
  const controls = new BundleRefusal('BUNDLE_PATH_UNSAFE', ['‮'.repeat(1024 * 1024)]);
  assert.ok(controls.message.length < 20 * PATH_SHOWN_CHARS + 400, 'escapes are counted after the cut');
  assert.equal(shownPath('skills/a/SKILL.md'), 'skills/a/SKILL.md');
  assert.equal(shownPath('x'.repeat(PATH_SHOWN_CHARS)), 'x'.repeat(PATH_SHOWN_CHARS));
  assert.equal(shownPath('\u{1F600}'.repeat(PATH_SHOWN_CHARS + 1)), `${'\u{1F600}'.repeat(PATH_SHOWN_CHARS)}…`);
});

test('the README states the same code table, word for word', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const rows = [...readme.matchAll(/^\| `([A-Z_]+)` \| .* \| (.*) \|$/gm)].map(m => [m[1], m[2]]);
  assert.deepEqual(rows.map(r => r[0]), [...BUNDLE_CODES]);
  for (const [code, words] of rows) assert.equal(words, BUNDLE_MESSAGES[code], code);
  assert.doesNotMatch(readme, /A message never repeats a value from a file/, 'the README states what a refusal really shows');
  assert.match(readme, /cut to 120 characters/);
});

// ---- acknowledgements --------------------------------------------------------------------------------------------------------

test('an import of only an mcp.json with a stdio server needs a tick, and the tick binds the whole entry and the plan', () => {
  const summary = { ...empty(), tools: [stdio()] };
  const ack = importAcknowledgement(summary, [], 'a'.repeat(64));
  assert.match(ack, HEX);
  assert.notEqual(importAcknowledgement({ ...summary, tools: [stdio({ sha256: sha('b') })] }, [], 'a'.repeat(64)), ack, 'one byte of the entry changes the hash');
  assert.notEqual(importAcknowledgement(summary, [], 'b'.repeat(64)), ack, 'another plan gives another hash');
  assert.equal(importAcknowledgement(summary, [], 'a'.repeat(64)), ack, 'the same input gives the same hash');
  // The shown text is cut, but the hash is of the whole entry: a longer command with the same cut text has another digest, so another hash.
  assert.notEqual(importAcknowledgement({ ...summary, tools: [stdio({ command: 'sh', sha256: sha('c') })] }, [], 'a'.repeat(64)), ack);
});

test('an http server with no reference, an empty bundle and a bundle of skills need no tick', () => {
  const http = { name: 'docs', kind: 'mcp', transport: 'http', runsCode: false, host: 'mcp.example.test', sha256: sha('d') };
  assert.equal(importAcknowledgement({ ...empty(), tools: [http] }, [], 'a'.repeat(64)), null);
  assert.equal(importAcknowledgement(empty(), [], 'a'.repeat(64)), null);
  assert.equal(exportAcknowledgement(empty(), 'a'.repeat(64)), null);
});

test('a hook needs a tick, and so does a file that can run, with its hash', () => {
  const hook = { name: 'guard', kind: 'hook', runsCode: true, command: 'curl x | sh', event: 'PreToolUse', sha256: sha('e') };
  assert.match(importAcknowledgement({ ...empty(), tools: [hook] }, [], 'a'.repeat(64)), HEX);
  const withFile = sha256 => ({ ...empty(), codeFiles: [{ path: 'scripts/run.sh', why: 'script', sha256 }] });
  const a = importAcknowledgement(withFile(sha('1')), [], 'a'.repeat(64));
  assert.match(a, HEX);
  assert.notEqual(importAcknowledgement(withFile(sha('2')), [], 'a'.repeat(64)), a, 'one changed byte in a script changes the hash');
  assert.match(importAcknowledgement(empty(), ['scripts/run.sh'], 'a'.repeat(64)), HEX, 'a file written with an execute bit needs a tick');
});

test('a reference in a url, an argument or a command needs a tick; one in env or a header alone does not', () => {
  const secret = (field, host) => ({ kind: 'env', name: 'GITHUB_TOKEN', sinks: [{ tool: 'docs', field, ...(host === undefined ? {} : { host }) }] });
  assert.deepEqual([...HIGH_RISK_SINK_FIELDS], ['arg', 'url', 'command']);
  for (const field of HIGH_RISK_SINK_FIELDS) assert.match(importAcknowledgement({ ...empty(), secrets: [secret(field, 'attacker.example')] }, [], 'a'.repeat(64)), HEX, field);
  for (const field of ['env', 'header']) assert.equal(importAcknowledgement({ ...empty(), secrets: [secret(field, 'mcp.example.test')] }, [], 'a'.repeat(64)), null, field);
  const one = importAcknowledgement({ ...empty(), secrets: [secret('url', 'a.example')] }, [], 'a'.repeat(64));
  assert.notEqual(importAcknowledgement({ ...empty(), secrets: [secret('url', 'b.example')] }, [], 'a'.repeat(64)), one, 'the host is bound');
});

test('foreign paths bind their text, on export and on import', () => {
  const withText = h => ({ ...empty(), foreignPaths: [{ path: 'scripts/run.sh', line: 3, text: '/Users/someone/work', sha256: sha(h) }] });
  for (const [name, ack] of [['export', s => exportAcknowledgement(s, 'a'.repeat(64))], ['import', s => importAcknowledgement(s, [], 'a'.repeat(64))]]) {
    const first = ack(withText('1'));
    assert.match(first, HEX, name);
    assert.notEqual(ack(withText('2')), first, `${name}: another text gives another hash`);
  }
  assert.notEqual(exportAcknowledgement(withText('1'), 'a'.repeat(64)), importAcknowledgement(withText('1'), [], 'a'.repeat(64)), 'an export tick is not an import tick');
});

test('the order of the lists does not change the hash, and a bad revision is refused', () => {
  const a = stdio({ name: 'a', sha256: sha('1') }), b = stdio({ name: 'b', sha256: sha('2') });
  assert.equal(importAcknowledgement({ ...empty(), tools: [a, b] }, ['x', 'y'], 'r1'), importAcknowledgement({ ...empty(), tools: [b, a] }, ['y', 'x'], 'r1'));
  for (const bad of ['', undefined, null, 5, 'x'.repeat(201)]) {
    assert.throws(() => importAcknowledgement(empty(), [], bad), e => e instanceof BundleRefusal && e.code === 'BUNDLE_USAGE');
    assert.throws(() => exportAcknowledgement(empty(), bad), e => e instanceof BundleRefusal && e.code === 'BUNDLE_USAGE');
  }
});

// ---- choices -----------------------------------------------------------------------------------------------------------------

test('choices are a Map and a Set, and a name that the object prototype also has is only a name', () => {
  const names = ['constructor', 'toString', 'wiki', 'hasOwnProperty'];
  const none = importChoicesOf(undefined, names);
  assert.ok(none.link instanceof Map && none.leave instanceof Set);
  assert.equal(none.link.get('constructor'), undefined, 'not linked means not linked');
  const some = importChoicesOf({ link: { wiki: '~/Documents/Wiki' }, leave: ['constructor'] }, names);
  assert.deepEqual([...some.link], [['wiki', '~/Documents/Wiki']]);
  assert.deepEqual([...some.leave], ['constructor']);
  const linked = importChoicesOf({ link: { constructor: 'notes', toString: '.' } }, names);
  assert.deepEqual([...linked.link].sort(), [['constructor', 'notes'], ['toString', '.']]);
  const fromMap = importChoicesOf({ link: new Map([['wiki', '.']]), leave: new Set(['toString']) }, names);
  assert.deepEqual([[...fromMap.link], [...fromMap.leave]], [[['wiki', '.']], ['toString']]);
});

test('choices refuse BUNDLE_USAGE for a name the bundle does not list, __proto__ as an own key, both lists, a repeat, a non-string, or too many', () => {
  const names = ['constructor', 'wiki'];
  const no = raw => assert.throws(() => importChoicesOf(raw, names), e => e instanceof BundleRefusal && e.code === 'BUNDLE_USAGE' && !/__proto__|secret/.test(e.message), JSON.stringify(raw));
  no({ link: JSON.parse('{"__proto__":"x"}') });
  no({ leave: ['__proto__'] });
  no({ link: { other: '.' } });
  no({ leave: ['other'] });
  no({ link: { wiki: '.' }, leave: ['wiki'] });
  no({ leave: ['wiki', 'wiki'] });
  no({ link: { wiki: 5 } });
  no({ link: { wiki: '' } });
  no({ link: { wiki: 'a\nb' } });
  no({ link: { wiki: 'x'.repeat(1025) } });
  no({ leave: [5] });
  no({ leave: 'wiki' });
  no({ link: [] });
  no({ extra: 1 });
  no([]);
  no('x');
  assert.throws(() => importChoicesOf({ leave: Array.from({ length: 201 }, (_, i) => `n${i}`) }, Array.from({ length: 201 }, (_, i) => `n${i}`)), e => e.code === 'BUNDLE_USAGE');
  const inherited = Object.create({ link: { wiki: '.' } });
  assert.deepEqual([...importChoicesOf(inherited, names).link], [], 'an inherited key is not read');
});

// ---- stage 1 stubs -----------------------------------------------------------------------------------------------------------

test('stage 1: the functions that lane A builds are declared and fail with "not built"; the async ones reject', async () => {
  const sync = [() => inspectBundle({}), () => targetFromBundle({}, importChoicesOf(null, [])), () => isEmptyHarness({})];
  for (const call of sync) assert.throws(call, /^Error: not built$/);
  const async = [() => encodeBundle({}), () => decodeBundle(new Uint8Array()), () => readBundleFile('/x'), () => bundleTargetIdentity('/x'), () => writeBundleFile('/x', new Uint8Array())];
  for (const call of async) {
    const promise = call();
    assert.ok(promise instanceof Promise, 'the function is async, so the main process is never held');
    await assert.rejects(promise, /^Error: not built$/);
  }
});
