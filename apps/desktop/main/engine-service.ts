/**
 * The main-process side of adoption and the projection for the harness-first window (--prototype-v3-real). It is the only place the window's adopt and install
 * sheets reach the packages. It:
 *  - knows folders only by the id it handed out when the person chose the folder in the system chooser, so the window never names a path;
 *  - plans with the packages and hands back plain views (shared/engine/view.ts) with every path of the person written as `~` or the folder's label;
 *  - binds each consent to what the person read: an adoption approval or acknowledgement to a hash of its full content (U3), a fidelity approval to the
 *    line and the hash of its entry (U15), so a changed item is never covered by an earlier tick;
 *  - writes only the plan it returned last for that folder, with the same choices (U16), after its own native dialog says what will be written and the
 *    person says yes; then through the packages' apply calls, which plan again under the project lock and write only when the revision is the same;
 *  - runs one call at a time, in order;
 *  - keeps each folder's records in the private state layout the command line uses (packages/project-sync/src/harness-state.ts, decision 7B), moves the
 *    record of the earlier app there once when the folder is chosen, and shares the approval drafts of fidelity lines with the command line (D2A, D3A);
 *  - saves one folder's own harness (option C) from a closed list of edits by id, keeps save points before and after, and goes back to one, through the same
 *    gate (main/engine-save.ts). Install, removal, adoption and merge wait while a save is stopped;
 *  - knows notes folders (spec 6.9) only by the id it handed out, from its own notes chooser or from a source a harness records, and plans and writes
 *    "Start fresh" (the shipped kit's starter wiki) and version history for linked notes through the same gate, with packages/notes-source. Attaching
 *    notes to an agent, and adding the ready-made notes keeper from its kit (main/kit.ts), are save edits.
 * Nothing here writes a file itself. The handler takes its tools as arguments, so a test runs it on synthetic folders with no Electron.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { NotesRefusal, applyGitInit, applyStarter, planGitInit, planStarter, readNotesSummary } from '../../../packages/notes-source/src/index.js';
import type { NotesOptions } from '../../../packages/notes-source/src/index.js';
import {
  applyAdoption, applyAdoptionRecovery, applySave, planAdoptionRecovery, planSave as packagePlanSave, planSaveRecovery, refuseWhileSaveStopped, runSaveRecovery, saveStopped,
} from '../../../packages/adoption/src/index.js';
import {
  applyInstructionMerge, applyInstructionMergeRecovery, mergeStopped, planInstructionMerge, planInstructionMergeRecovery, refuseWhileStopped,
} from '../../../packages/adoption/src/merge.js';
import type { InstructionMergePlan } from '../../../packages/adoption/src/merge.js';
import type { AdoptionInput, AdoptionPlan, SavePlan } from '../../../packages/adoption/src/index.js';
import { planWithBytes as planAdoptionWithBytes } from '../../../packages/adoption/src/plan.js';
import { readJournal } from '../../../packages/adoption/src/journal.js';
import {
  applyPortable, applyPortableRecovery, applyPortableRemoval, planPortable, planPortableRecovery, planPortableRemoval, portableDrift, readPortableReceipt,
} from '../../../packages/project-sync/src/index.js';
import type { PortableInput } from '../../../packages/project-sync/src/index.js';
import { pendingExists } from '../../../packages/project-sync/src/portable-state.js';
import { planSetAsideVersions, readVersion, setAsideVersionsLocked } from '../../../packages/project-sync/src/index.js';
import { harnessStateDirs, settleLegacyState } from '../../../packages/project-sync/src/harness-state.js';
import type { HarnessStateDirs } from '../../../packages/project-sync/src/harness-state.js';
import { addApprovalDraftLocked, dropApprovalDraftsLocked, readApprovalDrafts } from '../../../packages/project-sync/src/harness-approvals.js';
import { entryHash, isId, loadDefinition, storedKnowledgePath } from '../../../packages/harness-definition/src/index.js';
import type { Definition, DefinitionFile, FidelityApproval } from '../../../packages/harness-definition/src/index.js';
import { checkProjectPath } from '../../../packages/project-context/src/index.js';
import { ANSWERS, NOTE_LIMIT } from '../../../packages/diagnostics/src/index.js';
import type { Answer as CheckAnswer } from '../../../packages/diagnostics/src/index.js';
import { labelOf, makeScrub, visible } from '../shared/engine/scrub.js';
import { KIT_IDS, KIT_INVALID, KIT_MAIN_WORDS, NOTES_MAIN_WORDS, NOTES_NOT_CHOSEN, NOTES_PLAN_LIST_LIMIT, NOTES_PURPOSES } from '../shared/engine/types.js';
import type { KitId, NotesHistoryPlanView, NotesPurpose, NotesStarterView, NotesView, NotesWritten } from '../shared/engine/types.js';
import { loadKit } from './kit.js';
import type { Kit } from './kit.js';
import type { Scrub } from '../shared/engine/scrub.js';
import { ENGINE_IDS, isEngineId, isPreviewEngine } from '../shared/engine/engines.js';
import { EnginePreviewRefusal } from '../../../packages/skill-manifest/src/engine.js';
import { EVERY_ENGINE_PARTS, RECONCILE, SAVE_EDIT_LIMIT } from '../shared/engine/types.js';
import type {
  AdoptApproval, AdoptChoices, AdoptRecovered, AdoptRecoveryView, AdoptView, AdoptWritten, Answer, ApproveLineView, EngineId, EveryEnginePart, FolderInfo, MergeView, MergeWritten,
  DefinitionView, ProjectAnswer, ProjectInput, ProjectWritten, Recovered, RecoveryChoices, RecoveryView, Refusal, RemovalView, Removed, RestoreView, SaveEdit, SaveView, SaveWritten,
  SetAsideView, SetAsideWritten, VersionView,
} from '../shared/engine/types.js';
import { adoptRecoveryView, adoptionView, approveKey, approveLine, keepsFile, mergeRecoveryView, mergeView, projectView, recoveryView, removalView } from '../shared/engine/view.js';
import { ASK, ShownPlans, approvalText, cancelled, canonical, hashOf, notTheShownPlan } from './engine-consent.js';
import type { Ask } from './engine-consent.js';
import {
  VERSION_KEY, afterSaveWarnings, copiesOk, currentDefinition, keepAfter, keepBefore, keepable, saveCodeOf, saveDone, savedLabel, targetOf, targetView, versionViews, viewOf, wentBackLabel,
} from './engine-save.js';
import type { NotesEditDeps, SourceOf } from './engine-save.js';

export interface EngineServiceDeps {
  /** The home folder. Paths below it are shown with `~`. */
  readonly home: string;
  /** The private state root (`$XDG_STATE_HOME/bowerloom` or `~/.local/state/bowerloom`). Each folder gets its own state folders below it. */
  readonly stateRoot: string;
  /** Opens the system folder chooser, or answers the folder a test set. Null when the person closed it. */
  readonly chooseFolder: () => Promise<string | null>;
  /** Main's own dialog before a write (U16). True only for the person's yes. */
  readonly confirm: (ask: Ask) => Promise<boolean>;
  /** Who approves a line, as the approval record names the person. */
  readonly who: string;
  readonly now?: () => Date;
  /**
   * True when the app may install to preview engines (OpenCode, Pi, DeepSeek Harness). Main sets it from BOWERLOOM_PREVIEW_ENGINES=1 in its own
   * environment (main/engine-state.ts). Default: false. It reaches the window as one answer per folder, never as the environment.
   */
  readonly previewEngines?: boolean;
  /**
   * Writes one line of the local usage log (packages/diagnostics). It never reaches the window. The service calls it inside a try, so a recorder that
   * throws changes no result. Default: records nothing.
   */
  readonly record?: (input: Readonly<Record<string, unknown>>) => boolean;
  /** Main's own folder chooser for notes, with words for `use` ("Use my notes") or `start` ("Start fresh"). Null when the person closed it. Default: closed. */
  readonly chooseNotesFolder?: (purpose: NotesPurpose) => Promise<string | null>;
  /** The folder of the shipped kits (main/kit.ts, `kitsFolder`), asked each time a kit is loaded. With none, a kit is refused KIT_INVALID. */
  readonly kitsDir?: () => string;
  /** Where packages/notes-source looks for git. Tests set it; the app passes nothing, so only the fixed places count. */
  readonly notesOptions?: NotesOptions;
}

/** A call the service refuses before it reaches a package: the window gets only the short code. */
export class EngineCallRefusal extends Error {
  constructor(readonly code: 'BAD_ARGUMENT' | 'UNKNOWN_FOLDER') { super(code); this.name = 'EngineCallRefusal'; }
}

interface Folder {
  readonly id: string; readonly dir: string; readonly label: string; readonly scrub: Scrub;
  /** The shared state layout of the folder (decision 7B). `adoptState` and `portableState` are two of its folders. */
  readonly dirs: HarnessStateDirs; readonly adoptState: string; readonly portableState: string;
}
type RawLine = { part: string; entry: string; field?: string; engine: string; result: 'weakened' | 'absent'; reason: string };
/** A line the window was shown in a fidelity refusal, with the hash of its entry at that moment. Only a line with an entry is kept. */
interface Shown { readonly line: ApproveLineView; readonly raw: RawLine; readonly hash: string | null }

const ID = /^folder-[0-9]{1,6}$/;
/** The id of a notes folder main gave out. Apart from the folder ids, so one can never stand for the other. */
const NOTES_ID = /^notes-[0-9]{1,6}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const safeString = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !v.includes('\u0000');
const bad = (): never => { throw new EngineCallRefusal('BAD_ARGUMENT'); };
const stringList = (v: unknown, max = 2000): string[] => (Array.isArray(v) && v.length <= max && v.every(x => safeString(x)) ? [...v as string[]] : bad());
const revisionArg = (v: unknown): string => (typeof v === 'string' && HEX64.test(v) ? v : bad());
/** Lists compared without their order: the window may send them in another order than the plan listed them. */
const sortById = <T extends { id: string }>(list: readonly T[]): T[] => [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const byKey = <T extends { key: string }>(list: readonly T[]): T[] => [...list].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
/** An ISO time with whole seconds, never later than the clock, as the approval records want it. */
const isoSeconds = (d: Date): string => new Date(Math.floor(d.getTime() / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const hashed = (v: unknown, max = 2000): { key: string; hash: string }[] => {
  if (!Array.isArray(v) || v.length > max) return bad();
  return v.map(x => {
    const o = x as Record<string, unknown> | null;
    if (o === null || typeof o !== 'object' || Object.keys(o).length !== 2 || !safeString(o.key ?? o.id, 1024) || typeof o.hash !== 'string' || !HEX64.test(o.hash)) return bad();
    return { key: (o.key ?? o.id) as string, hash: o.hash };
  });
};

export function checkChoices(v: unknown): AdoptChoices & { readonly everyEngine: readonly EveryEnginePart[] } {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return bad();
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some(k => k !== 'picks' && k !== 'acknowledged' && k !== 'everyEngine')) return bad();
  // Decision D8B: each part at most once, kept in the order of the parts, so the plan and its write name the same choice.
  const every = o.everyEngine === undefined ? [] : o.everyEngine;
  if (!Array.isArray(every) || every.some(p => !(EVERY_ENGINE_PARTS as readonly unknown[]).includes(p)) || new Set(every).size !== every.length) return bad();
  const picks = o.picks;
  if (picks === null || typeof picks !== 'object' || Array.isArray(picks)) return bad();
  const entries = Object.entries(picks as Record<string, unknown>);
  if (entries.length > 2000 || entries.some(([k, x]) => !safeString(k, 1024) || !safeString(x, 1024))) return bad();
  if (Array.isArray(o.acknowledged) && o.acknowledged.some(a => a === null || typeof a !== 'object' || !('id' in (a as object)))) return bad();
  return { picks: Object.fromEntries(entries) as Record<string, string>, acknowledged: hashed(o.acknowledged).map(a => ({ id: a.key, hash: a.hash })), everyEngine: EVERY_ENGINE_PARTS.filter(p => every.includes(p)) };
}

export function checkApprovals(v: unknown): AdoptApproval[] {
  if (Array.isArray(v) && v.some(a => a === null || typeof a !== 'object' || !('key' in (a as object)))) return bad();
  return hashed(v);
}

export function checkProjectInput(v: unknown): ProjectInput {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return bad();
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some(k => !['engines', 'reconcile', 'writeClaudeMd', 'approve'].includes(k))) return bad();
  const engines = Array.isArray(o.engines) && o.engines.length > 0 && o.engines.length <= ENGINE_IDS.length && o.engines.every(isEngineId) && new Set(o.engines).size === o.engines.length ? o.engines as EngineId[] : bad();
  const reconcile = (RECONCILE as readonly unknown[]).includes(o.reconcile) ? o.reconcile as ProjectInput['reconcile'] : bad();
  if (typeof o.writeClaudeMd !== 'boolean') bad();
  return { engines, reconcile, writeClaudeMd: o.writeClaudeMd as boolean, approve: stringList(o.approve) };
}

/**
 * The choices of a recovery plan. A list is the keep list of earlier steps; an object names all three lists (decision D5A). Anything else is refused.
 */
export function checkRecoveryChoices(v: unknown): RecoveryChoices {
  if (Array.isArray(v)) return { keep: v.length === 0 ? [] : stringList(v), restoreMode: [], recordMode: [] };
  if (v === null || typeof v !== 'object') return bad();
  const o = v as Record<string, unknown>, keys = ['keep', 'restoreMode', 'recordMode'];
  if (Object.keys(o).length !== keys.length || !keys.every(k => Object.hasOwn(o, k))) return bad();
  const list = (x: unknown): string[] => (Array.isArray(x) && x.length === 0 ? [] : stringList(x));
  return { keep: list(o.keep), restoreMode: list(o.restoreMode), recordMode: list(o.recordMode) };
}

const exactKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
const plainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const idArg = (v: unknown): string => (isId(v) ? v : bad());

/**
 * The edits of a save, checked in main: a list of at most SAVE_EDIT_LIMIT edits, each one of the closed shapes of `SaveEdit` with exactly its keys. Ids are
 * lowercase letters, digits and single hyphens, so an id never names a path. A path, file text, bytes, a tool, or any other key is refused (BAD_ARGUMENT).
 * The result is a fresh copy, so the plan and the write compare the same canonical edits.
 */
export function checkSaveEdits(v: unknown): SaveEdit[] {
  if (!Array.isArray(v) || v.length > SAVE_EDIT_LIMIT) return bad();
  const edits = v.map((e): SaveEdit => {
    if (!plainObject(e)) return bad();
    switch (e.kind) {
      case 'set-agent': {
        // The skills an agent uses, the notes it reads, or both; each a list of distinct ids.
        if (!Object.keys(e).every(k => ['kind', 'id', 'skills', 'notes'].includes(k)) || (e.skills === undefined && e.notes === undefined)) return bad();
        const ids = (list: unknown): string[] => {
          if (!Array.isArray(list) || list.length > SAVE_EDIT_LIMIT) return bad();
          const out = list.map(idArg);
          return new Set(out).size === out.length ? out : bad();
        };
        return { kind: 'set-agent', id: idArg(e.id), ...(e.skills === undefined ? {} : { skills: ids(e.skills) }), ...(e.notes === undefined ? {} : { notes: ids(e.notes) }) };
      }
      case 'set-source': return exactKeys(e, ['kind', 'name', 'notesId']) && typeof e.notesId === 'string' && NOTES_ID.test(e.notesId) ? { kind: 'set-source', name: idArg(e.name), notesId: e.notesId } : bad();
      case 'remove-source': return exactKeys(e, ['kind', 'name']) ? { kind: 'remove-source', name: idArg(e.name) } : bad();
      case 'add-from-kit': return exactKeys(e, ['kind', 'kit']) && (KIT_IDS as readonly unknown[]).includes(e.kit) ? { kind: 'add-from-kit', kit: e.kit as KitId } : bad();
      case 'remove-skill': return exactKeys(e, ['kind', 'id']) ? { kind: 'remove-skill', id: idArg(e.id) } : bad();
      case 'add-skill': return exactKeys(e, ['kind', 'id', 'from']) && typeof e.from === 'string' && ID.test(e.from) ? { kind: 'add-skill', id: idArg(e.id), from: e.from } : bad();
      case 'set-engines': {
        const list = e.engines;
        if (!exactKeys(e, ['kind', 'engines']) || !Array.isArray(list) || list.length === 0 || list.length > ENGINE_IDS.length || !list.every(isEngineId) || new Set(list).size !== list.length) return bad();
        return { kind: 'set-engines', engines: [...list] as EngineId[] };
      }
      default: return bad();
    }
  });
  // add-skill reads and scans a whole skill of another folder: at most ADD_SKILL_LIMIT of them, and each (folder, skill) pair once. A kit comes once.
  return copiesOk(edits) ? edits : bad();
}

/** A source name made from a folder name: lowercase letters, digits and single hyphens, or `notes` when nothing is left. */
export function suggestedSourceName(name: string): string {
  const id = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 64).replace(/-+$/, '');
  return isId(id) ? id : 'notes';
}
const purposeArg = (v: unknown): NotesPurpose => ((NOTES_PURPOSES as readonly unknown[]).includes(v) ? v as NotesPurpose : bad());
const VERSION_ID = /^v[1-9][0-9]{0,9}$/;
const versionArg = (v: unknown): string => (typeof v === 'string' && VERSION_ID.test(v) ? v : bad());

/** A refusal of a package, as words the window shows. An error that is not a refusal says only that the call failed. */
export function refusalOf(error: unknown, s: Scrub): Refusal {
  const e = error as { code?: unknown; message?: unknown; paths?: unknown; step?: unknown } | null;
  const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
  if (e !== null && typeof e === 'object' && typeof e.code === 'string' && CODE.test(e.code) && typeof e.message === 'string') {
    const paths = Array.isArray(e.paths) ? e.paths.filter((p): p is string => typeof p === 'string').slice(0, 50).map(s) : [];
    // A notes step that stopped part way names the refusal that stopped it, so the window can say what to do about the cause.
    return { code: e.code, message: s(e.message), paths, ...(typeof e.step === 'string' && CODE.test(e.step) ? { step: e.step } : {}) };
  }
  return { code: 'FAILED', message: 'Bowerloom could not finish this. Nothing more was changed.', paths: [] };
}

/**
 * One refused line, as the window gets it, with the hash of its entry. A line whose entry the definition does not hold has no hash: it is shown, offers no
 * tick, and is never stored for approval (SL3).
 */
export function shownLine(raw: RawLine, entry: object | undefined, s: Scrub): Shown {
  const hash = entry === undefined ? null : entryHash(entry);
  return { line: approveLine(raw, hash, s, entry === undefined ? '' : JSON.stringify(entry, null, 2)), raw, hash };
}

export interface EngineService {
  folders(): Promise<FolderInfo[]>;
  chooseFolder(): Promise<Answer<FolderInfo> | null>;
  planAdoption(folderId: unknown, choices: unknown): Promise<Answer<AdoptView>>;
  runAdoption(folderId: unknown, revision: unknown, choices: unknown, approvals: unknown): Promise<Answer<AdoptWritten>>;
  planAdoptionRecovery(folderId: unknown): Promise<Answer<AdoptRecoveryView>>;
  runAdoptionRecovery(folderId: unknown, revision: unknown): Promise<Answer<AdoptRecovered>>;
  planProjection(folderId: unknown, input: unknown): Promise<Answer<ProjectAnswer>>;
  runProjection(folderId: unknown, revision: unknown, input: unknown): Promise<Answer<ProjectWritten>>;
  planRemoval(folderId: unknown): Promise<Answer<RemovalView>>;
  runRemoval(folderId: unknown, revision: unknown): Promise<Answer<Removed>>;
  planRecovery(folderId: unknown, choices: unknown): Promise<Answer<RecoveryView>>;
  runRecovery(folderId: unknown, revision: unknown, choices: unknown): Promise<Answer<Recovered>>;
  planMerge(folderId: unknown): Promise<Answer<MergeView>>;
  runMerge(folderId: unknown, revision: unknown): Promise<Answer<MergeWritten>>;
  planSave(folderId: unknown, edits: unknown): Promise<Answer<SaveView>>;
  runSave(folderId: unknown, revision: unknown, edits: unknown): Promise<Answer<SaveWritten>>;
  listVersions(folderId: unknown): Promise<Answer<VersionView[]>>;
  planRestore(folderId: unknown, version: unknown): Promise<Answer<RestoreView>>;
  runRestore(folderId: unknown, revision: unknown, version: unknown): Promise<Answer<SaveWritten>>;
  planSetAside(folderId: unknown): Promise<Answer<SetAsideView>>;
  runSetAside(folderId: unknown, revision: unknown): Promise<Answer<SetAsideWritten>>;
  /** Records the answer to "Did this do what you wanted?" in the local log. True only when a line was written; false when the log is off, the write failed, or more than 10 came in a minute. */
  recordCheck(answer: unknown, note: unknown): Promise<boolean>;
  chooseNotesFolder(purpose: unknown): Promise<Answer<NotesView> | null>;
  notesSummary(notesId: unknown): Promise<Answer<NotesView>>;
  planCreateNotes(notesId: unknown): Promise<Answer<NotesStarterView>>;
  runCreateNotes(notesId: unknown, revision: unknown): Promise<Answer<NotesWritten>>;
  planNotesHistory(notesId: unknown): Promise<Answer<NotesHistoryPlanView>>;
  runNotesHistory(notesId: unknown, revision: unknown): Promise<Answer<NotesWritten>>;
}

/**
 * A notes folder main knows, by the id it handed out. `dir` stays in main. `chosen` is true once the person picked it with main's own notes chooser in this
 * window: only then may Bowerloom plan or write the starter or the history there. A source read from `knowledge.json` alone is read-only. `unsafe` is true
 * for a source whose stored path does not lead to that folder itself (a link on the way, or a folder Bowerloom refuses): its read is refused, and nothing
 * there is read.
 */
interface Notes { readonly id: string; readonly dir: string; readonly label: string; readonly name: string; readonly scrub: Scrub; readonly chosen: boolean; readonly unsafe: boolean }
/** What the gate keys a plan by: a folder or a notes folder. */
type Keyed = { readonly id: string; readonly scrub: Scrub };

/** The answer and the note of an after-apply check, checked again in main: the window is never trusted. A note is at most 500 characters. */
export function checkCheckArgs(answer: unknown, note: unknown): { answer: CheckAnswer; note?: string } {
  if (typeof answer !== 'string' || !(ANSWERS as readonly string[]).includes(answer)) return bad();
  if (note === undefined || note === null) return { answer: answer as CheckAnswer };
  if (typeof note !== 'string' || note.length > NOTE_LIMIT) return bad();
  return note.trim() === '' ? { answer: answer as CheckAnswer } : { answer: answer as CheckAnswer, note };
}

export function createEngineService(deps: EngineServiceDeps): EngineService {
  const now = deps.now ?? (() => new Date());
  const previewEngines = deps.previewEngines ?? false;
  const realHome = (() => { try { return realpathSync(deps.home); } catch { return deps.home; } })();
  const homes = [...new Set([deps.home, realHome])];
  const byId = new Map<string, Folder>();
  /** The lines each folder's window was shown, and the approval records made when the person ticked them. Both live for the session only. */
  const shown = new Map<string, Map<string, Shown>>();
  const made = new Map<string, Map<string, FidelityApproval>>();
  const plans = new ShownPlans();
  let chain: Promise<unknown> = Promise.resolve();
  let count = 0;

  /**
   * Writes a usage event. A recorder that throws, or none, changes nothing: the failure is told on the console. Only a package refusal and a finished write are
   * recorded. A stale-approval mismatch (NOT_THE_PLAN_SHOWN) or a person cancelling main's confirm records nothing on purpose: neither is a failure of the product.
   */
  const record = (input: Readonly<Record<string, unknown>>): void => { try { deps.record?.({ source: 'app', ...input }); } catch (error) { console.error('Bowerloom could not record a usage event.', error); } };
  /** Runs a write and records its scenario: done when it finishes, refused with the code of the refusal when it does not. The result or the error passes through as it was. */
  const scenarioOf = async <T>(f: Folder, spec: { scenario?: string; step: string; engines?: readonly string[]; plan?: string; target?: boolean }, run: () => Promise<T>): Promise<T> => {
    const base = { kind: 'scenario', step: spec.step, ...(spec.scenario === undefined ? {} : { scenario: spec.scenario }), ...(spec.engines === undefined ? {} : { engines: spec.engines }), ...(spec.plan === undefined ? {} : { plan: spec.plan }), ...(spec.target ? { targetRoot: f.dir } : {}) };
    try { const r = await run(); record({ ...base, outcome: 'done' }); return r; } catch (error) {
      let code = 'FAILED';
      try { code = refusalOf(error, f.scrub).code; } catch (inner) { console.error('Bowerloom could not name the refusal for its usage event.', inner); }
      record({ ...base, outcome: 'refused', code });
      throw error;
    }
  };
  /** The after-apply check is recorded at most this many times in this window each minute. */
  const CHECKS_PER_MINUTE = 10;
  const checkTimes: number[] = [];

  /** One call at a time, in the order they came. */
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = chain.then(run, run);
    chain = next.catch(() => undefined);
    return next;
  };
  const folderOf = (id: unknown): Folder => {
    if (typeof id !== 'string' || !ID.test(id)) return bad();
    const f = byId.get(id);
    if (f === undefined) throw new EngineCallRefusal('UNKNOWN_FOLDER');
    return f;
  };
  const answer = async <T>(f: Keyed | null, run: () => Promise<T> | T): Promise<Answer<T>> => {
    try { return { ok: true, value: await run() }; } catch (error) {
      if (error instanceof EngineCallRefusal) throw error;
      return { ok: false, refusal: refusalOf(error, f?.scrub ?? makeScrub(homes.map(path => ({ path, as: '~' })))) };
    }
  };
  /** Plans, records the plan as the one shown last of its kind, and clears that record when the plan fails. */
  const planned = async <T>(f: Keyed, kind: Parameters<ShownPlans['set']>[1], run: () => { value: T; revision: string; choices: unknown; ask: Ask | null } | { value: T; revision: null }): Promise<Answer<T>> => {
    plans.clear(f.id, kind);
    return answer(f, () => {
      const r = run();
      if (r.revision !== null) plans.set(f.id, kind, { revision: r.revision, choices: canonical((r as { choices: unknown }).choices), ask: (r as { ask: Ask | null }).ask });
      return r.value;
    });
  };
  /** Runs a write only for the plan shown last with these choices, after main's own dialog and the person's yes. */
  const written = async <T>(f: Keyed, kind: Parameters<ShownPlans['set']>[1], revision: string, choices: unknown, run: () => Promise<T>): Promise<Answer<T>> => {
    const shownPlan = plans.match(f.id, kind, revision, choices);
    if (shownPlan === null) return notTheShownPlan();
    if (shownPlan.ask !== null && !(await deps.confirm(shownPlan.ask))) return cancelled();
    plans.clear(f.id, kind);
    return answer(f, run);
  };

  /**
   * Gives a chosen folder its id, once. Before the first read of its record, the record of the earlier app moves into the shared layout, under the project
   * lock (decision 7B). When both records exist, the package refuses HARNESS_STATE_TWO_RECORDS: the folder gets no id, and the refusal reaches the window.
   */
  async function register(dir: string): Promise<Folder> {
    for (const f of byId.values()) if (f.dir === dir) return f;
    const dirs = harnessStateDirs(deps.stateRoot, dir);
    await settleLegacyState(dirs, dir, new AbortController().signal);
    count += 1;
    // The label reaches the window and main's own dialog, so a hidden character in a folder name is written out first (W2).
    const id = `folder-${count}`, label = visible(labelOf(dir, homes.find(h => dir === h || dir.startsWith(`${h}/`)) ?? deps.home));
    const state = '(the private state folder)';
    const scrub = makeScrub([{ path: dir, as: label }, ...homes.map(path => ({ path, as: '~' })), { path: dirs.base, as: state }, { path: dirs.legacy, as: state }]);
    const f: Folder = { id, dir, label, scrub, dirs, adoptState: dirs.adoption, portableState: dirs.portable };
    byId.set(id, f);
    return f;
  }

  // ---- notes folders (spec 6.9) ------------------------------------------------------------------------------------------

  const notesById = new Map<string, Notes>();
  let notesCount = 0;
  const notesOptions: NotesOptions = deps.notesOptions ?? {};
  /**
   * Gives a notes folder its id, once per folder. `label` is how the window names it: the `~` form, or a source's stored form under its harness. The
   * folder need not exist yet: a source a harness records may point at a folder that is gone, and its read then says so.
   */
  function registerNotes(dir: string, how: { readonly label?: string; readonly chosen: boolean; readonly unsafe?: boolean }): Notes {
    let real = dir;
    if (how.unsafe !== true) { try { real = realpathSync(dir); } catch { real = dir; } }
    for (const n of notesById.values()) {
      if (n.dir !== real || n.unsafe !== (how.unsafe === true)) continue;
      if (!how.chosen || n.chosen) return n;
      // Chosen now with main's own chooser: the same id, and from now on it may be planned and written.
      const up: Notes = { ...n, chosen: true };
      notesById.set(n.id, up);
      return up;
    }
    notesCount += 1;
    const id = `notes-${notesCount}`;
    const shown = visible(how.label ?? labelOf(real, homes.find(h => real === h || real.startsWith(`${h}/`)) ?? deps.home));
    const scrub = makeScrub([{ path: real, as: shown }, { path: dir, as: shown }, ...homes.map(path => ({ path, as: '~' }))]);
    const n: Notes = { id, dir: real, label: shown, name: visible(basename(real)), scrub, chosen: how.chosen, unsafe: how.unsafe === true };
    notesById.set(id, n);
    return n;
  }
  /** Refuses NOTES_NOT_CHOSEN for a notes folder the person did not pick with main's own chooser in this window. */
  const chosenOnly = (n: Notes): void => { if (!n.chosen) throw new DefinitionError(NOTES_NOT_CHOSEN, NOTES_MAIN_WORDS.NOTES_NOT_CHOSEN); };
  /**
   * True when the folder a source's stored path names is that folder itself: Bowerloom takes it as a project path, and its real path is the joined path, so
   * no link on the way points it somewhere else. A folder that is not there yet passes: its read says it is missing.
   */
  const sourceIsPlain = (abs: string): boolean => {
    try { checkProjectPath(abs, deps.home); } catch { return false; }
    try { return realpathSync(abs) === abs; } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
  };
  const notesOf = (id: unknown): Notes => {
    if (typeof id !== 'string' || !NOTES_ID.test(id)) return bad();
    const n = notesById.get(id);
    if (n === undefined) throw new EngineCallRefusal('UNKNOWN_FOLDER');
    return n;
  };
  /** The Notes panel's read of one folder: names and counts only, through packages/notes-source, which never opens a page. */
  async function notesView(n: Notes): Promise<NotesView> {
    if (n.unsafe) throw new NotesRefusal('NOTES_PATH_UNSAFE');
    const s = await readNotesSummary(n.dir, notesOptions);
    return {
      id: n.id, label: n.label, name: n.name, suggestedName: suggestedSourceName(n.name), pages: s.pages, complete: s.complete, history: s.history,
      lastCommitAt: s.lastCommitAt === null ? null : isoSeconds(new Date(s.lastCommitAt)),
      latestReport: s.latestReport === null ? null : { date: s.latestReport.date, path: n.scrub(s.latestReport.path) },
    };
  }
  /** The shipped kit, loaded and validated now. With no kit folder it is refused, never empty. */
  const kitNow = (id: KitId): Kit => {
    const dir = deps.kitsDir?.();
    if (dir === undefined) throw new DefinitionError(KIT_INVALID, `${KIT_MAIN_WORDS.KIT_INVALID} (no kit folder)`);
    return loadKit(dir, id);
  };
  /** A source of a harness as the window gets it: its label, and a notes id for the folder it points at. */
  const sourceViewOf = (f: Folder): SourceOf => src => {
    const home = src.path.startsWith('~/');
    const abs = src.path === '.' ? f.dir : home ? join(realHome, src.path.slice(2)) : join(f.dir, src.path);
    const label = src.path === '.' ? f.label : home ? src.path : `${f.label}/${src.path}`;
    // A source the harness records is read only: its id plans and writes nothing until the person chooses the folder here.
    return { name: src.name, kind: src.kind, label: visible(label), notesId: registerNotes(abs, { label, chosen: false, unsafe: !sourceIsPlain(abs) }).id };
  };
  /** What the notes edits of a save need: the stored path of a notes folder, relative to this harness folder or in `~` form, and the shipped kit. */
  const notesEdits = (f: Folder): NotesEditDeps => ({
    sourcePath: notesId => {
      const n = notesOf(notesId);
      if (n.unsafe) throw new NotesRefusal('NOTES_PATH_UNSAFE');
      const r = storedKnowledgePath(n.dir, { root: f.dir, home: realHome });
      if (!r.ok) throw new DefinitionError(r.code, r.message);
      return r.path;
    },
    kit: kitNow,
  });
  /** Runs a notes write and records its step: done, or refused with its code. The result or the error passes through as it was. */
  const notesStep = async <T>(n: Notes, step: string, run: () => Promise<T>): Promise<T> => {
    try { const r = await run(); record({ kind: 'scenario', step, outcome: 'done' }); return r; } catch (error) {
      let code = 'FAILED';
      try { code = refusalOf(error, n.scrub).code; } catch (inner) { console.error('Bowerloom could not name the refusal for its usage event.', inner); }
      record({ kind: 'scenario', step, outcome: 'refused', code });
      throw error;
    }
  };

  /** True when a Merge stopped part way here: its journal is in the adoption state folder (decision D4A). */
  const mergeIsStopped = (f: Folder): boolean => mergeStopped(f.adoptState);
  /** True when a save stopped part way here: its journal is in the adoption state folder. */
  const saveIsStopped = (f: Folder): boolean => { try { return saveStopped(f.adoptState); } catch { return true; } };
  /** Adoption and Merge wait while a save is stopped: they would run on a half-saved definition. */
  const whileSaveStopped = (f: Folder): void => refuseWhileSaveStopped(f.adoptState);
  /**
   * Install, removal, a tick and a save wait while an adoption, a Merge or a save is stopped: they would run on a half-written, half-merged or half-saved
   * definition. The package's own check covers all three, the same check the command line runs; a stopped save is told in the save step's own words, which
   * do not send the person to the app they are in.
   */
  const whileStopped = (f: Folder): void => {
    try { refuseWhileStopped(f.adoptState); } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'SAVE_RECOVERY_REQUIRED') whileSaveStopped(f);
      throw error;
    }
  };
  /** Which stopped run the recovery of a stopped harness settles: an adoption first, as the packages refuse in that order, then a Merge, then a save. */
  function stoppedKind(f: Folder): 'adoption' | 'merge' | 'save' {
    let adoption: boolean;
    try { adoption = readJournal(f.adoptState, f.dir) !== null; } catch { adoption = true; }
    if (adoption) return 'adoption';
    if (mergeIsStopped(f)) return 'merge';
    return saveIsStopped(f) ? 'save' : 'adoption';
  }

  function info(f: Folder): FolderInfo {
    let hasDefinition = false;
    try { hasDefinition = lstatSync(join(f.dir, '.bowerloom', 'harness.json')).isFile(); } catch { hasDefinition = false; }
    let engines: EngineId[] = [], problem: string | null = null;
    if (hasDefinition) {
      const loaded = loadDefinition(join(f.dir, '.bowerloom'));
      if (loaded.ok) engines = ENGINE_IDS.filter(e => loaded.definition.harness.engines.some(x => x.id === e));
      else problem = f.scrub(loaded.problems[0]?.message ?? 'The harness definition does not load.');
    }
    const io = { projectDir: f.dir, stateDir: f.portableState };
    let projected = false, projection = false, adoption = false;
    let installedEngines: EngineId[] = [];
    try { const receipt = readPortableReceipt(io); projected = receipt !== null; installedEngines = receipt === null ? [] : ENGINE_IDS.filter(e => receipt.engines.some(x => x.id === e)); } catch { projected = false; installedEngines = []; }
    try { projection = pendingExists(f.portableState); } catch { projection = false; }
    try { adoption = readJournal(f.adoptState, f.dir) !== null; } catch { adoption = false; }
    adoption ||= mergeIsStopped(f) || saveIsStopped(f);
    return { id: f.id, label: f.label, name: f.scrub(basename(f.dir)), hasDefinition, engines, previewEngines, installedEngines, problem, projected, unfinished: { projection, adoption } };
  }

  const adoptInput = (f: Folder, picks: AdoptChoices['picks'], acknowledged: readonly string[], everyEngine: readonly EveryEnginePart[]): AdoptionInput => ({
    projectDir: f.dir, stateDir: f.adoptState,
    choices: Object.fromEntries(Object.entries(picks).map(([k, pick]) => [k, { pick }])),
    acknowledged,
    ...(everyEngine.length ? { everyEngine } : {}),
  });

  /**
   * The adoption plan for these choices. An acknowledgement counts only when its hash is the hash of the entry as the plan shows it now (U3); one that
   * does not match is dropped, and the plan is made again without it.
   */
  function adoptionNow(f: Folder, c: ReturnType<typeof checkChoices>): { plan: AdoptionPlan; view: AdoptView; acknowledged: AdoptChoices['acknowledged'] } {
    const make = (acks: readonly string[]): { plan: AdoptionPlan; view: AdoptView } => {
      const { plan, bytes } = planAdoptionWithBytes(adoptInput(f, c.picks, acks, c.everyEngine));
      return { plan, view: adoptionView(plan, f.label, f.scrub, { hashOf, textOf: key => approvalText(key, bytes) }) };
    };
    const wanted = c.acknowledged.map(a => a.id);
    let first = make(wanted);
    const kept = c.acknowledged.filter(a => first.view.unmapped.some(u => u.id === a.id && u.hash === a.hash && u.gate === 'acknowledge'));
    if (kept.length !== wanted.length) first = make(kept.map(a => a.id));
    return { ...first, acknowledged: kept };
  }

  /** The definition's entries by part, as the fidelity check finds them, for the hash an approval binds. */
  function entryOf(def: Definition, part: string, entry: string): object | undefined {
    const e = def.entries;
    const list: readonly { id: string }[] = part === 'skills' ? e.skills : part === 'subagents' ? e.subagents : part === 'guardrails' ? [...e.rules, ...e.sandbox] : part === 'hooks' ? e.hooks : part === 'mcp' ? e.mcp : [];
    return list.find(x => x.id === entry);
  }

  /**
   * The approval records of one plan (U15). A key names a line and the hash of its entry, so a changed entry has a new key, and the old tick covers nothing.
   * A record keeps the time it was first made, so the plan and the write compute the same revision, in this session or another, from the app or the command
   * line.
   *  - A line the person ticked in this sheet is a record in memory for the plan shown. Planning writes nothing to the disk: a tick that is never written,
   *    or that the person cancels, leaves no approval behind that the command line would count. The record becomes a draft only when the write runs, after
   *    main's own dialog (`keepTicks`).
   *  - Every draft on disk whose entry is unchanged counts, so a line accepted at the command line is not asked again here.
   *  - An approval that an earlier install recorded is reused only for an entry that is unchanged, and the plan lists it as earlier.
   * `ticked` counts the lines the person approved in this sheet.
   */
  function approvalsFor(f: Folder, keys: readonly string[]): { approvals: FidelityApproval[]; mine: Set<string>; ticked: FidelityApproval[] } {
    const lines = shown.get(f.id) ?? new Map<string, Shown>(), records = made.get(f.id) ?? new Map<string, FidelityApproval>();
    made.set(f.id, records);
    const loaded = loadDefinition(join(f.dir, '.bowerloom'));
    const def = loaded.ok ? loaded.definition : null;
    const unchanged = (a: { part: string; entry: string; entryHash: string }): boolean => {
      if (def === null) return false;
      const entry = entryOf(def, a.part, a.entry);
      return entry !== undefined && entryHash(entry) === a.entryHash;
    };
    const keyOf = (a: FidelityApproval): string => approveKey(a, a.entryHash);
    const drafts = def === null ? [] : readApprovalDrafts(f.dirs, f.dir, { definition: def });
    const out: FidelityApproval[] = [], ticked: FidelityApproval[] = [];
    for (const key of keys) {
      const line = lines.get(key);
      if (line === undefined || line.hash === null) return bad();
      let record = drafts.find(d => keyOf(d) === key) ?? records.get(key);
      if (record === undefined) {
        const reason = `Approved in the Bowerloom app after reading this line: ${line.raw.reason}`.slice(0, 4096);
        record = { part: line.raw.part as FidelityApproval['part'], entry: line.raw.entry, ...(line.raw.field === undefined ? {} : { field: line.raw.field }), engine: line.raw.engine as EngineId, result: line.raw.result, entryHash: line.hash, who: deps.who, reason, when: isoSeconds(now()) };
        records.set(key, record);
      }
      // A record that is not a draft yet, for an entry that has not changed since it was shown, is what the write will keep.
      if (!drafts.includes(record) && unchanged(record)) ticked.push(record);
      out.push(record);
    }
    const mineKeys = new Set(out.map(keyOf));
    const others = drafts.filter(d => !mineKeys.has(keyOf(d)));
    for (const d of others) mineKeys.add(keyOf(d));
    let recorded: readonly FidelityApproval[] = [];
    try { recorded = readPortableReceipt({ projectDir: f.dir, stateDir: f.portableState })?.approvals ?? []; } catch { recorded = []; }
    const earlier = recorded.filter(a => unchanged(a) && !mineKeys.has(keyOf(a)));
    return { approvals: [...earlier, ...others, ...out], mine: mineKeys, ticked };
  }
  /**
   * Keeps the lines the person ticked as approval drafts, under the project lock, with the time they were planned with. Called only when a write runs,
   * after the shown plan matched and main's own dialog said yes. A line whose entry changed since it was shown is refused as stale, and nothing is kept.
   */
  async function keepTicks(f: Folder, keys: readonly string[]): Promise<void> {
    const { ticked } = approvalsFor(f, keys);
    if (ticked.length === 0) return;
    const loaded = loadDefinition(join(f.dir, '.bowerloom'));
    if (!loaded.ok) return;
    for (const { when, ...draft } of ticked) await addApprovalDraftLocked(f.dirs, f.dir, draft, { definition: loaded.definition, now: new Date(when) });
  }
  /** The warning for approval drafts that could not be cleared after a write that worked. The write stays done. */
  const draftsWarning = (error: unknown): string => {
    const code = (error as { code?: unknown } | null)?.code;
    return `approval drafts not cleared (${typeof code === 'string' && /^[A-Z][A-Za-z0-9_]{2,63}$/.test(code) ? code : 'FAILED'}); run bowerloom harness status`;
  };

  /** Beta.1: a plan or a write that names a preview engine is refused up front when the app may not install to them. The package refuses it too. */
  const refusePreview = (input: ProjectInput): void => {
    const named = previewEngines ? undefined : ENGINE_IDS.find(e => isPreviewEngine(e) && input.engines.includes(e));
    if (named !== undefined) throw new EnginePreviewRefusal(named);
  };
  const portableInput = (f: Folder, input: ProjectInput, approvals: readonly FidelityApproval[]): PortableInput => ({
    projectDir: f.dir, definitionFolder: join(f.dir, '.bowerloom'), stateDir: f.portableState,
    engines: input.engines.map(id => ({ id })), reconcile: input.reconcile, approvals, previewEngines,
    ...(input.writeClaudeMd ? { writeClaudeMd: true } : {}),
  });

  function planProjectionNow(f: Folder, input: ProjectInput): { value: ProjectAnswer; revision: string; choices: unknown; ask: Ask | null } | { value: ProjectAnswer; revision: null } {
    whileStopped(f);
    const { approvals, mine } = approvalsFor(f, input.approve);
    try {
      const plan = planPortable(portableInput(f, input, approvals));
      let drift: ReturnType<typeof portableDrift> = [];
      try { drift = portableDrift({ projectDir: f.dir, stateDir: f.portableState }); } catch { drift = []; }
      const view = projectView(plan, f.label, drift, f.scrub, a => !mine.has(approveKey(a, a.entryHash)));
      // A file taken over is recorded, not written, so the dialog does not count it.
      const changing = plan.changes.filter(c => c.action !== 'unchanged' && c.action !== 'take-over' && !keepsFile(c)).length;
      // Main asks before every write that changes anything on disk. Only a no-op plan writes nothing at all; a plan that changes no file of the folder
      // still writes Bowerloom's record (the receipt and its pending marker), so it asks too, in words that say so (W1).
      const ticked = input.approve.length;
      const ask = plan.noop ? null : changing === 0 ? ASK.record(f.label, plan.revision, ticked) : ASK.projection(f.label, changing, plan.revision, ticked);
      return { value: { kind: 'plan', plan: view }, revision: plan.revision, choices: input, ask };
    } catch (error) {
      const refused = (error as { code?: unknown; refused?: unknown } | null);
      if (refused?.code !== 'PORTABLE_FIDELITY' || !Array.isArray(refused.refused)) throw error;
      const loaded = loadDefinition(join(f.dir, '.bowerloom'));
      if (!loaded.ok) throw error;
      const lines = shown.get(f.id) ?? new Map<string, Shown>();
      shown.set(f.id, lines);
      const now2 = (refused.refused as RawLine[]).map(r => shownLine({ part: r.part, entry: r.entry, ...(r.field === undefined ? {} : { field: r.field }), engine: r.engine, result: r.result, reason: r.reason }, entryOf(loaded.definition, r.part, r.entry), f.scrub));
      for (const x of now2) if (x.hash !== null) lines.set(x.line.key, x);
      // The lines approved so far stay in the list, so the person sees every line this plan needs, ticked or not. A line whose entry changed is a new key.
      const all = now2.map(x => x.line);
      for (const key of input.approve) { const x = lines.get(key); if (x !== undefined && !all.some(l => l.key === key) && (refusedEntryUnchanged(loaded.definition, x))) all.push(x.line); }
      return { value: { kind: 'approve', lines: all, approvedSoFar: input.approve.filter(key => all.some(l => l.key === key)) }, revision: null };
    }
  }
  const recoveryInput = (f: Folder, c: RecoveryChoices): Parameters<typeof planPortableRecovery>[0] => ({
    projectDir: f.dir, stateDir: f.portableState,
    ...(c.keep.length ? { keep: c.keep } : {}), ...(c.restoreMode.length ? { restoreMode: c.restoreMode } : {}), ...(c.recordMode.length ? { recordMode: c.recordMode } : {}),
  });

  /**
   * The text of CLAUDE.md that a Merge plan moves, for the person to read. It is read only when it is a plain file whose bytes are the ones the plan
   * hashed; anything else shows no text, and the write plans again under the lock, so it never moves text the person did not see.
   */
  function claudeText(f: Folder, plan: InstructionMergePlan): string {
    try {
      const p = join(f.dir, 'CLAUDE.md');
      if (!lstatSync(p).isFile()) return '';
      const bytes = readFileSync(p);
      return createHash('sha256').update(bytes).digest('hex') === plan.claude.sha256 ? bytes.toString('utf8') : '';
    } catch { return ''; }
  }

  /** True when a stored line's entry still has the hash the line was shown with. */
  function refusedEntryUnchanged(def: Definition, x: Shown): boolean {
    const entry = entryOf(def, x.raw.part, x.raw.entry);
    return entry !== undefined && x.hash !== null && entryHash(entry) === x.hash;
  }

  /** The input of the save package for a folder: its own adoption state folder holds the save journal, beside the adoption and merge journals. */
  const saveIo = (f: Folder): { projectDir: string; stateDir: string } => ({ projectDir: f.dir, stateDir: f.adoptState });
  /** The save plan of these edits, and its target file set. Refused while an adoption, a Merge or a save is stopped. */
  function saveNow(f: Folder, edits: readonly SaveEdit[]): { plan: SavePlan; target: DefinitionFile[] } {
    whileStopped(f);
    const def = currentDefinition(f.dir);
    const target = targetOf(def, edits, from => folderOf(from).dir, notesEdits(f));
    const plan = packagePlanSave(saveIo(f), target);
    // A save that changes files keeps a save point before and after it; one that could not be kept is refused here, before the person approves.
    if (plan.changes.length > 0) keepable(def.files, target);
    return { plan, target };
  }
  /** The harness view with every string a person wrote passed through the folder's scrub, so no home path reaches the window. */
  const scrubbed = (f: Folder, d: DefinitionView): DefinitionView => ({
    ...d, id: f.scrub(d.id), description: f.scrub(d.description),
    skills: d.skills.map(x => ({ id: x.id, name: f.scrub(x.name), description: f.scrub(x.description) })),
    agents: d.agents.map(a => ({ ...a, name: f.scrub(a.name), description: f.scrub(a.description) })),
    sources: d.sources.map(x => ({ ...x, label: f.scrub(x.label) })),
  });
  function saveView(f: Folder, plan: SavePlan, target: readonly DefinitionFile[]): SaveView {
    return {
      folder: f.label, changes: plan.changes.map(c => ({ path: f.scrub(`.bowerloom/${c.path}`), action: c.action })), definition: scrubbed(f, targetView(target, f.dir, sourceViewOf(f))),
      noop: plan.changes.length === 0, revision: plan.revision,
    };
  }
  /**
   * Writes a save target the person approved: a save point of the harness as it is first (a save never runs without a way back), then the package's
   * journaled write under the project lock, then a save point of what it wrote. A plan shown before it, of an install, a save or a go-back, can no longer be
   * written. Save points that could not both be kept refuse the write up front. A save point that could not be kept after the write, or a journal that
   * could not be removed, is a warning in words: the save is done. The save point is logged as a refused step of its own.
   */
  async function saveAndKeep(f: Folder, rev: string, target: readonly DefinitionFile[], label: (changes: number) => string): Promise<SaveWritten> {
    const at = now();
    if (packagePlanSave(saveIo(f), target).changes.length > 0) {
      keepable(currentDefinition(f.dir).files, target);
      await keepBefore(f.dir, f.dirs, at);
    }
    const r = await applySave(saveIo(f), rev, target);
    plans.clear(f.id, 'projection'); plans.clear(f.id, 'save'); plans.clear(f.id, 'restore');
    if (r.written.length === 0) { const w = afterSaveWarnings(r.journalLeft, null); return { written: [], version: null, ...(w.length ? { warnings: w } : {}) }; }
    let version: string | null = null, pointError: unknown = null;
    try { version = await keepAfter(f.dir, f.dirs, target, r.revision, label(r.written.length), at); } catch (error) {
      pointError = error;
      record({ kind: 'scenario', step: 'save-point', outcome: 'refused', code: saveCodeOf(error) });
    }
    const warnings = afterSaveWarnings(r.journalLeft, pointError);
    return { written: r.written.map(p => f.scrub(`.bowerloom/${p}`)), version, ...(warnings.length ? { warnings } : {}) };
  }
  /** The revision of the folder's harness now, or null when it does not load. */
  const revisionNow = (f: Folder): string | null => { const r = loadDefinition(join(f.dir, '.bowerloom')); return r.ok ? r.definition.revision : null; };

  return {
    folders: () => serial(async () => [...byId.values()].map(info)),
    chooseFolder: () => serial(async () => {
      const picked = await deps.chooseFolder();
      if (picked === null) return null;
      const s = makeScrub(homes.map(path => ({ path, as: '~' })));
      try {
        if (!isAbsolute(picked) || picked.includes('\u0000')) return bad();
        const dir = realpathSync(picked);
        if (!lstatSync(dir).isDirectory()) return bad();
        checkProjectPath(dir, deps.home);
        return { ok: true, value: info(await register(dir)) } as const;
      } catch (error) {
        if (error instanceof EngineCallRefusal) return { ok: false, refusal: { code: 'NOT_A_FOLDER', message: 'That is not a folder Bowerloom can use. Choose a folder.', paths: [] } } as const;
        return { ok: false, refusal: refusalOf(error, s) } as const;
      }
    }),
    planAdoption: (id, choices) => serial(async () => {
      const f = folderOf(id), c = checkChoices(choices);
      return planned(f, 'adoption', () => {
        whileSaveStopped(f);
        const { plan, view, acknowledged } = adoptionNow(f, c);
        // The record keeps what the write must repeat: the picks, the acknowledgements that counted, and each approval with its hash.
        return { value: view, revision: plan.revision, choices: { picks: c.picks, acknowledged: sortById(acknowledged), approvals: byKey(view.approvals.filter(a => a.blocked === null).map(a => ({ key: a.key, hash: a.hash }))), everyEngine: c.everyEngine }, ask: ASK.adoption(f.label, plan.files.length, plan.revision) };
      });
    }),
    runAdoption: (id, revision, choices, approvals) => serial(async () => {
      const f = folderOf(id), rev = revisionArg(revision), c = checkChoices(choices), list = checkApprovals(approvals);
      // The plan shown last was made with the acknowledgements that counted, each by id and hash; the write must name them, and every approval with its
      // hash, exactly. An acknowledgement or an approval of content the person did not read never matches.
      const shownPicks = { picks: c.picks, acknowledged: sortById(c.acknowledged), approvals: byKey(list), everyEngine: c.everyEngine };
      const stopped = await answer(f, () => whileSaveStopped(f));
      if (!stopped.ok) return stopped;
      return written(f, 'adoption', rev, shownPicks, () => scenarioOf(f, { scenario: 'S1', step: 'adopt' }, async () => {
        const r = await applyAdoption(adoptInput(f, c.picks, c.acknowledged.map(a => a.id), c.everyEngine), rev, list.map(a => a.key));
        return { written: r.written.map(p => f.scrub(`.bowerloom/${p}`)) };
      }));
    }),
    planAdoptionRecovery: id => serial(async () => {
      const f = folderOf(id), io = { projectDir: f.dir, stateDir: f.adoptState };
      return planned(f, 'adoption-recovery', () => {
        const kind = stoppedKind(f);
        if (kind === 'save') {
          const plan = planSaveRecovery(io);
          const inDef = (p: string): string => f.scrub(`.bowerloom/${p}`);
          // A finished save whose journal was left is kept: the plan shows no file to take back, and says the save stays. The mode is one of the plan's
          // choices, so the write runs only in the mode shown: the package revision does not cover the files outside the journal that decide it.
          const done = saveDone(plan, revisionNow(f), f.dir);
          const view: AdoptRecoveryView = {
            kind: 'save', journal: plan.journal, done, check: plan.check.map(inDef),
            remove: done ? [] : plan.undo.filter(u => u.action === 'delete').map(u => inDef(u.path)), restore: done ? [] : plan.undo.filter(u => u.action !== 'delete').map(u => inDef(u.path)),
            kept: plan.kept.map(k => ({ path: inDef(k.path), reason: k.reason })), dirs: done ? [] : plan.dirs.map(inDef), revision: plan.revision,
          };
          return { value: view, revision: plan.revision, choices: { done }, ask: ASK.saveRecovery(f.label, done ? 0 : plan.undo.length, plan.revision, done) };
        }
        if (kind === 'merge') {
          const plan = planInstructionMergeRecovery(io);
          return { value: mergeRecoveryView(plan, f.scrub), revision: plan.revision, choices: null, ask: ASK.mergeRecovery(f.label, plan.restore.length, plan.revision) };
        }
        const plan = planAdoptionRecovery(io);
        return { value: adoptRecoveryView(plan, f.scrub), revision: plan.revision, choices: null, ask: ASK.adoptionRecovery(f.label, plan.remove.length, plan.revision) };
      });
    }),
    runAdoptionRecovery: (id, revision) => serial(async () => {
      const f = folderOf(id), rev = revisionArg(revision), io = { projectDir: f.dir, stateDir: f.adoptState };
      // A save recovery names its mode as the plan did. When the mode now differs from the one shown, as when a file outside the journal changed since,
      // the write is not the plan shown, and nothing runs. Any other recovery has no choices. A read that fails names none, so it never matches a save plan.
      let mode: { done: boolean } | null = null;
      try { if (stoppedKind(f) === 'save') mode = { done: saveDone(planSaveRecovery(io), revisionNow(f), f.dir) }; } catch { mode = null; }
      return written(f, 'adoption-recovery', rev, mode, () => scenarioOf(f, { scenario: 'S5', step: 'recover' }, async () => {
        // The kind is read again here. When the stopped run changed since the plan, the package's own revision check refuses the write.
        const kind = stoppedKind(f);
        // Each result says whether the harness loads after it (`revision`, null when not), and which files a person checks by hand: every file of a
        // damaged journal, and every file the recovery kept.
        const checkOf = (check: readonly string[], kept: readonly string[]): string[] => [...new Set([...check, ...kept])];
        if (kind === 'save') {
          // A stopped save is taken back: each file goes back to what the save replaced. The plan read again names which were deleted and which restored.
          // A save that finished and only left its journal is kept instead: `finish` runs no step, checks the harness is the save's target, and clears
          // the journal. Taking it back would lose the save for good when its save point was not kept either. The mode is the one the shown plan
          // named, matched by `written` above; the package's revision check refuses the write when the journal or its files changed since.
          const plan = planSaveRecovery(io);
          const r = await runSaveRecovery(io, rev, mode?.done === true ? 'finish' : 'undo');
          const inDef = (p: string): string => f.scrub(`.bowerloom/${p}`);
          const deleted = new Set(plan.undo.filter(u => u.action === 'delete').map(u => u.path));
          plans.clear(f.id, 'projection'); plans.clear(f.id, 'save'); plans.clear(f.id, 'restore');
          const kept = r.kept.map(k => inDef(k.path));
          return {
            removed: r.undone.filter(p => deleted.has(p)).map(inDef), restored: r.undone.filter(p => !deleted.has(p)).map(inDef), kept, leftFolders: r.leftFolders.map(inDef),
            revision: r.revision, check: checkOf(plan.check.map(inDef), kept),
          };
        }
        if (kind === 'merge') {
          const plan = planInstructionMergeRecovery(io);
          const r = await applyInstructionMergeRecovery(io, rev);
          const kept = r.kept.map(k => f.scrub(k.path));
          return { removed: [], restored: r.restored.map(f.scrub), kept, leftFolders: r.leftFolders.map(f.scrub), revision: revisionNow(f), check: checkOf(plan.check.map(f.scrub), kept) };
        }
        const plan = planAdoptionRecovery(io);
        const r = await applyAdoptionRecovery(io, rev);
        const kept = r.kept.map(k => f.scrub(k.path));
        return { removed: r.removed.map(f.scrub), restored: [], kept, leftFolders: r.leftFolders.map(f.scrub), revision: revisionNow(f), check: checkOf(plan.check.map(f.scrub), kept) };
      }));
    }),
    planProjection: (id, input) => serial(async () => {
      const f = folderOf(id), i = checkProjectInput(input);
      const a = await planned(f, 'projection', () => { refusePreview(i); return planProjectionNow(f, i); });
      if (a.ok || a.refusal.code !== 'PORTABLE_DRIFT') return a;
      // A file Bowerloom wrote changed since: the window shows each one with why, and offers to keep the person's version.
      let drift: ReturnType<typeof portableDrift> = [];
      try { drift = portableDrift({ projectDir: f.dir, stateDir: f.portableState }); } catch { drift = []; }
      return { ok: false, refusal: { ...a.refusal, drift: drift.map(d => ({ path: f.scrub(d.path), reason: d.reason })) } };
    }),
    runProjection: (id, revision, input) => serial(async () => {
      const f = folderOf(id), rev = revisionArg(revision), i = checkProjectInput(input);
      const stopped = await answer(f, () => { whileStopped(f); refusePreview(i); });
      if (!stopped.ok) { record({ kind: 'scenario', step: 'install', outcome: 'refused', code: stopped.refusal.code }); return stopped; }
      const engines = ENGINE_IDS.filter(e => (e === 'claude-code' || e === 'codex') && i.engines.includes(e));
      return written(f, 'projection', rev, i, () => scenarioOf(f, { ...(engines.length === 2 ? { scenario: 'S2' } : {}), step: 'install', engines, plan: rev, target: true }, async () => {
        // Main's dialog said yes: only now do the lines the person ticked become drafts on disk.
        await keepTicks(f, i.approve);
        const io = portableInput(f, i, approvalsFor(f, i.approve).approvals);
        const plan = planPortable(io);
        const r = await applyPortable(io, rev);
        // The receipt now records the approvals this install used, so their drafts go (D3A). The install itself is done: a draft that stays is never
        // wrong, since a draft counts only for its unchanged entry, and the next install drops it. The window is told.
        const warnings: string[] = [];
        try {
          const recorded = r.receipt?.approvals ?? readPortableReceipt({ projectDir: f.dir, stateDir: f.portableState })?.approvals ?? [];
          await dropApprovalDraftsLocked(f.dirs, f.dir, recorded);
        } catch (error) { warnings.push(draftsWarning(error)); }
        const writes = plan.changes.filter(c => c.action !== 'unchanged' && c.action !== 'take-over' && !keepsFile(c));
        return {
          noop: r.noop, written: writes.map(c => f.scrub(c.path)), takenOver: plan.changes.filter(c => c.action === 'take-over').map(c => f.scrub(c.path)),
          leftBehind: r.leftBehind.map(l => f.scrub(l.path)), ...(warnings.length ? { warnings } : {}),
        };
      }));
    }),
    planRemoval: id => serial(async () => {
      const f = folderOf(id);
      return planned(f, 'removal', () => {
        whileStopped(f);
        const plan = planPortableRemoval({ projectDir: f.dir, stateDir: f.portableState });
        const restores = plan.changes.filter(c => c.action === 'restore' && !keepsFile(c)).length, deletes = plan.changes.filter(c => c.action === 'delete').length;
        return { value: removalView(plan, f.scrub), revision: plan.revision, choices: null, ask: ASK.removal(f.label, deletes, restores, plan.revision) };
      });
    }),
    runRemoval: (id, revision) => serial(async () => {
      const f = folderOf(id), rev = revisionArg(revision);
      const stopped = await answer(f, () => whileStopped(f));
      if (!stopped.ok) { record({ kind: 'scenario', scenario: 'S5', step: 'remove', outcome: 'refused', code: stopped.refusal.code }); return stopped; }
      return written(f, 'removal', rev, null, () => scenarioOf(f, { scenario: 'S5', step: 'remove' }, async () => {
        const r = await applyPortableRemoval({ projectDir: f.dir, stateDir: f.portableState }, rev);
        made.delete(f.id); shown.delete(f.id);
        // Nothing is installed now, so no draft of this folder stands for anything (D3A). The removal itself is done; a draft that stays is never wrong,
        // and the window is told.
        const warnings: string[] = [];
        try { await dropApprovalDraftsLocked(f.dirs, f.dir); } catch (error) { warnings.push(draftsWarning(error)); }
        return { restored: r.restored.map(f.scrub), kept: r.kept.map(f.scrub), deleted: r.deleted.map(f.scrub), leftBehind: r.leftBehind.map(l => f.scrub(l.path)), ...(warnings.length ? { warnings } : {}) };
      }));
    }),
    planRecovery: (id, choices) => serial(async () => {
      const f = folderOf(id), c = checkRecoveryChoices(choices);
      return planned(f, 'recovery', () => {
        const plan = planPortableRecovery(recoveryInput(f, c));
        const ask = plan.action === 'mode' ? ASK.modes(f.label, plan.modes.length, plan.revision) : ASK.recovery(f.label, plan.steps.length, plan.action, plan.revision);
        return { value: recoveryView(plan, f.scrub), revision: plan.revision, choices: c, ask };
      });
    }),
    runRecovery: (id, revision, choices) => serial(async () => {
      const f = folderOf(id), rev = revisionArg(revision), c = checkRecoveryChoices(choices);
      return written(f, 'recovery', rev, c, () => scenarioOf(f, { scenario: 'S5', step: 'recover' }, async () => {
        const r = await applyPortableRecovery(recoveryInput(f, c), rev);
        return { leftBehind: r.leftBehind.map(l => f.scrub(l.path)) };
      }));
    }),
    planMerge: id => serial(async () => {
      const f = folderOf(id);
      return planned(f, 'merge', () => {
        whileSaveStopped(f);
        const plan = planInstructionMerge({ projectDir: f.dir, stateDir: f.adoptState });
        return { value: mergeView(plan, f.label, claudeText(f, plan), f.scrub), revision: plan.revision, choices: null, ask: ASK.merge(f.label, plan.files.length, plan.revision) };
      });
    }),
    runMerge: (id, revision) => serial(async () => {
      const f = folderOf(id), rev = revisionArg(revision);
      const stopped = await answer(f, () => whileSaveStopped(f));
      if (!stopped.ok) return stopped;
      return written(f, 'merge', rev, null, async () => {
        const r = await applyInstructionMerge({ projectDir: f.dir, stateDir: f.adoptState }, rev);
        // The definition changed, so an install plan or a save plan shown before the Merge can no longer be written.
        plans.clear(f.id, 'projection'); plans.clear(f.id, 'save'); plans.clear(f.id, 'restore');
        return { written: r.written.map(f.scrub) };
      });
    }),
    planSave: (id, edits) => serial(async () => {
      const f = folderOf(id), e = checkSaveEdits(edits);
      return planned(f, 'save', () => {
        const { plan, target } = saveNow(f, e);
        const value: SaveView = saveView(f, plan, target);
        return { value, revision: plan.revision, choices: e, ask: value.noop ? null : ASK.save(f.label, plan.changes.length, plan.revision) };
      });
    }),
    runSave: (id, revision, edits) => serial(async () => {
      const f = folderOf(id), rev = revisionArg(revision), e = checkSaveEdits(edits);
      const stopped = await answer(f, () => whileStopped(f));
      if (!stopped.ok) return stopped;
      return written(f, 'save', rev, e, () => scenarioOf(f, { step: 'save' }, async () => {
        // The target is made again from the harness as it is now; when it changed since the plan, the package's revision check refuses the write.
        const { target } = saveNow(f, e);
        return saveAndKeep(f, rev, target, n => savedLabel(n));
      }));
    }),
    listVersions: id => serial(async () => {
      const f = folderOf(id);
      return answer(f, () => versionViews(f.dirs, currentDefinition(f.dir)));
    }),
    planRestore: (id, version) => serial(async () => {
      const f = folderOf(id), v = versionArg(version);
      return planned(f, 'restore', () => {
        whileStopped(f);
        const def = currentDefinition(f.dir);
        const stored = readVersion(f.dirs, VERSION_KEY, v);
        const plan = packagePlanSave(saveIo(f), stored.files);
        if (plan.changes.length > 0) keepable(def.files, stored.files);
        const value: RestoreView = { ...saveView(f, plan, stored.files), version: viewOf(stored.entry, def) };
        return { value, revision: plan.revision, choices: { version: v }, ask: value.noop ? null : ASK.restore(f.label, plan.changes.length, v, plan.revision) };
      });
    }),
    runRestore: (id, revision, version) => serial(async () => {
      const f = folderOf(id), rev = revisionArg(revision), v = versionArg(version);
      const stopped = await answer(f, () => whileStopped(f));
      if (!stopped.ok) return stopped;
      return written(f, 'restore', rev, { version: v }, () => scenarioOf(f, { step: 'restore' }, async () => {
        // The save point is read again, checked against its hashes; a changed store or harness changes the plan revision, and the package refuses.
        const stored = readVersion(f.dirs, VERSION_KEY, v);
        return saveAndKeep(f, rev, stored.files, () => wentBackLabel(v));
      }));
    }),
    planSetAside: id => serial(async () => {
      const f = folderOf(id);
      return planned(f, 'set-aside', () => {
        const plan = planSetAsideVersions(f.dirs);
        const value: SetAsideView = { folder: f.label, damaged: plan.damaged, revision: plan.revision };
        return { value, revision: plan.revision, choices: null, ask: ASK.setAside(f.label, plan.revision) };
      });
    }),
    runSetAside: (id, revision) => serial(async () => {
      const f = folderOf(id), rev = revisionArg(revision);
      return written(f, 'set-aside', rev, null, () => scenarioOf(f, { step: 'set-aside' }, async () => {
        // The store plans again under the project lock and moves nothing when it changed since the plan. Nothing is deleted.
        const r = await setAsideVersionsLocked(f.dirs, f.dir, rev, now());
        plans.clear(f.id, 'restore');
        return { name: r.name };
      }));
    }),
    recordCheck: (answer, note) => serial(async () => {
      const c = checkCheckArgs(answer, note);
      // At most 10 a minute: over the cap nothing is written.
      const at = now().getTime();
      while (checkTimes.length > 0 && at - checkTimes[0]! >= 60_000) checkTimes.shift();
      if (checkTimes.length >= CHECKS_PER_MINUTE) return false;
      checkTimes.push(at);
      try { return deps.record?.({ source: 'app', kind: 'check', answer: c.answer, ...(c.note === undefined ? {} : { note: c.note }) }) === true; } catch (error) { console.error('Bowerloom could not record the check.', error); return false; }
    }),
    chooseNotesFolder: purpose => serial(async () => {
      const p = purposeArg(purpose);
      const picked = deps.chooseNotesFolder === undefined ? null : await deps.chooseNotesFolder(p);
      if (picked === null) return null;
      const s = makeScrub(homes.map(path => ({ path, as: '~' })));
      try {
        if (typeof picked !== 'string' || !isAbsolute(picked) || picked.includes('\u0000')) return bad();
        const dir = realpathSync(picked);
        if (!lstatSync(dir).isDirectory()) return bad();
        checkProjectPath(dir, deps.home);
        const n = registerNotes(dir, { chosen: true });
        return await answer(n, () => notesView(n));
      } catch (error) {
        if (error instanceof EngineCallRefusal) return { ok: false, refusal: { code: 'NOT_A_FOLDER', message: 'That is not a folder Bowerloom can use. Choose a folder.', paths: [] } } as const;
        return { ok: false, refusal: refusalOf(error, s) } as const;
      }
    }),
    notesSummary: id => serial(async () => {
      const n = notesOf(id);
      return answer(n, () => notesView(n));
    }),
    planCreateNotes: id => serial(async () => {
      const n = notesOf(id);
      return planned(n, 'notes-starter', () => {
        chosenOnly(n);
        const kit = kitNow('wiki-keeper');
        const plan = planStarter(n.dir, kit.starter, notesOptions);
        const value: NotesStarterView = {
          notes: n.label, createsFolder: plan.createsFolder, folders: plan.folders.map(n.scrub), files: plan.files.map(f => ({ path: n.scrub(f.path), bytes: f.bytes })),
          kit: { id: kit.id, version: kit.version }, revision: plan.revision,
        };
        return { value, revision: plan.revision, choices: null, ask: ASK.notesStarter(n.label, plan.files.length, plan.revision) };
      });
    }),
    runCreateNotes: (id, revision) => serial(async () => {
      const n = notesOf(id), rev = revisionArg(revision);
      return written(n, 'notes-starter', rev, null, () => notesStep(n, 'notes-create', async () => {
        // The template is read from the kit again; when it changed since the plan, the package's revision check refuses the write.
        const r = await applyStarter(n.dir, rev, kitNow('wiki-keeper').starter, notesOptions);
        plans.clear(n.id, 'notes-history');
        return { files: r.files.length, committedAt: isoSeconds(new Date(r.committedAt)), clean: r.clean };
      }));
    }),
    planNotesHistory: id => serial(async () => {
      const n = notesOf(id);
      return planned(n, 'notes-history', () => {
        chosenOnly(n);
        const plan = planGitInit(n.dir, notesOptions);
        const value: NotesHistoryPlanView = {
          notes: n.label, files: plan.files.slice(0, NOTES_PLAN_LIST_LIMIT).map(f => ({ path: n.scrub(f.path), kind: f.kind })), count: plan.files.length, hidden: plan.hidden,
          revision: plan.revision,
        };
        return { value, revision: plan.revision, choices: null, ask: ASK.notesHistory(n.label, plan.files.length, plan.revision) };
      });
    }),
    runNotesHistory: (id, revision) => serial(async () => {
      const n = notesOf(id), rev = revisionArg(revision);
      return written(n, 'notes-history', rev, null, () => notesStep(n, 'notes-history', async () => {
        // The package lists the folder again and refuses NOTES_STALE, before it runs git, when anything changed since the plan.
        const r = await applyGitInit(n.dir, rev, notesOptions);
        plans.clear(n.id, 'notes-starter');
        return { files: r.files.length, committedAt: isoSeconds(new Date(r.committedAt)), clean: r.clean };
      }));
    }),
  };
}
