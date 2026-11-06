/**
 * The calls of the adopt, install and save sheets, answered in the main process (shared/engine/types.ts names them, the save step's five calls among
 * them). Registered for the default launch only. Each call:
 *  - is answered only for the app's own page, in its main frame, before anything else happens;
 *  - takes exactly the number of arguments its name says;
 *  - hands back plain data from main/engine-service.ts, or one short code (NOT_ALLOWED, BAD_ARGUMENT, UNKNOWN_FOLDER, FAILED).
 * A refusal of a package is not an error here: it comes back as `{ ok: false, refusal }` with its words, so the window can show it.
 */
import { ENGINE_ARITY, ENGINE_CALLS, ENGINE_CHANNELS } from '../shared/engine/types.js';
import type { EngineCall } from '../shared/engine/types.js';
import type { SavedScanAnswer, SavedScanCheck } from '../shared/real/saved-scan.js';
import { EngineCallRefusal, createEngineService } from './engine-service.js';
import type { EngineService, EngineServiceDeps } from './engine-service.js';
import type { RealIpc } from './real-ipc.js';
import { isAllowedRealSender } from './security.js';

/** The kept read of the last look at the folders (main/scan-session.ts). The two calls read the kept file, and the second one lists the watched folders; neither opens a file of them. */
export interface SavedScanTools {
  savedScan(): Promise<SavedScanAnswer>;
  checkSavedScan(): Promise<SavedScanCheck>;
}

export interface EngineIpcDeps extends EngineServiceDeps {
  readonly ipc: RealIpc;
  readonly appIndexUrl: string;
  /** Answers `savedScan` and `checkSavedScan`. Left out: no read is kept, so a launch has nothing to show. */
  readonly saved?: SavedScanTools;
}

/** What a launch gets when no read is kept. */
const NOTHING_KEPT: SavedScanTools = { savedScan: async () => ({ status: 'none' }), checkSavedScan: async () => 'changed' };

export function registerEngineIpc(deps: EngineIpcDeps): EngineService {
  const service = createEngineService(deps), saved = deps.saved ?? NOTHING_KEPT;
  // Two calls are answered by the kept read; every other call is the service's own.
  const answerer = (call: EngineCall): ((...a: unknown[]) => Promise<unknown>) => (call === 'savedScan' ? saved.savedScan : call === 'checkSavedScan' ? saved.checkSavedScan : (service[call] as (...a: unknown[]) => Promise<unknown>));
  for (const call of ENGINE_CALLS) {
    deps.ipc.handle(ENGINE_CHANNELS[call], async (event, ...args) => {
      const frame = event.senderFrame;
      if (frame === null || frame.parent !== null || !isAllowedRealSender(true, frame.url, deps.appIndexUrl)) throw new Error('NOT_ALLOWED');
      // One call takes one optional argument (additive): chooseFolder may name the label of the folder the window wants.
      if (args.length !== ENGINE_ARITY[call] && !(call === 'chooseFolder' && args.length === 1)) throw new Error('BAD_ARGUMENT');
      try {
        return await answerer(call)(...args);
      } catch (error) {
        throw new Error(error instanceof EngineCallRefusal ? error.code : 'FAILED');
      }
    });
  }
  return service;
}
