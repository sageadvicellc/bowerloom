// Harness definition spec, section 9 rule 1, and section 12 check 6: the revision of an unchanged definition is stable
// across runs and machines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalBytes, computeRevision, loadDefinition } from '../../../dist/packages/harness-definition/src/index.js';
import { cleanup, fullFiles, harness, makeDefinition } from './fixture.mjs';

test.after(cleanup);

const here = path.dirname(fileURLToPath(import.meta.url));
const revisionOf = files => {
  const r = loadDefinition(makeDefinition(files));
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems));
  return r.definition.revision;
};
const crlf = files => Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' && k.endsWith('.md') ? v.replace(/\n/g, '\r\n') : v]));

test('check 6: two loads of the same folder give the same revision', () => {
  const dir = makeDefinition(fullFiles());
  const a = loadDefinition(dir), b = loadDefinition(dir);
  assert.equal(a.definition.revision, b.definition.revision);
  assert.match(a.definition.revision, /^sha256:[0-9a-f]{64}$/);
});

test('check 6: the revision does not depend on the folder location or the order files were written', () => {
  const files = fullFiles();
  const reversed = Object.fromEntries(Object.entries(files).reverse());
  assert.equal(revisionOf(files), revisionOf(reversed));
});

test('check 6: CRLF and LF line endings give the same revision for Markdown parts', () => {
  assert.equal(revisionOf(fullFiles()), revisionOf(crlf(fullFiles())));
  const cr = Object.fromEntries(Object.entries(fullFiles()).map(([k, v]) => [k, k === 'instructions/AGENTS.md' ? v.replace(/\n/g, '\r') : v]));
  assert.equal(revisionOf(fullFiles()), revisionOf(cr));
});

test('C7: scripts and engine-private files are hashed as raw bytes', () => {
  const base = revisionOf(fullFiles());
  assert.notEqual(revisionOf(fullFiles({ 'scripts/lint.sh': '#!/bin/sh\r\nexit 0\r\n' })), base);
  assert.notEqual(revisionOf(fullFiles({ 'engines/codex/config-extra.toml': '[features]\r\nweb_search = true\r\n' })), base);
  // A Markdown file under scripts/ is a script file: raw bytes too.
  assert.notEqual(revisionOf(fullFiles({ 'scripts/notes.md': 'a\r\n' })), revisionOf(fullFiles({ 'scripts/notes.md': 'a\n' })));
});

test('C7 and S10: the executable bit is part of the revision', () => {
  const dir = makeDefinition(fullFiles());
  const before = loadDefinition(dir).definition;
  assert.equal(before.files.find(f => f.path === 'scripts/lint.sh').executable, false);
  fs.chmodSync(path.join(dir, 'scripts', 'lint.sh'), 0o755);
  const after = loadDefinition(dir).definition;
  assert.equal(after.files.find(f => f.path === 'scripts/lint.sh').executable, true);
  assert.notEqual(after.revision, before.revision);
  const files = [{ path: 'scripts/a.sh', bytes: Buffer.from('x\n') }];
  assert.equal(computeRevision(files), computeRevision([{ ...files[0], executable: false }]));
  assert.notEqual(computeRevision(files), computeRevision([{ ...files[0], executable: true }]));
});

test('silent 12: canonicalBytes refuses a machine JSON file that is not strict JSON', () => {
  assert.throws(() => canonicalBytes({ path: 'harness.json', bytes: Buffer.from('{"a": 1,}') }), /strict JSON/);
  assert.throws(() => computeRevision([{ path: 'hooks.json', bytes: Buffer.from('// x\n{}') }]), /strict JSON/);
});

test('check 6: machine JSON files are hashed in canonical form', () => {
  const files = fullFiles();
  const compact = { ...files };
  for (const name of ['harness.json', 'guardrails.json', 'hooks.json', 'mcp.json', 'sources.json']) {
    const value = JSON.parse(files[name]);
    const reorder = v => Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reorder(x)])) : v;
    compact[name] = JSON.stringify(reorder(value));
  }
  assert.equal(revisionOf(files), revisionOf(compact));
});

test('check 6: any change of meaning changes the revision', () => {
  const base = revisionOf(fullFiles());
  const changes = [
    { 'skills/deploy/SKILL.md': fullFiles()['skills/deploy/SKILL.md'] + 'More.\n' },
    { 'scripts/lint.sh': '#!/bin/sh\nexit 1\n' },
    { 'engines/codex/config-extra.toml': '[features]\nweb_search = false\n' },
    { 'harness.json': harness({ description: 'Another harness.', parts: JSON.parse(fullFiles()['harness.json']).parts }) },
    { 'scripts/lint.sh': undefined, 'scripts/lint2.sh': '#!/bin/sh\nexit 0\n' },
    // Order inside a JSON array is meaning.
    { 'guardrails.json': (() => { const g = JSON.parse(fullFiles()['guardrails.json']); g.rules.reverse(); return JSON.stringify(g); })() },
  ];
  const seen = new Set([base]);
  for (const change of changes) {
    const rev = revisionOf(fullFiles(change));
    assert.ok(!seen.has(rev), JSON.stringify(Object.keys(change)));
    seen.add(rev);
  }
});

test('check 6: computeRevision over the loaded files equals the loader revision', () => {
  const r = loadDefinition(makeDefinition(fullFiles()));
  assert.equal(computeRevision(r.definition.files), r.definition.revision);
  assert.equal(computeRevision([...r.definition.files].reverse()), r.definition.revision);
});

test('check 6: binary content is hashed as bytes, without line-ending changes', () => {
  const lf = [{ path: 'scripts/tool.bin', bytes: Buffer.from([0, 0x0a, 1]) }];
  const crlfBin = [{ path: 'scripts/tool.bin', bytes: Buffer.from([0, 0x0d, 0x0a, 1]) }];
  assert.notEqual(computeRevision(lf), computeRevision(crlfBin));
});

test('check 6: Unicode file names hash the same in composed and decomposed form', () => {
  const composed = [{ path: 'scripts/café.sh', bytes: Buffer.from('x\n') }];
  const decomposed = [{ path: 'scripts/café.sh', bytes: Buffer.from('x\n') }];
  assert.equal(computeRevision(composed), computeRevision(decomposed));
});

test('check 6: a pinned definition has a pinned revision, so a change to the algorithm shows', () => {
  const files = [
    { path: 'harness.json', bytes: Buffer.from('{"id":"demo","format":"bowerloom/harness/v1beta1"}') },
    { path: 'instructions/AGENTS.md', bytes: Buffer.from('# Demo\r\n') },
  ];
  assert.equal(computeRevision(files), PINNED);
});

test('check 6: another process with another locale, time zone, and working folder computes the same revision', () => {
  const dir = makeDefinition(fullFiles());
  const expected = loadDefinition(dir).definition.revision;
  const module = path.resolve(here, '../../../dist/packages/harness-definition/src/index.js');
  const script = `import(${JSON.stringify(pathToFileURL(module).href)}).then(m => process.stdout.write(m.loadDefinition(process.argv[1]).definition.revision))`;
  const out = execFileSync(process.execPath, ['-e', script, dir], {
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH ?? '', LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8', TZ: 'Pacific/Kiritimati' },
    encoding: 'utf8',
  });
  assert.equal(out, expected);
});

// Computed by hand from the framing in src/revision.ts, outside that module:
// sha256("bowerloom/harness-revision/v2\n" + for each file "<path>\n<x or ->\n<length>\n<canonical bytes>\n"), with
// harness.json as {"format":"bowerloom/harness/v1beta1","id":"demo"} and AGENTS.md as "# Demo\n", neither executable.
const PINNED = 'sha256:2bc306f6195b7bad2e666f1db56ff7ba3dbd80bd14e0abe117f5a5fa6308c11c';
