/**
 * Find, in real mode, for either of its homes (the page after Welcome, and the "Find more" panel). Two parts in this order: the reader's own two questions (RealScan.tsx: where it
 * looked, then "Read what is inside?"), and when the contents are read, the same list of agents as the sample's Find, with its ticks and tags (FindScan.tsx, which then asks nothing
 * more: `read`). The ticks the person leaves off decide which agents stay off the map, as they do in the sample.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { World } from '../../../shared/world/types.js';
import { FindScan } from '../first-run/FindScan.js';
import { RealScan } from './RealScan.js';
import { useRealFlow } from './RealFlow.js';

export interface RealFindProps {
  variant: 'page' | 'panel';
  world: World;
  committed?: World | undefined;
  /** The agents skipped so far, so the ticks start where the person left them. */
  skipped: readonly string[];
  onLeave(): void;
  onDone(skipped: readonly string[]): void;
}

export function RealFind({ variant, world, committed, skipped, onLeave, onDone }: RealFindProps): ReactElement {
  const flow = useRealFlow();
  const [read, setRead] = useState(false);
  if (!read) return <RealScan variant={variant} onLeave={onLeave} onWorld={result => { flow?.addResult(result); setRead(true); }} />;
  return <FindScan variant={variant} world={world} committed={committed} skipped={skipped} read onLeave={onLeave} onDone={onDone} />;
}
