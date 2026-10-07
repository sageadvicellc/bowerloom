/**
 * `bowerloom skills check`: reads `.bowerloom/skills.json` with the full guards and checks it offline. Every pinned
 * entry must also pass the existing acquisition planner (parseManifest does that). Nothing is fetched or written.
 */
import { MANIFEST_PATH, readManifestState } from './add.js';
import { requireManifest } from './refusal.js';
import { parseManifest } from './schema.js';
import type { Entry, Harness } from './schema.js';

export const MANIFEST_CHECK_FORMAT = 'bowerloom/skills-manifest-check/v1beta1' as const;
export interface ManifestCheckItem { id: string; kind: 'npm' | 'git' | 'local'; pin: string; teams: string[] | null }
export interface ManifestCheck { format: typeof MANIFEST_CHECK_FORMAT; manifest: typeof MANIFEST_PATH; valid: true; sha256: string; bytes: number; harnesses: Harness[]; skills: ManifestCheckItem[] }

/** The pin of an entry in one line: `<package>@<version>:<path>`, `<owner>/<repo>@<commit>:<path>`, or the local path. */
export function pinOf(e: Entry): string {
  const s = e.source;
  if (s.kind === 'local') return s.path;
  const root = (e as { skill: { sourceRoot: string } }).skill.sourceRoot;
  return s.kind === 'npm' ? `${s.package}@${s.version}:${root}` : `${s.repository}@${s.commit}:${root}`;
}

export function checkManifest(project: string): ManifestCheck {
  const state = readManifestState(project);
  requireManifest(state.file !== null, 'MANIFEST_NOT_FOUND');
  const m = parseManifest(state.file.bytes);
  return {
    format: MANIFEST_CHECK_FORMAT, manifest: MANIFEST_PATH, valid: true, sha256: state.file.sha256, bytes: state.file.bytes.length, harnesses: [...m.harnesses],
    skills: m.skills.map(e => ({ id: e.id, kind: e.source.kind, pin: pinOf(e), teams: e.teams ? [...e.teams] : null })),
  };
}
