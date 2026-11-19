/**
 * The seal of the call layer: which transport is installed and whether the page has read a call yet. Only renderer/api/transport.ts changes it. The test helper
 * tests/helpers-engine/transport-reset.ts is the only other writer. It holds no window global and imports nothing.
 */
import type { CallTransport } from './call-layer.js';

export interface CallTransportState {
  /** The installed transport (a frozen copy), or null while the Electron implementation is in use. */
  active: CallTransport | null;
  /** True once the page has read bridges or the sample switch. An install after that throws. */
  used: boolean;
}

export const callTransportState: CallTransportState = { active: null, used: false };
