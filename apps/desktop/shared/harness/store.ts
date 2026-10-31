/**
 * The store of the harness-first preview. In memory only: nothing here reads a file, a clock or a random number, so nothing is written anywhere.
 *
 * It has two layers. The REDUCERS are pure functions `(state, ...arguments, stamp) => new state`; they never change the state they are given. `createHarnessStore` wraps them in a small
 * object that holds the current state, tells subscribers when it changes, hands the reducers a stamp from its clock, and finishes a run by itself after about 15 seconds.
 *
 * A change that matters adds a history entry (newest first) that carries the steps which undo it. Undo works for installs, link edits and the other manifest and interface changes. Only the newest change of one install, one harness or one interface can be undone (`undoBlocker`):
 * an older snapshot would put back what a newer change replaced.
 * Moving a node (`setNodePosition`) and rating a run are saved but are not history entries: they would fill the list while a node is dragged.
 */
import { buildInstallPlan } from './files.js';
import { autoLinks } from './links.js';
import { harnessById, installOf, interfaceById, partById, projectById } from './status.js';
import type {
  ConflictChoice, Harness, HarnessState, HistoryEntry, Install, InstallState, InterfaceId, Link, MissingRef, Point, Rating, Run, Stamp, UndoStep,
} from './types.js';

/** What a screen says when an undo is held back: the newest change of the same install or harness goes first. */
export const UNDO_NEWER_FIRST = 'undo the newer change first';
const HARNESS_GONE = 'that harness is not here';

export const RUN_FINISH_MS = 15_000;
export const PERSON = 'Robin', COMPUTER = 'this Mac';

// ---- Small helpers

const sameLink = (a: Link, b: Link): boolean => a.from === b.from && a.to === b.to;
const withHarness = (state: HarnessState, harnessId: string, change: (h: Harness) => Harness): HarnessState => ({ ...state, harnesses: state.harnesses.map(h => (h.id === harnessId ? change(h) : h)) });

function take(state: HarnessState, prefix: string): { id: string; state: HarnessState } {
  return { id: `${prefix}-${state.nextId}`, state: { ...state, nextId: state.nextId + 1 } };
}

interface EntryParts { readonly text: string; readonly filesWritten?: number; readonly manifest?: HistoryEntry['manifest']; readonly undo: readonly UndoStep[] | null }

/** Adds a history entry at the top of the list. */
function record(state: HarnessState, stamp: Stamp, parts: EntryParts): HarnessState {
  const { id, state: next } = take(state, 'history');
  const entry: HistoryEntry = { id, text: parts.text, stamp, person: PERSON, computer: COMPUTER, filesWritten: parts.filesWritten ?? 0, manifest: parts.manifest ?? null, undo: parts.undo, undone: false };
  return { ...next, history: [entry, ...next.history] };
}

const uniqueName = (state: HarnessState, name: string): string => {
  const names = new Set(state.harnesses.map(h => h.name));
  if (!names.has(name)) return name;
  for (let n = 2; ; n += 1) if (!names.has(`${name} ${n}`)) return `${name} ${n}`;
};

// ---- Harnesses

/** Makes an empty harness ("New harness"), for the New harness button. Returns its id. */
export function createHarness(state: HarnessState, stamp: Stamp): { state: HarnessState; harnessId: string } {
  const { id, state: s1 } = take(state, 'harness');
  const harness: Harness = { id, name: uniqueName(s1, 'New harness'), summary: 'An empty harness.', partIds: [], links: [], positions: {}, missing: [], newPartIds: [] };
  const next = record({ ...s1, harnesses: [...s1.harnesses, harness] }, stamp, { text: `Made ${harness.name}`, manifest: 'created', undo: [{ op: 'delete-harness', harnessId: id }] });
  return { state: next, harnessId: id };
}

/** Records which sources the person kept ticked in the first scan. Ids that are not sources are dropped. */
export function chooseSources(state: HarnessState, sourceIds: readonly string[]): HarnessState {
  const known = new Set(state.sources.map(s => s.id));
  return { ...state, chosenSourceIds: sourceIds.filter(id => known.has(id)) };
}

/**
 * Makes a harness from one scanned source: it holds every part of that source. The links are the ones the source carries (real mode), else each agent is linked to some of the others (the sample).
 * A real link to a part outside the source adds that part to the harness; a link to a part the state does not hold is dropped. Returns the new id, or null for an unknown source.
 */
export function createHarnessFromSource(state: HarnessState, sourceId: string, stamp: Stamp): { state: HarnessState; harnessId: string | null } {
  const source = state.sources.find(s => s.id === sourceId);
  if (source === undefined) return { state, harnessId: null };
  const { id, state: s1 } = take(state, 'harness');
  const parts = source.partIds.map(pid => partById(s1, pid)).filter((p): p is NonNullable<typeof p> => p !== undefined);
  const agentIds = parts.filter(p => p.kind === 'agent').map(p => p.id), otherIds = parts.filter(p => p.kind !== 'agent').map(p => p.id);
  const held = new Set(parts.map(p => p.id));
  const links = source.links === undefined ? autoLinks(agentIds, otherIds) : source.links.filter(l => held.has(l.from) && (held.has(l.to) || partById(s1, l.to) !== undefined));
  // Known limit: a link to a part of another source pulls that part into this harness without a word to the person (the harness then holds parts the source does not).
  const pulled = [...new Set(links.map(l => l.to).filter(to => !held.has(to)))];
  const harness: Harness = { id, name: uniqueName(s1, source.harnessName), summary: `Made from ${source.name}.`, partIds: [...parts.map(p => p.id), ...pulled], links, positions: {}, missing: [], newPartIds: [] };
  const next = record({ ...s1, harnesses: [...s1.harnesses, harness] }, stamp, { text: `Made ${harness.name} from a scan`, manifest: 'created', undo: [{ op: 'delete-harness', harnessId: id }] });
  return { state: next, harnessId: id };
}

// ---- Parts and links

/**
 * Adds a part of the Library to a harness. It is marked new until the harness is made again. An agent has no links yet; link it by hand.
 * If the harness names a missing part of the same kind and name, the part takes its place and the links to the missing one now go to it.
 */
export function addPart(state: HarnessState, harnessId: string, partId: string, stamp: Stamp): HarnessState {
  const harness = harnessById(state, harnessId), part = partById(state, partId);
  if (harness === undefined || part === undefined || harness.partIds.includes(partId)) return state;
  const ref = harness.missing.find(m => m.kind === part.kind && m.name.toLowerCase() === part.name.toLowerCase());
  const moved = ref === undefined ? [] : harness.links.filter(l => l.to === ref.id);
  const next = withHarness(state, harnessId, h => ({
    ...h, partIds: [...h.partIds, partId], newPartIds: [...h.newPartIds, partId],
    missing: ref === undefined ? h.missing : h.missing.filter(m => m.id !== ref.id),
    links: ref === undefined ? h.links : h.links.map(l => (l.to === ref.id ? { ...l, to: partId } : l)),
    positions: ref === undefined || h.positions[ref.id] === undefined ? h.positions : { ...Object.fromEntries(Object.entries(h.positions).filter(([k]) => k !== ref.id)), [partId]: h.positions[ref.id]! },
  }));
  const undo: UndoStep[] = [{ op: 'remove-part', harnessId, partId }, ...(ref === undefined ? [] : [{ op: 'restore-missing', harnessId, missing: [ref], links: moved } as UndoStep])];
  return record(next, stamp, { text: `Added ${part.name} to ${harness.name}`, manifest: 'changed', undo });
}

/** Takes a part out of a harness. Its links go with it. The part's file is not deleted. */
export function removePart(state: HarnessState, harnessId: string, partId: string, stamp: Stamp): HarnessState {
  const harness = harnessById(state, harnessId), part = partById(state, partId);
  if (harness === undefined || part === undefined || !harness.partIds.includes(partId)) return state;
  const links = harness.links.filter(l => l.from === partId || l.to === partId);
  const next = withHarness(state, harnessId, h => ({
    ...h, partIds: h.partIds.filter(id => id !== partId), newPartIds: h.newPartIds.filter(id => id !== partId),
    links: h.links.filter(l => l.from !== partId && l.to !== partId), positions: Object.fromEntries(Object.entries(h.positions).filter(([k]) => k !== partId)),
  }));
  const undo: UndoStep[] = [{ op: 'add-part', harnessId, partId, links, position: harness.positions[partId] ?? null, wasNew: harness.newPartIds.includes(partId) }];
  return record(next, stamp, { text: `Removed ${part.name} from ${harness.name}`, manifest: 'changed', undo });
}

/** Why a link cannot be made, in a few lowercase words, or null when it can. */
export function addLinkProblem(state: HarnessState, harnessId: string, from: string, to: string): string | null {
  const harness = harnessById(state, harnessId), agent = partById(state, from);
  if (harness === undefined) return HARNESS_GONE;
  if (agent === undefined || agent.kind !== 'agent') return 'only an agent can link to a part';
  if (!harness.partIds.includes(from)) return 'that agent is not in this harness';
  if (from === to) return 'a part cannot link to itself';
  if (!harness.missing.some(m => m.id === to)) {
    const target = partById(state, to);
    if (target !== undefined && target.kind === 'agent') return 'an agent cannot link to an agent';
    if (target === undefined || !harness.partIds.includes(to)) return 'that part is not in this harness';
  }
  if (harness.links.some(l => sameLink(l, { from, to }))) return 'that link is there already';
  return null;
}

/** Links an agent to a part. The link is saved in the manifest; the agent's file does not change. The part may be one the harness names and lacks. */
export function addLink(state: HarnessState, harnessId: string, from: string, to: string, stamp: Stamp): HarnessState {
  if (addLinkProblem(state, harnessId, from, to) !== null) return state;
  const harness = harnessById(state, harnessId)!, agent = partById(state, from)!;
  const ref = harness.missing.find(m => m.id === to), target = partById(state, to);
  const link: Link = { from, to };
  const next = withHarness(state, harnessId, h => ({ ...h, links: [...h.links, link] }));
  return record(next, stamp, { text: `Linked ${agent.name} to ${ref?.name ?? target!.name} in ${harness.name}`, manifest: 'changed', undo: [{ op: 'remove-link', harnessId, link }] });
}

/** Takes one link away. The agent's file does not change. */
export function removeLink(state: HarnessState, harnessId: string, from: string, to: string, stamp: Stamp): HarnessState {
  const harness = harnessById(state, harnessId);
  const link = harness?.links.find(l => l.from === from && l.to === to);
  if (harness === undefined || link === undefined) return state;
  const agent = partById(state, from), target = partById(state, to), ref = harness.missing.find(m => m.id === to);
  const next = withHarness(state, harnessId, h => ({ ...h, links: h.links.filter(l => !sameLink(l, link)) }));
  return record(next, stamp, { text: `Unlinked ${agent?.name ?? from} from ${ref?.name ?? target?.name ?? to} in ${harness.name}`, manifest: 'changed', undo: [{ op: 'add-link', harnessId, link }] });
}

/** Saves where a node sits in the graph, in the manifest. It adds no history entry. */
export function setNodePosition(state: HarnessState, harnessId: string, nodeId: string, at: Point): HarnessState {
  const harness = harnessById(state, harnessId);
  if (harness === undefined || !(harness.partIds.includes(nodeId) || harness.missing.some(m => m.id === nodeId))) return state;
  const x = Math.round(at.x), y = Math.round(at.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return state;
  const old = harness.positions[nodeId];
  if (old !== undefined && old.x === x && old.y === y) return state;
  return withHarness(state, harnessId, h => ({ ...h, positions: { ...h.positions, [nodeId]: { x, y } } }));
}

/** The Library part that would fill a missing part (same kind, same name), or undefined when the Library has none. */
export function fixFor(state: HarnessState, harnessId: string, missingId: string): { ref: MissingRef; partId: string } | undefined {
  const ref = harnessById(state, harnessId)?.missing.find(m => m.id === missingId);
  const part = ref === undefined ? undefined : state.parts.find(p => p.kind === ref.kind && p.name.toLowerCase() === ref.name.toLowerCase());
  return ref === undefined || part === undefined ? undefined : { ref, partId: part.id };
}

/** Fixes a missing part: adds the Library part of that name to the harness. The links to the missing part go to it. It does nothing when the Library has no such part. */
export function fixMissingPart(state: HarnessState, harnessId: string, missingId: string, stamp: Stamp): HarnessState {
  const fix = fixFor(state, harnessId, missingId);
  return fix === undefined ? state : addPart(state, harnessId, fix.partId, stamp);
}

// ---- Install and update

/** What an install of a harness into a project is asked to do. */
export interface InstallRequest {
  readonly projectId: string;
  readonly harnessId: string;
  readonly interfaceIds: readonly InterfaceId[];
  /** One choice for each conflicting file path. A conflict with no choice is kept as the person's own ("Keep mine"). */
  readonly conflictChoices?: Readonly<Record<string, ConflictChoice>>;
}

function setInstall(state: HarnessState, projectId: string, harnessId: string, install: Install | null): HarnessState {
  const rest = state.installs.filter(i => !(i.projectId === projectId && i.harnessId === harnessId));
  return { ...state, installs: install === null ? rest : [...rest, install] };
}

/** The interfaces that may be installed for or started in: they exist, they are switched on and they are found. */
const installable = (state: HarnessState, ids: readonly InterfaceId[]): InterfaceId[] => [...new Set(ids)].filter(id => { const i = interfaceById(state, id); return i !== undefined && i.on && i.health !== 'not-found'; });

/** Why no interface can be used for these ids, or null when at least one can. */
function interfaceProblem(state: HarnessState, ids: readonly InterfaceId[]): string | null {
  if (ids.length === 0) return 'no engine is picked';
  return installable(state, ids).length === 0 ? 'no engine that is switched on and found is picked' : null;
}

/** Why an install cannot be made, in a few lowercase words, or null when it can: the harness and the project are known, the harness holds a part, and an interface can be used. */
export function installProblem(state: HarnessState, request: InstallRequest): string | null {
  const harness = harnessById(state, request.harnessId);
  if (harness === undefined) return HARNESS_GONE;
  if (projectById(state, request.projectId) === undefined) return 'that project is not here';
  if (harness.partIds.length === 0) return 'that harness is empty';
  return interfaceProblem(state, request.interfaceIds);
}

/**
 * Installs a harness into a project for the chosen interfaces: each becomes "installed" (a conflict is settled by the choice).
 * It changes the install data in memory and adds a history entry that says how many files were written: "Keep mine" leaves the person's file alone, so it is not counted.
 * A conflict with no choice is kept as the person's own. Nothing is written to a disk. An install that cannot be made (see `installProblem`) changes nothing.
 */
export function install(state: HarnessState, request: InstallRequest, stamp: Stamp): HarnessState {
  if (installProblem(state, request) !== null) return state;
  const harness = harnessById(state, request.harnessId)!, project = projectById(state, request.projectId)!;
  const ids = installable(state, request.interfaceIds);
  const before = installOf(state, project.id, harness.id) ?? null;
  const plan = buildInstallPlan(state, project.id, harness.id, ids);
  const kept = plan.conflicts.filter(file => (request.conflictChoices?.[file.path] ?? 'keep-mine') === 'keep-mine').length;
  const states: Partial<Record<InterfaceId, InstallState>> = { ...(before?.states ?? {}) };
  for (const id of ids) states[id] = 'installed';
  const next = setInstall(state, project.id, harness.id, { projectId: project.id, harnessId: harness.id, states });
  return record(next, stamp, { text: `Installed ${harness.name} in ${project.name}`, filesWritten: plan.counts.total - kept, undo: [{ op: 'restore-install', projectId: project.id, harnessId: harness.id, before }] });
}

/** Brings the out-of-date interfaces of an install up to date (or only the ones named). Does nothing when none is out of date. */
export function update(state: HarnessState, request: { projectId: string; harnessId: string; interfaceIds?: readonly InterfaceId[] }, stamp: Stamp): HarnessState {
  const harness = harnessById(state, request.harnessId), project = projectById(state, request.projectId), before = installOf(state, request.projectId, request.harnessId);
  if (harness === undefined || project === undefined || before === undefined) return state;
  const stale = (Object.keys(before.states) as InterfaceId[]).filter(id => before.states[id] === 'out-of-date' && (request.interfaceIds === undefined || request.interfaceIds.includes(id)));
  if (stale.length === 0) return state;
  const plan = buildInstallPlan(state, project.id, harness.id, stale);
  const states: Partial<Record<InterfaceId, InstallState>> = { ...before.states };
  for (const id of stale) states[id] = 'installed';
  const next = setInstall(state, project.id, harness.id, { projectId: project.id, harnessId: harness.id, states });
  return record(next, stamp, { text: `Updated ${harness.name} in ${project.name}`, filesWritten: plan.counts.total, undo: [{ op: 'restore-install', projectId: project.id, harnessId: harness.id, before }] });
}

/** Takes a harness out of a project: the install data for that pair is dropped. It removes only what Bowerloom wrote, so the person's own files stay. Undo puts the install back. */
export function removeInstall(state: HarnessState, projectId: string, harnessId: string, stamp: Stamp): HarnessState {
  const harness = harnessById(state, harnessId), project = projectById(state, projectId), before = installOf(state, projectId, harnessId);
  if (harness === undefined || project === undefined || before === undefined) return state;
  const next = setInstall(state, projectId, harnessId, null);
  return record(next, stamp, { text: `Removed ${harness.name} from ${project.name}`, undo: [{ op: 'restore-install', projectId, harnessId, before }] });
}

// ---- Interfaces

/** Switches an interface on or off for the install and start sheets. An interface that is not found cannot be switched on. */
export function setInterfaceOn(state: HarnessState, interfaceId: InterfaceId, on: boolean, stamp: Stamp): HarnessState {
  const iface = interfaceById(state, interfaceId);
  if (iface === undefined || iface.on === on || (on && iface.health === 'not-found')) return state;
  const next = { ...state, interfaces: state.interfaces.map(i => (i.id === interfaceId ? { ...i, on } : i)) };
  return record(next, stamp, { text: `Turned ${on ? 'on' : 'off'} ${iface.name}`, undo: [{ op: 'set-interface', interfaceId, on: iface.on }] });
}

// ---- Runs

export interface StartRequest {
  readonly harnessId: string;
  readonly projectId: string;
  readonly interfaceIds: readonly InterfaceId[];
  readonly instruction: string;
}

/** Why no run can start, in a few lowercase words, or null when they can: the harness and the project are known, the harness holds a part, an interface can be used and there is an instruction. */
export function startProblem(state: HarnessState, request: StartRequest): string | null {
  const harness = harnessById(state, request.harnessId);
  if (harness === undefined) return HARNESS_GONE;
  if (projectById(state, request.projectId) === undefined) return 'that project is not here';
  if (harness.partIds.length === 0) return 'that harness is empty';
  return interfaceProblem(state, request.interfaceIds) ?? (request.instruction.trim() === '' ? 'the instruction is empty' : null);
}

/**
 * Starts one run for each chosen interface. Two or more runs of one instruction share a group, which Compare shows side by side. A run starts as "running".
 * Nothing opens a window in the preview. Returns the ids of the new runs, in the order of the interfaces. A start that cannot be made (see `startProblem`) starts nothing.
 */
export function startRuns(state: HarnessState, request: StartRequest, stamp: Stamp): { state: HarnessState; runIds: string[] } {
  if (startProblem(state, request) !== null) return { state, runIds: [] };
  const harness = harnessById(state, request.harnessId)!, project = projectById(state, request.projectId)!, instruction = request.instruction.trim();
  const ids = installable(state, request.interfaceIds);
  let next = state;
  let groupId: string | null = null;
  if (ids.length > 1) { const g = take(next, 'group'); groupId = g.id; next = g.state; }
  const made: Run[] = [];
  for (const interfaceId of ids) {
    const r = take(next, 'run'); next = r.state;
    made.push({ id: r.id, harnessId: harness.id, projectId: project.id, interfaceId, instruction, started: stamp, status: 'running', groupId, rating: null, notes: '' });
  }
  return { state: { ...next, runs: [...made, ...next.runs] }, runIds: made.map(r => r.id) };
}

const changeRun = (state: HarnessState, runId: string, change: (run: Run) => Run): HarnessState => ({ ...state, runs: state.runs.map(r => (r.id === runId ? change(r) : r)) });

/** A run that is running is done. Anything else is left as it is. */
export function finishRun(state: HarnessState, runId: string): HarnessState {
  return state.runs.some(r => r.id === runId && r.status === 'running') ? changeRun(state, runId, r => ({ ...r, status: 'done' })) : state;
}

/** The person closed the interface's window: a run that is running or done is closed. */
export function closeRun(state: HarnessState, runId: string): HarnessState {
  return state.runs.some(r => r.id === runId && r.status !== 'closed') ? changeRun(state, runId, r => ({ ...r, status: 'closed' })) : state;
}

/** Saves the rating and the notes of a run. The rating is locked until the run is done: a run that is running keeps what it had. A null rating clears it. */
export function rateRun(state: HarnessState, runId: string, rating: Rating | null, notes: string): HarnessState {
  const run = state.runs.find(r => r.id === runId);
  if (run === undefined || run.status === 'running') return state;
  return changeRun(state, runId, r => ({ ...r, rating, notes }));
}

// ---- History and undo

/** What one step does to the world. The caller has checked that it can apply (see `applyStep`). */
function change(state: HarnessState, step: UndoStep): HarnessState {
  switch (step.op) {
    case 'restore-install': return setInstall(state, step.projectId, step.harnessId, step.before);
    case 'delete-harness': return { ...state, harnesses: state.harnesses.filter(h => h.id !== step.harnessId), installs: state.installs.filter(i => i.harnessId !== step.harnessId) };
    case 'remove-link': return withHarness(state, step.harnessId, h => ({ ...h, links: h.links.filter(l => !sameLink(l, step.link)) }));
    case 'add-link': return withHarness(state, step.harnessId, h => (h.links.some(l => sameLink(l, step.link)) ? h : { ...h, links: [...h.links, step.link] }));
    case 'remove-part': return withHarness(state, step.harnessId, h => ({
      ...h, partIds: h.partIds.filter(id => id !== step.partId), newPartIds: h.newPartIds.filter(id => id !== step.partId),
      links: h.links.filter(l => l.from !== step.partId && l.to !== step.partId), positions: Object.fromEntries(Object.entries(h.positions).filter(([k]) => k !== step.partId)),
    }));
    case 'add-part': return withHarness(state, step.harnessId, h => ({
      ...h, partIds: h.partIds.includes(step.partId) ? h.partIds : [...h.partIds, step.partId], newPartIds: step.wasNew && !h.newPartIds.includes(step.partId) ? [...h.newPartIds, step.partId] : h.newPartIds,
      links: [...h.links, ...step.links.filter(l => !h.links.some(x => sameLink(x, l)))], positions: step.position === null ? h.positions : { ...h.positions, [step.partId]: step.position },
    }));
    case 'restore-missing': return withHarness(state, step.harnessId, h => ({
      ...h, missing: [...h.missing, ...step.missing.filter(m => !h.missing.some(x => x.id === m.id))], links: [...h.links, ...step.links.filter(l => !h.links.some(x => sameLink(x, l)))],
    }));
    case 'set-interface': return { ...state, interfaces: state.interfaces.map(i => (i.id === step.interfaceId ? { ...i, on: step.on } : i)) };
  }
}

/** Applies one step, or says why it cannot: the harness or the interface it puts back is not here any more. */
function applyStep(state: HarnessState, step: UndoStep): { state: HarnessState; reason: string | null } {
  if (step.op === 'set-interface') return interfaceById(state, step.interfaceId) === undefined ? { state, reason: 'that engine is not here any more' } : { state: change(state, step), reason: null };
  if (harnessById(state, step.harnessId) === undefined) return { state, reason: `${HARNESS_GONE} any more` };
  if (step.op === 'restore-install' && projectById(state, step.projectId) === undefined) return { state, reason: 'that project is not here any more' };
  return { state: change(state, step), reason: null };
}

/** What a change touches. Two changes that touch the same thing cannot be undone out of order: a snapshot would put back what the newer change replaced. */
type Touch = { readonly kind: 'pair'; readonly project: string; readonly harness: string } | { readonly kind: 'harness' | 'installs'; readonly harness: string } | { readonly kind: 'interface'; readonly id: string };

function touchesOf(entry: HistoryEntry): Touch[] {
  const out: Touch[] = [];
  for (const step of entry.undo ?? []) {
    if (step.op === 'restore-install') out.push({ kind: 'pair', project: step.projectId, harness: step.harnessId });
    else if (step.op === 'set-interface') out.push({ kind: 'interface', id: step.interfaceId });
    else if (step.op === 'delete-harness') out.push({ kind: 'harness', harness: step.harnessId }, { kind: 'installs', harness: step.harnessId });
    else out.push({ kind: 'harness', harness: step.harnessId });
  }
  return out;
}

function clash(a: Touch, b: Touch): boolean {
  if (a.kind === 'installs') return b.kind === 'pair' ? b.harness === a.harness : b.kind === 'installs' && b.harness === a.harness;
  if (b.kind === 'installs') return clash(b, a);
  if (a.kind === 'pair') return b.kind === 'pair' && a.project === b.project && a.harness === b.harness;
  if (a.kind === 'interface') return b.kind === 'interface' && a.id === b.id;
  return b.kind === 'harness' && a.harness === b.harness;
}

/** The newest change that is not undone and touches the same install (project and harness), the same harness or the same interface as this one, or null when this one may be undone now. */
export function undoBlocker(state: HarnessState, entryId: string): HistoryEntry | null {
  const at = state.history.findIndex(e => e.id === entryId), entry = state.history[at];
  if (entry === undefined || entry.undo === null || entry.undone) return null;
  const mine = touchesOf(entry);
  return state.history.slice(0, at).find(newer => newer.undo !== null && !newer.undone && touchesOf(newer).some(t => mine.some(m => clash(t, m)))) ?? null;
}

/**
 * Undoes one history entry: its steps put back what the change replaced. The entry stays in the list, marked undone, and a new entry says so.
 * It changes nothing, and says why, when the entry is not there, is undone already or cannot be undone, when a newer change of the same install or harness is not undone yet,
 * or when a step cannot apply (the harness is gone). The steps of one entry all apply or none does.
 */
export function tryUndo(state: HarnessState, entryId: string, stamp: Stamp): { state: HarnessState; reason: string | null } {
  const entry = state.history.find(e => e.id === entryId);
  if (entry === undefined) return { state, reason: 'that change is not in the list' };
  if (entry.undone) return { state, reason: 'it was undone already' };
  if (entry.undo === null) return { state, reason: 'it cannot be undone' };
  if (undoBlocker(state, entryId) !== null) return { state, reason: UNDO_NEWER_FIRST };
  let next = state;
  for (const step of entry.undo) {
    const applied = applyStep(next, step);
    if (applied.reason !== null) return { state, reason: applied.reason };
    next = applied.state;
  }
  next = { ...next, history: next.history.map(e => (e.id === entryId ? { ...e, undone: true } : e)) };
  return { state: record(next, stamp, { text: `Undid: ${entry.text}`, filesWritten: 0, manifest: entry.manifest === null ? null : 'changed', undo: null }), reason: null };
}

/** Like `tryUndo`, and returns only the world. An entry that cannot be undone changes nothing. */
export const undoEntry = (state: HarnessState, entryId: string, stamp: Stamp): HarnessState => tryUndo(state, entryId, stamp).state;

// ---- The store object

export type Cancel = () => void;
export type Schedule = (run: () => void, ms: number) => Cancel;

/** The default clock for tests and a page with no clock of its own: a fixed time on the day of the sample. */
export const FIXED_NOW: Stamp = Object.freeze({ daysAgo: 0, time: '10:50' });

export interface StoreOptions {
  readonly initial: HarnessState;
  /** The time for new history entries and runs. */
  readonly now?: () => Stamp;
  /** Calls `run` after `ms` milliseconds and returns a way to cancel it. The default is the page's own timer. */
  readonly schedule?: Schedule;
  /** True to finish the runs that are running at the start after the same delay. */
  readonly finishRunning?: boolean;
  readonly finishAfterMs?: number;
}

const defaultSchedule: Schedule = (run, ms) => { const id = setTimeout(run, ms); return () => clearTimeout(id); };

export interface HarnessStore {
  getState(): HarnessState;
  subscribe(listener: () => void): () => void;
  /** Makes an empty harness. Returns its id. */
  createHarness(): string;
  chooseSources(ids: readonly string[]): void;
  /** Makes a harness from a scanned source. Returns its id, or null for an unknown source. */
  createHarnessFromSource(sourceId: string): string | null;
  addPart(harnessId: string, partId: string): void;
  removePart(harnessId: string, partId: string): void;
  /** Links an agent to a part. Returns why nothing changed (a few lowercase words), or null when the link was saved. */
  addLink(harnessId: string, from: string, to: string): string | null;
  removeLink(harnessId: string, from: string, to: string): void;
  setNodePosition(harnessId: string, nodeId: string, at: Point): void;
  fixMissingPart(harnessId: string, missingId: string): void;
  /** Installs. Returns why nothing changed (a few lowercase words), or null when it installed. */
  install(request: InstallRequest): string | null;
  update(request: { projectId: string; harnessId: string; interfaceIds?: readonly InterfaceId[] }): void;
  /** Takes a harness out of a project. Undo puts it back. */
  removeInstall(projectId: string, harnessId: string): void;
  /** Starts runs and schedules each to finish by itself. Returns the ids of the new runs. */
  startRuns(request: StartRequest): string[];
  finishRun(runId: string): void;
  closeRun(runId: string): void;
  rateRun(runId: string, rating: Rating | null, notes: string): void;
  setInterfaceOn(interfaceId: InterfaceId, on: boolean): void;
  /** Undoes a change. Returns why nothing changed (a few lowercase words), or null when it was undone. */
  undo(entryId: string): string | null;
  /**
   * Replaces the whole state (the real read, or the sample again). The history goes with the old state, every run timer is cancelled, and the subscribers are told.
   * The counter of new ids never goes down: an id that the old state used (an undo note may still name it) is not made again.
   */
  loadWorld(state: HarnessState): void;
  /** Cancels every timer. */
  dispose(): void;
}

export function createHarnessStore(options: StoreOptions): HarnessStore {
  let state = options.initial;
  const now = options.now ?? ((): Stamp => FIXED_NOW);
  const schedule = options.schedule ?? defaultSchedule;
  const after = options.finishAfterMs ?? RUN_FINISH_MS;
  const listeners = new Set<() => void>();
  const timers = new Set<Cancel>();
  // One listener that throws must not stop the rest from hearing: each call is guarded, and the error is written for the person who runs the app.
  const notify = (): void => { for (const l of [...listeners]) { try { l(); } catch (error) { console.error('A listener of the harness store threw.', error); } } };
  const commit = (next: HarnessState): void => { if (next === state) return; state = next; notify(); };
  const finishLater = (runId: string): void => {
    let cancel: Cancel = () => undefined;
    cancel = schedule(() => { timers.delete(cancel); commit(finishRun(state, runId)); }, after);
    timers.add(cancel);
  };
  const finishRunningOf = (from: HarnessState): void => { if (options.finishRunning === true) for (const run of from.runs) if (run.status === 'running') finishLater(run.id); };
  finishRunningOf(state);
  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    createHarness() { const r = createHarness(state, now()); commit(r.state); return r.harnessId; },
    chooseSources(ids) { commit(chooseSources(state, ids)); },
    createHarnessFromSource(sourceId) { const r = createHarnessFromSource(state, sourceId, now()); commit(r.state); return r.harnessId; },
    addPart(harnessId, partId) { commit(addPart(state, harnessId, partId, now())); },
    removePart(harnessId, partId) { commit(removePart(state, harnessId, partId, now())); },
    addLink(harnessId, from, to) { const why = addLinkProblem(state, harnessId, from, to); commit(addLink(state, harnessId, from, to, now())); return why; },
    removeLink(harnessId, from, to) { commit(removeLink(state, harnessId, from, to, now())); },
    setNodePosition(harnessId, nodeId, at) { commit(setNodePosition(state, harnessId, nodeId, at)); },
    fixMissingPart(harnessId, missingId) { commit(fixMissingPart(state, harnessId, missingId, now())); },
    install(request) { const why = installProblem(state, request); commit(install(state, request, now())); return why; },
    update(request) { commit(update(state, request, now())); },
    removeInstall(projectId, harnessId) { commit(removeInstall(state, projectId, harnessId, now())); },
    startRuns(request) { const r = startRuns(state, request, now()); commit(r.state); for (const id of r.runIds) finishLater(id); return r.runIds; },
    finishRun(runId) { commit(finishRun(state, runId)); },
    closeRun(runId) { commit(closeRun(state, runId)); },
    rateRun(runId, rating, notes) { commit(rateRun(state, runId, rating, notes)); },
    setInterfaceOn(interfaceId, on) { commit(setInterfaceOn(state, interfaceId, on, now())); },
    undo(entryId) { const r = tryUndo(state, entryId, now()); commit(r.state); return r.reason; },
    loadWorld(next) {
      for (const cancel of timers) cancel();
      timers.clear();
      state = next.nextId < state.nextId ? { ...next, nextId: state.nextId } : next;
      finishRunningOf(state);
      notify();
    },
    dispose() { for (const cancel of timers) cancel(); timers.clear(); },
  };
}
