/**
 * The authoring and manifest owners of paths inside `.bowerloom/` (build plan 01, section 2), for `inspectStartup`.
 * `claims` is a pure path test. `verify` reads with the full guards and answers `verified`, `edited` (users and agents
 * own what they created, so a change is reported, not treated as drift) or `refused` with a fixed code.
 */
import { isAbsolute, join, resolve } from 'node:path';
import type { OwnedEntryKind, OwnerVerdict, OwnerVerifier } from '../../project-context/src/types.js';
import { readManifestState } from '../../skill-manifest/src/add.js';
import { parseManifest } from '../../skill-manifest/src/schema.js';
import { isManifestRefusal } from '../../skill-manifest/src/refusal.js';
import { LIMITS, folderNames, lstatOrNull, readGuarded, readTree, realFolder, sha256 } from './files.js';
import { isAuthoringRefusal, refuse } from './refusal.js';
import { AUTHORING_FOLDER, isPromptId, isSkillId, isTeamId, itemPath, readAuthoringState, sameItem } from './state.js';
import type { AuthoredItem, ItemKind } from './state.js';

const verified: OwnerVerdict = Object.freeze({ result: 'verified' });
const edited: OwnerVerdict = Object.freeze({ result: 'edited' });
const refused = (code: string): OwnerVerdict => Object.freeze({ result: 'refused', code });
function projectPath(project: unknown): asserts project is string {
  if (typeof project !== 'string' || !isAbsolute(project) || resolve(project) !== project || project.includes('\0')) throw new TypeError('An owner verifier takes the absolute path of a project folder.');
}
const ITEM = /^(teams|skills)\/([^/]+)$/;
/** The item a claimed folder holds, or null. */
function claimedItem(path: string): { kind: ItemKind; id: string } | null {
  const m = ITEM.exec(path);
  if (!m) return null;
  return m[1] === 'teams' ? (isTeamId(m[2]) ? { kind: 'team', id: m[2] } : null) : (isSkillId(m[2]) ? { kind: 'skill', id: m[2] } : null);
}

/**
 * The authoring owner: `authoring/`, `prompts/`, and the registered `teams/<id>/` and `skills/<id>/` (never
 * first-team or personal-assistant, which the startup receipt owns). A claimed folder is verified whole.
 */
export function authoringVerifier(project: string): OwnerVerifier {
  projectPath(project);
  const bowerloom = join(project, '.bowerloom');
  const claims = (path: string, kind: OwnedEntryKind): boolean =>
    typeof path === 'string' && kind === 'directory' && (path === AUTHORING_FOLDER || path === 'prompts' || claimedItem(path) !== null);
  async function check(path: string, kind: OwnedEntryKind, signal: AbortSignal): Promise<OwnerVerdict> {
    if (!claims(path, kind) || !(signal instanceof AbortSignal) || signal.aborted) refuse('AUTHORING_UNSAFE_PATH');
    realFolder(bowerloom);
    const state = readAuthoringState(bowerloom);
    const items = state.receipt?.value.items ?? [], pending = state.pending?.value.item ?? null;
    if (path === AUTHORING_FOLDER) {
      if (state.pending || state.scratch.length) return refused('AUTHORING_PENDING');
      // Review M2 finding 3: the walk visits only what exists, so a registered team, skill or prompt that was deleted is
      // reported here (review finding 1 added prompts). `prompt create <id>` restores a prompt.
      return items.some(i => lstatOrNull(join(bowerloom, itemPath(i.kind, i.id))) === null) ? refused('AUTHORING_ITEM_MISSING') : verified;
    }
    const lookup = (kind: ItemKind, id: string): AuthoredItem | 'pending' | null =>
      items.find(i => i.kind === kind && i.id === id) ?? (pending && sameItem(pending, { kind, id }) ? 'pending' : null);
    if (path === 'prompts') {
      let changed = false;
      const names = folderNames(join(bowerloom, 'prompts'));
      for (const name of names) {
        const id = name.endsWith('.md') ? name.slice(0, -3) : '';
        const item = isPromptId(id) ? lookup('prompt', id) : null;
        if (item === null) return refused('AUTHORING_UNREGISTERED');
        if (item === 'pending') return refused('AUTHORING_PENDING');
        const bytes = readGuarded(join(bowerloom, 'prompts', name), LIMITS.fileBytes), pin = item.files[0]!;
        if (sha256(bytes) !== pin.sha256 || bytes.length !== pin.bytes) changed = true;
      }
      // A registered prompt that is gone is AUTHORING_ITEM_MISSING on `authoring`, not an edit here.
      return changed ? edited : verified;
    }
    const target = claimedItem(path)!, item = lookup(target.kind, target.id);
    if (item === null) return refused('AUTHORING_UNREGISTERED');
    if (item === 'pending') return refused('AUTHORING_PENDING');
    const pins = readTree(bowerloom, path);
    return pins.length === item.files.length && pins.every((p, i) => p.path === item.files[i]!.path && p.sha256 === item.files[i]!.sha256 && p.bytes === item.files[i]!.bytes) ? verified : edited;
  }
  return Object.freeze({
    owner: 'authoring' as const,
    claims,
    async verify(path: string, kind: OwnedEntryKind, signal: AbortSignal): Promise<OwnerVerdict> {
      try { return await check(path, kind, signal); }
      catch (error) { return refused(isAuthoringRefusal(error) ? error.code : 'AUTHORING_UNSAFE_PATH'); }
    },
  });
}

/** The manifest owner: `skills.json`, verified when it is safe to read and parses as a valid skills manifest. */
export function manifestVerifier(project: string): OwnerVerifier {
  projectPath(project);
  const claims = (path: string, kind: OwnedEntryKind): boolean => path === 'skills.json' && kind === 'file';
  return Object.freeze({
    owner: 'manifest' as const,
    claims,
    async verify(path: string, kind: OwnedEntryKind, signal: AbortSignal): Promise<OwnerVerdict> {
      if (!claims(path, kind) || !(signal instanceof AbortSignal) || signal.aborted) return refused('MANIFEST_UNSAFE');
      try {
        const state = readManifestState(project);
        if (state.file === null) return refused('MANIFEST_NOT_FOUND');
        parseManifest(state.file.bytes);
        return verified;
      } catch (error) { return refused(isManifestRefusal(error) ? error.code : 'MANIFEST_INVALID'); }
    },
  });
}

