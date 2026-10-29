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
 *    record of the earlier app there once when the folder is chosen, and shares the approval drafts of fidelity lines with the command line (D2A, D3A).
 * Nothing here writes a file itself. The handler takes its tools as arguments, so a test runs it on synthetic folders with no Electron.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { applyAdoption, applyAdoptionRecovery, planAdoptionRecovery } from '../../../packages/adoption/src/index.js';
import {
  applyInstructionMerge, applyInstructionMergeRecovery, mergeStopped, planInstructionMerge, planInstructionMergeRecovery, refuseWhileStopped,
} from '../../../packages/adoption/src/merge.js';
import type { InstructionMergePlan } from '../../../packages/adoption/src/merge.js';
import type { AdoptionInput, AdoptionPlan } from '../../../packages/adoption/src/index.js';
import { planWithBytes as planAdoptionWithBytes } from '../../../packages/adoption/src/plan.js';
import { readJournal } from '../../../packages/adoption/src/journal.js';
import {
  applyPortable, applyPortableRecovery, applyPortableRemoval, planPortable, planPortableRecovery, planPortableRemoval, portableDrift, readPortableReceipt,
} from '../../../packages/project-sync/src/index.js';
import type { PortableInput } from '../../../packages/project-sync/src/index.js';
import { pendingExists } from '../../../packages/project-sync/src/portable-state.js';
import { harnessStateDirs, settleLegacyState } from '../../../packages/project-sync/src/harness-state.js';
import type { HarnessStateDirs } from '../../../packages/project-sync/src/harness-state.js';
import { addApprovalDraftLocked, dropApprovalDraftsLocked, readApprovalDrafts } from '../../../packages/project-sync/src/harness-approvals.js';
import { entryHash, loadDefinition } from '../../../packages/harness-definition/src/index.js';
import type { Definition, FidelityApproval } from '../../../packages/harness-definition/src/index.js';
import { checkProjectPath } from '../../../packages/project-context/src/index.js';
import { labelOf, makeScrub, visible } from '../shared/engine/scrub.js';
import type { Scrub } from '../shared/engine/scrub.js';
import { ENGINE_IDS, isEngineId } from '../shared/engine/engines.js';
import { EVERY_ENGINE_PARTS, RECONCILE } from '../shared/engine/types.js';
import type {
  AdoptApproval, AdoptChoices, AdoptRecovered, AdoptRecoveryView, AdoptView, AdoptWritten, Answer, ApproveLineView, EngineId, EveryEnginePart, FolderInfo, MergeView, MergeWritten,
  ProjectAnswer, ProjectInput, ProjectWritten, Recovered, RecoveryChoices, RecoveryView, Refusal, RemovalView, Removed,
} from '../shared/engine/types.js';
import { adoptRecoveryView, adoptionView, approveKey, approveLine, keepsFile, mergeRecoveryView, mergeView, projectView, recoveryView, removalView } from '../shared/engine/view.js';
import { ASK, ShownPlans, approvalText, cancelled, canonical, hashOf, notTheShownPlan } from './engine-consent.js';
import type { Ask } from './engine-consent.js';

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

/** A refusal of a package, as words the window shows. An error that is not a refusal says only that the call failed. */
export function refusalOf(error: unknown, s: Scrub): Refusal {
  const e = error as { code?: unknown; message?: unknown; paths?: unknown } | null;
  if (e !== null && typeof e === 'object' && typeof e.code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(e.code) && typeof e.message === 'string') {
    const paths = Array.isArray(e.paths) ? e.paths.filter((p): p is string => typeof p === 'string').slice(0, 50).map(s) : [];
    return { code: e.code, message: s(e.message), paths };
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
  const answer = async <T>(f: Folder | null, run: () => Promise<T> | T): Promise<Answer<T>> => {
    try { return { ok: true, value: await run() }; } catch (error) {
      if (error instanceof EngineCallRefusal) throw error;
      return { ok: false, refusal: refusalOf(error, f?.scrub ?? makeScrub(homes.map(path => ({ path, as: '~' })))) };
    }
  };
  /** Plans, records the plan as the one shown last of its kind, and clears that record when the plan fails. */
  const planned = async <T>(f: Folder, kind: Parameters<ShownPlans['set']>[1], run: () => { value: T; revision: string; choices: unknown; ask: Ask | null } | { value: T; revision: null }): Promise<Answer<T>> => {
    plans.clear(f.id, kind);
    return answer(f, () => {
      const r = run();
      if (r.revision !== null) plans.set(f.id, kind, { revision: r.revision, choices: canonical((r as { choices: unknown }).choices), ask: (r as { ask: Ask | null }).ask });
      return r.value;
    });
  };
  /** Runs a write only for the plan shown last with these choices, after main's own dialog and the person's yes. */
  const written = async <T>(f: Folder, kind: Parameters<ShownPlans['set']>[1], revision: string, choices: unknown, run: () => Promise<T>): Promise<Answer<T>> => {
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

  /** True when a Merge stopped part way here: its journal is in the adoption state folder (decision D4A). */
  const mergeIsStopped = (f: Folder): boolean => mergeStopped(f.adoptState);
  /** Install, removal, and a tick wait while an adoption or a Merge is stopped: they would run on a half-written or half-merged definition. */
  const whileStopped = (f: Folder): void => refuseWhileStopped(f.adoptState);
  /** Which stopped run the recovery of a stopped harness settles: an adoption first, as the packages refuse in that order, else a Merge. */
  function stoppedKind(f: Folder): 'adoption' | 'merge' {
    let adoption: boolean;
    try { adoption = readJournal(f.adoptState, f.dir) !== null; } catch { adoption = true; }
    return !adoption && mergeIsStopped(f) ? 'merge' : 'adoption';
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
    try { projected = readPortableReceipt(io) !== null; } catch { projected = false; }
    try { projection = pendingExists(f.portableState); } catch { projection = false; }
    try { adoption = readJournal(f.adoptState, f.dir) !== null; } catch { adoption = false; }
    adoption ||= mergeIsStopped(f);
    return { id: f.id, label: f.label, name: f.scrub(basename(f.dir)), hasDefinition, engines, previewEngines, problem, projected, unfinished: { projection, adoption } };
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
      return written(f, 'adoption', rev, shownPicks, async () => {
        const r = await applyAdoption(adoptInput(f, c.picks, c.acknowledged.map(a => a.id), c.everyEngine), rev, list.map(a => a.key));
        return { written: r.written.map(p => f.scrub(`.bowerloom/${p}`)) };
      });
    }),
    planAdoptionRecovery: id => serial(async () => {
      const f = folderOf(id), io = { projectDir: f.dir, stateDir: f.adoptState };
      return planned(f, 'adoption-recovery', () => {
        if (stoppedKind(f) === 'merge') {
          const plan = planInstructionMergeRecovery(io);
          return { value: mergeRecoveryView(plan, f.scrub), revision: plan.revision, choices: null, ask: ASK.mergeRecovery(f.label, plan.restore.length, plan.revision) };
        }
        const plan = planAdoptionRecovery(io);
        return { value: adoptRecoveryView(plan, f.scrub), revision: plan.revision, choices: null, ask: ASK.adoptionRecovery(f.label, plan.remove.length, plan.revision) };
      });
    }),
    runAdoptionRecovery: (id, revision) => serial(async () => {
      const f = folderOf(id), rev = revisionArg(revision), io = { projectDir: f.dir, stateDir: f.adoptState };
      return written(f, 'adoption-recovery', rev, null, async () => {
        // The kind is read again here. When the stopped run changed since the plan, the package's own revision check refuses the write.
        if (stoppedKind(f) === 'merge') {
          const r = await applyInstructionMergeRecovery(io, rev);
          return { removed: [], restored: r.restored.map(f.scrub), kept: r.kept.map(k => f.scrub(k.path)), leftFolders: r.leftFolders.map(f.scrub) };
        }
        const r = await applyAdoptionRecovery(io, rev);
        return { removed: r.removed.map(f.scrub), restored: [], kept: r.kept.map(k => f.scrub(k.path)), leftFolders: r.leftFolders.map(f.scrub) };
      });
    }),
    planProjection: (id, input) => serial(async () => {
      const f = folderOf(id), i = checkProjectInput(input);
      const a = await planned(f, 'projection', () => planProjectionNow(f, i));
      if (a.ok || a.refusal.code !== 'PORTABLE_DRIFT') return a;
      // A file Bowerloom wrote changed since: the window shows each one with why, and offers to keep the person's version.
      let drift: ReturnType<typeof portableDrift> = [];
      try { drift = portableDrift({ projectDir: f.dir, stateDir: f.portableState }); } catch { drift = []; }
      return { ok: false, refusal: { ...a.refusal, drift: drift.map(d => ({ path: f.scrub(d.path), reason: d.reason })) } };
    }),
    runProjection: (id, revision, input) => serial(async () => {
      const f = folderOf(id), rev = revisionArg(revision), i = checkProjectInput(input);
      const stopped = await answer(f, () => whileStopped(f));
      if (!stopped.ok) return stopped;
      return written(f, 'projection', rev, i, async () => {
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
      });
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
      if (!stopped.ok) return stopped;
      return written(f, 'removal', rev, null, async () => {
        const r = await applyPortableRemoval({ projectDir: f.dir, stateDir: f.portableState }, rev);
        made.delete(f.id); shown.delete(f.id);
        // Nothing is installed now, so no draft of this folder stands for anything (D3A). The removal itself is done; a draft that stays is never wrong,
        // and the window is told.
        const warnings: string[] = [];
        try { await dropApprovalDraftsLocked(f.dirs, f.dir); } catch (error) { warnings.push(draftsWarning(error)); }
        return { restored: r.restored.map(f.scrub), kept: r.kept.map(f.scrub), deleted: r.deleted.map(f.scrub), leftBehind: r.leftBehind.map(l => f.scrub(l.path)), ...(warnings.length ? { warnings } : {}) };
      });
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
      return written(f, 'recovery', rev, c, async () => {
        const r = await applyPortableRecovery(recoveryInput(f, c), rev);
        return { leftBehind: r.leftBehind.map(l => f.scrub(l.path)) };
      });
    }),
    planMerge: id => serial(async () => {
      const f = folderOf(id);
      return planned(f, 'merge', () => {
        const plan = planInstructionMerge({ projectDir: f.dir, stateDir: f.adoptState });
        return { value: mergeView(plan, f.label, claudeText(f, plan), f.scrub), revision: plan.revision, choices: null, ask: ASK.merge(f.label, plan.files.length, plan.revision) };
      });
    }),
    runMerge: (id, revision) => serial(async () => {
      const f = folderOf(id), rev = revisionArg(revision);
      return written(f, 'merge', rev, null, async () => {
        const r = await applyInstructionMerge({ projectDir: f.dir, stateDir: f.adoptState }, rev);
        // The definition changed, so an install plan shown before the Merge can no longer be written.
        plans.clear(f.id, 'projection');
        return { written: r.written.map(f.scrub) };
      });
    }),
  };
}

