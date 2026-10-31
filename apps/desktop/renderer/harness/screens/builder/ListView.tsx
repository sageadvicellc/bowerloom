/**
 * The list view of the builder: the same parts as the graph, in four groups (Agents, Skills, Tools, Context) with their counts. A part that was added since the harness was made shows a dot and "New".
 * A missing part is a dashed row with "Missing. Needed." and a Fix button. A press on a row selects the part, the same selection as the graph's.
 */
import type { ReactElement } from 'react';
import { PART_KINDS } from '../../../../shared/harness/types.js';
import type { Harness, HarnessState, PartKind } from '../../../../shared/harness/types.js';
import { kindCounts, partsOf } from '../../../../shared/harness/status.js';
import { HIcon, KIND_ICON, Tile } from '../../icons.js';
import { HButton } from '../../parts/controls.js';
import { KIND_PLURAL, WORDS } from '../../words.js';

export interface ListViewProps {
  state: HarnessState;
  harness: Harness;
  selectedId: string | null;
  /** The ids that match a search, or null when there is none. */
  matchIds: ReadonlySet<string> | null;
  onSelect(id: string): void;
  onFix(missingId: string): void;
}

export function ListView({ state, harness, selectedId, matchIds, onSelect, onFix }: ListViewProps): ReactElement {
  const parts = partsOf(state, harness), counts = kindCounts(state, harness);
  const groups = PART_KINDS.map((kind: PartKind) => ({
    kind,
    parts: parts.filter(p => p.kind === kind && (matchIds === null || matchIds.has(p.id))),
    missing: harness.missing.filter(m => m.kind === kind && (matchIds === null || matchIds.has(m.id))),
  })).filter(g => g.parts.length + g.missing.length > 0);
  return (
    <div className="hx-list" aria-label={WORDS.label.partsList}>
      {groups.map(group => (
        <section key={group.kind} className="hx-group" aria-labelledby={`hx-group-${group.kind}`}>
          <h2 className="hx-group-head" id={`hx-group-${group.kind}`}>{KIND_PLURAL[group.kind]} <span className="hx-group-count">{counts[group.kind]}</span></h2>
          <ul className="hx-lrows">
            {group.parts.map(part => {
              const selected = selectedId === part.id;
              return (
                <li key={part.id} className="hx-lrow" data-selected={selected ? '' : undefined} data-part={part.id} data-faded={matchIds !== null && !matchIds.has(part.id) ? '' : undefined}>
                  <Tile name={KIND_ICON[group.kind]} />
                  <button type="button" className="hx-row-main" aria-pressed={selected} onClick={() => onSelect(part.id)}>{part.name}</button>
                  <span className="hx-lrow-sum">{part.summary}</span>
                  {harness.newPartIds.includes(part.id) ? <span className="hx-lrow-new"><span className="hx-dot" data-tone="good" aria-hidden="true" />{WORDS.label.new}</span> : null}
                </li>
              );
            })}
            {group.missing.map(ref => (
              <li key={ref.id} className="hx-lrow" data-missing="" data-selected={selectedId === ref.id ? '' : undefined} data-part={ref.id}>
                <span className="hx-tile hx-tile-bare" aria-hidden="true"><HIcon name="search" size={20} /></span>
                <button type="button" className="hx-row-main" aria-pressed={selectedId === ref.id} onClick={() => onSelect(ref.id)}>{ref.name}</button>
                <span className="hx-lrow-sum">{WORDS.hint.missingNode}</span>
                <span className="hx-lrow-fix"><HButton size="small" aria-label={`${WORDS.label.fix} ${ref.name}`} onClick={() => onFix(ref.id)}>{WORDS.label.fix}</HButton></span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
