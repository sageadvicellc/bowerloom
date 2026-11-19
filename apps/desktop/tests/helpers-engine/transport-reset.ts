// Test only. The production transport (renderer/api/transport.ts) seals on its first install or first read and exports no way back. A test puts the state back here.
import { callTransportState } from '../../renderer/api/transport-state.js';

/** Forgets any installed transport and the first read, so the next test starts with the Electron implementation unsealed. */
export const resetCallTransport = (): void => {
  callTransportState.active = null;
  callTransportState.used = false;
};
