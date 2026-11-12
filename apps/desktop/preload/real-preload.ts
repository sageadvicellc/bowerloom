/**
 * The bridge of the real-setup reader: three named calls, the calls of the adopt and install sheets (shared/engine/types.ts), the two read-only calls of the local models report and the extension list (shared/api/local.ts), the five calls of the run record (shared/api/runs.ts), and the four calls of the read scope of a module (shared/api/modules.ts), which the main
 * process answers only for the harness-first window on the person's own folders (the default launch). It is the only preload the real mode loads (the normal bridge is not loaded in the
 * preview). It exposes all five objects or none: main loads this file only for the plan whose `preload` is 'real', and for that plan it registers the reader, the engine calls, the local calls, the runs calls and the modules calls together
 * (main/launch.ts; tests/launch.test.ts holds that every plan has them all on or all off), so a window never holds a call that main does not answer. Each call sends one message on its own channel. The page gets no Node, no path, no generic send, and no way to listen.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { REAL_CHANNELS } from '../shared/real/types.js';
import type { RealBridge } from '../shared/real/types.js';
import { ENGINE_CALLS, ENGINE_CHANNELS } from '../shared/engine/types.js';
import type { EngineBridge } from '../shared/engine/types.js';
import { LOCAL_CALLS, LOCAL_CHANNELS } from '../shared/api/local.js';
import type { LocalBridge } from '../shared/api/local.js';
import { RUN_ARITY, RUN_CALLS, RUN_CHANNELS } from '../shared/api/runs.js';
import type { RunsBridge } from '../shared/api/runs.js';
import { MODULE_ARITY, MODULE_CALLS, MODULE_CHANNELS } from '../shared/api/modules.js';
import type { ModulesBridge } from '../shared/api/modules.js';

/** Electron wraps a refusal in a long sentence; the page gets only the short code in it. */
const refusal = (error: unknown): Error => {
  const found = String(error instanceof Error ? error.message : error).match(/\b(NOT_ALLOWED|BAD_ARGUMENT|UNKNOWN_PLACE|TOO_MANY|BUSY|NO_HOME)\b/);
  return new Error(found === null ? 'FAILED' : found[1]);
};

const api: RealBridge = {
  discoverPlaces: () => ipcRenderer.invoke(REAL_CHANNELS.discoverPlaces).catch((error: unknown) => { throw refusal(error); }),
  pickFolder: () => ipcRenderer.invoke(REAL_CHANNELS.pickFolder).catch((error: unknown) => { throw refusal(error); }),
  readSelected: placeIds => ipcRenderer.invoke(REAL_CHANNELS.readSelected, Array.isArray(placeIds) ? placeIds.filter((id): id is string => typeof id === 'string') : []).catch((error: unknown) => { throw refusal(error); }),
};

contextBridge.exposeInMainWorld('bowerloomReal', Object.freeze(api));

/** The engine calls refuse with one short code, never Electron's long sentence. */
const engineRefusal = (error: unknown): Error => {
  const found = String(error instanceof Error ? error.message : error).match(/\b(NOT_ALLOWED|BAD_ARGUMENT|UNKNOWN_FOLDER|UNKNOWN_BUNDLE)\b/);
  return new Error(found === null ? 'FAILED' : found[1]);
};
const engine: Record<string, unknown> = { mode: 'real' };
for (const call of ENGINE_CALLS) engine[call] = (...args: unknown[]) => ipcRenderer.invoke(ENGINE_CHANNELS[call], ...args).catch((error: unknown) => { throw engineRefusal(error); });
contextBridge.exposeInMainWorld('bowerloomEngine', Object.freeze(engine as unknown as EngineBridge));

/** The local calls take no argument and refuse with one short code, never Electron's long sentence. The page's arguments are dropped here: main refuses a call that carries one. */
const localRefusal = (error: unknown): Error => {
  const found = String(error instanceof Error ? error.message : error).match(/\b(NOT_ALLOWED|BAD_ARGUMENT|HOST_NOT_STARTED)\b/);
  return new Error(found === null ? 'FAILED' : found[1]);
};
const local: Record<string, unknown> = {};
for (const call of LOCAL_CALLS) local[call] = () => ipcRenderer.invoke(LOCAL_CHANNELS[call]).catch((error: unknown) => { throw localRefusal(error); });
contextBridge.exposeInMainWorld('bowerloomLocal', Object.freeze(local as unknown as LocalBridge));

/** The runs calls send exactly as many arguments as the call takes, so the page cannot pass main more than main expects. They refuse with one short code, never Electron's long sentence. */
const runsRefusal = (error: unknown): Error => {
  const found = String(error instanceof Error ? error.message : error).match(/\b(NOT_ALLOWED|BAD_ARGUMENT|UNKNOWN_FOLDER|UNKNOWN_RUN|RUN_LIMIT|STORE_DAMAGED|TOO_LONG|FOLDER_CHARACTER|FOLDER_LINK)\b/);
  return new Error(found === null ? 'FAILED' : found[1]);
};
const runs: Record<string, unknown> = {};
for (const call of RUN_CALLS) runs[call] = (...args: unknown[]) => ipcRenderer.invoke(RUN_CHANNELS[call], ...args.slice(0, RUN_ARITY[call])).catch((error: unknown) => { throw runsRefusal(error); });
contextBridge.exposeInMainWorld('bowerloomRuns', Object.freeze(runs as unknown as RunsBridge));

/** The modules calls send exactly as many arguments as the call takes. They refuse with one short code, never Electron's long sentence. The page gives no path to approve: main opens its own chooser. */
const modulesRefusal = (error: unknown): Error => {
  const found = String(error instanceof Error ? error.message : error).match(/\b(NOT_ALLOWED|BAD_ARGUMENT|UNKNOWN_MODULE|NOT_APPROVED|PLACE_CHANGED|BAD_PATH|OUTSIDE_PLACE|NOT_A_FILE|TOO_LARGE|NOT_TEXT|UNREADABLE|HOME_UNREADABLE|RECORD_DAMAGED|RECORD_BLOCKED)\b/);
  return new Error(found === null ? 'FAILED' : found[1]);
};
const modules: Record<string, unknown> = {};
for (const call of MODULE_CALLS) modules[call] = (...args: unknown[]) => ipcRenderer.invoke(MODULE_CHANNELS[call], ...args.slice(0, MODULE_ARITY[call])).catch((error: unknown) => { throw modulesRefusal(error); });
contextBridge.exposeInMainWorld('bowerloomModules', Object.freeze(modules as unknown as ModulesBridge));
