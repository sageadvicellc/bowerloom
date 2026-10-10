/**
 * Maps a pinned skills.json entry onto the existing acquisition requests (build plan 01, section 3):
 * - `declaredLicense` comes from `license.spdx`, and `license.origin` is always `included`.
 * - `files[].mode` is always 420, and `skill.id` comes from the entry `id`.
 * - `registry` and `host` must equal their constants and are dropped from the request.
 * A license file may sit outside `skill.sourceRoot`. The mapping keeps its `sourcePath` as it is, and the existing
 * planners decide: npm accepts any package path for a license file; Git accepts only a direct child of a tree on the
 * walked path (planGitAcquisition, GIT_OUTSIDE_PATH).
 */
import type { NpmAcquisitionRequest } from '../../skill-sources/src/npm.js';
import { NPM_LIMITS } from '../../skill-sources/src/npm.js';
import type { GitAcquisitionRequest } from '../../skill-sources/src/git.js';
import type { SkillCacheBinding } from '../../skill-sources/src/cache.js';
import { requireManifest } from './refusal.js';
import type { NpmEntry, GitEntry, PinnedEntry } from './schema.js';

function common(e: PinnedEntry) {
  return {
    declaredLicense: e.license.spdx,
    skill: { id: e.id, name: e.skill.name, sourceRoot: e.skill.sourceRoot, ...(e.skill.allowedTools !== undefined ? { allowedTools: e.skill.allowedTools } : {}) },
    files: e.files.map(f => ({ path: f.path, sourcePath: f.sourcePath, sha256: f.sha256, bytes: f.bytes, mode: 420 as const })),
    references: e.references.map(r => ({ from: r.from, to: r.to })),
    license: { spdx: e.license.spdx, origin: 'included' as const, files: [...e.license.files] },
  };
}
export function toNpmRequest(e: NpmEntry): NpmAcquisitionRequest {
  requireManifest(e !== null && typeof e === 'object' && e.source?.kind === 'npm' && e.source.registry === 'https://registry.npmjs.org', 'MANIFEST_INVALID');
  const { package: name, version, integrity, metadataSha256, publisher } = e.source;
  return { package: name, version, integrity, metadataSha256, publisher, ...common(e) };
}
export function toGitRequest(e: GitEntry): GitAcquisitionRequest {
  requireManifest(e !== null && typeof e === 'object' && e.source?.kind === 'git' && e.source.host === 'github.com', 'MANIFEST_INVALID');
  const { repository, commit, tree, pathTrees, metadataSha256 } = e.source;
  return { repository, commit, tree, pathTrees: [...pathTrees], metadataSha256, ...common(e) };
}

const PROBE_ROOT = '/bowerloom-manifest-probe';
/**
 * A cache binding for pure checks only. planNpmAcquisition, planGitAcquisition, verifyNpmPayload and verifyGitPayload
 * read no file through a binding; they only check its shape. This one names no real folder, so a plan made with it can
 * be checked and verified in memory but never acquired: acquisition observes the binding's folders and refuses.
 */
export function probeBinding(): SkillCacheBinding {
  const uid = process.getuid?.() ?? 0, pin = (mode: number, owner: number) => ({ device: '0', inode: '0', birthtimeNs: '0', uid: owner, mode });
  return { root: PROBE_ROOT, operationId: '0'.repeat(32), minFreeBytes: NPM_LIMITS.storageBytes, ancestors: [{ path: PROBE_ROOT, identity: pin(0o700, uid) }, { path: '/', identity: pin(0o755, 0) }] };
}
