/**
 * `.bowerloom/skills.json`, format `bowerloom/skills/v1beta1` (build plan 01, section 3). One exact-pin file that is
 * its own lock and goes into version control. The parser is strict and every pinned entry must also pass the existing
 * acquisition planner, so a file that parses can be acquired as written.
 */
import { AdapterError, strictJson } from '../../codex-adapter/src/safe.js';
import { SkillSourceError, captureSkillData, allowedToolsText, boundedText, relativeSkillPath, freezeSkillData } from '../../skill-sources/src/validation.js';
import { strictUtf8 } from '../../skill-sources/src/cache.js';
import { planNpmAcquisition } from '../../skill-sources/src/npm.js';
import { planGitAcquisition } from '../../skill-sources/src/git.js';
import type { SkillLicense } from '../../skill-sources/src/types.js';
import { refuse, requireManifest } from './refusal.js';
import { toNpmRequest, toGitRequest, probeBinding } from './requests.js';
import { LICENSE_NAME } from './content.js';

export const MANIFEST_FORMAT = 'bowerloom/skills/v1beta1' as const;
export const MANIFEST_FILE = 'skills.json' as const;
/** skills: local and pinned entries share the count (Hanna, global skill cache). teams: per entry. */
export const MANIFEST_LIMITS = Object.freeze({ bytes: 1048576, skills: 128, teams: 32, idLength: 64 });
export type Harness = 'claude' | 'codex';
export const HARNESSES: readonly Harness[] = Object.freeze(['claude', 'codex'] as Harness[]);
export const NPM_REGISTRY = 'https://registry.npmjs.org' as const;
export const GIT_HOST = 'github.com' as const;

export interface ManifestFile { path: string; sourcePath: string; sha256: string; bytes: number }
export interface ManifestReference { from: string; to: string }
export interface NpmSource { kind: 'npm'; registry: typeof NPM_REGISTRY; package: string; version: string; integrity: string; metadataSha256: string; publisher: string }
export interface GitSource { kind: 'git'; host: typeof GIT_HOST; repository: string; commit: string; tree: string; pathTrees: string[]; metadataSha256: string }
export interface LocalSource { kind: 'local'; path: string }
/** What a resolver proposes: everything of a pinned entry except its id and teams. */
export interface PinnedContent<S> { source: S; skill: { name: string; sourceRoot: string; allowedTools?: string }; license: { spdx: SkillLicense; files: string[] }; files: ManifestFile[]; references: ManifestReference[] }
export type NpmEntry = { id: string; teams?: string[] } & PinnedContent<NpmSource>;
export type GitEntry = { id: string; teams?: string[] } & PinnedContent<GitSource>;
export type PinnedEntry = NpmEntry | GitEntry;
export interface LocalEntry { id: string; teams?: string[]; source: LocalSource }
export type Entry = PinnedEntry | LocalEntry;
export interface Manifest { format: typeof MANIFEST_FORMAT; harnesses: Harness[]; skills: Entry[] }

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OID = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** An exact npm version: the semver check of npm.ts, with no range, tag, partial version or build metadata. */
export function isExactVersion(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 128 || !VERSION.test(value)) return false;
  const pre = value.split('-').slice(1).join('-');
  return !pre || pre.split('.').every(p => !/^\d+$/.test(p) || p === '0' || !p.startsWith('0'));
}
export const isCommit = (value: unknown): value is string => typeof value === 'string' && OID.test(value);
/** A skill or team id: lower-case words joined by single hyphens, at most 64 characters. */
export const isId = (value: unknown): value is string => typeof value === 'string' && value.length <= MANIFEST_LIMITS.idLength && ID.test(value);
/** An id a skills.json entry may take. `personal-assistant` and the `prompt-` prefix are reserved. */
export const isEntryId = (value: unknown): value is string => isId(value) && value !== 'personal-assistant' && !value.startsWith('prompt-');

function invalid(work: () => void): void {
  try { work(); } catch (error) { if (error instanceof SkillSourceError || error instanceof AdapterError) refuse('MANIFEST_INVALID'); throw error; }
}
function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  requireManifest(value !== null && typeof value === 'object' && !Array.isArray(value), 'MANIFEST_INVALID');
  const v = value as Record<string, unknown>, keys = Object.keys(v);
  requireManifest(required.every(k => Object.hasOwn(v, k)) && keys.every(k => required.includes(k) || optional.includes(k)), 'MANIFEST_INVALID');
  return v;
}
function path(value: unknown): string { invalid(() => relativeSkillPath(value)); return value as string; }
function teamsOf(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  requireManifest(Array.isArray(value) && value.length > 0 && value.length <= MANIFEST_LIMITS.teams && value.every(isId) && new Set(value).size === value.length, 'MANIFEST_INVALID');
  return [...value as string[]].sort(compare);
}
function license(value: unknown): { spdx: SkillLicense; files: string[] } {
  const v = record(value, ['spdx', 'files']);
  requireManifest(typeof v.spdx === 'string', 'MANIFEST_INVALID');
  requireManifest(v.spdx === 'MIT' || v.spdx === 'Apache-2.0', 'MANIFEST_LICENSE_UNSUPPORTED');
  requireManifest(Array.isArray(v.files) && v.files.length > 0 && v.files.length <= 8 && new Set(v.files).size === v.files.length, 'MANIFEST_INVALID');
  return { spdx: v.spdx, files: (v.files as unknown[]).map(path).sort(compare) };
}
function source(value: unknown): NpmSource | GitSource | LocalSource {
  const kind = (value as { kind?: unknown } | null)?.kind;
  if (kind === 'local') { const v = record(value, ['kind', 'path']); return { kind: 'local', path: path(v.path) }; }
  if (kind === 'npm') {
    const v = record(value, ['kind', 'registry', 'package', 'version', 'integrity', 'metadataSha256', 'publisher']);
    requireManifest(typeof v.version === 'string', 'MANIFEST_INVALID');
    requireManifest(isExactVersion(v.version), 'MANIFEST_PIN_NOT_EXACT');
    requireManifest(v.registry === NPM_REGISTRY && typeof v.package === 'string' && typeof v.integrity === 'string' && typeof v.metadataSha256 === 'string' && HEX64.test(v.metadataSha256), 'MANIFEST_INVALID');
    invalid(() => boundedText(v.publisher, 128));
    return { kind: 'npm', registry: NPM_REGISTRY, package: v.package, version: v.version, integrity: v.integrity, metadataSha256: v.metadataSha256, publisher: v.publisher as string };
  }
  if (kind === 'git') {
    const v = record(value, ['kind', 'host', 'repository', 'commit', 'tree', 'pathTrees', 'metadataSha256']);
    requireManifest(typeof v.commit === 'string' && typeof v.tree === 'string' && Array.isArray(v.pathTrees) && v.pathTrees.every(s => typeof s === 'string'), 'MANIFEST_INVALID');
    requireManifest(isCommit(v.commit) && isCommit(v.tree) && (v.pathTrees as string[]).every(isCommit), 'MANIFEST_PIN_NOT_EXACT');
    requireManifest(v.host === GIT_HOST && typeof v.repository === 'string' && typeof v.metadataSha256 === 'string' && HEX64.test(v.metadataSha256), 'MANIFEST_INVALID');
    return { kind: 'git', host: GIT_HOST, repository: v.repository, commit: v.commit, tree: v.tree, pathTrees: [...v.pathTrees as string[]], metadataSha256: v.metadataSha256 };
  }
  return refuse('MANIFEST_INVALID');
}

/**
 * Review M3 finding 2: an npm license file outside the skill folder must sit in the skill folder's parent chain (the
 * package root included), have a LICENSE name, and keep that name, the rule `skills add` follows (resolve-npm.ts).
 * So a hand-written entry cannot map another package file in as a license. Git already refuses this (GIT_OUTSIDE_PATH).
 */
function npmLicensePlacement(entry: PinnedEntry): void {
  const root = entry.skill.sourceRoot;
  for (const name of entry.license.files) {
    const file = entry.files.find(f => f.path === name);
    if (!file || file.sourcePath === `${root}/${file.path}`) continue;
    const slash = file.sourcePath.lastIndexOf('/'), folder = slash < 0 ? '' : file.sourcePath.slice(0, slash), base = file.sourcePath.slice(slash + 1);
    requireManifest((folder === '' || root === folder || root.startsWith(`${folder}/`)) && LICENSE_NAME.test(base) && file.path === base, 'MANIFEST_INVALID');
  }
}
/** One entry, checked and normalized: arrays sorted, keys closed. A pinned entry must pass the acquisition planner. */
export function validateEntry(value: unknown): Entry {
  const kind = ((value as { source?: { kind?: unknown } } | null)?.source)?.kind;
  const v = record(value, kind === 'local' ? ['id', 'source'] : ['id', 'source', 'skill', 'license', 'files', 'references'], ['teams']);
  requireManifest(isEntryId(v.id), 'MANIFEST_INVALID');
  const teams = teamsOf(v.teams), src = source(v.source), id = v.id;
  const head = { id, ...(teams ? { teams } : {}) };
  if (src.kind === 'local') { requireManifest(src.path === `skills/${id}`, 'MANIFEST_INVALID'); return { ...head, source: src }; }
  const lic = license(v.license);
  const skill = record(v.skill, ['name', 'sourceRoot'], ['allowedTools']);
  requireManifest(isId(skill.name), 'MANIFEST_INVALID');
  if (Object.hasOwn(skill, 'allowedTools')) invalid(() => allowedToolsText(skill.allowedTools, 'SKILL_TEXT'));
  requireManifest(Array.isArray(v.files) && Array.isArray(v.references), 'MANIFEST_INVALID');
  const files = (v.files as unknown[]).map(raw => {
    const f = record(raw, ['path', 'sourcePath', 'sha256', 'bytes']);
    requireManifest(typeof f.sha256 === 'string' && HEX64.test(f.sha256) && Number.isSafeInteger(f.bytes) && (f.bytes as number) > 0, 'MANIFEST_INVALID');
    return { path: path(f.path), sourcePath: path(f.sourcePath), sha256: f.sha256, bytes: f.bytes as number };
  }).sort((a, b) => compare(a.path, b.path));
  const references = (v.references as unknown[]).map(raw => { const r = record(raw, ['from', 'to']); return { from: path(r.from), to: path(r.to) }; })
    .sort((a, b) => compare(`${a.from}\0${a.to}`, `${b.from}\0${b.to}`));
  const entry = { ...head, source: src, skill: { name: skill.name, sourceRoot: path(skill.sourceRoot), ...(Object.hasOwn(skill, 'allowedTools') ? { allowedTools: skill.allowedTools as string } : {}) }, license: lic, files, references } as PinnedEntry;
  if (src.kind === 'npm') npmLicensePlacement(entry);
  // The existing planners hold every rule of an acquisition request: package and repository names, integrity, file
  // bounds, license file placement, references. A probe binding lets them run in memory.
  try { if (src.kind === 'npm') planNpmAcquisition(toNpmRequest(entry as NpmEntry), probeBinding()); else planGitAcquisition(toGitRequest(entry as GitEntry), probeBinding()); }
  catch { refuse('MANIFEST_INVALID'); }
  return entry;
}

/** Checks a whole manifest value and returns it normalized and frozen. Entries are sorted by id. */
export function validateManifest(value: unknown): Manifest {
  const v = record(value, ['format', 'harnesses', 'skills']);
  requireManifest(v.format === MANIFEST_FORMAT, 'MANIFEST_INVALID');
  const h = v.harnesses;
  requireManifest(Array.isArray(h) && h.length > 0 && h.every(x => (HARNESSES as readonly unknown[]).includes(x)) && h.every((x, i) => i === 0 || compare(h[i - 1] as string, x as string) < 0), 'MANIFEST_INVALID');
  requireManifest(Array.isArray(v.skills), 'MANIFEST_INVALID');
  requireManifest(v.skills.length <= MANIFEST_LIMITS.skills, 'MANIFEST_LIMIT');
  const skills = (v.skills as unknown[]).map(validateEntry);
  requireManifest(new Set(skills.map(s => s.id)).size === skills.length, 'MANIFEST_DUPLICATE_ID');
  skills.sort((a, b) => compare(a.id, b.id));
  return freezeSkillData({ format: MANIFEST_FORMAT, harnesses: [...h] as Harness[], skills });
}

/** Strict parse: at most 1 MiB of UTF-8 with no byte order mark, no duplicate or unknown keys. */
export function parseManifest(bytes: Buffer): Manifest {
  requireManifest(Buffer.isBuffer(bytes), 'MANIFEST_INVALID');
  requireManifest(bytes.length <= MANIFEST_LIMITS.bytes, 'MANIFEST_LIMIT');
  requireManifest(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), 'MANIFEST_INVALID');
  const text = strictUtf8(bytes); requireManifest(text !== null, 'MANIFEST_INVALID');
  let value: unknown;
  try { value = captureSkillData(strictJson(text, MANIFEST_LIMITS.bytes)); }
  catch (error) { if (error instanceof AdapterError || error instanceof SkillSourceError) refuse('MANIFEST_INVALID'); throw error; }
  return validateManifest(value);
}

function serializeEntry(e: Entry) {
  const head = { id: e.id, ...(e.teams ? { teams: [...e.teams].sort(compare) } : {}) };
  if (e.source.kind === 'local') return { ...head, source: { kind: 'local', path: e.source.path } };
  const p = e as PinnedEntry, s = p.source;
  const src = s.kind === 'npm'
    ? { kind: 'npm', registry: s.registry, package: s.package, version: s.version, integrity: s.integrity, metadataSha256: s.metadataSha256, publisher: s.publisher }
    : { kind: 'git', host: s.host, repository: s.repository, commit: s.commit, tree: s.tree, pathTrees: [...s.pathTrees], metadataSha256: s.metadataSha256 };
  return {
    ...head, source: src, skill: { name: p.skill.name, sourceRoot: p.skill.sourceRoot, ...(p.skill.allowedTools !== undefined ? { allowedTools: p.skill.allowedTools } : {}) },
    license: { spdx: p.license.spdx, files: [...p.license.files].sort(compare) },
    files: [...p.files].sort((a, b) => compare(a.path, b.path)).map(f => ({ path: f.path, sourcePath: f.sourcePath, sha256: f.sha256, bytes: f.bytes })),
    references: [...p.references].sort((a, b) => compare(`${a.from}\0${a.to}`, `${b.from}\0${b.to}`)).map(r => ({ from: r.from, to: r.to })),
  };
}
/** Canonical bytes: fixed key order, entries sorted by id, 2-space indent and a final newline. The result is checked. */
export function serializeManifest(m: Manifest): string {
  requireManifest(m !== null && typeof m === 'object' && Array.isArray(m.skills) && Array.isArray(m.harnesses), 'MANIFEST_INVALID');
  const text = `${JSON.stringify({ format: m.format, harnesses: [...m.harnesses], skills: [...m.skills].sort((a, b) => compare(a.id, b.id)).map(serializeEntry) }, null, 2)}\n`;
  parseManifest(Buffer.from(text));
  return text;
}
