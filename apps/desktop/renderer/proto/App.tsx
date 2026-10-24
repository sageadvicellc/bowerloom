/**
 * The prototype shell: a route table, a navigation, and the screen that is showing. It uses the existing shell's markup and classes
 * (shell, sidebar, brand, nav, main, footer), so it looks like the rest of the app. All the data is in memory, behind `loadWorld`.
 */
import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { ICONS } from '../dom.js';
import { iconPaths } from './icons.js';
import { AgentsScreen } from './AgentsScreen.js';
import { HarnessScreen } from './HarnessScreen.js';
import { KnowledgeScreen } from './KnowledgeScreen.js';
import { SetupScreen } from './SetupScreen.js';
import { SkillsScreen } from './SkillsScreen.js';
import { VersionsScreen } from './VersionsScreen.js';
import { createStore } from '../../shared/proto/store.js';
import { NavContext } from './nav.js';
import { ProtoProvider, useProtoStore } from './session.js';
import { loadWorld } from './world.js';
import { ROUTE_LABELS } from './words.js';
import type { RouteId, ScreenProps } from './words.js';
// Last, so the prototype's own token overrides win a tie with the screens' style sheets.
import './proto-tokens.css';

/** One route: its id, its title, its icon, and the screen it shows. */
export interface RouteEntry { readonly id: RouteId; readonly label: string; readonly icon: readonly string[]; readonly Screen: ComponentType<ScreenProps> }

/** The route table. The first route is the one that shows when the prototype opens. */
export const ROUTES: readonly RouteEntry[] = [
  { id: 'setup', label: ROUTE_LABELS.setup, icon: ICONS.settings, Screen: SetupScreen },
  { id: 'harness', label: ROUTE_LABELS.harness, icon: ICONS.map, Screen: HarnessScreen },
  { id: 'skills', label: ROUTE_LABELS.skills, icon: ICONS.library, Screen: SkillsScreen },
  { id: 'agents', label: ROUTE_LABELS.agents, icon: iconPaths('agent'), Screen: AgentsScreen },
  { id: 'knowledge', label: ROUTE_LABELS.knowledge, icon: ICONS.graph, Screen: KnowledgeScreen },
  { id: 'versions', label: ROUTE_LABELS.versions, icon: ICONS.storage, Screen: VersionsScreen },
];

function Icon({ paths, size = 22 }: { paths: readonly string[]; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths.map(d => <path key={d} d={d} />)}
    </svg>
  );
}

/** The prototype: one in-memory store, built from the sample world, shared by every screen. */
export function App() {
  const [store] = useState(() => createStore(loadWorld()));
  return <ProtoProvider store={store}><Shell /></ProtoProvider>;
}

function Shell() {
  const { state } = useProtoStore();
  const world = state.draft;
  const [routeId, setRouteId] = useState<RouteId>(ROUTES[0]!.id);
  const route = ROUTES.find(r => r.id === routeId) ?? ROUTES[0]!;
  const Screen = route.Screen;
  const opened = useRef(false);
  useEffect(() => {
    document.title = `Bowerloom prototype - ${route.label}`;
    // After the first screen, move the keyboard to the new screen's heading, as the rest of the app does.
    if (opened.current) document.querySelector<HTMLElement>('main h1')?.focus();
    opened.current = true;
  }, [route.label]);
  return (
    <div className="shell" data-proto="">
      <aside className="sidebar">
        <div className="brand"><Icon paths={ICONS.leaf} size={28} />Bowerloom</div>
        <div className="sandbox-badge" role="note">Prototype: nothing is saved</div>
        <nav className="nav" aria-label="Main">
          {ROUTES.map(r => (
            <button key={r.id} type="button" aria-current={r.id === route.id ? 'page' : undefined} onClick={() => setRouteId(r.id)}>
              <Icon paths={r.icon} />{r.label}
            </button>
          ))}
        </nav>
      </aside>
      <main id="main"><NavContext.Provider value={setRouteId}><Screen world={world} /></NavContext.Provider></main>
      <footer className="footer"><span>Bowerloom prototype</span><span className="spacer" /><span>Sample data. Nothing is saved.</span></footer>
    </div>
  );
}
