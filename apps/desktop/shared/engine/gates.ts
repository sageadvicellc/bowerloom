/**
 * What still stands between a plan and its write, as plain data. The sheets draw their "waiting for" lines and enable their write button from here, and the
 * same rules are held by the packages, which plan again and refuse when anything is missing. A sheet never passes an approval the person did not tick.
 */
import { EVERY_ENGINE_PARTS } from './types.js';
import type { AdoptApproval, AdoptChoices, AdoptView, EveryEnginePart, ProjectAnswer, ProjectView } from './types.js';

/** A tick on an adopt approval names the approval and the hash of what the person read, so a change to any of it clears the tick (U3, SM1). */
export const tickOf = (a: { readonly key: string; readonly hash: string }): string => `${a.key}\u001f${a.hash}`;

export type AdoptWait =
  | { readonly kind: 'conflict'; readonly key: string }
  | { readonly kind: 'acknowledge'; readonly id: string }
  | { readonly kind: 'block'; readonly id: string }
  | { readonly kind: 'problem'; readonly code: string }
  | { readonly kind: 'approval'; readonly key: string };

/** Everything the adopt sheet still waits for, in the order the sheet lists it. Empty: the person may write. */
export function adoptWaits(view: AdoptView, ticked: readonly string[]): AdoptWait[] {
  const waits: AdoptWait[] = [];
  for (const c of view.conflicts) if (c.picked === null) waits.push({ kind: 'conflict', key: c.key });
  for (const u of view.unmapped) {
    if (u.gate === 'block') waits.push({ kind: 'block', id: u.id });
    else if (u.gate === 'acknowledge' && !u.acknowledged) waits.push({ kind: 'acknowledge', id: u.id });
  }
  for (const p of view.problems) waits.push({ kind: 'problem', code: p.code });
  for (const a of view.approvals) {
    if (a.blocked !== null) waits.push({ kind: 'block', id: a.key });
    else if (!ticked.includes(tickOf(a))) waits.push({ kind: 'approval', key: a.key });
  }
  return waits;
}

/** True when the adopt sheet may write: nothing waits, and the plan itself says it is ready. */
export const adoptCanWrite = (view: AdoptView, ticked: readonly string[]): boolean => view.ready && adoptWaits(view, ticked).length === 0;

/** One "Use for every engine" tick of the adopt sheet (D8B): its part, whether the plan has it, how many items it widens, and the items it never widens. */
export interface EveryEngineRow { readonly part: EveryEnginePart; readonly checked: boolean; readonly count: number; readonly kept: readonly { readonly id: string; readonly reason: string }[] }

/** The ticks in the order of the parts, from the plan on screen: a tick shows what the plan has, never what was sent. */
export function everyEngineRows(view: AdoptView): EveryEngineRow[] {
  return EVERY_ENGINE_PARTS.flatMap(part => {
    const e = view.everyEngine.find(x => x.part === part);
    return e === undefined ? [] : [{ part, checked: e.chosen, count: e.widens, kept: e.notWidened }];
  });
}

/** The choices with one part ticked or not, in the order of the parts. The choices given are never changed. */
export function toggleEveryEngine(choices: AdoptChoices, part: EveryEnginePart, on: boolean): AdoptChoices {
  const now = new Set(choices.everyEngine ?? []);
  if (on) now.add(part); else now.delete(part);
  return { ...choices, everyEngine: EVERY_ENGINE_PARTS.filter(p => now.has(p)) };
}

/** The approvals to send with a write: exactly the plan's own, each ticked by the person for the content on screen, in the plan's order. */
export function approvalsToSend(view: AdoptView, ticked: readonly string[]): AdoptApproval[] {
  return view.approvals.filter(a => a.blocked === null && ticked.includes(tickOf(a))).map(a => ({ key: a.key, hash: a.hash }));
}

/** The approve lines that are not ticked yet. Empty: the sheet may plan again with the approvals. */
export function untickedLines(answer: ProjectAnswer, ticked: readonly string[]): string[] {
  return answer.kind === 'approve' ? answer.lines.map(l => l.key).filter(key => !ticked.includes(key)) : [];
}

/**
 * True when the install sheet may write: a plan is shown, it would change something, and the person approved this very revision.
 * A plan whose revision is not the approved one (the person changed a choice after approving) waits for a new approval.
 */
export const projectCanWrite = (plan: ProjectView | null, approvedRevision: string | null): boolean =>
  plan !== null && !plan.noop && approvedRevision !== null && approvedRevision === plan.revision;

/** The first 8 characters of a revision, as the sheets show it next to the approval. */
export const shortRevision = (revision: string): string => revision.slice(0, 8);
