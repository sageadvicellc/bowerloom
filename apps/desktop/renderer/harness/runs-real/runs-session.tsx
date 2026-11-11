/**
 * The runs calls, handed down the tree like the engine calls (renderer/harness/engine.tsx), and the two hooks the real Runs and Compare screens use. The sample launch gets none (its screens keep their
 * made-up runs in the store); the launch on the person's own folders gets the bridge of its preload from renderer/api/client.ts, or null when the window has none.
 * Nothing here holds a path or a line of a chat: the page gets plain runs and plain figures from main.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { RunFigures, RunPatch, RunView, RunsBridge } from '../../../shared/api/runs.js';
import { runsCodeOf } from '../../api/client.js';

const Context = createContext<RunsBridge | null>(null);

export function RunsProvider({ runs, children }: { runs: RunsBridge | null; children?: ReactNode }): ReactElement {
  return <Context value={runs}>{children}</Context>;
}

/** The runs calls, or null when this window has none. */
export const useRuns = (): RunsBridge | null => useContext(Context);

export type RunList = { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'ready'; readonly runs: readonly RunView[] };

export interface RunListControl {
  readonly list: RunList;
  /** Reads the list again. */
  reload(): void;
  /** Puts a run main answered into the list in place, so the screen shows what main saved without a second read. */
  replace(run: RunView): void;
  /** Saves a change and puts the answer in place. Resolves to the short code of a refusal, or null. */
  change(id: string, patch: RunPatch): Promise<string | null>;
}

/** The list of runs, read once when the screen opens. A list that cannot be read is "failed", never an empty list. */
export function useRunList(bridge: RunsBridge | null): RunListControl {
  const [list, setList] = useState<RunList>({ kind: 'loading' });
  const count = useRef(0);
  const reload = useCallback((): void => {
    if (bridge === null) return;
    count.current += 1;
    const mine = count.current;
    bridge.listRuns().then(runs => { if (mine === count.current) setList({ kind: 'ready', runs: [...runs] }); }, () => { if (mine === count.current) setList({ kind: 'failed' }); });
  }, [bridge]);
  useEffect(() => { reload(); return () => { count.current += 1; }; }, [reload]);
  const replace = useCallback((run: RunView): void => {
    setList(now => (now.kind === 'ready' ? { kind: 'ready', runs: now.runs.some(r => r.id === run.id) ? now.runs.map(r => (r.id === run.id ? run : r)) : [run, ...now.runs] } : now));
  }, []);
  const change = useCallback(async (id: string, patch: RunPatch): Promise<string | null> => {
    if (bridge === null) return 'FAILED';
    try { replace(await bridge.updateRun(id, patch)); return null; } catch (error) { return runsCodeOf(error); }
  }, [bridge, replace]);
  return { list, reload, replace, change };
}

export type FiguresView = { readonly kind: 'loading' } | { readonly kind: 'ready'; readonly figures: RunFigures };

/** The figures of one run, read from main when the run is shown. A read that fails is the figures of a log that could not be read. */
export function useFigures(bridge: RunsBridge | null, runId: string | null): FiguresView {
  const [view, setView] = useState<{ id: string | null; value: FiguresView }>({ id: null, value: { kind: 'loading' } });
  useEffect(() => {
    if (bridge === null || runId === null) return;
    let live = true;
    bridge.readRunFigures(runId).then(
      figures => { if (live) setView({ id: runId, value: { kind: 'ready', figures } }); },
      () => { if (live) setView({ id: runId, value: { kind: 'ready', figures: { state: 'unreadable', startedAt: null, endedAt: null, durationMs: null, inputTokens: null, outputTokens: null, model: null, outcome: 'unknown' } } }); },
    );
    return () => { live = false; };
  }, [bridge, runId]);
  return view.id === runId ? view.value : { kind: 'loading' };
}
