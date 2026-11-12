/**
 * The calls of the fifth bridge, `bowerloomModules`: the read scope of a module (v0.9, lane 2). A module reads only what the person picks, plus home-folder places the person approved once for that module.
 * A project the person picked is read through the engine calls, as before. This bridge holds the other half: the places in the home folder, and the one read of a text file inside such a place.
 * The 39 engine calls with their golden file, the 3 reader calls, the local calls and the runs calls stay as they are: nothing is added to them. The calls, their counts and their channels are held equal to
 * packages/engine-api/golden/module-calls.json by tests/modules-bridge.test.ts.
 *
 * What crosses the bridge is plain data. A place is an id, a label written with `~` and the time it was approved, never a full path. The page cannot name a folder to approve: `approveModulePlace` takes the module id
 * only, and main opens its own folder chooser; the pick is the approval (main/module-pick.ts). Only types and constants are here, and no import at all (tests/real-static.test.ts holds that the file has no import or require line other than `import type`), so the
 * preload, main and the page read one table. The checks of an argument are in shared/api/modules-shape.ts, which the preload does not load.
 */
export const MODULE_CALLS = Object.freeze(['listModulePlaces', 'approveModulePlace', 'revokeModulePlace', 'readModuleFile'] as const);
export type ModuleCall = (typeof MODULE_CALLS)[number];

/** How many arguments each call takes. A call with another count is refused BAD_ARGUMENT. */
export const MODULE_ARITY: Readonly<Record<ModuleCall, number>> = Object.freeze({ listModulePlaces: 1, approveModulePlace: 1, revokeModulePlace: 2, readModuleFile: 3 });

/** One channel for each call, in the namespace of this bridge. */
export const MODULE_CHANNELS: Readonly<Record<ModuleCall, string>> = Object.freeze({
  listModulePlaces: 'bowerloom-modules:listModulePlaces', approveModulePlace: 'bowerloom-modules:approveModulePlace', revokeModulePlace: 'bowerloom-modules:revokeModulePlace', readModuleFile: 'bowerloom-modules:readModuleFile',
});

/**
 * The short codes a modules call can be refused with. NOT_ALLOWED: the sender is not the app page. BAD_ARGUMENT: the count or the shape of the arguments is wrong. UNKNOWN_MODULE: main holds no stock extension
 * with that id. NOT_APPROVED: the module was never approved for that place (or the place was removed). PLACE_CHANGED: the approved place is now another folder, or is gone. BAD_PATH: the path is not one plain
 * relative path. OUTSIDE_PLACE: a link leads out of the place. NOT_A_FILE, TOO_LARGE, NOT_TEXT, UNREADABLE: the file refusals. HOME_UNREADABLE: the home folder could not be read. RECORD_DAMAGED and RECORD_BLOCKED: the saved record of approvals cannot be used.
 * FAILED: anything else; main logs the class of the cause, and the page never sees a message.
 */
export const MODULE_REFUSAL_CODES = ['NOT_ALLOWED', 'BAD_ARGUMENT', 'UNKNOWN_MODULE', 'NOT_APPROVED', 'PLACE_CHANGED', 'BAD_PATH', 'OUTSIDE_PLACE', 'NOT_A_FILE', 'TOO_LARGE', 'NOT_TEXT', 'UNREADABLE', 'HOME_UNREADABLE', 'RECORD_DAMAGED', 'RECORD_BLOCKED', 'FAILED'] as const;
export type ModuleRefusalCode = (typeof MODULE_REFUSAL_CODES)[number];
export const MODULE_REFUSALS: readonly string[] = Object.freeze([...MODULE_REFUSAL_CODES]);

/** One approved place, as the page sees it: never a full path. */
export interface ModulePlace { readonly id: string; readonly label: string; readonly approvedAt: string }
export interface ModulePlaces { readonly places: readonly ModulePlace[] }

/**
 * Why main's chooser did not approve a pick. NOT_A_FOLDER: not a folder. NOT_IN_HOME: not below the home folder (the home folder itself is too wide). HIDDEN_PART: a part of the path starts with a dot.
 * STATE_FOLDER: the folder is, holds or sits in Bowerloom's own state folder. FULL: the module holds the most places. HOME_UNREADABLE: the home folder itself could not be read (the pick is not at fault).
 * BAD_NAME: a part of the path holds a control or bidirectional character. PATH_TOO_LONG: the path is over the limit. LIBRARY_FOLDER: the folder is in Library. RECORD_BLOCKED, RECORD_NOT_MOVED, FAILED: the record could not be used
 * or written. RECORD_RESET_FAILED: a damaged list was set aside and the new list could not be written.
 */
export const MODULE_PICK_REFUSALS = ['NOT_A_FOLDER', 'HOME_UNREADABLE', 'NOT_IN_HOME', 'HIDDEN_PART', 'BAD_NAME', 'PATH_TOO_LONG', 'STATE_FOLDER', 'LIBRARY_FOLDER', 'FULL', 'RECORD_BLOCKED', 'RECORD_NOT_MOVED', 'RECORD_RESET_FAILED', 'FAILED'] as const;
export type ModulePickRefusal = (typeof MODULE_PICK_REFUSALS)[number];

/** The answer of `approveModulePlace`: the place was kept, the person cancelled the chooser, or the pick was refused. A cancel records nothing. */
export type ModuleApproval =
  /** `listReset`: a damaged saved list was set aside during this approval, and a new list was started. */
  | { readonly status: 'kept'; readonly place: ModulePlace; readonly listReset?: true }
  | { readonly status: 'cancelled' }
  | { readonly status: 'refused'; readonly code: ModulePickRefusal };

/** The answer of `readModuleFile`. */
export interface ModuleFile { readonly text: string }

/** The object `bowerloomModules` holds in the page. */
export interface ModulesBridge {
  listModulePlaces(moduleId: string): Promise<ModulePlaces>;
  /** Opens main's own folder chooser for the home folder. The pick is the approval, once for this module. */
  approveModulePlace(moduleId: string): Promise<ModuleApproval>;
  /** Removes one place of this module. Answers the places that are left. Deletes no file of the person's. */
  revokeModulePlace(moduleId: string, placeId: string): Promise<ModulePlaces>;
  /** Reads one text file at a relative path inside an approved place of this module. */
  readModuleFile(moduleId: string, placeId: string, path: string): Promise<ModuleFile>;
}

/** The longest relative path a read takes, in characters. The package holds the same limit (packages/module-scope). */
export const MODULE_PATH_LIMIT = 512;
