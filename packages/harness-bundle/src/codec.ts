/**
 * Encoding and decoding of the bundle file, and the one place that loads a bundle's files as a harness. The README states the trust boundary; the order of the checks in
 * `decodeBundle` is the order of its comments. Nothing here touches the disk, starts a program, or imports code at run time.
 */
import { createHash } from 'node:crypto';
import {
  DEFINITION_LIMITS, KNOWLEDGE_FILE, computeRevision, isId, isKnowledgeKind, loadDefinitionFiles, scanSecrets,
} from '../../harness-definition/src/index.js';
import type { Definition, DefinitionFile, Problem } from '../../harness-definition/src/index.js';
import { BundleRefusal, causeOf } from './codes.js';
import { BUNDLE_FORMAT, BUNDLE_LIMITS } from './limits.js';
import { clashingPaths, isBundlePath, sortByBytes } from './path-grammar.js';
import { JsonFault, parseStrictJson } from './strict-json.js';
import type { JsonNode } from './strict-json.js';
import { checkToolText, safeLine, sha256Hex, summarize } from './summary.js';
import { turnTaker } from './turn.js';
import { checkWorkBudget } from './work-budget.js';
import { isWellFormedText } from './well-formed.js';
import type { BundleEncoding, BundleFileRecord, BundleSource, BundleSummary, DecodedBundle, EncodedBundle, EncodeOptions } from './types.js';

const refuse = (code: ConstructorParameters<typeof BundleRefusal>[0], paths: readonly string[] = [], problems: readonly Problem[] = []): never => {
  throw new BundleRefusal(code, paths, problems);
};

/**
 * The loaded definition of each decoded bundle that `decodeBundle` issued, so a second look (`inspectBundle`, `targetFromBundle`) does not load a large bundle again. Only
 * `decodeBundle` adds to it, and its bundles are frozen; any other object of the type is loaded again each time and never remembered.
 */
const loadedOf = new WeakMap<object, Definition>();
export const recallLoaded = (bundle: DecodedBundle): Definition | undefined => loadedOf.get(bundle);

/**
 * Looks for a secret in the file names, with the same scan as the file contents: a name such as `scripts/ghp_…sh` would travel in the bundle and the summary. One name is one
 * line. Refuses `BUNDLE_SECRET_FOUND` and names the paths at fault.
 */
function checkNames(paths: readonly string[]): void {
  const lines = paths.map(p => p.replace(/[\r\n]/g, ' '));
  const found = scanSecrets([{ path: 'names.txt', bytes: Buffer.from(lines.join('\n'), 'utf8') }]);
  const at = [...new Set(found.map(f => paths[(f.line ?? 1) - 1]).filter((p): p is string => p !== undefined))];
  // The refusal does not name the file: its name is the secret.
  if (at.length > 0) refuse('BUNDLE_SECRET_FOUND', at.map(() => '(a file name, not shown)'));
}

// ---- loading ------------------------------------------------------------------------------------------------------------------

/**
 * The files of a bundle as a harness, with one placeholder source for each notes name: `knowledge.json` is never in a bundle, so the names need somewhere to point for
 * the agents' `notes` to load. The placeholder paths are fixed text inside the harness folder; nothing is read there. Refuses with `BUNDLE_SECRET_FOUND`,
 * `BUNDLE_TOO_LARGE` or `BUNDLE_INVALID`.
 */
export function loadBundleParts(files: readonly DefinitionFile[], knowledge: readonly BundleSource[]): Definition {
  const placeholder: DefinitionFile[] = knowledge.length === 0 ? [] : [{
    path: KNOWLEDGE_FILE,
    bytes: Buffer.from(`${JSON.stringify({ sources: knowledge.map(k => ({ kind: k.kind, name: k.name, path: `bundle-notes/${k.name}` })) }, null, 2)}\n`, 'utf8'),
  }];
  const loaded = loadDefinitionFiles([...files, ...placeholder], '');
  if (loaded.ok) { checkToolText(loaded.definition); return loaded.definition; }
  const problems = loaded.problems.slice(0, DEFINITION_LIMITS.problems).map(p => ({ code: safeLine(p.code), path: safeLine(p.path), message: safeLine(p.message) }));
  const where = (codes: readonly string[]): string[] => [...new Set(problems.filter(p => codes.includes(p.code)).map(p => p.path))];
  if (where(['SECRET_VALUE']).length > 0) return refuse('BUNDLE_SECRET_FOUND', where(['SECRET_VALUE']), problems);
  if (where(['TOO_LARGE', 'TOO_DEEP']).length > 0) return refuse('BUNDLE_TOO_LARGE', where(['TOO_LARGE', 'TOO_DEEP']), problems);
  return refuse('BUNDLE_INVALID', [...new Set(problems.map(p => p.path))], problems);
}

// ---- decode -------------------------------------------------------------------------------------------------------------------

const HEX64 = /^[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const ODD_TEXT = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const isObject = (v: JsonNode | undefined): v is { [key: string]: JsonNode } => v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v);

/** True when the object has every required key, no key but the required and the optional ones. */
const closed = (o: { [key: string]: JsonNode }, required: readonly string[], optional: readonly string[] = []): boolean => {
  const keys = Object.keys(o);
  return required.every(k => Object.hasOwn(o, k)) && keys.every(k => required.includes(k) || optional.includes(k));
};

export async function decodeBundle(bytes: Uint8Array): Promise<DecodedBundle> {
  try {
    return await decode(bytes);
  } catch (error) {
    // Any other fault (a bug, or a limit of the runtime) still reaches the caller as a refusal, never as a stray error type.
    if (error instanceof BundleRefusal) throw error;
    throw new BundleRefusal('BUNDLE_FORMAT', [], [], causeOf(error));
  }
}

async function decode(bytes: Uint8Array): Promise<DecodedBundle> {
  const turn = turnTaker();
  // The hash and the length are of the bytes as they are now, before the first turn of the event loop: a caller that changes the buffer later cannot make them describe
  // other content than the text that is parsed below.
  // 1. The bytes: a size, no byte order mark, strict UTF-8.
  if (!(bytes instanceof Uint8Array)) return refuse('BUNDLE_USAGE');
  if (bytes.length > BUNDLE_LIMITS.fileBytes) return refuse('BUNDLE_TOO_LARGE');
  if (bytes.length === 0 || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) return refuse('BUNDLE_FORMAT');
  let text: string;
  try { text = utf8.decode(bytes); } catch { return refuse('BUNDLE_FORMAT'); }
  const fileSha256 = sha256Hex(bytes), fileLength = bytes.length;

  // 2. Strict JSON, bounded in depth and in the number of values.
  let root: JsonNode;
  try {
    root = await parseStrictJson(text, { maxDepth: BUNDLE_LIMITS.jsonDepth, maxNodes: BUNDLE_LIMITS.files * 8 + 1000 });
  } catch (error) {
    if (error instanceof JsonFault) return refuse(error.kind === 'nodes' ? 'BUNDLE_TOO_LARGE' : 'BUNDLE_FORMAT');
    throw error;
  }
  text = '';

  // 3. The closed shape of the envelope, the format, the revision, the names.
  if (!isObject(root) || !closed(root, ['format', 'harness', 'generator', 'revision', 'files', 'knowledge'])) return refuse('BUNDLE_FORMAT');
  if (root.format !== BUNDLE_FORMAT) return refuse('BUNDLE_FORMAT');
  const { harness, generator, revision } = root;
  if (typeof harness !== 'string' || !isId(harness)) return refuse('BUNDLE_FORMAT');
  if (typeof generator !== 'string' || generator.length > 200 || ODD_TEXT.test(generator) || !isWellFormedText(generator)) return refuse('BUNDLE_FORMAT');
  if (typeof revision !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(revision)) return refuse('BUNDLE_FORMAT');
  const knowledge = knowledgeOf(root.knowledge);
  const records = recordsOf(root.files);

  // 4. The paths: plain, no clash, in byte order, and the limits on sizes, before any byte is decoded.
  const unsafe = records.filter(r => !isBundlePath(r.path)).map(r => r.path);
  if (unsafe.length > 0) return refuse('BUNDLE_PATH_UNSAFE', unsafe);
  const clash = clashingPaths(records.map(r => r.path));
  if (clash.length > 0) return refuse('BUNDLE_PATH_UNSAFE', clash);
  const ordered = sortByBytes(records, r => r.path);
  if (ordered.some((r, i) => r !== records[i])) return refuse('BUNDLE_FORMAT');
  let declared = 0;
  for (const r of records) {
    if (r.size > BUNDLE_LIMITS.entryBytes) return refuse('BUNDLE_TOO_LARGE', [r.path]);
    declared += r.size;
    if (declared > BUNDLE_LIMITS.totalBytes) return refuse('BUNDLE_TOO_LARGE');
  }

  // 5. The bytes of each file, checked against its declared size and hash.
  const files: DefinitionFile[] = [];
  for (const r of records) {
    const data = decodeData(r);
    if (data.length !== r.size || sha256Hex(data) !== r.sha256) return refuse('BUNDLE_DAMAGED', [r.path]);
    files.push({ path: r.path, bytes: data, ...(r.executable === true ? { executable: true } : {}) });
    const wait = turn(); if (wait) await wait;
  }

  // 6. The bound on the loader's work, the secret scan of the names, then the secret scan of the contents and the load, in one pass of the loader (SECRET_VALUE is BUNDLE_SECRET_FOUND, the rest BUNDLE_INVALID).
  await checkWorkBudget(files);
  checkNames(files.map(f => f.path));
  const def = loadBundleParts(files, knowledge);
  if (def.harness.id !== harness) return refuse('BUNDLE_DAMAGED');

  // 7. The revision of the decoded files.
  if (computeRevision(files) !== revision) return refuse('BUNDLE_DAMAGED');

  const decoded: DecodedBundle = Object.freeze({
    format: BUNDLE_FORMAT,
    harness,
    generator,
    revision,
    sha256: fileSha256,
    bytes: fileLength,
    files: Object.freeze(files.map(f => Object.freeze(f))),
    knowledge: Object.freeze(knowledge.map(k => Object.freeze(k))),
  });
  loadedOf.set(decoded, def);
  return decoded;
}

interface RecordInput extends Omit<BundleFileRecord, 'executable'> { readonly executable?: true }

function recordsOf(value: JsonNode | undefined): RecordInput[] {
  if (!Array.isArray(value)) return refuse('BUNDLE_FORMAT');
  if (value.length > BUNDLE_LIMITS.files) return refuse('BUNDLE_TOO_LARGE');
  return value.map(item => {
    if (!isObject(item) || !closed(item, ['path', 'size', 'sha256', 'encoding', 'data'], ['executable'])) return refuse('BUNDLE_FORMAT');
    const { path, size, sha256, encoding, data, executable } = item;
    if (typeof path !== 'string' || typeof data !== 'string' || typeof sha256 !== 'string' || !HEX64.test(sha256)) return refuse('BUNDLE_FORMAT');
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) return refuse('BUNDLE_FORMAT');
    if (encoding !== 'utf8' && encoding !== 'base64') return refuse('BUNDLE_FORMAT');
    if (executable !== undefined && executable !== true) return refuse('BUNDLE_FORMAT');
    return { path, size, sha256, encoding, data, ...(executable === true ? { executable: true as const } : {}) };
  });
}

function knowledgeOf(value: JsonNode | undefined): BundleSource[] {
  if (!Array.isArray(value)) return refuse('BUNDLE_FORMAT');
  if (value.length > BUNDLE_LIMITS.notesNames) return refuse('BUNDLE_TOO_LARGE');
  const names = new Set<string>();
  return value.map(item => {
    if (!isObject(item) || !closed(item, ['kind', 'name'])) return refuse('BUNDLE_FORMAT');
    const { kind, name } = item;
    if (!isKnowledgeKind(kind) || typeof name !== 'string' || !isId(name) || names.has(name)) return refuse('BUNDLE_FORMAT');
    names.add(name);
    return { kind, name };
  });
}

/** The bytes of one record. The length of the text is checked against the declared size before anything is allocated. A mismatch is `BUNDLE_DAMAGED`. */
function decodeData(r: RecordInput): Buffer {
  if (r.encoding === 'utf8') {
    if (r.data.length > r.size || Buffer.byteLength(r.data, 'utf8') !== r.size) return refuse('BUNDLE_DAMAGED', [r.path]);
    return Buffer.from(r.data, 'utf8');
  }
  if (r.data.length !== Math.ceil(r.size / 3) * 4 || !BASE64.test(r.data)) return refuse('BUNDLE_DAMAGED', [r.path]);
  const data = Buffer.from(r.data, 'base64');
  // Only the canonical form counts: the same bytes always have one text.
  if (data.length !== r.size || data.toString('base64') !== r.data) return refuse('BUNDLE_DAMAGED', [r.path]);
  return data;
}

// ---- encode -------------------------------------------------------------------------------------------------------------------

const NOT_PLAIN_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cf}\u2028\u2029]/u;
const NAME_OF_GENERATOR = /^[A-Za-z0-9._@+-]{1,100}$/;
const b64Length = (n: number): number => Math.ceil(n / 3) * 4;

/** `utf8` when the bytes are strict UTF-8 text with no byte order mark and no hidden control character, and the escaped text is not larger than base64; else `base64`. */
function encodingOf(bytes: Uint8Array): { encoding: BundleEncoding; data: string } {
  const b64 = (): { encoding: BundleEncoding; data: string } => ({ encoding: 'base64', data: Buffer.from(bytes).toString('base64') });
  if (bytes.length === 0) return { encoding: 'utf8', data: '' };
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return b64();
  let text: string;
  try { text = utf8.decode(bytes); } catch { return b64(); }
  if (NOT_PLAIN_TEXT.test(text)) return b64();
  const escaped = Buffer.byteLength(JSON.stringify(text), 'utf8') - 2;
  return b64Length(bytes.length) < escaped ? b64() : { encoding: 'utf8', data: text };
}

const indent = (text: string, by: string): string => text.split('\n').join(`\n${by}`);

export async function encodeBundle(def: unknown, options?: EncodeOptions): Promise<EncodedBundle> {
  try {
    return await encode(def, options);
  } catch (error) {
    // Only a refusal leaves, as from `decodeBundle`. Any other fault is a defect or a limit of the runtime; its kind is kept in `cause`.
    if (error instanceof BundleRefusal) throw error;
    throw new BundleRefusal('BUNDLE_INVALID', [], [], causeOf(error));
  }
}

async function encode(def: unknown, options?: EncodeOptions): Promise<EncodedBundle> {
  const turn = turnTaker();
  const opts = optionsOf(options);
  const { files, knowledge } = partsOf(def);

  // The paths, the limits, then the load: the same checks `decodeBundle` makes, so no bundle is written that cannot be read back.
  const unsafe = files.filter(f => !isBundlePath(f.path)).map(f => f.path);
  if (unsafe.length > 0) return refuse('BUNDLE_PATH_UNSAFE', unsafe);
  const clash = clashingPaths(files.map(f => f.path));
  if (clash.length > 0) return refuse('BUNDLE_PATH_UNSAFE', clash);
  if (files.length > BUNDLE_LIMITS.files) return refuse('BUNDLE_TOO_LARGE');
  let total = 0;
  for (const f of files) {
    if (f.bytes.length > BUNDLE_LIMITS.entryBytes) return refuse('BUNDLE_TOO_LARGE', [f.path]);
    total += f.bytes.length;
    if (total > BUNDLE_LIMITS.totalBytes) return refuse('BUNDLE_TOO_LARGE');
  }
  const sorted = sortByBytes(files, f => f.path);
  await checkWorkBudget(sorted);
  checkNames(sorted.map(f => f.path));
  const loaded = loadBundleParts(sorted, knowledge);
  const revision = computeRevision(sorted);

  const records: string[] = [];
  for (const f of sorted) {
    const { encoding, data } = encodingOf(f.bytes);
    const record = { path: f.path, size: f.bytes.length, sha256: sha256Hex(f.bytes), encoding, data, ...(f.executable === true ? { executable: true } : {}) };
    records.push(`    ${indent(JSON.stringify(record, null, 2), '    ')}`);
    const wait = turn(); if (wait) await wait;
  }
  const text = [
    '{',
    `  "format": ${JSON.stringify(BUNDLE_FORMAT)},`,
    `  "harness": ${JSON.stringify(loaded.harness.id)},`,
    `  "generator": ${JSON.stringify(opts.generator)},`,
    `  "revision": ${JSON.stringify(revision)},`,
    records.length === 0 ? '  "files": [],' : `  "files": [\n${records.join(',\n')}\n  ],`,
    `  "knowledge": ${indent(JSON.stringify(knowledge, null, 2), '  ')}`,
    '}',
    '',
  ].join('\n');
  // UTF-8 never takes fewer bytes than the text has UTF-16 units, so a text over the limit in units is over it in bytes too: no copy is made.
  if (text.length > BUNDLE_LIMITS.fileBytes) return refuse('BUNDLE_TOO_LARGE');
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > BUNDLE_LIMITS.fileBytes) return refuse('BUNDLE_TOO_LARGE');
  const summary: BundleSummary = summarize(loaded, sorted, knowledge, opts);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), summary };
}

interface CheckedOptions extends EncodeOptions { readonly generator: string }
function optionsOf(options: EncodeOptions | undefined): CheckedOptions {
  if (options === undefined) return { generator: 'bowerloom' };
  if (options === null || typeof options !== 'object' || Object.keys(options).some(k => k !== 'home' && k !== 'user' && k !== 'generator')) return refuse('BUNDLE_USAGE');
  const { home, user, generator } = options;
  if (home !== undefined && (typeof home !== 'string' || home.length > 4096 || home.includes('\0'))) return refuse('BUNDLE_USAGE');
  if (user !== undefined && (typeof user !== 'string' || user.length > 256 || user.includes('\0'))) return refuse('BUNDLE_USAGE');
  if (generator !== undefined && (typeof generator !== 'string' || !NAME_OF_GENERATOR.test(generator))) return refuse('BUNDLE_USAGE');
  return { ...(home !== undefined ? { home } : {}), ...(user !== undefined ? { user } : {}), generator: generator ?? 'bowerloom' };
}

/** The files (never `knowledge.json`) and the notes names of a definition, copied. A value that is not a definition is `BUNDLE_USAGE`. */
function partsOf(def: unknown): { files: DefinitionFile[]; knowledge: BundleSource[] } {
  try {
    const d = def as { files?: unknown; knowledge?: unknown };
    if (d === null || typeof d !== 'object' || !Array.isArray(d.files) || !Array.isArray(d.knowledge)) return refuse('BUNDLE_USAGE');
    const files: DefinitionFile[] = [];
    for (const f of d.files as readonly unknown[]) {
      const x = f as { path?: unknown; bytes?: unknown; executable?: unknown };
      if (x === null || typeof x !== 'object' || typeof x.path !== 'string' || !(x.bytes instanceof Uint8Array)) return refuse('BUNDLE_USAGE');
      if (x.path === KNOWLEDGE_FILE) continue;
      files.push({ path: x.path, bytes: x.bytes, ...(x.executable === true ? { executable: true } : {}) });
    }
    const knowledge: BundleSource[] = [];
    for (const k of d.knowledge as readonly unknown[]) {
      const x = k as { kind?: unknown; name?: unknown };
      if (x === null || typeof x !== 'object' || !isKnowledgeKind(x.kind) || typeof x.name !== 'string' || !isId(x.name)) return refuse('BUNDLE_USAGE');
      knowledge.push({ kind: x.kind, name: x.name });
    }
    if (knowledge.length > BUNDLE_LIMITS.notesNames) return refuse('BUNDLE_TOO_LARGE');
    return { files, knowledge };
  } catch (error) {
    if (error instanceof BundleRefusal) throw error;
    return refuse('BUNDLE_USAGE');
  }
}
