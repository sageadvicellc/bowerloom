import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { posix } from 'node:path';
import { parseDocument } from 'yaml';
import { canonicalJson } from '../../contracts/src/index.js';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { LIMITS } from '../../portable/src/index.js';
import type { SkillSourceInput, SkillSourceValidation } from './types.js';

export class SkillSourceError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'SkillSourceError'; }
}
export function refuse(code: string): never { throw new SkillSourceError(code); }
export function requireSkill(ok: unknown, code: string): asserts ok { if (!ok) refuse(code); }
export const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
export const revisionOf = (value: unknown): string => digest(canonicalJson(captureSkillData(value)));
const HASH = /^[a-f0-9]{64}$/;
export function hashValue(value: unknown): asserts value is string { requireSkill(typeof value === 'string' && HASH.test(value), 'SKILL_HASH'); }

/** Inspect neither traps nor getters; detach before schema traversal or canonicalization. */
export function captureSkillData(value: unknown): unknown {
  let nodes = 0, bytes = 0;
  const seen = new Set<object>();
  const copy = (v: unknown, depth: number): unknown => {
    requireSkill(++nodes <= 40000 && depth <= 24, 'SKILL_INPUT_BOUND');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      requireSkill(v.length <= 4 * 1024 * 1024 && Buffer.from(v).toString('utf8') === v, 'SKILL_ENCODING');
      bytes += Buffer.byteLength(v); requireSkill(bytes <= 8 * 1024 * 1024, 'SKILL_INPUT_BOUND'); return v;
    }
    if (typeof v === 'number') { requireSkill(Number.isSafeInteger(v), 'SKILL_NUMBER'); return v; }
    requireSkill(typeof v === 'object' && !types.isProxy(v), 'SKILL_OBJECT');
    requireSkill(!seen.has(v), 'SKILL_OBJECT'); seen.add(v);
    const array = Array.isArray(v);
    requireSkill(Object.getPrototypeOf(v) === (array ? Array.prototype : Object.prototype) || (!array && Object.getPrototypeOf(v) === null), 'SKILL_OBJECT');
    const keys = Reflect.ownKeys(v); requireSkill(keys.length <= 4096 && keys.every(k => typeof k === 'string'), 'SKILL_INPUT_BOUND');
    const ds = Object.getOwnPropertyDescriptors(v);
    requireSkill(Object.values(ds).every(d => 'value' in d), 'SKILL_ACCESSOR');
    if (array) {
      const length = ds.length?.value as unknown;
      requireSkill(typeof length === 'number' && length <= 4095 && keys.length === length + 1 && keys.every(k => k === 'length' || /^(0|[1-9]\d*)$/.test(k as string)), 'SKILL_ARRAY');
      const out: unknown[] = [];
      for (let i = 0; i < length; i++) { requireSkill(Object.hasOwn(ds, String(i)), 'SKILL_ARRAY'); out.push(copy(ds[String(i)]!.value, depth + 1)); }
      seen.delete(v); return out;
    }
    const out: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      requireSkill(key.length <= 128 && !['__proto__', 'constructor', 'prototype'].includes(key) && ds[key]!.enumerable, 'SKILL_KEY');
      out[key] = copy(ds[key]!.value, depth + 1);
    }
    seen.delete(v); return out;
  };
  return copy(value, 0);
}
export function closed(input: unknown, keys: string[]): Record<string, unknown> {
  const value = captureSkillData(input);
  requireSkill(value !== null && typeof value === 'object' && !Array.isArray(value), 'SKILL_SCHEMA');
  const record = value as Record<string, unknown>;
  requireSkill(Object.keys(record).length === keys.length && keys.every(k => Object.hasOwn(record, k)), 'SKILL_SCHEMA'); return record;
}
export function boundedText(value: unknown, max = 256): asserts value is string {
  requireSkill(typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= max && value === value.normalize('NFC') && !/[\p{Cc}\p{Cf}]/u.test(value), 'SKILL_TEXT');
}
/** Agent Skills `allowed-tools`: one non-empty line of at most 1024 bytes with no control or format character (C0 and C1 controls included). */
export const ALLOWED_TOOLS_MAX = 1024;
export function allowedToolsText(value: unknown, code = 'SKILL_FRONTMATTER'): asserts value is string {
  requireSkill(typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= ALLOWED_TOOLS_MAX && value === value.normalize('NFC') && !/[\p{Cc}\p{Cf}]/u.test(value), code);
}
/** Like `closed`, with keys that may be absent. */
export function closedWithOptional(input: unknown, required: string[], optional: string[]): Record<string, unknown> {
  const value = captureSkillData(input);
  requireSkill(value !== null && typeof value === 'object' && !Array.isArray(value), 'SKILL_SCHEMA');
  const record = value as Record<string, unknown>, keys = Object.keys(record);
  requireSkill(required.every(k => Object.hasOwn(record, k)) && keys.every(k => required.includes(k) || optional.includes(k)), 'SKILL_SCHEMA'); return record;
}
export function relativeSkillPath(value: unknown): asserts value is string {
  boundedText(value, 512);
  requireSkill(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) && value.split('/').every(p => p !== '.' && p !== '..' && p !== '' && !p.startsWith('.')) && !value.includes('//'), 'SKILL_PATH');
}
export function freezeSkillData<T>(value: T): T {
  const detached = captureSkillData(value) as T;
  const freeze = (child: unknown): void => { if (child !== null && typeof child === 'object') { for (const nested of Object.values(child)) freeze(nested); Object.freeze(child); } };
  freeze(detached); return detached;
}
function safeContentText(text: string): void {
  // Preserve bytes; allow ordinary multiline text, not terminal or bidi controls.
  requireSkill(!/[\p{Cc}\p{Cf}]/u.test(text.replace(/\r\n|\n|\t/g, '')), 'SKILL_TEXT_CONTROL');
}
function frontmatter(text: string, name: string, declaredLicense: string, allowedTools: unknown): void {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  requireSkill(match && Buffer.byteLength(match[1]!) <= 8192, 'SKILL_FRONTMATTER');
  try {
    const doc = parseDocument(match[1]!, { uniqueKeys: true });
    requireSkill(doc.errors.length === 0 && doc.warnings.length === 0, 'SKILL_FRONTMATTER');
    const parsed = captureSkillData(doc.toJS({ maxAliasCount: 0 }));
    requireSkill(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed), 'SKILL_FRONTMATTER');
    const data = parsed as Record<string, unknown>;
    requireSkill(Object.keys(data).every(k => ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'].includes(k)), 'SKILL_FRONTMATTER');
    // The pin and the text must say the same thing, so a reviewer sees every tool the skill pre-approves.
    requireSkill(Object.hasOwn(data, 'allowed-tools') ? (allowedToolsText(data['allowed-tools']), data['allowed-tools'] === allowedTools) : allowedTools === undefined, 'SKILL_FRONTMATTER');
    requireSkill(data.name === name && typeof data.description === 'string' && data.description.trim().length > 0 && Buffer.byteLength(data.description) <= 1024, 'SKILL_FRONTMATTER');
    safeContentText(data.description as string);
    for (const key of ['license', 'compatibility']) if (Object.hasOwn(data, key)) boundedText(data[key], 512);
    if (data.license === 'MIT' || data.license === 'Apache-2.0') requireSkill(data.license === declaredLicense, 'SKILL_FRONTMATTER');
    if (Object.hasOwn(data, 'metadata')) {
      requireSkill(data.metadata !== null && typeof data.metadata === 'object' && !Array.isArray(data.metadata), 'SKILL_FRONTMATTER');
      for (const [k, v] of Object.entries(data.metadata as Record<string, unknown>)) { boundedText(k, 64); boundedText(v, 256); }
    }
  } catch { refuse('SKILL_FRONTMATTER'); }
}
function localReferences(text: string, from: string): string[] {
  const paths: string[] = [];
  const add = (raw: string) => {
    if (/^(https?:\/\/|mailto:|#)/.test(raw)) return;
    requireSkill(!/%|\\|[\s<>]/.test(raw), 'SKILL_REFERENCE');
    const path = raw.split('#')[0]!; if (!path) return;
    requireSkill(!path.startsWith('/') && !path.includes('?') && !path.includes(':'), 'SKILL_REFERENCE');
    const normalized = posix.normalize(posix.join(posix.dirname(from), path)); relativeSkillPath(normalized); paths.push(normalized);
  };
  for (const match of text.matchAll(/!?\[[^\]\n]*\]\(([^)\n]*)\)/g)) add(match[1]!);
  for (const match of text.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*(\S+)\s*$/gm)) add(match[1]!);
  for (const match of text.matchAll(/`((?:references\/|\.\.?\/)[^`\n]+)`/g)) add(match[1]!);
  return paths;
}
/** Text parsing is bounded and duplicate-key errors never escape this domain. */
export function parseSkillSource(text: string): SkillSourceValidation {
  let value: unknown;
  try { value = strictJson(text, 4 * 1024 * 1024); } catch { refuse('SKILL_JSON'); }
  return validateSkillSource(value);
}
export function validateSkillSource(value: unknown): SkillSourceValidation {
  const data = closed(captureSkillData(value), ['format', 'synthetic', 'source', 'skill', 'files', 'references', 'license']);
  requireSkill(data.format === 'bowerloom/synthetic-skill-source/v1beta1' && data.synthetic === true, 'SKILL_SYNTHETIC_REQUIRED');
  const kind = (data.source as Record<string, unknown> | null)?.kind;
  const source = closed(data.source, kind === 'npm' ? ['kind', 'registry', 'package', 'version', 'integrity', 'archiveSha256', 'metadataSha256', 'publisher', 'declaredLicense'] : ['kind', 'host', 'repository', 'commit', 'tree', 'pathTrees', 'metadataSha256', 'declaredLicense']);
  requireSkill(kind === 'npm' || kind === 'git', 'SKILL_SOURCE'); hashValue(source.metadataSha256);
  if (kind === 'npm') {
    requireSkill(source.registry === 'https://registry.npmjs.org', 'SKILL_SOURCE');
    boundedText(source.package, 214); requireSkill(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(source.package), 'SKILL_SOURCE');
    boundedText(source.version, 128); requireSkill(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(source.version), 'SKILL_SOURCE');
    const prerelease = source.version.split('-').slice(1).join('-');
    requireSkill(!prerelease || prerelease.split('.').every(part => !/^\d+$/.test(part) || part === '0' || !part.startsWith('0')), 'SKILL_SOURCE');
    boundedText(source.integrity, 95); requireSkill(/^sha512-[A-Za-z0-9+/]{86}==$/.test(source.integrity) && Buffer.from(source.integrity.slice(7), 'base64').toString('base64') === source.integrity.slice(7), 'SKILL_INTEGRITY');
    hashValue(source.archiveSha256); boundedText(source.publisher, 128);
  } else {
    requireSkill(source.host === 'github.com', 'SKILL_SOURCE'); boundedText(source.repository, 200);
    requireSkill(/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/.test(source.repository) && !source.repository.endsWith('.git'), 'SKILL_SOURCE');
    requireSkill(typeof source.commit === 'string' && /^[a-f0-9]{40}$/.test(source.commit) && typeof source.tree === 'string' && /^[a-f0-9]{40}$/.test(source.tree), 'SKILL_SOURCE');
  }
  const skill = closedWithOptional(data.skill, ['id', 'name', 'sourceRoot'], ['allowedTools']);
  if (Object.hasOwn(skill, 'allowedTools')) allowedToolsText(skill.allowedTools);
  for (const key of ['id', 'name']) { boundedText(skill[key], 64); requireSkill(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill[key]), 'SKILL_NAME'); }
  relativeSkillPath(skill.sourceRoot);
  // A Git source pins one tree per source root segment, at most eight.
  if (kind === 'git') requireSkill(Array.isArray(source.pathTrees) && source.pathTrees.length === skill.sourceRoot.split('/').length && source.pathTrees.length <= 8 && source.pathTrees.every(sha => typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha)), 'SKILL_SOURCE');
  const license = closed(data.license, ['spdx', 'origin', 'files']);
  requireSkill(['MIT', 'Apache-2.0'].includes(license.spdx as string) && license.spdx === source.declaredLicense && license.origin === 'included', 'SKILL_LICENSE');
  requireSkill(Array.isArray(license.files) && license.files.length > 0 && license.files.length <= 8, 'SKILL_LICENSE');
  for (const p of license.files) relativeSkillPath(p);
  requireSkill(new Set(license.files).size === license.files.length, 'SKILL_LICENSE');
  requireSkill(Array.isArray(data.files) && data.files.length > 0 && data.files.length <= LIMITS.files, 'SKILL_FILES');
  let total = 0;
  const paths = new Map<string, Record<string, unknown>>(), folded = new Set<string>(), sourcePaths = new Set<string>();
  for (const raw of data.files) {
    const file = closed(raw, ['path', 'sourcePath', 'text', 'sha256', 'mode']); relativeSkillPath(file.path); relativeSkillPath(file.sourcePath); hashValue(file.sha256);
    requireSkill(!folded.has(file.path.toLowerCase()) && !sourcePaths.has(file.sourcePath.toLowerCase()), 'SKILL_COLLISION');
    folded.add(file.path.toLowerCase()); sourcePaths.add(file.sourcePath.toLowerCase());
    requireSkill(file.mode === 0o644 && typeof file.text === 'string' && !file.text.includes('\0') && !file.text.includes('PRIVATE KEY-----'), 'SKILL_FILE');
    safeContentText(file.text);
    const bytes = Buffer.byteLength(file.text); requireSkill(bytes > 0 && bytes <= LIMITS.fileBytes && (total += bytes) <= LIMITS.totalBytes, 'SKILL_FILE_BOUND');
    requireSkill(digest(file.text) === file.sha256, 'SKILL_FILE_HASH');
    const isLicense = license.files.includes(file.path);
    requireSkill(isLicense ? /(?:^|\/)(?:LICENSE|NOTICE)(?:[._-][A-Za-z0-9._-]+)?$/.test(file.path) : /\.(md|txt|json|yaml|yml|csv)$/.test(file.path), 'SKILL_FILE');
    requireSkill(isLicense || file.sourcePath === `${skill.sourceRoot}/${file.path}`, 'SKILL_SOURCE_PATH'); paths.set(file.path, file);
  }
  for (const path of paths.keys()) requireSkill(![...paths.keys()].some(other => other !== path && other.startsWith(path + '/')), 'SKILL_COLLISION');
  requireSkill(paths.has('SKILL.md'), 'SKILL_ENTRY'); frontmatter(paths.get('SKILL.md')!.text as string, skill.name as string, license.spdx as string, skill.allowedTools);
  for (const path of license.files as string[]) {
    const file = paths.get(path); requireSkill(file, 'SKILL_LICENSE');
    requireSkill((file.text as string).includes(license.spdx === 'MIT' ? 'MIT License' : 'Apache License'), 'SKILL_LICENSE');
  }
  requireSkill(Array.isArray(data.references) && data.references.length <= 1024, 'SKILL_REFERENCE');
  const edges = new Set<string>();
  for (const raw of data.references) { const edge = closed(raw, ['from', 'to']); relativeSkillPath(edge.from); relativeSkillPath(edge.to); requireSkill(paths.has(edge.from) && paths.has(edge.to), 'SKILL_REFERENCE'); const key = `${edge.from}\0${edge.to}`; requireSkill(!edges.has(key), 'SKILL_REFERENCE'); edges.add(key); }
  for (const [path, file] of paths) if (path.endsWith('.md')) for (const to of localReferences(file.text as string, path)) requireSkill(paths.has(to) && edges.has(`${path}\0${to}`), 'SKILL_REFERENCE');
  const input = data as unknown as SkillSourceInput;
  input.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0); input.license.files.sort();
  input.references.sort((a, b) => `${a.from}\0${a.to}` < `${b.from}\0${b.to}` ? -1 : 1);
  return freezeSkillData<SkillSourceValidation>({ format: 'bowerloom/skill-source-validation/v1beta1', input, revision: revisionOf(input), evidence: 'synthetic-caller-supplied', acquisitionVerified: false, publisherAuthenticated: false, referenceScope: 'declared-and-recognized-static-local-references', executionAuthorized: false, writesAuthorized: false, grantsAuthority: false });
}
