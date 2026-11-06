/**
 * The Projects list on the person's own folders. Pure: no file, no clock, no call to main.
 *
 * A row is a project the read found, or a folder main knows that no project shows (one the person added). A folder holds one harness, in `.bowerloom`, so a row has
 * at most one harness, and the harness takes the folder's name. What a row says comes from the facts main gives for a folder it knows (`FolderInfo`) and from one
 * read-only plan of its install (`planStatus`). The button follows the worst of them:
 *  - no harness: Assign harness (not built yet; the screen says so);
 *  - a harness and no install: Install;
 *  - an install the harness has moved past: Update;
 *  - an install whose files changed or went, a stopped run, or a harness that does not load: Review.
 * A folder main does not know yet shows no state: the window holds no path, so the person chooses the folder first, and the sheet then reads it.
 */
import type { Answer, EngineId, FolderInfo, ProjectAnswer, ProjectInput } from '../engine/types.js';
import { ENGINE_NAMES } from '../engine/types.js';
import { isPreviewEngine } from '../engine/engines.js';
import type { HarnessPlace, InstallState, Project } from './types.js';

/** What one read-only plan of an install says: nothing to change, a change to make, or something to look at first. */
export type PlanStatus = 'current' | 'update' | 'review';
export type RowAction = 'assign' | 'install' | 'update' | 'review';
/** The sheet a button opens: the install sheet, its recovery plan, or the sheet that makes the folder's harness (it also settles a stopped one). */
export type RowOpens = 'install' | 'recover' | 'make';

export interface RowEngine { readonly id: EngineId; readonly name: string; readonly state: InstallState }
export interface RealRow {
  /** The project's id, or the folder's id for a folder no project shows. */
  readonly id: string;
  readonly name: string;
  /** The folder in `~` form. */
  readonly path: string;
  /** The id main gave the folder, or null while main does not know it. */
  readonly folderId: string | null;
  readonly hasHarness: boolean;
  /** The worst state of the install, or null when there is no harness or main has not read the folder. */
  readonly state: InstallState | null;
  readonly engines: readonly RowEngine[];
  readonly action: RowAction | null;
  readonly opens: RowOpens;
}

const lastName = (text: string): string => text.split(/[\\/]/).filter(x => x !== '' && x !== '…').at(-1) ?? '';
const isHomeLabel = (label: string): boolean => label === '~' || label.startsWith('~/');

/**
 * True when a folder main knows (`label`) is the folder a row shows (`path`). A folder under home has a `~` label and must match exactly. A folder outside home is shown cut
 * down to `…/name`, so only the last name can be compared, and a folder under home is never it.
 */
export function sameFolder(path: string, label: string): boolean {
  if (path.startsWith('…')) { if (isHomeLabel(label)) return false; const want = lastName(path); return want !== '' && lastName(label) === want; }
  return path === label;
}

/** The plan answer as a status. A refusal is a review: the sheet shows the refusal in its own words. Lines to approve mean the harness moved on, so they are an update. */
export function planStatus(answer: Answer<ProjectAnswer>): PlanStatus {
  if (!answer.ok) return 'review';
  const value = answer.value;
  if (value.kind === 'approve') return 'update';
  if (value.plan.driftLines.length > 0) return 'review';
  return value.plan.noop ? 'current' : 'update';
}

const installable = (folder: FolderInfo, ids: readonly EngineId[]): EngineId[] => ids.filter(id => folder.previewEngines || !isPreviewEngine(id));

/**
 * The input of the read-only plan that tells whether an installed folder is up to date: the engines it was installed for (else the ones its harness lists), minus the
 * preview engines the app may not install to. It keeps the person's CLAUDE.md as it is, so a folder installed with Accept AGENTS.md or with Keep both reads the same.
 * Null when there is no engine to plan for.
 */
export function planInput(folder: FolderInfo): ProjectInput | null {
  const installed = installable(folder, folder.installedEngines);
  const engines = installed.length > 0 ? installed : installable(folder, folder.engines);
  return engines.length === 0 ? null : { engines, reconcile: 'keep-both', writeClaudeMd: false, approve: [] };
}

function rowOf(id: string, name: string, path: string, folder: FolderInfo | undefined, found: boolean, plans: ReadonlyMap<string, PlanStatus>): RealRow {
  const base = { id, name, path, folderId: folder?.id ?? null };
  if (folder === undefined) {
    return found ? { ...base, hasHarness: true, state: null, engines: [], action: 'install', opens: 'install' } : { ...base, hasHarness: false, state: null, engines: [], action: 'assign', opens: 'make' };
  }
  // A harness that was begun and stopped is settled in the sheet that made it.
  if (folder.unfinished.adoption) return { ...base, hasHarness: folder.hasDefinition, state: 'conflict', engines: [], action: 'review', opens: 'make' };
  if (!folder.hasDefinition) return { ...base, hasHarness: false, state: null, engines: [], action: 'assign', opens: 'make' };
  const plan = folder.projected ? plans.get(folder.id) : undefined;
  const stopped = folder.unfinished.projection, broken = folder.problem !== null;
  const overall: InstallState = stopped || broken || plan === 'review' ? 'conflict' : plan === 'update' ? 'out-of-date' : folder.projected ? 'installed' : 'not-installed';
  const listed = folder.engines, extra = folder.installedEngines.filter(e => !listed.includes(e));
  const engines: RowEngine[] = [...listed, ...extra]
    .filter(e => folder.installedEngines.includes(e) || folder.previewEngines || !isPreviewEngine(e))
    .map(e => ({ id: e, name: ENGINE_NAMES[e], state: folder.installedEngines.includes(e) ? overall : 'not-installed' }));
  // An engine the harness lists and the install never covered does not count against the install: the person may have left it out on purpose.
  const state = overall;
  const action: RowAction | null = state === 'conflict' ? 'review' : state === 'out-of-date' ? 'update' : state === 'not-installed' ? 'install' : null;
  return { ...base, hasHarness: true, state, engines, action, opens: stopped ? 'recover' : 'install' };
}

/**
 * The rows: one for each project, in the read's order, then one for each folder main knows that no project shows, in main's order. `harnessPlaces` are the folders the read
 * found a harness in; `plans` holds the status of each installed folder's plan, by folder id, once it has answered.
 */
export function projectRows(state: { readonly projects: readonly Project[]; readonly harnessPlaces?: readonly HarnessPlace[] }, folders: readonly FolderInfo[], plans: ReadonlyMap<string, PlanStatus>): RealRow[] {
  const used = new Set<string>();
  const rows = state.projects.map(p => {
    const folder = folders.find(f => sameFolder(p.path, f.label));
    if (folder !== undefined) used.add(folder.id);
    const found = (state.harnessPlaces ?? []).some(h => sameFolder(p.path, h.label));
    return rowOf(p.id, p.name, p.path, folder, found, plans);
  });
  for (const f of folders) if (!used.has(f.id)) rows.push(rowOf(f.id, f.name, f.label, f, false, plans));
  return rows;
}
