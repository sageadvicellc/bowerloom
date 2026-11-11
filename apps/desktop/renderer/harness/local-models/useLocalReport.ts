/**
 * Reads the local models report on an interval while the page is visible. A failed read keeps the last good report and marks it stale; it is never an error page.
 * The first read that fails shows "trying again", not an error, and the next read goes on the same interval. Nothing is stored: each report is held in memory only.
 * A call that throws at once, not as a rejected promise, is a failed read too, so the hook is never stuck reading. The short code of a failure stays in the state, so the screen can show it.
 * Only a read the person asked for (Refresh) sets `busy` and `announce`. An automatic read is silent: it changes nothing on screen unless the figures changed.
 * Staleness is worked out here, on every tick of the interval, so the screen reads no clock.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { refusalCode } from '../../../shared/api/calls.js';
import { realNowMs } from '../clock.js';
import type { LocalBridge, LocalModelsReport } from '../../../shared/local-models/types.js';
import { REFRESH_MS, isStale } from '../../../shared/local-models/view-model.js';

/** What a manual Refresh says to a screen reader: that it reads, then that it updated or could not read. An automatic read says nothing. */
export type Announce = 'reading' | 'updated' | 'failed' | null;

export interface ReportState {
  readonly report: LocalModelsReport | null;
  /** True when the newest read failed. */
  readonly failed: boolean;
  /** The short code of the newest failure (FAILED, HOST_NOT_STARTED, ...), or null. */
  readonly code: string | null;
  /** True when the newest read failed, or the last good read is older than the limit. */
  readonly stale: boolean;
  /** True during the first read and during a read the person asked for. */
  readonly busy: boolean;
  readonly announce: Announce;
  refresh(): void;
}

type Held = Omit<ReportState, 'refresh'>;

/** The report without its read times: two reads of the same figures are the same report, and the screen need not draw again. */
const figures = (report: LocalModelsReport): string => JSON.stringify(report, (key, value: unknown) => (key === 'sampledAt' ? undefined : value));

export function useLocalReport(bridge: LocalBridge | null, now: () => number = realNowMs): ReportState {
  const [state, setState] = useState<Held>({ report: null, failed: false, code: null, stale: false, busy: bridge !== null, announce: null });
  const read = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (bridge === null) return undefined;
    let live = true, running = false, manual = false, lastGood: number | null = null, lastFigures: string | null = null;
    const run = (asked: boolean): void => {
      if (asked) manual = true;
      if (running) {
        // A click while a read runs starts no second read. It joins the read that runs, so the person hears the end of it.
        if (asked) setState(s => (s.announce === 'reading' && s.busy ? s : { ...s, busy: true, announce: 'reading' }));
        return;
      }
      running = true;
      if (manual) setState(s => ({ ...s, busy: true, announce: 'reading' }));
      // `new Promise` runs the call at once and turns a throw into a rejection.
      new Promise<LocalModelsReport>(resolve => resolve(bridge.localModels())).then(
        report => {
          if (!live) return;
          const wasAsked = manual; manual = false;
          lastGood = now();
          const same = lastFigures === figures(report);
          lastFigures = same ? lastFigures : figures(report);
          setState(s => {
            const next: Held = { report: same && s.report !== null ? s.report : report, failed: false, code: null, stale: false, busy: false, announce: wasAsked ? 'updated' : null };
            return s.report === next.report && s.failed === next.failed && s.code === next.code && s.stale === next.stale && s.busy === next.busy && s.announce === next.announce ? s : next;
          });
        },
        (error: unknown) => {
          if (!live) return;
          const wasAsked = manual; manual = false;
          const code = refusalCode(error, 'local');
          const announce: Announce = wasAsked ? 'failed' : null;
          setState(s => (s.failed && s.code === code && s.stale && !s.busy && s.announce === announce ? s : { ...s, failed: true, code, stale: true, busy: false, announce }));
        },
      ).catch((error: unknown) => {
        // A handler above threw. Log the class only, and leave the hook ready for the next read.
        console.error('local models: unexpected error in a read', error instanceof Error ? error.name : typeof error);
      }).finally(() => { running = false; });
    };
    // The age of the last good read, checked on every tick: a read that never ends must still turn the figures stale.
    const age = (): void => setState(s => { const stale = isStale(s.failed, lastGood, now()); return stale === s.stale ? s : { ...s, stale }; });
    read.current = () => run(true);
    run(false);
    const timer = setInterval(() => { age(); if (document.visibilityState === 'visible') run(false); }, REFRESH_MS);
    const seen = (): void => { if (document.visibilityState === 'visible') run(false); };
    document.addEventListener('visibilitychange', seen);
    return () => { live = false; clearInterval(timer); document.removeEventListener('visibilitychange', seen); read.current = () => undefined; };
  }, [bridge, now]);
  const refresh = useCallback((): void => read.current(), []);
  return { ...state, refresh };
}
