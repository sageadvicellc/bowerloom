/**
 * The bento plan of one place (beta.2 overview): which tiles a place gets, how big each one is, where each sits in the grid, and which parts a tile lists.
 * A place gets one tile for each kind of part it holds (agent, skill, tool, notes), in that order, and no tile for a kind it does not hold. A kind with more parts
 * gets a bigger tile; a kind with few stays small. The tiles then grow into any free cell, so the grid has no hole.
 *
 * Pure: no DOM, no clock, no random number. The same counts and columns give an equal plan. Rows and columns are grid lines that start at 1, so a plan can be handed
 * to CSS as it is (`grid-column: col / span colSpan`). The screen that draws it is renderer/harness/screens/OverviewGrid.tsx.
 */
import type { PartKind } from './types.js';
import type { OverviewCounts } from './overview.js';

/**
 * The numbers of the grid.
 *  - `maxColumns`: the most columns a place's grid has.
 *  - `wideStage`, `mediumStage`: the stage width in pixels from which the grid has 4 columns, and from which it has 2. Under `mediumStage` it has 1.
 *  - `wideAt`, `largeAt`: a kind with this many parts or more gets a wide tile (2 columns), or a large one (2 columns and 2 rows).
 *  - `unitRem`, `gapRem`, `chromeRem`, `itemRem`: the height of one grid row, the gap between rows, the height of a tile's own head and foot, and the height of one listed part. The
 *    style sheet uses the same numbers, so the count of parts a tile lists is the count that fits.
 */
export const BENTO = Object.freeze({ maxColumns: 4, wideStage: 760, mediumStage: 480, wideAt: 4, largeAt: 12, unitRem: 12, gapRem: 0.75, chromeRem: 5.75, itemRem: 1.875 });

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
  /** The most parts the tile lists before "and N more". At least 1. */
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
const SPANS: Readonly<Record<TileSize, { readonly cols: number; readonly rows: number }>> = { small: { cols: 1, rows: 1 }, wide: { cols: 2, rows: 1 }, large: { cols: 2, rows: 2 } };

/** The columns for a stage this wide, in pixels. A width that is not a positive number gives 1. */
export function bentoColumns(width: number): number {
  if (!Number.isFinite(width) || width < BENTO.mediumStage) return 1;
  return width < BENTO.wideStage ? 2 : BENTO.maxColumns;
}

const whole = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const sizeOf = (count: number): TileSize => (count >= BENTO.largeAt ? 'large' : count >= BENTO.wideAt ? 'wide' : 'small');

/** The parts that fit a tile of this many rows and columns: the rows that fit its height, in as many inner columns as it is wide (two when it spans two or more). */
function showOf(colSpan: number, rowSpan: number): number {
  const height = BENTO.unitRem * rowSpan + BENTO.gapRem * (rowSpan - 1) - BENTO.chromeRem;
  return Math.max(1, Math.floor(height / BENTO.itemRem)) * (colSpan >= 2 ? 2 : 1);
}

interface Box { kind: PartKind; count: number; size: TileSize; col: number; row: number; colSpan: number; rowSpan: number }

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
  const claim = (row: number, col: number, colSpan: number, rowSpan: number): void => {
    for (let r = row; r < row + rowSpan; r += 1) for (let c = col; c < col + colSpan; c += 1) taken.add(key(r, c));
  };
  const boxes: Box[] = [];
  let rows = 0;
  for (const { kind, count } of held) {
    const size = sizeOf(count), colSpan = Math.min(SPANS[size].cols, cols), rowSpan = SPANS[size].rows;
    let row = 1, col = 1;
    for (;; row += 1) {
      col = 1;
      while (col + colSpan - 1 <= cols && !free(row, col, colSpan, rowSpan)) col += 1;
      if (col + colSpan - 1 <= cols) break;
    }
    claim(row, col, colSpan, rowSpan);
    boxes.push({ kind, count, size, col, row, colSpan, rowSpan });
    rows = Math.max(rows, row + rowSpan - 1);
  }

  // Let the tiles grow into any free cell next to them, the biggest kinds first, until nothing can grow. This leaves no hole.
  const order = [...boxes].sort((a, b) => b.count - a.count || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  for (let grown = true; grown;) {
    grown = false;
    for (const b of order) {
      if (b.col + b.colSpan - 1 < cols && free(b.row, b.col + b.colSpan, 1, b.rowSpan)) { claim(b.row, b.col + b.colSpan, 1, b.rowSpan); b.colSpan += 1; grown = true; }
      else if (b.row + b.rowSpan - 1 < rows && free(b.row + b.rowSpan, b.col, b.colSpan, 1)) { claim(b.row + b.rowSpan, b.col, b.colSpan, 1); b.rowSpan += 1; grown = true; }
      else if (b.col > 1 && free(b.row, b.col - 1, 1, b.rowSpan)) { claim(b.row, b.col - 1, 1, b.rowSpan); b.col -= 1; b.colSpan += 1; grown = true; }
      else if (b.row > 1 && free(b.row - 1, b.col, b.colSpan, 1)) { claim(b.row - 1, b.col, b.colSpan, 1); b.row -= 1; b.rowSpan += 1; grown = true; }
    }
  }
  const tiles: BentoTile[] = boxes.map(b => ({ ...b, show: showOf(b.colSpan, b.rowSpan) }));
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
