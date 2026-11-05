/**
 * The List view of the Overview: the same places, counts, parts and shared marks as the graph, as a nested list a screen reader and a keyboard can follow without the canvas.
 * Each place is a disclosure button (`aria-expanded`) with its name, its `~` label and its counts, then its mark and its one button; an open place lists its parts by kind. Each part
 * is a button that selects it, and the details column shows the same details as for a card of the graph. It is the default view in a window under OVERVIEW_LIMITS.smallScreen wide.
 * Closed places draw no parts, so a long scan stays short on the page. Read-only.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { PartKind } from '../../../shared/harness/types.js';
import { listOf } from '../../../shared/harness/overview-layout.js';
import type { Overview, OverviewGroup, OverviewNode } from '../../../shared/harness/overview.js';
import { HIcon, KIND_ICON } from '../icons.js';
import { KIND_PLURAL } from '../words.js';
import { HButton } from '../parts/controls.js';
import { OVERVIEW, alsoInWords, countsWords, nodeName, showMoreName, toggleName, usesLineWords } from '../words-overview.js';
import { brightOf, litPlaces, usesCounts } from './OverviewModel.js';
import type { OverviewIndex } from './OverviewModel.js';

export interface OverviewListProps {
  overview: Overview;
  expanded: ReadonlySet<string>;
  index: OverviewIndex;
  selectedId: string | null;
  onSelect(id: string): void;
  onToggle(groupId: string): void;
  /** The mark and the button of a place, drawn at the right of its row. */
  place(group: OverviewGroup): ReactNode;
}

/** The rows of one kind in one place drawn before "Show more", and the rows each press of it adds. */
export const LIST_ROWS = 50;

interface RowProps {
  id: string; kind: PartKind; name: string; summary: string; label: string; shared: number; runsCode: boolean;
  selected: boolean; lit: boolean; faded: boolean; onSelect(id: string): void;
}
/** One part. Memoised on plain values, so a press on one row draws that row and the one it replaces, not the whole list. */
const Row = memo(function Row({ id, kind, name, summary, label, shared, runsCode, selected, lit, faded, onSelect }: RowProps): ReactElement {
  return (
    <li className="hx-lrow hxo-row" data-node={id} data-kind={kind} data-selected={selected ? '' : undefined} data-lit={lit ? '' : undefined} data-faded={faded ? '' : undefined}>
      <span className="hxo-row-icon" aria-hidden="true"><HIcon name={KIND_ICON[kind]} size={18} /></span>
      <button type="button" className="hx-row-main" aria-pressed={selected} aria-label={label} onClick={() => onSelect(id)}>{name}</button>
      <span className="hxo-row-marks">
        {shared > 0 ? <span className="hxo-tag" data-shared="">{alsoInWords(shared)}</span> : null}
        {runsCode ? <span className="hxo-tag" data-runs-code="">{OVERVIEW.label.runsCode}</span> : null}
      </span>
      <span className="hx-lrow-sum">{summary}</span>
    </li>
  );
});

export function OverviewList({ overview, expanded, index, selectedId, onSelect, onToggle, place }: OverviewListProps): ReactElement {
  const groups = useMemo(() => listOf(overview), [overview]);
  const groupById = useMemo(() => new Map(overview.groups.map(g => [g.id, g] as const)), [overview]);
  const bright = useMemo(() => brightOf(overview, index, selectedId), [overview, index, selectedId]);
  const lit = useMemo(() => litPlaces(overview, index, selectedId), [overview, index, selectedId]);
  const copies = useMemo(() => {
    const found = selectedId === null ? undefined : index.node(selectedId);
    return found === undefined || found.node.shareKey === undefined ? null : new Set(overview.sharedKeys.get(found.node.shareKey) ?? []);
  }, [overview, index, selectedId]);
  // How many rows of each kind of each place are drawn: LIST_ROWS, and more after "Show more". The selected part is always among them.
  const focusLast = useRef<string | null>(null);
  useEffect(() => {
    const id = focusLast.current;
    if (id === null) return;
    focusLast.current = null;
    document.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"] .hx-row-main`)?.focus();
  });
  const [more, setMore] = useState<ReadonlyMap<string, number>>(() => new Map());
  const label = (group: { name: string }, node: OverviewNode): string => {
    const line = usesLineWords(usesCounts(index, node.id));
    return nodeName({ name: node.name, kind: node.kind, ...(node.toolKind === undefined ? {} : { toolKind: node.toolKind }), group: group.name, uses: 0, ...(line === null ? {} : { usesLine: line }), runsCode: node.runsCode === true, sharedWith: node.sharedWith.length });
  };
  return (
    <div className="hx-list hxo-list" data-view="list">
      <ul className="hxo-places" aria-label={OVERVIEW.label.places}>
        {groups.map(g => {
          const open = expanded.has(g.id), group = groupById.get(g.id)!;
          return (
            <li key={g.id} className="hxo-place" data-place={g.id} data-open={open ? '' : undefined} data-home={g.scope === 'home' ? '' : undefined} data-lit={lit.has(g.id) ? '' : undefined}>
              <div className="hxo-place-head">
                <h2 className="hxo-place-title">
                  <button type="button" className="hxo-toggle" data-place-toggle={g.id} aria-expanded={open} aria-controls={`hxo-body-${g.id}`} aria-label={`${toggleName(g.name, open)}, ${g.label}, ${g.note === undefined ? countsWords(g.counts) : OVERVIEW.hint.harnessUnreadable}`} onClick={() => onToggle(g.id)}>
                    <span className="hxo-chev" data-open={open ? '' : undefined} aria-hidden="true"><HIcon name="chevron" size={16} /></span>
                    <span className="hxo-text">
                      <span className="hxo-name">{g.name}</span>
                      <span className="hxo-sub"><span className="hxo-label">{g.label}</span><span className="hxo-counts">{g.note === undefined ? countsWords(g.counts) : OVERVIEW.hint.harnessUnreadable}</span></span>
                    </span>
                  </button>
                </h2>
                <span className="hxo-tools">{place(group)}</span>
              </div>
              <div id={`hxo-body-${g.id}`} className="hxo-place-body" hidden={!open}>
                {!open ? null : g.sections.length === 0 ? <p className="hx-text hx-muted">{OVERVIEW.hint.emptyPlace}</p> : g.sections.map(section => {
                  const key = `${g.id}/${section.kind}`;
                  const picked = selectedId === null ? -1 : section.nodes.findIndex(n => n.id === selectedId);
                  const shown = Math.min(section.nodes.length, Math.max(LIST_ROWS + (more.get(key) ?? 0), picked + 1));
                  return (
                    <section key={section.kind} className="hx-group" aria-label={`${KIND_PLURAL[section.kind]}, ${g.name}`}>
                      <h3 className="hx-group-head hxo-kind">{KIND_PLURAL[section.kind]} <span className="hx-group-count">{section.nodes.length}</span></h3>
                      <ul className="hx-lrows">
                        {section.nodes.slice(0, shown).map(node => {
                          const selected = selectedId === node.id;
                          return <Row key={node.id} id={node.id} kind={node.kind} name={node.name} summary={node.summary} label={label(g, node)} shared={node.sharedWith.length} runsCode={node.runsCode === true}
                            selected={selected} lit={!selected && copies !== null && copies.has(node.id)} faded={bright !== null && !bright.has(node.id)} onSelect={onSelect} />;
                        })}
                      </ul>
                      {shown >= section.nodes.length ? null : (
                        <HButton size="small" data-show-more={key} aria-label={showMoreName(section.nodes.length - shown, g.name)} onClick={() => {
                          // When this press draws the last rows the button goes, so the focus goes to the last row, not to the page.
                          if (Math.min(section.nodes.length, Math.max(LIST_ROWS + (more.get(key) ?? 0) + LIST_ROWS, picked + 1)) >= section.nodes.length) focusLast.current = section.nodes.at(-1)!.id;
                          setMore(m => new Map(m).set(key, (m.get(key) ?? 0) + LIST_ROWS));
                        }}>{OVERVIEW.label.showMore}</HButton>
                      )}
                    </section>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="hx-text hx-muted" data-read-only="">{OVERVIEW.hint.readOnly}</p>
    </div>
  );
}
