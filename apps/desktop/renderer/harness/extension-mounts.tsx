/**
 * The screens of the harness app, mounted through the extension registry (shared/extensions). The registry is the only route table: a screen renders only through the
 * registration of the default extension that owns its route. Each default extension has one mount, and the mount draws the screen for each route the extension owns.
 * A route nobody owns (a registration removed in a test setup) shows a named not-found state, and the other areas still render. No screen behavior lives here.
 */
import type { ReactElement } from 'react';
import { createRegistry } from '../../shared/extensions/registry.js';
import type { Registry } from '../../shared/extensions/registry.js';
import { registerDefaults } from '../../shared/extensions/register.js';
import type { DefaultId } from '../../shared/extensions/defaults.js';
import type { Route } from '../../shared/harness/route.js';
import type { RealBridge } from '../../shared/real/types.js';
import { Welcome } from './screens/Welcome.js';
import { ChooseSources } from './screens/ChooseSources.js';
import { ReadSources } from './screens/ReadSources.js';
import { NoBridgeScreen, RealChoose } from './real/RealChoose.js';
import { chooseKind } from './real/mode.js';
import { NotesFirstRun } from './notes/NotesFirstRun.js';
import { HarnessList } from './screens/HarnessList.js';
import { Overview } from './screens/Overview.js';
import { Builder } from './screens/Builder.js';
import { FileView } from './screens/FileView.js';
import { Library } from './screens/Library.js';
import { Projects } from './screens/Projects.js';
import { Runs } from './screens/Runs.js';
import { Compare } from './screens/Compare.js';
import { Interfaces } from './screens/Interfaces.js';
import { History } from './screens/History.js';
import { Help } from './screens/Help.js';

/** What a mount is given: the route as the page address named it (its parameters unchanged), and the launch. */
export interface MountProps { readonly route: Route; readonly bridge: RealBridge | null; readonly realMode: boolean }
export type ScreenMount = (props: MountProps) => ReactElement;

/** The state a route shows when no extension owns it: a named result, never a blank page. */
export function RouteNotFound({ route }: { route: string }): ReactElement {
  return (
    <main className="hx-not-found" data-error="ROUTE_NOT_FOUND" role="alert">
      <h1 tabIndex={-1}>This screen is not available</h1>
      <p>No extension owns the route <code>{route}</code>. The code is ROUTE_NOT_FOUND.</p>
    </main>
  );
}

/** A route that reached a mount which does not own it. The registry never does this; the state keeps the switch total. */
const stray = (route: Route): ReactElement => <RouteNotFound route={route.name} />;

function firstRun({ route, bridge, realMode }: MountProps): ReactElement {
  switch (route.name) {
    case 'welcome': return <Welcome />;
    case 'choose': {
      // The mode is the page address's, not the bridge's: a real launch with no bridge says so, and is never the sample.
      const choose = chooseKind(realMode, bridge);
      return choose.kind === 'real' ? <RealChoose bridge={choose.bridge} /> : choose.kind === 'no-bridge' ? <NoBridgeScreen /> : <ChooseSources />;
    }
    case 'read': return <ReadSources />;
    case 'notes': return <NotesFirstRun />;
    default: return stray(route);
  }
}

function harnesses({ route }: MountProps): ReactElement {
  switch (route.name) {
    case 'harnesses': return <HarnessList id={route.id ?? null} />;
    case 'builder': return <Builder key={route.id} id={route.id} />;
    case 'file': return <FileView partId={route.partId} />;
    default: return stray(route);
  }
}

function projects({ route }: MountProps): ReactElement {
  switch (route.name) {
    case 'projects': return <Projects id={route.id ?? null} />;
    case 'runs': return <Runs id={route.id ?? null} />;
    case 'compare': return <Compare group={route.group} />;
    default: return stray(route);
  }
}

function interfacesHistoryHelp({ route }: MountProps): ReactElement {
  switch (route.name) {
    case 'interfaces': return <Interfaces id={route.id ?? null} />;
    case 'history': return <History />;
    case 'help': return <Help />;
    default: return stray(route);
  }
}

const MOUNTS: Readonly<Record<DefaultId, ScreenMount>> = Object.freeze({
  overview: ({ route }) => (route.name === 'overview' ? <Overview /> : stray(route)),
  harnesses,
  library: ({ route }) => (route.name === 'library' ? <Library kind={route.kind} partId={route.partId ?? null} /> : stray(route)),
  projects,
  'interfaces-history-help': interfacesHistoryHelp,
  'first-run': firstRun,
});

/** The one mount of a default extension. */
export const screenMountOf = (id: DefaultId): ScreenMount => MOUNTS[id];

/** A registry with the six default extensions, each with its screen mount. */
export function createScreenRegistry(): Registry<ScreenMount> {
  const registry = createRegistry<ScreenMount>();
  registerDefaults(registry, screenMountOf);
  return registry;
}

/** The screen a route names: the mount of the extension that owns the route, or the named not-found state. */
export function RouteScreen({ registry, ...props }: MountProps & { registry: Registry<ScreenMount> }): ReactElement {
  const found = registry.resolve(props.route.name);
  return found.found ? found.mount(props) : <RouteNotFound route={found.route} />;
}
