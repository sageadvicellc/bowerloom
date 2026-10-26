/**
 * The root of the harness-first preview. It holds the store and the shared state, reads the route from the page address, and draws the screen the route names:
 * the three first screens (Welcome, Choose sources, Read sources) on their own, and every other screen inside the shell. The install sheet, the start sheet and the note are drawn over the shell.
 * Nothing is saved: a new launch starts again from the sample, with no window and no file touched.
 */
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { createSampleWorld } from '../../shared/harness/sample.js';
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
import { WORDS } from './words.js';

/** The screen a route names. */
function Screens({ route }: { route: Route }): ReactElement {
  switch (route.name) {
    case 'welcome': return <Welcome />;
    case 'choose': return <ChooseSources />;
    case 'read': return <ReadSources />;
    case 'harnesses': return <HarnessList id={route.id ?? null} />;
    case 'builder': return <Builder key={route.id} id={route.id} view={route.view} />;
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
      <Toast />
    </>
  );
}

function Routes(): ReactElement {
  const route = useRoute();
  useEffect(() => { document.title = WORDS.label.appName; }, [route]);
  if (isFirstRun(route)) return <Screens route={route} />;
  return <Shell route={route} overlays={<Overlays />}><Screens route={route} /></Shell>;
}

export function HarnessApp({ store: given }: { store?: HarnessStore }): ReactElement {
  // The world is made once, from the sample, dated from the clock now (the runs started 12 minutes ago). Runs that are running at the start finish by themselves after about 15 seconds.
  const [store] = useState(() => given ?? createHarnessStore({ initial: createSampleWorld(realNow()), now: realNow, finishRunning: true }));
  useEffect(() => () => store.dispose(), [store]);
  return <HarnessProvider store={store}><UiProvider><Routes /></UiProvider></HarnessProvider>;
}
