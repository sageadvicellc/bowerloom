/**
 * The display logic of the Modules view, pure: no React, no Node, no clock. The view draws what these functions return, and a terminal view could reuse them.
 * A module is a stock extension that ships inside the app (a bundled extension that is not the Modules view itself). A module reads only what the person picks:
 * a project they picked, plus folders in the home folder that they approved once for that module. Everything stays on this computer.
 * The words live here. They obey the preview's word rules (tests/harness-words.test.ts scans this folder).
 */
import type { ExtensionManifest } from '../extensions/types.js';
import { extensionRouteOf } from '../extensions/nav.js';
import type { Route } from '../harness/route.js';
import type { ModuleApproval, ModulePlace, ModuleRefusalCode } from '../api/modules.js';

/** The id of the Modules view itself. It is listed in the navigation, and it is not one of its own modules. */
export const MODULES_ID = 'modules';

export const MODULE_WORDS = Object.freeze({
  title: 'Modules',
  hint: 'Modules ship with the app. A module reads only what you pick, and nothing leaves this computer.',
  list: 'Modules',
  none: 'No modules are loaded.',
  open: 'Open',
  openOwn: 'Open its own page',
  back: 'All modules',
  unknown: 'No module has that name.',
  reads: 'What this module can read',
  readsProject: 'A project you pick.',
  readsFolders: 'Folders you approve once for this module.',
  readsLocal: 'Nothing else. Nothing leaves this computer.',
  noFolders: 'No folder is approved for this module.',
  approve: 'Approve a folder',
  approving: 'Choose a folder in the window that opened.',
  remove: 'Remove',
  removed: 'Removed. The folder and its files are untouched.',
  approved: 'Approved.',
  folders: 'Approved folders',
  loading: 'Reading the approved folders.',
  noBridge: 'This window keeps no approvals.',
  sample: 'Sample launch. Approvals are kept only in the app on your own folders.',
  wait: 'Loading the modules.',
  unavailable: 'The Modules view did not load.',
  noEmbed: 'This module has no page inside this view.',
  bridgeMissing: 'The window did not give this module its folder calls. Folders cannot be approved or read.',
  approvedNoRefresh: 'The folder was approved, but the list could not be read again.',
  resetNote: 'The saved list was damaged. It was set aside, and a new list was started.',
  approvedReset: 'Approved. The saved list was damaged. It was set aside, and a new list was started.',
});

/** What a person reads for a pick that main's chooser refused. */
const PICK_WORDS: Readonly<Record<string, string>> = Object.freeze({
  NOT_A_FOLDER: 'That is not a folder.',
  HOME_UNREADABLE: 'Bowerloom could not read your home folder.',
  NOT_IN_HOME: 'Choose a folder inside your home folder.',
  HIDDEN_PART: 'Bowerloom does not approve a hidden folder.',
  BAD_NAME: 'A name in that path holds a character Bowerloom does not accept.',
  PATH_TOO_LONG: 'That path is too long.',
  STATE_FOLDER: 'That folder holds the data of Bowerloom itself.',
  LIBRARY_FOLDER: 'Bowerloom does not approve the Library folder or anything in it.',
  FULL: 'This module holds the most folders it can. Remove one first.',
  RECORD_BLOCKED: 'Bowerloom could not use its list of approved folders.',
  RECORD_NOT_MOVED: 'Bowerloom could not set aside its damaged list of approved folders.',
  RECORD_RESET_FAILED: 'Bowerloom set aside the damaged list of approved folders, and could not save the new one.',
  FAILED: 'Bowerloom could not save the approval.',
});

/** What a person reads for a call that was refused. A code with no words of its own reads as the failure line. */
const CALL_WORDS: Readonly<Record<string, string>> = Object.freeze({
  RECORD_DAMAGED: 'The saved list of approved folders could not be read. Approve a folder to start a new list.',
  RECORD_BLOCKED: 'Bowerloom could not use its list of approved folders.',
  UNKNOWN_MODULE: 'This module is not loaded.',
  NOT_APPROVED: 'That folder is not approved for this module.',
  NOT_ALLOWED: 'This window may not do that.',
  FAILED: 'Bowerloom could not read the approved folders.',
});

const known = (table: Readonly<Record<string, string>>, key: unknown): key is string => typeof key === 'string' && Object.hasOwn(table, key);
export const pickWords = (code: unknown): string => (known(PICK_WORDS, code) ? PICK_WORDS[code]! : PICK_WORDS.FAILED!);
export const callWords = (code: unknown): string => (known(CALL_WORDS, code) ? CALL_WORDS[code]! : CALL_WORDS.FAILED!);

/** The sentence after an approval whose list could not be read again: the folder was approved, and, after a reset, the old list was set aside. */
export const approvalNoticeNoRefresh = (result: ModuleApproval): string => (result.status === 'kept' && result.listReset === true ? `${MODULE_WORDS.approvedNoRefresh} ${MODULE_WORDS.resetNote}` : MODULE_WORDS.approvedNoRefresh);

/** What a person reads when a removal fails. A removal that fails leaves the folder approved, and the words say so. A code with no words of its own reads as the general line. */
const REMOVE_WORDS: Readonly<Record<string, string>> = Object.freeze({
  RECORD_DAMAGED: 'The saved list of approved folders could not be read, so Bowerloom could not remove that folder. It is still approved.',
  RECORD_BLOCKED: 'Bowerloom could not use its list of approved folders, so it could not remove that folder. It is still approved.',
  NOT_APPROVED: 'Bowerloom could not remove that folder, because this module does not hold it. Nothing changed.',
  FAILED: 'Bowerloom could not remove that folder. It is still approved.',
});
export const removeWords = (code: unknown): string => (known(REMOVE_WORDS, code) ? REMOVE_WORDS[code]! : REMOVE_WORDS.FAILED!);

/** The sentence a person reads after an approval: nothing for a cancelled chooser, one line for a kept place or a refused pick. */
export function approvalNotice(result: ModuleApproval): string | null {
  if (result.status === 'cancelled') return null;
  if (result.status === 'kept') return result.listReset === true ? MODULE_WORDS.approvedReset : MODULE_WORDS.approved;
  return pickWords(result.code);
}

/** One row of the list of modules. */
export interface ModuleRow { readonly id: string; readonly title: string; readonly route: string; readonly current: boolean }

/**
 * The modules the view lists, in the order main listed them: every listed extension that is not protected and is not the view itself. `selected` marks the open one.
 * The view never lists a protected default. A value that is not a manifest is left out.
 */
export function moduleRows(listed: readonly ExtensionManifest[], selected: string | null): readonly ModuleRow[] {
  return Object.freeze(listed
    .filter(m => !m.protected && m.id !== MODULES_ID && m.routes.length > 0)
    .map(m => Object.freeze({ id: m.id, title: m.title, route: m.routes[0]!, current: m.id === selected })));
}

/** The page of a module on its own route: Local models has a route of its own, and every other stock extension opens at `#app/extension/<route>`. */
export const ownRouteOf = (manifest: ExtensionManifest): Route => (manifest.id === 'local-models' ? { name: 'local-models' } : extensionRouteOf(manifest));

/** The count line after the title, such as "1 module". Null when there is none. */
export const moduleCount = (rows: readonly ModuleRow[]): string | undefined => (rows.length === 0 ? undefined : `${rows.length} ${rows.length === 1 ? 'module' : 'modules'}`);

/** The day an approval was made, as it was saved (the first ten characters of the ISO time), or the whole text when it is not an ISO time. No clock is read. */
export const approvedDay = (place: ModulePlace): string => (/^\d{4}-\d{2}-\d{2}T/.test(place.approvedAt) ? place.approvedAt.slice(0, 10) : place.approvedAt);

/** The refusal codes that a list or a removal can end with, for a test that holds each to words. */
export const CALL_CODES: readonly ModuleRefusalCode[] = Object.freeze(['RECORD_DAMAGED', 'RECORD_BLOCKED', 'UNKNOWN_MODULE', 'NOT_APPROVED', 'NOT_ALLOWED', 'FAILED']);
