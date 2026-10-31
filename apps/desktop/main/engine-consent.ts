/**
 * What the main process holds a write to, apart from the packages' own revision check (ruling U16):
 *  - the write names the plan main returned last for that folder and that kind, in this session, with the very same choices and approvals;
 *  - main asks the person itself, in a native dialog with words it builds from its own record of that plan: the folder label, the file counts, and the
 *    short revision. The window cannot word that dialog, and cannot skip it.
 * Also the exact text each adoption approval covers (ruling U7), read from the bytes of the planned definition files.
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../packages/contracts/src/index.js';
import type { AdoptionPlan } from '../../../packages/adoption/src/index.js';
import { CANCELLED, NOT_THE_PLAN_SHOWN } from '../shared/engine/types.js';
import type { Refusal } from '../shared/engine/types.js';
import { visible } from '../shared/engine/scrub.js';

/** The kinds of plan a write can name. */
export type PlanKind = 'adoption' | 'projection' | 'removal' | 'recovery' | 'adoption-recovery' | 'merge' | 'save' | 'restore' | 'set-aside' | 'notes-starter' | 'notes-history';

/** Main's record of the last plan it returned: its revision, the choices it was made with (canonical JSON), and the words of the dialog. */
export interface ShownPlan { readonly revision: string; readonly choices: string; readonly ask: Ask | null }
/** The words of the dialog: a title, one question, and a detail line. `button` names the yes button when it is not "Write". */
export interface Ask { readonly title: string; readonly message: string; readonly detail: string; readonly button?: string }

export const hashOf = (value: unknown): string => createHash('sha256').update(canonicalJson(JSON.parse(JSON.stringify(value)))).digest('hex');
export const canonical = (value: unknown): string => canonicalJson(JSON.parse(JSON.stringify(value)));

export const notTheShownPlan = (): { ok: false; refusal: Refusal } => ({
  ok: false, refusal: { code: NOT_THE_PLAN_SHOWN, message: 'This is not the plan Bowerloom showed last for this folder, with these choices. Nothing was written. Plan again.', paths: [] },
});
export const cancelled = (): { ok: false; refusal: Refusal } => ({
  ok: false, refusal: { code: CANCELLED, message: 'Nothing was written. The confirmation was closed without a yes.', paths: [] },
});
/** The same for a dialog that opens a file rather than writing one. */
export const openCancelled = (): { ok: false; refusal: Refusal } => ({
  ok: false, refusal: { code: CANCELLED, message: 'Nothing was opened. The question was closed without a yes.', paths: [] },
});

const files = (n: number): string => `${n} ${n === 1 ? 'file' : 'files'}`;
const again = 'Bowerloom plans again first and stops if anything changed.';
/** The most file names a dialog lists; the rest are counted. */
const DIALOG_NAMES = 10;
const named = (paths: readonly string[]): string => (paths.length <= DIALOG_NAMES ? paths.join(', ') : `${paths.slice(0, DIALOG_NAMES).join(', ')} and ${paths.length - DIALOG_NAMES} more`);
/**
 * What a save or a go-back does to files that can run, for the detail line: the files whose bytes stay the same and whose execute bit alone changes, and
 * the files it writes that can run as programs. Nothing when neither holds.
 */
export interface SaveMarks { readonly executables?: readonly string[]; readonly modeOnly?: readonly string[] }
function marksLine(marks: SaveMarks): string {
  const run = marks.executables ?? [], mode = marks.modeOnly ?? [];
  const runLine = run.length === 0 ? '' : `${run.length === 1 ? 'This file can run as a program' : 'These files can run as programs'}: ${named(run)}. `;
  const modeLine = mode.length === 0 ? '' : `Only the permission to run changes: ${named(mode)}. `;
  return `${modeLine}${runLine}`;
}
/** What the person approved in this sheet, so the dialog says how many weaker lines the yes covers. Nothing when none were ticked. */
const approvedLines = (n: number): string => (n === 0 ? '' : `You approved ${n} ${n === 1 ? 'line' : 'lines'} that an interface carries more weakly than the harness says. `);

/** The words of each dialog, from main's own counts. */
export const ASK = Object.freeze({
  adoption: (label: string, n: number, rev: string): Ask => ({ title: 'Write the new harness', message: `Write ${files(n)} into ${label}/.bowerloom?`, detail: `From plan ${rev.slice(0, 8)}. Only .bowerloom changes. ${again}` }),
  projection: (label: string, n: number, rev: string, approved = 0): Ask => ({ title: 'Install the harness', message: `Write ${files(n)} in ${label}?`, detail: `From plan ${rev.slice(0, 8)}. ${approvedLines(approved)}Undo puts back what this replaces. ${again}` }),
  record: (label: string, rev: string, approved = 0): Ask => ({ title: 'Update the record', message: `Update Bowerloom's record for ${label}?`, detail: `From plan ${rev.slice(0, 8)}. ${approvedLines(approved)}No file in the folder changes; Bowerloom's private record of this install does. ${again}` }),
  removal: (label: string, deletes: number, restores: number, rev: string): Ask => ({ title: 'Remove what Bowerloom wrote', message: `Delete ${files(deletes)} and put back ${files(restores)} in ${label}?`, detail: `From plan ${rev.slice(0, 8)}. ${again}` }),
  recovery: (label: string, steps: number, action: string, rev: string): Ask => ({ title: 'Finish a stopped install', message: `${action === 'keep' ? 'Keep your versions' : action === 'complete' ? 'Finish the stopped run' : 'Take the stopped run back'} in ${label}?`, detail: `From plan ${rev.slice(0, 8)}, ${steps} ${steps === 1 ? 'step' : 'steps'}. ${again}` }),
  /** A recovery that settles mode drift lines (decision D5A): each mode goes back, or the record takes it. */
  modes: (label: string, n: number, rev: string): Ask => ({ title: 'Settle changed file modes', message: `Restore or keep ${n} file ${n === 1 ? 'mode' : 'modes'} in ${label}?`, detail: `From plan ${rev.slice(0, 8)}. ${again}` }),
  adoptionRecovery: (label: string, n: number, rev: string): Ask => ({ title: 'Finish a stopped harness', message: `Remove ${files(n)} that a stopped run left in ${label}/.bowerloom?`, detail: `From plan ${rev.slice(0, 8)}. ${again}` }),
  /** Merge (decision D4A): a definition edit only. CLAUDE.md changes later, in the install that accepts AGENTS.md. */
  merge: (label: string, n: number, rev: string): Ask => ({ title: 'Merge CLAUDE.md into the harness', message: `Write ${files(n)} into ${label}/.bowerloom?`, detail: `From plan ${rev.slice(0, 8)}. CLAUDE.md does not change yet. ${again}` }),
  mergeRecovery: (label: string, n: number, rev: string): Ask => ({ title: 'Finish a stopped harness', message: `Put back ${files(n)} that a stopped merge changed in ${label}/.bowerloom?`, detail: `From plan ${rev.slice(0, 8)}. ${again}` }),
  /** A save of the folder's own harness (option C). It changes only `.bowerloom`; the interfaces' files change later, in an install of its own. */
  save: (label: string, n: number, rev: string, marks: SaveMarks = {}): Ask => ({ title: 'Save the harness', message: `Change ${files(n)} in ${label}/.bowerloom?`, detail: `From plan ${rev.slice(0, 8)}. ${marksLine(marks)}Bowerloom keeps a save point, so you can go back. Installed files do not change until you install. ${again}` }),
  /** "Go back": a save whose target is a stored save point. */
  restore: (label: string, n: number, version: string, rev: string, marks: SaveMarks = {}): Ask => ({ title: 'Go back to a save point', message: `Go back to ${version} and change ${files(n)} in ${label}/.bowerloom?`, detail: `From plan ${rev.slice(0, 8)}. ${marksLine(marks)}Bowerloom keeps the harness as it is now as a save point too. Installed files do not change until you install. ${again}` }),
  /** Opens a private copy of the newest tidy-up report of a notes folder in the app the computer uses for it. Nothing in the notes folder is written. */
  openReport: (label: string, path: string): Ask => ({ title: 'Open the tidy-up report', message: `Open ${visible(path)} from ${visible(label)}?`, detail: 'It opens in the app your computer uses for .md files. Bowerloom changes nothing in the notes folder.', button: 'Open' }),
  /** Sets a folder's old save points aside: the record is renamed in Bowerloom's private folder; nothing in the folder changes and nothing is deleted. */
  setAside: (label: string, rev: string): Ask => ({ title: 'Set the old save points aside', message: `Set the old save points of ${label} aside and start a new record?`, detail: `From plan ${rev.slice(0, 8)}. Bowerloom renames its record to a dated name in its private folder and deletes nothing. Go back then starts from the next save. ${again}` }),
  /** A stopped save is taken back; a save that finished and only left its note (`done`) is kept, and changes no file. */
  saveRecovery: (label: string, n: number, rev: string, done = false): Ask => (done
    ? { title: 'Finish a stopped harness', message: `Keep the finished save in ${label}/.bowerloom?`, detail: `From plan ${rev.slice(0, 8)}. The save stays, and Bowerloom clears its note. No file changes. ${again}` }
    : { title: 'Finish a stopped harness', message: `Put back ${files(n)} that a stopped save changed in ${label}/.bowerloom?`, detail: `From plan ${rev.slice(0, 8)}. ${again}` }),
  /** "Start fresh" (spec 6.9): the kit's starter files into an empty notes folder, and one first commit. */
  notesStarter: (label: string, n: number, rev: string): Ask => ({ title: 'Start your notes', message: `Write ${files(n)} into ${label} and start its history?`, detail: `From plan ${rev.slice(0, 8)}. Bowerloom makes one first commit with git, and changes nothing else. ${again}` }),
  /** Version history for linked notes: git init, and one first commit of the files listed. No page changes. */
  notesHistory: (label: string, n: number, rev: string): Ask => ({ title: 'Start the history of your notes', message: `Start version history in ${label} with ${files(n)}?`, detail: `From plan ${rev.slice(0, 8)}. Bowerloom runs git init and makes one first commit. No page changes. ${again}` }),
});

/** Session records of the last plan of each kind, per folder. A plan that fails clears its kind, so a stale plan can never be written. */
export class ShownPlans {
  private readonly plans = new Map<string, ShownPlan>();
  private key = (folderId: string, kind: PlanKind): string => `${folderId}\u0000${kind}`;
  set(folderId: string, kind: PlanKind, plan: ShownPlan): void { this.plans.set(this.key(folderId, kind), plan); }
  clear(folderId: string, kind: PlanKind): void { this.plans.delete(this.key(folderId, kind)); }
  /** The record of the last plan of this kind, or null. It matches nothing: a write still names the plan through `match`. */
  peek(folderId: string, kind: PlanKind): ShownPlan | null { return this.plans.get(this.key(folderId, kind)) ?? null; }
  /** The record, when the write names its revision and its choices exactly; else null. */
  match(folderId: string, kind: PlanKind, revision: string, choices: unknown): ShownPlan | null {
    const p = this.plans.get(this.key(folderId, kind));
    return p !== undefined && p.revision === revision && p.choices === canonical(choices) ? p : null;
  }
}

/**
 * The exact text one adoption approval covers, from the bytes of the planned definition files (ruling U7): the item's own entry of `hooks.json`,
 * `mcp.json` or `guardrails.json`, pretty-printed; the whole `SKILL.md` of a skill; the agent file; the instructions; an engine file. Never another item's entry.
 */
export function approvalText(key: string, bytes: ReadonlyMap<string, { readonly bytes: Uint8Array }>): { path: string; text: string }[] {
  const slash = key.indexOf('/'), part = key.slice(0, slash), id = key.slice(slash + 1);
  const text = (rel: string): string | null => { const f = bytes.get(rel); return f === undefined ? null : Buffer.from(f.bytes).toString('utf8'); };
  const entryOf = (rel: string, list: string, match: (e: Record<string, unknown>) => boolean): { path: string; text: string }[] => {
    const raw = text(rel);
    if (raw === null) return [];
    try {
      const doc = JSON.parse(raw) as Record<string, unknown>;
      const lists = list.split('|').flatMap(name => (Array.isArray(doc[name]) ? doc[name] as Record<string, unknown>[] : doc[name] !== undefined && typeof doc[name] === 'object' ? [doc[name] as Record<string, unknown>] : []));
      return lists.filter(match).map(e => ({ path: `.bowerloom/${rel}`, text: JSON.stringify(e, null, 2) }));
    } catch { return [{ path: `.bowerloom/${rel}`, text: raw }]; }
  };
  const whole = (rel: string): { path: string; text: string }[] => { const t = text(rel); return t === null ? [] : [{ path: `.bowerloom/${rel}`, text: t }]; };
  switch (part) {
    case 'hooks': return entryOf('hooks.json', 'hooks', e => e.id === id);
    case 'mcp': return entryOf('mcp.json', 'servers', e => e.id === id || e.name === id);
    case 'guardrails': return entryOf('guardrails.json', 'rules|sandbox', e => e.id === id || id === 'sandbox');
    case 'skills': return whole(`skills/${id}/SKILL.md`);
    case 'subagents': return whole(`agents/${id}.md`);
    case 'system-prompt': return whole('instructions/AGENTS.md');
    case 'engine-private': return whole(id);
    default: return [];
  }
}

/** The number of files an adoption plan writes. */
export const adoptionFiles = (plan: AdoptionPlan): number => plan.files.length;
