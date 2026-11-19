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
import { activeTransportId, pageTransport, samplePreviewEngines } from './transport.js';
import type { RawBridges } from './transport.js';

/** Every call the page can make, by side: the 3 reader calls, the 39 engine calls, and the local, runs and modules calls. Any shell gives each side whole or not at all. */
export interface CallLayer {
  /** The three calls of the read-only reader. */
  readonly reader: RealBridge;
  /** The calls of the adopt, install and save sheets, in mode 'real'. */
  readonly engine: EngineBridge;
  /** The two read-only calls of the local models report and the extension list. */
  readonly local: LocalBridge;
  /** The five calls of the run record and the figures of a session log. */
  readonly runs: RunsBridge;
  /** The calls of the read scope of a module (the places approved for it). */
  readonly modules: ModulesBridge;
}

/** What the page gets: each side of the call layer, or null when this window has none, a partial set, or (for the engine) a mode other than 'real'. */
export type ApiClient = { readonly [Side in keyof CallLayer]: CallLayer[Side] | null };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const hasAll = (found: Record<string, unknown>, calls: readonly string[]): boolean => calls.every(call => typeof found[call] === 'function');

/** The one place the client writes to the console. */
const tell = (message: string): void => { console.error(message); };

/** The calls a found side lacks (every call when it is not an object), plus `mode` for an engine side that is not in mode 'real'. Empty when the side is whole. */
const missingOf = (found: unknown, calls: readonly string[], needsRealMode: boolean): string[] => {
  if (!isObject(found)) return [...calls];
  const missing = calls.filter(call => typeof found[call] !== 'function');
  return needsRealMode && found.mode !== 'real' ? ['mode', ...missing] : missing;
};

/**
 * Checks what a transport found and gives the client. A side that is missing altogether (undefined) is normal in the sample launch and in a window with no bridge, and is quiet.
 * A side that is present and not whole is null, and the console names the transport, the side and what it lacked, so a shell that gives a partial set is not mistaken for no shell.
 */
export function createApiClient(raw: RawBridges, transportId = 'unknown'): ApiClient {
  const side = <T>(name: keyof CallLayer, found: unknown, calls: readonly string[], needsRealMode = false): T | null => {
    const missing = missingOf(found, calls, needsRealMode);
    if (missing.length === 0) return found as T;
    if (found !== undefined) tell(`Bowerloom: the ${transportId} shell gave no whole ${name} bridge; it lacks ${missing.join(', ')} (BRIDGE_PARTIAL).`);
    return null;
  };
  return {
    reader: side<RealBridge>('reader', raw.reader, REAL_CALLS),
    engine: side<EngineBridge>('engine', raw.engine, ENGINE_CALLS, true),
    local: side<LocalBridge>('local', raw.local, LOCAL_CALLS),
    runs: side<RunsBridge>('runs', raw.runs, RUN_CALLS),
    modules: side<ModulesBridge>('modules', raw.modules, MODULE_CALLS),
  };
}

/** The client of this window. */
export function getApiClient(): ApiClient {
  return createApiClient(pageTransport(), activeTransportId());
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
  if (!realMode) return null;
  const modules = getApiClient().modules;
  // In the app on the person's own folders the preload always gives the whole bridge. A missing or partial one is a fault, told in the console here and on the Modules screen (BRIDGE_MISSING).
  if (modules === null) tell('Bowerloom: the window gave no whole modules bridge (BRIDGE_MISSING).');
  return modules;
}
