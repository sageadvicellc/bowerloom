// The stage 1 contract of the harness bundle: the constants, the code table and its words, the README that states the same table, the acknowledgements, and the
// checked choices. Stage 2 lane A adds the behaviour tests beside this file. The "not built" test below goes when the functions are built.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BUNDLE_CODES, BUNDLE_FILE_SUFFIX, CODE_EXTENSIONS, DATA_EXTENSIONS, UNREADABLE_ADDRESS, addressOf, codeWhy, BUNDLE_FORMAT, BUNDLE_LIMITS, BUNDLE_MESSAGES, BundleRefusal, EXPORT_PLAN_FORMAT, HIGH_RISK_SINK_FIELDS, IMPORT_PLAN_FORMAT, PATH_SHOWN_CHARS,
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

test('the acknowledgement is of the whole entry hash, not of the shown text: main must build the summary from the held bundle, never from the window', () => {
  const a = stdio({ command: 'sh' }), b = stdio({ command: 'a-harmless-name', host: 'good.example', addressFlags: [] });
  assert.equal(importAcknowledgement({ ...empty(), tools: [a] }, [], 'a'.repeat(64)), importAcknowledgement({ ...empty(), tools: [b] }, [], 'a'.repeat(64)),
    'shown fields with the same sha256 give the same hash, so the lane C duty (summary from the held bundle, same call) is what makes the tick mean what was shown');
});

test('an empty bundle and a bundle of skills need no tick; a remote server does, even with no reference, and its host is bound', () => {
  const http = (host, h) => ({ name: 'docs', kind: 'mcp', transport: 'http', runsCode: false, host, sha256: sha(h) });
  assert.equal(importAcknowledgement(empty(), [], 'a'.repeat(64)), null);
  assert.equal(exportAcknowledgement(empty(), 'a'.repeat(64)), null);
  const one = importAcknowledgement({ ...empty(), tools: [http('mcp.example.test', 'd')] }, [], 'a'.repeat(64));
  assert.match(one, HEX, 'a host the file chose is ticked');
  assert.notEqual(importAcknowledgement({ ...empty(), tools: [http('mcp.example.test', 'e')] }, [], 'a'.repeat(64)), one, 'the whole entry is bound');
});

test('a header reference to a remote host needs a tick: Authorization: Bearer ${GITHUB_TOKEN} on an http server', () => {
  const tool = { name: 'docs', kind: 'mcp', transport: 'http', runsCode: false, host: 'attacker.example', sha256: sha('f') };
  const secrets = [{ kind: 'env', name: 'GITHUB_TOKEN', sinks: [{ tool: 'docs', field: 'header', host: 'attacker.example' }] }];
  assert.match(importAcknowledgement({ ...empty(), tools: [tool], secrets }, [], 'a'.repeat(64)), HEX);
  // The reference alone, whatever the tool says, is enough.
  assert.match(importAcknowledgement({ ...empty(), secrets }, [], 'a'.repeat(64)), HEX);
  assert.equal(importAcknowledgement({ ...empty(), secrets: [{ kind: 'env', name: 'LOG_LEVEL', sinks: [{ tool: 'shell', field: 'env' }] }] }, [], 'a'.repeat(64)), null, 'env alone adds nothing: a stdio server is ticked as a tool');
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

test('a reference in a url, an argument, a command or a header needs a tick; one in env alone does not', () => {
  const secret = (field, host) => ({ kind: 'env', name: 'GITHUB_TOKEN', sinks: [{ tool: 'docs', field, ...(host === undefined ? {} : { host }) }] });
  assert.deepEqual([...HIGH_RISK_SINK_FIELDS], ['arg', 'header', 'url', 'command']);
  for (const field of HIGH_RISK_SINK_FIELDS) assert.match(importAcknowledgement({ ...empty(), secrets: [secret(field, 'attacker.example')] }, [], 'a'.repeat(64)), HEX, field);
  assert.equal(importAcknowledgement({ ...empty(), secrets: [secret('env')] }, [], 'a'.repeat(64)), null, 'env');
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
  assert.equal(importAcknowledgement(empty(), ['a', 'a'], 'r1'), importAcknowledgement(empty(), ['a'], 'r1'), 'a repeated executable path is one');
  for (const bad of ['', undefined, null, 5, 'x'.repeat(201)]) {
    assert.throws(() => importAcknowledgement(empty(), [], bad), e => e instanceof BundleRefusal && e.code === 'BUNDLE_USAGE');
    assert.throws(() => exportAcknowledgement(empty(), bad), e => e instanceof BundleRefusal && e.code === 'BUNDLE_USAGE');
  }
});

// ---- addresses and files that run -----------------------------------------------------------------------------------------------

test('the host shown is the host a client reaches: userinfo, a backslash, IPv6, references, and what does not parse', () => {
  assert.deepEqual(addressOf('https://github.com:${GITHUB_TOKEN}@evil.example/mcp'), { host: 'evil.example', flags: ['credentials'] });
  assert.deepEqual(addressOf('https://user@evil.example/'), { host: 'evil.example', flags: ['credentials'] });
  assert.deepEqual(addressOf('https://good.example\\@evil.example/'), { host: 'good.example', flags: ['backslash'] });
  assert.deepEqual(addressOf('https://[::1]:8080/mcp'), { host: '[::1]:8080', flags: [] });
  assert.deepEqual(addressOf('https://MCP.Example.Test:443/x?k=${T}#f'), { host: 'mcp.example.test', flags: [] });
  assert.deepEqual(addressOf('https://mcp.example.test:8443/x'), { host: 'mcp.example.test:8443', flags: [] });
  assert.deepEqual(addressOf('https://${HOST}/mcp'), { host: '${HOST}', flags: [] });
  assert.deepEqual(addressOf('wss://mcp.example.test/socket'), { host: 'mcp.example.test', flags: [] });
  assert.deepEqual(addressOf('ftp://files.example.test/'), { host: 'files.example.test', flags: ['scheme'] });
  for (const bad of ['not a url', '', 'https://', 'https://${P}:${Q}/', 'x'.repeat(9000), 'https://qxrefq0q.example/']) assert.deepEqual(addressOf(bad), { host: UNREADABLE_ADDRESS, flags: ['unreadable'] }, bad.slice(0, 30));
  assert.ok(addressOf(`https://${'a'.repeat(300)}.example/`).host.length <= 201);
  assert.deepEqual(addressOf(5), { host: UNREADABLE_ADDRESS, flags: ['unreadable'] });
});

test('a forged placeholder is unreadable: percent-encoded or upper-case text cannot pose as a reference', () => {
  const unreadable = { host: UNREADABLE_ADDRESS, flags: ['unreadable'] };
  assert.deepEqual(addressOf('https://%71xrefq0q.evil.example/'), unreadable);
  assert.deepEqual(addressOf('https://QXREFQ0Q.evil.example/?k=${GITHUB_TOKEN}'), unreadable);
  assert.deepEqual(addressOf('https://evil.example/qxrefq5q'), unreadable);
  assert.deepEqual(addressOf('https://evil.example/?a=${A}&b=${B}'), { host: 'evil.example', flags: [] }, 'real references in order still pass');
  assert.deepEqual(addressOf('https://${A}.${B}.example/'), { host: '${A}.${B}.example', flags: [] });
});

test('a space or a control character anywhere in an address is unreadable: URL would drop it and join two names', () => {
  const unreadable = { host: UNREADABLE_ADDRESS, flags: ['unreadable'] };
  for (const bad of ['https://good.example\r\n.evil.example/', 'https://good.example\t.evil.example/', ' https://good.example/', 'https://good.example/ ', 'https://good.example/a b', 'https://good.example/\u0000', 'https://good.example/\u007f']) assert.deepEqual(addressOf(bad), unreadable, JSON.stringify(bad));
});

test('a file is data only when it passes the allowlist; everything else can run', () => {
  const text = t => new TextEncoder().encode(t);
  const bytes = (...b) => new Uint8Array(b);
  const why = (path, data, exec = false) => codeWhy(path, typeof data === 'string' ? text(data) : data, exec);
  const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a), JPG = bytes(0xff, 0xd8, 0xff, 0xe0), GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
  const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50), ICO = bytes(0, 0, 1, 0, 1, 0), WOFF = bytes(0x77, 0x4f, 0x46, 0x46, 0), WOFF2 = bytes(0x77, 0x4f, 0x46, 0x32, 0);
  const TTF = bytes(0, 1, 0, 0, 0), TTF2 = bytes(0x74, 0x72, 0x75, 0x65, 0), OTF = bytes(0x4f, 0x54, 0x54, 0x4f, 0);
  // text data
  for (const path of ['skills/x/SKILL.md', 'a.markdown', 'a.TXT', 'a.rst', 'cfg.json', 'cfg.jsonc', 'a.yaml', 'a.yml', 'a.toml', 'a.csv', 'a.tsv', 'style.css', 'Notes.MD', 'a.b.md', 'README', 'LICENSE', 'notice', 'skills/x/License', 'README.md', 'LICENSE.txt']) assert.equal(why(path, '# title\n'), null, path);
  // binary data, each with its own signature
  for (const [path, data] of [['a.png', PNG], ['a.JPG', JPG], ['a.jpeg', JPG], ['a.gif', GIF], ['a.webp', WEBP], ['a.ico', ICO], ['f.woff', WOFF], ['f.woff2', WOFF2], ['f.ttf', TTF], ['f.ttf', TTF2], ['f.otf', OTF]]) assert.equal(why(path, data), null, path);
  // an image or a font that is not its own kind is listed
  for (const [path, data] of [['a.png', JPG], ['a.jpg', PNG], ['a.gif', text('GIF')], ['a.webp', bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45)], ['a.png', text('PK\u0003\u0004zip')], ['a.woff', text('echo hi\n')], ['a.ico', bytes(1, 2, 3, 4)], ['a.png', bytes()]]) assert.equal(why(path, data), 'binary', path);
  // the bit, the name, the folder
  assert.equal(why('skills/x/tool', 'echo', true), 'executable');
  assert.equal(why('hooks.json', '{}'), 'hook');
  assert.equal(why('scripts/anything.txt', 'x'), 'script');
  // manifests that run commands
  for (const path of ['package.json', 'skills/x/Package.JSON', 'pyproject.toml', 'Cargo.toml', 'composer.json', 'docker-compose.yml', 'docker-compose.yaml', 'docker-compose.override.yml', 'compose.yml', 'compose.yaml', 'Taskfile.yml', 'Taskfile.yaml', 'justfile', 'Makefile', 'Dockerfile']) assert.equal(why(path, '{}'), 'manifest', path);
  // extensions that run
  for (const path of ['skills/x/run.sh', 'helper.PY', 'a.js', 'a.jsx', 'a.tsx', 'a.cjs', 'a.mts', 'a.node', 'setup.hta', 'a.wasm', 'a.msi', 'a.pkg', 'a.dmg', 'a.lnk', 'a.desktop', 'a.plist', 'a.com', 'a.scr', 'a.pyc', 'a.class', 'a.go', 'a.rs', 'a.svg', 'a.html', 'a.pdf', 'a.ipynb']) assert.equal(why(path, 'x'), 'extension', path);
  // everything else
  for (const path of ['skills/x/helper', 'a.unknown', 'a.xml', '.env', 'READMEFIRST', 'license-mit']) assert.equal(why(path, 'x'), 'not-data', path);
  assert.equal(why('a.sh ', 'x'), 'not-data', 'a trailing space');
  assert.equal(why('a.md.', '# t'), 'not-data', 'a trailing dot');
  assert.equal(why('a.md ', '# t'), 'not-data');
  assert.equal(why('a.sh.md', '# t'), null, 'the last extension counts');
  assert.equal(why('a.md.sh', '# t'), 'extension', 'a double extension: the last one counts');
  // first bytes
  assert.equal(why('run.sh.txt', '#!/bin/sh\necho\n'), 'shebang', 'data by name, code by its first line');
  assert.equal(why('run.sh.txt', 'echo hi\n'), null, 'data by name and by its bytes');
  assert.equal(why('notes.md', bytes(0xef, 0xbb, 0xbf, 0x23, 0x21, 0x2f)), 'shebang', 'a byte order mark, then #!');
  assert.equal(why('notes.md', bytes(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x23, 0x21, 0x2f)), 'shebang', 'two byte order marks, then #!');
  assert.equal(why('notes.md', bytes(0xef, 0xbb, 0xbf, 0x23, 0x20)), null, 'a byte order mark and a heading is text');
  assert.equal(why('skills/x/tool', '#!/usr/bin/env node\n'), 'shebang');
  for (const [name, magic] of [['ELF', [0x7f, 0x45, 0x4c, 0x46]], ['Mach-O 32', [0xfe, 0xed, 0xfa, 0xce]], ['Mach-O 64', [0xfe, 0xed, 0xfa, 0xcf]], ['Mach-O 32 reverse', [0xce, 0xfa, 0xed, 0xfe]], ['Mach-O 64 reverse', [0xcf, 0xfa, 0xed, 0xfe]], ['Mach-O fat', [0xca, 0xfe, 0xba, 0xbe]], ['WebAssembly', [0x00, 0x61, 0x73, 0x6d]]]) {
    assert.equal(why('skills/x/helper', bytes(...magic, 1, 2, 3)), 'binary', name);
    assert.equal(why('pic.png', bytes(...magic, 1, 2, 3)), 'binary', `${name} under a data name`);
    assert.equal(why('pic.png', bytes(0xef, 0xbb, 0xbf, ...magic)), 'binary', `${name} after a byte order mark`);
    assert.equal(why('notes.md', bytes(...magic, 0x20, 0x68, 0x69)), 'binary', `${name} in a text file`);
  }
  assert.equal(why('skills/x/helper', bytes(0x4d, 0x5a, 0x90, 0x00)), 'binary', 'PE in a file that is not text');
  assert.equal(why('pic.png', bytes(0x4d, 0x5a, 0x90, 0x00)), 'binary', 'PE under a data name');
  assert.equal(why('notes.md', 'MZ-5 notes on the pump\n'), null, 'a text note that begins with MZ is a note');
  assert.equal(why('README', 'MZ readme\n'), null);
  assert.equal(why('assets/blob.bin', bytes(0x23)), 'not-data');
  // text that is not UTF-8, or holds a NUL, is not data
  assert.equal(why('notes.md', bytes(0x23, 0x20, 0xff, 0xfe, 0x00)), 'not-data');
  assert.equal(why('notes.md', 'a\u0000b'), 'not-data', 'a NUL in a text file');
  assert.equal(why('cfg.json', bytes(0xc3, 0x28)), 'not-data');
  // missing bytes never throw
  for (const bad of [null, undefined, 'text', 5, {}]) assert.equal(codeWhy('notes.md', bad, false), 'not-data');
  assert.equal(codeWhy('notes.md', null, true), 'executable');
  assert.ok(CODE_EXTENSIONS.includes('.sh') && DATA_EXTENSIONS.includes('.md') && DATA_EXTENSIONS.includes('.css') && !DATA_EXTENSIONS.includes('.svg') && !DATA_EXTENSIONS.includes('.pdf'));
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

test('choices: a root that is not a plain object, a count that is too big, and a read that throws are all BUNDLE_USAGE, and nothing is copied first', () => {
  const names = ['wiki'];
  const no = raw => assert.throws(() => importChoicesOf(raw, names), e => e instanceof BundleRefusal && e.code === 'BUNDLE_USAGE');
  no(new Date());
  no(new (class Choices { constructor() { this.link = {}; } })());
  no(Object.create({ link: { wiki: '.' } }));
  no({ get link() { throw new Error('getter'); } });
  no(new Proxy({}, { ownKeys() { throw new Error('trap'); } }));
  no(new Proxy({}, { getPrototypeOf() { throw new Error('trap'); } }));
  no({ link: { wiki: 'a\u202eb' } });
  no({ link: { wiki: 'a\u2028b' } });
  for (const ch of ['\u200e', '\u200f', '\u061c', '\u200b', '\ufeff', '\u0085', '\u2066', '\u0007']) no({ link: { wiki: `a${ch}b` } });
  // The joiners that ordinary words in Persian and Indic scripts need are allowed.
  assert.equal(importChoicesOf({ link: { wiki: '~/\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645' } }, names).link.get('wiki'), '~/\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645');
  assert.equal(importChoicesOf({ link: { wiki: '~/\u0915\u200d\u0937' } }, names).link.get('wiki'), '~/\u0915\u200d\u0937');
  // 5 million items: refused from the length, with no copy.
  const big = { length: 5_000_000 };
  Object.setPrototypeOf(big, Array.prototype);
  const started = process.hrtime.bigint();
  no({ leave: big });
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 200, 'the count is checked before the copy');
  assert.ok(importChoicesOf(Object.create(null), names).link instanceof Map, 'a null-prototype root is plain');
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
