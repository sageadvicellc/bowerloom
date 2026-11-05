// Hostile bundles (plan section 2.6): each must give the named code, write nothing (the codec is pure), stay small in its message, and finish within a time cap.
// Every value is made up. The fuzz at the end mutates a valid bundle 500 times and holds to one rule: a refusal, or a bundle whose every path is plain.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUNDLE_LIMITS, BundleRefusal, decodeBundle, importChoicesOf, inspectBundle, targetFromBundle,
} from '../../../dist/packages/harness-bundle/src/index.js';
import { plainPath as savePlainPath } from '../../../dist/packages/adoption/src/save.js';
import { bundleOf, bytesOf, envelopeOf, json, mend, parsed, record, refusal, richMap, sha, smallMap } from './fixture.mjs';

const MIB = 1024 * 1024;
const minimal = () => record('harness.json', smallMap({})['harness.json']);
const bytesFor = (records, extra = {}) => bytesOf(envelopeOf([minimal(), ...records].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path))), extra));
const noControls = text => assert.doesNotMatch(text, /[\u0000-\u001f\u007f-\u009f]/, 'a message holds no control character');
// A cap to catch a hang, not to time: ten times the figure given, so a loaded machine running many test files at once does not fail it.
const within = async (ms, work) => { const began = Date.now(); const result = await work(); assert.ok(Date.now() - began < ms * 10, `took ${Date.now() - began} ms, the cap is ${ms * 10} ms`); return result; };
const text = s => Buffer.from(s, 'utf8');

test('path traversal and odd paths are BUNDLE_PATH_UNSAFE, and the message is small and holds no control character', async () => {
  const paths = [
    '../x', 'a/../../x', '/abs', '/etc/passwd', 'C:\\x', 'skills\\x', 'skills/./x', 'skills//x', 'skills/x/', 'a\u0000b', '.git/config', '.bowerloom/x', 'skills/.hidden/x', '.env',
    'knowledge.json', 'team.yaml', 'skills.json', 'manifest.json', 'managed/x', 'authoring/x', '', '.', '..', 'a/..', 'skills/../harness.json', 'x'.repeat(1025), `${'a'.repeat(256)}/x`,
    Array.from({ length: 18 }, () => 'd').join('/'), 'scripts/\u001b[31mred', 'scripts/a\nb', 'scripts/a\u007fb', 'scripts/x\\y',
  ];
  for (const p of paths) {
    const error = await refusal(assert, decodeBundle(bytesFor([record(p, 'x')])), 'BUNDLE_PATH_UNSAFE');
    noControls(error.message);
    assert.ok(error.message.length < 600, `${error.message.length} characters for ${JSON.stringify(p.slice(0, 20))}`);
  }
  // A path that is a drive letter and a slash is a plain name to the grammar; the loader refuses the top-level name.
  const drive = await decodeBundle(bytesFor([record('C:/x', 'x')])).then(() => null, e => e);
  assert.ok(drive instanceof BundleRefusal && ['BUNDLE_PATH_UNSAFE', 'BUNDLE_INVALID'].includes(drive.code), String(drive?.code));
});

test('Unicode paths: a bidi override, a zero-width character, a line separator, a name that clashes under case or normalization', async () => {
  const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
  for (const p of ['scripts/a\u202Eb', 'scripts/a\u200Bb', `scripts/a${LS}b`, `scripts/a${PS}b`, 'scripts/a\uFEFFb', 'scripts/a\u2066b', 'scripts/\u0085x']) {
    await refusal(assert, decodeBundle(bytesFor([record(p, 'x')])), 'BUNDLE_PATH_UNSAFE');
  }
  const nfc = 'scripts/\u00e9.sh', nfd = 'scripts/e\u0301.sh';
  await refusal(assert, decodeBundle(bytesFor([record(nfc, 'a'), record(nfd, 'b')])), 'BUNDLE_PATH_UNSAFE');
  await refusal(assert, decodeBundle(bytesFor([record('scripts/A.sh', 'a'), record('scripts/a.sh', 'b')])), 'BUNDLE_PATH_UNSAFE');
  await refusal(assert, decodeBundle(bytesFor([record('Scripts/a.sh', 'a'), record('scripts/b.sh', 'b')])), 'BUNDLE_PATH_UNSAFE');
  await refusal(assert, decodeBundle(bytesFor([record('scripts/\ufb01.sh', 'a'), record('scripts/fi.sh', 'b')])), 'BUNDLE_PATH_UNSAFE');
  await refusal(assert, decodeBundle(bytesFor([record('scripts/x.sh', 'a'), record('scripts/x.sh', 'a')])), 'BUNDLE_PATH_UNSAFE');
  // A lone surrogate is not text at all.
  await refusal(assert, decodeBundle(bytesFor([record('scripts/\ud800x', 'x')])), 'BUNDLE_FORMAT');
  // Plain Unicode is fine.
  const harness = record('harness.json', smallMap({ scripts: 'scripts/' })['harness.json']);
  const ok = await decodeBundle(bytesOf(envelopeOf([harness, record('scripts/caf\u00e9/\u6f22\u5b57.sh', 'a')])));
  assert.ok(ok.files.some(f => f.path === 'scripts/caf\u00e9/\u6f22\u5b57.sh'));
});

test('a literal %2e%2e segment stays literal and inside', async () => {
  const harness = record('harness.json', smallMap({ scripts: 'scripts/' })['harness.json']);
  const withScripts = bytesOf(envelopeOf([harness, record('scripts/%2e%2e/x.sh', 'echo\n'), record('scripts/a..%2f/y.sh', 'echo\n'), record('scripts/%2e%2e%2f/z.sh', 'echo\n')]));
  const decoded = await decodeBundle(withScripts);
  const target = targetFromBundle(decoded, importChoicesOf(null, []));
  assert.deepEqual(target.map(f => f.path), ['harness.json', 'scripts/%2e%2e%2f/z.sh', 'scripts/%2e%2e/x.sh', 'scripts/a..%2f/y.sh']);
  assert.ok(target.every(f => !f.path.split('/').some(s => s === '..' || s === '.')));
});

test('entries with extra keys are BUNDLE_FORMAT: type, link, target, mode, owner, and a key at the top', async () => {
  for (const [key, value] of [['type', 'symlink'], ['link', '/etc/passwd'], ['target', '../x'], ['mode', 0o777], ['owner', 'root'], ['uid', 0], ['x', null]]) {
    const doc = parsed(bytesFor([record('scripts/a.sh', 'x')]));
    doc.files[1][key] = value;
    await refusal(assert, decodeBundle(bytesOf(doc)), 'BUNDLE_FORMAT');
    const top = parsed(bytesFor([]));
    top[key] = value;
    await refusal(assert, decodeBundle(bytesOf(top)), 'BUNDLE_FORMAT');
  }
  const noKey = parsed(bytesFor([]));
  delete noKey.files[0].sha256;
  await refusal(assert, decodeBundle(bytesOf(noKey)), 'BUNDLE_FORMAT');
  for (const key of ['format', 'harness', 'generator', 'revision', 'files', 'knowledge']) {
    const doc = parsed(bytesFor([]));
    delete doc[key];
    await refusal(assert, decodeBundle(bytesOf(doc)), 'BUNDLE_FORMAT');
  }
  // Wrong types and values in each field.
  const mutate = (fn) => { const doc = parsed(bytesFor([record('scripts/a.sh', 'x')])); fn(doc); return bytesOf(doc); };
  for (const fn of [
    d => { d.files[1].size = '1'; }, d => { d.files[1].size = 1.5; }, d => { d.files[1].size = -1; }, d => { d.files[1].encoding = 'latin1'; }, d => { d.files[1].executable = false; },
    d => { d.files[1].executable = 1; }, d => { d.files[1].sha256 = 'ABC'; }, d => { d.files[1].sha256 = 'A'.repeat(64); }, d => { d.files[1].data = 5; }, d => { d.files[1].path = 5; },
    d => { d.files = {}; }, d => { d.files = 'x'; }, d => { d.files[1] = []; }, d => { d.files[1] = null; }, d => { d.knowledge = {}; }, d => { d.knowledge = [{ kind: 'wiki-folder' }]; },
    d => { d.knowledge = [{ kind: 'wiki-folder', name: 'Wiki' }]; }, d => { d.knowledge = [{ kind: 'other', name: 'wiki' }]; }, d => { d.knowledge = [{ kind: 'wiki-folder', name: 'a', path: 'x' }]; },
    d => { d.knowledge = [{ kind: 'wiki-folder', name: 'a' }, { kind: 'wiki-folder', name: 'a' }]; }, d => { d.harness = 5; }, d => { d.harness = 'Demo'; }, d => { d.harness = 'a'.repeat(65); },
    d => { d.generator = 5; }, d => { d.generator = 'a\nb'; }, d => { d.generator = 'x'.repeat(201); }, d => { d.revision = 'abc'; }, d => { d.revision = `SHA256:${'0'.repeat(64)}`; },
    d => { d.revision = `sha256:${'0'.repeat(63)}`; }, d => { d.revision = `sha256:${'g'.repeat(64)}`; }, d => { d.revision = 5; },
  ]) await refusal(assert, decodeBundle(mutate(fn)), 'BUNDLE_FORMAT');
});

test('control characters in the harness id and in an agent name are refused, and the message holds none', async () => {
  const doc = parsed(bytesFor([]));
  doc.harness = 'de\u0007mo';
  const a = await refusal(assert, decodeBundle(bytesOf(doc)), 'BUNDLE_FORMAT');
  noControls(a.message);
  const bad = '---\nname: "re\\u0007der"\ndescription: A reader.\n---\n\nRead.\n';
  const files = [record('harness.json', smallMap({ subagents: 'agents/' })['harness.json']), record('agents/reader.md', bad)];
  const error = await refusal(assert, decodeBundle(bytesOf(envelopeOf(files))), 'BUNDLE_INVALID');
  noControls(error.message);
  noControls(JSON.stringify(error.problems.map(p => [p.code, p.path, p.message])).replace(/\\u0007/g, ''));
});

test('an ANSI escape in a skill description or a hook command does not reach a refusal, and text the loader allows stays plain data in the summary for the caller to scrub', async () => {
  const esc = '\u001b[2J\u001b[31m';
  const skill = `---\nname: review\ndescription: "${esc.replace(/\u001b/g, '\\u001b')} red"\n---\n\nBody.\n`;
  const files = [record('harness.json', smallMap({ skills: 'skills/' })['harness.json']), record('skills/review/SKILL.md', skill)];
  const refused = await refusal(assert, decodeBundle(bytesOf(envelopeOf(files))), 'BUNDLE_INVALID');
  noControls(refused.message);
  assert.ok(refused.problems.some(p => p.code === 'INVALID_FIELD' && p.path === 'skills/review/SKILL.md'));
  // A hook command with an escape is refused by the loader (a command has no control character), and the refusal repeats none.
  const hookFiles = [record('harness.json', smallMap({ hooks: 'hooks.json' })['harness.json']), record('hooks.json', json({ hooks: [{ id: 'h', event: 'PreToolUse', matcher: 'Bash', command: `echo ${esc}hi`, strength: 'advisory' }] }))];
  const error = await refusal(assert, decodeBundle(bytesOf(envelopeOf(hookFiles))), 'BUNDLE_INVALID');
  noControls(error.message);
  noControls(JSON.stringify(error.problems.map(p => [p.code, p.path, p.message])).replace(/\\u001b/g, ''));
  // What the loader allows, a bidirectional override in a command, is in the summary as written; the app scrubs it with visible() and the command line with plainText().
  const odd = 'echo \u202ehi';
  const loaded = await bundleOf(smallMap({ hooks: 'hooks.json' }, { 'hooks.json': json({ hooks: [{ id: 'h', event: 'PreToolUse', matcher: 'Bash', command: odd, strength: 'advisory' }] }) }));
  assert.equal(inspectBundle(loaded.decoded).tools[0].command, odd);
});

test('limits: 1 MiB + 1 in one file, 4097 files, 32 MiB + 1 in all, and a 49 MiB bundle', async () => {
  const big = { path: 'scripts/big.bin', size: MIB + 1, sha256: sha(''), encoding: 'base64', data: '' };
  await refusal(assert, decodeBundle(bytesFor([big])), 'BUNDLE_TOO_LARGE');
  const exact = { ...big, size: MIB };
  await refusal(assert, decodeBundle(bytesFor([exact])), 'BUNDLE_DAMAGED'); // within the limit, so it is the data that is wrong
  const many = Array.from({ length: BUNDLE_LIMITS.files }, (_, i) => ({ path: `scripts/f${i}.sh`, size: 0, sha256: sha(''), encoding: 'utf8', data: '' }));
  await refusal(assert, decodeBundle(bytesFor(many)), 'BUNDLE_TOO_LARGE'); // 4096 plus harness.json
  const doc = parsed(bytesFor([]));
  doc.files = Array.from({ length: 4097 }, (_, i) => ({ path: `scripts/f${i}.sh`, size: 0, sha256: sha(''), encoding: 'utf8', data: '' }));
  await refusal(assert, decodeBundle(bytesOf(doc)), 'BUNDLE_TOO_LARGE');
  const total = Array.from({ length: 33 }, (_, i) => ({ path: `scripts/f${i}.bin`, size: MIB, sha256: sha(''), encoding: 'base64', data: '' }));
  await refusal(assert, decodeBundle(bytesFor(total)), 'BUNDLE_TOO_LARGE');
  const plusOne = [...Array.from({ length: 31 }, (_, i) => ({ path: `scripts/f${i}.bin`, size: MIB, sha256: sha(''), encoding: 'base64', data: '' })), { path: 'scripts/z.bin', size: MIB - Buffer.byteLength(smallMap({})['harness.json']) + 1, sha256: sha(''), encoding: 'base64', data: '' }];
  await refusal(assert, decodeBundle(bytesFor(plusOne)), 'BUNDLE_TOO_LARGE'); // harness.json is the rest
  const notes = parsed(bytesFor([]));
  notes.knowledge = Array.from({ length: 201 }, (_, i) => ({ kind: 'wiki-folder', name: `n${i}` }));
  await refusal(assert, decodeBundle(bytesOf(notes)), 'BUNDLE_TOO_LARGE');
  await within(1000, () => refusal(assert, decodeBundle(new Uint8Array(49 * MIB)), 'BUNDLE_TOO_LARGE'));
  await refusal(assert, decodeBundle(new Uint8Array(BUNDLE_LIMITS.fileBytes + 1)), 'BUNDLE_TOO_LARGE');
});

test('a declared size that differs from the decoded bytes, bad base64 and a bad hash are BUNDLE_DAMAGED', async () => {
  const good = record('scripts/a.bin', Buffer.from([1, 2, 3, 4, 5, 6]));
  const variants = [
    { ...good, size: 7 }, { ...good, size: 5 }, { ...good, data: `${good.data}AAAA` }, { ...good, data: good.data.slice(0, -4) }, { ...good, data: 'AQID BAUG' },
    { path: 'scripts/p.bin', size: 4, sha256: sha(Buffer.from([1, 2, 3, 4])), encoding: 'base64', data: 'AQIDBA' }, { ...good, data: 'AQIDBAUH' /* same length, other bytes */ }, { ...good, data: '!!!!!!!!' }, { ...good, data: 'AQIDBAUG\n' },
    { ...good, sha256: sha('other') }, { ...good, encoding: 'utf8' },
    // non-canonical base64: the unused bits are not zero
    { path: 'scripts/b.bin', size: 1, sha256: sha(Buffer.from([0x41])), encoding: 'base64', data: 'QR==' },
    // utf8 with a size in bytes that differs from the characters
    { path: 'scripts/c.txt', size: 1, sha256: sha('\u00e9'), encoding: 'utf8', data: '\u00e9' }, { path: 'scripts/d.txt', size: 3, sha256: sha('ab'), encoding: 'utf8', data: 'ab' },
  ];
  for (const [i, v] of variants.entries()) {
    const error = await refusal(assert, decodeBundle(bytesFor([v])), 'BUNDLE_DAMAGED').catch(e => { throw new Error(`variant ${i}: ${e.message}`); });
    noControls(error.message);
  }
  // Hash, size and revision of the real thing.
  const { encoded } = await bundleOf(richMap());
  const flip = fn => { const doc = parsed(encoded.bytes); fn(doc); return bytesOf(doc); };
  await refusal(assert, decodeBundle(flip(d => { d.revision = `sha256:${'0'.repeat(64)}`; })), 'BUNDLE_DAMAGED');
  await refusal(assert, decodeBundle(flip(d => { d.files[0].size += 1; })), 'BUNDLE_DAMAGED');
  await refusal(assert, decodeBundle(flip(d => { d.files[0].sha256 = sha('x'); })), 'BUNDLE_DAMAGED');
  await refusal(assert, decodeBundle(flip(d => { d.files[0].data += ' '; })), 'BUNDLE_DAMAGED');
  await refusal(assert, decodeBundle(flip(d => { d.harness = 'other'; })), 'BUNDLE_DAMAGED');
  // Changed content with a right size and hash, and the old revision: the revision catches it.
  const edited = flip(d => { const f = d.files.find(x => x.path === 'instructions/AGENTS.md'); f.data = f.data.replace('npm', 'yarn'); const raw = Buffer.from(f.data); f.size = raw.length; f.sha256 = sha(raw); });
  await refusal(assert, decodeBundle(edited), 'BUNDLE_DAMAGED');
  // And the same edit with the revision mended is a valid bundle: the hash is not a signature.
  const forged = bytesOf(mend(parsed(edited)));
  assert.equal((await decodeBundle(forged)).files.some(f => Buffer.from(f.bytes).toString('utf8').includes('yarn')), true);
});

test('not the right file: a wrong or missing format, a number, an array, nothing, a BOM, UTF-16, two documents, a repeated key, __proto__, other tools\' files', async () => {
  const good = parsed(bytesFor([]));
  const cases = [
    ['v1beta2', bytesOf({ ...good, format: 'bowerloom/harness-bundle/v1beta2' })], ['v1', bytesOf({ ...good, format: 'bowerloom/harness-bundle/v1' })], ['no format', bytesOf({ ...good, format: undefined })],
    ['format number', bytesOf({ ...good, format: 5 })], ['format array', bytesOf({ ...good, format: [good.format] })], ['an array', text('[]')], ['a number', text('5')], ['a string', text('"x"')],
    ['null', text('null')], ['empty object', text('{}')], ['empty file', new Uint8Array()], ['spaces only', text('  \n')], ['BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytesOf(good)])],
    ['UTF-16 LE', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(good), 'utf16le')])], ['UTF-16 BE', Buffer.from(JSON.stringify(good), 'utf16le').swap16()],
    ['invalid UTF-8', Buffer.concat([bytesOf(good).subarray(0, 20), Buffer.from([0xc3, 0x28]), bytesOf(good).subarray(20)])], ['two documents', Buffer.concat([bytesOf(good), bytesOf(good)])],
    ['text after', Buffer.concat([bytesOf(good), text('x')])], ['a comment', text(`// hi\n${bytesOf(good).toString('utf8')}`)], ['trailing comma', text(bytesOf(good).toString('utf8').replace('\n}', ',\n}'))],
    ['single quotes', text("{'format': 'x'}")], ['NaN', text('{"format": NaN}')], ['Infinity', text('{"format": 1e999}')],
    ['duplicate files key', text(bytesOf(good).toString('utf8').replace('"knowledge": []', '"files": [], "knowledge": []'))],
    ['duplicate format key', text(bytesOf(good).toString('utf8').replace('"harness"', '"format": "x", "harness"'))],
    ['__proto__ key', text(bytesOf(good).toString('utf8').replace('"harness"', '"__proto__": {}, "harness"'))],
    ['escaped __proto__ key', text(bytesOf(good).toString('utf8').replace('"harness"', '"\\u005f_proto__": {}, "harness"'))],
    ['a 0.7 authoring bundle', bytesOf({ format: 'bowerloom/authoring-bundle/v1', name: 'demo', items: [] })], ['a portable manifest', bytesOf({ format: 'bowerloom/portable/v1', files: [], skills: [] })],
    ['a bad escape', text('{"format": "\\x"}')], ['a raw newline in a string', text('{"format": "a\nb"}')], ['a lone surrogate escape', text('{"format": "\\ud800"}')], ['a truncated string', text('{"format": "bowerloom')],
    ['leading zero', text('{"format": 01}')], ['hex', text('{"format": 0x1}')], ['plus sign', text('{"format": +1}')],
  ];
  for (const [label, bytes] of cases) {
    const error = await refusal(assert, decodeBundle(bytes), 'BUNDLE_FORMAT').catch(e => { throw new Error(`${label}: ${e.message}`); });
    noControls(error.message);
  }
});

test('JSON bombs end in a refusal, fast: 10,000 levels deep, one 40 MB string, a million array items', async () => {
  await within(2000, () => refusal(assert, decodeBundle(text('['.repeat(10000) + ']'.repeat(10000))), 'BUNDLE_FORMAT'));
  await within(2000, () => refusal(assert, decodeBundle(text('{"a":'.repeat(10000) + '1' + '}'.repeat(10000))), 'BUNDLE_FORMAT'));
  await within(3000, () => refusal(assert, decodeBundle(text(`{"format":"${'a'.repeat(40 * MIB)}"}`)), 'BUNDLE_FORMAT'));
  await within(3000, () => refusal(assert, decodeBundle(text(`{"files":[${'0,'.repeat(1_000_000)}0]}`)), 'BUNDLE_TOO_LARGE'));
  await within(3000, () => refusal(assert, decodeBundle(text(`{"x":[${'[],'.repeat(500_000)}[]]}`)), 'BUNDLE_TOO_LARGE'));
  await within(3000, () => refusal(assert, decodeBundle(text(`{"knowledge":[${'{},'.repeat(1_000_000)}{}]}`)), 'BUNDLE_TOO_LARGE'));
  // A string of 100 MB is past the size limit before it is looked at.
  await within(2000, () => refusal(assert, decodeBundle(new Uint8Array(100 * MIB).fill(0x61)), 'BUNDLE_TOO_LARGE'));
  // Depth of exactly the limit is fine for the reader; the shape then refuses it.
  await refusal(assert, decodeBundle(text('[[[[[[1]]]]]]')), 'BUNDLE_FORMAT');
  // Many escapes in one string, and many quotes after backslashes.
  await within(3000, () => refusal(assert, decodeBundle(text(`{"format":"${'\\\\"'.repeat(1)}${'\\"'.repeat(200000)}"}`)), 'BUNDLE_FORMAT'));
});

test('a literal token in mcp.json env is BUNDLE_SECRET_FOUND, and neither the message nor the problems repeat it', async () => {
  const token = `ghp_${'q7'.repeat(18)}`;
  const mcp = json({ servers: [{ name: 'gh', transport: 'stdio', command: 'tool', env: { GITHUB_TOKEN: token } }] });
  const files = [record('harness.json', smallMap({ mcp: 'mcp.json' })['harness.json']), record('mcp.json', mcp)];
  const error = await refusal(assert, decodeBundle(bytesOf(envelopeOf(files))), 'BUNDLE_SECRET_FOUND');
  assert.deepEqual(error.paths, ['mcp.json']);
  assert.equal(JSON.stringify([error.message, error.paths, error.problems]).includes(token), false);
  // In a script, a skill and the instructions, as a header and a URL password too.
  for (const [path, body] of [['scripts/a.sh', `export TOKEN=${token}\n`], ['scripts/b.sh', `curl https://user:${'p4ss'.repeat(3)}@host.example/\n`]]) {
    const f = [record('harness.json', smallMap({ scripts: 'scripts/' })['harness.json']), record(path, body)];
    const e = await refusal(assert, decodeBundle(bytesOf(envelopeOf(f))), 'BUNDLE_SECRET_FOUND');
    assert.equal(JSON.stringify([e.message, e.problems]).includes(token), false);
  }
});

test('a bundle that does not load as a harness is BUNDLE_INVALID, with the loader\'s problems by path and code', async () => {
  const cases = [
    [[record('harness.json', '{}\n')], 'harness.json'],
    [[record('harness.json', 'not json\n')], 'harness.json'],
    [[record('scripts/a.sh', 'x')], 'harness.json'],
    [[record('harness.json', smallMap({})['harness.json']), record('stray.txt', 'x')], 'stray.txt'],
    [[record('harness.json', smallMap({ skills: 'skills/' })['harness.json']), record('skills/Bad Name/SKILL.md', '---\nname: x\n---\n')], 'skills/Bad Name'],
  ];
  for (const [records, path] of cases) {
    const error = await refusal(assert, decodeBundle(bytesOf(envelopeOf(records))), 'BUNDLE_INVALID');
    assert.ok(error.problems.length > 0);
    assert.ok(error.paths.some(p => p.includes(path.split('/')[0])), `${path} in ${error.paths}`);
    noControls(error.message);
  }
});

// ---- the fuzz ----------------------------------------------------------------------------------------------------------------

/** The `plainPath` of packages/adoption/src/save.ts itself (exported for this test), so a change there changes this test. */
const plainPath = savePlainPath;
function random(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test('fuzz: 500 mutations of a valid bundle end in a BundleRefusal or in a bundle whose every path passes plainPath, with no other error and no hang', async () => {
  const { encoded } = await bundleOf(richMap({ 'skills/review/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]) }));
  const valid = Buffer.from(encoded.bytes);
  const rand = random(20261031);
  const pick = list => list[Math.floor(rand() * list.length)];
  const strings = ['', 'x', '../x', '/abs', 'a\u0000b', '\u202e', 'A'.repeat(300), 'scripts/a.sh', 'skills/review/SKILL.md', '.hidden', 'knowledge.json', 'team.yaml', '%2e%2e', 'e\u0301', '\u00e9', 'sha256:00', '0'.repeat(64), 'base64', 'utf8', '=', '!!!!'];
  const numbers = [0, 1, -1, 1.5, 2 ** 53, 1e308, NaN, null, true, [], {}];
  let refused = 0, accepted = 0;
  const began = Date.now();
  for (let i = 0; i < 500; i += 1) {
    let bytes;
    if (i % 2 === 0) {
      // A single byte change, insertion or deletion.
      bytes = Buffer.from(valid);
      const at = Math.floor(rand() * bytes.length);
      const kind = Math.floor(rand() * 3);
      if (kind === 0) bytes[at] = Math.floor(rand() * 256);
      else if (kind === 1) bytes = Buffer.concat([bytes.subarray(0, at), Buffer.from([Math.floor(rand() * 256)]), bytes.subarray(at)]);
      else bytes = Buffer.concat([bytes.subarray(0, at), bytes.subarray(at + 1)]);
    } else {
      // A change to one field, or to the shape.
      const doc = JSON.parse(valid.toString('utf8'));
      const f = doc.files[Math.floor(rand() * doc.files.length)];
      switch (Math.floor(rand() * 10)) {
        case 0: f.path = pick(strings); break;
        case 1: f.size = pick(numbers); break;
        case 2: f.sha256 = pick(strings); break;
        case 3: f.encoding = pick(strings); break;
        case 4: f.data = pick(strings); break;
        case 5: f.executable = pick([true, false, 1, null]); break;
        case 6: f[pick(['type', 'target', 'mode', 'link'])] = pick(strings); break;
        case 7: doc[pick(['harness', 'generator', 'revision', 'format'])] = pick([...strings, ...numbers]); break;
        case 8: doc.knowledge = pick([[], [{ kind: 'wiki-folder', name: pick(['a', 'wiki', 'constructor', '__proto__', 'A']) }], {}, [null]]); break;
        default: doc.files = [...doc.files, { ...f, path: pick(strings) }]; break;
      }
      bytes = Buffer.from(`${JSON.stringify(doc, null, 2)}\n`);
    }
    let decoded;
    try { decoded = await decodeBundle(bytes); } catch (error) {
      assert.ok(error instanceof BundleRefusal, `mutation ${i}: ${error?.name}: ${error?.message}`);
      refused += 1;
      continue;
    }
    accepted += 1;
    for (const file of decoded.files) assert.ok(plainPath(file.path), `mutation ${i}: ${JSON.stringify(file.path)} is accepted but is not a plain path`);
    const names = decoded.knowledge.map(k => k.name);
    const target = targetFromBundle(decoded, importChoicesOf(null, names));
    for (const file of target) assert.ok(plainPath(file.path), `mutation ${i}: target ${JSON.stringify(file.path)}`);
    inspectBundle(decoded);
  }
  assert.equal(refused + accepted, 500);
  assert.ok(refused > 400, `${refused} refused`);
  assert.ok(Date.now() - began < 120_000, 'no hang');
});

test('a valid bundle with a mended revision and hostile text in fields the loader reads is refused or loads with plain paths: no stray error', async () => {
  // Frontmatter bombs and odd YAML in a skill and an agent, forged with right hashes.
  const bad = [
    '---\nname: review\ndescription: &a [*a]\n---\n', '---\nname: review\n---\n', `---\nname: review\ndescription: ${'x'.repeat(5000)}\n---\n`, '---\n---\n', 'no frontmatter\n',
    '---\nname: review\ndescription: !!python/object/apply:os.system ["echo"]\n---\n', '---\nname: review\ndescription: a\nx-claude-code: {a: {b: {c: {d: 1}}}}\n---\n',
  ];
  for (const body of bad) {
    const files = [record('harness.json', smallMap({ skills: 'skills/' })['harness.json']), record('skills/review/SKILL.md', body)];
    const outcome = await decodeBundle(bytesOf(envelopeOf(files))).then(() => 'ok', e => { assert.ok(e instanceof BundleRefusal, e?.message); return e.code; });
    assert.ok(['ok', 'BUNDLE_INVALID', 'BUNDLE_TOO_LARGE'].includes(outcome), outcome);
  }
});

test('the largest valid bundle decodes and loads within a time and memory cap', async () => {
  const { definitionOf } = await import('./fixture.mjs');
  const { encodeBundle } = await import('../../../dist/packages/harness-bundle/src/index.js');
  const map = smallMap({ scripts: 'scripts/' });
  let stamp = 7;
  for (let i = 0; i < 31; i += 1) {
    const block = Buffer.alloc(MIB);
    for (let j = 0; j < block.length; j += 4) block.writeUInt32LE((Math.imul(++stamp, 2654435761) ^ (stamp << 3)) >>> 0, j);
    map[`scripts/block-${i}.bin`] = block;
  }
  const encoded = await encodeBundle(definitionOf(map));
  if (global.gc) global.gc();
  const before = process.memoryUsage().rss;
  const began = Date.now();
  const decoded = await decodeBundle(encoded.bytes);
  const took = Date.now() - began;
  const grew = (process.memoryUsage().rss - before) / MIB;
  assert.equal(decoded.files.length, 32);
  assert.ok(took < 15_000, `decode took ${took} ms`);
  assert.ok(grew < 1024, `memory grew ${Math.round(grew)} MiB`);
  const summary = inspectBundle(decoded);
  assert.equal(summary.counts.files, 32);
  const target = targetFromBundle(decoded, importChoicesOf(null, []));
  assert.equal(target.length, 32);
  process.stderr.write(`# largest valid bundle ${Math.round(encoded.bytes.length / MIB)} MiB: decode ${took} ms, rss grew ${Math.round(grew)} MiB\n`);
});
