/**
 * The calls of the third bridge, `bowerloomLocal`: two read-only calls with no argument. `localModels` answers the report of the model servers on this computer
 * (packages/local-models). `listExtensions` answers which bundled extensions main loaded, so the page follows the manifests and not a list of its own.
 * The 42 calls of the reader and the engine (shared/api/calls.ts) and the 39 engine calls with their golden file stay as they are: nothing is added to them.
 * Only types are imported, and no Electron and no Node module, so the preload, main and the page read one table.
 */
import type { ExtensionManifest } from '../extensions/types.js';
import type { LocalModelsReport } from '../local-models/types.js';

export const LOCAL_CALLS = Object.freeze(['localModels', 'listExtensions'] as const);
export type LocalCall = (typeof LOCAL_CALLS)[number];

/** Both calls take no argument. A call with an argument is refused BAD_ARGUMENT. */
export const LOCAL_ARITY: Readonly<Record<LocalCall, number>> = Object.freeze({ localModels: 0, listExtensions: 0 });

/** One channel for each call, in the namespace of this bridge. */
export const LOCAL_CHANNELS: Readonly<Record<LocalCall, string>> = Object.freeze({ localModels: 'bowerloom-local:localModels', listExtensions: 'bowerloom-local:listExtensions' });

/** The short codes a local call can be refused with. A server that is down is not a refusal: it is a state in the report. */
export const LOCAL_REFUSALS: readonly string[] = Object.freeze(['NOT_ALLOWED', 'BAD_ARGUMENT', 'FAILED']);

/** One extension folder that main could not load: its name as main cleaned it, and the short code of the loader. No message and no path. */
export interface SkippedExtension { readonly name: string; readonly code: string }

/** The answer of `listExtensions`: the manifests that loaded, in name order, and each folder that was skipped. */
export interface ExtensionsListing {
  readonly extensions: readonly ExtensionManifest[];
  readonly skipped: readonly SkippedExtension[];
}

/** The object `bowerloomLocal` holds in the page. */
export interface LocalBridge {
  localModels(): Promise<LocalModelsReport>;
  listExtensions(): Promise<ExtensionsListing>;
}
