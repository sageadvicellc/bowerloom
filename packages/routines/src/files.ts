import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';
import { types } from 'node:util';
import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, stringify } from 'yaml';
import { canonicalJson, digest } from '../../contracts/src/index.js';
import { planRoutine, ROUTINE_LIMITS, validateRoutine } from './index.js';
import type { RoutineDefinition, RoutineDependency, RoutineDependencyKind, RoutinePlan } from './index.js';

const ROUTINE_PATH = 'routines/labs-to-blog.yaml';
const MAX_NODES = 8000, MAX_DEPTH = 24, MAX_CONTAINER = 128;
const codes = ['INPUT', 'BOUND', 'YAML', 'DEFINITION', 'PATH', 'UNAVAILABLE', 'UNSAFE', 'CHANGED', 'DEPENDENCY'] as const;
type Code = `ROUTINE_FILES_${typeof codes[number]}`;
const trustedErrors = new WeakMap<object, Code>();
export class RoutineFilesError extends Error {
  constructor(readonly code: Code) { super(code); this.name = 'RoutineFilesError'; }
}
function fail(suffix: typeof codes[number]): never {
  const code: Code = `ROUTINE_FILES_${suffix}`;
  const error = new RoutineFilesError(code); trustedErrors.set(error, code); throw error;
}
function sanitized(error: unknown, fallback: typeof codes[number]): never {
  const code = typeof error === 'object' && error !== null ? trustedErrors.get(error) : undefined;
  if (code) fail(code.slice('ROUTINE_FILES_'.length) as typeof codes[number]);
  fail(fallback);
}
function definition(value: unknown): RoutineDefinition {
  try { return validateRoutine(value); } catch { return fail('DEFINITION'); }
}
function sourceText(source: unknown): asserts source is string {
  if (typeof source !== 'string') fail('INPUT');
  if (source.length > ROUTINE_LIMITS.definitionBytes || Buffer.byteLength(source) > ROUTINE_LIMITS.definitionBytes) fail('BOUND');
  if (Buffer.from(source).toString('utf8') !== source) fail('INPUT');
}
/** Internal YAML encoding only; the existing routine schema remains authoritative. */
export function parseRoutineYaml(source: string): RoutineDefinition {
  try {
    sourceText(source);
    const doc = parseDocument(source, { strict: true, uniqueKeys: true, version: '1.2', schema: 'core', merge: false, resolveKnownTags: false, prettyErrors: false });
    if (doc.errors.length || doc.warnings.length || doc.directives.yaml.version !== '1.2'
      || Object.keys(doc.directives.tags).some(tag => tag !== '!!') || doc.directives.tags['!!'] !== 'tag:yaml.org,2002:') fail('YAML');
    const pending: { node: unknown; depth: number }[] = [{ node: doc.contents, depth: 0 }];
    let nodes = 0;
    while (pending.length) {
      const { node, depth } = pending.pop()!;
      if (++nodes > MAX_NODES || depth > MAX_DEPTH) fail('BOUND');
      if (isAlias(node) || (isNode(node) && (node.tag || ('anchor' in node && node.anchor)))) fail('YAML');
      if (isMap(node)) {
        if (node.items.length > MAX_CONTAINER) fail('BOUND');
        for (const pair of node.items) {
          if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || pair.key.value === '<<') fail('YAML');
          pending.push({ node: pair.key, depth: depth + 1 }, { node: pair.value, depth: depth + 1 });
        }
      } else if (isSeq(node)) {
        if (node.items.length > MAX_CONTAINER) fail('BOUND');
        for (const item of node.items) pending.push({ node: item, depth: depth + 1 });
      }
    }
    return definition(doc.toJS({ maxAliasCount: 0 }));
  } catch (error) { return sanitized(error, 'YAML'); }
}
export function exportRoutineYaml(value: unknown): string {
  try {
    const routine = definition(value);
    const text = stringify(routine, { version: '1.2', schema: 'core', aliasDuplicateObjects: false, lineWidth: 0 });
    if (!text.endsWith('\n') || canonicalJson(parseRoutineYaml(text)) !== canonicalJson(routine)) fail('YAML');
    return text;
  } catch (error) { return sanitized(error, 'YAML'); }
}
function inertRecord(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || types.isProxy(value)) fail('INPUT');
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail('INPUT');
  const own = Reflect.ownKeys(value), descriptors = Object.getOwnPropertyDescriptors(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) fail('INPUT');
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const d = descriptors[key]; if (!d || !('value' in d) || !d.enumerable) fail('INPUT');
    result[key] = d.value;
  }
  return result;
}
function captureInputs(value: unknown): { experiment: { id: string; digest: string } } {
  const v = inertRecord(value, ['experiment']), e = inertRecord(v.experiment, ['id', 'digest']);
  if (typeof e.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(e.id)
    || /^(?:private|secrets?|credentials?|tokens?|passwords?|bindings?|installations?|receipts?|runtime|state|runs?|approvals?|auth)(?:[.-]|$)/i.test(e.id)
    || typeof e.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(e.digest)) fail('INPUT');
  return { experiment: { id: e.id, digest: e.digest } };
}
function rootPath(root: unknown): { root: string; uid: bigint } {
  if (process.platform === 'win32' || typeof process.geteuid !== 'function'
    || typeof constants.O_NOFOLLOW !== 'number' || typeof constants.O_NONBLOCK !== 'number') fail('INPUT');
  if (typeof root !== 'string' || root.length > 2048 || Buffer.byteLength(root) > 2048) fail('PATH');
  if (!isAbsolute(root) || resolve(root) !== root || basename(root) !== '.bowerloom'
    || root !== root.normalize('NFC') || Buffer.from(root).toString('utf8') !== root || /[\p{Cc}\p{Cf}]/u.test(root)
    || root.split(sep).filter(Boolean).length > 64) fail('PATH');
  return { root, uid: BigInt(process.geteuid()) };
}
function targetPath(root: string, ref: string): string {
  // References come only from validateRoutine. This check also binds the fixed routine path.
  if (!ref || isAbsolute(ref) || /[\\%]/.test(ref) || ref.split('/').some(part => !part || part === '.' || part === '..')) fail('PATH');
  const target = resolve(root, ref);
  if (!target.startsWith(root + sep)) fail('PATH');
  return target;
}
function directoryPin(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.birthtimeNs, stat.uid, stat.mode].map(String).join(':');
}
function filePin(stat: BigIntStats): string {
  return [directoryPin(stat), stat.size, stat.mtimeNs, stat.ctimeNs, stat.nlink].map(String).join(':');
}
function directories(path: string): string[] {
  const result: string[] = [];
  for (let at = path;; at = dirname(at)) { result.push(at); if (dirname(at) === at) break; }
  return result.reverse();
}
function safeDirectory(stat: BigIntStats, at: string, root: string, uid: bigint): void {
  const below = at === root || at.startsWith(root + sep), writable = (stat.mode & 0o022n) !== 0n;
  const sharedSticky = !below && stat.uid === 0n && (stat.mode & 0o1000n) !== 0n;
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o6000n) !== 0n
    || (below ? stat.uid !== uid : stat.uid !== 0n && stat.uid !== uid) || (writable && !sharedSticky)) fail('UNSAFE');
}
function safeFile(stat: BigIntStats, uid: bigint, limit: number): void {
  if (!stat.isFile() || stat.nlink !== 1n || stat.uid !== uid || (stat.mode & 0o6022n) !== 0n) fail('UNSAFE');
  if (stat.size < 0n || stat.size > BigInt(limit)) fail('BOUND');
}
function decode(bytes: Buffer): string {
  try {
    // Keep a BOM in the string: planner UTF-8 re-encoding must hash the exact bytes read.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!Buffer.from(text, 'utf8').equals(bytes)) fail('INPUT');
    return text;
  } catch (error) { return sanitized(error, 'INPUT'); }
}
interface ReadResult { bytes: Buffer; text: string; pin: string; digest: string }
interface Selection { kind: 'routine' | RoutineDependencyKind; ref: string }
export interface RoutineFilesResult {
  format: 'bowerloom/routine-files-plan/v1beta1'; status: 'planning-only'; plan: RoutinePlan;
  files: Array<Selection & { bytes: number; digest: string }>;
  observation: 'bounded-local-file-reads'; simultaneousSnapshotVerified: false; installedBindingVerified: false;
  executionAuthorized: false; effectsAuthorized: false; revision: string;
}
/** Read-only local evidence. No installed binding, atomic snapshot, or execution authority. */
export async function loadRoutineFiles(portableRoot: string, inputs: unknown): Promise<RoutineFilesResult> {
  try {
    const { root, uid } = rootPath(portableRoot), capturedInputs = captureInputs(inputs);
    const dirPins = new Map<string, string>();
    async function inspectDirectories(parent: string): Promise<void> {
      for (const at of directories(parent)) {
        const stat = await lstat(at, { bigint: true }); safeDirectory(stat, at, root, uid);
        if (await realpath(at) !== at) fail('UNSAFE');
        const pin = directoryPin(stat), old = dirPins.get(at);
        if (old !== undefined && old !== pin) fail('CHANGED');
        if (old === undefined) dirPins.set(at, pin);
      }
    }
    async function read(ref: string, limit: number, expected?: ReadResult): Promise<ReadResult> {
      const target = targetPath(root, ref), parent = dirname(target);
      await inspectDirectories(parent);
      const pathBefore = await lstat(target, { bigint: true }); safeFile(pathBefore, uid, limit);
      if (await realpath(target) !== target) fail('UNSAFE');
      const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const before = await handle.stat({ bigint: true }); safeFile(before, uid, limit);
        const pin = filePin(before);
        if (pin !== filePin(pathBefore) || (expected && pin !== expected.pin)) fail('CHANGED');
        const buffer = Buffer.alloc(limit + 1); let count = 0;
        while (count < buffer.length) {
          const { bytesRead } = await handle.read(buffer, count, buffer.length - count, null);
          if (!bytesRead) break; count += bytesRead;
        }
        if (count > limit) fail('BOUND');
        const after = await handle.stat({ bigint: true }), current = await lstat(target, { bigint: true });
        if (pin !== filePin(after) || pin !== filePin(current) || BigInt(count) !== before.size || await realpath(target) !== target) fail('CHANGED');
        await inspectDirectories(parent);
        const bytes = buffer.subarray(0, count), text = decode(bytes), hash = digest(bytes);
        if (expected && (hash !== expected.digest || !bytes.equals(expected.bytes))) fail('CHANGED');
        return { bytes, text, pin, digest: hash };
      } finally { await handle.close(); }
    }
    const first = new Map<string, ReadResult>();
    const initial = await read(ROUTINE_PATH, ROUTINE_LIMITS.definitionBytes); first.set(ROUTINE_PATH, initial);
    const routine = parseRoutineYaml(initial.text);
    const selected: Selection[] = [
      { kind: 'routine', ref: ROUTINE_PATH },
      { kind: 'recipe', ref: routine.implementation.ref }, { kind: 'team', ref: routine.team.ref },
      ...routine.skills.map(p => ({ kind: 'skill' as const, ref: p.ref })),
      ...routine.connections.map(p => ({ kind: 'connection' as const, ref: p.ref })),
    ];
    if (selected.length > 27 || new Set(selected.map(p => p.ref.toLowerCase())).size !== selected.length) fail('PATH');
    let total = 0;
    for (const entry of selected.slice(1)) {
      const content = await read(entry.ref, Math.min(ROUTINE_LIMITS.dependencyBytes, ROUTINE_LIMITS.totalDependencyBytes - total));
      total += content.bytes.length; first.set(entry.ref, content);
    }
    // Baselines above are never recaptured. The closing pass reads exactly the first definition's list.
    total = 0;
    for (const entry of selected) {
      const limit = entry.kind === 'routine' ? ROUTINE_LIMITS.definitionBytes
        : Math.min(ROUTINE_LIMITS.dependencyBytes, ROUTINE_LIMITS.totalDependencyBytes - total);
      const content = await read(entry.ref, limit, first.get(entry.ref)!);
      if (entry.kind !== 'routine') total += content.bytes.length;
    }
    for (const at of dirPins.keys()) await inspectDirectories(at);
    const dependencies: RoutineDependency[] = selected.slice(1).map(entry => ({ kind: entry.kind as RoutineDependencyKind, ref: entry.ref, content: first.get(entry.ref)!.text }));
    let plan: RoutinePlan;
    try { plan = planRoutine({ routine, dependencies, inputs: capturedInputs }); } catch { return fail('DEPENDENCY'); }
    const files = selected.map(entry => ({ ...entry, bytes: first.get(entry.ref)!.bytes.length, digest: first.get(entry.ref)!.digest }))
      .sort((a, b) => a.kind + ':' + a.ref < b.kind + ':' + b.ref ? -1 : 1);
    const result = { format: 'bowerloom/routine-files-plan/v1beta1' as const, status: 'planning-only' as const, plan, files,
      observation: 'bounded-local-file-reads' as const, simultaneousSnapshotVerified: false as const, installedBindingVerified: false as const,
      executionAuthorized: false as const, effectsAuthorized: false as const };
    return { ...result, revision: digest(canonicalJson(result)) };
  } catch (error) { return sanitized(error, 'UNAVAILABLE'); }
}
