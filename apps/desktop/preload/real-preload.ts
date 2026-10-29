/**
 * The bridge of the real-setup reader: three named calls, and the fourteen calls of the adopt and install sheets (shared/engine/types.ts), which the main
 * process answers only for the harness-first window on the person's own folders (--prototype-v3-real). It is the only preload the real mode loads (the normal bridge is not loaded in the
 * preview). Each call sends one message on its own channel. The page gets no Node, no path, no generic send, and no way to listen.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { REAL_CHANNELS } from '../shared/real/types.js';
import type { RealBridge } from '../shared/real/types.js';
import { ENGINE_CALLS, ENGINE_CHANNELS } from '../shared/engine/types.js';
import type { EngineBridge } from '../shared/engine/types.js';

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
  const found = String(error instanceof Error ? error.message : error).match(/\b(NOT_ALLOWED|BAD_ARGUMENT|UNKNOWN_FOLDER)\b/);
  return new Error(found === null ? 'FAILED' : found[1]);
};
const engine: Record<string, unknown> = { mode: 'real' };
for (const call of ENGINE_CALLS) engine[call] = (...args: unknown[]) => ipcRenderer.invoke(ENGINE_CHANNELS[call], ...args).catch((error: unknown) => { throw engineRefusal(error); });
contextBridge.exposeInMainWorld('bowerloomEngine', Object.freeze(engine as unknown as EngineBridge));
