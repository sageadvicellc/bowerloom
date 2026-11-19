/**
 * The Electron implementation of the call layer (renderer/api/call-layer.ts): the one file that reads `bowerloomReal`, `bowerloomEngine`, `bowerloomLocal`, `bowerloomRuns` and `bowerloomModules` from the window by name. The real-mode preload puts them there and nowhere else.
 * In the sample launch and in any other window they are missing. This file only hands back what it finds, unchecked. renderer/api/client.ts checks it.
 * It also reads the one attribute main puts on the body of the sample launch (shared/engine/sample-switch.ts), because it is the one file that reads the page.
 * Another shell installs its own `CallTransport` with `useCallTransport`. Nothing else in the page changes.
 */
import { SAMPLE_PREVIEW_ATTRIBUTE } from '../../shared/engine/sample-switch.js';
import type { CallTransport, RawBridges } from './call-layer.js';

export type { CallTransport, RawBridges } from './call-layer.js';

/** The bridges of this window, or undefined for each one that is missing. */
const windowBridges = (): RawBridges => {
  const found = typeof window === 'undefined' ? undefined : (window as unknown as { bowerloomReal?: unknown; bowerloomEngine?: unknown; bowerloomLocal?: unknown; bowerloomRuns?: unknown; bowerloomModules?: unknown });
  return { reader: found?.bowerloomReal, engine: found?.bowerloomEngine, local: found?.bowerloomLocal, runs: found?.bowerloomRuns, modules: found?.bowerloomModules };
};

/** The Electron implementation: the five frozen objects the preload exposes, handed over as they are. */
export const electronTransport: CallTransport = Object.freeze({
  id: 'electron',
  bridges: windowBridges,
  samplePreviewEngines: (): boolean => document.body.getAttribute(SAMPLE_PREVIEW_ATTRIBUTE) === '1',
});

let active: CallTransport = electronTransport;

/** Installs another shell's implementation. Call it once, before the page first asks for a call. */
export function useCallTransport(transport: CallTransport): void {
  active = transport;
}

/** Puts the Electron implementation back. */
export function resetCallTransport(): void {
  active = electronTransport;
}

/** The bridges of this window, or undefined for each one that is missing. */
export function pageTransport(): RawBridges {
  return active.bridges();
}

/** Whether main marked this page as the sample launch with the preview engines locked. Read once, to make the sample engine. */
export const samplePreviewEngines = (): boolean => active.samplePreviewEngines();
