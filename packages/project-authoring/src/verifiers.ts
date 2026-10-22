/**
 * The authoring and manifest owners of paths inside `.bowerloom/` (build plan 01, section 2), for `inspectStartup`.
 * `claims` is a pure path test. `verify` reads with the full guards and answers `verified`, `edited` (users and agents
 * own what they created, so a change is reported, not treated as drift) or `refused` with a fixed code.
 */
import { isAbsolute, join, resolve } from 'node:path';
import type { OwnedEntryKind, OwnerVerdict, OwnerVerifier } from '../../project-context/src/types.js';
import { readManifestState } from '../../skill-manifest/src/add.js';
import { MANIFEST_LIMITS, parseManifest } from '../../skill-manifest/src/schema.js';
import { isManifestRefusal } from '../../skill-manifest/src/refusal.js';
import { LIMITS, folderNames, lstatOrNull, readGuarded, readTree, realFolder, sha256 } from './files.js';
import { AGENT_STEM, AGENT_STEM_MAX, parseAgentOrRefuse, skippedAgentName } from './agent-file.js';
import { isSliceId, parseSlice } from '../../context-slices/src/slice-file.js';
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

/** The one team folder that the startup receipt lists: its `agents/` folder is hand placed, so the authoring owner claims it. */
const FIRST_TEAM_AGENTS = 'teams/first-team/agents';
/**
 * Every entry of a team's `agents/` folder (spec 01a, section 4.5): a plain file named `<role>.md` that parses as an
 * agent. The folder itself must be real, owned, with safe names (AUTHORING_UNSAFE_PATH otherwise). Any other entry or any
 * file the parser refuses is AGENT_INVALID. A role named by two teams is not a status finding; apply holds it.
 */
function agentsVerdict(agents: string, team: string): OwnerVerdict | null {
  const names = folderNames(agents).filter(n => !skippedAgentName(n));
  for (const name of names) {
    const file = join(agents, name), s = lstatOrNull(file), stem = name.endsWith('.md') ? name.slice(0, -3) : '';
    if (s === null || s.isSymbolicLink() || !s.isFile() || !name.endsWith('.md') || stem.length < 1 || stem.length > AGENT_STEM_MAX || !AGENT_STEM.test(stem) || stem.startsWith('prompt-')) return refused('AGENT_INVALID');
    // An unsafe file is AUTHORING_UNSAFE_PATH and an I/O error stays an error. Only a parse refusal is AGENT_INVALID.
    const bytes = readGuarded(file, 65536);
    let text: string; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return refused('AGENT_INVALID'); }
    try { parseAgentOrRefuse(text, stem, team); }
    catch (error) { if (isAuthoringRefusal(error) && ['AGENT_INVALID', 'AGENT_KEY_UNKNOWN', 'AGENT_NAME_MISMATCH'].includes(error.code)) return refused('AGENT_INVALID'); throw error; }
  }
  return null;
}

/**
 * The authoring owner: `authoring/`, `prompts/`, and the registered `teams/<id>/` and `skills/<id>/` (never
 * first-team or personal-assistant, which the startup receipt owns), and the hand-placed `teams/first-team/agents/`.
 * A claimed folder is verified whole.
 */
export function authoringVerifier(project: string): OwnerVerifier {
  projectPath(project);
  const bowerloom = join(project, '.bowerloom');
  const claims = (path: string, kind: OwnedEntryKind): boolean =>
    typeof path === 'string' && kind === 'directory' && (path === AUTHORING_FOLDER || path === 'prompts' || path === 'slices' || path === FIRST_TEAM_AGENTS || claimedItem(path) !== null);
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
    if (path === 'slices') {
      // Each name must be a registered slice file that parses. A name that is not `<id>.yaml`, or not registered, is unregistered.
      let changed = false;
      const slices = folderNames(join(bowerloom, 'slices'));
      // A link or any other entry that is not a plain file is unsafe, whatever its name.
      for (const name of slices) { const s = lstatOrNull(join(bowerloom, 'slices', name)); if (s === null || s.isSymbolicLink() || !s.isFile()) return refused('AUTHORING_UNSAFE_PATH'); }
      for (const name of slices) {
        const id = name.endsWith('.yaml') ? name.slice(0, -5) : '';
        const item = isSliceId(id) ? lookup('slice', id) : null;
        if (item === null) return refused('AUTHORING_UNREGISTERED');
        if (item === 'pending') return refused('AUTHORING_PENDING');
        const bytes = readGuarded(join(bowerloom, 'slices', name), LIMITS.fileBytes), pin = item.files[0]!;
        let text: string; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return refused('SLICE_INVALID'); }
        if (!parseSlice(text, id).ok) return refused('SLICE_INVALID');
        if (sha256(bytes) !== pin.sha256 || bytes.length !== pin.bytes) changed = true;
      }
      return changed ? edited : verified;
    }
    if (path === FIRST_TEAM_AGENTS) return agentsVerdict(join(bowerloom, path), 'first-team') ?? verified;
    const target = claimedItem(path)!, item = lookup(target.kind, target.id);
    if (item === null) return refused('AUTHORING_UNREGISTERED');
    if (item === 'pending') return refused('AUTHORING_PENDING');
    // A team's hand-placed `agents/` folder is not part of what create wrote: it is left out of both sides of the
    // comparison, and checked on its own.
    const agents = `${path}/agents`, files = target.kind === 'team' ? item.files.filter(f => !f.path.startsWith(agents + '/')) : item.files;
    if (target.kind === 'team' && lstatOrNull(join(bowerloom, agents)) !== null) { const verdict = agentsVerdict(join(bowerloom, agents), target.id); if (verdict) return verdict; }
    const pins = readTree(bowerloom, path, target.kind === 'team' ? agents : null);
    return pins.length === files.length && pins.every((p, i) => p.path === files[i]!.path && p.sha256 === files[i]!.sha256 && p.bytes === files[i]!.bytes) ? verified : edited;
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
        parseManifest(state.file.bytes, MANIFEST_LIMITS);
        return verified;
      } catch (error) { return refused(isManifestRefusal(error) ? error.code : 'MANIFEST_INVALID'); }
    },
  });
}

