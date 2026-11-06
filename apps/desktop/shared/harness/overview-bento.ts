/**
 * The bento plan of one place (beta.2 overview): which tiles a place gets, how big each one is, where each sits in the grid, and which parts a tile lists.
 * A place gets one tile for each kind of part it holds (agent, skill, tool, notes), in that order, and no tile for a kind it does not hold. A kind with more parts
 * gets a wider tile; a tile is as tall as its parts need, up to BENTO.maxRows rows, and never taller. Tiles do not stretch, so a place ends where its tallest column ends.
 *
 * Pure: no DOM, no clock, no random number. The same counts and columns give an equal plan. Rows and columns are grid lines that start at 1, so a plan can be handed
 * to CSS as it is (`grid-column: col / span colSpan`). The screen that draws it is renderer/harness/screens/OverviewGrid.tsx.
 */
import type { PartKind } from './types.js';
import type { OverviewCounts } from './overview.js';

/**
 * The numbers of the grid, all in rem except the counts.
 *  - `maxColumns`: the most columns a place's grid has.
 *  - `wideStage`, `mediumStage`: the stage width in pixels from which the grid has 4 columns, and from which it has 2. Under `mediumStage` it has 1.
 *  - `wideAt`, `largeAt`: a kind with this many parts or more gets a wide tile (2 columns), or a large one (2 columns).
 *  - `maxRows`: a tile is never taller than this many grid rows; a kind with more parts than fit lists some and ends with "and N more".
 *  - `unitRem`, `gapRem`: the height of one grid row and the gap between rows.
 *  - `padRem`, `headRem`, `footRem`, `innerGapRem`, `borderRem`, `itemRem`: a tile's padding (each side), head, foot ("and N more"), the gap between its head, list and foot, its border
 *    (each side), and one listed part. The style sheet reads these same numbers (the grid sets them as custom properties), so the count of parts a tile lists is the count that fits.
 *  - `chromeRem`: what a tile spends on everything but the list when it has a foot: 2 paddings, the head, the foot, 2 gaps and 2 borders. Measured in a rendered page: 6.125.
 */
const PARTS = { padRem: 0.625, headRem: 2.25, footRem: 2, innerGapRem: 0.25, borderRem: 0.0625 };
export const BENTO = Object.freeze({
  maxColumns: 4, wideStage: 760, mediumStage: 480, wideAt: 4, largeAt: 12, maxRows: 3, unitRem: 6, gapRem: 0.75, itemRem: 1.875, ...PARTS,
  chromeRem: 2 * PARTS.padRem + PARTS.headRem + PARTS.footRem + 2 * PARTS.innerGapRem + 2 * PARTS.borderRem,
});

export type TileSize = 'small' | 'wide' | 'large';

/** One tile: a kind of part, how many the place holds, the size class, the place in the grid, and how many parts it lists. */
export interface BentoTile {
  readonly kind: PartKind;
  readonly count: number;
  readonly size: TileSize;
  readonly col: number;
  readonly row: number;
  readonly colSpan: number;
  readonly rowSpan: number;
  /** The most parts the tile lists. When the place holds more, the tile ends with "and N more". At least 1. */
  readonly show: number;
}

/** The plan of a place. `rows` is 0 when the place holds nothing. `absent` lists the kinds with no tile, in order. */
export interface BentoPlan {
  readonly columns: number;
  readonly rows: number;
  readonly tiles: readonly BentoTile[];
  readonly absent: readonly PartKind[];
}

const KIND_ORDER: readonly PartKind[] = ['agent', 'skill', 'tool', 'context'];
const COLS: Readonly<Record<TileSize, number>> = { small: 1, wide: 2, large: 2 };

/** The columns for a stage this wide, in pixels. A width that is not a positive number gives 1. */
export function bentoColumns(width: number): number {
  if (!Number.isFinite(width) || width < BENTO.mediumStage) return 1;
  return width < BENTO.wideStage ? 2 : BENTO.maxColumns;
}

const whole = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const sizeOf = (count: number): TileSize => (count >= BENTO.largeAt ? 'large' : count >= BENTO.wideAt ? 'wide' : 'small');

/**
 * How many parts a tile of this many rows and columns can list. With a foot ("and N more") the foot takes its height and a gap; without one the list has that room.
 * A tile two columns wide lists its parts in two inner columns. Never below 0.
 */
export function tileCapacity(rowSpan: number, colSpan: number, foot: boolean): number {
  const height = BENTO.unitRem * rowSpan + BENTO.gapRem * (rowSpan - 1);
  const chrome = foot ? BENTO.chromeRem : BENTO.chromeRem - BENTO.footRem - BENTO.innerGapRem;
  return Math.max(0, Math.floor((height - chrome) / BENTO.itemRem)) * (colSpan >= 2 ? 2 : 1);
}

/** The counts of a place's own nodes, by kind. The grid reads these and not `OverviewGroup.counts`, so a tile can never hide a part the place holds. */
export function countsOfNodes(nodes: readonly { readonly kind: PartKind }[]): OverviewCounts {
  const out = { agent: 0, skill: 0, tool: 0, context: 0 };
  for (const n of nodes) if (n.kind in out) out[n.kind] += 1;
  return out;
}

/**
 * The rows a tile needs and how many parts it lists. The fewest rows (1 to maxRows) that list every part without a foot; failing that, maxRows rows, a foot, and what fits.
 * A tile is never taller than it needs, so short tiles end early and the place ends where its tallest column ends.
 */
function heightOf(count: number, colSpan: number): { rowSpan: number; show: number } {
  for (let rowSpan = 1; rowSpan <= BENTO.maxRows; rowSpan += 1) if (tileCapacity(rowSpan, colSpan, false) >= count) return { rowSpan, show: count };
  return { rowSpan: BENTO.maxRows, show: Math.max(1, tileCapacity(BENTO.maxRows, colSpan, true)) };
}

/** The plan for a place that holds `counts`, in a grid of `columns` (1 to BENTO.maxColumns). */
export function bentoOf(counts: OverviewCounts, columns: number): BentoPlan {
  const cols = Math.min(BENTO.maxColumns, Math.max(1, whole(columns)));
  const held = KIND_ORDER.map(kind => ({ kind, count: whole(counts[kind]) })).filter(k => k.count > 0);
  const absent = KIND_ORDER.filter(kind => whole(counts[kind]) === 0);
  if (held.length === 0) return { columns: cols, rows: 0, tiles: [], absent };

  // Put each tile in the first free place, going along a row and then down, in the order of the kinds.
  const taken = new Set<string>();
  const key = (row: number, col: number): string => `${row}:${col}`;
  const free = (row: number, col: number, colSpan: number, rowSpan: number): boolean => {
    for (let r = row; r < row + rowSpan; r += 1) for (let c = col; c < col + colSpan; c += 1) if (taken.has(key(r, c))) return false;
    return true;
  };
  const tiles: BentoTile[] = [];
  let rows = 0;
  for (const { kind, count } of held) {
    const size = sizeOf(count), colSpan = Math.min(COLS[size], cols), { rowSpan, show } = heightOf(count, colSpan);
    let row = 1, col = 1;
    for (;; row += 1) {
      col = 1;
      while (col + colSpan - 1 <= cols && !free(row, col, colSpan, rowSpan)) col += 1;
      if (col + colSpan - 1 <= cols) break;
    }
    for (let r = row; r < row + rowSpan; r += 1) for (let c = col; c < col + colSpan; c += 1) taken.add(key(r, c));
    tiles.push({ kind, count, size, col, row, colSpan, rowSpan, show });
    rows = Math.max(rows, row + rowSpan - 1);
  }
  return { columns: cols, rows, tiles, absent };
}

/**
 * The parts a tile lists: the first `show` (at least one). A selected part past that limit takes the last place, so it is never out of sight; a selected part the tile
 * does not hold, or one already listed, changes nothing. The order of the others is kept.
 */
export function itemsShown<T extends { readonly id: string }>(nodes: readonly T[], show: number, selectedId: string | null): readonly T[] {
  const limit = Math.max(1, whole(show));
  if (nodes.length <= limit) return nodes;
  const head = nodes.slice(0, limit);
  if (selectedId === null || head.some(n => n.id === selectedId)) return head;
  const picked = nodes.find(n => n.id === selectedId);
  return picked === undefined ? head : [...head.slice(0, limit - 1), picked];
}
