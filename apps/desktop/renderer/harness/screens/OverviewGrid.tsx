/**
 * The Grid view of the Overview (beta.2): each place is a section, and inside an open place the parts sit in a bento grid. A place gets one tile for each kind of part it holds;
 * a kind with many parts gets a bigger tile, a kind with few stays small, and a kind the place does not hold gets none (shared/harness/overview-bento.ts decides all of it).
 * A tile lists its first parts as buttons that select them, and ends with "and N more", which opens the List at that place. The details column, the marks and the buttons of a place
 * are the same as in the other two views. Read-only.
 *
 * Movement: when a place opens or closes, the places below it glide as units, so each frame and its tiles move together. When the columns change, the frames glide and so do the tiles
 * that kept their size. The glide is made by overview-motion.ts (the one seam, which also decides what glides) and is none under "reduce motion". A press that selects a part, and a
 * resize that does not change the columns, move nothing by animation.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { PartKind } from '../../../shared/harness/types.js';
import { BENTO, bentoColumns, bentoOf, countsOfNodes, itemsShown } from '../../../shared/harness/overview-bento.js';
import type { BentoTile } from '../../../shared/harness/overview-bento.js';
import type { Overview, OverviewGroup, OverviewNode } from '../../../shared/harness/overview.js';
import { HIcon, KIND_ICON } from '../icons.js';
import { KIND_PLURAL } from '../words.js';
import { OVERVIEW, countsWords, moreWords, nodeName, tileMoreName, tileName, toggleName, usesLineWords } from '../words-overview.js';
import { brightOf, litPlaces, usesCounts } from './OverviewModel.js';
import type { OverviewIndex } from './OverviewModel.js';
import { NO_GLIDES, applyGlides, glidePlanOf, guarded, stopGlides } from './overview-motion.js';
import type { GlideSnapshot, Rect } from './overview-motion.js';

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
        <span className="hxo-cell-name" title={name}>{name}</span>
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
  // The tiles are counted from the place's own parts, never from `group.counts`, so a count that is wrong can not hide a part. "Nothing was found" shows only when there is no part.
  const plan = useMemo(() => bentoOf(countsOfNodes(group.nodes), columns), [group.nodes, columns]);
  if (plan.tiles.length === 0) {
    return <p className="hx-text hx-muted" data-empty-place="">{group.note === undefined ? OVERVIEW.hint.emptyPlace : OVERVIEW.hint.harnessUnreadable}</p>;
  }
  const label = (node: OverviewNode): string => {
    const line = usesLineWords(usesCounts(index, node.id));
    return nodeName({ name: node.name, kind: node.kind, ...(node.toolKind === undefined ? {} : { toolKind: node.toolKind }), group: group.name, uses: 0, ...(line === null ? {} : { usesLine: line }), runsCode: node.runsCode === true, sharedWith: node.sharedWith.length });
  };
  const cell = (tile: BentoTile): ReactElement => {
    const nodes = group.nodes.filter(n => n.kind === tile.kind), shown = itemsShown(nodes, tile.show, selectedId), left = nodes.length - shown.length;
    const headId = `hxo-t-${group.id}-${tile.kind}`;
    return (
      <div key={tile.kind} className="hxo-cell" role="group" aria-labelledby={headId} data-tile={`${group.id}/${tile.kind}`} data-kind={tile.kind} data-size={tile.size}
        style={{ gridColumn: `${tile.col} / span ${tile.colSpan}`, gridRow: `${tile.row} / span ${tile.rowSpan}` }}>
        <h3 className="hxo-cell-head" id={headId} aria-label={tileName(KIND_PLURAL[tile.kind], group.name, tile.count)}><span className="hxo-row-icon" aria-hidden="true"><HIcon name={KIND_ICON[tile.kind]} size={18} /></span><span className="hxo-cell-title">{KIND_PLURAL[tile.kind]}</span><span className="hx-group-count">{tile.count}</span></h3>
        <ul className="hxo-cell-list" data-inner={tile.colSpan >= 2 ? 2 : 1}>
          {shown.map(node => {
            const selected = selectedId === node.id;
            return <Item key={node.id} id={node.id} kind={node.kind} name={node.name} label={label(node)} shared={node.sharedWith.length} runsCode={node.runsCode === true}
              selected={selected} lit={!selected && copies !== null && copies.has(node.id)} faded={bright !== null && !bright.has(node.id)} onSelect={onSelect} />;
          })}
        </ul>
        {left <= 0 ? null : <button type="button" className="hxo-cell-more" data-more={`${group.id}/${tile.kind}`} aria-label={tileMoreName(left, KIND_PLURAL[tile.kind], group.name)} onClick={() => onShowList(group.id)}>{moreWords(left)}</button>}
      </div>
    );
  };
  return (
    <div className="hxo-bento" data-bento={group.id} data-columns={plan.columns} data-rows={plan.rows} role="group" aria-label={`${OVERVIEW.label.tiles}, ${group.name}`}
      style={{
        gridTemplateColumns: `repeat(${plan.columns}, minmax(0, 1fr))`, gridAutoRows: `${BENTO.unitRem}rem`, gap: `${BENTO.gapRem}rem`,
        ['--hxo-item' as string]: `${BENTO.itemRem}rem`, ['--hxo-pad' as string]: `${BENTO.padRem}rem`, ['--hxo-head' as string]: `${BENTO.headRem}rem`, ['--hxo-foot' as string]: `${BENTO.footRem}rem`,
        ['--hxo-inner' as string]: `${BENTO.innerGapRem}rem`, ['--hxo-border' as string]: `${BENTO.borderRem}rem`,
      }}>
      {plan.tiles.map(cell)}
    </div>
  );
}

/** The width of an element's content box in pixels: its client width less its padding. The first read and the observer use this one measure. */
function contentWidth(el: HTMLElement): number {
  const style = getComputedStyle(el);
  return Math.max(0, el.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
}

/**
 * The columns for the width of an element, kept up to date while it is on the page. Only the number of columns is state, so a resize that keeps the columns draws nothing.
 * `initial` is the width used until the element is measured (tests, and a window with no observer). A measured width of 0 is 0, not `initial`.
 */
function useColumns(ref: { current: HTMLElement | null }, initial: number, onLayout: () => void): number {
  const [columns, setColumns] = useState(() => bentoColumns(initial));
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    // The layout is noted first, while the page still shows the old columns, so the next glide starts from what the person saw.
    const read = (): void => { onLayout(); setColumns(bentoColumns(contentWidth(el))); };
    read();
    if (typeof ResizeObserver !== 'function') return;
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref, onLayout]);
  return columns;
}

/** Where each place and each tile is, from offsets, so a transform in flight does not skew the read. A place is read from the top of the grid, a tile from the top left of its own place. */
function snapshot(root: HTMLElement, columns: number, open: string): GlideSnapshot {
  const box = (el: HTMLElement): Rect => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
  const frames = new Map<string, Rect>(), tiles = new Map<string, Rect>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-place]')) frames.set(el.dataset['place']!, box(el));
  for (const el of root.querySelectorAll<HTMLElement>('[data-tile]')) tiles.set(el.dataset['tile']!, box(el));
  return { columns, open, frames, tiles };
}

export function OverviewGrid({ overview, expanded, index, selectedId, onSelect, onToggle, onShowList, place, initialWidth = 1000 }: OverviewGridProps): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const bright = useMemo(() => brightOf(overview, index, selectedId), [overview, index, selectedId]);
  const lit = useMemo(() => litPlaces(overview, index, selectedId), [overview, index, selectedId]);
  const copies = useMemo(() => {
    const found = selectedId === null ? undefined : index.node(selectedId);
    return found === undefined || found.node.shareKey === undefined ? null : new Set(overview.sharedKeys.get(found.node.shareKey) ?? []);
  }, [overview, index, selectedId]);

  // What glides is decided by glidePlanOf (a pure function, tested): the first layout and a press that only selects move nothing. The layout is read after every commit, and when the
  // observer sees the width change, so the next glide starts from where things were and not from an old read. The first frames after the page opens are not glided: the width is
  // measured at once, and the columns may settle in the same frame. Every step is guarded: a failure of movement is reported once and the Overview goes on.
  const last = useRef<GlideSnapshot | null>(null), armed = useRef(false);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => { armed.current = true; });
    return () => cancelAnimationFrame(frame);
  }, []);
  const note = useCallback((): void => {
    const el = root.current, before = last.current;
    if (el === null || before === null) return;
    last.current = guarded('snapshot', null, () => snapshot(el, before.columns, before.open));
  }, []);
  const columns = useColumns(root, initialWidth, note);
  useLayoutEffect(() => {
    const el = root.current;
    if (el === null) return;
    const open = overview.groups.filter(g => expanded.has(g.id)).map(g => g.id).join(','), next = guarded('snapshot', null, () => snapshot(el, columns, open));
    if (next === null) { last.current = null; return; }
    const plan = guarded('plan', NO_GLIDES, () => glidePlanOf(armed.current ? last.current : null, next));
    last.current = next;
    applyGlides(plan, (layer, key) => el.querySelector<HTMLElement>(`[${layer === 'place' ? 'data-place' : 'data-tile'}="${CSS.escape(key)}"]`));
  });
  // When the Overview goes, every movement stops, so an engine that keeps running cannot move an element that is gone.
  useEffect(() => {
    const el = root.current;
    return () => { last.current = null; if (el !== null) stopGlides(el.querySelectorAll<HTMLElement>('[data-place], [data-tile]')); };
  }, []);

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
                      {/* An open place says what it holds in its tile heads, so its header does not say it again. */}
                      <span className="hxo-sub"><span className="hxo-label">{group.label}</span>{open && group.note === undefined ? null : <span className="hxo-counts">{group.note === undefined ? countsWords(group.counts) : OVERVIEW.hint.harnessUnreadable}</span>}</span>
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
