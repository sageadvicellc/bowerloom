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

/** The kinds of plan a write can name. */
export type PlanKind = 'adoption' | 'projection' | 'removal' | 'recovery' | 'adoption-recovery' | 'merge';

/** Main's record of the last plan it returned: its revision, the choices it was made with (canonical JSON), and the words of the dialog. */
export interface ShownPlan { readonly revision: string; readonly choices: string; readonly ask: Ask | null }
/** The words of the dialog: a title, one question, and a detail line. */
export interface Ask { readonly title: string; readonly message: string; readonly detail: string }

export const hashOf = (value: unknown): string => createHash('sha256').update(canonicalJson(JSON.parse(JSON.stringify(value)))).digest('hex');
export const canonical = (value: unknown): string => canonicalJson(JSON.parse(JSON.stringify(value)));

export const notTheShownPlan = (): { ok: false; refusal: Refusal } => ({
  ok: false, refusal: { code: NOT_THE_PLAN_SHOWN, message: 'This is not the plan Bowerloom showed last for this folder, with these choices. Nothing was written. Plan again.', paths: [] },
});
export const cancelled = (): { ok: false; refusal: Refusal } => ({
  ok: false, refusal: { code: CANCELLED, message: 'Nothing was written. The confirmation was closed without a yes.', paths: [] },
});

const files = (n: number): string => `${n} ${n === 1 ? 'file' : 'files'}`;
const again = 'Bowerloom plans again first and stops if anything changed.';
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
});

/** Session records of the last plan of each kind, per folder. A plan that fails clears its kind, so a stale plan can never be written. */
export class ShownPlans {
  private readonly plans = new Map<string, ShownPlan>();
  private key = (folderId: string, kind: PlanKind): string => `${folderId}\u0000${kind}`;
  set(folderId: string, kind: PlanKind, plan: ShownPlan): void { this.plans.set(this.key(folderId, kind), plan); }
  clear(folderId: string, kind: PlanKind): void { this.plans.delete(this.key(folderId, kind)); }
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
