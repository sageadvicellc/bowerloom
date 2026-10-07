import https from 'node:https';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { types } from 'node:util';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { Header } from 'tar/header';
import { AdapterError, strictJson } from '../../codex-adapter/src/safe.js';
import { SkillSourceError, captureSkillData, closed, boundedText, relativeSkillPath, hashValue, revisionOf, freezeSkillData, validateSkillSource } from './validation.js';
import type { SkillTextFile, SkillLicense } from './types.js';
import { validateCacheBinding, openNpmCacheOperation, fixedCode, secondaryCodes, strictUtf8, REFUSAL_CODES, SECONDARY_CODES } from './cache.js';
import type { SkillCacheBinding, AcquiredSkillCacheReceipt } from './cache.js';
import { guardedResponseHeaders } from './response-headers.js';

export const NPM_ACQUISITION_POLICY = 'bowerloom/npm-acquisition/ustar-v1beta1';
export const NPM_LIMITS = Object.freeze({ planBytes: 196608, metadataBytes: 524288, compressedBytes: 8388608, tarBytes: 33554432, records: 1024, files: 128, directories: 128, fileBytes: 65536, selectedBytes: 2097152, headerBytes: 16384, requests: 2, durationMs: 30000, requestMs: 10000, storageBytes: 12582912 });
export interface ExpectedSkillFile { path: string; sourcePath: string; sha256: string; bytes: number; mode: 420 }
export interface NpmAcquisitionRequest {
  package: string; version: string; integrity: string; metadataSha256: string; publisher: string; declaredLicense: SkillLicense;
  skill: { id: string; name: string; sourceRoot: string };
  files: ExpectedSkillFile[]; references: { from: string; to: string }[];
  license: { spdx: SkillLicense; origin: 'included'; files: string[] };
}
export interface NpmAcquisitionPlan {
  format: 'bowerloom/npm-acquisition-plan/v1beta1'; policy: typeof NPM_ACQUISITION_POLICY; parser: 'tar@7.5.20/Header';
  request: NpmAcquisitionRequest; cache: SkillCacheBinding;
  metadataUrl: string; archiveUrl: string; limits: typeof NPM_LIMITS; revision: string;
}
export interface ObservedNpmPayload {
  source: { kind: 'npm'; registry: 'https://registry.npmjs.org'; package: string; version: string; integrity: string; archiveSha256: string; metadataSha256: string; publisher: string; declaredLicense: SkillLicense };
  skill: NpmAcquisitionRequest['skill']; files: SkillTextFile[]; references: NpmAcquisitionRequest['references']; license: NpmAcquisitionRequest['license'];
  contentRevision: string; inventoryRevision: string; recordCount: number;
}
export class NpmAcquisitionError extends Error {
  /** Fixed secondary codes only. Each reports cleanup that the refusal could not confirm. */
  readonly secondary: readonly string[];
  constructor(readonly code: string, secondary: readonly string[] = []) { super(code); this.name = 'NpmAcquisitionError'; this.secondary = Object.freeze(secondary.filter(value => SECONDARY_CODES.includes(value))); }
}
export function npmRefuse(code: string, secondary: readonly string[] = []): never { throw new NpmAcquisitionError(code, secondary); }
export function npmCheck(ok: unknown, code: string): asserts ok { if (!ok) npmRefuse(code); }
export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
// Only a validation refusal becomes NPM_INPUT. A TypeError or another fault reaches the boundary's fixed fallback.
function exact<T>(value: unknown, keys: string[]): T { try { return closed(value, keys) as T; } catch (error) { if (error instanceof SkillSourceError) return npmRefuse('NPM_INPUT'); throw error; } }
function safe<T>(work: () => T): T { try { return work(); } catch (error) { if (error instanceof SkillSourceError) return npmRefuse('NPM_INPUT'); throw error; } }
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

/** Pure proposal. This is not network consent or evidence that a package exists. */
export function planNpmAcquisition(requestValue: unknown, bindingValue: unknown): Readonly<NpmAcquisitionPlan> {
  try { return planRequest(requestValue, bindingValue); } catch (error) { return npmRefuse(fixedCode(error, REFUSAL_CODES.plan, 'NPM_PLAN_REFUSED')); }
}
function planRequest(requestValue: unknown, bindingValue: unknown): Readonly<NpmAcquisitionPlan> {
  const request = exact<NpmAcquisitionRequest>(requestValue, ['package', 'version', 'integrity', 'metadataSha256', 'publisher', 'declaredLicense', 'skill', 'files', 'references', 'license']);
  safe(() => { boundedText(request.package, 214); boundedText(request.version, 128); boundedText(request.publisher, 128); hashValue(request.metadataSha256); });
  npmCheck(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(request.package), 'NPM_INPUT');
  npmCheck(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(request.version), 'NPM_INPUT');
  const pre = request.version.split('-').slice(1).join('-');
  npmCheck(!pre || pre.split('.').every(p => !/^\d+$/.test(p) || p === '0' || !p.startsWith('0')), 'NPM_INPUT');
  npmCheck(typeof request.integrity === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(request.integrity) && Buffer.from(request.integrity.slice(7), 'base64').toString('base64') === request.integrity.slice(7), 'NPM_INPUT');
  npmCheck(['MIT', 'Apache-2.0'].includes(request.declaredLicense), 'NPM_INPUT');
  request.skill = exact(request.skill, ['id', 'name', 'sourceRoot']);
  safe(() => { for (const value of [request.skill.id, request.skill.name]) { boundedText(value, 64); npmCheck(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value), 'NPM_INPUT'); } relativeSkillPath(request.skill.sourceRoot); });
  request.license = exact(request.license, ['spdx', 'origin', 'files']);
  npmCheck(request.license.spdx === request.declaredLicense && request.license.origin === 'included' && Array.isArray(request.license.files) && request.license.files.length > 0 && request.license.files.length <= 8 && new Set(request.license.files).size === request.license.files.length, 'NPM_INPUT');
  safe(() => request.license.files.forEach(relativeSkillPath));
  npmCheck(Array.isArray(request.files) && request.files.length > 0 && request.files.length <= NPM_LIMITS.files, 'NPM_INPUT');
  let bytes = 0; const paths = new Set<string>(), sources = new Set<string>();
  request.files = request.files.map(raw => {
    const file = exact<ExpectedSkillFile>(raw, ['path', 'sourcePath', 'sha256', 'bytes', 'mode']);
    safe(() => { relativeSkillPath(file.path); relativeSkillPath(file.sourcePath); hashValue(file.sha256); });
    npmCheck(Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= NPM_LIMITS.fileBytes && (bytes += file.bytes) <= NPM_LIMITS.selectedBytes && file.mode === 420, 'NPM_INPUT');
    npmCheck(!paths.has(file.path.toLowerCase()) && !sources.has(file.sourcePath.toLowerCase()), 'NPM_INPUT'); paths.add(file.path.toLowerCase()); sources.add(file.sourcePath.toLowerCase());
    const license = request.license.files.includes(file.path);
    npmCheck(license ? /(?:^|\/)(?:LICENSE|NOTICE)(?:[._-][A-Za-z0-9._-]+)?$/.test(file.path) : file.sourcePath === `${request.skill.sourceRoot}/${file.path}`, 'NPM_INPUT');
    return file;
  }).sort((a, b) => compare(a.path, b.path));
  const directoryNames = new Set<string>(['files']); for (const file of request.files) { const parts = file.path.split('/'); for (let i = 1; i < parts.length; i++) directoryNames.add('files/' + parts.slice(0, i).join('/')); }
  npmCheck(directoryNames.size <= NPM_LIMITS.directories, 'NPM_INPUT');
  npmCheck(paths.has('skill.md') && request.license.files.every(p => request.files.some(f => f.path === p)), 'NPM_INPUT');
  npmCheck(request.files.every(f => !request.files.some(g => g.path !== f.path && g.path.startsWith(f.path + '/'))), 'NPM_INPUT');
  npmCheck(Array.isArray(request.references) && request.references.length <= 1024, 'NPM_INPUT');
  const edges = new Set<string>();
  request.references = request.references.map(raw => {
    const edge = exact<{ from: string; to: string }>(raw, ['from', 'to']); safe(() => { relativeSkillPath(edge.from); relativeSkillPath(edge.to); });
    const key = `${edge.from}\0${edge.to}`; npmCheck(!edges.has(key) && request.files.some(f => f.path === edge.from) && request.files.some(f => f.path === edge.to), 'NPM_INPUT'); edges.add(key); return edge;
  }).sort((a, b) => compare(`${a.from}\0${a.to}`, `${b.from}\0${b.to}`));
  request.license.files.sort(compare);
  const cache = validateCacheBinding(bindingValue);
  const base = request.package.split('/').at(-1)!;
  const body: Omit<NpmAcquisitionPlan, 'revision'> = { format: 'bowerloom/npm-acquisition-plan/v1beta1' as const, policy: NPM_ACQUISITION_POLICY, parser: 'tar@7.5.20/Header' as const, request, cache, metadataUrl: `https://registry.npmjs.org/${request.package}/${request.version}`, archiveUrl: `https://registry.npmjs.org/${request.package}/-/${base}-${request.version}.tgz`, limits: NPM_LIMITS };
  npmCheck(Buffer.byteLength(JSON.stringify(body)) <= NPM_LIMITS.planBytes, 'NPM_INPUT');
  return freezeSkillData({ ...body, revision: revisionOf(body) });
}
export function validateNpmPlan(value: unknown): Readonly<NpmAcquisitionPlan> {
  try {
    const input = exact<NpmAcquisitionPlan>(value, ['format', 'policy', 'parser', 'request', 'cache', 'metadataUrl', 'archiveUrl', 'limits', 'revision']);
    const planned = planRequest(input.request, input.cache);
    npmCheck(revisionOf(input) === revisionOf(planned), 'NPM_PLAN_CHANGED'); return planned;
  } catch (error) { return npmRefuse(fixedCode(error, REFUSAL_CODES.plan, 'NPM_PLAN_REFUSED')); }
}
function decode(bytes: Buffer): string {
  npmCheck(!bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])), 'NPM_ENCODING');
  const text = strictUtf8(bytes); npmCheck(text !== null, 'NPM_ENCODING'); return text;
}
function metadata(plan: NpmAcquisitionPlan, buffer: Buffer): void {
  npmCheck(buffer.length > 0 && buffer.length <= NPM_LIMITS.metadataBytes && sha256(buffer) === plan.request.metadataSha256, 'NPM_METADATA');
  let m: Record<string, unknown>;
  try { m = captureSkillData(strictJson(decode(buffer), NPM_LIMITS.metadataBytes)) as Record<string, unknown>; }
  catch (error) { if (error instanceof NpmAcquisitionError || error instanceof AdapterError || error instanceof SkillSourceError) return npmRefuse('NPM_METADATA'); throw error; }
  npmCheck(m && typeof m === 'object' && !Array.isArray(m), 'NPM_METADATA');
  const dist = m.dist as Record<string, unknown> | null; const publisher = m._npmUser as Record<string, unknown> | null;
  npmCheck(m.name === plan.request.package && m.version === plan.request.version && m.license === plan.request.declaredLicense && dist && dist.integrity === plan.request.integrity && dist.tarball === plan.archiveUrl && publisher && publisher.name === plan.request.publisher, 'NPM_METADATA');
}
function asciiField(block: Buffer, from: number, length: number): string {
  const b = block.subarray(from, from + length); const zero = b.indexOf(0); const end = zero < 0 ? b.length : zero;
  npmCheck([...b.subarray(0, end)].every(v => v >= 32 && v <= 126) && (zero < 0 || b.subarray(zero).every(v => v === 0)), 'NPM_TAR_FIELD');
  return b.subarray(0, end).toString('ascii');
}
/**
 * A numeric field at full width: octal digits with leading zeros, then one NUL or one space (length - 1 digits), or a
 * space then a NUL (length - 2 digits), the POSIX ending that node-tar and real npm tarballs write (decision 7A).
 */
function octal(block: Buffer, from: number, length: number): number {
  const text = block.subarray(from, from + length).toString('latin1');
  const match = new RegExp(`^(?:([0-7]{${length - 1}})[\\x00 ]|([0-7]{${length - 2}}) \\x00)$`).exec(text);
  npmCheck(match !== null, 'NPM_TAR_NUMBER');
  const value = Number.parseInt(match[1] ?? match[2]!, 8); npmCheck(Number.isSafeInteger(value) && value >= 0, 'NPM_TAR_NUMBER'); return value;
}
/** Strict original-field admission precedes Header; decoded normalization cannot change framing. */
function rawHeader(block: Buffer): { path: string; type: 'File' | 'Directory'; size: number; mode: number } {
  npmCheck(block.subarray(257, 265).equals(Buffer.from('ustar\0' + '00', 'latin1')) && block.subarray(500).every(v => v === 0), 'NPM_TAR_SIGNATURE');
  const flag = block[156]; npmCheck(flag === 48 || flag === 53, 'NPM_TAR_TYPE');
  const name = asciiField(block, 0, 100), prefix = asciiField(block, 345, 155), link = asciiField(block, 157, 100);
  const uname = asciiField(block, 265, 32), gname = asciiField(block, 297, 32);
  const path = prefix ? `${prefix}/${name}` : name;
  npmCheck(name.length > 0 && link === '' && path.startsWith('package/') && path.length <= 512 && /^[A-Za-z0-9._/-]+$/.test(path) && !path.includes('//') && !path.split('/').filter(Boolean).some(v => v === '.' || v === '..'), 'NPM_TAR_PATH');
  const size = octal(block, 124, 12), mode = octal(block, 100, 8), uid = octal(block, 108, 8), gid = octal(block, 116, 8), seconds = octal(block, 136, 12);
  npmCheck(octal(block, 329, 8) === 0 && octal(block, 337, 8) === 0 && mode <= 0o777 && size <= NPM_LIMITS.tarBytes, 'NPM_TAR_NUMBER');
  const type = flag === 48 ? 'File' : 'Directory';
  npmCheck(type === 'File' ? !path.endsWith('/') : path.endsWith('/') && size === 0, 'NPM_TAR_ALIAS');
  const sumText = block.subarray(148, 156).toString('latin1'); npmCheck(/^[0-7]{6}(?:\x00 | \x00)$/.test(sumText), 'NPM_TAR_CHECKSUM');
  let sum = 0; for (let i = 0; i < block.length; i++) sum += i >= 148 && i < 156 ? 32 : block[i]!;
  npmCheck(sum === Number.parseInt(sumText.slice(0, 6), 8), 'NPM_TAR_CHECKSUM');
  try {
    const header = new Header(block);
    // The third-party decoder may throw any error on hostile bytes. Each one is a decoder refusal.
    npmCheck(header.cksumValid && !header.nullBlock && header.path === path && header.type === type && header.size === size && header.mode === mode && header.uid === uid && header.gid === gid && header.linkpath === '' && header.uname === uname && header.gname === gname && header.devmaj === 0 && header.devmin === 0 && header.mtime?.getTime() === seconds * 1000, 'NPM_TAR_DECODER');
  } catch { return npmRefuse('NPM_TAR_DECODER'); }
  return { path, type, size, mode };
}
/** In-memory enumeration only. No archive path is passed to filesystem extraction. */
export function enumerateNpmTar(bytes: Buffer, checkActive: () => void): { entries: Map<string, { bytes: Buffer; mode: number }>; recordCount: number } {
  npmCheck(Buffer.isBuffer(bytes) && bytes.length <= NPM_LIMITS.tarBytes && bytes.length >= 1024 && bytes.length % 512 === 0, 'NPM_TAR_BOUND');
  const entries = new Map<string, { bytes: Buffer; mode: number }>(), names = new Map<string, string>(); let at = 0, count = 0, ended = false;
  while (at < bytes.length) {
    checkActive(); const block = bytes.subarray(at, at + 512);
    if (block.every(v => v === 0)) { npmCheck(bytes.length - at >= 1024 && bytes.subarray(at).every(v => v === 0), 'NPM_TAR_END'); ended = true; break; }
    npmCheck(++count <= NPM_LIMITS.records, 'NPM_TAR_BOUND');
    const h = rawHeader(block), normalized = h.path.endsWith('/') ? h.path.slice(0, -1) : h.path, key = normalized.toLowerCase();
    npmCheck(!names.has(key), 'NPM_TAR_COLLISION'); names.set(key, h.type);
    const body = at + 512, after = body + Math.ceil(h.size / 512) * 512;
    npmCheck(after <= bytes.length && bytes.subarray(body + h.size, after).every(v => v === 0), 'NPM_TAR_BOUND');
    if (h.type === 'File') entries.set(h.path.slice(8), { bytes: bytes.subarray(body, body + h.size), mode: h.mode });
    at = after;
  }
  npmCheck(ended, 'NPM_TAR_END');
  for (const [path, kind] of names) if (kind === 'File') npmCheck(![...names.keys()].some(other => other.startsWith(path + '/')), 'NPM_TAR_COLLISION');
  return { entries, recordCount: count };
}
async function gunzipBounded(archive: Buffer, signal: AbortSignal, check: () => void): Promise<Buffer> {
  check(); npmCheck(archive[0] === 31 && archive[1] === 139, 'NPM_COMPRESSION');
  return new Promise((resolve, reject) => {
    const stream = createGunzip({ chunkSize: 32768 }); const chunks: Buffer[] = []; let bytes = 0, done = false;
    const finish = (error?: unknown) => { if (done) return; done = true; signal.removeEventListener('abort', aborted); stream.destroy(); error === undefined ? resolve(Buffer.concat(chunks, bytes)) : reject(error); };
    // A stop keeps its own cause. The caller check reports a deadline, a release or a cache guard before a plain abort.
    const aborted = () => { try { check(); finish(new NpmAcquisitionError('NPM_ABORTED')); } catch (error) { finish(error); } };
    signal.addEventListener('abort', aborted, { once: true });
    stream.on('error', () => finish(new NpmAcquisitionError('NPM_COMPRESSION')));
    // A refusal from the caller check keeps its code. A raw fault reaches the boundary's fixed fallback.
    stream.on('data', (chunk: Buffer) => { try { check(); bytes += chunk.length; npmCheck(bytes <= NPM_LIMITS.tarBytes, 'NPM_TAR_BOUND'); chunks.push(chunk); } catch (error) { finish(error); } });
    stream.on('end', () => { try { check(); finish(); } catch (error) { finish(error); } });
    if (signal.aborted) aborted(); else { try { check(); stream.end(archive); } catch (error) { finish(error); } }
  });
}
/**
 * Recomputed from actual bounded buffers; no supplied validation result is trusted.
 * Contract: this helper has no fallback of its own. A raw error from `check` passes through unchanged, and the calling boundary gives its fixed fallback.
 */
export async function verifyNpmPayload(planValue: unknown, metadataBytes: Buffer, archiveBytes: Buffer, signal: AbortSignal, check: () => void): Promise<Readonly<ObservedNpmPayload>> {
  const plan = validateNpmPlan(planValue); check();
  npmCheck(Buffer.isBuffer(metadataBytes) && metadataBytes.length > 0 && metadataBytes.length <= NPM_LIMITS.metadataBytes, 'NPM_METADATA');
  npmCheck(Buffer.isBuffer(archiveBytes) && archiveBytes.length > 0 && archiveBytes.length <= NPM_LIMITS.compressedBytes, 'NPM_ARCHIVE_BOUND');
  // Detach before the asynchronous decompressor can observe caller mutations.
  const metadataCopy = Buffer.from(metadataBytes), archive = Buffer.from(archiveBytes);
  metadata(plan, metadataCopy);
  npmCheck('sha512-' + createHash('sha512').update(archive).digest('base64') === plan.request.integrity, 'NPM_INTEGRITY');
  const unpacked = await gunzipBounded(archive, signal, check); check();
  const { entries, recordCount } = enumerateNpmTar(unpacked, check); const wanted = new Map(plan.request.files.map(f => [f.sourcePath, f]));
  for (const path of entries.keys()) if (path.startsWith(plan.request.skill.sourceRoot + '/')) npmCheck(wanted.has(path), 'NPM_SELECTED_INVENTORY');
  const files: SkillTextFile[] = plan.request.files.map(expected => {
    const found = entries.get(expected.sourcePath); npmCheck(found && found.bytes.length === expected.bytes && found.mode === expected.mode && sha256(found.bytes) === expected.sha256, 'NPM_SELECTED_INVENTORY');
    return { path: expected.path, sourcePath: expected.sourcePath, text: decode(found.bytes), sha256: expected.sha256, mode: 420 };
  });
  const source: ObservedNpmPayload['source'] = { kind: 'npm', registry: 'https://registry.npmjs.org', package: plan.request.package, version: plan.request.version, integrity: plan.request.integrity, archiveSha256: sha256(archive), metadataSha256: sha256(metadataCopy), publisher: plan.request.publisher, declaredLicense: plan.request.declaredLicense };
  let contentRevision: string;
  try {
    // A synthetic contract evaluation is not promoted to acquisition evidence.
    contentRevision = validateSkillSource({ format: 'bowerloom/synthetic-skill-source/v1beta1', synthetic: true, source, skill: plan.request.skill, files, references: plan.request.references, license: plan.request.license }).revision;
  } catch (error) { if (error instanceof SkillSourceError) return npmRefuse('NPM_CONTENT'); throw error; }
  check(); return freezeSkillData({ source, skill: plan.request.skill, files, references: plan.request.references, license: plan.request.license, contentRevision, inventoryRevision: revisionOf(plan.request.files), recordCount });
}
function publicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number) as [number, number, number];
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 100 && b >= 64 && b <= 127 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 88 && c === 99) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}
// Plan, options and cache admission. A refusal here is certain, unless it carries NPM_CACHE_OPEN_PARTIAL or
// NPM_CACHE_RELEASE_UNCERTAIN. Those mean the operation folder or its owner lock was left behind.
function admit(planValue: unknown, options: unknown): { plan: Readonly<NpmAcquisitionPlan>; signal: AbortSignal; operation: ReturnType<typeof openNpmCacheOperation> } {
  try {
    const plan = validateNpmPlan(planValue);
    npmCheck(options && typeof options === 'object' && !types.isProxy(options) && [Object.prototype, null].includes(Object.getPrototypeOf(options)), 'NPM_INPUT');
    const ds = Object.getOwnPropertyDescriptors(options) as { approvalRevision?: PropertyDescriptor; signal?: PropertyDescriptor };
    npmCheck(Reflect.ownKeys(ds).length === 2 && ds.approvalRevision && 'value' in ds.approvalRevision && ds.signal && 'value' in ds.signal && ds.signal.value instanceof AbortSignal, 'NPM_INPUT');
    const signal = ds.signal.value as AbortSignal; npmCheck(ds.approvalRevision.value === plan.revision, 'NPM_APPROVAL');
    return { plan, signal, operation: openNpmCacheOperation(plan, plan.revision, signal) };
  } catch (error) { return npmRefuse(fixedCode(error, REFUSAL_CODES.acquire, 'NPM_ACQUISITION_FAILED'), secondaryCodes(error)); }
}
/** Trusted host entry point: exact consent permits these two GETs and this private cache only. */
export async function acquireNpmSkill(planValue: unknown, options: { approvalRevision: string; signal: AbortSignal }): Promise<Readonly<AcquiredSkillCacheReceipt>> {
  const { plan, signal, operation } = admit(planValue, options);
  const requests = new Set<ClientRequest>(); const responses = new Set<IncomingMessage>(); const pendingClosers = new Set<(code: string) => void>();
  const controller = new AbortController(); const agent = new https.Agent({ keepAlive: false, maxSockets: 1, maxCachedSessions: 0, proxyEnv: {} } as https.AgentOptions);
  let stopped = false, timedOut = false, requestCount = 0;
  const deadline = performance.now() + NPM_LIMITS.durationMs;
  let rejectStop!: (reason: Error) => void;
  const stoppedPromise = new Promise<never>((_, reject) => { rejectStop = reject; }); void stoppedPromise.catch(() => {});
  const stop = (timeout = false) => { if (stopped) return; stopped = true; timedOut = timeout; controller.abort(); for (const finish of [...pendingClosers]) finish(timeout ? 'NPM_TIMEOUT' : 'NPM_ABORTED'); for (const req of requests) req.destroy(); for (const response of responses) response.destroy(); agent.destroy(); rejectStop(new NpmAcquisitionError(timeout ? 'NPM_TIMEOUT' : 'NPM_ABORTED')); };
  const onAbort = () => stop(); signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => stop(true), NPM_LIMITS.durationMs); timer.unref();
  const check = () => { if (signal.aborted || stopped) npmRefuse(timedOut ? 'NPM_TIMEOUT' : 'NPM_ABORTED'); if (performance.now() >= deadline) { stop(true); npmRefuse('NPM_TIMEOUT'); } operation.check(); };
  async function bounded<T>(work: () => Promise<T>): Promise<T> { check(); const pending = Promise.resolve().then(() => { check(); return work(); }); void pending.catch(() => {}); const result = await Promise.race([pending, stoppedPromise]); check(); return result; }
  function get(url: string, address: string, maximum: number): Promise<Buffer> {
    check(); npmCheck(++requestCount <= NPM_LIMITS.requests, 'NPM_REQUEST_BOUND');
    return new Promise((resolve, reject) => {
      let done = false, response: IncomingMessage | undefined, request: ClientRequest | undefined; let bytes = 0; const chunks: Buffer[] = [];
      const requestDeadline = performance.now() + NPM_LIMITS.requestMs;
      const timeout = setTimeout(() => finish('NPM_TIMEOUT'), NPM_LIMITS.requestMs); timeout.unref();
      // A refusal from check or guard keeps its own code. A transport event gets a fixed transport code.
      const settle = (failure?: unknown) => { if (done) return; done = true; clearTimeout(timeout); pendingClosers.delete(finish); if (request) { requests.delete(request); request.destroy(); } if (response) { responses.delete(response); response.destroy(); } failure === undefined ? resolve(Buffer.concat(chunks, bytes)) : reject(failure); };
      const finish = (code?: string) => settle(code === undefined ? undefined : new NpmAcquisitionError(code));
      pendingClosers.add(finish);
      try {
        check(); request = https.request(url, { method: 'GET', agent, rejectUnauthorized: true, minVersion: 'TLSv1.2', maxHeaderSize: NPM_LIMITS.headerBytes, headers: { Accept: url === plan.metadataUrl ? 'application/json' : 'application/octet-stream', 'Accept-Encoding': 'identity', 'User-Agent': 'bowerloom-skill-acquisition/1' }, lookup: (_host, lookupOptions, callback) => { try { check(); if (lookupOptions.all) callback(null, [{ address, family: 4 }]); else callback(null, address, 4); } catch (error) { settle(error); callback(new Error('NPM_ABORTED'), '', 4); } } }, incoming => {
          if (done || stopped || signal.aborted) { incoming.destroy(); return; }
          response = incoming; responses.add(incoming);
          const guard = () => { check(); npmCheck(performance.now() < requestDeadline, 'NPM_TIMEOUT'); };
          try {
            // A repeated guarded header, more than 128 header pairs, or a transfer-encoding other than chunked refuses. Repeats of headers nothing reads, such as set-cookie, are ignored (D11).
            guard(); const headers = guardedResponseHeaders(incoming.rawHeaders); npmCheck(headers !== null, 'NPM_RESPONSE');
            const length = headers.get('content-length'); npmCheck(incoming.statusCode === 200 && !headers.has('location') && (!headers.has('content-encoding') || headers.get('content-encoding') === 'identity') && (length === undefined || /^(0|[1-9]\d*)$/.test(length)), 'NPM_RESPONSE');
            // A declared length over the limit is a bound refusal, the same code as an oversized body.
            npmCheck(length === undefined || Number(length) <= maximum, 'NPM_RESPONSE_BOUND');
            incoming.on('data', (chunk: Buffer) => { try { guard(); npmCheck(Buffer.isBuffer(chunk) && (bytes += chunk.length) <= maximum, 'NPM_RESPONSE_BOUND'); chunks.push(chunk); } catch (error) { settle(error); } });
            incoming.on('end', () => { try { guard(); npmCheck(incoming.complete && (length === undefined || bytes === Number(length)), 'NPM_RESPONSE'); finish(); } catch (error) { settle(error); } });
            incoming.on('error', () => finish('NPM_RESPONSE')); incoming.on('aborted', () => finish('NPM_RESPONSE')); incoming.on('close', () => { if (!done) finish('NPM_RESPONSE'); });
          } catch (error) { settle(error); }
        });
        requests.add(request); request.on('error', () => finish('NPM_NETWORK')); request.on('close', () => { if (!done) finish('NPM_NETWORK'); }); check(); request.end();
      } catch (error) { settle(error); }
    });
  }
  let receipt: Readonly<AcquiredSkillCacheReceipt> | undefined, failure: string | undefined, hold: string | null = null, released = false;
  try {
    check(); operation.receiving();
    // The resolver is a transport boundary. Any resolver failure, even an error with a forged domain class, is NPM_DNS.
    const addresses = await bounded(async () => { try { return await dns.lookup('registry.npmjs.org', { all: true, verbatim: true }); } catch { return npmRefuse('NPM_DNS'); } });
    npmCheck(addresses.length > 0 && addresses.length <= 16 && addresses.every(a => a.family === 4 && isIP(a.address) === 4), 'NPM_DNS');
    // A private IPv4 answer can be a rebinding attempt, so it has its own code.
    npmCheck(addresses.every(a => publicIPv4(a.address)), 'NPM_NONPUBLIC_ADDRESS');
    const address = addresses[0]!.address;
    const metadataBytes = await bounded(() => get(plan.metadataUrl, address, NPM_LIMITS.metadataBytes)); metadata(plan, metadataBytes);
    const archive = await bounded(() => get(plan.archiveUrl, address, NPM_LIMITS.compressedBytes));
    await bounded(() => operation.stage(metadataBytes, archive, controller.signal)); check();
    receipt = await bounded(() => operation.complete(controller.signal));
  } catch (error) {
    // Only a listed fixed code survives. After the completion marker write begins, any stop, timeout or fault is uncertain.
    failure = operation.completionBegun() ? 'NPM_CACHE_COMPLETE_UNCERTAIN' : fixedCode(error, REFUSAL_CODES.acquire, 'NPM_ACQUISITION_FAILED');
    hold = operation.hold();
  } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); stop(); released = operation.release(); }
  if (failure !== undefined) return npmRefuse(failure, [...(hold === null ? [] : [hold]), ...(released ? [] : ['NPM_CACHE_RELEASE_UNCERTAIN'])]);
  npmCheck(released && receipt, 'NPM_CACHE_RELEASE_UNCERTAIN'); return receipt;
}
