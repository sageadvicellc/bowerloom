/**
 * Reads the local models report on an interval while the page is visible. A failed read keeps the last good report and marks it stale; it is never an error page.
 * The first read that fails shows "trying again", not an error, and the next read goes on the same interval. Nothing is stored: each report is held in memory only.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { realNowMs } from '../clock.js';
import type { LocalBridge } from '../../../shared/local-models/types.js';
import type { LocalModelsReport } from '../../../shared/local-models/types.js';
import { REFRESH_MS } from '../../../shared/local-models/view-model.js';

export interface ReportState {
  readonly report: LocalModelsReport | null;
  /** Milliseconds of the last good read, or null. */
  readonly at: number | null;
  /** True when the newest read failed. */
  readonly failed: boolean;
  readonly busy: boolean;
  refresh(): void;
}

export function useLocalReport(bridge: LocalBridge | null): ReportState {
  const [state, setState] = useState<{ report: LocalModelsReport | null; at: number | null; failed: boolean; busy: boolean }>({ report: null, at: null, failed: false, busy: bridge !== null });
  const read = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (bridge === null) return undefined;
    let live = true, running = false;
    const run = (): void => {
      if (running) return;
      running = true;
      setState(s => ({ ...s, busy: true }));
      bridge.localModels().then(
        report => { if (live) setState({ report, at: realNowMs(), failed: false, busy: false }); },
        () => { if (live) setState(s => ({ ...s, failed: true, busy: false })); },
      ).finally(() => { running = false; });
    };
    read.current = run;
    run();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') run(); }, REFRESH_MS);
    const seen = (): void => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', seen);
    return () => { live = false; clearInterval(timer); document.removeEventListener('visibilitychange', seen); read.current = () => undefined; };
  }, [bridge]);
  const refresh = useCallback((): void => read.current(), []);
  return { ...state, refresh };
}
