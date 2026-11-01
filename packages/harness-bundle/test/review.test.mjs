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
import { causeOf } from '../../../dist/packages/harness-bundle/src/codec.js';
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

test('the worst bundles that pass the budgets are accepted, and cost the loader about two seconds, off the main thread', async () => {
  // Frontmatter: 15 skills of 5,500 keys is 0.8 MiB of YAML, under the 1 MiB budget.
  const yaml = await inWorker(copyOf(skillBundle(15, 5500)));
  report('15 skills x 5,500 keys (accepted)', yaml);
  assert.equal(yaml.answer.ok, true, JSON.stringify(yaml.answer.refusal));
  assert.equal(yaml.answer.summary.counts.skills, 15);
  assert.ok(yaml.answer.ms < 60_000);
  assert.ok(yaml.longest < 1000);
  // Scan: 7 files of a?a=a?a= text is 3.5 million places for the scan, under the 4 million budget.
  const scan = await inWorker(copyOf(textBundle('a?a=', 7)));
  report('7 MiB of a?a= (accepted)', scan);
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
  assert.equal(yamlBytes(file('SKILL.md', 'no frontmatter\n')), 0);
  assert.equal(yamlBytes(file('a.json', '{}')), 0);
  assert.equal(scanUnits('plain words of prose here', 1e9), 0, 'short tokens are not scanned for shapes');
  assert.equal(scanUnits('a?a=a?a=', 1e9), 4);
  assert.equal(scanUnits('abcdefghij', 1e9), 1);
  assert.equal(scanUnits('abcdefghij abcdefghij', 1e9), 2);
  assert.ok(scanUnits('a?a='.repeat(1000), 100) > 100, 'it stops once past the cap');
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

test('the grammar refuses a name that ends in a dot or a space, a Windows device name, and Knowledge.json in any case', () => {
  for (const bad of ['scripts/a.md.', 'scripts/a.md ', 'scripts/a./b.sh', 'scripts/CON', 'scripts/con.txt', 'scripts/Aux.md', 'scripts/NUL', 'scripts/prn.x.y', 'scripts/COM1', 'scripts/com9.sh', 'scripts/LPT3.log',
    'scripts/COM¹', 'Knowledge.json', 'KNOWLEDGE.JSON', 'knowledge.JSON']) assert.equal(isBundlePath(bad), false, bad);
  for (const good of ['scripts/console.md', 'scripts/auxiliary.sh', 'scripts/com10.sh', 'scripts/a.b', 'skills/x/knowledge.json', 'scripts/ncon', 'scripts/contact.md']) assert.equal(isBundlePath(good), true, good);
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

test('an error with no system code is a defect: it passes on unchanged and is not turned into a file refusal', async t => {
  const dir = tempDir(t);
  setFileIoHook('link', () => { throw new TypeError('a bug'); });
  await assert.rejects(writeBundleFile(path.join(dir, 'out.json'), Buffer.from('x')), e => e instanceof TypeError && e.message === 'a bug');
  clearFileIoHooks();
  nothingLeft(dir);
  setFileIoHook('afterStat', () => { throw new RangeError('a bug in a read'); });
  fs.writeFileSync(path.join(dir, 'in.json'), 'x');
  await assert.rejects(readBundleFile(path.join(dir, 'in.json')), e => e instanceof RangeError);
  clearFileIoHooks();
});

test('a refusal crosses a boundary as toJSON and comes back whole with fromPlain; a bad value is BUNDLE_USAGE', () => {
  const e = new BundleRefusal('BUNDLE_PATH_UNSAFE', ['skills/a\nb', 'x'.repeat(500)], [{ code: 'C', path: 'p', message: 'm' }], 'ENOSPC');
  const plain = JSON.parse(JSON.stringify(e));
  assert.deepEqual(Object.keys(plain).sort(), ['cause', 'code', 'message', 'name', 'paths', 'problems'], 'a missing reason is left out of the text');
  const back = BundleRefusal.fromPlain(plain);
  assert.equal(back.code, e.code);
  assert.equal(back.message, e.message);
  assert.deepEqual(back.paths, e.paths);
  assert.deepEqual(back.problems, e.problems);
  assert.equal(back.cause, 'ENOSPC');
  for (const bad of [null, undefined, 5, 'x', {}, { code: 'NOPE' }, { code: 5 }]) assert.equal(BundleRefusal.fromPlain(bad).code, 'BUNDLE_USAGE');
  const wild = BundleRefusal.fromPlain({ code: 'BUNDLE_FORMAT', message: 'x\u001b[31m'.repeat(5000), paths: Array.from({ length: 50 }, () => 'p'), cause: '../../etc', problems: 'no' });
  assert.ok(wild.message.length <= 4000);
  noControls(wild.message);
  assert.equal(wild.paths.length, 20);
  assert.equal(wild.cause, undefined);
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
  // The leftover is swept by a later write once it is old.
  const left = fs.readdirSync(dir).filter(n => n.endsWith('.part'));
  assert.equal(left.length, 1);
});

test('a later write sweeps the .part files of an earlier one that are older than a day, and only those', async t => {
  const dir = tempDir(t);
  const old = path.join(dir, `.bowerloom-${'a'.repeat(24)}.part`);
  const fresh = path.join(dir, `.bowerloom-${'b'.repeat(24)}.part`);
  const other = path.join(dir, `.bowerloom-${'c'.repeat(23)}.part`);
  const mine = path.join(dir, '.something.part');
  const dirLike = path.join(dir, `.bowerloom-${'d'.repeat(24)}.part`);
  for (const f of [old, fresh, other, mine]) fs.writeFileSync(f, 'x');
  fs.mkdirSync(dirLike);
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  for (const f of [old, other, mine]) fs.utimesSync(f, twoDaysAgo, twoDaysAgo);
  fs.utimesSync(dirLike, twoDaysAgo, twoDaysAgo);
  await writeBundleFile(path.join(dir, 'out.json'), Buffer.from('x'));
  assert.equal(fs.existsSync(old), false, 'the old file of our form is gone');
  assert.equal(fs.existsSync(fresh), true, 'a recent one may belong to a write that is running');
  assert.equal(fs.existsSync(other), true, 'a name of another form is not ours');
  assert.equal(fs.existsSync(mine), true);
  assert.equal(fs.existsSync(dirLike), true, 'a folder is not a file of ours');
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
  setImmediate(() => { bytes.fill(0x20); });
  let outcome;
  try { outcome = await pending; } catch (error) { outcome = error; }
  if (outcome instanceof BundleRefusal) assert.ok(true, 'a refusal is a fair answer');
  else assert.equal(outcome.sha256, original, 'the hash is of the bytes as they were');
});
