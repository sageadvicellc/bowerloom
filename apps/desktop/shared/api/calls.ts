/**
 * The calls the page makes, in one place: the 3 calls of the read-only reader (shared/real/types.ts) and the 39 calls of the adopt, install and save sheets
 * (shared/engine/types.ts). Both lists stay where they are. This file joins them and adds nothing to them, so the preload, main and the page read one list.
 * The refusal codes of each side and the one function that maps an error to its short code are here too. No Electron and no Node module is imported.
 */
import { REAL_CALLS, REAL_CHANNELS } from '../real/types.js';
import type { RealBridge } from '../real/types.js';
import { ENGINE_CALLS, ENGINE_CALL_REFUSALS, ENGINE_CHANNELS } from '../engine/types.js';
import type { EngineBridge, EngineCall } from '../engine/types.js';
import { LOCAL_REFUSALS } from './local.js';
import { MODULE_REFUSALS } from './modules.js';
import { RUN_REFUSALS } from './runs.js';

/** The names of the reader calls. */
export type ReaderCall = (typeof REAL_CALLS)[number];
/** Every call the page makes: the reader calls first, then the engine calls. */
export const API_CALLS = Object.freeze([...REAL_CALLS, ...ENGINE_CALLS] as const);
export type ApiCall = ReaderCall | EngineCall;

/** The reader calls and the engine calls together. A window holds them as two objects, `bowerloomReal` and `bowerloomEngine`. */
export type EngineApi = RealBridge & EngineBridge;

/** One channel for each call, taken from the two existing tables. */
export const API_CHANNELS: Readonly<Record<ApiCall, string>> = Object.freeze({ ...REAL_CHANNELS, ...ENGINE_CHANNELS });

/** The short codes a reader call can be refused with. Main throws the first six. FAILED is what the page gets for anything else. */
export const READER_REFUSALS = Object.freeze(['NOT_ALLOWED', 'BAD_ARGUMENT', 'UNKNOWN_PLACE', 'TOO_MANY', 'BUSY', 'NO_HOME', 'FAILED'] as const);
/** The short codes an engine call can be refused with: the table shared/engine/types.ts already holds. */
export const ENGINE_REFUSALS: readonly string[] = ENGINE_CALL_REFUSALS;

export type ApiSide = 'reader' | 'engine' | 'local' | 'runs' | 'modules';

const FALLBACK = 'FAILED';
/** The reader side also reads this one word. The page itself uses it for a window with no bridge. Main never throws it. */
const NO_BRIDGE = 'NO_BRIDGE';

/** A pattern for the codes of one side, without FAILED, so a message that holds FAILED and another code gives the other code. */
const patternOf = (codes: readonly string[]): RegExp => new RegExp(`\\b(${codes.filter(code => code !== FALLBACK).join('|')})\\b`);
const PATTERNS: Readonly<Record<ApiSide, RegExp>> = Object.freeze({
  reader: patternOf([...READER_REFUSALS, NO_BRIDGE]),
  engine: patternOf(ENGINE_REFUSALS),
  local: patternOf(LOCAL_REFUSALS),
  runs: patternOf(RUN_REFUSALS),
  modules: patternOf(MODULE_REFUSALS),
});

/** The short code in an error from a call ('BUSY', 'UNKNOWN_FOLDER', ...) for the given side, or 'FAILED'. */
export function refusalCode(error: unknown, side: ApiSide): string {
  const found = String(error instanceof Error ? error.message : error).match(PATTERNS[side]);
  return found === null ? FALLBACK : found[1]!;
}
