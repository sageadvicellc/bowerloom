/** The three phases of a drawer, so it can slide in and slide out before it leaves the page. Pure. */

export type DrawerPhase = 'closed' | 'open' | 'closing';

/**
 * The phase after the `open` prop changes. Closing takes a moment so the drawer can slide out; with `animated` false (the person asked for less
 * motion) it is gone at once. A drawer asked to open again while it is closing opens.
 */
export function drawerStep(phase: DrawerPhase, open: boolean, animated: boolean): DrawerPhase {
  if (open) return 'open';
  if (phase === 'open') return animated ? 'closing' : 'closed';
  return phase;
}
