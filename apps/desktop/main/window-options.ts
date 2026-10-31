/**
 * The size, the smallest size and the title of the window, as plain data so a test can read them without Electron.
 * Every launch opens at 1280 by 800: the shelves hide under 1200 px wide while a drawer is open (renderer/home/home.css), and the old
 * 1100 by 760 put them out of sight after every add.
 */

export interface WindowOptions { readonly width: number; readonly height: number; readonly minWidth: number; readonly minHeight: number; readonly title: string }

const OPTIONS: WindowOptions = Object.freeze({ width: 1280, height: 800, minWidth: 900, minHeight: 600, title: 'Bowerloom' });

export function windowOptions(): WindowOptions { return OPTIONS; }
