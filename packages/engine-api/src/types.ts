/**
 * The shapes the engine API shares with its callers. They are restated here on purpose: this package imports nothing from apps/desktop, so the app and a future
 * library can both depend on it. A test in apps/desktop (engine-api-contract.test.ts and the shape suite) keeps these shapes true to the app's own types.
 */

/** A refusal as plain words. `paths` are relative to the project or written with `~`. */
export interface Refusal {
  readonly code: string;
  readonly message: string;
  readonly paths: readonly string[];
  /** For a refusal because files Bowerloom wrote changed since: each one, with why. The line shape is the app's own and is not restated here. */
  readonly drift?: readonly unknown[];
  /** For a step that stopped part way, or a helper that stopped: the cause (see `ENGINE_REFUSAL_STEPS`) or the code of the refusal that stopped it. */
  readonly step?: string;
}

/** Every call that can refuse answers this way, so a refusal reaches the window with its words and is never lost in an error. */
export type Answer<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: Refusal };

/**
 * What a call returns:
 *  - `answer`: an `Answer`.
 *  - `answer-or-null`: an `Answer`, or null when the person closed a chooser.
 *  - `list`: a plain list (the folders).
 *  - `boolean`: true or false.
 *  - `saved-scan`: an object with a `status` word (the kept read of the last look).
 *  - `saved-scan-check`: one word (whether the kept read changed).
 *  - `plain`: plain data that is not an `Answer`. The reader's calls return this, and refuse by throwing an error whose message is the code.
 */
export type ReturnKind = 'answer' | 'answer-or-null' | 'list' | 'boolean' | 'saved-scan' | 'saved-scan-check' | 'plain';

/**
 * One call of the contract. `arity` is the number of arguments the call takes. `optionalArgs` is how many more it accepts without refusing (only chooseFolder takes one).
 * `channel` is the name of the wire channel that carries the call.
 */
export interface CallSpec {
  readonly name: string;
  readonly arity: number;
  readonly optionalArgs: number;
  readonly channel: string;
  readonly returns: ReturnKind;
}
