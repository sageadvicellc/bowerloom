/**
 * The two read-only calls of the `bowerloomLocal` bridge, answered in the main process (shared/api/local.ts names them). Registered for the default launch only.
 * Each call:
 *  - is answered only for the app's own page, in its main frame, before anything else happens;
 *  - takes no argument;
 *  - hands back plain data, or one short code (NOT_ALLOWED, BAD_ARGUMENT, FAILED).
 * `localModels` is the report of packages/local-models. A server that is down is a state in the report, never a refusal. `listExtensions` says which bundled
 * extensions the extension host of main holds now and which folders it skipped (main/extension-host.ts). Neither call writes, starts a program, or reads a process.
 */
import { createLocalModels } from '../../../packages/local-models/src/index.js';
import type { LocalModels } from '../../../packages/local-models/src/index.js';
import { LOCAL_ARITY, LOCAL_CALLS, LOCAL_CHANNELS } from '../shared/api/local.js';
import type { ExtensionsListing, LocalCall } from '../shared/api/local.js';
import type { ExtensionHost } from './extension-host.js';
import type { RealIpc } from './real-ipc.js';
import { isAllowedRealSender } from './security.js';

export interface LocalModelsIpcDeps {
  readonly ipc: RealIpc;
  readonly appIndexUrl: string;
  /** The state folder that holds `local-models.json`. */
  readonly stateRoot: string;
  /** The extension host main started (main/extension-host.ts), or null while it has not. The answer follows its registry, not a second read of the bundle. */
  readonly extensionHost: () => ExtensionHost | null;
  /** Test use: another source of the report. Defaults to the package. */
  readonly models?: LocalModels;
}

/** The listing the page gets: the extensions of the registry that are not the protected defaults (the page has those), and the skipped folders. Each field is copied by name, so nothing else the host holds (a message, a path) reaches the page. */
export function listingOf(host: ExtensionHost): ExtensionsListing {
  return Object.freeze({
    extensions: Object.freeze(host.registry.list().filter(m => !m.protected).map(m => Object.freeze({ id: m.id, title: m.title, kind: m.kind, routes: Object.freeze([...m.routes]), protected: m.protected }))),
    skipped: Object.freeze(host.skipped.map(s => Object.freeze({ name: s.name, code: s.code }))),
  });
}

export function registerLocalModelsIpc(deps: LocalModelsIpcDeps): void {
  const models = deps.models ?? createLocalModels({ stateRoot: deps.stateRoot });
  const answers: Readonly<Record<LocalCall, () => Promise<unknown>>> = {
    localModels: () => models.localModels(),
    listExtensions: async () => {
      const host = deps.extensionHost();
      if (host === null) throw new Error('extension host not started');
      return listingOf(host);
    },
  };
  for (const call of LOCAL_CALLS) {
    deps.ipc.handle(LOCAL_CHANNELS[call], async (event, ...args) => {
      const frame = event.senderFrame;
      if (frame === null || frame.parent !== null || !isAllowedRealSender(true, frame.url, deps.appIndexUrl)) throw new Error('NOT_ALLOWED');
      if (args.length !== LOCAL_ARITY[call]) throw new Error('BAD_ARGUMENT');
      try {
        return await answers[call]();
      } catch {
        throw new Error('FAILED');
      }
    });
  }
}
