/**
 * Where the home app opens, from the page address. `#prototype-v2` is the first minute: the Welcome screen, then Find, then the map with the tour.
 * `#prototype-v2/map` goes straight to the map, with no Welcome and no tour (for Hanna, and for the tests of the map). `#prototype-v2/map/tour` is the
 * same map with the tour starting by itself, as it does after Find. Pure: the address goes in, the start comes out.
 */
export interface HomeStart {
  readonly screen: 'welcome' | 'map';
  /** True when the tour starts by itself, and the closing note shows after the first Save. */
  readonly guided: boolean;
}

const WELCOME: HomeStart = Object.freeze({ screen: 'welcome', guided: false });
const MAP: HomeStart = Object.freeze({ screen: 'map', guided: false });
const MAP_GUIDED: HomeStart = Object.freeze({ screen: 'map', guided: true });

export function startOf(hash: string): HomeStart {
  if (hash === '#prototype-v2/map') return MAP;
  if (hash === '#prototype-v2/map/tour') return MAP_GUIDED;
  return WELCOME;
}

/** True when the address is one the app itself (not the kit gallery or the Add test page) answers. */
export const isAppHash = (hash: string): boolean => hash === '#prototype-v2' || hash === '#prototype-v2/' || hash === '#prototype-v2/map' || hash === '#prototype-v2/map/tour';
