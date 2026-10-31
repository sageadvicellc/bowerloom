/**
 * The List view of the Overview: the same places, counts, parts and shared marks as the graph, as a nested list a screen reader and a keyboard can follow without the canvas.
 * Each place is a disclosure button (`aria-expanded`) with its name, its `~` label and its counts, then its mark and its one button; an open place lists its parts by kind. Each part
 * is a button that selects it, and the details column shows the same details as for a card of the graph. It is the default view in a window under OVERVIEW_LIMITS.smallScreen wide.
 * Closed places draw no parts, so a long scan stays short on the page. Read-only.
 */
import type { ReactElement, ReactNode } from 'react';
import { listOf } from '../../../shared/harness/overview-layout.js';
import type { Overview, OverviewGroup, OverviewNode } from '../../../shared/harness/overview.js';
import { HIcon, KIND_ICON } from '../icons.js';
import { KIND_PLURAL } from '../words.js';
import { OVERVIEW, alsoInWords, countsWords, nodeName, toggleName, usesLineWords } from '../words-overview.js';
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

export function OverviewList({ overview, expanded, index, selectedId, onSelect, onToggle, place }: OverviewListProps): ReactElement {
  const groups = listOf(overview), groupById = new Map(overview.groups.map(g => [g.id, g] as const));
  const bright = brightOf(overview, index, selectedId), lit = litPlaces(overview, index, selectedId);
  const copies = (() => {
    const found = selectedId === null ? undefined : index.node(selectedId);
    return found === undefined || found.node.shareKey === undefined ? null : new Set(overview.sharedKeys.get(found.node.shareKey) ?? []);
  })();
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
                  <button type="button" className="hxo-toggle" data-place-toggle={g.id} aria-expanded={open} aria-controls={`hxo-body-${g.id}`} aria-label={`${toggleName(g.name, open)}, ${g.label}, ${countsWords(g.counts)}`} onClick={() => onToggle(g.id)}>
                    <span className="hxo-chev" data-open={open ? '' : undefined} aria-hidden="true"><HIcon name="chevron" size={16} /></span>
                    <span className="hxo-text">
                      <span className="hxo-name">{g.name}</span>
                      <span className="hxo-sub"><span className="hxo-label">{g.label}</span><span className="hxo-counts">{countsWords(g.counts)}</span></span>
                    </span>
                  </button>
                </h2>
                <span className="hxo-tools">{place(group)}</span>
              </div>
              <div id={`hxo-body-${g.id}`} className="hxo-place-body" hidden={!open}>
                {!open ? null : g.sections.length === 0 ? <p className="hx-text hx-muted">{OVERVIEW.hint.emptyPlace}</p> : g.sections.map(section => (
                  <section key={section.kind} className="hx-group" aria-label={`${KIND_PLURAL[section.kind]}, ${g.name}`}>
                    <h3 className="hx-group-head hxo-kind">{KIND_PLURAL[section.kind]} <span className="hx-group-count">{section.nodes.length}</span></h3>
                    <ul className="hx-lrows">
                      {section.nodes.map(node => {
                        const selected = selectedId === node.id, isLit = !selected && copies !== null && copies.has(node.id), faded = bright !== null && !bright.has(node.id);
                        return (
                          <li key={node.id} className="hx-lrow hxo-row" data-node={node.id} data-kind={node.kind} data-selected={selected ? '' : undefined} data-lit={isLit ? '' : undefined} data-faded={faded ? '' : undefined}>
                            <span className="hxo-row-icon" aria-hidden="true"><HIcon name={KIND_ICON[node.kind]} size={18} /></span>
                            <button type="button" className="hx-row-main" aria-pressed={selected} aria-label={label(g, node)} onClick={() => onSelect(node.id)}>{node.name}</button>
                            <span className="hxo-row-marks">
                              {node.sharedWith.length > 0 ? <span className="hxo-tag" data-shared="">{alsoInWords(node.sharedWith.length)}</span> : null}
                              {node.runsCode === true ? <span className="hxo-tag" data-runs-code="">{OVERVIEW.label.runsCode}</span> : null}
                            </span>
                            <span className="hx-lrow-sum">{node.summary}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="hx-text hx-muted" data-read-only="">{OVERVIEW.hint.readOnly}</p>
    </div>
  );
}
