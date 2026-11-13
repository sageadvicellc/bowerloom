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
import { RunsReal } from './runs-real/RunsReal.js';
import { CompareReal } from './runs-real/CompareReal.js';
import { useHarnessState } from './session.js';
import { Interfaces } from './screens/Interfaces.js';
import { History } from './screens/History.js';
import { Help } from './screens/Help.js';
import { LocalModels } from './local-models/LocalModels.js';
import { Modules } from './modules/ModulesScreen.js';
import { EnginesUsage } from './engines-usage/EnginesUsage.js';
import { ExtensionTemplate } from './extensions/ExtensionTemplate.js';
import { DEFAULT_IDS } from '../../shared/extensions/defaults.js';
import type { ExtensionManifest } from '../../shared/extensions/types.js';
import { registerLoaded } from '../../shared/extensions/register.js';

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
const stray = (route: Route): ReactElement => <RouteNotFound route={route.name === 'extension' ? route.route : route.name} />;

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

/** Runs and Compare: the made-up runs of the store in the sample, and the person's recorded runs from main (the runs bridge) on their own folders. */
function RunsRoute({ id }: { id: string | null }): ReactElement { return useHarnessState().real === undefined ? <Runs id={id} /> : <RunsReal id={id} />; }
function CompareRoute({ group }: { group: string }): ReactElement { return useHarnessState().real === undefined ? <Compare group={group} /> : <CompareReal group={group} />; }

function projects({ route }: MountProps): ReactElement {
  switch (route.name) {
    case 'projects': return <Projects id={route.id ?? null} />;
    case 'runs': return <RunsRoute id={route.id ?? null} />;
    case 'compare': return <CompareRoute group={route.group} />;
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
  const { route } = props;
  // A stock extension without its own route name is reached at #app/extension/<route>. The route in the address names the route to resolve. A default extension is never reached this way:
  // its routes have their own addresses, so the generic address shows the named not-found state for them.
  const name = route.name === 'extension' ? route.route : route.name;
  const found = registry.resolve(name);
  if (!found.found) return <RouteNotFound route={found.route} />;
  if (route.name === 'extension' && (DEFAULT_IDS as readonly string[]).includes(found.id)) return <RouteNotFound route={name} />;
  return found.mount(props);
}

/** The screens of bundled extensions, by extension id. An extension in the bundle that has no screen here is not registered: a manifest carries no code. */
const BUNDLED_MOUNTS: Readonly<Record<string, ScreenMount>> = Object.freeze({
  'local-models': ({ route }) => (route.name === 'local-models' ? <LocalModels /> : stray(route)),
  modules: ({ route }) => (route.name === 'modules' ? <Modules id={route.id ?? null} /> : stray(route)),
  'engines-usage': ({ route }) => (route.name === 'extension' && route.route === 'engines-usage' ? <EnginesUsage /> : stray(route)),
  'extension-template': ({ route }) => (route.name === 'extension' && route.route === 'extension-template' ? <ExtensionTemplate /> : stray(route)),
});

/** The ids of the bundled extensions this build has a screen for. */
export const BUNDLED_IDS: readonly string[] = Object.freeze(Object.keys(BUNDLED_MOUNTS));

/**
 * Registers the screen of each listed manifest that has one, and gives back the manifests that are registered (also those that were before). A manifest with no screen, or one the registry refuses
 * (RESERVED, ROUTE_TAKEN), is left out. Calling it again with the same list changes nothing.
 */
export function registerBundled(registry: Registry<ScreenMount>, manifests: readonly ExtensionManifest[]): readonly ExtensionManifest[] {
  return registerBundledDetailed(registry, manifests).registered;
}

/** One listed manifest the registry refused, with the id, the routes and the code (RESERVED, ROUTE_TAKEN, EXTENSION_EXISTS, MOUNT_FAILED or BAD_MANIFEST). */
export interface RefusedBundled { readonly id: string; readonly routes: readonly string[]; readonly code: string }

/**
 * The same as registerBundled, and it says what it left out. `registered`: the manifests that are registered. `noMount`: manifests this build has no screen for. `refused`: manifests that have a screen
 * and that the registry refused, each with its code. The two lists are never mixed: a refusal is not a missing screen.
 */
export function registerBundledDetailed(registry: Registry<ScreenMount>, manifests: readonly ExtensionManifest[]): { readonly registered: readonly ExtensionManifest[]; readonly noMount: readonly ExtensionManifest[]; readonly refused: readonly RefusedBundled[] } {
  const known = manifests.filter(m => Object.hasOwn(BUNDLED_MOUNTS, m.id));
  const noMount = manifests.filter(m => !Object.hasOwn(BUNDLED_MOUNTS, m.id));
  const have = new Set(registry.list().map(m => m.id));
  const fresh = known.filter(m => !have.has(m.id));
  const answers = registerLoaded(registry, fresh, m => BUNDLED_MOUNTS[m.id]!);
  const refused: RefusedBundled[] = [];
  answers.forEach((answer, i) => { if (!answer.ok) refused.push({ id: fresh[i]!.id, routes: fresh[i]!.routes, code: answer.refusal.code }); });
  const now = new Set(registry.list().map(m => m.id));
  return Object.freeze({ registered: Object.freeze(known.filter(m => now.has(m.id))), noMount: Object.freeze(noMount), refused: Object.freeze(refused) });
}
