/**
 * The engine API contract of Bowerloom 0.9, stage 1: the names, argument counts, return kinds and refusal codes of the 39 engine calls and the 3 reader calls, as the
 * 0.8 base has them. It holds data and two small functions. It imports nothing from apps/desktop, from Electron, or from a Node module that opens a port. The
 * engine library that serves these calls moves here in a later stage.
 *
 * `golden/base-d4c8a478.json` records the same facts as the base source gave them, and `scripts/make-golden.mjs` makes it. See docs/v0.9/engine-api-library.md.
 */
export type { Answer, CallSpec, Refusal, ReturnKind } from './types.js';
export { ENGINE_API_CALLS, LOCAL_CALLS, READER_API_CALLS, RUN_CALLS, callSpec, localCallSpec, runCallSpec } from './calls.js';
export {
  CANCELLED, ENGINE_CALL_REFUSAL_CODES, ENGINE_CODE_FORMAT, ENGINE_MAIN_ANSWER_REFUSAL_CODES, ENGINE_MAIN_REFUSAL_CODES, ENGINE_REFUSAL_STEPS, LOCAL_CALL_REFUSAL_CODES, NAMED_OUTCOMES, NOT_THE_PLAN_SHOWN, READER_GATE_REFUSAL_CODES, READER_REFUSAL_CODES, RUN_CALL_REFUSAL_CODES,
  engineRefusalCodes, readerRefusalCodes,
} from './refusals.js';
