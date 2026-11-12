/**
 * Follows the bundled extensions main loaded. The page asks `listExtensions` and registers a mount for each answer it has a screen for (extension-mounts.tsx), so removing an extension's folder
 * removes its screen and its navigation entry. The call can fail for a moment at launch, before the extension host of main has started (FAILED, or HOST_NOT_STARTED in a later main):
 * any failure means "not ready yet", and the same read is tried again on the normal refresh interval. It is quiet for the first tries; after that the screen says the extension host has not started, with the code.
 */
import { useEffect, useState } from 'react';
import type { ExtensionsListing, LocalBridge, SkippedExtension } from '../../shared/local-models/types.js';
import { refusalCode } from '../../shared/api/calls.js';
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
  /** The short code of the failure of the list, once it has failed ATTEMPTS_BEFORE_NOTICE times in a row, or null. The list is still tried again. */
  readonly problem: string | null;
  /** The extension folders that main could not load: each name and short code, as main gave them. Empty before the first answer. */
  readonly skipped: readonly SkippedExtension[];
}

export interface Scheduler { readonly after: (run: () => void, ms: number) => unknown; readonly cancel: (handle: unknown) => void }
const REAL_CLOCK: Scheduler = { after: (run, ms) => setTimeout(run, ms), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };

/** How many failed tries in a row are quiet. The next one tells the screen, which says the extension host has not started. */
export const ATTEMPTS_BEFORE_NOTICE = 3;

/**
 * Asks `listExtensions` until it answers, registers what it lists, and tells `onAnswer`. A refusal of any kind, FAILED before the host started or HOST_NOT_STARTED, is not ready yet:
 * the same call is tried again after REFRESH_MS. The first ATTEMPTS_BEFORE_NOTICE - 1 failures are quiet. From the third on, `onAnswer` is told once for each new code, with `ready` false and the code
 * in `problem`, and the tries go on. A call that throws at once is a failed try. Gives back a stop function.
 */
export function followExtensions(registry: Registry<ScreenMount>, bridge: LocalBridge, onAnswer: (state: Bundled) => void, clock: Scheduler = REAL_CLOCK): () => void {
  let live = true, handle: unknown, failures = 0, told: string | null = null;
  const attempt = (): void => {
    new Promise<ExtensionsListing>(resolve => resolve(bridge.listExtensions())).then(
      listing => { if (live) onAnswer({ extensions: registerBundled(registry, listing.extensions), ready: true, problem: null, skipped: Object.freeze([...listing.skipped]) }); },
      (error: unknown) => {
        if (!live) return;
        failures += 1;
        const code = refusalCode(error, 'local');
        if (failures >= ATTEMPTS_BEFORE_NOTICE && told !== code) { told = code; onAnswer({ extensions: [], ready: false, problem: code, skipped: [] }); }
        handle = clock.after(attempt, REFRESH_MS);
      },
    );
  };
  attempt();
  return () => { live = false; if (handle !== undefined) clock.cancel(handle); };
}

/**
 * What the route of a bundled extension draws (Local models by default; the Modules view passes its own id). 'wait': the list has not answered. 'absent': it answered and this extension is not in it (and the window has a bridge), so the screen says it did not load.
 * 'screen': the registry draws it (or, with no bridge, says the route is not available).
 */
export function localRouteState(bundled: Bundled, hasBridge: boolean, id: string = 'local-models'): 'wait' | 'absent' | 'screen' {
  if (!bundled.ready) return 'wait';
  return hasBridge && !bundled.extensions.some(x => x.id === id) ? 'absent' : 'screen';
}

export function useBundledExtensions(registry: Registry<ScreenMount>, bridge: LocalBridge | null): Bundled {
  const [state, setState] = useState<Bundled>({ extensions: [], ready: bridge === null, problem: null, skipped: [] });
  useEffect(() => {
    if (bridge === null) { setState({ extensions: [], ready: true, problem: null, skipped: [] }); return undefined; }
    return followExtensions(registry, bridge, setState);
  }, [registry, bridge]);
  return state;
}
