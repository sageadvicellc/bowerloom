import { types } from 'node:util';
import { canonicalJson, digest } from '../../contracts/src/index.js';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { parseCrew } from '../../crew/src/index.js';
import { specCopy } from '../../recipes/src/validation.js';
import { validateMcpDeclaration } from '../../mcp-connections/src/model.js';

export const ROUTINE_FORMAT = 'bowerloom/routine/v1beta1' as const;
export const ROUTINE_LIMITS = Object.freeze({ definitionBytes: 65536, dependencyBytes: 262144, totalDependencyBytes: 1048576, skills: 16, connections: 8 });
export type RoutineDependencyKind = 'recipe' | 'team' | 'skill' | 'connection';
export interface RoutineReference { ref: string; digest: string }
export interface RoutineDefinition {
  format: typeof ROUTINE_FORMAT; id: 'labs-to-blog'; version: string;
  inputs: { experiment: { type: 'resource-reference' } };
  outputs: { draft: { type: 'artifact'; mediaType: 'text/markdown' } };
  implementation: RoutineReference & { kind: 'registered-recipe'; id: 'labs-to-blog-v1' };
  team: RoutineReference; skills: RoutineReference[]; connections: RoutineReference[];
  review: { beforeEffects: 'exact-action-approval'; completion: 'founder-review' };
  limits: { maxActiveWorkers: number; maxAttempts: number; deadlineSeconds: number; paidFallback: false };
  invocation: 'manual';
}
export interface RoutineDependency { kind: RoutineDependencyKind; ref: string; content: string }
export interface RoutinePlanInput { routine: unknown; dependencies: unknown; inputs: unknown }
export interface RoutinePlan {
  format: 'bowerloom/routine-definition-plan/v1beta1'; status: 'planning-only';
  inputEvidence: 'caller-supplied-content'; routine: RoutineDefinition; routineRevision: string;
  inputs: { experiment: { id: string; digest: string } };
  dependencyPins: { kind: RoutineDependencyKind; ref: string; digest: string; bytes: number }[];
  executionAuthorized: false; effectsAuthorized: false; authenticationVerified: false;
  runtimePortabilityVerified: false; transitiveClosureVerified: false; grants: []; revision: string;
}
export class RoutineError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'RoutineError'; }
}
const codes = new Set(['ROUTINE_INPUT', 'ROUTINE_BOUND', 'ROUTINE_SCHEMA', 'ROUTINE_VERSION', 'ROUTINE_REFERENCE', 'ROUTINE_DUPLICATE', 'ROUTINE_UNSUPPORTED', 'ROUTINE_JSON', 'ROUTINE_DEPENDENCY_SET', 'ROUTINE_DEPENDENCY_DRIFT', 'ROUTINE_DEPENDENCY_CONTENT']);
function fail(code: string): never { throw new RoutineError(code); }
function boundary<T>(work: () => T): T {
  try { return work(); } catch (error) {
    // Never expose parser text, foreign exception messages, or caller-forged diagnostic strings.
    if (error instanceof RoutineError && codes.has(error.code)) throw new RoutineError(error.code);
    return fail('ROUTINE_INPUT');
  }
}
const forbidden = new Set(['__proto__', 'constructor', 'prototype', 'toJSON']);
function copy(value: unknown, byteLimit: number): unknown {
  let count = 0, size = 0; const ancestors = new Set<object>();
  function walk(v: unknown, depth: number): unknown {
    if (++count > 8000 || depth > 24) fail('ROUTINE_BOUND');
    if (v === null || typeof v === 'boolean') { size += 5; return v; }
    if (typeof v === 'number') { if (!Number.isSafeInteger(v)) fail('ROUTINE_INPUT'); size += 24; return v; }
    if (typeof v === 'string') { size += Buffer.byteLength(v) + 2; if (size > byteLimit || Buffer.from(v).toString('utf8') !== v || /[\p{Cc}\p{Cf}]/u.test(v.replace(/[\n\r\t]/g, ''))) fail('ROUTINE_BOUND'); return v; }
    if (!v || typeof v !== 'object' || types.isProxy(v) || ancestors.has(v)) fail('ROUTINE_INPUT');
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('ROUTINE_INPUT');
    const keys = Reflect.ownKeys(v), descriptors = Object.getOwnPropertyDescriptors(v);
    if (keys.length > 128) fail('ROUTINE_BOUND');
    if (keys.some(k => typeof k !== 'string' || forbidden.has(k) || !('value' in descriptors[k]!) || (k !== 'length' && !descriptors[k]!.enumerable))) fail('ROUTINE_INPUT');
    ancestors.add(v); let result: unknown;
    if (array) {
      const length = descriptors.length!.value as number;
      if (keys.length !== length + 1 || keys.some(k => k !== 'length' && !/^(0|[1-9][0-9]*)$/.test(k as string))) fail('ROUTINE_INPUT');
      result = Array.from({ length }, (_, i) => { if (!descriptors[String(i)]) fail('ROUTINE_INPUT'); return walk(descriptors[String(i)]!.value, depth + 1); });
    } else {
      const out: Record<string, unknown> = Object.create(null);
      for (const key of keys as string[]) { size += Buffer.byteLength(key) + 4; if (key.length > 128 || size > byteLimit) fail('ROUTINE_BOUND'); out[key] = walk(descriptors[key]!.value, depth + 1); }
      result = out;
    }
    ancestors.delete(v); if (size > byteLimit) fail('ROUTINE_BOUND'); return result;
  }
  const result = walk(value, 0); if (Buffer.byteLength(canonicalJson(result)) > byteLimit) fail('ROUTINE_BOUND'); return result;
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('ROUTINE_SCHEMA');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail('ROUTINE_SCHEMA'); return v;
}
function exactValue(value: unknown, expected: unknown): void { if (canonicalJson(value) !== canonicalJson(expected)) fail('ROUTINE_UNSUPPORTED'); }
function hash(value: unknown): string { if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) fail('ROUTINE_REFERENCE'); return value; }
const privateSegment = /^(?:private|secrets?|credentials?|tokens?|passwords?|bindings?|installations?|receipts?|runtime|state|runs?|approvals?|auth)(?:[.-]|$)/i;
function portablePath(value: unknown, kind: RoutineDependencyKind): string {
  if (typeof value !== 'string' || value.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9./-]*$/.test(value) || value.split('/').length > 6
    || value.split('/').some(p => !p || p === '.' || p === '..' || p.includes('..') || p.startsWith('.') || privateSegment.test(p))) fail('ROUTINE_REFERENCE');
  const patterns = { recipe: /^recipes\/labs-to-blog\/recipe\.json$/, team: /^teams\/[a-z][a-z0-9-]{0,62}\/team\.yaml$/, skill: /^skills\/[A-Za-z0-9/-]+\/(?:SKILL|[a-z][a-z0-9-]*)\.md$/, connection: /^connections\/[a-z][a-z0-9-]{0,62}\.json$/ };
  if (!patterns[kind].test(value)) fail('ROUTINE_REFERENCE'); return value;
}
function reference(value: unknown, kind: RoutineDependencyKind): RoutineReference {
  const v = record(value, ['ref', 'digest']); return { ref: portablePath(v.ref, kind), digest: hash(v.digest) };
}
function references(value: unknown, kind: RoutineDependencyKind, max: number): RoutineReference[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) fail('ROUTINE_BOUND');
  const refs = value.map(v => reference(v, kind)).sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
  if (new Set(refs.map(v => v.ref.toLowerCase())).size !== refs.length) fail('ROUTINE_DUPLICATE'); return refs;
}
function integer(v: unknown, max: number): number { if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > max) fail('ROUTINE_BOUND'); return v as number; }
function definition(value: unknown): RoutineDefinition {
  const v = record(copy(value, ROUTINE_LIMITS.definitionBytes), ['format', 'id', 'version', 'inputs', 'outputs', 'implementation', 'team', 'skills', 'connections', 'review', 'limits', 'invocation']);
  if (v.format !== ROUTINE_FORMAT || typeof v.version !== 'string' || !/^(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$/.test(v.version)) fail('ROUTINE_VERSION');
  if (v.id !== 'labs-to-blog' || v.invocation !== 'manual') fail('ROUTINE_UNSUPPORTED');
  exactValue(v.inputs, { experiment: { type: 'resource-reference' } }); exactValue(v.outputs, { draft: { type: 'artifact', mediaType: 'text/markdown' } });
  exactValue(v.review, { beforeEffects: 'exact-action-approval', completion: 'founder-review' });
  const implementation = record(v.implementation, ['kind', 'id', 'ref', 'digest']);
  if (implementation.kind !== 'registered-recipe' || implementation.id !== 'labs-to-blog-v1') fail('ROUTINE_UNSUPPORTED');
  const limits = record(v.limits, ['maxActiveWorkers', 'maxAttempts', 'deadlineSeconds', 'paidFallback']);
  if (limits.paidFallback !== false) fail('ROUTINE_UNSUPPORTED');
  return { format: ROUTINE_FORMAT, id: 'labs-to-blog', version: v.version,
    inputs: { experiment: { type: 'resource-reference' } }, outputs: { draft: { type: 'artifact', mediaType: 'text/markdown' } },
    implementation: { kind: 'registered-recipe', id: 'labs-to-blog-v1', ref: portablePath(implementation.ref, 'recipe'), digest: hash(implementation.digest) },
    team: reference(v.team, 'team'), skills: references(v.skills, 'skill', ROUTINE_LIMITS.skills), connections: references(v.connections, 'connection', ROUTINE_LIMITS.connections),
    review: { beforeEffects: 'exact-action-approval', completion: 'founder-review' },
    limits: { maxActiveWorkers: integer(limits.maxActiveWorkers, 2), maxAttempts: integer(limits.maxAttempts, 2), deadlineSeconds: integer(limits.deadlineSeconds, 1800), paidFallback: false }, invocation: 'manual' };
}
export function validateRoutine(value: unknown): RoutineDefinition { return boundary(() => definition(value)); }
export function parseRoutine(text: string): RoutineDefinition {
  return boundary(() => { let v: unknown; try { v = strictJson(text, ROUTINE_LIMITS.definitionBytes); } catch { return fail('ROUTINE_JSON'); } return definition(v); });
}
export function exportRoutine(value: unknown): string { return boundary(() => canonicalJson(definition(value)) + '\n'); }
export function routineDependencyDigest(content: string): string {
  return boundary(() => { if (typeof content !== 'string' || !content.length || Buffer.byteLength(content) > ROUTINE_LIMITS.dependencyBytes || Buffer.from(content).toString('utf8') !== content) fail('ROUTINE_BOUND'); return digest(content); });
}
function checkContent(kind: RoutineDependencyKind, content: string): void {
  // No installed binding fields, endpoints, credentials or raw record payloads enter the routine plan.
  // These refusals are deliberately narrow checks, not a general secret detector for arbitrary prose.
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})|\bBearer\s+[A-Za-z0-9._~-]{8,}|(?:\/Users\/|\/home\/|\/var\/folders\/|[A-Za-z]:\\Users\\)|\.(?:codex|claude)\//i.test(content)) fail('ROUTINE_DEPENDENCY_CONTENT');
  if (/(?:^|[\s"'=])(?:~?\/|[A-Za-z]:[\\/])[^\s"]+|\b(?:password|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]/m.test(content)) fail('ROUTINE_DEPENDENCY_CONTENT');
  try {
    if (kind === 'team') parseCrew(content);
    else if (kind === 'recipe') {
      // The existing recipe validator accepts ordinary objects; normalize only after strict text parsing.
      specCopy(JSON.parse(canonicalJson(strictJson(content, ROUTINE_LIMITS.dependencyBytes))));
    }
    else if (kind === 'connection') validateMcpDeclaration(strictJson(content, ROUTINE_LIMITS.dependencyBytes));
    else if (!content.trim() || content.includes('\0')) fail('ROUTINE_DEPENDENCY_CONTENT');
  } catch { fail('ROUTINE_DEPENDENCY_CONTENT'); }
}
export function planRoutine(value: RoutinePlanInput): RoutinePlan {
  return boundary(() => {
    const v = record(copy(value, ROUTINE_LIMITS.totalDependencyBytes + ROUTINE_LIMITS.definitionBytes), ['routine', 'dependencies', 'inputs']);
    const routine = definition(v.routine), input = record(v.inputs, ['experiment']), experiment = record(input.experiment, ['id', 'digest']);
    if (typeof experiment.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(experiment.id) || privateSegment.test(experiment.id)) fail('ROUTINE_SCHEMA');
    const inputs = { experiment: { id: experiment.id, digest: hash(experiment.digest) } };
    if (!Array.isArray(v.dependencies) || v.dependencies.length > 26) fail('ROUTINE_BOUND');
    const expected: (RoutineReference & { kind: RoutineDependencyKind })[] = [
      { kind: 'recipe', ref: routine.implementation.ref, digest: routine.implementation.digest }, { kind: 'team', ...routine.team },
      ...routine.skills.map(r => ({ kind: 'skill' as const, ...r })), ...routine.connections.map(r => ({ kind: 'connection' as const, ...r })) ];
    const selected = new Map(expected.map(r => [r.kind + ':' + r.ref, r])); const seen = new Set<string>(); let total = 0;
    const dependencyPins = v.dependencies.map(raw => {
      const d = record(raw, ['kind', 'ref', 'content']);
      if (!['recipe', 'team', 'skill', 'connection'].includes(d.kind as string)) fail('ROUTINE_UNSUPPORTED');
      const kind = d.kind as RoutineDependencyKind, ref = portablePath(d.ref, kind), key = kind + ':' + ref;
      if (seen.has(key.toLowerCase())) fail('ROUTINE_DUPLICATE'); seen.add(key.toLowerCase());
      const wanted = selected.get(key); if (!wanted) fail('ROUTINE_DEPENDENCY_SET');
      if (typeof d.content !== 'string') fail('ROUTINE_DEPENDENCY_CONTENT');
      const revision = routineDependencyDigest(d.content), bytes = Buffer.byteLength(d.content); total += bytes;
      if (total > ROUTINE_LIMITS.totalDependencyBytes) fail('ROUTINE_BOUND');
      if (revision !== wanted.digest) fail('ROUTINE_DEPENDENCY_DRIFT');
      checkContent(kind, d.content); return { kind, ref, digest: revision, bytes };
    }).sort((a, b) => (a.kind + ':' + a.ref) < (b.kind + ':' + b.ref) ? -1 : 1);
    if (dependencyPins.length !== expected.length) fail('ROUTINE_DEPENDENCY_SET');
    const body = { format: 'bowerloom/routine-definition-plan/v1beta1' as const, status: 'planning-only' as const, inputEvidence: 'caller-supplied-content' as const,
      routine, routineRevision: digest(canonicalJson(routine)), inputs, dependencyPins, executionAuthorized: false as const, effectsAuthorized: false as const,
      authenticationVerified: false as const, runtimePortabilityVerified: false as const, transitiveClosureVerified: false as const, grants: [] as [] };
    return { ...body, revision: digest(canonicalJson(body)) };
  });
}
