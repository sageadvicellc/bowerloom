/**
 * The three calls of the real-setup reader, answered in the main process. This is the only place the page's calls arrive for real mode. Each call:
 *  - is answered only for the app's own page, in its main frame (`isAllowedRealSender`), before anything else happens;
 *  - takes no argument, or one list of place ids, which must be ids the scanner listed itself;
 *  - hands back plain data (see shared/real/types.ts), never a path outside the `details` field of a place, never a file's text for a place that was not selected, and
 *    never a key value.
 * There is no write, no command, no network and no generic channel here. The handler takes its tools as arguments, so a test can run it with a fake and no Electron.
 */
import { REAL_CHANNELS } from '../shared/real/types.js';
import type { RealDiscovery, RealPicked, RealResult } from '../shared/real/types.js';
import { buildRealResult } from '../shared/real/map-world.js';
import { RealRefusal, createScanner } from './real-scan.js';
import type { Scanner } from './real-scan.js';
import { isAllowedRealSender } from './security.js';

/** What the handler needs from the event: the frame that sent the call, and whether it is the top frame of its page. */
export interface RealEvent { readonly senderFrame: { readonly url: string; readonly parent: unknown } | null }

export interface RealIpc { handle(channel: string, listener: (event: RealEvent, ...args: unknown[]) => unknown): void }

export interface RealIpcDeps {
  readonly ipc: RealIpc;
  readonly appIndexUrl: string;
  readonly home: string;
  /** Opens the system folder chooser and answers the chosen folder, or null when the person closed it. */
  readonly chooseFolder: () => Promise<string | null>;
  readonly now?: () => number;
}

/** The home folder, if it is an absolute path to a folder that is there; else null. Real mode starts only with one. */
export function usableHome(home: unknown, isFolder: (path: string) => boolean): string | null {
  return typeof home === 'string' && home.startsWith('/') && !home.includes('\u0000') && home.length > 1 && isFolder(home) ? home : null;
}

const NOT_ALLOWED = 'NOT_ALLOWED';

export function registerRealIpc(deps: RealIpcDeps): Scanner {
  const now = deps.now ?? (() => Date.now());
  const scanner = createScanner({ home: deps.home, now });
  const guarded = (channel: string, argCount: number, run: (args: unknown[]) => Promise<unknown>): void => {
    deps.ipc.handle(channel, async (event, ...args) => {
      const frame = event.senderFrame;
      if (frame === null || frame.parent !== null || !isAllowedRealSender(true, frame.url, deps.appIndexUrl)) throw new Error(NOT_ALLOWED);
      if (args.length !== argCount) throw new Error('BAD_ARGUMENT');
      try { return await run(args); } catch (error) { throw error instanceof RealRefusal ? new Error(error.code) : new Error('FAILED'); }
    });
  };
  guarded(REAL_CHANNELS.discoverPlaces, 0, (): Promise<RealDiscovery> => scanner.discover());
  guarded(REAL_CHANNELS.pickFolder, 0, async (): Promise<RealPicked> => {
    const folder = await deps.chooseFolder();
    if (folder === null) return { cancelled: true, places: [], stoppedEarly: false, couldNotRead: 0, notes: [], readOnly: true };
    return { ...(await scanner.addFolder(folder)), cancelled: false };
  });
  guarded(REAL_CHANNELS.readSelected, 1, async ([ids]): Promise<RealResult> => {
    const batch = await scanner.read(ids);
    return buildRealResult(batch.reads, batch.tally, { nowMs: now() });
  });
  return scanner;
}
