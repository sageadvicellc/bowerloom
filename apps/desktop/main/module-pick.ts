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

const REFUSALS: ReadonlySet<string> = new Set<ModulePickRefusal>(['NOT_A_FOLDER', 'HOME_UNREADABLE', 'NOT_IN_HOME', 'HIDDEN_PART', 'BAD_NAME', 'PATH_TOO_LONG', 'STATE_FOLDER', 'LIBRARY_FOLDER', 'FULL', 'RECORD_BLOCKED', 'RECORD_NOT_MOVED', 'RECORD_RESET_FAILED', 'FAILED']);
/** A cause class is a code or a name of one short word. Anything else is not logged. */
const CAUSE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/** The answer for the page, cut to the fields it may see: each is copied by name, so nothing the approver held beyond them reaches the page. */
function viewOf(result: Approved): ModuleApproval {
  if (result.status === 'kept') return { status: 'kept', place: { id: result.place.id, label: result.place.label, approvedAt: result.place.approvedAt }, ...(result.resetRecord === true ? { listReset: true as const } : {}) };
  return { status: 'refused', code: REFUSALS.has(result.code) ? (result.code as ModulePickRefusal) : 'FAILED' };
}

export async function pickModulePlace(d: ModulePickDeps): Promise<ModuleApproval> {
  // A logger that throws never changes the answer.
  const say = (line: string): void => { try { d.tell(line); } catch { /* the log is lost; the answer stands */ } };
  const picked = await d.show();
  if (picked === null) return { status: 'cancelled' };
  const result = (d.approve ?? approvePlace)({ stateRoot: d.stateRoot, home: d.home, moduleId: d.moduleId, picked });
  // A damaged list that was set aside is always told, whatever came after. The cause is a class word (an error code or name), never a message and never a path.
  if (result.resetRecord === true) say('Bowerloom set aside a damaged list of approved folders and started a new one.');
  if (result.status === 'refused') say(`Bowerloom could not approve a folder for a module (${result.code}${result.cause !== undefined && CAUSE.test(result.cause) ? `, ${result.cause}` : ''}).`);
  return viewOf(result);
}
