// The tests of the review round after the first build of lane A: the stall bounds (a worker round trip, the work budgets), the shared case fold, the error mapping by
// system code, the file names and bytes that are scanned, the cap of foreign paths, the bundle that decode issued, and the small corrections.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import {
  BUNDLE_CODES, BUNDLE_LIMITS, BUNDLE_MESSAGES, BundleRefusal, FILE_FAILED_REASONS, decodeBundle, encodeBundle, importChoicesOf, inspectBundle, readBundleFile, targetFromBundle,
  writeBundleFile,
} from '../../../dist/packages/harness-bundle/src/index.js';
import { clearFileIoHooks, setFileIoHook } from '../../../dist/packages/harness-bundle/src/file-io.js';
import { clashingPaths, isBundlePath } from '../../../dist/packages/harness-bundle/src/path-grammar.js';
import { causeOf } from '../../../dist/packages/harness-bundle/src/codes.js';
import { scanUnits, yamlBytes } from '../../../dist/packages/harness-bundle/src/work-budget.js';
import { foldName } from '../../../dist/packages/harness-definition/src/fold.js';
import { bundleOf, bytesOf, definitionOf, envelopeOf, json, record, refusal, richMap, sha, smallMap, tempDir } from './fixture.mjs';

const MIB = 1024 * 1024;
const noControls = text => assert.doesNotMatch(text, /[\u0000-\u001f\u007f-\u009f]/);
const errno = (code, text = 'simulated') => Object.assign(new Error(text), { code });
const nothingLeft = dir => assert.deepEqual(fs.readdirSync(dir).filter(n => n.endsWith('.part')), [], 'no temporary file is left');

// ---- the stall: a worker round trip, and the work budgets -----------------------------------------------------------------------------

/** A bundle of `n` skills, each with a frontmatter of `keys` keys (about 10 bytes a key). Forged, so the loader does not run in the test process. */
function skillBundle(n, keys) {
  const block = Array.from({ length: keys }, (_, i) => `  k${i}: v`).join('\n');
  const records = [record('harness.json', smallMap({ skills: 'skills/' })['harness.json'])];
  for (let i = 0; i < n; i += 1) records.push(record(`skills/s${i}/SKILL.md`, `---\nname: s${i}\ndescription: A skill.\nmetadata:\n${block}\n---\n\nBody.\n`));
  return bytesOf(envelopeOf(records));
}
/** A bundle of `mb` files of 1 MiB made of the lines of `unit`, 4,000 characters a line. */
function textBundle(unit, mb) {
  const line = `${unit.repeat(Math.floor(4000 / unit.length))}\n`;
  const body = line.repeat(Math.floor((MIB - 16) / line.length));
  const records = [record('harness.json', smallMap({ scripts: 'scripts/' })['harness.json'])];
  for (let i = 0; i < mb; i += 1) records.push(record(`scripts/f${i}.txt`, body));
  return bytesOf(envelopeOf(records));
}

/** Runs the package in a worker thread on `bytes`, while this thread watches its own event loop. Returns the answer, the time, and the longest gap of this thread. */
async function inWorker(bytes) {
  const worker = new Worker(new URL('./worker.mjs', import.meta.url));
  let last = performance.now(), longest = 0, running = true;
  const spin = () => { const now = performance.now(); longest = Math.max(longest, now - last); last = now; if (running) setImmediate(spin); };
  setImmediate(spin);
  const began = performance.now();
  try {
    const answer = await new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.postMessage({ id: 1, bytes }, [bytes.buffer]);
    });
    return { answer, ms: performance.now() - began, longest };
  } finally { running = false; await worker.terminate(); }
}
const copyOf = bytes => { const c = new Uint8Array(bytes.length); c.set(bytes); return c; };
const report = (label, r) => process.stderr.write(`# ${label}: ${Math.round(r.ms)} ms in the worker, longest gap of the main thread ${Math.round(r.longest)} ms\n`);

test('hostile case 1, 40 skills with 5,500 frontmatter keys each (2.2 MiB of YAML): refused BUNDLE_TOO_LARGE, quickly, and the main thread is not held', async () => {
  const bytes = skillBundle(40, 5500);
  assert.ok(bytes.length < 3 * MIB);
  const r = await inWorker(copyOf(bytes));
  report('40 skills x 5,500 keys', r);
  assert.equal(r.answer.ok, false);
  assert.equal(r.answer.refusal.code, 'BUNDLE_TOO_LARGE');
  assert.ok(r.ms < 30_000, `${Math.round(r.ms)} ms`);
  assert.ok(r.longest < 1000, `the main thread was held for ${Math.round(r.longest)} ms`);
});

test('hostile case 3, the first line after the fence is ---x: 1: the block is counted whole and refused BUNDLE_TOO_LARGE', async () => {
  const block = Array.from({ length: 5500 }, (_, i) => `  k${i}: v`).join('\n');
  const records = [record('harness.json', smallMap({ skills: 'skills/' })['harness.json'])];
  for (let i = 0; i < 20; i += 1) records.push(record(`skills/s${i}/SKILL.md`, `---\n---x: 1\nname: s${i}\ndescription: A skill.\nmetadata:\n${block}\n---\n\nBody.\n`));
  const r = await inWorker(copyOf(bytesOf(envelopeOf(records))));
  report('20 skills behind a ---x: 1 line', r);
  assert.equal(r.answer.ok, false);
  assert.equal(r.answer.refusal.code, 'BUNDLE_TOO_LARGE');
  assert.ok(r.ms < 30_000 && r.longest < 1000);
});

test('hostile cases 4 and 5, a?a=a?a with NEL or a control character inside the line, and 31 MiB of name: value lines: refused', async () => {
  for (const c of ['\u0085', '\u0001', '\u000e']) {
    const line = `${`a?a=a?a${c}`.repeat(500)}\n`;
    const body = line.repeat(Math.floor((MIB - 16) / line.length));
    const records = [record('harness.json', smallMap({ scripts: 'scripts/' })['harness.json'])];
    for (let i = 0; i < 31; i += 1) records.push(record(`scripts/f${i}.txt`, body));
    const r = await inWorker(copyOf(bytesOf(envelopeOf(records))));
    report(`31 MiB of a?a=a?a + ${JSON.stringify(c)}`, r);
    assert.equal(r.answer.ok, false, JSON.stringify(c));
    assert.equal(r.answer.refusal.code, 'BUNDLE_TOO_LARGE', JSON.stringify(c));
    assert.ok(r.ms < 30_000 && r.longest < 1000);
  }
  // name: value lines cost the scan too. 31 MiB of `token: abc` is just under the budget and is bounded at about two seconds; 31 MiB of `k: v` is over it.
  const edge = await inWorker(copyOf(textBundle('token: abc ', 31)));
  report('31 MiB of token: abc (at the edge)', edge);
  assert.ok(edge.ms < 30_000 && edge.longest < 1000);
  const over = await inWorker(copyOf(textBundle('k: v ', 31)));
  report('31 MiB of k: v', over);
  assert.equal(over.answer.ok, false);
  assert.equal(over.answer.refusal.code, 'BUNDLE_TOO_LARGE');
});

test('hostile case 2, 31 MiB of a?a=a?a= text: refused BUNDLE_TOO_LARGE before the loader runs, and the main thread is not held', async () => {
  const bytes = textBundle('a?a=', 31);
  assert.ok(bytes.length > 31 * MIB && bytes.length < BUNDLE_LIMITS.fileBytes);
  const r = await inWorker(copyOf(bytes));
  report('31 MiB of a?a=', r);
  assert.equal(r.answer.ok, false);
  assert.equal(r.answer.refusal.code, 'BUNDLE_TOO_LARGE');
  assert.ok(r.ms < 60_000, `${Math.round(r.ms)} ms`);
  assert.ok(r.longest < 1000, `the main thread was held for ${Math.round(r.longest)} ms`);
});

test('the worst bundles that pass the budgets are accepted, and cost the loader a few seconds, off the main thread', async () => {
  // Frontmatter: 8 skills of 5,500 keys is 0.43 MiB of YAML, under the 512 KiB budget.
  const yaml = await inWorker(copyOf(skillBundle(8, 5500)));
  report('8 skills x 5,500 keys (accepted)', yaml);
  assert.equal(yaml.answer.ok, true, JSON.stringify(yaml.answer.refusal));
  assert.equal(yaml.answer.summary.counts.skills, 8);
  assert.ok(yaml.answer.ms < 60_000);
  assert.ok(yaml.longest < 1000);
  // Scan: 3 files of a?a=a?a= text is 2.4 million places for the scan, under the 3 million budget.
  const scan = await inWorker(copyOf(textBundle('a?a=', 3)));
  report('3 MiB of a?a= (accepted)', scan);
  assert.equal(scan.answer.ok, true, JSON.stringify(scan.answer.refusal));
  assert.ok(scan.answer.ms < 60_000);
  assert.ok(scan.longest < 1000);
});

test('a worker answers with plain output: the summary, the files of the target, and a refusal that comes back whole through fromPlain', async () => {
  const { encoded } = await bundleOf(richMap());
  const ok = await inWorker(copyOf(encoded.bytes));
  assert.equal(ok.answer.ok, true);
  assert.deepEqual(ok.answer.summary, encoded.summary);
  assert.equal(ok.answer.sha256, encoded.sha256);
  assert.ok(ok.answer.files.some(f => f.path === 'scripts/lint.sh'));
  const bad = await inWorker(new Uint8Array(Buffer.from('{"format":"nope"}\n')));
  assert.equal(bad.answer.ok, false);
  const again = BundleRefusal.fromPlain(bad.answer.refusal);
  assert.ok(again instanceof BundleRefusal);
  assert.equal(again.code, 'BUNDLE_FORMAT');
  assert.equal(again.message, BUNDLE_MESSAGES.BUNDLE_FORMAT);
});

test('the work budgets count what they say: YAML bytes and scan places', () => {
  const file = (p, text) => ({ path: p, bytes: Buffer.from(text) });
  assert.equal(yamlBytes(file('a/b.yml', 'x: 1\n')), 5);
  assert.equal(yamlBytes(file('a/B.YAML', 'x: 1\n')), 5);
  assert.equal(yamlBytes(file('SKILL.md', '---\nname: x\n---\n\nbody that is long\n')), '---\nname: x'.length);
  assert.equal(yamlBytes(file('SKILL.md', '--- \t\nname: x\n--- \nbody\n')), '--- \t\nname: x'.length, 'spaces and tabs after a fence are still a fence');
  assert.equal(yamlBytes(file('SKILL.md', '---\r\nname: x\r\n---\r\nbody\r\n')), '---\nname: x'.length, 'CRLF is read as the loader reads it');
  const trap = `---\n---x: 1\nname: x\n${'k: v\n'.repeat(1000)}---\nbody\n`;
  assert.equal(yamlBytes(file('SKILL.md', trap)), trap.indexOf('\n---\nbody'), 'a line that only begins with --- is not the closing fence');
  assert.equal(yamlBytes(file('SKILL.md', '---x: 1\nname: x\n---\n')), 0, 'the first line is not a fence, so the loader reads no frontmatter');
  assert.equal(yamlBytes(file('SKILL.md', `---\n${'k: v\n'.repeat(30000)}`)), 70_000, 'no closing fence in the head: the whole head is counted');
  assert.equal(yamlBytes(file('SKILL.md', 'no frontmatter\n')), 0);
  assert.equal(yamlBytes(file('a.json', '{}')), 0);
  assert.equal(scanUnits('plain words of prose here', 1e9), 0, 'short tokens are not scanned for shapes');
  assert.equal(scanUnits('a?a=a?a=', 1e9), 4 + 1 + 2, 'four starts, and one name=value token with two pieces after a ?');
  assert.equal(scanUnits('abcdefghij', 1e9), 1);
  assert.equal(scanUnits('abcdefghij abcdefghij', 1e9), 2);
  assert.equal(scanUnits('token: abc', 1e9), 1, 'a name: value token costs the scan something even when it is short');
  assert.equal(scanUnits('k=v k=v k=v', 1e9), 3);
  assert.ok(scanUnits('a?a='.repeat(1000), 100) > 100, 'it stops once past the cap');
  // A file read as bytes splits on every byte outside ! to ~, as the scanner does, and has no name: value reading.
  assert.equal(scanUnits('abcd\u0001efgh', 1e9, true), 0, 'as bytes, the control character ends a token of 4 and a token of 4');
  assert.equal(scanUnits('abcd\u0001efgh', 1e9, false), 2, 'as text, it stays inside one token of 9: two runs');
  assert.equal(scanUnits('k: v k=v', 1e9, true), 0);
  // The scanner splits on \\s and the quote and bracket set only. NEL and the control characters keep a token whole, so they must not end one here.
  const tokenWith = c => `abcd${c}`.repeat(500);
  for (const c of ['\u0085', '\u0001', '\u000e', '\u007f', '\u001f']) assert.ok(scanUnits(tokenWith(c), 1e9) >= 500, `${JSON.stringify(c)} does not end a token`);
  for (const c of [' ', '\t', '\u000b', '\u00a0', '\u2003', '\u3000', '\ufeff', '"', '|', '\\']) assert.equal(scanUnits(tokenWith(c), 1e9), 0, `${JSON.stringify(c)} ends a token`);
});

// ---- the shared case fold -----------------------------------------------------------------------------------------------------

test('the shared fold: names that a case-insensitive volume joins clash, in the bundle grammar and by foldName', () => {
  const pairs = [
    ['straße', 'strasse'], ['straße', 'STRASSE'], ['ας', 'ασ'], ['ẞ', 'ss'], ['ᲀ', 'в'], ['ᲁ', 'д'], ['ᲂ', 'о'],
    ['ᲃ', 'с'], ['ᲄ', 'т'], ['ᲅ', 'т'], ['ᲆ', 'ъ'], ['ᲇ', 'ѣ'], ['ᲈ', 'ꙋ'], ['ͅ', 'ι'], ['ǰ', 'ǰ'],
    ['ẖ', 'ẖ'], ['ẗ', 'ẗ'], ['ϲ', 'Ϲ'], ['K', 'k'], ['ﬁ', 'fi'], ['Ａ', 'A'], ['é', 'é'], ['Å', 'Å'],
  ];
  for (const [a, b] of pairs) {
    assert.equal(foldName(a), foldName(b), `${JSON.stringify(a)} and ${JSON.stringify(b)} fold alike`);
    assert.deepEqual(clashingPaths([`scripts/${a}.md`, `scripts/${b}.md`]).length, 2, `${a} and ${b} clash as paths`);
    assert.deepEqual(clashingPaths([`${a}/x.md`, `${b}/y.md`]).length, 2, `${a} and ${b} clash as folders`);
  }
  assert.equal(clashingPaths(['scripts/a.md', 'scripts/b.md', 'scripts/a/c.md']).length, 0, 'different names do not clash');
  assert.equal(clashingPaths(['scripts/a.md', 'scripts/a.md']).length, 1);
});

test('a bundle with straße and strasse is refused BUNDLE_PATH_UNSAFE on decode and on encode', async () => {
  const harness = record('harness.json', smallMap({ scripts: 'scripts/' })['harness.json']);
  const bytes = bytesOf(envelopeOf([harness, record('scripts/strasse.md', 'one\n'), record('scripts/straße.md', 'two\n')]));
  await refusal(assert, decodeBundle(bytes), 'BUNDLE_PATH_UNSAFE');
  const def = definitionOf(smallMap({ scripts: 'scripts/' }, { 'scripts/strasse.md': 'one\n', 'scripts/straße.md': 'two\n' }));
  await refusal(assert, encodeBundle(def), 'BUNDLE_PATH_UNSAFE');
});

test('the save uses the same fold: its source imports foldName and has no other fold of its own', () => {
  const source = fs.readFileSync(new URL('../../adoption/src/save.ts', import.meta.url), 'utf8');
  assert.match(source, /import \{ foldName \} from '\.\.\/\.\.\/harness-definition\/src\/fold\.js'/);
  assert.match(source, /key = foldName\(prefix\)/);
  assert.doesNotMatch(source, /normalize\('NFC'\)\.toLowerCase\(\)/);
});

test('the grammar refuses a name that ends in a dot or a space and Knowledge.json in any case; it refuses no Windows device name, because the save accepts them (one rule for both)', () => {
  for (const bad of ['scripts/a.md.', 'scripts/a.md ', 'scripts/a./b.sh', 'Knowledge.json', 'KNOWLEDGE.JSON', 'knowledge.JSON']) assert.equal(isBundlePath(bad), false, bad);
  for (const good of ['scripts/console.md', 'scripts/con.md', 'scripts/aux.md', 'skills/x/references/nul.txt', 'scripts/prn', 'scripts/com1.md', 'scripts/COM1', 'scripts/lpt3.log', 'scripts/a.b', 'skills/x/knowledge.json', 'scripts/contact.md']) assert.equal(isBundlePath(good), true, good);
});

// ---- errors by system code --------------------------------------------------------------------------------------------------

test('BUNDLE_FILE_FAILED: the code, the words, the reason by system code, and the cause that is a code and nothing else', async t => {
  assert.ok(BUNDLE_CODES.includes('BUNDLE_FILE_FAILED'));
  assert.match(BUNDLE_MESSAGES.BUNDLE_FILE_FAILED, /^The file could not be read or written\./);
  assert.match(BUNDLE_MESSAGES.BUNDLE_FILE_FAILED, /Nothing was read or written\.$/);
  const plain = new BundleRefusal('BUNDLE_FILE_FAILED');
  assert.equal(plain.message, `${BUNDLE_MESSAGES.BUNDLE_FILE_FAILED} The system refused the file.`);
  for (const [code, words] of [['ENOSPC', /full/], ['EACCES', /permission/], ['EPERM', /permission/], ['EROFS', /read-only/], ['ENAMETOOLONG', /too long/], ['EIO', /error/]]) {
    const e = new BundleRefusal('BUNDLE_FILE_FAILED', [], [], code);
    assert.match(e.reason, words, code);
    assert.ok(e.message.endsWith(e.reason), code);
    assert.equal(e.cause, code);
    assert.equal(Object.keys(e).includes('cause'), false, 'the cause is not enumerable');
    assert.equal(JSON.stringify(e.message).includes(code), false, 'the code is not in the message');
    assert.ok(FILE_FAILED_REASONS[code]);
  }
  // Through the writer, for each code: the hook raises the system error at the write.
  const dir = tempDir(t);
  setFileIoHook('afterTemp', undefined);
  for (const [code, words] of [['ENOSPC', /full/], ['EACCES', /permission/], ['EROFS', /read-only/], ['ENAMETOOLONG', /too long/], ['EIO', /error/]]) {
    setFileIoHook('link', () => { throw errno(code, `${code} at /Users/someone/secret/place`); });
    const e = await refusal(assert, writeBundleFile(path.join(dir, `${code}.json`), Buffer.from('x')), 'BUNDLE_FILE_FAILED');
    assert.match(e.reason, words, code);
    assert.equal(e.cause, code);
    assert.equal(e.message.includes('/Users'), false, 'the text of the system error is never passed on');
    noControls(e.message);
  }
  clearFileIoHooks();
  nothingLeft(dir);
});

test('real system errors: a read-only folder, a name too long and a missing file are BUNDLE_FILE_FAILED; a link is BUNDLE_FILE_UNSAFE', async t => {
  const dir = tempDir(t);
  const missing = await refusal(assert, readBundleFile(path.join(dir, 'nothing.json')), 'BUNDLE_FILE_FAILED');
  assert.equal(missing.cause, 'ENOENT');
  const long = await refusal(assert, writeBundleFile(path.join(dir, `${'n'.repeat(300)}.json`), Buffer.from('x')), 'BUNDLE_FILE_FAILED');
  assert.match(long.reason, /too long/);
  fs.writeFileSync(path.join(dir, 'real.json'), 'x');
  fs.symlinkSync(path.join(dir, 'real.json'), path.join(dir, 'link.json'));
  const link = await refusal(assert, readBundleFile(path.join(dir, 'link.json')), 'BUNDLE_FILE_UNSAFE');
  assert.equal(link.cause, 'ELOOP');
  if (process.getuid() !== 0) {
    const ro = path.join(dir, 'ro');
    fs.mkdirSync(ro);
    fs.chmodSync(ro, 0o500);
    t.after(() => { try { fs.chmodSync(ro, 0o700); } catch { /* removed already */ } });
    const denied = await refusal(assert, writeBundleFile(path.join(ro, 'out.json'), Buffer.from('x')), 'BUNDLE_FILE_FAILED');
    assert.match(denied.reason, /permission/);
    assert.equal(denied.cause, 'EACCES');
    fs.chmodSync(path.join(dir, 'real.json'), 0o000);
    const noRead = await refusal(assert, readBundleFile(path.join(dir, 'real.json')), 'BUNDLE_FILE_FAILED');
    assert.equal(noRead.cause, 'EACCES');
    fs.chmodSync(path.join(dir, 'real.json'), 0o600);
  }
});

test('an error with no system code is a defect: it is logged by class name and reaches the caller as BUNDLE_FILE_FAILED with that cause, and no path text', async t => {
  const warnings = [];
  const listen = w => warnings.push(w);
  process.on('warning', listen);
  t.after(() => process.off('warning', listen));
  const dir = tempDir(t);
  setFileIoHook('link', () => { throw new TypeError(`a bug at ${dir}/secret-folder`); });
  const e = await refusal(assert, writeBundleFile(path.join(dir, 'out.json'), Buffer.from('x')), 'BUNDLE_FILE_FAILED');
  assert.equal(e.cause, 'TypeError');
  assert.equal(e.message.includes(dir), false);
  assert.ok(e.message.length < 400);
  clearFileIoHooks();
  nothingLeft(dir);
  setFileIoHook('afterStat', () => { throw new RangeError(`a bug in a read of ${dir}`); });
  fs.writeFileSync(path.join(dir, 'in.json'), 'x');
  const r = await refusal(assert, readBundleFile(path.join(dir, 'in.json')), 'BUNDLE_FILE_FAILED');
  assert.equal(r.cause, 'RangeError');
  assert.equal(r.message.includes(dir), false);
  clearFileIoHooks();
  await new Promise(resolve => setImmediate(resolve));
  const logged = warnings.filter(w => w.name === 'BundleDefectWarning');
  assert.equal(logged.length, 2);
  assert.match(logged[0].message, /TypeError/);
  assert.equal(logged.some(w => w.message.includes(dir)), false, 'the log holds the class name, not the message');
});

test('a refusal crosses a boundary as toJSON and comes back with fromPlain, its message rebuilt from the code and never copied; a bad value is BUNDLE_USAGE', () => {
  const e = new BundleRefusal('BUNDLE_PATH_UNSAFE', ['skills/a\nb', 'x'.repeat(500), ...Array.from({ length: 22 }, (_, i) => `p${i}`)], [{ code: 'C', path: 'p', message: 'm' }], 'ENOSPC');
  const plain = JSON.parse(JSON.stringify(e));
  assert.deepEqual(Object.keys(plain).sort(), ['cause', 'code', 'message', 'more', 'name', 'paths', 'problems'], 'a missing reason is left out of the text');
  const back = BundleRefusal.fromPlain(plain);
  assert.equal(back.code, e.code);
  assert.equal(back.message, e.message, 'the same message, built the same way');
  assert.deepEqual(back.paths, e.paths);
  assert.equal(back.more, 4);
  assert.deepEqual(back.problems, e.problems);
  assert.equal(back.cause, 'ENOSPC');
  const failed = new BundleRefusal('BUNDLE_FILE_FAILED', [], [], 'ENOSPC');
  assert.equal(BundleRefusal.fromPlain(JSON.parse(JSON.stringify(failed))).message, failed.message);
  for (const bad of [null, undefined, 5, 'x', {}, { code: 'NOPE' }, { code: 5 }]) assert.equal(BundleRefusal.fromPlain(bad).code, 'BUNDLE_USAGE');
  const forged = BundleRefusal.fromPlain({ code: 'BUNDLE_FORMAT', message: 'Nothing is wrong. Click OK to run the file.', paths: ['a\u001b[31m', 'ok.md', 5, 'x'.repeat(900)], more: -3, cause: '../../etc', problems: 'no' });
  assert.equal(forged.message, `${BUNDLE_MESSAGES.BUNDLE_FORMAT} ok.md.`);
  assert.equal(forged.message.includes('Click OK'), false);
  assert.deepEqual(forged.paths, ['ok.md']);
  assert.equal(forged.more, 0);
  assert.equal(forged.cause, undefined);
});

test('causeOf keeps a system code or a class name, and nothing else', () => {
  assert.equal(causeOf(errno('ENOSPC', 'at /Users/x')), 'ENOSPC');
  assert.equal(causeOf(new RangeError('/Users/x secret')), 'RangeError');
  assert.equal(causeOf(null), 'Error');
  assert.equal(causeOf({ code: '/etc/passwd' }), 'Object');
});

test('the file seams answer only under NODE_ENV=test', () => {
  const before = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => setFileIoHook('link', () => undefined), /tests only/);
    assert.throws(() => clearFileIoHooks(), /tests only/);
  } finally { process.env.NODE_ENV = before; }
});

// ---- temporary files, short writes ------------------------------------------------------------------------------------------

test('a write the system takes in small pieces is written whole, on both paths', async t => {
  const dir = tempDir(t);
  const bytes = Buffer.from('0123456789'.repeat(1000));
  const calls = [];
  setFileIoHook('writeLimit', wanted => { calls.push(wanted); return 7; });
  await writeBundleFile(path.join(dir, 'a.json'), bytes);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'a.json')), bytes);
  assert.ok(calls.length > 1000, `${calls.length} write calls`);
  setFileIoHook('link', () => { throw errno('ENOTSUP'); });
  await writeBundleFile(path.join(dir, 'b.json'), bytes);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'b.json')), bytes);
  clearFileIoHooks();
  nothingLeft(dir);
});

test('a temporary file that cannot be removed is a warning with the code and no path, after three tries; the write itself stands', async t => {
  const dir = tempDir(t);
  const warnings = [];
  const listen = w => warnings.push(w);
  process.on('warning', listen);
  t.after(() => process.off('warning', listen));
  let tries = 0;
  setFileIoHook('unlink', () => { tries += 1; throw errno('EACCES', '/Users/someone/private'); });
  await writeBundleFile(path.join(dir, 'out.json'), Buffer.from('x'));
  clearFileIoHooks();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tries, 3);
  assert.equal(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'), 'x');
  const ours = warnings.filter(w => w.name === 'BundleCleanupWarning');
  assert.equal(ours.length, 1);
  assert.match(ours[0].message, /EACCES/);
  assert.equal(ours[0].message.includes('/Users'), false);
});

test('a write deletes nothing in the folder but its own .part file: old files of the same name form, other files and folders all stay', async t => {
  const dir = tempDir(t);
  const old = path.join(dir, `.bowerloom-${'a'.repeat(24)}.part`);
  const other = path.join(dir, 'notes.txt');
  const folder = path.join(dir, `.bowerloom-${'d'.repeat(24)}.part.d`);
  for (const f of [old, other]) fs.writeFileSync(f, 'x');
  fs.mkdirSync(folder);
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  fs.utimesSync(old, twoDaysAgo, twoDaysAgo);
  const stays = [path.basename(old), path.basename(folder), 'notes.txt', 'out.json'].sort();
  await writeBundleFile(path.join(dir, 'out.json'), Buffer.from('x'));
  assert.deepEqual(fs.readdirSync(dir).sort(), stays, 'nothing was removed or added but the file written');
  setFileIoHook('link', () => { throw errno('EACCES'); });
  await refusal(assert, writeBundleFile(path.join(dir, 'again.json'), Buffer.from('x')), 'BUNDLE_FILE_FAILED');
  clearFileIoHooks();
  assert.deepEqual(fs.readdirSync(dir).sort(), stays, 'a failed write removes its own temporary file and nothing else');
});

test('the no-link write removes the target of a failed write only by identity: a file another process put there stays', async t => {
  const dir = tempDir(t);
  const target = path.join(dir, 'out.json');
  setFileIoHook('link', () => { throw errno('ENOTSUP'); });
  setFileIoHook('afterTargetCreated', () => { fs.rmSync(target); fs.writeFileSync(target, 'someone else\n'); throw errno('EIO'); });
  const e = await refusal(assert, writeBundleFile(target, Buffer.from('mine')), 'BUNDLE_FILE_FAILED');
  assert.equal(e.cause, 'EIO');
  clearFileIoHooks();
  assert.equal(fs.readFileSync(target, 'utf8'), 'someone else\n', 'the file of the other process stays');
  nothingLeft(dir);
});

// ---- the contents that are scanned ----------------------------------------------------------------------------------------------

test('a secret in a file name is BUNDLE_SECRET_FOUND on export and on import, and the value is not repeated', async () => {
  const token = `ghp_${'z9'.repeat(18)}`;
  const name = `scripts/${token}.sh`;
  const def = definitionOf(smallMap({ scripts: 'scripts/' }, { [name]: 'echo ok\n' }));
  const e = await refusal(assert, encodeBundle(def), 'BUNDLE_SECRET_FOUND');
  assert.equal(e.message.includes('ghp_'), false, 'the name of the file is the secret, so the refusal does not show it');
  assert.deepEqual(e.paths, ['(a file name, not shown)']);
  const harness = record('harness.json', smallMap({ scripts: 'scripts/' })['harness.json']);
  const bytes = bytesOf(envelopeOf([harness, record(name, 'echo ok\n')]));
  const d = await refusal(assert, decodeBundle(bytes), 'BUNDLE_SECRET_FOUND');
  assert.deepEqual(d.paths, ['(a file name, not shown)']);
  assert.equal(d.message.includes('ghp_'), false);
  // A name that only looks odd is fine.
  assert.ok(await bundleOf(smallMap({ scripts: 'scripts/' }, { 'scripts/api-key-notes.sh': 'echo ok\n' })));
});

test('paths of another computer are found in a file that is not UTF-8, one with a NUL, and one with a stray byte', async () => {
  const text = 'echo /Users/alice/project/run\n';
  const files = {
    'scripts/nulbyte.sh': Buffer.concat([Buffer.from(text), Buffer.from([0])]),
    'scripts/stray.sh': Buffer.concat([Buffer.from(text), Buffer.from([0xff, 0xfe])]),
    'scripts/mixed.bin': Buffer.concat([Buffer.from([1, 2, 3, 0xff]), Buffer.from('/home/bob/work/x'), Buffer.from([0, 0])]),
    'scripts/utf8.sh': Buffer.from(text),
  };
  const { decoded } = await bundleOf(smallMap({ scripts: 'scripts/' }, files));
  const hits = inspectBundle(decoded).foreignPaths.map(h => [h.path, h.text]);
  assert.deepEqual(hits, [['scripts/mixed.bin', '/home/bob/work/x'], ['scripts/nulbyte.sh', '/Users/alice/project/run'], ['scripts/stray.sh', '/Users/alice/project/run'], ['scripts/utf8.sh', '/Users/alice/project/run']]);
});

test('a file with more than 100 paths does not hide the paths of a later file: the cap of a file moves on to the next', async () => {
  const many = Array.from({ length: 150 }, (_, i) => `/tmp/decoy-${i}`).join('\n');
  const { decoded } = await bundleOf(smallMap({ scripts: 'scripts/' }, { 'scripts/a-many.md': `${many}\n`, 'scripts/m-mid.md': 'see /Users/alice/secret\n', 'scripts/z-late.md': 'and /home/bob/late\n' }));
  const list = inspectBundle(decoded).foreignPaths;
  const where = p => list.filter(h => h.path === p);
  assert.equal(where('scripts/a-many.md').length, 101, '100 hits and the line that says there are more');
  assert.match(where('scripts/a-many.md').at(-1).text, /^More paths/);
  assert.deepEqual(where('scripts/m-mid.md').map(h => h.text), ['/Users/alice/secret']);
  assert.deepEqual(where('scripts/z-late.md').map(h => h.text), ['/home/bob/late']);
  assert.equal(list.length, 103);
  // The cap of the whole bundle ends the scan, with one line.
  const files = {};
  for (let i = 0; i < 12; i += 1) files[`scripts/f${String(i).padStart(2, '0')}.md`] = `${Array.from({ length: 100 }, (_, j) => `/tmp/p-${i}-${j}`).join('\n')}\n`;
  const all = inspectBundle((await bundleOf(smallMap({ scripts: 'scripts/' }, files))).decoded).foreignPaths;
  assert.equal(all.length, 1001);
  assert.match(all.at(-1).text, /^More paths/);
});

// ---- the bundle that decode issued -------------------------------------------------------------------------------------------

test('a bundle object that decode did not issue is loaded fresh every time: a path pushed in later never reaches a target', async () => {
  const { decoded } = await bundleOf(richMap());
  const forged = { ...decoded, files: [...decoded.files] };
  const before = inspectBundle(forged).counts.files;
  forged.files.push({ path: '../../evil.sh', bytes: Buffer.from('x') });
  assert.throws(() => targetFromBundle(forged, importChoicesOf(null, [])), e => e instanceof BundleRefusal && ['BUNDLE_INVALID'].includes(e.code));
  assert.throws(() => inspectBundle(forged), e => e instanceof BundleRefusal);
  assert.equal(before, 13);
  // A bundle that decode issued gives the same answer after its bytes are changed: the target is built from the loader's own copies.
  const first = targetFromBundle(decoded, importChoicesOf(null, []));
  decoded.files[0].bytes[0] ^= 0xff;
  const second = targetFromBundle(decoded, importChoicesOf(null, []));
  assert.deepEqual(second.map(f => [f.path, sha(f.bytes)]), first.map(f => [f.path, sha(f.bytes)]));
  assert.deepEqual(inspectBundle(decoded).codeFiles, (await bundleOf(richMap())).encoded.summary.codeFiles);
});

test('the hash and the length of a decode describe the bytes as they were when the call began, even if the caller changes the buffer while it waits', async () => {
  const map = smallMap({ scripts: 'scripts/' });
  for (let i = 0; i < 24; i += 1) map[`scripts/b${i}.bin`] = randomBytes(MIB - 1);
  const { encoded } = await bundleOf(map);
  const bytes = Buffer.from(encoded.bytes);
  const original = sha(bytes);
  const pending = decodeBundle(bytes);
  let changed = false;
  setImmediate(() => { bytes.fill(0x20); changed = true; });
  const outcome = await pending;
  assert.equal(changed, true, 'the buffer was changed while decode waited between files');
  assert.equal(outcome.sha256, original, 'the hash is of the bytes as they were');
  assert.equal(outcome.bytes, encoded.bytes.length);
  assert.ok(outcome.files.length > 20, 'and the files are the ones parsed from them');
});
