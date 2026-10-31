/**
 * Selectors of the harness-first preview: what a screen reads from the world. Pure functions of the state, so every screen says the same thing.
 * No status is stored. A status is computed from the install data, and when a row has several, the worst one wins (conflict, then out of date, then installed).
 * A harness that was only ever "not installed" in one interface of a project (an interface the person never switched on) does not count against that project:
 * "not installed" shows only when nothing is installed at all.
 */
import type { Harness, HarnessState, Install, InstallState, Interface, InterfaceId, Part, PartKind } from './types.js';
import { PART_KINDS } from './types.js';
import type { Route } from './route.js';

export type Tone = 'good' | 'warn' | 'bad' | 'quiet';

/** A state as a dot and words. The dot is drawn in the colour of `tone`, and the words always say the state, so colour is never the only signal. */
export interface StatusLine { readonly state: InstallState; readonly tone: Tone; readonly words: string }

const RANK: Readonly<Record<InstallState, number>> = { conflict: 3, 'out-of-date': 2, installed: 1, 'not-installed': 0 };
const TONE: Readonly<Record<InstallState, Tone>> = { conflict: 'bad', 'out-of-date': 'warn', installed: 'good', 'not-installed': 'quiet' };
export const stateTone = (state: InstallState): Tone => TONE[state];

/** The worst of some states (conflict, then out of date, then installed, then not installed), or null for none. */
export function worstState(states: readonly InstallState[]): InstallState | null {
  let worst: InstallState | null = null;
  for (const state of states) if (worst === null || RANK[state] > RANK[worst]) worst = state;
  return worst;
}

// ---- Looking things up

export const partById = (state: HarnessState, id: string): Part | undefined => state.parts.find(p => p.id === id);
export const harnessById = (state: HarnessState, id: string): Harness | undefined => state.harnesses.find(h => h.id === id);
export const interfaceById = (state: HarnessState, id: InterfaceId): Interface | undefined => state.interfaces.find(i => i.id === id);
export const projectById = (state: HarnessState, id: string): HarnessState['projects'][number] | undefined => state.projects.find(p => p.id === id);

/** The parts a harness holds, in the order of its manifest. */
export function partsOf(state: HarnessState, harness: Harness): Part[] {
  const out: Part[] = [];
  for (const id of harness.partIds) { const part = partById(state, id); if (part !== undefined) out.push(part); }
  return out;
}

/** The parts an agent uses in this harness, in the order of its links. A link to a missing part is left out. */
export function usesOf(state: HarnessState, harness: Harness, agentId: string): Part[] {
  const out: Part[] = [];
  for (const link of harness.links) if (link.from === agentId && harness.partIds.includes(link.to)) { const part = partById(state, link.to); if (part !== undefined) out.push(part); }
  return out;
}

/** The agents of this harness that use a part. */
export function usedByAgents(state: HarnessState, harness: Harness, partId: string): Part[] {
  const out: Part[] = [];
  for (const link of harness.links) if (link.to === partId && harness.partIds.includes(link.from)) { const part = partById(state, link.from); if (part !== undefined && !out.includes(part)) out.push(part); }
  return out;
}

/** The harnesses that hold a part. */
export const harnessesHolding = (state: HarnessState, partId: string): Harness[] => state.harnesses.filter(h => h.partIds.includes(partId));

/**
 * True when an address names something this state does not hold: a harness, a part, a project, a run, a group of runs or an interface that is not there. The screens that name
 * nothing (Harnesses, Library, Runs, History...) are never gone. A new state replaces the old one, so the address of an old harness must not stay open.
 */
export function routeGone(state: HarnessState, route: Route): boolean {
  switch (route.name) {
    case 'harnesses': return route.id !== undefined && harnessById(state, route.id) === undefined;
    case 'builder': return harnessById(state, route.id) === undefined;
    case 'file': return partById(state, route.partId) === undefined;
    case 'library': return route.partId !== undefined && partById(state, route.partId) === undefined;
    case 'projects': return route.id !== undefined && projectById(state, route.id) === undefined;
    case 'runs': return route.id !== undefined && !state.runs.some(r => r.id === route.id);
    case 'compare': return !state.runs.some(r => r.groupId === route.group);
    case 'interfaces': return route.id !== undefined && !state.interfaces.some(i => i.id === route.id);
    default: return false;
  }
}

// ---- Counts and their words

/** How many of each kind a harness holds. A missing part counts, because the harness still names it. */
export function kindCounts(state: HarnessState, harness: Harness): Record<PartKind, number> {
  const counts: Record<PartKind, number> = { agent: 0, skill: 0, tool: 0, context: 0 };
  for (const part of partsOf(state, harness)) counts[part.kind] += 1;
  for (const ref of harness.missing) counts[ref.kind] += 1;
  return counts;
}

/** "11 parts": the parts the harness holds, not the ones it only names. */
export const partsWords = (harness: Harness): string => `${harness.partIds.length} ${harness.partIds.length === 1 ? 'part' : 'parts'}`;

const KIND_WORD: Readonly<Record<PartKind, readonly [string, string]>> = { agent: ['agent', 'agents'], skill: ['skill', 'skills'], tool: ['tool', 'tools'], context: ['context', 'context'] };
export const kindWord = (kind: PartKind, n: number): string => KIND_WORD[kind][n === 1 ? 0 : 1];
/** "3 agents · 5 skills · 2 tools · 2 context". A kind with none is left out. */
export function countsWords(counts: Readonly<Record<PartKind, number>>): string {
  return PART_KINDS.filter(kind => counts[kind] > 0).map(kind => `${counts[kind]} ${kindWord(kind, counts[kind])}`).join(' · ');
}
export const harnessCountsWords = (state: HarnessState, harness: Harness): string => countsWords(kindCounts(state, harness));

/** The Library tab counts: only the parts the Library lists. */
export function libraryCounts(state: HarnessState): Record<PartKind, number> {
  const counts: Record<PartKind, number> = { agent: 0, skill: 0, tool: 0, context: 0 };
  for (const part of state.parts) if (part.inLibrary) counts[part.kind] += 1;
  return counts;
}

/** "Used in 2 harnesses" or "Not used yet". */
export const usedInWords = (n: number): string => (n === 0 ? 'Not used yet' : `Used in ${n} ${n === 1 ? 'harness' : 'harnesses'}`);
/** "Used in 1 other harness", for a part seen from inside one harness. */
export const usedInOtherWords = (n: number): string => `Used in ${n} other ${n === 1 ? 'harness' : 'harnesses'}`;

// ---- Interfaces

/** The interfaces the install and start sheets offer: switched on, and found. */
export const offeredInterfaces = (state: HarnessState): Interface[] => state.interfaces.filter(i => i.on && i.health !== 'not-found');

/** The interfaces a harness runs in: switched on and ready. */
export const runsIn = (state: HarnessState): Interface[] => state.interfaces.filter(i => i.on && i.health === 'ready');

/** The interfaces a part works in: the ones that are switched on, less the ones that cannot use it. */
export const worksIn = (state: HarnessState, part: Part): Interface[] => runsIn(state).filter(i => !part.cannotUse.includes(i.id));

/** The parts of a harness that an interface cannot use. */
export const blockedFor = (state: HarnessState, harness: Harness, interfaceId: InterfaceId): Part[] => partsOf(state, harness).filter(p => p.cannotUse.includes(interfaceId));

/** What the install sheet says about an interface, below its name. */
export function installInterfaceLine(state: HarnessState, harness: Harness, iface: Interface): string {
  if (iface.health === 'not-found') return 'Not found on this computer.';
  if (iface.health === 'problem') return 'Found. Its config file has a problem, so it is off.';
  const blocked = blockedFor(state, harness, iface.id);
  if (blocked.length === 0) return `Found. Uses all ${harness.partIds.length} parts.`;
  const kind = blocked.every(p => p.kind === blocked[0]!.kind) ? blocked[0]!.kind : null;
  const noun = kind === null ? (blocked.length === 1 ? 'part' : 'parts') : kindWord(kind, blocked.length);
  return `Found. Cannot use ${blocked.length} ${noun}: ${blocked.map(p => p.name).join(', ')}.`;
}

// ---- Install status

const joinNames = (names: readonly string[]): string => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`);

/** The worst state recorded for one install, or "not installed" when it records nothing, or only interfaces with nothing installed. */
export function installState(install: Install): InstallState {
  return worstState(Object.values(install.states)) ?? 'not-installed';
}

export const installsOfProject = (state: HarnessState, projectId: string): Install[] => state.installs.filter(i => i.projectId === projectId);
export const installsOfHarness = (state: HarnessState, harnessId: string): Install[] => state.installs.filter(i => i.harnessId === harnessId);
export const installOf = (state: HarnessState, projectId: string, harnessId: string): Install | undefined => state.installs.find(i => i.projectId === projectId && i.harnessId === harnessId);

/** The interfaces of an install in the order of the interface list, with their states. */
export function installStates(state: HarnessState, install: Install): { interfaceId: InterfaceId; name: string; state: InstallState }[] {
  const out: { interfaceId: InterfaceId; name: string; state: InstallState }[] = [];
  for (const iface of state.interfaces) { const s = install.states[iface.id]; if (s !== undefined) out.push({ interfaceId: iface.id, name: iface.name, state: s }); }
  return out;
}

const STATE_WORDS: Readonly<Record<InstallState, string>> = { installed: 'installed', 'out-of-date': 'out of date', conflict: 'has a conflict', 'not-installed': 'not installed' };
/** "Claude Code installed", "Codex out of date", "Codex has a conflict", "OpenCode not installed". */
export const chipWords = (name: string, state: InstallState): string => `${name} ${STATE_WORDS[state]}`;
/** "Installed", "Out of date", "Has a conflict", "Not installed". */
export const stateWords = (state: InstallState): string => { const w = STATE_WORDS[state]; return w.charAt(0).toUpperCase() + w.slice(1); };

/** One dot and words for an install: the worst state, with the names of the interfaces that have it. "Codex out of date", or "All installed". */
export function installLine(state: HarnessState, install: Install): StatusLine {
  const worst = installState(install);
  const rows = installStates(state, install);
  if (worst === 'installed') return { state: worst, tone: TONE[worst], words: 'All installed' };
  if (worst === 'not-installed') return { state: worst, tone: TONE[worst], words: 'Not installed' };
  return { state: worst, tone: TONE[worst], words: chipWords(joinNames(rows.filter(r => r.state === worst).map(r => r.name)), worst) };
}

/** The status of a project: the worst of its installs, or null when it has no harness yet. */
export function projectStatus(state: HarnessState, projectId: string): StatusLine | null {
  const installs = installsOfProject(state, projectId);
  const worst = worstState(installs.map(installState));
  if (worst === null) return null;
  const rows = installs.filter(i => installState(i) === worst);
  if (worst === 'installed') return { state: worst, tone: TONE[worst], words: 'All installed' };
  if (worst === 'not-installed') return { state: worst, tone: TONE[worst], words: 'Not installed' };
  const names = rows.flatMap(i => installStates(state, i).filter(r => r.state === worst).map(r => r.name));
  return { state: worst, tone: TONE[worst], words: chipWords(joinNames([...new Set(names)]), worst) };
}

/** The status of one harness over all its projects, for a row of the list. `affected` projects need an update or have a conflict, out of `total` that hold it. */
export interface HarnessStatus extends StatusLine { readonly affected: number; readonly total: number }
export function harnessStatus(state: HarnessState, harnessId: string): HarnessStatus {
  const installs = installsOfHarness(state, harnessId).filter(i => installState(i) !== 'not-installed');
  const worst = worstState(installs.map(installState));
  if (worst === null) return { state: 'not-installed', tone: 'quiet', words: 'Not installed', affected: 0, total: 0 };
  const total = installs.length, affected = installs.filter(i => installState(i) === worst).length;
  const of = total === 1 ? '1 project' : `${affected} of ${total} projects`;
  if (worst === 'installed') return { state: worst, tone: 'good', words: total === 1 ? 'Installed in 1 project' : `Installed in ${total} projects`, affected, total };
  if (worst === 'conflict') return { state: worst, tone: 'bad', words: `Conflict in ${of}`, affected, total };
  return { state: worst, tone: 'warn', words: total === 1 ? 'Out of date in 1 project' : `Needs an update in ${of}`, affected, total };
}

/** The status of an interface across every install: the worst state of that interface, or null when no install records it. */
export function interfaceInstallState(state: HarnessState, interfaceId: InterfaceId): InstallState | null {
  const states: InstallState[] = [];
  for (const install of state.installs) { const s = install.states[interfaceId]; if (s !== undefined) states.push(s); }
  return worstState(states);
}

/** What the interface list says for one interface: its health, its words, and the worst install state. */
export function interfaceStatus(state: HarnessState, interfaceId: InterfaceId): { health: Interface['health']; words: string; tone: Tone; install: InstallState | null } {
  const iface = interfaceById(state, interfaceId);
  const health = iface?.health ?? 'not-found';
  return { health, words: iface?.healthWords ?? 'Not found', tone: health === 'ready' ? 'good' : health === 'problem' ? 'warn' : 'quiet', install: interfaceInstallState(state, interfaceId) };
}

// ---- Start

/** What the start sheet says about an interface for one project. */
export function startInterfaceLine(state: HarnessState, projectId: string, harnessId: string, iface: Interface): StatusLine {
  if (iface.health === 'not-found') return { state: 'not-installed', tone: 'quiet', words: 'Not found on this computer.' };
  const install = installOf(state, projectId, harnessId);
  const s = install?.states[iface.id] ?? 'not-installed';
  if (s === 'installed') return { state: s, tone: 'good', words: 'Installed in this project.' };
  if (s === 'out-of-date') return { state: s, tone: 'warn', words: 'Out of date. You review the update before it runs.' };
  if (s === 'conflict') return { state: s, tone: 'bad', words: 'Has a conflict. You settle it before it runs.' };
  return { state: s, tone: 'quiet', words: 'Not installed. Install, then start.' };
}

/** The ticked interfaces that must be installed or updated before a run can start. An empty list means every run can start now. */
export function startNeeds(state: HarnessState, projectId: string, harnessId: string, interfaceIds: readonly InterfaceId[]): InterfaceId[] {
  const install = installOf(state, projectId, harnessId);
  return interfaceIds.filter(id => (install?.states[id] ?? 'not-installed') !== 'installed');
}

/** The Compare notice of the start sheet, or null when fewer than two interfaces are ticked. */
export function compareNotice(count: number): string | null {
  return count < 2 ? null : `Compare is on. Bowerloom opens ${count} runs with the same instruction in one folder, so run them one at a time if they write files.`;
}

export const startButtonWords = (count: number): string => `Review and start ${count} ${count === 1 ? 'run' : 'runs'}`;
