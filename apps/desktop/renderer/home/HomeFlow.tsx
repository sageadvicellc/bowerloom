/**
 * The first minute, as three screens in one window: Welcome, Find, and the map (HomeApp). The page address picks where it opens (shared/home/route.ts).
 * Nothing is stored: a new launch starts at Welcome again. Find leads to the map and the map's tour. The full-page Find is the FIRST scan only (shared/home/flow-screens.ts):
 * "Find more" on the map is a panel in the right column of the map, which HomeApp draws itself, and it hands the agents that were skipped back here, so they stay off the map.
 * The agents the person unticked in Find are kept off the map (`skipped`). They stay in the world, so nothing is lost, and Find more can bring them back.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { BarPhase } from '../../shared/home/savebar.js';
import { screenAfter } from '../../shared/home/flow-screens.js';
import type { Screen } from '../../shared/home/flow-screens.js';
import { startOf } from '../../shared/home/route.js';
import { useProtoStore } from '../common/session.js';
import { HomeApp } from './HomeApp.js';
import { FindScreen } from './first-run/FindScreen.js';
import { Welcome } from './first-run/Welcome.js';
import type { DataSource } from './read-only.js';
import { WORDS } from './words.js';
import './home-tokens.css';
import './kit/kit.css';
import './home.css';

export function HomeFlow({ dataSource = 'sample' }: { dataSource?: DataSource } = {}): ReactElement {
  const { state } = useProtoStore();
  const [start] = useState(() => startOf(location.hash));
  const [screen, setScreen] = useState<Screen>(start.screen);
  const [skipped, setSkipped] = useState<readonly string[]>([]);
  /** True when the tour starts by itself on the next map, and the closing note is allowed after the first Save. */
  const [tourNow, setTourNow] = useState(start.guided);
  const [guided, setGuided] = useState(start.guided);
  /** What the Save bar last said. It lives here, so it survives the first scan's page being left for the map. */
  const [phase, setPhase] = useState<BarPhase | null>(null);

  useEffect(() => { if (screen !== 'map') document.title = WORDS.label.appName; }, [screen]);

  const leave = useCallback(() => setScreen(current => screenAfter(current, 'leave')), []);
  const done = useCallback((agents: readonly string[]) => {
    setSkipped(agents);
    setScreen(current => screenAfter(current, 'done'));
    setTourNow(true); setGuided(true);
  }, []);

  if (screen === 'welcome') return <Welcome real={dataSource === 'real'} onFind={() => setScreen(current => screenAfter(current, 'find'))} />;
  if (screen === 'find') return <FindScreen world={state.draft} committed={state.committed} skipped={skipped} onLeave={leave} onDone={done} />;
  return <HomeApp barPhase={{ phase, set: setPhase }} skipped={skipped} onSkippedChange={setSkipped} autoTour={tourNow} closingNote={guided} dataSource={dataSource} />;
}
