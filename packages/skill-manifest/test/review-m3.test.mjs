import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import dns from 'node:dns/promises';
import { performance } from 'node:perf_hooks';
import { syncBuiltinESMExports } from 'node:module';
import { denyNetwork } from './support/fixtures.mjs';
import { npmCollections } from './support/expected.mjs';
import { createPublicTransport, PUBLIC_GET_LIMITS } from '../../../dist/packages/skill-manifest/src/public-get.js';
import { parseManifest } from '../../../dist/packages/skill-manifest/src/schema.js';
import { addLocalEntry, planManifestChange, applyManifestChange } from '../../../dist/packages/skill-manifest/src/add.js';
import { serializeManifest } from '../../../dist/packages/skill-manifest/src/schema.js';
import { checkManifest } from '../../../dist/packages/skill-manifest/src/check.js';
import { NPM_LIMITS } from '../../../dist/packages/skill-sources/src/npm.js';
import { GIT_LIMITS } from '../../../dist/packages/skill-sources/src/git.js';
import { withProjectLock } from '../../../dist/packages/project-context/src/index.js';
import { newCommandJson, reportFailure } from '../../../dist/apps/cli/src/human.js';

// The fixes for the M3 security review, scratchpad REVIEW-M3-01.md, findings 1, 2, 3, 5 and 6.
const network = denyNetwork();
after(() => assert.deepEqual(network, [], 'no test in this file touches the network'));
const code = expected => error => error?.code === expected;
const URL_NPM = 'https://registry.npmjs.org/@synthetic/db-skills/0.0.1';

// The timeout makes a lookup that never settles fail this test rather than hang the run.
test('finding 1: a lookup that never answers settles on abort, on close(), and on the request and transport limits', { timeout: 20000 }, async t => {
  const requests = [];
  const never = () => { t.mock.restoreAll(); t.mock.method(dns, 'lookup', () => new Promise(() => {})); t.mock.method(https, 'request', (...args) => { requests.push(args); throw new Error('no request may start'); }); syncBuiltinESMExports(); };
  const settles = async (get, budgetMs) => { const start = performance.now(); await assert.rejects(get, code('SKILLS_ADD_NETWORK')); const took = performance.now() - start; assert.ok(took < budgetMs, `settled after ${Math.round(took)} ms`); };
  never(); let transport = createPublicTransport(); const abort = new AbortController(); setTimeout(() => abort.abort(), 50).unref();
  await settles(transport.get(URL_NPM, 1024, abort.signal), 2500); transport.close();
  never(); transport = createPublicTransport(); setTimeout(() => transport.close(), 50).unref();
  await settles(transport.get(URL_NPM, 1024, new AbortController().signal), 2500);
  never(); transport = createPublicTransport({ requestMs: 100 });
  await settles(transport.get(URL_NPM, 1024, new AbortController().signal), 2500); transport.close();
  never(); transport = createPublicTransport({ durationMs: 100 });
  await settles(transport.get(URL_NPM, 1024, new AbortController().signal), 2500); transport.close();
  // A second GET to the same host waits on the same pending lookup, and settles too.
  never(); transport = createPublicTransport({ requestMs: 100 });
  await settles(transport.get(URL_NPM, 1024, new AbortController().signal), 2500); await settles(transport.get(URL_NPM, 1024, new AbortController().signal), 2500); transport.close();
  assert.deepEqual(requests, []);
});

test('finding 3: the public GET limits match GIT_LIMITS, except the total, which npm needs to be 8 MiB plus its metadata bound', () => {
  assert.equal(PUBLIC_GET_LIMITS.requests, GIT_LIMITS.requests); assert.equal(PUBLIC_GET_LIMITS.requests, 130);
  assert.equal(PUBLIC_GET_LIMITS.responseBytes, GIT_LIMITS.responseBytes);
  assert.equal(PUBLIC_GET_LIMITS.totalBytes, NPM_LIMITS.metadataBytes + NPM_LIMITS.compressedBytes); assert.equal(PUBLIC_GET_LIMITS.totalBytes, 8912896);
  assert.ok(PUBLIC_GET_LIMITS.totalBytes >= GIT_LIMITS.payloadBytes);
  assert.throws(() => createPublicTransport({ requests: 131 }), code('SKILLS_ADD_NETWORK'));
});

/** The sample npm entry with its license file moved: `sourcePath` in the package, mapped as `filePath`. */
function npmLicense(sourcePath, filePath = path.posix.basename(sourcePath)) {
  const entry = { id: 'collections', ...structuredClone(npmCollections()) };
  const license = entry.files.find(f => f.path === entry.license.files[0]);
  license.sourcePath = sourcePath; license.path = filePath; entry.license.files = [filePath];
  return Buffer.from(JSON.stringify({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: [entry] }));
}
test('finding 2: an npm license file outside the skill folder sits in the skill folder or a folder above it, has a LICENSE name, and keeps that name', () => {
  assert.equal(npmCollections().skill.sourceRoot, 'skills/synthetic-db/collections');
  for (const ok of ['LICENSE', 'skills/LICENSE', 'skills/synthetic-db/LICENSE.md', 'LICENSE-MIT']) assert.doesNotThrow(() => parseManifest(npmLicense(ok)), ok);
  const refused = [
    ['dist/index.js', 'docs/NOTICE'], // the review's probe: any package file mapped in as a license
    ['docs/LICENSE', 'LICENSE'], // a folder that is not above the skill
    ['skills/synthetic-db/collectionsx/LICENSE', 'LICENSE'], // a name that only starts like the skill folder
    ['skills/other/LICENSE', 'LICENSE'],
    ['LICENSE', 'LICENSE-ROOT'], // the name changed on the way in
    ['NOTICE', 'NOTICE'], // not a LICENSE name
    ['COPYING', 'LICENSE'],
  ];
  for (const [sourcePath, filePath] of refused) assert.throws(() => parseManifest(npmLicense(sourcePath, filePath)), code('MANIFEST_INVALID'), `${sourcePath} as ${filePath}`);
});

function project(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-review-m3-'))); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.bowerloom'), { mode: 0o755 }); fs.chmodSync(path.join(dir, '.bowerloom'), 0o755);
  return { dir, file: path.join(dir, '.bowerloom', 'skills.json') };
}
const locked = (dir, work) => withProjectLock(dir, new AbortController().signal, async held => work(held));
const local = id => ({ id, source: { kind: 'local', path: `skills/${id}` } });

test('finding 5: a read after the write that does not match has its own code and says the file was written', async t => {
  for (const existing of [false, true]) {
    const p = project(t);
    if (existing) fs.writeFileSync(p.file, serializeManifest(addLocalEntry(null, 'first', [])));
    const plan = planManifestChange(p.dir, { add: local('second') });
    const place = existing ? 'renameSync' : 'linkSync', original = fs[place];
    // Another program writes skills.json the moment after Bowerloom put its bytes in place.
    t.mock.method(fs, place, function (from, to) { const result = original.call(this, from, to); if (String(to).endsWith('skills.json')) fs.appendFileSync(to, ' '); return result; });
    await assert.rejects(locked(p.dir, held => applyManifestChange(plan, plan.revision, held)), error => {
      assert.equal(error.code, 'MANIFEST_WRITE_UNCONFIRMED'); assert.match(error.message, /was written/); assert.doesNotMatch(error.message, /Nothing was applied/);
      assert.ok(!error.message.includes(p.dir)); return true;
    });
    t.mock.restoreAll();
    const words = reportFailure(Object.assign(new Error(), { code: 'MANIFEST_WRITE_UNCONFIRMED' }), true).text;
    assert.match(words, /bowerloom skills check/);
  }
});

test('finding 5: a MANIFEST_UNSAFE from a leftover second link names the .skills.json.*.tmp file in its plain words, with no absolute path', t => {
  const p = project(t);
  fs.writeFileSync(p.file, serializeManifest(addLocalEntry(null, 'first', [])));
  fs.linkSync(p.file, path.join(p.dir, '.bowerloom', '.skills.json.0123456789abcdef.tmp'));
  let caught; try { checkManifest(p.dir); } catch (error) { caught = error; }
  assert.equal(caught?.code, 'MANIFEST_UNSAFE');
  assert.throws(() => planManifestChange(p.dir, { add: local('second') }), code('MANIFEST_UNSAFE'));
  const words = reportFailure(caught, true).text;
  assert.match(words, /\.bowerloom\/\.skills\.json\.\*\.tmp/); assert.ok(!words.includes(p.dir), words);
  // On a pipe the envelope is today's: the fixed code and message only.
  assert.equal(reportFailure(caught, false).text, `${JSON.stringify({ error: { code: 'MANIFEST_UNSAFE', message: caught.message } })}\n`);
  assert.ok(!caught.message.includes(p.dir));
  // Any other second link keeps the general words.
  const q = project(t);
  fs.writeFileSync(q.file, serializeManifest(addLocalEntry(null, 'first', []))); fs.linkSync(q.file, path.join(q.dir, 'second.json'));
  let other; try { checkManifest(q.dir); } catch (error) { other = error; }
  assert.equal(other?.code, 'MANIFEST_UNSAFE'); assert.doesNotMatch(reportFailure(other, true).text, /\.tmp/);
});

test('finding 6: newCommandJson escapes DEL too, and the value parses back the same', () => {
  const text = newCommandJson({ a: 'x\u007fy' });
  assert.equal(text, '{"a":"x\\u007fy"}\n'); assert.deepEqual(JSON.parse(text), { a: 'x\u007fy' });
});
