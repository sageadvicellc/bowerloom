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
import { isAbsolute, join, resolve } from 'node:path';
import { canonicalJson } from '../../contracts/src/index.js';
import { compileCrew } from '../../crew/src/index.js';
import { isHeldProjectLock } from '../../project-context/src/index.js';
import type { HeldProjectLock } from '../../project-context/src/types.js';
import { startupInternals, startupProfiles } from '../../startup/src/index.js';
import type { StartupProfile } from '../../startup/src/index.js';
import { scaffoldTeam } from '../../startup/src/scaffold.js';
import { addLocalEntry, applyManifestChange, planManifestChange, readManifestState } from '../../skill-manifest/src/add.js';
import { parseManifest, serializeManifest } from '../../skill-manifest/src/schema.js';
import type { Entry, Manifest } from '../../skill-manifest/src/schema.js';
import { LIMITS, folderNames, lstatOrNull, makeFolder, readGuarded, readTree, realFolder, removeScratch, sha256, syncFolder, writeNewFile } from './files.js';
import type { FilePin } from './files.js';
import { ensure, refuse } from './refusal.js';
import { AUTHORING_FOLDER, FIRST_TEAM, PENDING, RECEIPT, isId, isPromptId, isRevision, isSkillId, isTeamId, itemPath, pendingOf, readAuthoringState, receiptOf, recordText, sameItem, stageName, tempName } from './state.js';
import type { AuthoredItem, AuthoringReceipt, AuthoringState, ItemKind, Read } from './state.js';

export const AUTHORING_PLAN_FORMAT = 'bowerloom/authoring-plan/v1beta1' as const;

export type CreateInput =
  | { kind: 'team'; project: string; name: string; profile?: StartupProfile }
  | { kind: 'skill' | 'prompt'; project: string; name: string; teams: string[] };

export interface ManifestStep { id: string; teams: string[]; before: Read | null; after: Read }
export interface PlannedFile { path: string; text: string; sha256: string; bytes: number }
export interface CreatePlan {
  format: typeof AUTHORING_PLAN_FORMAT;
  /** Real absolute path of the project folder. */
  project: string;
  /** The device and inode of `.bowerloom`, as decimal strings. */
  bowerloom: { device: string; inode: string };
  input: { kind: ItemKind; name: string; teams: string[]; profile: StartupProfile | null };
  /** The sha256 and size of every record this plan read, or null when it was absent or not read. */
  reads: { brief: Read | null; receipt: Read | null; pending: Read | null; manifest: Read | null };
  /** Bowerloom's own scratch names in `.bowerloom/authoring` that apply removes first. */
  scratch: string[];
  /** A pending item that never landed: apply removes its record. */
  discard: AuthoredItem | null;
  /** Review M2 finding 2: an item already registered, exactly as its leftover pending record names it. The record goes. */
  settled: AuthoredItem | null;
  /** A pending item that landed with exactly its recorded bytes: apply registers it. */
  finish: AuthoredItem | null;
  /** The new item, or null when the request is the pending item this plan finishes or a prompt it restores. */
  item: { kind: ItemKind; id: string; teams: string[]; files: FilePin[] } | null;
  /**
   * Freeze review finding 1: a registered prompt whose file is gone, written again with its recorded bytes. The receipt
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

interface Normalized { kind: ItemKind; project: string; name: string; teams: string[]; profile: StartupProfile | null }
const usage = (): never => refuse('USAGE');
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function normalizeInput(input: unknown): Normalized {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return usage();
  const v = input as Record<string, unknown>, keys = Object.keys(v);
  const kind = v.kind;
  if (kind !== 'team' && kind !== 'skill' && kind !== 'prompt') return usage();
  const allowed = kind === 'team' ? ['kind', 'project', 'name', 'profile'] : ['kind', 'project', 'name', 'teams'];
  if (!keys.every(k => allowed.includes(k)) || !['kind', 'project', 'name', ...(kind === 'team' ? [] : ['teams'])].every(k => Object.hasOwn(v, k))) return usage();
  const project = v.project;
  if (typeof project !== 'string' || !isAbsolute(project) || resolve(project) !== project || project.includes('\0') || typeof v.name !== 'string') return usage();
  let profile: StartupProfile | null = null;
  if (kind === 'team' && v.profile !== undefined) { if (typeof v.profile !== 'string' || !Object.hasOwn(startupProfiles, v.profile)) return usage(); profile = v.profile as StartupProfile; }
  let teams: string[] = [];
  if (kind !== 'team') {
    if (!Array.isArray(v.teams) || v.teams.length > 32 || !v.teams.every(t => typeof t === 'string') || new Set(v.teams).size !== v.teams.length) return usage();
    teams = [...v.teams as string[]].sort(compare);
  }
  return { kind, project, name: v.name, teams, profile };
}
function checkName(input: Normalized): void {
  const { kind, name } = input;
  if (kind === 'team') { ensure(name !== FIRST_TEAM, 'TEAM_ID_RESERVED'); ensure(isTeamId(name), 'TEAM_NAME_INVALID'); }
  else if (kind === 'skill') { ensure(isId(name), 'SKILL_NAME_INVALID'); ensure(isSkillId(name), 'SKILL_NAME_RESERVED'); }
  else ensure(isPromptId(name), 'PROMPT_NAME_INVALID');
}

interface Project { dir: string; bowerloom: string; identity: { device: string; inode: string } }
function openProject(dir: string): Project {
  let real: string; try { real = fs.realpathSync(dir); } catch { return refuse('AUTHORING_UNSAFE_PATH'); }
  ensure(real === dir, 'AUTHORING_UNSAFE_PATH');
  const bowerloom = join(dir, '.bowerloom'), s = realFolder(bowerloom);
  return { dir, bowerloom, identity: { device: String(s.dev), inode: String(s.ino) } };
}
function sameBowerloom(project: Project): void {
  const s = realFolder(project.bowerloom);
  if (String(s.dev) !== project.identity.device || String(s.ino) !== project.identity.inode) refuse('STALE_APPROVAL');
}

// The brief record that scaffold() writes to brief.json. Team create reads it directly, with the guards.
const BRIEF_KEYS = ['format', 'projectName', 'goal', 'assistantName', 'teamName', 'reviewMode', 'profile', 'origin', 'generation', 'reviewRequired', 'executionAuthorized'];
function readBrief(project: Project): { brief: ReturnType<typeof startupInternals.normalize>['brief']; read: Read } {
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
const planned = (path: string, text: string): PlannedFile => ({ path, text, sha256: sha256(text), bytes: Buffer.byteLength(text) });
const pinsOf = (files: readonly PlannedFile[]): FilePin[] => files.map(({ path, sha256: digest, bytes }) => ({ path, sha256: digest, bytes }));
const samePins = (a: readonly FilePin[], b: readonly FilePin[]): boolean => canonicalJson(a) === canonicalJson(b);

/** Where an interrupted prompt's stage copy sits: the one path whose second link to the prompt is expected. */
const stagedPrompt = (bowerloom: string, item: { id: string; planRevision: string }): string => join(bowerloom, AUTHORING_FOLDER, stageName(item.planRevision), 'prompts', `${item.id}.md`);
/** 'landed' when the pending item is in place with exactly its recorded bytes, 'absent' when nothing is there. */
function pendingState(project: Project, item: AuthoredItem): 'landed' | 'absent' | 'mismatch' {
  const at = join(project.bowerloom, itemPath(item.kind, item.id));
  if (lstatOrNull(at) === null) return 'absent';
  try {
    if (item.kind === 'prompt') {
      const bytes = readGuarded(at, LIMITS.fileBytes, stagedPrompt(project.bowerloom, item));
      return samePins([{ path: item.files[0]!.path, sha256: sha256(bytes), bytes: bytes.length }], item.files) ? 'landed' : 'mismatch';
    }
    return samePins(readTree(project.bowerloom, itemPath(item.kind, item.id)), item.files) ? 'landed' : 'mismatch';
  } catch { return 'mismatch'; }
}

function localEntry(id: string, teams: readonly string[]): Entry { return { id, ...(teams.length ? { teams: [...teams] } : {}), source: { kind: 'local', path: `skills/${id}` } } as Entry; }
function currentManifest(project: Project): { manifest: Manifest | null; read: Read | null } {
  const state = readManifestState(project.dir);
  return state.file ? { manifest: parseManifest(state.file.bytes), read: { sha256: state.file.sha256, bytes: state.file.bytes.length } } : { manifest: null, read: null };
}
/** One skills.json step: M3's addLocalEntry on the bytes before it. Pure: it reads and writes nothing. */
function manifestStep(current: { manifest: Manifest | null; read: Read | null }, id: string, teams: readonly string[]): { step: ManifestStep; next: { manifest: Manifest; read: Read } } {
  const manifest = addLocalEntry(current.manifest, id, [...teams]), text = serializeManifest(manifest);
  const after = { sha256: sha256(text), bytes: Buffer.byteLength(text) };
  return { step: { id, teams: [...teams], before: current.read, after }, next: { manifest, read: after } };
}

/** Teams that exist: first-team when its folder is real, or a registered team whose folder is real. */
function requireTeams(project: Project, teams: readonly string[], registered: readonly AuthoredItem[]): void {
  for (const team of teams) {
    ensure(isId(team), 'TEAM_NOT_FOUND');
    ensure(team === FIRST_TEAM || registered.some(i => i.kind === 'team' && i.id === team), 'TEAM_NOT_FOUND');
    const s = lstatOrNull(join(project.bowerloom, 'teams', team));
    ensure(s !== null && s.isDirectory() && !s.isSymbolicLink(), 'TEAM_NOT_FOUND');
  }
}

async function plan(input: Normalized): Promise<CreatePlan> {
  checkName(input);
  const project = openProject(input.project);
  ensure(lstatOrNull(join(project.dir, '.bowerloom-revision.json')) === null, 'REVISION_PENDING');
  const state: AuthoringState = readAuthoringState(project.bowerloom);
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
  const parentFolder = input.kind === 'team' ? 'teams' : input.kind === 'skill' ? 'skills' : 'prompts';
  const parentRead = lstatOrNull(join(project.bowerloom, parentFolder));
  if (parentRead !== null) realFolder(join(project.bowerloom, parentFolder));
  // Freeze review finding 1: `prompt create <id>` for a registered prompt whose file is gone restores it, with the
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
  let files: PlannedFile[] = [];
  const folders: string[] = [];
  const parent = parentFolder, parentStat = parentRead;

  const steps: ManifestStep[] = [];
  let current: { manifest: Manifest | null; read: Read | null } = { manifest: null, read: null };
  if (input.kind === 'skill' || finish?.kind === 'skill') {
    current = currentManifest(project); manifestRead = current.read;
    if (finish?.kind === 'skill') {
      const entry = current.manifest?.skills.find(s => s.id === finish!.id);
      if (entry) ensure(canonicalJson(entry) === canonicalJson(localEntry(finish.id, finish.teams)), 'AUTHORING_PENDING');
      else { const next = manifestStep(current, finish.id, finish.teams); steps.push(next.step); current = next.next; }
    }
    if (input.kind === 'skill' && !isFinish) ensure(!current.manifest?.skills.some(s => s.id === input.name), 'SKILL_EXISTS');
  }
  if (restore) {
    if (parentStat === null) folders.push(parent);
    files = [planned(itemPath('prompt', restore.id), PROMPT_TEXT(restore.id))];
  } else if (!isFinish) {
    const exists = input.kind === 'team' ? 'TEAM_EXISTS' : input.kind === 'skill' ? 'SKILL_EXISTS' : 'PROMPT_EXISTS';
    ensure(!registered.some(i => sameItem(i, request)), exists);
    if (input.kind === 'prompt') { if (parentStat !== null) ensure(!folderNames(join(project.bowerloom, 'prompts')).some(n => n.normalize('NFC').toLowerCase() === `${input.name}.md`), exists); }
    else ensure(lstatOrNull(join(project.bowerloom, itemPath(input.kind, input.name))) === null, exists);
    requireTeams(project, input.teams, registered);
    if (!state.folder) folders.push(AUTHORING_FOLDER);
    if (parentStat === null) folders.push(parent);
    if (input.kind === 'team') {
      const read = readBrief(project); brief = read.read;
      // Review M6 finding 3: up --team matches first-team by id or display name, so a team with that name could never
      // be prepared. Refused here, where the name is chosen.
      ensure(read.brief.teamName !== input.name, 'TEAM_NAME_TAKEN');
      const team = scaffoldTeam({ ...read.brief, profile: input.profile ?? read.brief.profile ?? 'engineer' }, input.name, input.name);
      files = team.files.map(f => planned(f.path, f.text)); compiledCandidate = team.compiled.candidateRevision;
    } else if (input.kind === 'skill') {
      files = [planned(`skills/${input.name}/SKILL.md`, SKILL_TEXT(input.name))];
      steps.push(manifestStep(current, input.name, input.teams).step);
    } else files = [planned(`prompts/${input.name}.md`, PROMPT_TEXT(input.name))];
  }
  if (steps.length) manifest = { before: steps[0]!.before, after: steps[steps.length - 1]!.after, steps };
  const body: Omit<CreatePlan, 'revision'> = {
    format: AUTHORING_PLAN_FORMAT, project: project.dir, bowerloom: project.identity,
    input: { kind: input.kind, name: input.name, teams: input.teams, profile: input.profile },
    reads: { brief, receipt: state.receipt?.read ?? null, pending: state.pending?.read ?? null, manifest: manifestRead },
    scratch: state.scratch, discard, settled, finish,
    item: isFinish || restore ? null : { kind: input.kind, id: input.name, teams: input.teams, files: pinsOf(files) },
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
export async function applyCreate(input: CreateInput, revision: string, held: HeldProjectLock): Promise<AuthoringReceipt> {
  if (!isHeldProjectLock(held)) refuse('PROJECT_LOCKED');
  const normalized = normalizeInput(input);
  try { held.assertHeld(normalized.project); } catch { refuse('PROJECT_LOCKED'); }
  ensure(isRevision(revision), 'STALE_APPROVAL');
  const p = await plan(normalized);
  ensure(p.revision === revision, 'STALE_APPROVAL');
  const project: Project = { dir: p.project, bowerloom: join(p.project, '.bowerloom'), identity: p.bowerloom };
  const auth = join(project.bowerloom, AUTHORING_FOLDER);
  const live = (): void => { try { held.assertHeld(project.dir); } catch { refuse('PROJECT_LOCKED'); } sameBowerloom(project); };
  let receiptRead = p.reads.receipt, items = readAuthoringState(project.bowerloom).receipt?.value.items ?? [];

  const writeReceipt = (next: readonly AuthoredItem[]): void => {
    const receipt = receiptOf(next), temp = join(auth, tempName(p.revision, 'receipt')), target = join(auth, RECEIPT);
    writeNewFile(temp, recordText(receipt));
    try {
      live();
      const now = readAuthoringState(project.bowerloom).receipt?.read ?? null;
      ensure((now?.sha256 ?? null) === (receiptRead?.sha256 ?? null), 'STALE_APPROVAL');
      if (receiptRead === null) { try { fs.linkSync(temp, target); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') refuse('STALE_APPROVAL'); throw e; } fs.unlinkSync(temp); }
      else fs.renameSync(temp, target);
    } finally { if (lstatOrNull(temp) !== null) fs.unlinkSync(temp); }
    syncFolder(auth);
    const text = recordText(receipt); receiptRead = { sha256: sha256(text), bytes: Buffer.byteLength(text) }; items = receipt.items;
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
    const change = planManifestChange(project.dir, { add: localEntry(step.id, step.teams) });
    ensure((change.before?.sha256 ?? null) === (step.before?.sha256 ?? null) && change.after.sha256 === step.after.sha256 && change.after.bytes === step.after.bytes, 'STALE_APPROVAL');
    applyManifestChange(change, change.revision, held);
  };

  // Review M2 finding 4: once anything is written, a stale plan is no longer "nothing applied".
  let wrote = false;
  try {
  // 1. Bowerloom's own scratch from an interrupted run.
  if (p.scratch.length) { live(); wrote = true; for (const name of p.scratch) removeScratch(join(auth, name)); syncFolder(auth); }
  // 2. The pending record: clear it, or finish its item.
  if (p.discard || p.settled) { wrote = true; removePending(p.reads.pending!.sha256); }
  if (p.finish) {
    const finish = p.finish;
    live(); ensure(pendingState(project, finish) === 'landed', 'STALE_APPROVAL'); wrote = true;
    if (finish.kind === 'prompt') readGuarded(join(project.bowerloom, itemPath('prompt', finish.id)), LIMITS.fileBytes);
    if (finish.kind === 'skill' && p.manifest?.steps.some(s => s.id === finish.id)) writeManifest(finish.id);
    writeReceipt([...items, finish]);
    removePending(p.reads.pending!.sha256);
  }
  // 3. The new item, or the registered prompt this plan restores (its receipt entry stays as it is).
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
    const parentFolder = join(project.bowerloom, item.kind === 'team' ? 'teams' : item.kind === 'skill' ? 'skills' : 'prompts');
    live(); realFolder(parentFolder); ensure(lstatOrNull(to) === null, 'STALE_APPROVAL');
    if (item.kind === 'prompt') {
      try { fs.linkSync(from, to); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') refuse('STALE_APPROVAL'); throw e; }
      fs.unlinkSync(from);
    } else fs.renameSync(from, to);
    syncFolder(parentFolder);
    removeScratch(stage); syncFolder(auth);
    if (item.kind === 'skill') writeManifest(item.id);
    if (p.item) writeReceipt([...items, item]);
    removePending(pendingSha);
  }
  } catch (error) { if (wrote && (error as { code?: unknown })?.code === 'STALE_APPROVAL') refuse('AUTHORING_WRITE_INTERRUPTED'); throw error; }
  live();
  return receiptOf(items);
}
