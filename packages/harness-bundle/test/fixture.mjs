// Helpers for the harness-bundle tests: made-up harnesses (the files of the definition tests), bundles built from them, and a way to forge a bundle that is
// well formed except for one thing. Every value is fake. A helper that makes a folder removes it through `tempDir(t)`, which registers the removal with the test.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fullFiles } from '../../harness-definition/test/fixture.mjs';
import { computeRevision, loadDefinitionFiles } from '../../../dist/packages/harness-definition/src/index.js';
import { BUNDLE_FORMAT, decodeBundle, encodeBundle } from '../../../dist/packages/harness-bundle/src/index.js';

export { fullFiles };
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = value => `${JSON.stringify(value, null, 2)}\n`;

/** A temporary folder, as a real path (the writer refuses a folder reached through a link), removed after the test. */
export function tempDir(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-bundle-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The files of a definition from a map of path to text or bytes; a value of `undefined` leaves the file out. `exec` lists paths that get an execute bit. */
export function filesOf(map, exec = ['scripts/lint.sh']) {
  return Object.entries(map).filter(([, c]) => c !== undefined).map(([p, c]) => ({ path: p, bytes: typeof c === 'string' ? Buffer.from(c, 'utf8') : Buffer.from(c), executable: exec.includes(p) }));
}

/** The loaded definition of a map of files. */
export function definitionOf(map, exec) {
  const loaded = loadDefinitionFiles(filesOf(map, exec), '');
  if (!loaded.ok) throw new Error(`the made-up harness does not load: ${JSON.stringify(loaded.problems)}`);
  return loaded.definition;
}

/** A definition with its notes sources set (the loader only fills `knowledge` from a `knowledge.json`, so the rich map includes one when it is wanted). */
export const richMap = (overrides = {}) => fullFiles(overrides);

/** A harness that only has the files it needs: harness.json and what the parts point at. */
export function smallMap(parts, extra = {}) {
  return {
    'harness.json': json({ format: 'bowerloom/harness/v1beta1', id: 'demo', description: 'A demo harness.', engines: [{ id: 'claude-code' }], parts }),
    ...extra,
  };
}

/** The bundle of a map: the encoder's answer, the decoded bundle, the definition. */
export async function bundleOf(map, options, exec) {
  const def = definitionOf(map, exec);
  const encoded = await encodeBundle(def, options);
  const decoded = await decodeBundle(encoded.bytes);
  return { def, encoded, decoded };
}

/** The parsed envelope of a bundle's bytes. */
export const parsed = bytes => JSON.parse(Buffer.from(bytes).toString('utf8'));
/** Bytes of an envelope object, in the canonical form. */
export const bytesOf = envelope => Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`, 'utf8');

/** A file record for a forged bundle: size and hash are right for `content`. */
export function record(p, content, extra = {}) {
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
  const utf8 = typeof content === 'string';
  return { path: p, size: bytes.length, sha256: sha(bytes), encoding: utf8 ? 'utf8' : 'base64', data: utf8 ? content : bytes.toString('base64'), ...extra };
}

/** An envelope with the right revision for the records that carry real content (`data` decoded by `encoding`). */
export function envelopeOf(unsorted, extra = {}) {
  const records = [...unsorted].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const files = records.map(r => ({ path: r.path, bytes: r.encoding === 'base64' ? Buffer.from(r.data, 'base64') : Buffer.from(r.data, 'utf8') }));
  let revision;
  try { revision = computeRevision(files); } catch { revision = `sha256:${'0'.repeat(64)}`; }
  return { format: BUNDLE_FORMAT, harness: 'demo', generator: 'bowerloom', revision, files: records, knowledge: [], ...extra };
}

/** Rebuilds `size`, `sha256` and the revision of an envelope after a test changed `files`. */
export function mend(envelope) {
  const files = envelope.files.map(r => {
    const bytes = r.encoding === 'base64' ? Buffer.from(r.data, 'base64') : Buffer.from(r.data, 'utf8');
    return { ...r, size: bytes.length, sha256: sha(bytes) };
  });
  const forRevision = files.map(r => ({ path: r.path, bytes: r.encoding === 'base64' ? Buffer.from(r.data, 'base64') : Buffer.from(r.data, 'utf8') }));
  return { ...envelope, files, revision: computeRevision(forRevision) };
}

/** Asserts that a promise (or a function that returns one) rejects with a `BundleRefusal` of the given code, and returns the refusal. */
export async function refusal(assert, work, code) {
  let error;
  try { await (typeof work === 'function' ? work() : work); } catch (e) { error = e; }
  assert.ok(error, `expected the refusal ${code}, but nothing was thrown`);
  assert.equal(error.name, 'BundleRefusal', `expected a BundleRefusal, got ${error?.name}: ${error?.message}`);
  assert.equal(error.code, code, `expected ${code}, got ${error.code}`);
  return error;
}
