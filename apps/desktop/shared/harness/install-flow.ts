/**
 * The rules of the install sheet, as pure functions of the world: which interfaces it offers and ticks, what it says about each, and when "Install" may be pressed.
 * The sheet draws these and holds only the person's choices (the project, the harness, the ticks, how each conflict is settled).
 * A conflict is settled when the person has pressed one of its three choices. "Keep mine" starts highlighted, because it is the one that changes nothing, but it counts only once it is pressed.
 */
import type { ConflictChoice, Harness, HarnessState, InstallPlan, Interface, InterfaceId } from './types.js';
import { blockedFor, installInterfaceLine, installOf } from './status.js';
import type { Tone } from './status.js';
import { keepBothName } from './files.js';

/** True when the sheet may offer an interface: it is switched on and it was found. */
export const selectable = (iface: Interface): boolean => iface.on && iface.health !== 'not-found';

/**
 * The interfaces ticked when the sheet opens: the ones that are on and ready. When the harness is in the project already, only the interfaces it has been installed for
 * (any state but "not installed"), so an update does not add an interface the person never used.
 */
export function defaultInterfaces(state: HarnessState, projectId: string | null, harnessId: string | null): InterfaceId[] {
  const ready = state.interfaces.filter(i => selectable(i) && i.health === 'ready').map(i => i.id);
  const install = projectId === null || harnessId === null ? undefined : installOf(state, projectId, harnessId);
  if (install === undefined) return ready;
  const used = ready.filter(id => (install.states[id] ?? 'not-installed') !== 'not-installed');
  return used.length > 0 ? used : ready;
}

/** The interfaces the install is for: the person's ticks (or the default ones), only those that are still offered, in the order of the interface list. */
export function chosenInterfaces(state: HarnessState, ticked: readonly InterfaceId[] | null, projectId: string | null, harnessId: string | null): InterfaceId[] {
  const wanted = new Set(ticked ?? defaultInterfaces(state, projectId, harnessId));
  return state.interfaces.filter(i => selectable(i) && wanted.has(i.id)).map(i => i.id);
}

/** What the interface step says about one interface, with the colour of its dot. */
export function interfaceLine(state: HarnessState, harness: Harness, iface: Interface): { words: string; tone: Tone } {
  if (iface.health === 'not-found') return { words: installInterfaceLine(state, harness, iface), tone: 'quiet' };
  if (iface.health === 'problem') return { words: iface.on ? 'Found. Its config file has a problem.' : installInterfaceLine(state, harness, iface), tone: 'warn' };
  if (!iface.on) return { words: 'Found. Switched off in Engines.', tone: 'quiet' };
  return { words: installInterfaceLine(state, harness, iface), tone: blockedFor(state, harness, iface.id).length === 0 ? 'good' : 'warn' };
}

/** The choice for a conflict: the one the person pressed, else "Keep mine". */
export const choiceFor = (picked: Readonly<Record<string, ConflictChoice>>, path: string): ConflictChoice => picked[path] ?? 'keep-mine';

/** The choices to hand to the store: one for each conflict of the plan. */
export function choicesOf(plan: InstallPlan, picked: Readonly<Record<string, ConflictChoice>>): Record<string, ConflictChoice> {
  const out: Record<string, ConflictChoice> = {};
  for (const file of plan.conflicts) out[file.path] = choiceFor(picked, file.path);
  return out;
}

/** True when every conflict of the plan is settled (the person pressed a choice for it). A plan with no conflict is always ready. */
export const settled = (plan: InstallPlan, confirmed: readonly string[]): boolean => plan.conflicts.every(file => confirmed.includes(file.path));

/** The conflicts that still wait for a choice. */
export const unsettled = (plan: InstallPlan, confirmed: readonly string[]): string[] => plan.conflicts.filter(file => !confirmed.includes(file.path)).map(file => file.path);

/** The words of each choice, and the one line that says what it does. */
export const CHOICE_WORDS: Readonly<Record<ConflictChoice, string>> = Object.freeze({ 'keep-mine': 'Keep mine', 'use-harness': 'Use the harness copy', 'keep-both': 'Keep both' });
export function choiceHint(choice: ConflictChoice, path: string): string {
  if (choice === 'keep-mine') return 'Your file stays as it is.';
  if (choice === 'use-harness') return 'Your file is replaced. Undo brings it back.';
  return `Saves the harness copy next to yours as ${keepBothName(path)}.`;
}
