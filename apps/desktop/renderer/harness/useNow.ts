/**
 * A stamp for "now" that is drawn fresh every so often, so "Open for 12 minutes" keeps up while a screen stays open. The only reader of the clock is realNow (clock.ts).
 */
import { useEffect, useState } from 'react';
import type { Stamp } from '../../shared/harness/types.js';
import { realNow } from './clock.js';

export function useNow(everyMs = 15_000): Stamp {
  const [now, setNow] = useState<Stamp>(() => realNow());
  useEffect(() => {
    const id = window.setInterval(() => setNow(realNow()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}
