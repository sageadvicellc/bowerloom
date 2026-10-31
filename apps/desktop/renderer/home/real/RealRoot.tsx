/**
 * The root of real mode (`#prototype-v2/real`): the shell, read only, on the person's own setup. It holds the world as a store that starts empty and is replaced whenever a read comes
 * back (the first scan, and "Find more"), the plain words for what was read (the registry of shared/real/plain-fallback.ts), and nothing else. It never builds the sample world: no sample
 * copies, no starter agents, no library samples, no version to go back to. Without the real bridge (the page was opened by the other launch command) it says so in plain words.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { World } from '../../../shared/world/types.js';
import { createStore } from '../../../shared/world/store.js';
import { mergeResults } from '../../../shared/real/merge-result.js';
import { GLOBAL_SCOPE } from '../../../shared/real/map-world.js';
import { clearRealResult, registerRealResult } from '../../../shared/real/plain-fallback.js';
import type { RealResult } from '../../../shared/real/types.js';
import { HomeFlow } from '../HomeFlow.js';
import { ReadOnlyScope } from '../read-only.js';
import { getBridge } from './bridge.js';
import { RealFlowProvider } from './RealFlow.js';
import { REAL_COMMAND, REAL_WORDS } from './words.js';
import './real-scan.css';

/** The world before anything was read: only the home folder, nothing in it. */
const EMPTY: World = Object.freeze({ interfaces: [], items: [], scopes: [GLOBAL_SCOPE], overrides: [], wikiPages: [], slices: [], versions: [], libraries: [] });

/** The page of real mode in a window that was started without real mode: plain words and the command that starts it. */
export function NoRealBridge(): ReactElement {
  useEffect(() => { document.title = 'Bowerloom'; }, []);
  return (
    <div className="fr-root" data-home="" data-screen="no-real">
      <main id="main" className="fr-welcome">
        <h1 className="fr-title" tabIndex={-1}>{REAL_WORDS.hint.needsCommand}</h1>
        <p className="kit-hint">{REAL_WORDS.hint.startWith}</p>
        <p><code data-budget="content" data-command="">{REAL_COMMAND}</code></p>
      </main>
    </div>
  );
}

export function RealRoot(): ReactElement {
  const bridge = useMemo(() => getBridge(), []);
  const [store, setStore] = useState(() => createStore(EMPTY));
  const merged = useRef<RealResult | null>(null);
  // A read came back. The plain words are ready before the new world is shown, so no card is ever drawn with a stand-in name.
  const addResult = useCallback((result: RealResult): void => {
    const next = mergeResults(merged.current, result);
    merged.current = next;
    registerRealResult(next);
    setStore(createStore(next.world));
  }, []);
  useEffect(() => () => { clearRealResult(); }, []);
  const flow = useMemo(() => ({ addResult }), [addResult]);
  if (bridge === null) return <NoRealBridge />;
  return (
    <ReadOnlyScope readOnly store={store}>
      <RealFlowProvider value={flow}><HomeFlow dataSource="real" /></RealFlowProvider>
    </ReadOnlyScope>
  );
}
