/**
 * One pending timer that can be replaced or cancelled. A component keeps one in a ref and clears it when it goes away,
 * so a timer never runs after its component is gone.
 */
export interface TimerSlot {
  /** Runs `run` after `ms`. Any timer that has not run yet is cancelled first. */
  set(run: () => void, ms: number): void;
  /** Cancels the timer, if one is waiting. */
  clear(): void;
  /** True while a timer is waiting. */
  pending(): boolean;
}

export function timerSlot(): TimerSlot {
  let id: ReturnType<typeof setTimeout> | undefined;
  const clear = (): void => { if (id !== undefined) { clearTimeout(id); id = undefined; } };
  return {
    set(run, ms) { clear(); id = setTimeout(() => { id = undefined; run(); }, ms); },
    clear,
    pending: () => id !== undefined,
  };
}
