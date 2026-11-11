/**
 * The runs calls, handed down the tree like the engine calls (renderer/harness/engine.tsx), and the two hooks the real Runs and Compare screens use. The sample launch gets none (its screens keep their
 * made-up runs in the store); the launch on the person's own folders gets the bridge of its preload from renderer/api/client.ts, or null when the window has none.
 * Nothing here holds a path or a line of a chat: the page gets plain runs and plain figures from main.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { RunFigures, RunPatch, RunView, RunsBridge } from '../../../shared/api/runs.js';
import { runsCode as runsCodeOf } from '../../../shared/api/runs-shape.js';

const Context = createContext<RunsBridge | null>(null);

export function RunsProvider({ runs, children }: { runs: RunsBridge | null; children?: ReactNode }): ReactElement {
  return <Context value={runs}>{children}</Context>;
}

/** The runs calls, or null when this window has none. */
export const useRuns = (): RunsBridge | null => useContext(Context);

export type RunList = { readonly kind: 'loading' } | { readonly kind: 'failed'; readonly code: string } | { readonly kind: 'ready'; readonly runs: readonly RunView[] };

export interface RunListControl {
  readonly list: RunList;
  /** Reads the list again. */
  reload(): void;
  /** Puts a run main answered into the list in place, so the screen shows what main saved without a second read. */
  replace(run: RunView): void;
  /** Saves a change and puts the answer in place. Resolves to the short code of a refusal, or null. */
  change(id: string, patch: RunPatch): Promise<string | null>;
  /** Moves a damaged saved file aside and starts an empty list. Resolves to the name it was kept as, or the short code of a refusal. */
  startNew(): Promise<{ readonly asideName: string } | { readonly code: string }>;
}

/** The list of runs, read once when the screen opens. A list that cannot be read is "failed", never an empty list. */
export function useRunList(bridge: RunsBridge | null): RunListControl {
  const [list, setList] = useState<RunList>({ kind: 'loading' });
  const count = useRef(0);
  const reload = useCallback((): void => {
    if (bridge === null) return;
    count.current += 1;
    const mine = count.current;
    bridge.listRuns().then(runs => { if (mine === count.current) setList({ kind: 'ready', runs: [...runs] }); }, error => { if (mine === count.current) setList({ kind: 'failed', code: runsCodeOf(error) }); });
  }, [bridge]);
  useEffect(() => { reload(); return () => { count.current += 1; }; }, [reload]);
  const kind = useRef<RunList['kind']>('loading');
  kind.current = list.kind;
  const replace = useCallback((run: RunView): void => {
    // A list that was not read cannot take a run in place: it is read again, so the screen shows what main holds.
    if (kind.current !== 'ready') { reload(); return; }
    setList(now => (now.kind === 'ready' ? { kind: 'ready', runs: now.runs.some(r => r.id === run.id) ? now.runs.map(r => (r.id === run.id ? run : r)) : [run, ...now.runs] } : now));
  }, [reload]);
  const startNew = useCallback(async (): Promise<{ readonly asideName: string } | { readonly code: string }> => {
    if (bridge === null) return { code: 'FAILED' };
    try { const done = await bridge.startNewRunList(); reload(); return { asideName: done.asideName }; } catch (error) { return { code: runsCodeOf(error) }; }
  }, [bridge, reload]);
  const change = useCallback(async (id: string, patch: RunPatch): Promise<string | null> => {
    if (bridge === null) return 'FAILED';
    try { replace(await bridge.updateRun(id, patch)); return null; } catch (error) { return runsCodeOf(error); }
  }, [bridge, replace]);
  return { list, reload, replace, change, startNew };
}

export type FiguresView = { readonly kind: 'loading' } | { readonly kind: 'ready'; readonly figures: RunFigures } | { readonly kind: 'refused'; readonly code: string };

/** The figures of one run, read from main when the run is shown. A refusal of the call is its own state with its own words, never "could not read the log", which says something about the log. */
export function useFigures(bridge: RunsBridge | null, runId: string | null): FiguresView {
  const [view, setView] = useState<{ id: string | null; value: FiguresView }>({ id: null, value: { kind: 'loading' } });
  useEffect(() => {
    if (bridge === null || runId === null) return;
    let live = true;
    bridge.readRunFigures(runId).then(
      figures => { if (live) setView({ id: runId, value: { kind: 'ready', figures } }); },
      error => { if (live) setView({ id: runId, value: { kind: 'refused', code: runsCodeOf(error) } }); },
    );
    return () => { live = false; };
  }, [bridge, runId]);
  return view.id === runId ? view.value : { kind: 'loading' };
}
