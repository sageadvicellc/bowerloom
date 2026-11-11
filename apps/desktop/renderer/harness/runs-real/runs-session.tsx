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

export interface FiguresControl {
  readonly view: FiguresView;
  /** True while a read is in flight. */
  readonly busy: boolean;
  /** Reads the log again. It does nothing while a read is in flight, so two reads never run together. */
  reread(): void;
}

/**
 * The figures of one run, read from main when the run is shown, again when the run becomes done (the log may have been written since), and again when the person asks. A read never starts while another is
 * in flight: a request that comes then waits and runs once when the first ends (a press of "Read again" is dropped instead, since the button is off while busy). A refusal of the call is its own state with its
 * own words, never "could not read the log", which says something about the log. The old figures stay on screen while a new read runs.
 */
export function useFigures(bridge: RunsBridge | null, runId: string | null, status: string | null = null): FiguresControl {
  const [view, setView] = useState<{ id: string | null; value: FiguresView }>({ id: null, value: { kind: 'loading' } });
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false), waiting = useRef(false), current = useRef<string | null>(null), last = useRef<{ id: string | null; status: string | null }>({ id: null, status: null });
  const start = useCallback((): void => {
    const id = current.current;
    if (bridge === null || id === null) return;
    if (inflight.current) { waiting.current = true; return; }
    inflight.current = true; setBusy(true);
    const finish = (value: FiguresView): void => {
      inflight.current = false; setBusy(false);
      if (current.current === id) setView({ id, value });
      if (waiting.current) { waiting.current = false; start(); }
    };
    let asked: Promise<RunFigures>;
    try { asked = bridge.readRunFigures(id); } catch (error) { finish({ kind: 'refused', code: runsCodeOf(error) }); return; }
    asked.then(figures => finish({ kind: 'ready', figures }), error => finish({ kind: 'refused', code: runsCodeOf(error) }));
  }, [bridge]);
  useEffect(() => {
    current.current = runId;
    // A new run or a new bridge is a new read. The status becoming done is a new read of the same run.
    const before = last.current;
    last.current = { id: runId, status };
    if (runId === null) return;
    if (before.id !== runId) start();
    else if (before.status !== 'done' && status === 'done') start();
  }, [bridge, runId, status, start]);
  useEffect(() => () => { current.current = null; }, []);
  const reread = useCallback((): void => { if (!inflight.current) start(); }, [start]);
  return { view: view.id === runId ? view.value : { kind: 'loading' }, busy, reread };
}
