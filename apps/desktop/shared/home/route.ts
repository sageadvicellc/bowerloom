/**
 * Where the home app opens, from the page address. `#prototype-v2` is the first minute: the Welcome screen, then Find, then the map with the tour.
 * `#prototype-v2/map` goes straight to the map, with no Welcome and no tour (for the maintainer, and for the tests of the map). `#prototype-v2/map/tour` is the
 * same map with the tour starting by itself, as it does after Find. Two more addresses open the same pages in read-only mode: `#prototype-v2/readonly` is the first
 * minute and `#prototype-v2/map/readonly` is the map alone. Read only means nothing on the page can change the setup (renderer/home/read-only.tsx). Pure: the address goes
 * in, the start comes out.
 */
export interface HomeStart {
  readonly screen: 'welcome' | 'map';
  /** True when the tour starts by itself, and the closing note shows after the first Save. */
  readonly guided: boolean;
  /** True when the page may only be looked at: every control that would change the setup is held back. */
  readonly readOnly: boolean;
}

const WELCOME: HomeStart = Object.freeze({ screen: 'welcome', guided: false, readOnly: false });
const MAP: HomeStart = Object.freeze({ screen: 'map', guided: false, readOnly: false });
const MAP_GUIDED: HomeStart = Object.freeze({ screen: 'map', guided: true, readOnly: false });
const WELCOME_READ_ONLY: HomeStart = Object.freeze({ screen: 'welcome', guided: false, readOnly: true });
const MAP_READ_ONLY: HomeStart = Object.freeze({ screen: 'map', guided: false, readOnly: true });

export function startOf(hash: string): HomeStart {
  if (hash === '#prototype-v2/map') return MAP;
  if (hash === '#prototype-v2/map/tour') return MAP_GUIDED;
  if (hash === '#prototype-v2/map/readonly') return MAP_READ_ONLY;
  if (hash === '#prototype-v2/readonly') return WELCOME_READ_ONLY;
  return WELCOME;
}

/** True when the address is one the app itself (not the kit gallery or the Add test page) answers. */
export const isAppHash = (hash: string): boolean =>
  hash === '#prototype-v2' || hash === '#prototype-v2/' || hash === '#prototype-v2/map' || hash === '#prototype-v2/map/tour' || hash === '#prototype-v2/map/readonly' || hash === '#prototype-v2/readonly';
