/**
 * The size, the smallest size and the title of the window, as plain data so a test can read them without Electron.
 * The home app prototype (--prototype-v2) opens at 1280 by 800: the shelves hide under 1200 px wide while a drawer is open (renderer/home/home.css), and the old
 * 1100 by 760 put them out of sight after every add. Every other launch keeps the size it always had.
 */

export interface WindowOptions { readonly width: number; readonly height: number; readonly minWidth: number; readonly minHeight: number; readonly title: string }

const MIN = { minWidth: 900, minHeight: 600 } as const;

export function windowOptions(prototypeV2: boolean): WindowOptions {
  return prototypeV2
    ? { width: 1280, height: 800, ...MIN, title: 'Bowerloom' }
    : { width: 1100, height: 760, ...MIN, title: 'Bowerloom Viewer' };
}
