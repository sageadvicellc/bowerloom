/**
 * The calls of the adopt, install and save sheets, answered in the main process (shared/engine/types.ts names them, the save step's five calls among
 * them). Registered for --prototype-v3-real only. Each call:
 *  - is answered only for the app's own page, in its main frame, before anything else happens;
 *  - takes exactly the number of arguments its name says;
 *  - hands back plain data from main/engine-service.ts, or one short code (NOT_ALLOWED, BAD_ARGUMENT, UNKNOWN_FOLDER, FAILED).
 * A refusal of a package is not an error here: it comes back as `{ ok: false, refusal }` with its words, so the window can show it.
 */
import { ENGINE_ARITY, ENGINE_CALLS, ENGINE_CHANNELS } from '../shared/engine/types.js';
import { EngineCallRefusal, createEngineService } from './engine-service.js';
import type { EngineService, EngineServiceDeps } from './engine-service.js';
import type { RealIpc } from './real-ipc.js';
import { isAllowedRealSender } from './security.js';

export interface EngineIpcDeps extends EngineServiceDeps {
  readonly ipc: RealIpc;
  readonly appIndexUrl: string;
}

export function registerEngineIpc(deps: EngineIpcDeps): EngineService {
  const service = createEngineService(deps);
  for (const call of ENGINE_CALLS) {
    deps.ipc.handle(ENGINE_CHANNELS[call], async (event, ...args) => {
      const frame = event.senderFrame;
      if (frame === null || frame.parent !== null || !isAllowedRealSender(true, frame.url, deps.appIndexUrl)) throw new Error('NOT_ALLOWED');
      if (args.length !== ENGINE_ARITY[call]) throw new Error('BAD_ARGUMENT');
      try {
        return await (service[call] as (...a: unknown[]) => Promise<unknown>)(...args);
      } catch (error) {
        throw new Error(error instanceof EngineCallRefusal ? error.code : 'FAILED');
      }
    });
  }
  return service;
}
