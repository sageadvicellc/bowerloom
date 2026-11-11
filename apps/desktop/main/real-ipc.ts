/**
 * The three calls of the real-setup reader, answered in the main process. This is the only place the page's calls arrive for real mode. Each call:
 *  - is answered only for the app's own page, in its main frame (`isAllowedRealSender`), before anything else happens;
 *  - takes no argument, or one list of place ids, which must be ids the scanner listed itself;
 *  - hands back plain data (see shared/real/types.ts): the only paths are the `details.path` of a place in step one, and the `foundAt.path` of each item and the
 *    `path` of each scope in step two, all written with `~` for the home folder and cleaned of control characters; never a file's text for a place that was not selected,
 *    and never a key value.
 * There is no write, no command, no network and no generic channel here. The handler takes its tools as arguments, so a test can run it with a fake and no Electron.
 */
import { REAL_CHANNELS } from '../shared/real/types.js';
import type { RealDiscovery, RealPicked, RealPlace, RealResult } from '../shared/real/types.js';
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
  /** The file of this machine's approvals of linked home folders; the reader only reads it. */
  readonly approvalsFile?: string;
  /** Opens the system folder chooser and answers the chosen folder, or null when the person closed it. */
  readonly chooseFolder: () => Promise<string | null>;
  readonly now?: () => number;
  /**
   * Wraps the read of question two. It gets the places the window was shown for the ids it asked for (in that order) and the read itself, and answers what the read answers. The
   * app uses it to keep the read (main/scan-session.ts). This file only calls it: it holds no way to write, and a read that the reader refuses never reaches it.
   */
  readonly keepRead?: (chosen: readonly RealPlace[], read: () => Promise<RealResult>) => Promise<RealResult>;
}

/** The home folder, if it is an absolute path to a folder that is there; else null. Real mode starts only with one. */
export function usableHome(home: unknown, isFolder: (path: string) => boolean): string | null {
  return typeof home === 'string' && home.startsWith('/') && !home.includes('\u0000') && home.length > 1 && isFolder(home) ? home : null;
}

const NOT_ALLOWED = 'NOT_ALLOWED';

export function registerRealIpc(deps: RealIpcDeps): Scanner {
  const now = deps.now ?? (() => Date.now());
  const scanner = createScanner({ home: deps.home, now, ...(deps.approvalsFile === undefined ? {} : { approvalsFile: deps.approvalsFile }) });
  const guarded = (channel: string, argCount: number, run: (args: unknown[]) => Promise<unknown>): void => {
    deps.ipc.handle(channel, async (event, ...args) => {
      const frame = event.senderFrame;
      if (frame === null || frame.parent !== null || !isAllowedRealSender(true, frame.url, deps.appIndexUrl)) throw new Error(NOT_ALLOWED);
      if (args.length !== argCount) throw new Error('BAD_ARGUMENT');
      try { return await run(args); } catch (error) { throw error instanceof RealRefusal ? new Error(error.code) : new Error('FAILED'); }
    });
  };
  // The places as the window was shown them, by id: the read of question two is kept with these (they are what the window holds), never with anything the window sends back.
  const shown = new Map<string, RealPlace>();
  const remember = <T extends RealDiscovery>(found: T): T => { for (const p of found.places) shown.set(p.id, p); return found; };
  guarded(REAL_CHANNELS.discoverPlaces, 0, async (): Promise<RealDiscovery> => remember(await scanner.discover()));
  guarded(REAL_CHANNELS.pickFolder, 0, async (): Promise<RealPicked> => {
    // The chooser window opens inside the scanner's one-call-at-a-time guard, so no other call can start while it is open.
    const found = await scanner.pick(deps.chooseFolder);
    if (found === null) return { cancelled: true, places: [], stoppedEarly: false, couldNotRead: 0, notes: [], readOnly: true };
    return { ...remember(found), cancelled: false };
  });
  guarded(REAL_CHANNELS.readSelected, 1, async ([ids]): Promise<RealResult> => {
    const read = async (): Promise<RealResult> => {
      const batch = await scanner.read(ids);
      return buildRealResult(batch.reads, batch.tally, { nowMs: now(), foldExtraApps: true });
    };
    // The reader checks the ids itself and refuses a bad list. Only a list of places the window was shown is handed to `keepRead`.
    const chosen = Array.isArray(ids) && ids.length > 0 && ids.every(id => typeof id === 'string' && shown.has(id)) ? [...new Set(ids as string[])].map(id => shown.get(id)!) : null;
    return deps.keepRead === undefined || chosen === null ? read() : deps.keepRead(chosen, read);
  });
  return scanner;
}
