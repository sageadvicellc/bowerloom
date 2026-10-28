// The component test page of the adopt and install sheets (e2e/harness-sheets-component.spec.ts): the real harness-first app, with an engine whose every
// call waits until the test answers it. The test reads each call (its name and arguments) from window.__driver and settles it when it chooses, so it can
// race a plan against a write, answer out of order, refuse, or throw. Nothing is read or written.
import { createRoot } from 'react-dom/client';
import { HarnessApp } from '../../renderer/harness/HarnessApp.js';
import { applyMotionTokens } from '../../renderer/motion-tokens.js';
import { ENGINE_CALLS } from '../../shared/engine/types.js';
import type { EngineBridge, EngineCall } from '../../shared/engine/types.js';

interface Pending { readonly id: number; readonly name: EngineCall; readonly args: unknown[]; settled: boolean; resolve(value: unknown): void; reject(error: unknown): void }
interface Driver {
  calls: Pending[];
  /** Answers the `n`-th call (0-based, in the order made) with a value, or rejects it with an error message. */
  answer(id: number, value: unknown): void;
  fail(id: number, message: string): void;
  /** Calls with these names answer at once with the value given here, until changed. */
  auto: Partial<Record<EngineCall, unknown>>;
}

const driver: Driver = {
  calls: [], auto: {},
  answer(id, value) { const c = driver.calls[id]; if (c && !c.settled) { c.settled = true; c.resolve(value); } },
  fail(id, message) { const c = driver.calls[id]; if (c && !c.settled) { c.settled = true; c.reject(new Error(message)); } },
};
const engine = { mode: 'real' } as Record<string, unknown>;
for (const name of ENGINE_CALLS) {
  engine[name] = (...args: unknown[]) => new Promise((resolve, reject) => {
    const pending: Pending = { id: driver.calls.length, name, args: JSON.parse(JSON.stringify(args)) as unknown[], settled: false, resolve, reject };
    driver.calls.push(pending);
    if (name in driver.auto) { pending.settled = true; resolve(driver.auto[name]); }
  });
}
(window as unknown as { __driver: Driver }).__driver = driver;

const params = new URLSearchParams(location.search);
applyMotionTokens();
location.hash = '#prototype-v3/projects';
const root = document.createElement('div');
document.body.append(root);
const noBridge = params.get('bridge') === 'none';
createRoot(root).render(<HarnessApp engine={noBridge ? null : engine as unknown as EngineBridge} />);
(window as unknown as { __ready: boolean }).__ready = true;
