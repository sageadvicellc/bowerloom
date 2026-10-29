/**
 * Pure maps from the plans of the packages to the plain views of shared/engine/types.ts. The main process runs them before anything reaches the window,
 * so the window never gets an absolute path of the person's folders, a byte of a file it does not show, or a field the packages add later unseen.
 * Every text goes through the folder's scrubber (shared/engine/scrub.ts). Nothing is cut: a command or a file of code is shown in full.
 */
import type { AdoptionPlan, AdoptionRecoveryPlan, Place } from '../../../../packages/adoption/src/index.js';
import type { InstructionMergePlan, InstructionMergeRecoveryPlan } from '../../../../packages/adoption/src/merge.js';
import type { DriftLine, PortablePlan, PortableRecoveryPlan, PortableRemovalPlan } from '../../../../packages/project-sync/src/index.js';
import { ENGINE_IDS, isEngineId } from './engines.js';
import { RESULTS } from './types.js';
import type {
  AdoptApprovalView, AdoptPart, AdoptRecoveryView, AdoptSecretView, AdoptView, ApproveLineView, ChangeView, EngineId, EngineLossView, LossView, MergeView, PlaceView,
  ProjectView, RecoveryView, RemovalView, ResultWord,
} from './types.js';
import type { Scrub } from './scrub.js';

const engines = (list: readonly string[]): EngineId[] => ENGINE_IDS.filter(e => list.includes(e));
const result = (value: string): ResultWord => ((RESULTS as readonly string[]).includes(value) ? value as ResultWord : 'absent');

function place(p: Place, s: Scrub): PlaceView {
  return { path: s(p.path), pointer: p.pointer === undefined ? null : s(p.pointer), engines: engines(p.engines), shape: s(p.shape), shapeVersion: p.shapeVersion === null ? null : s(p.shapeVersion) };
}

/** The reason of an approval that has no text to show (W4): a person never approves what they cannot read. */
export const NO_TEXT = 'Bowerloom cannot show the text this approval covers, so it cannot be approved here. Plan again, or change the file.';

/** What the main process adds to an adoption view: a hash function, and the exact text each approval covers, from the planned definition files. */
export interface AdoptExtras {
  readonly hashOf: (value: unknown) => string;
  readonly textOf: (key: string) => readonly { readonly path: string; readonly text: string }[];
}

/** The hash of an unmapped entry: what the person reads about it, never whether it is acknowledged. */
export const unmappedHashBody = (u: { id: string; path: string; pointer: string | null; part: string | null; reason: string; gate: string }): unknown =>
  ({ id: u.id, path: u.path, pointer: u.pointer, part: u.part, reason: u.reason, gate: u.gate });

/**
 * The adoption plan as the adopt sheet shows it. Every approval carries its item's reasons, places, secrets and the exact text it covers, and a hash of all
 * of that, so a tick names what the person read (U3, U7).
 */
export function adoptionView(plan: AdoptionPlan, folder: string, s: Scrub, extras: AdoptExtras): AdoptView {
  const secrets: AdoptSecretView[] = plan.secrets.map(x => ({ path: s(x.path), pointer: s(x.pointer), reference: s(x.reference), key: `${x.part}/${x.id}` }));
  const items = plan.items.map(i => ({
    key: `${i.part}/${i.id}`, part: i.part as AdoptPart, id: s(i.id), places: i.places.map(p => place(p, s)), engines: i.engines === null ? null : engines(i.engines),
    needsApproval: i.needsApproval.map(s), notes: i.notes.map(s),
  }));
  const approvals: AdoptApprovalView[] = plan.approvalsRequired.map(key => {
    const item = items.find(i => i.key === key);
    // An approval the plan asks for always names one of its items. If it ever does not, the sheet still shows the key and says so, and the write stays blocked by the package.
    const text = extras.textOf(key).map(t => ({ path: s(t.path), text: s(t.text) }));
    const body = item === undefined
      ? { key, part: key.split('/')[0] as AdoptPart, id: s(key.slice(key.indexOf('/') + 1)), reasons: ['The plan asks for this approval and lists no item for it.'], places: [], secrets: [], text }
      : { key, part: item.part, id: item.id, reasons: item.needsApproval, places: item.places, secrets: secrets.filter(x => x.key === key), text };
    return { ...body, hash: extras.hashOf(body), blocked: text.length === 0 ? NO_TEXT : null };
  });
  return {
    folder,
    harness: { id: s(plan.harness.id), description: s(plan.harness.description) },
    engines: plan.engines.map(e => ({ id: e.id as EngineId, version: e.version === null ? null : s(e.version), model: e.model === null ? null : s(e.model), detected: e.detected })),
    read: plan.read.length,
    items,
    conflicts: plan.conflicts.map(c => ({
      key: c.key, part: c.part as AdoptPart, id: s(c.id),
      variants: c.variants.map(v => ({ key: v.key, places: v.places.map(p => place(p, s)) })),
      picked: c.choice !== null && 'pick' in c.choice ? c.choice.pick : null,
    })),
    differences: plan.differences.map(d => ({ action: d.action, pattern: s(d.pattern), rules: d.rules.map(r => ({ id: s(r.id), effect: r.effect, engines: engines(r.engines) })) })),
    everyEngine: plan.everyEngine.map(e => ({ part: e.part, chosen: e.chosen, widens: e.widens, notWidened: e.notWidened.map(n => ({ id: s(n.id), reason: s(n.reason) })) })),
    unmapped: plan.unmapped.map(u => {
      const shown = { id: u.id, path: s(u.path), pointer: u.pointer === undefined ? null : s(u.pointer), part: u.part, reason: s(u.reason), gate: u.gate };
      return { ...shown, acknowledged: u.acknowledged, hash: extras.hashOf(unmappedHashBody(shown)) };
    }),
    secrets,
    managed: plan.managed.map(m => ({ catalog: s(m.catalog), id: s(m.id), skill: m.skill === null ? null : s(m.skill), reason: s(m.reason) })),
    warnings: plan.warnings.map(s),
    files: plan.files.map(f => ({ path: s(f.path), bytes: f.bytes })),
    approvals,
    problems: plan.problems.map(p => ({ code: p.code, path: s(p.path), message: s(p.message) })),
    ready: plan.ready,
    revision: plan.revision,
  };
}

export function adoptRecoveryView(plan: AdoptionRecoveryPlan, s: Scrub): AdoptRecoveryView {
  return { kind: 'adoption', journal: plan.journal, check: plan.check.map(s), remove: plan.remove.map(s), restore: [], kept: plan.kept.map(k => ({ path: s(k.path), reason: k.reason })), dirs: plan.dirs.map(s), revision: plan.revision };
}

/** The recovery of a stopped Merge, in the same view: a file the Merge created is removed, a file it replaced goes back to its bytes. */
export function mergeRecoveryView(plan: InstructionMergeRecoveryPlan, s: Scrub): AdoptRecoveryView {
  return {
    kind: 'merge', journal: plan.journal, check: plan.check.map(s),
    remove: plan.restore.filter(r => r.action === 'delete').map(r => s(r.path)), restore: plan.restore.filter(r => r.action === 'restore').map(r => s(r.path)),
    kept: plan.kept.map(k => ({ path: s(k.path), reason: k.reason })), dirs: plan.dirs.map(s), revision: plan.revision,
  };
}

/** The Merge plan as the install sheet shows it, with the text of CLAUDE.md the plan read (`claude`, empty when it could not be shown). */
export function mergeView(plan: InstructionMergePlan, folder: string, claude: string, s: Scrub): MergeView {
  return { folder, claude: s(claude), heading: plan.heading, addsPart: plan.addsPart, files: plan.files.map(f => ({ path: s(f.path), action: f.action })), revision: plan.revision };
}

// ---- the projection -------------------------------------------------------------------------------------------------------

/** The key of one loss line, as the window names it when a person approves it. */
export function lineKey(line: { readonly part: string; readonly entry: string; readonly field?: string | null | undefined; readonly engine: string; readonly result: string }): string {
  return [line.part, line.entry, line.field ?? '', line.engine, line.result].join('\u001f');
}

function lossView(l: { part: string; entry: string; field?: string; engine: string; result: string; reason: string }, s: Scrub): LossView {
  return { part: l.part, entry: s(l.entry), field: l.field === undefined ? null : s(l.field), engine: l.engine as EngineId, result: result(l.result), reason: s(l.reason) };
}

/** The lines of each engine, part by part, in the order the plan lists them, with a count of each result word. */
export function lossByEngine(loss: readonly LossView[], engineList: readonly { readonly id: string; readonly version: string | null }[]): EngineLossView[] {
  return engineList.filter(e => isEngineId(e.id)).map(e => {
    const lines = loss.filter(l => l.engine === e.id);
    const parts: { part: string; lines: LossView[] }[] = [];
    for (const line of lines) {
      const at = parts.find(p => p.part === line.part);
      if (at === undefined) parts.push({ part: line.part, lines: [line] }); else at.lines.push(line);
    }
    const counts = { exact: 0, translated: 0, weakened: 0, absent: 0 };
    for (const line of lines) counts[line.result] += 1;
    return { engine: e.id as EngineId, version: e.version, parts, counts };
  });
}

/** A restore whose original is the state the path holds now writes nothing: the file was taken over, and the view calls it `keep`. */
type PlanChange = { path: string; action: Exclude<ChangeView['action'], 'keep'>; engines: readonly string[]; before?: { sha256: string; mode: number } | null; original?: { sha256: string; mode: number } | null };
export const keepsFile = (c: PlanChange): boolean =>
  c.action === 'restore' && c.original != null && c.before != null && c.original.sha256 === c.before.sha256 && c.original.mode === c.before.mode;
function changeView(c: PlanChange, s: Scrub): ChangeView {
  return { path: s(c.path), action: keepsFile(c) ? 'keep' : c.action, engines: engines(c.engines) };
}

/** The projection plan as the install sheet shows it. `driftLines` are the files Bowerloom wrote earlier that changed since. */
export function projectView(plan: PortablePlan, folder: string, driftLines: readonly DriftLine[], s: Scrub, earlier: (approval: PortablePlan['approved'][number]) => boolean = () => false): ProjectView {
  const loss = plan.loss.map(l => lossView(l, s));
  return {
    folder,
    harness: s(plan.definition.harness),
    engines: lossByEngine(loss, plan.engines),
    partial: plan.partial,
    notice: plan.notice === null ? null : s(plan.notice),
    trust: plan.trust.map(t => ({ engine: t.engine as EngineId, path: s(t.path), entry: t.entry === undefined ? null : s(t.entry), state: t.state, reason: s(t.reason) })),
    review: plan.review.map(r => ({
      path: s(r.path), engine: r.engine as EngineId, kind: r.kind, part: r.part ?? null, entry: r.entry === undefined ? null : s(r.entry), text: s(r.text),
      env: Object.entries(r.env ?? {}).map(([name, value]) => ({ name: s(name), value: value === null ? null : s(value) })),
    })),
    drift: plan.drift === null ? null : {
      agents: plan.drift.agents, actions: [...plan.drift.actions], defaultAction: plan.drift.defaultAction,
      engines: plan.drift.engines.map(e => ({ engine: e.engine as EngineId, hidden: e.hidden, rule: s(e.rule) })),
    },
    reconcile: plan.reconcile,
    driftLines: driftLines.map(d => ({ path: s(d.path), reason: d.reason })),
    approved: plan.approved.map(a => ({ part: a.part, entry: s(a.entry), field: a.field === undefined ? null : s(a.field), engine: a.engine as EngineId, result: a.result, who: s(a.who), when: a.when, reason: s(a.reason), earlier: earlier(a) })),
    changes: plan.changes.map(c => changeView(c, s)),
    takenOver: plan.takenOver.map(x => ({ path: s(x.path), entry: x.entry === undefined ? null : s(x.entry) })),
    offers: plan.offers.map(o => ({ action: o.action, reason: s(o.reason) })),
    ignored: plan.ignored.map(i => ({ option: i.option, reason: s(i.reason) })),
    pendingTrust: plan.pendingTrust.map(s),
    filterLeaks: plan.filterLeaks.map(f => ({ skill: s(f.skill), path: s(f.path), engines: engines(f.engines) })),
    noop: plan.noop,
    revision: plan.revision,
  };
}

/** The key of a line a person approves: the line and the hash of its entry, so a changed entry never matches an earlier tick (U15). */
export const approveKey = (line: Parameters<typeof lineKey>[0], entryHash: string | null): string => `${lineKey(line)}\u001f${entryHash ?? 'no-entry'}`;

/** One refused line as the window shows it. A line with no entry hash cannot be approved, and says so by `approvable` (SL3). */
export function approveLine(l: { part: string; entry: string; field?: string; engine: string; result: string; reason: string }, entryHash: string | null, s: Scrub, text = ''): ApproveLineView {
  return { ...lossView(l, s), key: approveKey(l, entryHash), approvable: entryHash !== null, text: s(text) };
}

export function removalView(plan: PortableRemovalPlan, s: Scrub): RemovalView {
  return { changes: plan.changes.map(c => changeView(c, s)), removeDirs: plan.removeDirs.map(s), revision: plan.revision };
}

/** A file mode as four octal digits: `0644`. */
export const modeWords = (mode: number): string => `0${(mode & 0o777).toString(8).padStart(3, '0')}`;

export function recoveryView(plan: PortableRecoveryPlan, s: Scrub): RecoveryView {
  return {
    kind: plan.kind, action: plan.action,
    steps: plan.steps.map(x => ({ path: s(x.path), now: x.now === 'unsafe' ? 'unsafe' : x.now === null ? 'missing' : 'present', decision: x.decision })),
    keep: plan.keep.map(s), modes: plan.modes.map(m => ({ path: s(m.path), choice: m.choice, now: modeWords(m.now.mode), recorded: modeWords(m.recorded.mode) })),
    notice: plan.notice === null ? null : s(plan.notice), revision: plan.revision,
  };
}
