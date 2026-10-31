/**
 * The root of the harness-first preview. It holds the store and the shared state, reads the route from the page address, and draws the screen the route names:
 * the three first screens (Welcome, Choose sources, Read sources) on their own, and every other screen inside the shell. The install sheet, the start sheet and the note are drawn over the shell.
 * Nothing is saved: a new launch starts again from the sample, with no window and no file touched.
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
import { HarnessProvider } from './session.js';
import { Shell } from './Shell.js';
import { UiProvider, useUi } from './ui.js';
import { Toast } from './parts/Toast.js';
import { Welcome } from './screens/Welcome.js';
import { ChooseSources } from './screens/ChooseSources.js';
import { ReadSources } from './screens/ReadSources.js';
import { NoBridgeScreen, RealChoose } from './real/RealChoose.js';
import { chooseKind } from './real/mode.js';
import { blankRealState } from './real/blank.js';
import { HarnessList } from './screens/HarnessList.js';
import { Builder } from './screens/Builder.js';
import { FileView } from './screens/FileView.js';
import { Library } from './screens/Library.js';
import { Projects } from './screens/Projects.js';
import { Runs } from './screens/Runs.js';
import { Compare } from './screens/Compare.js';
import { Interfaces } from './screens/Interfaces.js';
import { History } from './screens/History.js';
import { Help } from './screens/Help.js';
import { InstallSheet } from './sheets/InstallSheet.js';
import { StartSheet } from './sheets/StartSheet.js';
import { AdoptSheet } from './sheets/AdoptSheet.js';
import { ProjectSheet } from './sheets/ProjectSheet.js';
import { SaveSheet } from './sheets/SaveSheet.js';
import { EngineProvider } from './engine.js';
import { NotesProvider } from './notes/notes-session.js';
import { NotesFirstRun } from './notes/NotesFirstRun.js';
import { FolderDraftProvider } from './folder-draft.js';
import { createSampleEngine } from '../../shared/engine/sample.js';
import { SAMPLE_PREVIEW_ATTRIBUTE } from '../../shared/engine/sample-switch.js';
import type { EngineBridge } from '../../shared/engine/types.js';
import { WORDS } from './words.js';

/** The screen a route names. */
function Screens({ route, bridge, realMode }: { route: Route; bridge: RealBridge | null; realMode: boolean }): ReactElement {
  switch (route.name) {
    case 'welcome': return <Welcome />;
    case 'choose': {
      // The mode is the page address's, not the bridge's: a real launch with no bridge says so, and is never the sample.
      const choose = chooseKind(realMode, bridge);
      return choose.kind === 'real' ? <RealChoose bridge={choose.bridge} /> : choose.kind === 'no-bridge' ? <NoBridgeScreen /> : <ChooseSources />;
    }
    case 'read': return <ReadSources />;
    case 'notes': return <NotesFirstRun />;
    case 'harnesses': return <HarnessList id={route.id ?? null} />;
    case 'builder': return <Builder key={route.id} id={route.id} />;
    case 'file': return <FileView partId={route.partId} />;
    case 'library': return <Library kind={route.kind} partId={route.partId ?? null} />;
    case 'projects': return <Projects id={route.id ?? null} />;
    case 'runs': return <Runs id={route.id ?? null} />;
    case 'compare': return <Compare group={route.group} />;
    case 'interfaces': return <Interfaces id={route.id ?? null} />;
    case 'history': return <History />;
    case 'help': return <Help />;
  }
}

function Overlays(): ReactElement {
  const ui = useUi();
  return (
    <>
      <InstallSheet open={ui.install.open} projectId={ui.install.projectId} harnessId={ui.install.harnessId} step={ui.install.step} interfaceIds={ui.install.interfaceIds} onStep={ui.setInstallStep} onClose={ui.closeInstall} />
      <StartSheet open={ui.start.open} harnessId={ui.start.harnessId} projectId={ui.start.projectId} onClose={ui.closeStart} />
      <AdoptSheet open={ui.adopt.open} folderId={ui.adopt.folderId} onClose={ui.closeAdopt} />
      <ProjectSheet open={ui.projectSheet.open} folderId={ui.projectSheet.folderId} mode={ui.projectSheet.mode} keep={ui.projectSheet.keep} onClose={ui.closeProject} />
      <SaveSheet open={ui.saveSheet.open} folderId={ui.saveSheet.folderId} tour={ui.saveSheet.tour} start={ui.saveSheet.start} restore={ui.saveSheet.restore} onClose={ui.closeSave} />
      <Toast />
    </>
  );
}

function Routes({ bridge, realMode }: { bridge: RealBridge | null; realMode: boolean }): ReactElement {
  const route = useRoute();
  useEffect(() => { document.title = WORDS.label.appName; }, [route]);
  if (isFirstRun(route)) return <Screens route={route} bridge={bridge} realMode={realMode} />;
  return <Shell route={route} overlays={<Overlays />}><Screens route={route} bridge={bridge} realMode={realMode} /></Shell>;
}

/**
 * `realMode` is true for the launch on the person's own folders (the default launch, the address `#app`); `real` is its read-only bridge, null when the window has none or a partial one.
 * In real mode Choose reads the person's folders and the world starts empty; with no bridge Choose shows the no-bridge error, and never the sample. Without `realMode`, a bridge makes it real (a caller that gives only the bridge).
 */
export function HarnessApp({ store: given, real = null, realMode = real !== null, engine: givenEngine }: { store?: HarnessStore; real?: RealBridge | null; realMode?: boolean; engine?: EngineBridge | null | undefined }): ReactElement {
  // The world is made once, from the sample, dated from the clock now (the runs started 12 minutes ago). Runs that are running at the start finish by themselves after about 15 seconds.
  // On the person's own folders it starts empty, and the first read replaces it.
  const [store] = useState(() => given ?? createHarnessStore({ initial: realMode ? blankRealState(realNow()) : createSampleWorld(realNow()), now: realNow, finishRunning: true }));
  useEffect(() => () => store.dispose(), [store]);
  // The adopt and install sheets: the sample answers in memory and writes nothing; real mode uses the window's engine bridge, or none (the sheets then say so).
  const [engine] = useState<EngineBridge | null>(() => (givenEngine !== undefined ? givenEngine : realMode ? null : createSampleEngine({ previewEngines: document.body.getAttribute(SAMPLE_PREVIEW_ATTRIBUTE) === '1' })));
  return <HarnessProvider store={store}><EngineProvider engine={engine}><UiProvider><NotesProvider><FolderDraftProvider><Routes bridge={real} realMode={realMode} /></FolderDraftProvider></NotesProvider></UiProvider></EngineProvider></HarnessProvider>;
}
