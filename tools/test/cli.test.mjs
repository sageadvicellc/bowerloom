import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitFlag, jsonWanted, seamRefusal, boolValueRefusal, flagLikeValueRefusal, reportUsage, guarded, inTestMode, TEST_MODE_VAR, entryState, mismatchMessage } from '../lib/cli.mjs';

const sink = () => { const lines = { out: '', err: '' }; return { lines, out: { write: t => { lines.out += t; } }, err: { write: t => { lines.err += t; } } }; };

test('splitFlag splits --flag=value only for long flags', () => {
  assert.deepEqual(splitFlag('--a=b'), { flag: '--a', value: 'b' });
  assert.deepEqual(splitFlag('--a='), { flag: '--a', value: '' });
  assert.deepEqual(splitFlag('--a=b=c'), { flag: '--a', value: 'b=c' });
  assert.deepEqual(splitFlag('--a'), { flag: '--a', value: null });
  assert.deepEqual(splitFlag('-h'), { flag: '-h', value: null });
  assert.deepEqual(splitFlag('=x'), { flag: '=x', value: null });
});

test('jsonWanted is true for --json and for --json=anything', () => {
  assert.equal(jsonWanted(['x', '--json']), true);
  assert.equal(jsonWanted(['--json=x']), true);
  assert.equal(jsonWanted(['--jsonx', '--no-json']), false);
});

test('seam and value refusals', () => {
  assert.equal(inTestMode({}), false);
  assert.equal(inTestMode({ [TEST_MODE_VAR]: '1' }), true);
  assert.equal(inTestMode({ [TEST_MODE_VAR]: 'true' }), false);
  assert.match(seamRefusal('--root', {}), /BOWERLOOM_TOOLS_TEST_MODE=1/);
  assert.equal(seamRefusal('--root', { [TEST_MODE_VAR]: '1' }), null);
  assert.equal(boolValueRefusal('--apply', null), null);
  assert.match(boolValueRefusal('--apply', 'false'), /takes no value/);
  assert.match(boolValueRefusal('--apply', ''), /takes no value/);
  assert.equal(flagLikeValueRefusal('--base', 'main'), null);
  assert.equal(flagLikeValueRefusal('--base', null), null);
  assert.match(flagLikeValueRefusal('--base', '--upload-pack=x'), /starts with --/);
});

test('reportUsage writes the message to stderr, one JSON object to stdout only when asked, and returns 2', () => {
  const quiet = sink();
  assert.equal(reportUsage('tool', 'bad', 'USAGE TEXT', { json: false, out: quiet.out, err: quiet.err }), 2);
  assert.equal(quiet.lines.out, '');
  assert.match(quiet.lines.err, /tool: bad\nUSAGE TEXT/);
  const loud = sink();
  assert.equal(reportUsage('tool', 'bad', 'U', { json: true, out: loud.out, err: loud.err }), 2);
  assert.deepEqual(JSON.parse(loud.lines.out), { ok: false, exit: 2, error: 'bad' });
  assert.equal(loud.lines.out.trim().split('\n').length, 1);
});

test('guarded returns the body exit code, and turns a throw into exit 2 with one JSON object and no stack', async () => {
  const fine = sink();
  assert.equal(await guarded('tool', { json: true, out: fine.out, err: fine.err }, async () => 7), 7);
  assert.equal(fine.lines.out, '');
  const crashed = sink();
  const secret = ['gh', 'p_', 'A1b2C3d4'.repeat(4)].join('');
  const code = await guarded('tool', { json: true, out: crashed.out, err: crashed.err }, async () => { throw new Error(`boom ${secret}\n    at somewhere`); });
  assert.equal(code, 2);
  const json = JSON.parse(crashed.lines.out);
  assert.deepEqual({ ok: json.ok, exit: json.exit }, { ok: false, exit: 2 });
  assert.match(json.error, /^boom \[redacted\]$/);
  assert.doesNotMatch(crashed.lines.err, /somewhere/);
  const text = sink();
  assert.equal(await guarded('tool', { json: false, out: text.out, err: text.err }, async () => { throw new Error('plain'); }), 2);
  assert.equal(text.lines.out, '');
  assert.match(text.lines.err, /tool: plain/);
});

test('entryState says main for the file itself or a symlink to it, imported for another file, and mismatch for another file with the same name', () => {
  const self = new URL('../gates.mjs', import.meta.url).href;
  const real = fileURLToPath(self);
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'entry-state-test-')));
  try {
    const link = path.join(dir, 'other-name.mjs');
    fs.symlinkSync(real, link);
    fs.mkdirSync(path.join(dir, 'a'));
    fs.writeFileSync(path.join(dir, 'a', 'gates.mjs'), '');
    fs.writeFileSync(path.join(dir, 'unrelated.mjs'), '');
    assert.equal(entryState(real, self), 'main');
    assert.equal(entryState(link, self), 'main');
    assert.equal(entryState(undefined, self), 'imported');
    assert.equal(entryState(path.join(dir, 'unrelated.mjs'), self), 'imported');
    assert.equal(entryState(path.join(dir, 'missing.mjs'), self), 'imported');
    assert.equal(entryState(path.join(dir, 'a', 'gates.mjs'), self), 'mismatch');
    assert.equal(entryState(path.join(dir, 'nowhere', 'gates.mjs'), self), 'mismatch', 'a path that carries the name but is not this file');
    assert.match(mismatchMessage('gates', path.join(dir, 'a', 'gates.mjs'), self), /^gates: the program started as .* is not this script .*; it did nothing\n$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
