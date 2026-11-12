/**
 * The client of the page: the reader calls, the engine calls, the two local calls, the five runs calls and the four modules calls, each side given only when it is whole. The reader side needs its three functions. The engine side needs mode 'real' and
 * a function for each of the 39 engine calls. A missing or partial side is null, and the page then says so in plain words (renderer/harness/real/Nothing.tsx).
 * Nothing here reads the window: renderer/api/transport.ts does.
 */
import { refusalCode } from '../../shared/api/calls.js';
import { REAL_CALLS } from '../../shared/real/types.js';
import type { RealBridge } from '../../shared/real/types.js';
import { ENGINE_CALLS } from '../../shared/engine/types.js';
import type { EngineBridge } from '../../shared/engine/types.js';
import { createSampleEngine } from '../../shared/engine/sample.js';
import { LOCAL_CALLS } from '../../shared/api/local.js';
import type { LocalBridge, LocalRefusalCode } from '../../shared/api/local.js';
import { RUN_CALLS } from '../../shared/api/runs.js';
import type { RunRefusalCode, RunsBridge } from '../../shared/api/runs.js';
import { MODULE_CALLS } from '../../shared/api/modules.js';
import type { ModuleRefusalCode, ModulesBridge } from '../../shared/api/modules.js';
import { createSampleLocal } from '../../shared/local-models/sample.js';
import { realNowIso } from '../harness/clock.js';
import { pageTransport, samplePreviewEngines } from './transport.js';
import type { RawBridges } from './transport.js';

export interface ApiClient {
  /** The three calls of the read-only reader, or null when this window has none or a partial set. */
  readonly reader: RealBridge | null;
  /** The calls of the adopt, install and save sheets, or null when this window has none, a partial set, or a mode other than 'real'. */
  readonly engine: EngineBridge | null;
  /** The two read-only calls of the local models report and the extension list, or null when this window has none or a partial set. */
  readonly local: LocalBridge | null;
  /** The five calls of the run record and the figures of a session log, or null when this window has none or a partial set. */
  readonly runs: RunsBridge | null;
  /** The four calls of the read scope of a module (the places approved for it), or null when this window has none or a partial set. */
  readonly modules: ModulesBridge | null;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const hasAll = (found: Record<string, unknown>, calls: readonly string[]): boolean => calls.every(call => typeof found[call] === 'function');

/** Checks what a transport found and gives the client. */
export function createApiClient(raw: RawBridges): ApiClient {
  const reader = isObject(raw.reader) && hasAll(raw.reader, REAL_CALLS) ? (raw.reader as unknown as RealBridge) : null;
  const engine = isObject(raw.engine) && raw.engine.mode === 'real' && hasAll(raw.engine, ENGINE_CALLS) ? (raw.engine as unknown as EngineBridge) : null;
  const local = isObject(raw.local) && hasAll(raw.local, LOCAL_CALLS) ? (raw.local as unknown as LocalBridge) : null;
  const runs = isObject(raw.runs) && hasAll(raw.runs, RUN_CALLS) ? (raw.runs as unknown as RunsBridge) : null;
  const modules = isObject(raw.modules) && hasAll(raw.modules, MODULE_CALLS) ? (raw.modules as unknown as ModulesBridge) : null;
  return { reader, engine, local, runs, modules };
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
/** The short code in an error from a local call ('NOT_ALLOWED', 'BAD_ARGUMENT', 'HOST_NOT_STARTED'), or 'FAILED'. HOST_NOT_STARTED passes through, so a screen can say the extension host has not started. */
export const localCodeOf = (error: unknown): LocalRefusalCode => refusalCode(error, 'local') as LocalRefusalCode;

/** The short code in an error from a runs call ('BAD_ARGUMENT', 'UNKNOWN_FOLDER', 'UNKNOWN_RUN', ...), or 'FAILED'. */
export const runsCodeOf = (error: unknown): RunRefusalCode => refusalCode(error, 'runs') as RunRefusalCode;

/**
 * The runs calls of a page that was handed none: the preload's bridge (or none) on the person's own folders, and none in the sample launch, where the sample screens keep their made-up runs in the store.
 */
export function fallbackRuns(realMode: boolean): RunsBridge | null {
  return realMode ? getApiClient().runs : null;
}

/**
 * The local calls of a page that was handed none: the in-memory sample for the sample launch, and the preload's bridge (or none) for the launch on the person's own folders.
 * The sample is never used for the real launch.
 */
export function fallbackLocal(realMode: boolean): LocalBridge | null {
  return realMode ? getApiClient().local : createSampleLocal(realNowIso);
}

/** The short code in an error from a modules call ('NOT_APPROVED', 'UNKNOWN_MODULE', 'BAD_PATH', ...), or 'FAILED'. */
export const modulesCodeOf = (error: unknown): ModuleRefusalCode => refusalCode(error, 'modules') as ModuleRefusalCode;

/** The modules calls of a page that was handed none: the preload's bridge (or none) on the person's own folders, and none in the sample launch, where there is no record to keep. */
export function fallbackModules(realMode: boolean): ModulesBridge | null {
  return realMode ? getApiClient().modules : null;
}
