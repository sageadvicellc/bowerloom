/**
 * The refusal codes of the engine API, by the side that returns them. Taken from the base release:
 *  - the engine's call refusals: ENGINE_CALL_REFUSALS in apps/desktop/shared/engine/types.ts. A call is refused with one of these before it runs, as a thrown error whose
 *    message is the code.
 *  - the two named outcomes of main itself: NOT_THE_PLAN_SHOWN (a write is not the plan main showed last) and CANCELLED (the person said no in main's own dialog). Each comes
 *    back as an `Answer` refusal with words.
 *  - the refusals of main with words, defined in the same file (the `*_MAIN_WORDS` tables).
 *  - the refusals of main with inline words, that are in no words table: the chooser refusals, the quit refusal, the export place refusal and the START_* refusals
 *    (`ENGINE_MAIN_ANSWER_REFUSAL_CODES`).
 *  - the steps: a worker cause or a read timeout, carried in `refusal.step` of a FAILED refusal (`ENGINE_REFUSAL_STEPS`).
 *  - the reader's gate codes (real-ipc.ts) and its own codes (the `RealRefusal` class of real-scan.ts).
 * The package refusals the engine passes through (ADOPTION_*, PORTABLE_*, SAVE_*, EDIT_*, VERSION_*, NOTES_*, BUNDLE_*) are open: the contract fixes their format, not their list.
 */

/** The format of every code: upper-case words joined by underscores. */
export const ENGINE_CODE_FORMAT = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

/** The codes a call is refused with before it runs. */
export const ENGINE_CALL_REFUSAL_CODES: readonly string[] = Object.freeze(['NOT_ALLOWED', 'BAD_ARGUMENT', 'UNKNOWN_FOLDER', 'UNKNOWN_BUNDLE', 'FAILED']);

/** The write is not the plan main showed last. */
export const NOT_THE_PLAN_SHOWN = 'NOT_THE_PLAN_SHOWN';
/** The person closed main's own dialog without a yes. */
export const CANCELLED = 'CANCELLED';
/** The two named outcomes. */
export const NAMED_OUTCOMES: readonly string[] = Object.freeze([NOT_THE_PLAN_SHOWN, CANCELLED]);

/** The refusals of main itself that come with words (the `*_MAIN_WORDS` tables of the base). */
export const ENGINE_MAIN_REFUSAL_CODES: readonly string[] = Object.freeze([
  'SAVE_NO_DEFINITION', 'SAVE_SOURCE_MISSING', 'SAVE_POINT_TOO_LARGE', 'SOURCE_NAME_TAKEN', 'SAVE_EXECUTABLE_UNACKNOWLEDGED',
  'EXPORT_NO_DEFINITION', 'IMPORT_FOLDER_HAS_HARNESS', 'IMPORT_NEEDS_ACKNOWLEDGEMENT', 'EXPORT_NEEDS_ACKNOWLEDGEMENT', 'BUNDLE_FILE_FAILED',
  'KIT_INVALID', 'KIT_ALREADY_ADDED', 'NOTES_NOT_CHOSEN', 'REPORT_NONE', 'REPORT_NOT_SHOWN', 'REPORT_UNSAFE', 'REPORT_OPEN_FAILED',
]);

/**
 * The refusals of main that come back as an `Answer` with words written where they are made, so no words table holds them. Each was read in the base source:
 *  - NOT_THE_FOLDER_SHOWN and NOT_A_FOLDER: the folder chooser calls (main/engine-service.ts).
 *  - QUIT_BEGUN: a share write that came back from its dialog after a quit began (main/engine-bundle.ts).
 *  - EXPORT_TARGET_IN_HARNESS: the place for a bundle is inside `.bowerloom` (main/engine-bundle.ts).
 *  - the START_* codes: the keys of START_MAIN_WORDS (shared/engine/start-command.ts), START_INSTRUCTION_SUBCOMMAND (shared/engine/start-answer.ts), and START_COPY_FAILED
 *    (main/engine-service.ts).
 * Not here: UNKNOWN_BUNDLE_HELD is a mark between the worker and main, and main answers UNKNOWN_BUNDLE for it. BUNDLE_USAGE is a code of the bundle package, so it is open.
 */
export const ENGINE_MAIN_ANSWER_REFUSAL_CODES: readonly string[] = Object.freeze([
  'NOT_THE_FOLDER_SHOWN', 'NOT_A_FOLDER', 'QUIT_BEGUN', 'EXPORT_TARGET_IN_HARNESS',
  'START_INSTRUCTION_EMPTY', 'START_INSTRUCTION_TOO_LONG', 'START_INSTRUCTION_CHARACTERS', 'START_INSTRUCTION_HIDDEN', 'START_INSTRUCTION_BROKEN', 'START_INSTRUCTION_DASH',
  'START_INSTRUCTION_SUBCOMMAND', 'START_FOLDER_HIDDEN', 'START_FOLDER_NAME', 'START_COPY_FAILED',
]);

/**
 * The steps of a FAILED refusal. A helper thread that stopped, or a read that took too long, comes back as the code FAILED with words, and names its cause in
 * `refusal.step` (main/engine-bundle-host.ts, main/engine-bundle.ts). A step is not a code of its own.
 */
export const ENGINE_REFUSAL_STEPS: readonly string[] = Object.freeze(['READ_TIMED_OUT', 'WORKER_CRASHED', 'WORKER_OUT_OF_MEMORY', 'WORKER_NOT_STARTED', 'WORKER_TIMED_OUT']);

/** The codes the reader's handler refuses with before a read: the wrong page, the wrong argument count, or an unexpected failure. */
export const READER_GATE_REFUSAL_CODES: readonly string[] = Object.freeze(['NOT_ALLOWED', 'BAD_ARGUMENT', 'FAILED']);

/** The codes the reader itself refuses with (`RealRefusal`). */
export const READER_REFUSAL_CODES: readonly string[] = Object.freeze(['BAD_ARGUMENT', 'UNKNOWN_PLACE', 'TOO_MANY', 'BUSY', 'NO_HOME']);

/** The codes a local call is refused with before it runs: the wrong page, or an argument where the call takes none. A probe that fails is never one of them. */
export const LOCAL_CALL_REFUSAL_CODES: readonly string[] = Object.freeze(['NOT_ALLOWED', 'BAD_ARGUMENT']);

/** The codes a runs call is refused with before it runs: the wrong page, a wrong argument, a folder or a run main does not know. FAILED (an unexpected failure) is not named, as for the local calls. */
export const RUN_CALL_REFUSAL_CODES: readonly string[] = Object.freeze(['NOT_ALLOWED', 'BAD_ARGUMENT', 'UNKNOWN_FOLDER', 'UNKNOWN_RUN', 'RUN_LIMIT', 'STORE_DAMAGED', 'TOO_LONG', 'FOLDER_CHARACTER', 'FOLDER_LINK']);

/**
 * The codes a modules call is refused with: the wrong page, a wrong argument, a module main does not hold (UNKNOWN_MODULE), a place the module was never approved for (NOT_APPROVED), a place that is now another folder
 * (PLACE_CHANGED), a path that is not plain (BAD_PATH), a link that leads out of the place (OUTSIDE_PLACE), and the file refusals (NOT_A_FILE, TOO_LARGE, NOT_TEXT, UNREADABLE). RECORD_DAMAGED and RECORD_BLOCKED are the
 * states of the saved record of approvals. A pick that main's chooser refuses is an answer with a status, not a refusal. FAILED (an unexpected failure) is not named, as for the other bridges.
 */
export const MODULE_CALL_REFUSAL_CODES: readonly string[] = Object.freeze(['NOT_ALLOWED', 'BAD_ARGUMENT', 'UNKNOWN_MODULE', 'NOT_APPROVED', 'PLACE_CHANGED', 'BAD_PATH', 'OUTSIDE_PLACE', 'NOT_A_FILE', 'TOO_LARGE', 'NOT_TEXT', 'UNREADABLE', 'RECORD_DAMAGED', 'RECORD_BLOCKED']);

/** Every code the engine side returns that the contract names. */
export function engineRefusalCodes(): ReadonlySet<string> {
  return new Set([...ENGINE_CALL_REFUSAL_CODES, ...NAMED_OUTCOMES, ...ENGINE_MAIN_REFUSAL_CODES, ...ENGINE_MAIN_ANSWER_REFUSAL_CODES]);
}

/** Every code the reader side returns that the contract names. */
export function readerRefusalCodes(): ReadonlySet<string> {
  return new Set([...READER_GATE_REFUSAL_CODES, ...READER_REFUSAL_CODES]);
}
