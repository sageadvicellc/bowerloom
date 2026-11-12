/**
 * The root of the harness-first preview. It holds the store and the shared state, reads the route from the page address, and draws the screen the route names:
 * the three first screens (Welcome, Choose sources, Read sources) on their own, and every other screen inside the shell. The install sheet, the start sheet and the note are drawn over the shell.
 * The sample saves nothing: a new launch of it starts again from the made-up folders. On the person's own folders the last read is kept by main and shown at launch (real/saved-scan.tsx).
 */
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { createSampleWorld } from '../../shared/harness/sample.js';
import type { RealBridge } from '../../shared/real/types.js';
import { createHarnessStore } from '../../shared/harness/store.js';
import type { HarnessStore } from '../../shared/harness/store.js';
import { isFirstRun } from '../../shared/harness/route.js';
import type { Route } from '../../shared/harness/route.js';
import { realNow } from './clock.js';
import { useRoute } from './router.js';
import { HarnessProvider, useHarnessState } from './session.js';
import { Shell } from './Shell.js';
import { UiProvider, useUi } from './ui.js';
import { Toast } from './parts/Toast.js';
import { RouteScreen, createScreenRegistry } from './extension-mounts.js';
import type { ScreenMount } from './extension-mounts.js';
import type { Registry } from '../../shared/extensions/registry.js';
import { SavedScanProvider } from './real/saved-scan.js';
import { blankRealState } from './real/blank.js';
import { InstallSheet } from './sheets/InstallSheet.js';
import { StartSheet } from './sheets/StartSheet.js';
import { StartRealSheet } from './sheets/StartRealSheet.js';
import { AdoptSheet } from './sheets/AdoptSheet.js';
import { ProjectSheet } from './sheets/ProjectSheet.js';
import { SaveSheet } from './sheets/SaveSheet.js';
import { ShareSheets } from './sheets/ImportSheet.js';
import { EngineProvider } from './engine.js';
import { NotesProvider } from './notes/notes-session.js';
import { FolderDraftProvider } from './folder-draft.js';
import { useCloseGuard } from './close-guard.js';
import { fallbackEngine, fallbackLocal, fallbackRuns } from '../api/client.js';
import type { RunsBridge } from '../../shared/api/runs.js';
import { RunsProvider } from './runs-real/runs-session.js';
import type { LocalBridge } from '../../shared/local-models/types.js';
import { LocalProvider, SkippedProvider, useLocal } from './local-models/local.js';
import { LocalModelsPending } from './local-models/LocalModels.js';
import { extensionAbsence, localRouteState, useBundledExtensions } from './bundled-extensions.js';
import { ExtensionAbsent, ExtensionPending } from './extensions/ExtensionPending.js';
import type { EngineBridge } from '../../shared/engine/types.js';

function Overlays(): ReactElement {
  const ui = useUi(), real = useHarnessState().real !== undefined;
  return (
    <>
      <InstallSheet open={ui.install.open} projectId={ui.install.projectId} harnessId={ui.install.harnessId} step={ui.install.step} interfaceIds={ui.install.interfaceIds} onStep={ui.setInstallStep} onClose={ui.closeInstall} />
      {real ? <StartRealSheet open={ui.start.open} folderId={ui.start.folderId} fromHarness={ui.start.harnessId !== null} onClose={ui.closeStart} /> : <StartSheet open={ui.start.open} harnessId={ui.start.harnessId} projectId={ui.start.projectId} onClose={ui.closeStart} />}
      <AdoptSheet open={ui.adopt.open} folderId={ui.adopt.folderId} onClose={ui.closeAdopt} />
      <ProjectSheet open={ui.projectSheet.open} folderId={ui.projectSheet.folderId} mode={ui.projectSheet.mode} keep={ui.projectSheet.keep} start={ui.projectSheet.start} onClose={ui.closeProject} />
      <SaveSheet open={ui.saveSheet.open} folderId={ui.saveSheet.folderId} tour={ui.saveSheet.tour} start={ui.saveSheet.start} restore={ui.saveSheet.restore} onClose={ui.closeSave} />
      <ShareSheets />
      <Toast />
    </>
  );
}

function Routes({ bridge, realMode, registry }: { bridge: RealBridge | null; realMode: boolean; registry: Registry<ScreenMount> }): ReactElement {
  const route = useRoute();
  // The title is the app's name, and carries the count of unsaved changes for main (which keeps the title bar to the name). The close guard holds the unload while there are any.
  useCloseGuard();
  // The bundled extensions follow `listExtensions`. Until its first answer, their route waits with a plain line: a failure at launch is "not ready yet", never the not-found state.
  const localBridge = useLocal().bridge;
  const bundled = useBundledExtensions(registry, localBridge);
  if (isFirstRun(route)) return <RouteScreen route={route} bridge={bridge} realMode={realMode} registry={registry} />;
  // The line also stands for a route whose extension main skipped, so that the skipped names and codes are shown and not a bare not-found state.
  const at = route.name === 'local-models' ? localRouteState(bundled, localBridge !== null) : 'screen';
  // When the extension is absent, only the skipped entries of that extension are listed: another extension's skip is not this screen's.
  const own = bundled.skipped.filter(x => x.name === 'local-models');
  // The address of any other stock extension waits the same way: until the list has answered, its route is not "not found".
  const waitingForExtension = route.name === 'extension' && !bundled.ready;
  // When the list answered and the route still has no owner, it can say why: a skipped folder with its code, or a manifest with no screen in this build.
  const absent = route.name === 'extension' && bundled.ready && !registry.resolve(route.route).found ? extensionAbsence(bundled, route.route) : null;
  return (
    <Shell route={route} overlays={<Overlays />} extensions={bundled.extensions}>
      <SkippedProvider skipped={bundled.skipped}>
        {waitingForExtension ? <ExtensionPending problem={bundled.problem} /> : absent !== null ? <ExtensionAbsent absence={absent} /> : at === 'screen' ? <RouteScreen route={route} bridge={bridge} realMode={realMode} registry={registry} /> : <LocalModelsPending problem={bundled.problem} skipped={at === 'absent' ? own : []} loading={at === 'wait'} />}
      </SkippedProvider>
    </Shell>
  );
}

/**
 * `realMode` is true for the launch on the person's own folders (the default launch, the address `#app`); `real` is its read-only bridge, null when the window has none or a partial one.
 * In real mode Choose reads the person's folders and the world starts empty; with no bridge Choose shows the no-bridge error, and never the sample. Without `realMode`, a bridge makes it real (a caller that gives only the bridge).
 */
export function HarnessApp({ store: given, real = null, realMode = real !== null, engine: givenEngine, local: givenLocal, runs: givenRuns, registry: givenRegistry }: { store?: HarnessStore; real?: RealBridge | null; realMode?: boolean; engine?: EngineBridge | null | undefined; local?: LocalBridge | null | undefined; runs?: RunsBridge | null | undefined; registry?: Registry<ScreenMount> }): ReactElement {
  // The world is made once, from the sample, dated from the clock now (the runs started 12 minutes ago). Runs that are running at the start finish by themselves after about 15 seconds.
  // On the person's own folders it starts empty, and the first read replaces it.
  const [store] = useState(() => given ?? createHarnessStore({ initial: realMode ? blankRealState(realNow()) : createSampleWorld(realNow()), now: realNow, finishRunning: true }));
  useEffect(() => () => store.dispose(), [store]);
  // The adopt and install sheets: the sample answers in memory and writes nothing; real mode uses the window's engine bridge, or none (the sheets then say so). Both come from the API client.
  const [engine] = useState<EngineBridge | null>(() => (givenEngine !== undefined ? givenEngine : fallbackEngine(realMode)));
  // The local models calls: the sample bridge in the sample launch, the preload's bridge (or none) on the person's own folders.
  const [local] = useState<LocalBridge | null>(() => (givenLocal !== undefined ? givenLocal : fallbackLocal(realMode)));
  // The runs calls (the manual record of runs and the figures of a session log): the preload's bridge, or none. The sample launch has none, and its screens keep their made-up runs in the store.
  const [runs] = useState<RunsBridge | null>(() => (givenRuns !== undefined ? givenRuns : fallbackRuns(realMode)));
  // The registry is the only route table. It holds the six default extensions unless a caller (a test) gives its own.
  const [registry] = useState(() => givenRegistry ?? createScreenRegistry());
  return <HarnessProvider store={store}><EngineProvider engine={engine}><LocalProvider bridge={local} sample={!realMode && local !== null}><RunsProvider runs={runs}><UiProvider><SavedScanProvider engine={realMode ? engine : null}><NotesProvider><FolderDraftProvider><Routes bridge={real} realMode={realMode} registry={registry} /></FolderDraftProvider></NotesProvider></SavedScanProvider></UiProvider></RunsProvider></LocalProvider></EngineProvider></HarnessProvider>;
}
