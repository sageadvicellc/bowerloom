/**
 * The Electron implementation of the call layer (renderer/api/call-layer.ts): the one file that reads `bowerloomReal`, `bowerloomEngine`, `bowerloomLocal`, `bowerloomRuns` and `bowerloomModules` from the window by name. The real-mode preload puts them there and nowhere else.
 * In the sample launch and in any other window they are missing. This file only hands back what it finds, unchecked. renderer/api/client.ts checks it.
 * It also reads the one attribute main puts on the body of the sample launch (shared/engine/sample-switch.ts), because it is the one file that reads the page.
 * Another shell installs its own `CallTransport` with `useCallTransport`, once, from its own start-up code, before the page first asks for a call. A second install, or an install
 * after the first read, throws. The stored transport is a frozen copy. No renderer file calls `useCallTransport` today.
 */
import { SAMPLE_PREVIEW_ATTRIBUTE } from '../../shared/engine/sample-switch.js';
import type { CallTransport, RawBridges } from './call-layer.js';
import { callTransportState } from './transport-state.js';

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
  samplePreviewEngines: (): boolean => typeof document !== 'undefined' && document.body?.getAttribute(SAMPLE_PREVIEW_ATTRIBUTE) === '1',
});

/** Installs another shell's implementation. It throws when one is installed already, and when the page has already read a call. */
export function useCallTransport(transport: CallTransport): void {
  if (callTransportState.active !== null) throw new Error('CALL_TRANSPORT_ALREADY_INSTALLED');
  if (callTransportState.used) throw new Error('CALL_TRANSPORT_IN_USE');
  // The functions are taken now, so a later change to the object that was handed in changes nothing.
  callTransportState.active = Object.freeze({ id: String(transport.id), bridges: transport.bridges.bind(transport), samplePreviewEngines: transport.samplePreviewEngines.bind(transport) });
}

/** The transport in use. Reading it seals the choice. */
const current = (): CallTransport => {
  callTransportState.used = true;
  return callTransportState.active ?? electronTransport;
};

/** The bridges of this window, or undefined for each one that is missing. */
export function pageTransport(): RawBridges {
  return current().bridges();
}

/** The short name of the transport in use, for a message. It does not seal the choice. */
export const activeTransportId = (): string => (callTransportState.active ?? electronTransport).id;

/** Whether main marked this page as the sample launch with the preview engines locked. Read once, to make the sample engine. */
export const samplePreviewEngines = (): boolean => current().samplePreviewEngines();
