/**
 * The Grid view of the Overview (beta.2): each place is a section, and inside an open place the parts sit in a bento grid. A place gets one tile for each kind of part it holds;
 * a kind with many parts gets a bigger tile, a kind with few stays small, and a kind the place does not hold gets none (shared/harness/overview-bento.ts decides all of it).
 * A tile lists its first parts as buttons that select them, and ends with "and N more", which opens the List at that place. The details column, the marks and the buttons of a place
 * are the same as in the other two views. Read-only.
 *
 * Movement: when the columns change or a place opens or closes, the tiles that moved glide to their new place. The glide is made by overview-motion.ts (the one seam) and is
 * none under "reduce motion". A resize that does not change the columns moves nothing by animation.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { PartKind } from '../../../shared/harness/types.js';
import { BENTO, bentoColumns, bentoOf, itemsShown } from '../../../shared/harness/overview-bento.js';
import type { BentoTile } from '../../../shared/harness/overview-bento.js';
import type { Overview, OverviewGroup, OverviewNode } from '../../../shared/harness/overview.js';
import { HIcon, KIND_ICON } from '../icons.js';
import { KIND_PLURAL } from '../words.js';
import { OVERVIEW, countsWords, moreWords, nodeName, tileMoreName, tileName, toggleName, usesLineWords } from '../words-overview.js';
import { brightOf, litPlaces, usesCounts } from './OverviewModel.js';
import type { OverviewIndex } from './OverviewModel.js';
import { movesOf, overviewMotion } from './overview-motion.js';
import type { Rect } from './overview-motion.js';

export interface OverviewGridProps {
  overview: Overview;
  expanded: ReadonlySet<string>;
  index: OverviewIndex;
  selectedId: string | null;
  onSelect(id: string): void;
  onToggle(groupId: string): void;
  /** Opens the List at this place, from the end of a tile that lists only some of its parts. */
  onShowList(groupId: string): void;
  /** The mark and the button of a place, drawn at the right of its header. */
  place(group: OverviewGroup): ReactNode;
  /** The width of the stage in pixels before it is measured. Tests and the first paint use it. */
  initialWidth?: number;
}

interface ItemProps {
  id: string; kind: PartKind; name: string; label: string; shared: number; runsCode: boolean;
  selected: boolean; lit: boolean; faded: boolean; onSelect(id: string): void;
}
/** One part in a tile. Memoised on plain values, so a press draws the part and the one it replaces, not the whole grid. */
const Item = memo(function Item({ id, kind, name, label, shared, runsCode, selected, lit, faded, onSelect }: ItemProps): ReactElement {
  return (
    <li className="hxo-cell-item" data-node={id} data-kind={kind} data-selected={selected ? '' : undefined} data-lit={lit ? '' : undefined} data-faded={faded ? '' : undefined}>
      <button type="button" className="hxo-cell-pick" aria-pressed={selected} aria-label={label} onClick={() => onSelect(id)}>
        <span className="hxo-cell-name">{name}</span>
        {shared > 0 ? <span className="hxo-tag" data-shared="">{OVERVIEW.label.shared}</span> : null}
        {runsCode ? <span className="hxo-tag" data-runs-code="">{OVERVIEW.label.runsCode}</span> : null}
      </button>
    </li>
  );
});

interface BentoProps {
  group: OverviewGroup; columns: number; selectedId: string | null; index: OverviewIndex;
  bright: ReadonlySet<string> | null; copies: ReadonlySet<string> | null; onSelect(id: string): void; onShowList(groupId: string): void;
}
function Bento({ group, columns, selectedId, index, bright, copies, onSelect, onShowList }: BentoProps): ReactElement {
  const plan = useMemo(() => bentoOf(group.counts, columns), [group.counts, columns]);
  if (plan.tiles.length === 0) {
    return <p className="hx-text hx-muted" data-empty-place="">{group.note === undefined ? OVERVIEW.hint.emptyPlace : OVERVIEW.hint.harnessUnreadable}</p>;
  }
  const label = (node: OverviewNode): string => {
    const line = usesLineWords(usesCounts(index, node.id));
    return nodeName({ name: node.name, kind: node.kind, ...(node.toolKind === undefined ? {} : { toolKind: node.toolKind }), group: group.name, uses: 0, ...(line === null ? {} : { usesLine: line }), runsCode: node.runsCode === true, sharedWith: node.sharedWith.length });
  };
  const cell = (tile: BentoTile): ReactElement => {
    const nodes = group.nodes.filter(n => n.kind === tile.kind), shown = itemsShown(nodes, tile.show, selectedId), left = nodes.length - shown.length;
    return (
      <section key={tile.kind} className="hxo-cell" data-tile={`${group.id}/${tile.kind}`} data-kind={tile.kind} data-size={tile.size} aria-label={tileName(KIND_PLURAL[tile.kind], group.name, tile.count)}
        style={{ gridColumn: `${tile.col} / span ${tile.colSpan}`, gridRow: `${tile.row} / span ${tile.rowSpan}` }}>
        <h3 className="hxo-cell-head"><span className="hxo-row-icon" aria-hidden="true"><HIcon name={KIND_ICON[tile.kind]} size={18} /></span><span className="hxo-cell-title">{KIND_PLURAL[tile.kind]}</span><span className="hx-group-count">{tile.count}</span></h3>
        <ul className="hxo-cell-list" data-inner={tile.colSpan >= 2 ? 2 : 1}>
          {shown.map(node => {
            const selected = selectedId === node.id;
            return <Item key={node.id} id={node.id} kind={node.kind} name={node.name} label={label(node)} shared={node.sharedWith.length} runsCode={node.runsCode === true}
              selected={selected} lit={!selected && copies !== null && copies.has(node.id)} faded={bright !== null && !bright.has(node.id)} onSelect={onSelect} />;
          })}
        </ul>
        {left <= 0 ? null : <button type="button" className="hxo-cell-more" data-more={`${group.id}/${tile.kind}`} aria-label={tileMoreName(left, KIND_PLURAL[tile.kind], group.name)} onClick={() => onShowList(group.id)}>{moreWords(left)}</button>}
      </section>
    );
  };
  return (
    <div className="hxo-bento" data-bento={group.id} data-columns={plan.columns} data-rows={plan.rows} role="group" aria-label={`${OVERVIEW.label.tiles}, ${group.name}`}
      style={{ gridTemplateColumns: `repeat(${plan.columns}, minmax(0, 1fr))`, gridAutoRows: `${BENTO.unitRem}rem`, gap: `${BENTO.gapRem}rem`, ['--hxo-item' as string]: `${BENTO.itemRem}rem` }}>
      {plan.tiles.map(cell)}
    </div>
  );
}

/** The width of an element in pixels, kept up to date while it is on the page. `initial` is used until it is measured. */
function useWidth(ref: { current: HTMLElement | null }, initial: number): number {
  const [width, setWidth] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    setWidth(el.clientWidth || initial);
    if (typeof ResizeObserver !== 'function') return;
    const watch = new ResizeObserver(entries => { const w = entries[0]?.contentRect.width; if (w !== undefined && w > 0) setWidth(Math.round(w)); });
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref, initial]);
  return width;
}

/** Where each tile is, relative to the grid's own box, so a scroll does not look like a move. */
function measure(root: HTMLElement): Map<string, Rect> {
  const origin = root.getBoundingClientRect(), out = new Map<string, Rect>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-tile]')) {
    const r = el.getBoundingClientRect();
    out.set(el.dataset['tile']!, { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
  }
  return out;
}

export function OverviewGrid({ overview, expanded, index, selectedId, onSelect, onToggle, onShowList, place, initialWidth = 1000 }: OverviewGridProps): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const columns = bentoColumns(useWidth(root, initialWidth));
  const bright = useMemo(() => brightOf(overview, index, selectedId), [overview, index, selectedId]);
  const lit = useMemo(() => litPlaces(overview, index, selectedId), [overview, index, selectedId]);
  const copies = useMemo(() => {
    const found = selectedId === null ? undefined : index.node(selectedId);
    return found === undefined || found.node.shareKey === undefined ? null : new Set(overview.sharedKeys.get(found.node.shareKey) ?? []);
  }, [overview, index, selectedId]);

  // A glide runs when the layout changed (the columns, or which places are open), not on every render: a press that only selects moves nothing.
  const last = useRef<{ key: string; rects: Map<string, Rect> } | null>(null);
  const layoutKey = `${columns}|${overview.groups.filter(g => expanded.has(g.id)).map(g => g.id).join(',')}`;
  useLayoutEffect(() => {
    const el = root.current;
    if (el === null) return;
    const rects = measure(el), before = last.current;
    if (before !== null && before.key !== layoutKey) {
      const moves = movesOf(before.rects, rects);
      for (const [key, move] of moves) {
        const tile = el.querySelector<HTMLElement>(`[data-tile="${CSS.escape(key)}"]`);
        if (tile !== null) overviewMotion().glide(tile, move);
      }
    }
    last.current = { key: layoutKey, rects };
  });
  // Keep the last read when the page goes (a new Overview starts clean).
  useEffect(() => () => { last.current = null; }, []);

  return (
    <div ref={root} className="hx-list hxo-list hxo-grid" data-view="grid" data-columns={columns}>
      <ul className="hxo-places" aria-label={OVERVIEW.label.places}>
        {overview.groups.map(group => {
          const open = expanded.has(group.id);
          return (
            <li key={group.id} className="hxo-place" data-place={group.id} data-open={open ? '' : undefined} data-home={group.scope === 'home' ? '' : undefined} data-lit={lit.has(group.id) ? '' : undefined}>
              <div className="hxo-place-head">
                <h2 className="hxo-place-title">
                  <button type="button" className="hxo-toggle" data-place-toggle={group.id} aria-expanded={open} aria-controls={`hxo-body-${group.id}`}
                    aria-label={`${toggleName(group.name, open)}, ${group.label}, ${group.note === undefined ? countsWords(group.counts) : OVERVIEW.hint.harnessUnreadable}`} onClick={() => onToggle(group.id)}>
                    <span className="hxo-chev" data-open={open ? '' : undefined} aria-hidden="true"><HIcon name="chevron" size={16} /></span>
                    <span className="hxo-text">
                      <span className="hxo-name">{group.name}</span>
                      <span className="hxo-sub"><span className="hxo-label">{group.label}</span><span className="hxo-counts">{group.note === undefined ? countsWords(group.counts) : OVERVIEW.hint.harnessUnreadable}</span></span>
                    </span>
                  </button>
                </h2>
                <span className="hxo-tools">{place(group)}</span>
              </div>
              <div id={`hxo-body-${group.id}`} className="hxo-place-body" hidden={!open}>
                {!open ? null : <Bento group={group} columns={columns} selectedId={selectedId} index={index} bright={bright} copies={copies} onSelect={onSelect} onShowList={onShowList} />}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="hx-text hx-muted" data-read-only="">{OVERVIEW.hint.readOnly}</p>
    </div>
  );
}
