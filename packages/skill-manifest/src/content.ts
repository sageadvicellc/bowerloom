/**
 * What `skills add` reads in fetched skill files. Fetched text is data only: it is hashed, measured, and searched for
 * three things, each bounded. Nothing in it is followed, run, or shown as an instruction.
 * - The skill name, from the YAML frontmatter of SKILL.md (at most 8 KiB), the way skill-sources validation reads it.
 * - Local references in Markdown, with the same three patterns as skill-sources validation, so the proposed entry
 *   declares every reference the validator will look for.
 * - The license header of a LICENSE file.
 * The existing verifiers (verifyNpmPayload, verifyGitPayload) then check the whole proposal against the same bytes.
 */
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { parseDocument } from 'yaml';
import { SkillSourceError, captureSkillData, allowedToolsText, relativeSkillPath } from '../../skill-sources/src/validation.js';
import { strictUtf8 } from '../../skill-sources/src/cache.js';
import type { SkillLicense } from '../../skill-sources/src/types.js';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { fixedRefusal, refuse, requireManifest } from './refusal.js';
import { compare, isId } from './schema.js';
import type { ManifestFile, ManifestReference, PinnedContent } from './schema.js';

/** The limits of the acquisition planners (NPM_LIMITS and GIT_LIMITS agree on these). */
export const CONTENT_LIMITS = Object.freeze({ files: 128, fileBytes: 65536, selectedBytes: 2097152, frontmatterBytes: 8192, licenseFiles: 8 });
/** A license file name the validators accept, as a direct child of a folder. */
export const LICENSE_NAME = /^LICENSE(?:[._-][A-Za-z0-9._-]+)?$/;
const LICENSE_PATH = /(?:^|\/)(?:LICENSE|NOTICE)(?:[._-][A-Za-z0-9._-]+)?$/;
const TEXT_FILE = /\.(md|txt|json|yaml|yml|csv)$/;

/** Bytes as text: strict UTF-8 with no byte order mark, or unsafe content. */
export function text(bytes: Buffer): string {
  requireManifest(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), 'SKILLS_ADD_UNSAFE_CONTENT');
  const decoded = strictUtf8(bytes); requireManifest(decoded !== null, 'SKILLS_ADD_UNSAFE_CONTENT'); return decoded;
}
/** A path inside the skill folder that the validators accept for a skill file. */
export function skillFilePath(path: string): void {
  try { relativeSkillPath(path); } catch (error) { if (error instanceof SkillSourceError) refuse('SKILLS_ADD_UNSAFE_CONTENT'); throw error; }
  requireManifest(TEXT_FILE.test(path) || LICENSE_PATH.test(path), 'SKILLS_ADD_UNSAFE_CONTENT');
}
/** Bounds on the selected files: count, size of each, and total. */
export function checkBounds(files: readonly { bytes: number }[]): void {
  let total = 0;
  requireManifest(files.length > 0 && files.length <= CONTENT_LIMITS.files, 'SKILLS_ADD_UNSAFE_CONTENT');
  for (const f of files) requireManifest(Number.isSafeInteger(f.bytes) && f.bytes > 0 && f.bytes <= CONTENT_LIMITS.fileBytes && (total += f.bytes) <= CONTENT_LIMITS.selectedBytes, 'SKILLS_ADD_UNSAFE_CONTENT');
}

/** The `name` and the optional `allowed-tools` of the SKILL.md frontmatter. Any other frontmatter problem is left to the validator. */
export function skillHead(skill: string): { name: string; allowedTools?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(skill);
  requireManifest(match && Buffer.byteLength(match[1]!) <= CONTENT_LIMITS.frontmatterBytes, 'SKILLS_ADD_UNSAFE_CONTENT');
  let data: unknown;
  try {
    const doc = parseDocument(match[1]!, { uniqueKeys: true });
    requireManifest(doc.errors.length === 0 && doc.warnings.length === 0, 'SKILLS_ADD_UNSAFE_CONTENT');
    data = captureSkillData(doc.toJS({ maxAliasCount: 0 }));
  } catch { return refuse('SKILLS_ADD_UNSAFE_CONTENT'); }
  requireManifest(data !== null && typeof data === 'object' && !Array.isArray(data), 'SKILLS_ADD_UNSAFE_CONTENT');
  const record = data as Record<string, unknown>, name = record.name;
  requireManifest(isId(name), 'SKILLS_ADD_UNSAFE_CONTENT');
  if (!Object.hasOwn(record, 'allowed-tools')) return { name };
  try { allowedToolsText(record['allowed-tools']); } catch (error) { if (error instanceof SkillSourceError) refuse('SKILLS_ADD_UNSAFE_CONTENT'); throw error; }
  return { name, allowedTools: record['allowed-tools'] as string };
}
/** The `name` of the SKILL.md frontmatter. */
export const skillName = (skill: string): string => skillHead(skill).name;

// The local reference patterns of skill-sources validation.ts `localReferences`, so the entry declares each edge.
function references(body: string, from: string): string[] {
  const found: string[] = [];
  const add = (raw: string) => {
    if (/^(https?:\/\/|mailto:|#)/.test(raw)) return;
    requireManifest(!/%|\\|[\s<>]/.test(raw), 'SKILLS_ADD_UNSAFE_CONTENT');
    const path = raw.split('#')[0]!; if (!path) return;
    requireManifest(!path.startsWith('/') && !path.includes('?') && !path.includes(':'), 'SKILLS_ADD_UNSAFE_CONTENT');
    found.push(posix.normalize(posix.join(posix.dirname(from), path)));
  };
  for (const m of body.matchAll(/!?\[[^\]\n]*\]\(([^)\n]*)\)/g)) add(m[1]!);
  for (const m of body.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*(\S+)\s*$/gm)) add(m[1]!);
  for (const m of body.matchAll(/`((?:references\/|\.\.?\/)[^`\n]+)`/g)) add(m[1]!);
  return found;
}
/** Every local reference from a Markdown file to another selected file, sorted. A reference to a missing file is left for the validator to refuse. */
export function referenceEdges(files: ReadonlyMap<string, string>): ManifestReference[] {
  const edges = new Map<string, ManifestReference>();
  for (const [from, body] of files) if (from.endsWith('.md')) for (const to of references(body, from)) if (files.has(to)) edges.set(`${from}\0${to}`, { from, to });
  return [...edges.entries()].sort(([a], [b]) => compare(a, b)).map(([, edge]) => edge);
}

/**
 * The license an exact header names: the first non-blank line is `MIT License`, `The MIT License` or
 * `The MIT License (MIT)`; or it is `Apache License` and the next non-blank line starts with `Version 2.0`.
 */
export function licenseHeader(body: string): SkillLicense | null {
  const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (['MIT License', 'The MIT License', 'The MIT License (MIT)'].includes(lines[0] ?? '')) return 'MIT';
  if (lines[0] === 'Apache License' && /^Version 2\.0(?:\b|,)/.test(lines[1] ?? '')) return 'Apache-2.0';
  return null;
}
/** The text the validator requires in a license file of each license. */
export const LICENSE_TEXT: Readonly<Record<SkillLicense, string>> = Object.freeze({ MIT: 'MIT License', 'Apache-2.0': 'Apache License' });

/**
 * The folders to search for a license, nearest first: the skill folder, then each folder above it up to the root
 * (the package root or the repository root), as paths relative to that root ('' is the root).
 */
export function licenseFolders(sourceRoot: string): string[] {
  const parts = sourceRoot.split('/'); return parts.map((_, i) => parts.slice(0, parts.length - i).join('/')).concat('');
}

export interface SelectedFile { path: string; sourcePath: string; bytes: Buffer }
/** The pinned content of one skill: files sorted by path, the license files, the references. */
export function pinnedContent<S>(source: S, sourceRoot: string, files: readonly SelectedFile[], spdx: SkillLicense, licenseFiles: readonly string[]): PinnedContent<S> & { texts: Map<string, string> } {
  checkBounds(files.map(f => ({ bytes: f.bytes.length })));
  const texts = new Map(files.map(f => [f.path, text(f.bytes)]));
  const skill = texts.get('SKILL.md'); requireManifest(skill !== undefined, 'SKILLS_ADD_SKILL_MISSING');
  requireManifest(licenseFiles.length > 0 && licenseFiles.length <= CONTENT_LIMITS.licenseFiles, 'SKILLS_ADD_LICENSE_UNKNOWN');
  const pins: ManifestFile[] = files.map(f => ({ path: f.path, sourcePath: f.sourcePath, sha256: sha256(f.bytes), bytes: f.bytes.length })).sort((a, b) => compare(a.path, b.path));
  return { source, skill: { ...(({ name, allowedTools }) => ({ name, sourceRoot, ...(allowedTools !== undefined ? { allowedTools } : {}) }))(skillHead(skill)) }, license: { spdx, files: [...licenseFiles].sort(compare) }, files: pins, references: referenceEdges(texts), texts };
}
export const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** One GET through the transport. A refusal it raised keeps its code; any other failure is SKILLS_ADD_NETWORK. */
export async function fetchBytes(transport: { get(url: string, maxBytes: number, signal: AbortSignal): Promise<Buffer> }, url: string, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  requireManifest(!signal.aborted, 'SKILLS_ADD_NETWORK');
  let bytes: unknown;
  try { bytes = await transport.get(url, maxBytes, signal); } catch (error) { throw fixedRefusal(error, 'SKILLS_ADD_NETWORK'); }
  requireManifest(Buffer.isBuffer(bytes) && bytes.length <= maxBytes, 'SKILLS_ADD_NETWORK');
  requireManifest(!signal.aborted, 'SKILLS_ADD_NETWORK');
  return bytes;
}
/** Fetched JSON, strict and bounded, detached from any prototype. Anything else is unsafe content. */
export function fetchedJson(bytes: Buffer, maxBytes: number): Record<string, unknown> {
  let value: unknown;
  try { value = captureSkillData(strictJson(text(bytes), maxBytes)); } catch { return refuse('SKILLS_ADD_UNSAFE_CONTENT'); }
  requireManifest(value !== null && typeof value === 'object' && !Array.isArray(value), 'SKILLS_ADD_UNSAFE_CONTENT');
  return value as Record<string, unknown>;
}
