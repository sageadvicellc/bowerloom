/**
 * The first minute, as three screens in one window: Welcome, Find, and the map (HomeApp). The page address picks where it opens (shared/home/route.ts).
 * Nothing is stored: a new launch starts at Welcome again. Find leads to the map and the map's tour; "Find more" on the map reopens Find without Welcome.
 * The agents of a place the person unticked in Find are kept off the map (`skipped`). They stay in the world, so nothing is lost, and Find more can bring them back.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { startOf } from '../../shared/home/route.js';
import { useProtoStore } from '../proto/session.js';
import { HomeApp } from './HomeApp.js';
import { FindScreen } from './first-run/FindScreen.js';
import { Welcome } from './first-run/Welcome.js';
import { WORDS } from './words.js';
import './home-tokens.css';
import './kit/kit.css';
import './home.css';

type Screen = 'welcome' | 'find' | 'map';

export function HomeFlow(): ReactElement {
  const { state } = useProtoStore();
  const [start] = useState(() => startOf(location.hash));
  const [screen, setScreen] = useState<Screen>(start.screen);
  /** Where Find came from: the first run (Welcome is behind it) or "Find more" (the map is). */
  const [from, setFrom] = useState<'welcome' | 'map'>('welcome');
  const [skipped, setSkipped] = useState<readonly string[]>([]);
  /** True when the tour starts by itself on the next map, and the closing note is allowed after the first Save. */
  const [tourNow, setTourNow] = useState(start.guided);
  const [guided, setGuided] = useState(start.guided);

  useEffect(() => { if (screen !== 'map') document.title = WORDS.label.appName; }, [screen]);

  const leave = useCallback(() => setScreen(from), [from]);
  const done = useCallback((agents: readonly string[]) => {
    setSkipped(agents);
    setScreen('map');
    if (from === 'welcome') { setTourNow(true); setGuided(true); } else setTourNow(false);
  }, [from]);

  if (screen === 'welcome') return <Welcome onFind={() => { setFrom('welcome'); setScreen('find'); }} />;
  if (screen === 'find') return <FindScreen world={state.draft} skipped={skipped} onLeave={leave} onDone={done} />;
  return <HomeApp skipped={skipped} autoTour={tourNow} closingNote={guided} onFindMore={() => { setFrom('map'); setTourNow(false); setScreen('find'); }} />;
}
