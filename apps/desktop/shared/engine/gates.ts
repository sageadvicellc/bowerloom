/**
 * What still stands between a plan and its write, as plain data. The sheets draw their "waiting for" lines and enable their write button from here, and the
 * same rules are held by the packages, which plan again and refuse when anything is missing. A sheet never passes an approval the person did not tick.
 */
import type { AdoptView, ProjectAnswer, ProjectView } from './types.js';

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
  for (const a of view.approvals) if (!ticked.includes(a.key)) waits.push({ kind: 'approval', key: a.key });
  return waits;
}

/** True when the adopt sheet may write: nothing waits, and the plan itself says it is ready. */
export const adoptCanWrite = (view: AdoptView, ticked: readonly string[]): boolean => view.ready && adoptWaits(view, ticked).length === 0;

/** The approvals to send with a write: exactly the plan's own, each ticked by the person, in the plan's order. Anything else is never sent. */
export function approvalsToSend(view: AdoptView, ticked: readonly string[]): string[] {
  return view.approvals.map(a => a.key).filter(key => ticked.includes(key));
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
