/**
 * Follows the bundled extensions main loaded. The page asks `listExtensions` and registers a mount for each answer it has a screen for (extension-mounts.tsx), so removing an extension's folder
 * removes its screen and its navigation entry. The call can fail for a moment at launch, before the extension host of main has started (FAILED, or HOST_NOT_STARTED in a later main):
 * any failure means "not ready yet", and the same read is tried again on the normal refresh interval. It is never shown as an error.
 */
import { useEffect, useState } from 'react';
import type { LocalBridge } from '../../shared/api/local.js';
import type { ExtensionManifest } from '../../shared/extensions/types.js';
import type { Registry } from '../../shared/extensions/registry.js';
import { REFRESH_MS } from '../../shared/local-models/view-model.js';
import { registerBundled } from './extension-mounts.js';
import type { ScreenMount } from './extension-mounts.js';

export interface Bundled {
  /** The registered bundled extensions, in the order main listed them. */
  readonly extensions: readonly ExtensionManifest[];
  /** False until the first answer. With no bridge it is true at once: there is nothing to wait for. */
  readonly ready: boolean;
}

export interface Scheduler { readonly after: (run: () => void, ms: number) => unknown; readonly cancel: (handle: unknown) => void }
const REAL_CLOCK: Scheduler = { after: (run, ms) => setTimeout(run, ms), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };

/**
 * Asks `listExtensions` until it answers, registers what it lists, and tells `onAnswer`. A refusal of any kind, FAILED before the host started or HOST_NOT_STARTED, is not ready yet:
 * the same call is tried again after REFRESH_MS, and `onAnswer` is not called. Gives back a stop function.
 */
export function followExtensions(registry: Registry<ScreenMount>, bridge: LocalBridge, onAnswer: (state: Bundled) => void, clock: Scheduler = REAL_CLOCK): () => void {
  let live = true, handle: unknown;
  const attempt = (): void => {
    bridge.listExtensions().then(
      listing => { if (live) onAnswer({ extensions: registerBundled(registry, listing.extensions), ready: true }); },
      () => { if (live) handle = clock.after(attempt, REFRESH_MS); },
    );
  };
  attempt();
  return () => { live = false; if (handle !== undefined) clock.cancel(handle); };
}

export function useBundledExtensions(registry: Registry<ScreenMount>, bridge: LocalBridge | null): Bundled {
  const [state, setState] = useState<Bundled>({ extensions: [], ready: bridge === null });
  useEffect(() => {
    if (bridge === null) { setState({ extensions: [], ready: true }); return undefined; }
    return followExtensions(registry, bridge, setState);
  }, [registry, bridge]);
  return state;
}
