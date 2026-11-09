/**
 * The refusal codes of the engine API, by the side that returns them. Taken from the base release:
 *  - the engine's call refusals: ENGINE_CALL_REFUSALS in apps/desktop/shared/engine/types.ts. A call is refused with one of these before it runs, as a thrown error whose
 *    message is the code.
 *  - the two named outcomes of main itself: NOT_THE_PLAN_SHOWN (a write is not the plan main showed last) and CANCELLED (the person said no in main's own dialog). Each comes
 *    back as an `Answer` refusal with words.
 *  - the refusals of main with words, defined in the same file (the `*_MAIN_WORDS` tables).
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

/** The codes the reader's handler refuses with before a read: the wrong page, the wrong argument count, or an unexpected failure. */
export const READER_GATE_REFUSAL_CODES: readonly string[] = Object.freeze(['NOT_ALLOWED', 'BAD_ARGUMENT', 'FAILED']);

/** The codes the reader itself refuses with (`RealRefusal`). */
export const READER_REFUSAL_CODES: readonly string[] = Object.freeze(['BAD_ARGUMENT', 'UNKNOWN_PLACE', 'TOO_MANY', 'BUSY', 'NO_HOME']);

/** Every code the engine side returns that the contract names. */
export function engineRefusalCodes(): ReadonlySet<string> {
  return new Set([...ENGINE_CALL_REFUSAL_CODES, ...NAMED_OUTCOMES, ...ENGINE_MAIN_REFUSAL_CODES]);
}

/** Every code the reader side returns that the contract names. */
export function readerRefusalCodes(): ReadonlySet<string> {
  return new Set([...READER_GATE_REFUSAL_CODES, ...READER_REFUSAL_CODES]);
}
