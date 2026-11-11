// The component test page of useLocalReport (e2e/harness-local-report-hook.spec.ts): the real hook on a probe whose bridge answers only when the test says.
// The probe prints what the hook gives back and has a Refresh button and an Unmount button. Nothing is read or written.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalModelsBody } from '../../renderer/harness/local-models/LocalModels.js';
import { useLocalReport } from '../../renderer/harness/local-models/useLocalReport.js';
import type { LocalBridge, LocalModelsReport } from '../../shared/local-models/types.js';

interface Pending { readonly id: number; settled: boolean; resolve(value: LocalModelsReport): void; reject(error: unknown): void }
interface Driver {
  calls: Pending[];
  /** True: the next call throws at once, as a bridge can. */
  throwNow: boolean;
  answer(id: number, report: LocalModelsReport): void;
  fail(id: number, message: string): void;
  unmount(): void;
  /** Draws the body of the screen with or without a bridge, on the same mounted tree. */
  setAvailable(value: boolean): void;
}
const driver: Driver = {
  calls: [], throwNow: new URLSearchParams(location.search).get('throw') === '1',
  answer(id, report) { const c = driver.calls[id]; if (c && !c.settled) { c.settled = true; c.resolve(report); } },
  fail(id, message) { const c = driver.calls[id]; if (c && !c.settled) { c.settled = true; c.reject(new Error(message)); } },
  unmount() { root.unmount(); },
  setAvailable(value) { setAvailableNow(value); },
};
(window as unknown as { __driver: Driver }).__driver = driver;

const bridge: LocalBridge = {
  localModels: () => {
    if (driver.throwNow) throw new Error('FAILED');
    return new Promise<LocalModelsReport>((resolve, reject) => { driver.calls.push({ id: driver.calls.length, settled: false, resolve, reject }); });
  },
  listExtensions: async () => ({ extensions: [], skipped: [] }),
};

let renders = 0;
let setAvailableNow: (value: boolean) => void = () => undefined;
function Probe(): React.ReactElement {
  const state = useLocalReport(bridge);
  const [available, setAvailable] = useState(true);
  setAvailableNow = setAvailable;
  renders += 1;
  (window as unknown as { __renders: number }).__renders = renders;
  return (
    <div>
      <button onClick={state.refresh}>Refresh</button>
      <p data-probe="report">{state.report === null ? 'none' : `${state.report.sampledAt}|${state.report.models.length}`}</p>
      <p data-probe="failed">{String(state.failed)}</p>
      <p data-probe="code">{state.code ?? 'none'}</p>
      <p data-probe="stale">{String(state.stale)}</p>
      <p data-probe="busy">{String(state.busy)}</p>
      <p data-probe="announce">{state.announce ?? 'none'}</p>
      <div data-probe="body"><LocalModelsBody available={available} sample={false} report={state.report} failed={state.failed} stale={state.stale} busy={state.busy} code={state.code} /></div>
    </div>
  );
}

const holder = document.createElement('div');
document.body.append(holder);
const root = createRoot(holder);
root.render(<Probe />);
(window as unknown as { __ready: boolean }).__ready = true;
