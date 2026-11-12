/**
 * The pick of a module's home-folder place in main's own chooser, and the approval it carries. When the person picks a folder for a module ("Approve a folder"), the pick is the approval: `approvePlace` of
 * packages/module-scope records it, once for that module, as a home-relative place (never a full path). This is the only caller of `approvePlace` in the app, and main/modules-ipc.ts is the only caller of this
 * module (tests/module-pick-pins.test.ts holds both). It is called only with the dialog's own answer: nothing from the window reaches it, so the page cannot name a folder. A cancelled chooser records nothing.
 * This module imports no fs name. The write itself is in the package, which the writer lists of the app do not scan: tests/module-pick-pins.test.ts holds where it can be called from.
 */
import { approvePlace } from '../../../packages/module-scope/src/index.js';
import type { Approved } from '../../../packages/module-scope/src/index.js';
import type { ModuleApproval, ModulePickRefusal } from '../shared/api/modules.js';

export interface ModulePickDeps {
  readonly moduleId: string;
  /** main's chooser: the folder the person picked, or null. */
  readonly show: () => Promise<string | null>;
  readonly stateRoot: string;
  readonly home: string;
  /** Test use: another approver. Defaults to the package. */
  readonly approve?: typeof approvePlace;
  /** One fixed line for the log. It never holds a path. */
  readonly tell: (line: string) => void;
}

const REFUSALS: ReadonlySet<string> = new Set<ModulePickRefusal>(['NOT_A_FOLDER', 'NOT_IN_HOME', 'HIDDEN_PART', 'STATE_FOLDER', 'FULL', 'RECORD_BLOCKED', 'RECORD_NOT_MOVED', 'FAILED']);

/** The answer for the page, cut to the fields it may see: each is copied by name, so nothing the approver held beyond them reaches the page. */
function viewOf(result: Approved): ModuleApproval {
  if (result.status === 'kept') return { status: 'kept', place: { id: result.place.id, label: result.place.label, approvedAt: result.place.approvedAt } };
  return { status: 'refused', code: REFUSALS.has(result.code) ? (result.code as ModulePickRefusal) : 'FAILED' };
}

export async function pickModulePlace(d: ModulePickDeps): Promise<ModuleApproval> {
  const picked = await d.show();
  if (picked === null) return { status: 'cancelled' };
  const result = (d.approve ?? approvePlace)({ stateRoot: d.stateRoot, home: d.home, moduleId: d.moduleId, picked });
  if (result.status === 'refused') d.tell(`Bowerloom could not approve a folder for a module (${result.code}).`);
  return viewOf(result);
}
