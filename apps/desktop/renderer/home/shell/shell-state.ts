/**
 * The shell of the home app, as pure logic: how wide the left navigation is for a window width, which key toggles which column, the words and the shortcut a toggle's
 * tooltip shows, and where the arrow keys move in the navigation. No React, no DOM, no clock.
 *
 * Three columns, as in Claude and ChatGPT: the navigation at the left (232 px open, a 48 px icon rail when put away, hidden under 900 px where its toggle opens it over the
 * page), the content in the middle, the details at the right (put away with its own toggle). The state of both toggles lives in memory only.
 */

/** Under this width the navigation is hidden, and its toggle opens it as a drawer over the page. */
export const NAV_HIDE_BELOW = 900;
/** From the hide width up to this one the navigation starts as an icon rail, so the middle keeps room for two columns of agents. */
export const NAV_RAIL_BELOW = 1100;
/** The widths of the navigation, in pixels. */
export const NAV_WIDTH = Object.freeze({ open: 232, rail: 48 });

export type NavMode = 'open' | 'rail' | 'hidden';

/** The two places of the app, chosen in the navigation. */
export type View = 'agents' | 'library';

/**
 * How the navigation shows. `chosen` is what the person chose with the toggle (true open, false put away), or null when they have not chosen: it then follows the width.
 * Under 900 px it is hidden whatever was chosen, and its toggle opens the drawer.
 */
export function navModeOf(width: number, chosen: boolean | null): NavMode {
  if (width < NAV_HIDE_BELOW) return 'hidden';
  if (chosen === null) return width < NAV_RAIL_BELOW ? 'rail' : 'open';
  return chosen ? 'open' : 'rail';
}

/** The column a key toggles: Ctrl+B (Cmd+B on a Mac) the navigation, Ctrl+Shift+B (Cmd+Shift+B) the details. Alt keys and other letters are no shortcut. */
export type ShellKey = 'nav' | 'details';
export interface KeyFacts { readonly key: string; readonly ctrlKey: boolean; readonly metaKey: boolean; readonly shiftKey: boolean; readonly altKey: boolean }
export function shellKey(e: KeyFacts): ShellKey | null {
  if (e.altKey || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'b') return null;
  return e.shiftKey ? 'details' : 'nav';
}

/** The shortcut as the person's keyboard names it: "⌘B" and "⇧⌘B" on a Mac, "Ctrl+B" and "Ctrl+Shift+B" elsewhere. */
export function shortcutText(which: ShellKey, mac: boolean): string {
  if (mac) return which === 'nav' ? '⌘B' : '⇧⌘B';
  return which === 'nav' ? 'Ctrl+B' : 'Ctrl+Shift+B';
}

/** The `aria-keyshortcuts` value of a toggle. */
export const keyShortcuts = (which: ShellKey): string => (which === 'nav' ? 'Control+B Meta+B' : 'Control+Shift+B Meta+Shift+B');

/** True on a Mac. The page asks the browser; a page drawn without one is not a Mac. */
export function onMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
}

/** The tooltip of a toggle: its name and its shortcut, "Hide navigation (⌘B)". */
export const toggleTip = (name: string, which: ShellKey, mac: boolean): string => `${name} (${shortcutText(which, mac)})`;

/** Where the arrow keys move in a list of `count` items from `index`: Up and Down by one (they stop at the ends), Home and End to the first and last. Null for any other key. */
export function roveTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown': return Math.min(count - 1, index + 1);
    case 'ArrowUp': return Math.max(0, index - 1);
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

/** The height of a navigation item and the gap between two, in pixels. They are `--hm-control-h` (2rem) and the 2 px gap of the lists; the branch lines are drawn from them. */
export const NAV_ITEM_H = 32;
export const NAV_ITEM_GAP = 2;

/** What the branch line of a folder draws: the height of the whole list, the straight trunk, and one curved elbow for each child. All are SVG path text. */
export interface BranchGeometry { readonly height: number; readonly trunk: string; readonly elbows: readonly string[] }

/**
 * The branch of a folder with `count` children. The trunk is a thin vertical line at x 0.5 that stops 5 px above the last child's middle; each child has an elbow
 * (a quarter curve of 5 px, then a short flat line to x 11.5) that leaves the trunk 5 px above the child's middle. With no children there is nothing to draw.
 */
export function branchGeometry(count: number, itemH: number = NAV_ITEM_H, gap: number = NAV_ITEM_GAP): BranchGeometry {
  if (!Number.isFinite(count) || count < 1) return Object.freeze({ height: 0, trunk: '', elbows: Object.freeze([]) });
  const n = Math.floor(count);
  const mid = (i: number): number => i * (itemH + gap) + itemH / 2;
  const last = mid(n - 1);
  const elbows = Array.from({ length: n }, (_, i) => `M0.5 ${mid(i) - 5} Q0.5 ${mid(i)} 5.5 ${mid(i)} H11.5`);
  return Object.freeze({ height: n * itemH + (n - 1) * gap, trunk: `M0.5 0 V${last - 5}`, elbows: Object.freeze(elbows) });
}

/** A box on the screen, in pixels. */
export interface RectLike { readonly left: number; readonly top: number; readonly width: number; readonly height: number }

/** Where the soft hover highlight sits: the box of the item under the pointer, measured from the top-left corner of the navigation that holds the highlight. */
export function glideBox(item: RectLike, host: RectLike): RectLike {
  return { left: item.left - host.left, top: item.top - host.top, width: item.width, height: item.height };
}

/**
 * What an arrow key does on a row that opens and closes (a section header or a folder), or on a child of a folder:
 * Right opens a closed row and steps into an open one, Left closes an open row and steps out of a child to its folder. Null for any other case.
 */
export type FoldMove = 'open' | 'close' | 'in' | 'out';
export function foldMove(key: string, open: boolean, isFold: boolean, isChild: boolean): FoldMove | null {
  if (key === 'ArrowRight' && isFold) return open ? 'in' : 'open';
  if (key === 'ArrowLeft') {
    if (isFold && open) return 'close';
    if (isChild) return 'out';
  }
  return null;
}
