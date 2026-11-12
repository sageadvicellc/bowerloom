/**
 * The four calls of the `bowerloomModules` bridge, answered in the main process (shared/api/modules.ts names them). Registered for the default launch only.
 * Each call:
 *  - is answered only for the app's own page, in its main frame, before anything else happens;
 *  - takes exactly its number of arguments, and each argument is checked for its shape (shared/api/modules-shape.ts) before main acts on it;
 *  - names a module that main holds as a stock extension now (UNKNOWN_MODULE otherwise), and never a protected default;
 *  - hands back plain data, or one short code. A failure is logged here by call name and error class, never by its message.
 * The decision whether a module may read a place is made by packages/module-scope and by nothing here: `readModuleFile` is the package's `readPlaceFile`. `approveModulePlace` opens main's own chooser
 * (main/module-pick.ts), so the page never names a folder. The page never holds a full path: a place is an id and a label written with `~`. Nothing here starts a program or reads the network.
 */
import { listPlaces, readPlaceFile, revokePlace } from '../../../packages/module-scope/src/index.js';
import { MODULE_ARITY, MODULE_CALLS, MODULE_CHANNELS } from '../shared/api/modules.js';
import type { ModuleApproval, ModuleCall, ModuleFile, ModulePlaces } from '../shared/api/modules.js';
import { isModuleId, isPathText, isPlaceId } from '../shared/api/modules-shape.js';
import type { ExtensionHost } from './extension-host.js';
import { pickModulePlace } from './module-pick.js';
import type { RealIpc } from './real-ipc.js';
import { isAllowedRealSender } from './security.js';

export interface ModulesIpcDeps {
  readonly ipc: RealIpc;
  readonly appIndexUrl: string;
  readonly home: string;
  /** The state folder that holds `module-scope/approved.json`. */
  readonly stateRoot: string;
  /** The extension host main started, or null while it has not. A module is a stock extension that is not protected. */
  readonly extensionHost: () => ExtensionHost | null;
  /** Main's own chooser for a place in the home folder: the folder the person picked, or null. */
  readonly choosePlace: () => Promise<string | null>;
  /** Where a failure is logged. Main passes its stderr line writer. The default writes to stderr. */
  readonly tell?: (line: string) => void;
}

/** The class of a failure as a short word, for the log. Never the message, which can hold a path. */
const causeClass = (error: unknown): string => {
  if (!(error instanceof Error)) return 'NotAnError';
  return /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(error.name) ? error.name : 'Error';
};

/** A refusal with a code the page may see. Anything else thrown by an answer is FAILED. */
class Refusal extends Error {}

export function registerModulesIpc(deps: ModulesIpcDeps): void {
  const tell = deps.tell ?? ((line: string): void => { try { process.stderr.write(`${line}\n`); } catch { /* a closed stderr never stops a call */ } });
  const refuse = (code: string): never => { throw new Refusal(code); };
  /** The module id, when it is well formed and main holds a stock extension with that id. */
  const moduleOf = (id: unknown): string => {
    if (!isModuleId(id)) return refuse('BAD_ARGUMENT');
    const host = deps.extensionHost();
    return host !== null && host.registry.list().some(m => m.id === id && !m.protected) ? id : refuse('UNKNOWN_MODULE');
  };
  const placesOf = (moduleId: string): ModulePlaces => {
    const found = listPlaces({ stateRoot: deps.stateRoot, home: deps.home, moduleId });
    if (found.status === 'damaged') return refuse('RECORD_DAMAGED');
    if (found.status === 'blocked') return refuse('RECORD_BLOCKED');
    return { places: found.places.map(p => ({ id: p.id, label: p.label, approvedAt: p.approvedAt })) };
  };

  const answers: Readonly<Record<ModuleCall, (...args: unknown[]) => Promise<unknown>>> = {
    listModulePlaces: async id => placesOf(moduleOf(id)),
    approveModulePlace: async (id): Promise<ModuleApproval> => pickModulePlace({ moduleId: moduleOf(id), show: deps.choosePlace, stateRoot: deps.stateRoot, home: deps.home, tell }),
    revokeModulePlace: async (id, placeId) => {
      const moduleId = moduleOf(id);
      if (!isPlaceId(placeId)) return refuse('BAD_ARGUMENT');
      const done = revokePlace({ stateRoot: deps.stateRoot, moduleId, placeId });
      if (done.status === 'damaged') return refuse('RECORD_DAMAGED');
      if (done.status === 'blocked') return refuse('RECORD_BLOCKED');
      if (done.status === 'unknown') return refuse('NOT_APPROVED');
      if (done.status === 'failed') return refuse('FAILED');
      return placesOf(moduleId);
    },
    readModuleFile: async (id, placeId, path): Promise<ModuleFile> => {
      const moduleId = moduleOf(id);
      if (!isPlaceId(placeId) || !isPathText(path)) return refuse('BAD_ARGUMENT');
      const read = readPlaceFile({ stateRoot: deps.stateRoot, home: deps.home, moduleId, placeId, path });
      return read.ok ? { text: read.text } : refuse(read.code);
    },
  };

  for (const call of MODULE_CALLS) {
    deps.ipc.handle(MODULE_CHANNELS[call], async (event, ...args) => {
      const frame = event.senderFrame;
      if (frame === null || frame.parent !== null || !isAllowedRealSender(true, frame.url, deps.appIndexUrl)) throw new Error('NOT_ALLOWED');
      if (args.length !== MODULE_ARITY[call]) throw new Error('BAD_ARGUMENT');
      try {
        return await answers[call](...args);
      } catch (error) {
        if (error instanceof Refusal) throw new Error(error.message);
        try { tell(`Bowerloom: the modules call ${call} failed (${causeClass(error)}).`); } catch { /* the log never changes the answer */ }
        throw new Error('FAILED');
      }
    });
  }
}
