/**
 * `team create`, `skill create` and `prompt create` (build plan 01, M2). Users and agents own what they create.
 *
 * A plan reads and writes nothing else: it binds the identity of `.bowerloom`, the sha256 of every record it read
 * (brief.json, the authoring receipt, a pending record, skills.json) and the exact bytes it will write. Apply runs
 * under the held project lock, plans again, and refuses with STALE_APPROVAL unless the revision is equal.
 *
 * Crash safety: apply writes `authoring/pending.json` first, stages the item under `authoring/.stage-<revision>`,
 * moves it into place (a rename for a folder, a link for a prompt, so nothing is ever overwritten), updates
 * skills.json for a skill, writes the receipt, and removes the pending record. The next plan finishes a landed but
 * unregistered item only when its bytes match the record, clears a record whose item never landed, and refuses
 * anything else with AUTHORING_PENDING.
 */
import fs from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { canonicalJson } from '../../contracts/src/index.js';
import { compileCrew } from '../../crew/src/index.js';
import { isHeldProjectLock, verifyStorePins } from '../../project-context/src/index.js';
import type { StoreContext } from '../../project-context/src/index.js';
import { storeBrief } from '../../project-config/src/brief.js';
import { CONFIG_FILE, parseConfig, serializeConfig } from '../../project-config/src/schema.js';
import { configRefusal } from '../../project-config/src/refusal.js';
import { writeGuardedFile } from '../../project-config/src/write.js';
import { createBowerloomFolder } from '../../project-config/src/folder.js';
import type { ProjectContext } from '../../project-context/src/types.js';
import type { HeldProjectLock } from '../../project-context/src/types.js';
import { compilePattern } from '../../context-slices/src/glob.js';
import { sliceTemplate } from '../../context-slices/src/render.js';
import { SLICE_LIMITS, isFolderName, isSliceId, parseSlice, validRootPath } from '../../context-slices/src/slice-file.js';
import type { SliceRoot } from '../../context-slices/src/slice-file.js';
import { startupInternals, startupProfiles } from '../../startup/src/index.js';
import type { StartupProfile } from '../../startup/src/index.js';
import { scaffoldTeam } from '../../startup/src/scaffold.js';
import { addLocalEntry, applyManifestChange, planManifestChange, projectTarget, readManifestState, storeTarget } from '../../skill-manifest/src/add.js';
import type { ManifestTarget } from '../../skill-manifest/src/add.js';
import { MANIFEST_LIMITS, parseManifest, serializeManifest } from '../../skill-manifest/src/schema.js';
import type { Entry, Manifest, ManifestLimits } from '../../skill-manifest/src/schema.js';
import { LIMITS, folderNames, lstatOrNull, makeFolder, readGuarded, readTree, realFolder, removeScratch, sha256, syncFolder, writeNewFile } from './files.js';
import type { FilePin } from './files.js';
import { ensure, refuse } from './refusal.js';
import { writeReceiptRecord } from './receipt-write.js';
import { AUTHORING_FOLDER, FIRST_TEAM, PENDING, RECEIPT, isId, isPromptId, isRevision, isSkillId, isTeamId, itemPath, pendingOf, readAuthoringState, receiptOf, recordText, sameItem, stageName, tempName } from './state.js';
import type { AuthoredItem, AuthoringReceipt, AuthoringState, ItemKind, Read } from './state.js';

export const AUTHORING_PLAN_FORMAT = 'bowerloom/authoring-plan/v1beta2' as const;

/** `scope` is `project` when absent. For `store`, `project` holds the path of the store folder itself. */
export type CreateInput =
  | { kind: 'team'; project: string; name: string; profile?: StartupProfile; scope?: 'project' | 'store'; copyFrom?: { root: string } }
  | { kind: 'skill' | 'prompt'; project: string; name: string; teams: string[]; scope?: 'project' | 'store' }
  /** `root` and `includes` are null when the person gave no flag, which is how a slice file that is already there is registered. A slice belongs to its layer: it has no scope. */
  | { kind: 'slice'; project: string; name: string; root: SliceRoot | null; includes: string[] | null };

export interface ManifestStep { id: string; teams: string[]; before: Read | null; after: Read }
export interface PlannedFile { path: string; text: string; sha256: string; bytes: number }
export interface CreatePlan {
  format: typeof AUTHORING_PLAN_FORMAT;
  /** Real absolute path of the project folder, or of the store folder for the store scope. */
  project: string;
  scope: 'project' | 'store';
  /** True when the store does not exist yet and this create makes it, or has just made it. Always false for a project. */
  storeCreate: boolean;
  /** The device and inode of `.bowerloom`, as decimal strings. Null for the store, and for a project whose `.bowerloom` this create makes. */
  bowerloom: { device: string; inode: string } | null;
  /** Spec 06, 3.8: `create` when a config-only project has no `.bowerloom` yet; apply makes it first. `present` for the store. */
  bowerloomFolder: 'present' | 'create';
  input: { kind: ItemKind; name: string; teams: string[]; profile: StartupProfile | null };
  /** The sha256 and size of every record this plan read, or null when it was absent or not read. */
  reads: { brief: Read | null; receipt: Read | null; pending: Read | null; manifest: Read | null; config: Read | null };
  /** Spec 06, 3.8: the entry this create adds to bowerloom.json. Null for a project with no config, the store, and team adopt. */
  config: { before: Read | null; after: Read; text: string } | null;
  /** For team adopt: the folder the team is copied from (the store or a store cache folder). */
  copyFrom?: { root: string };
  /** Bowerloom's own scratch names in `.bowerloom/authoring` that apply removes first. */
  scratch: string[];
  /** A pending item that never landed: apply removes its record. */
  discard: AuthoredItem | null;
  /** Review M2 finding 2: an item already registered, exactly as its leftover pending record names it. The record goes. */
  settled: AuthoredItem | null;
  /** A pending item that landed with exactly its recorded bytes: apply registers it. */
  finish: AuthoredItem | null;
  /** The slice a create writes: its root and patterns. Null for any other kind. */
  slice: { root: SliceRoot; includes: string[] } | null;
  /** A slice file that is already there and not registered: create registers it and keeps its bytes. */
  register: { kind: 'slice'; id: string; teams: string[]; files: FilePin[] } | null;
  /** The new item, or null when the request is the pending item this plan finishes or a prompt it restores. */
  item: { kind: ItemKind; id: string; teams: string[]; files: FilePin[] } | null;
  /**
   * Review finding 1: a registered prompt whose file is gone, written again with its recorded bytes. The receipt
   * already lists it and stays as it is. Present only on a restore plan.
   */
  restore?: AuthoredItem;
  /** For a new team, the candidate revision its team.yaml must compile to. */
  compiledCandidate: string | null;
  /** The exact new files, relative to `.bowerloom`. */
  files: PlannedFile[];
  /** Folders apply creates, relative to `.bowerloom`, in order. */
  folders: string[];
  /**
   * The skills.json change: the bytes before (or null) and after. Each step adds one local entry through M3's
   * addLocalEntry and binds the bytes before and after it; a finished skill and a new skill are two steps.
   */
  manifest: { before: Read | null; after: Read; steps: ManifestStep[] } | null;
  writesAuthorized: false; executionAuthorized: false;
  revision: string;
}

interface Normalized { kind: ItemKind; scope: 'project' | 'store'; project: string; name: string; teams: string[]; profile: StartupProfile | null; copyFrom: { root: string } | null; root: SliceRoot | null; includes: string[] | null }
const usage = (): never => refuse('USAGE');
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function normalizeInput(input: unknown): Normalized {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return usage();
  const v = input as Record<string, unknown>, keys = Object.keys(v);
  const kind = v.kind;
  if (kind !== 'team' && kind !== 'skill' && kind !== 'prompt' && kind !== 'slice') return usage();
  const allowed = kind === 'team' ? ['kind', 'project', 'name', 'profile', 'scope', 'copyFrom'] : kind === 'slice' ? ['kind', 'project', 'name', 'root', 'includes'] : ['kind', 'project', 'name', 'teams', 'scope'];
  if (!keys.every(k => allowed.includes(k)) || !['kind', 'project', 'name', ...(kind === 'team' ? [] : kind === 'slice' ? ['root', 'includes'] : ['teams'])].every(k => Object.hasOwn(v, k))) return usage();
  if (v.scope !== undefined && v.scope !== 'project' && v.scope !== 'store') return usage();
  const scope: 'project' | 'store' = v.scope === 'store' ? 'store' : 'project';
  const project = v.project;
  if (typeof project !== 'string' || !isAbsolute(project) || resolve(project) !== project || project.includes('\0') || typeof v.name !== 'string') return usage();
  let profile: StartupProfile | null = null;
  if (kind === 'team' && v.profile !== undefined) { if (typeof v.profile !== 'string' || !Object.hasOwn(startupProfiles, v.profile)) return usage(); profile = v.profile as StartupProfile; }
  let teams: string[] = [], root: SliceRoot | null = null, includes: string[] | null = null;
  if (kind === 'slice') {
    if (v.root !== null) {
      const r = v.root as Record<string, unknown> | undefined;
      if (r === undefined || typeof r !== 'object' || Array.isArray(r)) return usage();
      if (r.kind === 'project' && Object.keys(r).length === 2 && validRootPath(r.path)) root = { kind: 'project', path: r.path };
      else if (r.kind === 'registered' && Object.keys(r).length === 3 && isFolderName(r.name) && validRootPath(r.path)) root = { kind: 'registered', name: r.name, path: r.path };
      else return usage();
    }
    if (v.includes !== null) {
      if (!Array.isArray(v.includes) || v.includes.length < 1 || v.includes.length > SLICE_LIMITS.patterns || !v.includes.every(p => typeof p === 'string' && Buffer.byteLength(p) <= SLICE_LIMITS.patternBytes && compilePattern(p).ok)) return usage();
      includes = [...v.includes as string[]];
    }
  } else if (kind !== 'team') {
    if (!Array.isArray(v.teams) || v.teams.length > 32 || !v.teams.every(t => typeof t === 'string') || new Set(v.teams).size !== v.teams.length) return usage();
    teams = [...v.teams as string[]].sort(compare);
  }
  // Spec 06, 3.17: team adopt copies a team folder from `copyFrom.root`, a folder laid out like a store. Teams only, project scope only.
  let copyFrom: { root: string } | null = null;
  if (v.copyFrom !== undefined) {
    const c = v.copyFrom as { root?: unknown } | null;
    if (kind !== 'team' || scope !== 'project' || c === null || typeof c !== 'object' || Object.keys(c).length !== 1 || typeof c.root !== 'string' || !isAbsolute(c.root) || resolve(c.root) !== c.root || c.root.includes('\0')) return usage();
    copyFrom = { root: c.root };
  }
  return { kind, scope, project, name: v.name, teams, profile, copyFrom, root, includes };
}
function checkName(input: Normalized): void {
  const { kind, name } = input;
  if (kind === 'team') { ensure(name !== FIRST_TEAM, 'TEAM_ID_RESERVED'); ensure(isTeamId(name), 'TEAM_NAME_INVALID'); }
  else if (kind === 'skill') { ensure(isId(name), 'SKILL_NAME_INVALID'); ensure(isSkillId(name) && !name.startsWith('slice-'), 'SKILL_NAME_RESERVED'); }
  else if (kind === 'slice') ensure(isSliceId(name), 'SLICE_NAME_INVALID');
  else ensure(isPromptId(name) && !name.startsWith('slice-'), 'PROMPT_NAME_INVALID');
}

interface Scope { kind: 'project' | 'store'; dir: string; bowerloom: string; identity: { device: string; inode: string } | null; exists: boolean }
/** The bytes of the project's bowerloom.json, read with the config guards (a plain file of at most 1 MiB), or null. */
function configText(dir: string): Buffer | null {
  const s = lstatOrNull(join(dir, CONFIG_FILE));
  if (s === null) return null;
  ensure(s.isFile() && !s.isSymbolicLink(), 'AUTHORING_UNSAFE_PATH');
  return readGuarded(join(dir, CONFIG_FILE), 1048576);
}
/** True when the config lists this kind and id from the store: the finish path then adds no entry (3.17). */
function finishListedFromStore(dir: string, kind: ItemKind, id: string): boolean {
  if (kind === 'slice') return false;
  const bytes = configText(dir);
  if (bytes === null) return false;
  const c = parseConfig(bytes), list = kind === 'team' ? c.teams : kind === 'skill' ? c.skills : c.prompts;
  return list.some(e => e.id === id && e.source === 'store');
}
/**
 * Spec 06, 3.8: the config step of a project create. The entry `{ id, source: "project" }` is added unless the config
 * already lists it from the project; a store entry with the same kind and id refuses CONFIG_DUPLICATE_ID.
 */
function configStep(dir: string, kind: ItemKind, id: string, after?: string): CreatePlan['config'] {
  // Spec 10, 2: a context slice is a project item only. bowerloom.json never lists it.
  if (kind === 'slice') return null;
  const bytes = configText(dir);
  if (bytes === null) return null;
  const before = { sha256: sha256(bytes), bytes: bytes.length }, config = parseConfig(after === undefined ? bytes : Buffer.from(after));
  const list = kind === 'team' ? config.teams : kind === 'skill' ? config.skills : config.prompts, now = list.find(e => e.id === id);
  if (now?.source === 'store') throw configRefusal('CONFIG_DUPLICATE_ID', `bowerloom.json lists ${kind} ${id} twice: once from store and once from project.`);
  const next = { ...config, skills: [...config.skills], prompts: [...config.prompts], teams: [...config.teams] };
  if (!now) { const target = kind === 'team' ? next.teams : kind === 'skill' ? next.skills : next.prompts; target.push({ id, source: 'project' }); target.sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id))); }
  const text = serializeConfig(next);
  return { before, after: { sha256: sha256(text), bytes: Buffer.byteLength(text) }, text };
}
/** The scope's limits and manifest target. The store keeps `skills.json` directly in its folder. */
const targetOf = (scope: Scope): ManifestTarget => scope.kind === 'store' ? storeTarget(scope.dir) : projectTarget(scope.dir);
const LEFTOVER_TEMP = /^\.store\.json\.[a-f0-9]{16}\.tmp$/;
function openScope(input: Normalized): Scope {
  const dir = input.project;
  if (input.scope === 'store') {
    // The store folder may not exist yet: its parent is the real home folder. An empty folder is a leftover.
    let parent: string; try { parent = fs.realpathSync(dirname(dir)); } catch { return refuse('AUTHORING_UNSAFE_PATH'); }
    ensure(parent === dirname(dir), 'AUTHORING_UNSAFE_PATH');
    const found = lstatOrNull(dir);
    if (found === null) return { kind: 'store', dir, bowerloom: dir, identity: null, exists: false };
    realFolder(dir);
    const exists = fs.readdirSync(dir).some(name => !LEFTOVER_TEMP.test(name) && name !== '.DS_Store');
    return { kind: 'store', dir, bowerloom: dir, identity: null, exists };
  }
  let real: string; try { real = fs.realpathSync(dir); } catch { return refuse('AUTHORING_UNSAFE_PATH'); }
  ensure(real === dir, 'AUTHORING_UNSAFE_PATH');
  const bowerloom = join(dir, '.bowerloom');
  // Spec 06, 3.4: a config-only project has no `.bowerloom` yet. The create makes it, first, under the project lock.
  if (lstatOrNull(bowerloom) === null && configText(dir) !== null) return { kind: 'project', dir, bowerloom, identity: null, exists: false };
  const s = realFolder(bowerloom);
  return { kind: 'project', dir, bowerloom, identity: { device: String(s.dev), inode: String(s.ino) }, exists: true };
}
function sameBowerloom(project: Scope): void {
  const s = realFolder(project.bowerloom);
  if (project.identity === null || String(s.dev) !== project.identity.device || String(s.ino) !== project.identity.inode) refuse('STALE_APPROVAL');
}

// The brief record that scaffold() writes to brief.json. Team create reads it directly, with the guards.
const BRIEF_KEYS = ['format', 'projectName', 'goal', 'assistantName', 'teamName', 'reviewMode', 'profile', 'origin', 'generation', 'reviewRequired', 'executionAuthorized'];
function readBrief(project: Scope): { brief: ReturnType<typeof startupInternals.normalize>['brief']; read: Read } {
  let bytes: Buffer;
  try { bytes = readGuarded(join(project.bowerloom, 'brief.json'), LIMITS.briefBytes); } catch { return refuse('PROJECT_BRIEF_INVALID'); }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Record<string, unknown>;
    ensure(value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => BRIEF_KEYS.includes(k)), 'PROJECT_BRIEF_INVALID');
    ensure(value.format === 'bowerloom/brief/v1alpha1' && value.origin === 'explicit-user-brief' && value.generation === 'deterministic-scaffold' && value.reviewRequired === true && value.executionAuthorized === false, 'PROJECT_BRIEF_INVALID');
    const fields = Object.fromEntries(['projectName', 'goal', 'assistantName', 'teamName', 'reviewMode', 'profile'].filter(k => Object.hasOwn(value, k)).map(k => [k, value[k]]));
    const normalized = startupInternals.normalize({ mode: 'existing', targetDir: project.dir, brief: fields });
    // The record must already be normalized: what scaffold() wrote, or a revise wrote, and nothing else.
    for (const [key, field] of Object.entries(fields)) ensure((normalized.brief as unknown as Record<string, unknown>)[key] === field, 'PROJECT_BRIEF_INVALID');
    return { brief: normalized.brief, read: { sha256: sha256(bytes), bytes: bytes.length } };
  } catch { return refuse('PROJECT_BRIEF_INVALID'); }
}

const SKILL_TEXT = (id: string): string => `---\nname: ${id}\ndescription: Describe when an agent should use this skill.\n---\n\n# ${id}\n\nWrite the instructions for this skill here. You and your agents own this file, so edit it freely.\nBowerloom lists this skill in .bowerloom/skills.json as a local skill. Nothing runs it.\n`;
const PROMPT_TEXT = (id: string): string => `---\ndescription: Describe what this prompt asks for.\n---\n\n# ${id}\n\nWrite the reusable prompt here. You and your agents own this file, so edit it freely.\n`;
const DEFAULT_ROOT: SliceRoot = { kind: 'project', path: '.' }, DEFAULT_INCLUDES = ['**/*.md'];
const planned = (path: string, text: string): PlannedFile => ({ path, text, sha256: sha256(text), bytes: Buffer.byteLength(text) });
export const pinsOf = (files: readonly PlannedFile[]): FilePin[] => files.map(({ path, sha256: digest, bytes }) => ({ path, sha256: digest, bytes }));
const samePins = (a: readonly FilePin[], b: readonly FilePin[]): boolean => canonicalJson(a) === canonicalJson(b);

/** Where an interrupted prompt's stage copy sits: the one path whose second link to the prompt is expected. */
const stagedPrompt = (bowerloom: string, item: { id: string; planRevision: string }): string => join(bowerloom, AUTHORING_FOLDER, stageName(item.planRevision), 'prompts', `${item.id}.md`);
/** The same for a slice file: the stage copy is the one path whose second link to the slice is expected. */
export const stagedSlice = (bowerloom: string, item: { id: string; planRevision: string }): string => join(bowerloom, AUTHORING_FOLDER, stageName(item.planRevision), 'slices', `${item.id}.yaml`);
/** 'landed' when the pending item is in place with exactly its recorded bytes, 'absent' when nothing is there. */
function pendingState(project: Scope, item: AuthoredItem): 'landed' | 'absent' | 'mismatch' {
  const at = join(project.bowerloom, itemPath(item.kind, item.id));
  if (lstatOrNull(at) === null) return 'absent';
  try {
    if (item.kind === 'prompt' || item.kind === 'slice') {
      const bytes = readGuarded(at, LIMITS.fileBytes, (item.kind === 'prompt' ? stagedPrompt : stagedSlice)(project.bowerloom, item));
      return samePins([{ path: item.files[0]!.path, sha256: sha256(bytes), bytes: bytes.length }], item.files) ? 'landed' : 'mismatch';
    }
    return samePins(readTree(project.bowerloom, itemPath(item.kind, item.id)), item.files) ? 'landed' : 'mismatch';
  } catch { return 'mismatch'; }
}

function localEntry(id: string, teams: readonly string[]): Entry { return { id, ...(teams.length ? { teams: [...teams] } : {}), source: { kind: 'local', path: `skills/${id}` } } as Entry; }
function currentManifest(project: Scope): { manifest: Manifest | null; read: Read | null } {
  const target = targetOf(project), state = readManifestState(target, { allowAbsent: project.kind === 'store' || !project.exists });
  return state.file ? { manifest: parseManifest(state.file.bytes, target.limits), read: { sha256: state.file.sha256, bytes: state.file.bytes.length } } : { manifest: null, read: null };
}
/** One skills.json step: M3's addLocalEntry on the bytes before it. Pure: it reads and writes nothing. */
function manifestStep(current: { manifest: Manifest | null; read: Read | null }, id: string, teams: readonly string[], limits: ManifestLimits): { step: ManifestStep; next: { manifest: Manifest; read: Read } } {
  const manifest = addLocalEntry(current.manifest, id, [...teams], limits), text = serializeManifest(manifest, limits);
  const after = { sha256: sha256(text), bytes: Buffer.byteLength(text) };
  return { step: { id, teams: [...teams], before: current.read, after }, next: { manifest, read: after } };
}

/** Teams that exist: first-team when its folder is real (a project only), or a registered team whose folder is real. */
function requireTeams(project: Scope, teams: readonly string[], registered: readonly AuthoredItem[], allowFirstTeam: boolean): void {
  for (const team of teams) {
    ensure(isId(team), 'TEAM_NOT_FOUND');
    ensure((allowFirstTeam && team === FIRST_TEAM) || registered.some(i => i.kind === 'team' && i.id === team), 'TEAM_NOT_FOUND');
    const s = lstatOrNull(join(project.bowerloom, 'teams', team));
    ensure(s !== null && s.isDirectory() && !s.isSymbolicLink(), 'TEAM_NOT_FOUND');
  }
}

async function plan(input: Normalized, created = false): Promise<CreatePlan> {
  checkName(input);
  const project = openScope(input), isStore = project.kind === 'store';
  if (!isStore) ensure(lstatOrNull(join(project.dir, '.bowerloom-revision.json')) === null, 'REVISION_PENDING');
  const state: AuthoringState = isStore && !project.exists ? { folder: false, receipt: null, pending: null, scratch: [] } : readAuthoringState(project.bowerloom);
  const receiptItems = state.receipt?.value.items ?? [];
  let discard: AuthoredItem | null = null, finish: AuthoredItem | null = null, settled: AuthoredItem | null = null;
  if (state.pending) {
    const pending = state.pending.value.item, registeredAs = receiptItems.find(i => sameItem(i, pending));
    // A kill after the receipt and before the pending record's removal: the record goes only when it names the very
    // item the receipt registered (same pins, teams and plan revision).
    if (registeredAs) { ensure(canonicalJson(registeredAs) === canonicalJson(pending), 'AUTHORING_PENDING'); settled = pending; }
    else {
      const landed = pendingState(project, pending);
      ensure(landed !== 'mismatch', 'AUTHORING_PENDING');
      if (landed === 'absent') discard = pending; else finish = pending;
    }
  }
  const registered = finish ? [...receiptItems, finish] : receiptItems;
  const request = { kind: input.kind, id: input.name };
  const isFinish = finish !== null && sameItem(finish, request);
  const parentFolder = input.kind === 'team' ? 'teams' : input.kind === 'skill' ? 'skills' : input.kind === 'slice' ? 'slices' : 'prompts';
  const parentRead = lstatOrNull(join(project.bowerloom, parentFolder));
  if (parentRead !== null) realFolder(join(project.bowerloom, parentFolder));
  // Review finding 1: `prompt create <id>` for a registered prompt whose file is gone restores it, with the
  // teams and the exact bytes the receipt records. Anything else about that id refuses, as it did before.
  const registeredPrompt = input.kind === 'prompt' && !isFinish ? receiptItems.find(i => sameItem(i, request)) ?? null : null;
  let restore: AuthoredItem | null = null;
  if (registeredPrompt && lstatOrNull(join(project.bowerloom, itemPath('prompt', input.name))) === null) {
    if (parentRead !== null) ensure(!folderNames(join(project.bowerloom, 'prompts')).some(n => n.normalize('NFC').toLowerCase() === `${input.name}.md`), 'PROMPT_EXISTS');
    ensure(input.teams.length === 0 || canonicalJson(input.teams) === canonicalJson(registeredPrompt.teams), 'PROMPT_RESTORE_TEAMS');
    ensure(samePins(pinsOf([planned(itemPath('prompt', input.name), PROMPT_TEXT(input.name))]), registeredPrompt.files), 'PROMPT_RESTORE_UNAVAILABLE');
    restore = registeredPrompt;
  }

  let brief: Read | null = null, manifestRead: Read | null = null, manifest: CreatePlan['manifest'] = null, compiledCandidate: string | null = null;
  let files: PlannedFile[] = [], register: CreatePlan['register'] = null, slice: CreatePlan['slice'] = null;
  if (input.kind === 'slice' && !isFinish) {
    // Rules 3 to 7 of the slice create: a registered slice, a skill the index would replace, a name that differs in case, a file already there.
    const file = join(project.bowerloom, itemPath('slice', input.name)), present = lstatOrNull(file) !== null;
    if (receiptItems.some(i => sameItem(i, request))) { ensure(present, 'AUTHORING_ITEM_MISSING'); refuse('SLICE_EXISTS'); }
    ensure(lstatOrNull(join(project.bowerloom, 'skills', `slice-${input.name}`)) === null, 'SLICE_EXISTS');
    const manifestNow = currentManifest(project); manifestRead = manifestNow.read;
    ensure(!manifestNow.manifest?.skills.some(s => s.id === `slice-${input.name}`), 'SLICE_EXISTS');
    if (parentRead !== null) ensure(!folderNames(join(project.bowerloom, 'slices')).some(n => n !== `${input.name}.yaml` && n.normalize('NFC').toLowerCase() === `${input.name}.yaml`), 'SLICE_EXISTS');
    if (present) {
      const bytes = readGuarded(file, LIMITS.fileBytes);
      let text: string; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return refuse('SLICE_INVALID', 'the file is not valid UTF-8'); }
      const parsed = parseSlice(text, input.name);
      if (!parsed.ok) return refuse('SLICE_INVALID', `${parsed.detail}.`);
      ensure(input.root === null && input.includes === null, 'USAGE');
      register = { kind: 'slice', id: input.name, teams: [], files: [{ path: itemPath('slice', input.name), sha256: sha256(bytes), bytes: bytes.length }] };
    } else slice = { root: input.root ?? DEFAULT_ROOT, includes: input.includes ?? DEFAULT_INCLUDES };
  }
  const folders: string[] = [];
  const parent = parentFolder, parentStat = parentRead;

  const steps: ManifestStep[] = [];
  let current: { manifest: Manifest | null; read: Read | null } = { manifest: null, read: null };
  if (input.kind === 'skill' || finish?.kind === 'skill') {
    current = currentManifest(project); manifestRead = current.read;
    if (finish?.kind === 'skill') {
      const entry = current.manifest?.skills.find(s => s.id === finish!.id);
      if (entry) ensure(canonicalJson(entry) === canonicalJson(localEntry(finish.id, finish.teams)), 'AUTHORING_PENDING');
      else { const next = manifestStep(current, finish.id, finish.teams, targetOf(project).limits); steps.push(next.step); current = next.next; }
    }
    if (input.kind === 'skill' && !isFinish) ensure(!current.manifest?.skills.some(s => s.id === input.name), 'SKILL_EXISTS');
  }
  if (restore) {
    if (parentStat === null) folders.push(parent);
    files = [planned(itemPath('prompt', restore.id), PROMPT_TEXT(restore.id))];
  } else if (input.kind === 'slice' && !isFinish) {
    if (!state.folder) folders.push(AUTHORING_FOLDER);
    if (register === null && parentStat === null) folders.push(parent);
    if (slice !== null) files = [planned(itemPath('slice', input.name), sliceTemplate({ root: slice.root, includes: slice.includes }))];
  } else if (!isFinish) {
    if (input.copyFrom !== null) ensure(!registered.some(i => sameItem(i, request)) && lstatOrNull(join(project.bowerloom, itemPath('team', input.name))) === null, 'TEAM_EXISTS');
    const exists = input.kind === 'team' ? 'TEAM_EXISTS' : input.kind === 'skill' ? 'SKILL_EXISTS' : 'PROMPT_EXISTS';
    ensure(!registered.some(i => sameItem(i, request)), exists);
    if (input.kind === 'prompt') { if (parentStat !== null) ensure(!folderNames(join(project.bowerloom, 'prompts')).some(n => n.normalize('NFC').toLowerCase() === `${input.name}.md`), exists); }
    else ensure(lstatOrNull(join(project.bowerloom, itemPath(input.kind, input.name))) === null, exists);
    requireTeams(project, input.teams, registered, !isStore);
    if (!state.folder) folders.push(AUTHORING_FOLDER);
    if (parentStat === null) folders.push(parent);
    if (input.kind === 'team' && input.copyFrom !== null) {
      // Spec 06, 3.17: the files of the source team, read with the authoring guards, and its compiled candidate.
      const root = input.copyFrom.root, rel = itemPath('team', input.name);
      // Round 2 of the reviews of PR 100, S1: the teams folder of the source is a real folder inside it, never a link out.
      const area = join(root, 'teams'), areaStat = lstatOrNull(area);
      let inside = false;
      try { inside = areaStat !== null && areaStat.isDirectory() && !areaStat.isSymbolicLink() && fs.realpathSync(area) === join(fs.realpathSync(root), 'teams'); } catch { inside = false; }
      ensure(inside, 'AUTHORING_UNSAFE_PATH');
      files = readTree(root, rel).map(pin => planned(pin.path, readGuarded(join(root, pin.path), LIMITS.fileBytes).toString('utf8')));
      compiledCandidate = (await compileCrew(join(root, rel, 'team.yaml'))).candidateRevision;
    } else if (input.kind === 'team') {
      let team: ReturnType<typeof scaffoldTeam>;
      if (isStore) team = scaffoldTeam(storeBrief(input.profile ?? undefined), input.name, input.name);
      // Spec 06, 3.8: a project with a config and no brief.json uses the store brief.
      else if (lstatOrNull(join(project.bowerloom, 'brief.json')) === null && configText(project.dir) !== null) team = scaffoldTeam(storeBrief(input.profile ?? undefined), input.name, input.name);
      else {
        const read = readBrief(project); brief = read.read;
        // Review M6 finding 3: up --team matches first-team by id or display name, so a team with that name could never
        // be prepared. Refused here, where the name is chosen.
        ensure(read.brief.teamName !== input.name, 'TEAM_NAME_TAKEN');
        team = scaffoldTeam({ ...read.brief, profile: input.profile ?? read.brief.profile ?? 'engineer' }, input.name, input.name);
      }
      files = team.files.map(f => planned(f.path, f.text)); compiledCandidate = team.compiled.candidateRevision;
    } else if (input.kind === 'skill') {
      files = [planned(`skills/${input.name}/SKILL.md`, SKILL_TEXT(input.name))];
      steps.push(manifestStep(current, input.name, input.teams, targetOf(project).limits).step);
    } else files = [planned(`prompts/${input.name}.md`, PROMPT_TEXT(input.name))];
  }
  if (steps.length) manifest = { before: steps[0]!.before, after: steps[steps.length - 1]!.after, steps };
  // Spec 06, 3.8: the config step, for the new item and for a pending item this plan finishes. Never for team adopt, a
  // restore, or an id the config lists from the store (the finish path skips that one).
  let config = null as CreatePlan['config'];
  if (!isStore) {
    const ids: [ItemKind, string][] = [];
    if (finish && !finishListedFromStore(project.dir, finish.kind, finish.id)) ids.push([finish.kind, finish.id]);
    if (!isFinish && !restore && input.copyFrom === null) ids.push([input.kind, input.name]);
    for (const [k, i] of ids) {
      const step = configStep(project.dir, k, i, config?.text);
      if (step !== null) config = { before: config?.before ?? step.before, after: step.after, text: step.text };
    }
    if (config !== null && config.before !== null && config.before.sha256 === config.after.sha256) config = null;
  }
  const configRead = isStore ? null : (() => { const b = configText(project.dir); return b === null ? null : { sha256: sha256(b), bytes: b.length }; })();
  const body: Omit<CreatePlan, 'revision'> = {
    format: AUTHORING_PLAN_FORMAT, project: project.dir, scope: project.kind, storeCreate: isStore && (!project.exists || created), bowerloom: project.identity,
    bowerloomFolder: !isStore && !project.exists ? 'create' : 'present',
    input: { kind: input.kind, name: input.name, teams: input.teams, profile: isStore ? (input.profile ?? 'engineer') : input.profile },
    reads: { brief, receipt: state.receipt?.read ?? null, pending: state.pending?.read ?? null, manifest: manifestRead, config: configRead }, config,
    ...(input.copyFrom !== null ? { copyFrom: { ...input.copyFrom } } : {}),
    scratch: state.scratch, discard, settled, finish,
    slice, register,
    item: isFinish || restore || register ? null : { kind: input.kind, id: input.name, teams: input.teams, files: pinsOf(files) },
    compiledCandidate, files, folders, manifest, writesAuthorized: false, executionAuthorized: false,
    ...(restore ? { restore } : {}),
  };
  return { ...body, revision: sha256(canonicalJson(body)) };
}

/** Plans one create. It reads only and writes nothing. */
export async function planCreate(input: CreateInput): Promise<CreatePlan> { return plan(normalizeInput(input)); }

/**
 * Applies the approved plan. `held` must be the live lock of this project (withProjectLock). Plans again first and
 * refuses with STALE_APPROVAL unless the revision is the approved one. Returns the authoring receipt it wrote.
 */
export async function applyCreate(input: CreateInput, revision: string, held: HeldProjectLock, store?: { context: StoreContext; created: boolean }, context?: ProjectContext, onProject?: (project: ProjectContext) => void): Promise<AuthoringReceipt> {
  if (!isHeldProjectLock(held)) refuse('PROJECT_LOCKED');
  const normalized = normalizeInput(input);
  // The store scope never creates the store: its caller (withStoreForWrite) did, and says so in `store.created`.
  ensure((normalized.scope === 'store') === (store !== undefined), 'USAGE');
  ensure(store === undefined || store.context.dir === normalized.project, 'USAGE');
  try { held.assertHeld(normalized.project); } catch { refuse('PROJECT_LOCKED'); }
  ensure(isRevision(revision), 'STALE_APPROVAL');
  const p = await plan(normalized, store?.created ?? false);
  ensure(p.revision === revision, 'STALE_APPROVAL');
  const project: Scope = { kind: p.scope, dir: p.project, bowerloom: p.scope === 'store' ? p.project : join(p.project, '.bowerloom'), identity: p.bowerloom, exists: true };
  // Spec 06, 3.4 and 3.8: a config-only project gets `.bowerloom` first, as the create's first write.
  if (p.bowerloomFolder === 'create') {
    ensure(context !== undefined && context.dir === p.project && context.bowerloomIdentity === null, 'USAGE');
    const made = createBowerloomFolder(context, held); onProject?.(made);
    project.identity = { device: made.bowerloomIdentity!.device, inode: made.bowerloomIdentity!.inode };
  }
  const auth = join(project.bowerloom, AUTHORING_FOLDER);
  const live = (): void => {
    try { held.assertHeld(project.dir); } catch { refuse('PROJECT_LOCKED'); }
    if (store !== undefined) verifyStorePins(store.context); else sameBowerloom(project);
  };
  let receiptRead = p.reads.receipt, items = readAuthoringState(project.bowerloom).receipt?.value.items ?? [];

  // Spec 08, 4.4: the shared receipt writer.
  const writeReceipt = (next: readonly AuthoredItem[]): void => {
    receiptRead = writeReceiptRecord(auth, p.revision, receiptRead, next, live, () => readAuthoringState(project.bowerloom).receipt?.read ?? null);
    items = receiptOf(next).items;
  };
  const removePending = (expected: string): void => {
    live();
    const at = join(auth, PENDING);
    ensure(sha256(readGuarded(at, LIMITS.recordBytes)) === expected, 'STALE_APPROVAL');
    fs.unlinkSync(at); syncFolder(auth);
  };
  const writePending = (item: AuthoredItem): string => {
    const record = recordText(pendingOf(item)), temp = join(auth, tempName(p.revision, 'pending'));
    writeNewFile(temp, record);
    try { live(); try { fs.linkSync(temp, join(auth, PENDING)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') refuse('AUTHORING_PENDING'); throw e; } }
    finally { if (lstatOrNull(temp) !== null) fs.unlinkSync(temp); }
    syncFolder(auth); return sha256(record);
  };
  // M3's change plan, made now under the lock, must carry exactly the bytes this plan bound before and after the step.
  const writeManifest = (id: string): void => {
    live();
    const step = p.manifest?.steps.find(s => s.id === id);
    ensure(step !== undefined, 'STALE_APPROVAL');
    const change = planManifestChange(targetOf(project), { add: localEntry(step.id, step.teams) }, { storeCreate: false });
    ensure((change.before?.sha256 ?? null) === (step.before?.sha256 ?? null) && change.after.sha256 === step.after.sha256 && change.after.bytes === step.after.bytes, 'STALE_APPROVAL');
    applyManifestChange(change, change.revision, held);
  };

  // Spec 06, 3.8: bowerloom.json, after the item and its skills.json entry and before the receipt. Written once.
  let configWritten = p.config === null;
  const writeConfig = (): void => {
    if (configWritten || p.config === null) return;
    live();
    writeGuardedFile(project.dir, CONFIG_FILE, p.config.text, p.config.before?.sha256 ?? null, held, `.${CONFIG_FILE}`);
    configWritten = true;
  };
  // Review M2 finding 4: once anything is written, a stale plan is no longer "nothing applied".
  let wrote = p.bowerloomFolder === 'create';
  try {
  // 1. Bowerloom's own scratch from an interrupted run.
  if (p.scratch.length) { live(); wrote = true; for (const name of p.scratch) removeScratch(join(auth, name)); syncFolder(auth); }
  // 2. The pending record: clear it, or finish its item.
  if (p.discard || p.settled) { wrote = true; removePending(p.reads.pending!.sha256); }
  if (p.finish) {
    const finish = p.finish;
    live(); ensure(pendingState(project, finish) === 'landed', 'STALE_APPROVAL'); wrote = true;
    if (finish.kind === 'prompt' || finish.kind === 'slice') readGuarded(join(project.bowerloom, itemPath(finish.kind, finish.id)), LIMITS.fileBytes);
    if (finish.kind === 'skill' && p.manifest?.steps.some(s => s.id === finish.id)) writeManifest(finish.id);
    writeConfig();
    writeReceipt([...items, finish]);
    removePending(p.reads.pending!.sha256);
  }
  // 3. The new item, or the registered prompt this plan restores (its receipt entry stays as it is).
  if (p.register) {
    // The file is already there. Check that it still has the planned bytes, then write the receipt. No pending record: no file moves.
    const reg = p.register, at = join(project.bowerloom, reg.files[0]!.path);
    live(); const bytes = readGuarded(at, LIMITS.fileBytes);
    ensure(sha256(bytes) === reg.files[0]!.sha256 && bytes.length === reg.files[0]!.bytes, 'STALE_APPROVAL');
    for (const folder of p.folders) { live(); wrote = true; makeFolder(join(project.bowerloom, folder)); }
    if (p.folders.length) syncFolder(project.bowerloom);
    wrote = true; writeReceipt([...items, { ...reg, planRevision: p.revision }]);
  }
  const placed: AuthoredItem | null = p.item ? { ...p.item, planRevision: p.revision } : p.restore ?? null;
  if (placed) {
    const item = placed;
    if (p.restore) ensure(samePins(pinsOf(p.files), item.files), 'STALE_APPROVAL');
    for (const folder of p.folders) { live(); wrote = true; makeFolder(join(project.bowerloom, folder)); }
    if (p.folders.length) syncFolder(project.bowerloom);
    wrote = true; const pendingSha = writePending(item);
    const stage = join(auth, stageName(p.revision));
    live(); makeFolder(stage);
    for (const file of p.files) {
      const segments = file.path.split('/');
      for (let i = 1; i < segments.length; i++) { const folder = join(stage, ...segments.slice(0, i)); if (lstatOrNull(folder) === null) makeFolder(folder); }
      writeNewFile(join(stage, file.path), file.text);
    }
    if (item.kind === 'team') {
      const compiled = await compileCrew(join(stage, 'teams', item.id, 'team.yaml'));
      ensure(compiled.candidateRevision === p.compiledCandidate, 'STALE_APPROVAL');
    }
    const from = join(stage, itemPath(item.kind, item.id)), to = join(project.bowerloom, itemPath(item.kind, item.id));
    const parentFolder = join(project.bowerloom, item.kind === 'team' ? 'teams' : item.kind === 'skill' ? 'skills' : item.kind === 'slice' ? 'slices' : 'prompts');
    live(); realFolder(parentFolder); ensure(lstatOrNull(to) === null, 'STALE_APPROVAL');
    if (item.kind === 'prompt' || item.kind === 'slice') {
      try { fs.linkSync(from, to); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') refuse('STALE_APPROVAL'); throw e; }
      fs.unlinkSync(from);
    } else fs.renameSync(from, to);
    syncFolder(parentFolder);
    removeScratch(stage); syncFolder(auth);
    if (item.kind === 'skill') writeManifest(item.id);
    writeConfig();
    if (p.item) writeReceipt([...items, item]);
    removePending(pendingSha);
  }
  } catch (error) { const failed = (error as { code?: unknown })?.code; if (wrote && (failed === 'STALE_APPROVAL' || failed === 'PROJECT_LOCKED')) refuse('AUTHORING_WRITE_INTERRUPTED'); throw error; }
  live();
  return receiptOf(items);
}
