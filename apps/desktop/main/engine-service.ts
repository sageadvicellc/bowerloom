/**
 * The main-process side of adoption and the projection for the harness-first window (--prototype-v3-real). It is the only place the window's adopt and install
 * sheets reach the packages. It:
 *  - knows folders only by the id it handed out when the person chose the folder in the system chooser, so the window never names a path;
 *  - plans with the packages and hands back plain views (shared/engine/view.ts) with every path of the person written as `~` or the folder's label;
 *  - writes only through the packages' own apply calls, each with the revision of a plan the person approved; the package plans again under the project
 *    lock and writes only when the revision is the same;
 *  - makes a fidelity approval record only for a line it showed the window and the person ticked, and keeps that record for the session, so a plan and
 *    its write carry the same record;
 *  - runs one call at a time, in order.
 * Nothing here writes a file itself. The handler takes its tools as arguments, so a test runs it on synthetic folders with no Electron.
 */
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { applyAdoption, applyAdoptionRecovery, planAdoption, planAdoptionRecovery } from '../../../packages/adoption/src/index.js';
import type { AdoptionInput } from '../../../packages/adoption/src/index.js';
import { readJournal } from '../../../packages/adoption/src/journal.js';
import {
  applyPortable, applyPortableRecovery, applyPortableRemoval, planPortable, planPortableRecovery, planPortableRemoval, portableDrift, readPortableReceipt,
} from '../../../packages/project-sync/src/index.js';
import type { PortableInput } from '../../../packages/project-sync/src/index.js';
import { pendingExists } from '../../../packages/project-sync/src/portable-state.js';
import { entryHash, loadDefinition } from '../../../packages/harness-definition/src/index.js';
import type { Definition, FidelityApproval } from '../../../packages/harness-definition/src/index.js';
import { checkProjectPath } from '../../../packages/project-context/src/index.js';
import { labelOf, makeScrub } from '../shared/engine/scrub.js';
import type { Scrub } from '../shared/engine/scrub.js';
import { ENGINE_IDS, RECONCILE, isEngineId } from '../shared/engine/types.js';
import type {
  AdoptChoices, AdoptRecovered, AdoptRecoveryView, AdoptView, AdoptWritten, Answer, ApproveLineView, EngineId, FolderInfo, ProjectAnswer, ProjectInput,
  ProjectWritten, Recovered, RecoveryView, Refusal, RemovalView, Removed,
} from '../shared/engine/types.js';
import { adoptRecoveryView, adoptionView, approveLines, lineKey, projectView, recoveryView, removalView } from '../shared/engine/view.js';

export interface EngineServiceDeps {
  /** The home folder. Paths below it are shown with `~`. */
  readonly home: string;
  /** The private state root (`$XDG_STATE_HOME/bowerloom` or `~/.local/state/bowerloom`). Each folder gets its own state folders below it. */
  readonly stateRoot: string;
  /** Opens the system folder chooser, or answers the folder a test set. Null when the person closed it. */
  readonly chooseFolder: () => Promise<string | null>;
  /** Who approves a line, as the approval record names the person. */
  readonly who: string;
  readonly now?: () => Date;
}

/** A call the service refuses before it reaches a package: the window gets only the short code. */
export class EngineCallRefusal extends Error {
  constructor(readonly code: 'BAD_ARGUMENT' | 'UNKNOWN_FOLDER') { super(code); this.name = 'EngineCallRefusal'; }
}

interface Folder { readonly id: string; readonly dir: string; readonly label: string; readonly scrub: Scrub; readonly adoptState: string; readonly portableState: string }
/** A line the window was shown in a fidelity refusal, with the hash of its entry at that moment. */
interface Shown { readonly line: ApproveLineView; readonly raw: { part: string; entry: string; field?: string; engine: string; result: 'weakened' | 'absent'; reason: string }; readonly hash: string }

const ID = /^folder-[0-9]{1,6}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const safeString = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !v.includes('\u0000');
const bad = (): never => { throw new EngineCallRefusal('BAD_ARGUMENT'); };
const stringList = (v: unknown, max = 2000): string[] => (Array.isArray(v) && v.length <= max && v.every(x => safeString(x)) ? [...v as string[]] : bad());
const revisionArg = (v: unknown): string => (typeof v === 'string' && HEX64.test(v) ? v : bad());
/** An ISO time with whole seconds, never later than the clock, as the approval records want it. */
const isoSeconds = (d: Date): string => new Date(Math.floor(d.getTime() / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function checkChoices(v: unknown): AdoptChoices {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return bad();
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some(k => k !== 'picks' && k !== 'acknowledged')) return bad();
  const picks = o.picks;
  if (picks === null || typeof picks !== 'object' || Array.isArray(picks)) return bad();
  const entries = Object.entries(picks as Record<string, unknown>);
  if (entries.length > 2000 || entries.some(([k, x]) => !safeString(k, 1024) || !safeString(x, 1024))) return bad();
  return { picks: Object.fromEntries(entries) as Record<string, string>, acknowledged: stringList(o.acknowledged) };
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

/** A refusal of a package, as words the window shows. An error that is not a refusal says only that the call failed. */
export function refusalOf(error: unknown, s: Scrub): Refusal {
  const e = error as { code?: unknown; message?: unknown; paths?: unknown } | null;
  if (e !== null && typeof e === 'object' && typeof e.code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(e.code) && typeof e.message === 'string') {
    const paths = Array.isArray(e.paths) ? e.paths.filter((p): p is string => typeof p === 'string').slice(0, 50).map(s) : [];
    return { code: e.code, message: s(e.message), paths };
  }
  return { code: 'FAILED', message: 'Bowerloom could not finish this. Nothing more was changed.', paths: [] };
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
  planRecovery(folderId: unknown, keep: unknown): Promise<Answer<RecoveryView>>;
  runRecovery(folderId: unknown, revision: unknown, keep: unknown): Promise<Answer<Recovered>>;
}

export function createEngineService(deps: EngineServiceDeps): EngineService {
  const now = deps.now ?? (() => new Date());
  const realHome = (() => { try { return realpathSync(deps.home); } catch { return deps.home; } })();
  const homes = [...new Set([deps.home, realHome])];
  const byId = new Map<string, Folder>();
  /** The lines each folder's window was shown, and the approval records made when the person ticked them. Both live for the session only. */
  const shown = new Map<string, Map<string, Shown>>();
  const made = new Map<string, Map<string, FidelityApproval>>();
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

  function register(dir: string): Folder {
    for (const f of byId.values()) if (f.dir === dir) return f;
    count += 1;
    const id = `folder-${count}`, label = labelOf(dir, homes.find(h => dir === h || dir.startsWith(`${h}/`)) ?? deps.home);
    const key = createHash('sha256').update(dir).digest('hex').slice(0, 32);
    const base = join(deps.stateRoot, 'desktop', key);
    const scrub = makeScrub([{ path: dir, as: label }, ...homes.map(path => ({ path, as: '~' })), { path: base, as: '(the private state folder)' }]);
    const f: Folder = { id, dir, label, scrub, adoptState: join(base, 'adoption'), portableState: join(base, 'portable') };
    byId.set(id, f);
    return f;
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
    return { id: f.id, label: f.label, name: f.scrub(basename(f.dir)), hasDefinition, engines, problem, projected, unfinished: { projection, adoption } };
  }

  const adoptInput = (f: Folder, c: AdoptChoices): AdoptionInput => ({
    projectDir: f.dir, stateDir: f.adoptState,
    choices: Object.fromEntries(Object.entries(c.picks).map(([k, pick]) => [k, { pick }])),
    acknowledged: c.acknowledged,
  });

  /** The definition's entries by part, as the fidelity check finds them, for the hash an approval binds. */
  function entryOf(def: Definition, part: string, entry: string): object | undefined {
    const e = def.entries;
    const list: readonly { id: string }[] = part === 'skills' ? e.skills : part === 'subagents' ? e.subagents : part === 'guardrails' ? [...e.rules, ...e.sandbox] : part === 'hooks' ? e.hooks : part === 'mcp' ? e.mcp : [];
    return list.find(x => x.id === entry);
  }

  /** The approvals of one plan: those the receipt recorded, and those the person ticked in this sheet, each made once from a line the window was shown. */
  function approvalsFor(f: Folder, keys: readonly string[]): FidelityApproval[] {
    const lines = shown.get(f.id) ?? new Map<string, Shown>(), records = made.get(f.id) ?? new Map<string, FidelityApproval>();
    made.set(f.id, records);
    const out: FidelityApproval[] = [];
    for (const key of keys) {
      const line = lines.get(key);
      if (line === undefined) return bad();
      let record = records.get(key);
      if (record === undefined || record.entryHash !== line.hash) {
        const reason = `Approved in the Bowerloom app after reading this line: ${line.raw.reason}`.slice(0, 4096);
        record = { part: line.raw.part as FidelityApproval['part'], entry: line.raw.entry, ...(line.raw.field === undefined ? {} : { field: line.raw.field }), engine: line.raw.engine as EngineId, result: line.raw.result, entryHash: line.hash, who: deps.who, when: isoSeconds(now()), reason };
        records.set(key, record);
      }
      out.push(record);
    }
    let recorded: readonly FidelityApproval[] = [];
    try { recorded = readPortableReceipt({ projectDir: f.dir, stateDir: f.portableState })?.approvals ?? []; } catch { recorded = []; }
    const mine = new Set(out.map(a => lineKey(a)));
    return [...recorded.filter(a => !mine.has(lineKey(a))), ...out];
  }

  const portableInput = (f: Folder, input: ProjectInput): PortableInput => ({
    projectDir: f.dir, definitionFolder: join(f.dir, '.bowerloom'), stateDir: f.portableState,
    engines: input.engines.map(id => ({ id })), reconcile: input.reconcile, approvals: approvalsFor(f, input.approve),
    ...(input.writeClaudeMd ? { writeClaudeMd: true } : {}),
  });

  function planProjectionNow(f: Folder, input: ProjectInput): ProjectAnswer {
    const io = portableInput(f, input);
    try {
      const plan = planPortable(io);
      let drift: ReturnType<typeof portableDrift> = [];
      try { drift = portableDrift({ projectDir: f.dir, stateDir: f.portableState }); } catch { drift = []; }
      return { kind: 'plan', plan: projectView(plan, f.label, drift, f.scrub) };
    } catch (error) {
      const refused = (error as { code?: unknown; refused?: unknown } | null);
      if (refused?.code !== 'PORTABLE_FIDELITY' || !Array.isArray(refused.refused)) throw error;
      const loaded = loadDefinition(join(f.dir, '.bowerloom'));
      if (!loaded.ok) throw error;
      const raw = refused.refused as { part: string; entry: string; field?: string; engine: string; result: 'weakened' | 'absent'; reason: string }[];
      const lines = shown.get(f.id) ?? new Map<string, Shown>();
      shown.set(f.id, lines);
      const views = approveLines(raw, f.scrub);
      raw.forEach((r, i) => {
        const entry = entryOf(loaded.definition, r.part, r.entry);
        if (entry !== undefined) lines.set(views[i]!.key, { line: views[i]!, raw: { part: r.part, entry: r.entry, ...(r.field === undefined ? {} : { field: r.field }), engine: r.engine, result: r.result, reason: r.reason } as Shown['raw'], hash: entryHash(entry) });
      });
      // The lines approved so far stay in the list, so the person sees every line this plan needs, ticked or not.
      const all = [...views];
      for (const key of input.approve) { const s = lines.get(key); if (s !== undefined && !all.some(l => l.key === key)) all.push(s.line); }
      return { kind: 'approve', lines: all, approvedSoFar: input.approve.filter(key => lines.has(key)) };
    }
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
        return { ok: true, value: info(register(dir)) } as const;
      } catch (error) {
        if (error instanceof EngineCallRefusal) return { ok: false, refusal: { code: 'NOT_A_FOLDER', message: 'That is not a folder Bowerloom can use. Choose a folder.', paths: [] } } as const;
        return { ok: false, refusal: refusalOf(error, s) } as const;
      }
    }),
    planAdoption: (id, choices) => serial(async () => {
      const f = folderOf(id), c = checkChoices(choices);
      return answer(f, () => adoptionView(planAdoption(adoptInput(f, c)), f.label, f.scrub));
    }),
    runAdoption: (id, revision, choices, approvals) => serial(async () => {
      const f = folderOf(id), rev = revisionArg(revision), c = checkChoices(choices), list = stringList(approvals);
      return answer(f, async () => { const r = await applyAdoption(adoptInput(f, c), rev, list); return { written: r.written.map(p => f.scrub(`.bowerloom/${p}`)) }; });
    }),
    planAdoptionRecovery: id => serial(async () => {
      const f = folderOf(id);
      return answer(f, () => adoptRecoveryView(planAdoptionRecovery({ projectDir: f.dir, stateDir: f.adoptState }), f.scrub));
    }),
    runAdoptionRecovery: (id, revision) => serial(async () => {
      const f = folderOf(id), rev = revisionArg(revision);
      return answer(f, async () => {
        const r = await applyAdoptionRecovery({ projectDir: f.dir, stateDir: f.adoptState }, rev);
        return { removed: r.removed.map(f.scrub), kept: r.kept.map(k => f.scrub(k.path)), leftFolders: r.leftFolders.map(f.scrub) };
      });
    }),
    planProjection: (id, input) => serial(async () => {
      const f = folderOf(id), i = checkProjectInput(input);
      const a = await answer(f, () => planProjectionNow(f, i));
      if (a.ok || a.refusal.code !== 'PORTABLE_DRIFT') return a;
      // A file Bowerloom wrote changed since: the window shows each one with why, and offers to keep the person's version.
      let drift: ReturnType<typeof portableDrift> = [];
      try { drift = portableDrift({ projectDir: f.dir, stateDir: f.portableState }); } catch { drift = []; }
      return { ok: false, refusal: { ...a.refusal, drift: drift.map(d => ({ path: f.scrub(d.path), reason: d.reason })) } };
    }),
    runProjection: (id, revision, input) => serial(async () => {
      const f = folderOf(id), rev = revisionArg(revision), i = checkProjectInput(input);
      return answer(f, async () => {
        const io = portableInput(f, i);
        const plan = planPortable(io);
        const r = await applyPortable(io, rev);
        return { noop: r.noop, written: plan.changes.filter(c => c.action !== 'unchanged').map(c => f.scrub(c.path)) };
      });
    }),
    planRemoval: id => serial(async () => {
      const f = folderOf(id);
      return answer(f, () => removalView(planPortableRemoval({ projectDir: f.dir, stateDir: f.portableState }), f.scrub));
    }),
    runRemoval: (id, revision) => serial(async () => {
      const f = folderOf(id), rev = revisionArg(revision);
      return answer(f, async () => {
        const r = await applyPortableRemoval({ projectDir: f.dir, stateDir: f.portableState }, rev);
        made.delete(f.id); shown.delete(f.id);
        return { restored: r.restored.map(f.scrub), deleted: r.deleted.map(f.scrub), leftBehind: r.leftBehind.map(l => f.scrub(l.path)) };
      });
    }),
    planRecovery: (id, keep) => serial(async () => {
      const f = folderOf(id), k = Array.isArray(keep) && keep.length === 0 ? [] : stringList(keep);
      return answer(f, () => recoveryView(planPortableRecovery({ projectDir: f.dir, stateDir: f.portableState, ...(k.length ? { keep: k } : {}) }), f.scrub));
    }),
    runRecovery: (id, revision, keep) => serial(async () => {
      const f = folderOf(id), rev = revisionArg(revision), k = Array.isArray(keep) && keep.length === 0 ? [] : stringList(keep);
      return answer(f, async () => {
        const r = await applyPortableRecovery({ projectDir: f.dir, stateDir: f.portableState, ...(k.length ? { keep: k } : {}) }, rev);
        return { leftBehind: r.leftBehind.map(l => f.scrub(l.path)) };
      });
    }),
  };
}
