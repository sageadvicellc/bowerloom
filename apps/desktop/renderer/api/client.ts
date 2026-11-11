/**
 * The client of the page: the reader calls and the engine calls, each side given only when it is whole. The reader side needs its three functions. The engine side needs mode 'real' and
 * a function for each of the 39 engine calls. A missing or partial side is null, and the page then says so in plain words (renderer/harness/real/Nothing.tsx).
 * Nothing here reads the window: renderer/api/transport.ts does.
 */
import { refusalCode } from '../../shared/api/calls.js';
import { REAL_CALLS } from '../../shared/real/types.js';
import type { RealBridge } from '../../shared/real/types.js';
import { ENGINE_CALLS } from '../../shared/engine/types.js';
import type { EngineBridge } from '../../shared/engine/types.js';
import { createSampleEngine } from '../../shared/engine/sample.js';
import { pageTransport, samplePreviewEngines } from './transport.js';
import type { RawBridges } from './transport.js';

export interface ApiClient {
  /** The three calls of the read-only reader, or null when this window has none or a partial set. */
  readonly reader: RealBridge | null;
  /** The calls of the adopt, install and save sheets, or null when this window has none, a partial set, or a mode other than 'real'. */
  readonly engine: EngineBridge | null;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const hasAll = (found: Record<string, unknown>, calls: readonly string[]): boolean => calls.every(call => typeof found[call] === 'function');

/** Checks what a transport found and gives the client. */
export function createApiClient(raw: RawBridges): ApiClient {
  const reader = isObject(raw.reader) && hasAll(raw.reader, REAL_CALLS) ? (raw.reader as unknown as RealBridge) : null;
  const engine = isObject(raw.engine) && raw.engine.mode === 'real' && hasAll(raw.engine, ENGINE_CALLS) ? (raw.engine as unknown as EngineBridge) : null;
  return { reader, engine };
}

/** The client of this window. */
export function getApiClient(): ApiClient {
  return createApiClient(pageTransport());
}

/**
 * The engine of a page that was handed none: the in-memory sample for the sample launch, and none for the launch on the person's own folders, where the sheets then say so
 * and never fall back to the sample. The page reaches the sample engine here and nowhere else.
 */
export function fallbackEngine(realMode: boolean): EngineBridge | null {
  return realMode ? null : createSampleEngine({ previewEngines: samplePreviewEngines() });
}

/** The short code in an error from a reader call ('NOT_ALLOWED', 'UNKNOWN_PLACE', ...), or 'FAILED'. */
export const readerCodeOf = (error: unknown): string => refusalCode(error, 'reader');
/** The short code in an error from an engine call ('BAD_ARGUMENT', 'UNKNOWN_FOLDER', ...), or 'FAILED'. */
export const engineCodeOf = (error: unknown): string => refusalCode(error, 'engine');
