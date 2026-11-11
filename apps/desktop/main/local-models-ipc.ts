/**
 * The two read-only calls of the `bowerloomLocal` bridge, answered in the main process (shared/api/local.ts names them). Registered for the default launch only.
 * Each call:
 *  - is answered only for the app's own page, in its main frame, before anything else happens;
 *  - takes no argument;
 *  - hands back plain data, or one short code (NOT_ALLOWED, BAD_ARGUMENT, FAILED).
 * `localModels` is the report of packages/local-models. A server that is down is a state in the report, never a refusal. `listExtensions` says which bundled
 * extensions main loaded and which folders it skipped (main/extension-loader.ts). Neither call writes, starts a program, or reads a process.
 */
import { join } from 'node:path';
import { createLocalModels } from '../../../packages/local-models/src/index.js';
import type { LocalModels } from '../../../packages/local-models/src/index.js';
import { LOCAL_ARITY, LOCAL_CALLS, LOCAL_CHANNELS } from '../shared/api/local.js';
import type { ExtensionsListing, LocalCall } from '../shared/api/local.js';
import { loadBundledManifests } from './extension-loader.js';
import type { LoadResult } from './extension-loader.js';
import type { RealIpc } from './real-ipc.js';
import { isAllowedRealSender } from './security.js';

export interface LocalModelsIpcDeps {
  readonly ipc: RealIpc;
  readonly appIndexUrl: string;
  /** The state folder that holds `local-models.json`. */
  readonly stateRoot: string;
  /** The folder that holds `extensions/<name>/manifest.json`: an absolute path. */
  readonly bundleRoot: string;
  /** Test use: another source of the report. Defaults to the package. */
  readonly models?: LocalModels;
  /** Test use: another loader of the manifests. Defaults to the bundle loader. */
  readonly loadExtensions?: (bundleRoot: string) => LoadResult;
}

/** The bundle root: `<resources>` in a packaged build, `apps/desktop` in development (`appRoot` is apps/desktop/dist), the way main/kit.ts finds the kits. */
export function extensionsBundleRoot(o: { readonly packaged: boolean; readonly resourcesPath: string; readonly appRoot: string }): string {
  return o.packaged ? o.resourcesPath : join(o.appRoot, '..');
}

/** The listing the page gets: each field copied by name, so nothing the loader holds beyond them (a message, a path) reaches the page. */
export function listingOf(result: LoadResult): ExtensionsListing {
  return Object.freeze({
    extensions: Object.freeze(result.manifests.map(m => Object.freeze({ id: m.id, title: m.title, kind: m.kind, routes: Object.freeze([...m.routes]), protected: m.protected }))),
    skipped: Object.freeze(result.skipped.map(s => Object.freeze({ name: s.name, code: s.code }))),
  });
}

export function registerLocalModelsIpc(deps: LocalModelsIpcDeps): void {
  const models = deps.models ?? createLocalModels({ stateRoot: deps.stateRoot });
  const load = deps.loadExtensions ?? loadBundledManifests;
  const answers: Readonly<Record<LocalCall, () => Promise<unknown>>> = {
    localModels: () => models.localModels(),
    listExtensions: async () => listingOf(load(deps.bundleRoot)),
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
