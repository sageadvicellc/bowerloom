/**
 * The source argument of `bowerloom skills add`. npm takes a path, the same shape as GitHub (owner, proof plan 01, answer 1):
 *
 *   npm:<package>@<version>:<path>              npm:@tanstack/db-skills@0.0.1:skills/tanstack-db/collections
 *   github:<owner>/<repo>@<commit>:<path>       github:affaan-m/ecc@<40 lower-case hex>:skills/verification-loop
 *
 * Why this is unambiguous: no valid package name, owner, repository, exact version, commit or path holds `:`, and none
 * holds `@` except the one that opens a scope. So after the prefix, an optional `@scope/` is read first, the name runs
 * to the next `@`, the pin runs to the next `:`, and the path is the rest. A path is required and is relative, with no
 * empty, `.` or `..` segment and no segment that starts with `.`, at most eight segments.
 * Checks run in this order: shape, then names (SKILLS_ADD_SPEC_INVALID), then the pin (MANIFEST_PIN_NOT_EXACT), then
 * the path (SKILLS_ADD_SPEC_INVALID). Nothing here reads a file or the network.
 */
import { SkillSourceError, relativeSkillPath } from '../../skill-sources/src/validation.js';
import { refuse, requireManifest } from './refusal.js';
import { isExactVersion, isCommit } from './schema.js';

export interface NpmSpec { readonly kind: 'npm'; readonly package: string; readonly version: string; readonly path: string }
export interface GitSpec { readonly kind: 'github'; readonly repository: string; readonly commit: string; readonly path: string }
export type SkillSpec = NpmSpec | GitSpec;

const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const REPOSITORY = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/;
const NPM = /^npm:(@[^/@:]*\/[^/@:]*|[^/@:]*)@([^:]*)(?::([^]*))?$/;
const GITHUB = /^github:([^/@:]*\/[^/@:]*)@([^:]*)(?::([^]*))?$/;
export const MAX_PATH_SEGMENTS = 8;

/** A skill folder path inside a package or repository. */
export function skillPath(value: unknown): string {
  requireManifest(typeof value === 'string' && value.length > 0, 'SKILLS_ADD_SPEC_INVALID');
  try { relativeSkillPath(value); } catch (error) { if (error instanceof SkillSourceError) refuse('SKILLS_ADD_SPEC_INVALID'); throw error; }
  requireManifest(value.split('/').length <= MAX_PATH_SEGMENTS, 'SKILLS_ADD_SPEC_INVALID');
  return value;
}

export function parseSkillSpec(text: unknown): SkillSpec {
  requireManifest(typeof text === 'string' && text.length > 0 && text.length <= 1024 && !/[\p{Cc}\p{Cf}\s]/u.test(text), 'SKILLS_ADD_SPEC_INVALID');
  const npm = NPM.exec(text), github = npm ? null : GITHUB.exec(text);
  const match = npm ?? github; requireManifest(match, 'SKILLS_ADD_SPEC_INVALID');
  const [, name, pin, rest] = match as unknown as [string, string, string, string | undefined];
  if (npm) {
    requireManifest(PACKAGE.test(name) && name.length <= 214, 'SKILLS_ADD_SPEC_INVALID');
    requireManifest(isExactVersion(pin), 'MANIFEST_PIN_NOT_EXACT');
    return Object.freeze({ kind: 'npm', package: name, version: pin, path: skillPath(rest) });
  }
  requireManifest(REPOSITORY.test(name) && name.length <= 200 && !name.endsWith('.git'), 'SKILLS_ADD_SPEC_INVALID');
  requireManifest(isCommit(pin), 'MANIFEST_PIN_NOT_EXACT');
  return Object.freeze({ kind: 'github', repository: name, commit: pin, path: skillPath(rest) });
}

/** A spec value as resolve-npm and resolve-git take it: checked again, so a hand-built object gets the same rules. */
export function checkSpec(value: unknown, kind: 'npm' | 'github'): SkillSpec {
  requireManifest(value !== null && typeof value === 'object' && (value as { kind?: unknown }).kind === kind, 'SKILLS_ADD_SPEC_INVALID');
  const v = value as Record<string, unknown>;
  const text = kind === 'npm' ? `npm:${String(v.package)}@${String(v.version)}:${String(v.path)}` : `github:${String(v.repository)}@${String(v.commit)}:${String(v.path)}`;
  const spec = parseSkillSpec(text);
  requireManifest(Object.keys(v).length === 4 && (spec.kind === 'npm' ? spec.package === v.package && spec.version === v.version : spec.repository === v.repository && spec.commit === v.commit) && spec.path === v.path, 'SKILLS_ADD_SPEC_INVALID');
  return spec;
}
