/**
 * The details column of the Overview. A part selected on the graph or in the list: its name, its kind, its summary, the places it is in (each with its mark and its one button), what
 * an agent uses and what uses a part, and the "Shared" and "Runs code" marks. Nothing selected: what the screen is, and every place. Read-only: every button here selects a part,
 * opens the builder or opens the system folder chooser. All text comes from the person's own files and is drawn as plain text.
 */
import type { ReactElement, ReactNode } from 'react';
import type { Overview, OverviewGroup } from '../../../shared/harness/overview.js';
import { DetailsHead } from '../Screen.js';
import { KIND_ICON, Tile } from '../icons.js';
import { WORDS } from '../words.js';
import { OVERVIEW, alsoInWords, kindWords, placesWords } from '../words-overview.js';
import { placesOf } from './OverviewModel.js';
import type { OverviewIndex } from './OverviewModel.js';

export interface OverviewDetailsProps {
  overview: Overview;
  index: OverviewIndex;
  selectedId: string | null;
  onSelect(id: string): void;
  /** The mark and the button of a place (`PlaceMark` and `PlaceAction`). */
  place(group: OverviewGroup): ReactNode;
}

/** One place in a list of places: its name, its `~` label, its mark and its button. */
function PlaceRow({ group, place }: { group: OverviewGroup; place(group: OverviewGroup): ReactNode }): ReactElement {
  return (
    <li className="hx-box hxo-place-row" data-place-row={group.id}>
      <span className="hxo-place-text"><span className="hx-box-name">{group.name}</span><span className="hxo-label">{group.label}</span></span>
      <span className="hxo-place-tools">{place(group)}</span>
    </li>
  );
}

function Related({ title, ids, index, onSelect, id }: { title: string; ids: readonly string[]; index: OverviewIndex; onSelect(id: string): void; id: string }): ReactElement | null {
  const rows = ids.map(x => index.node(x)).filter((x): x is NonNullable<typeof x> => x !== undefined);
  if (rows.length === 0) return null;
  return (
    <section className="hx-block" aria-labelledby={id}>
      <h3 className="hx-h3" id={id}>{title}</h3>
      <ul className="hx-box-list">
        {rows.map(r => <li key={r.node.id} className="hx-box hx-box-press"><Tile name={KIND_ICON[r.node.kind]} size="small" /><button type="button" className="hx-box-main" data-related={r.node.id} onClick={() => onSelect(r.node.id)}>{r.node.name}</button></li>)}
      </ul>
    </section>
  );
}

export function OverviewDetails({ overview, index, selectedId, onSelect, place }: OverviewDetailsProps): ReactElement {
  const found = selectedId === null ? undefined : index.node(selectedId);
  if (found === undefined) {
    return (
      <div data-details-empty="">
        <DetailsHead tile={<Tile name="globe" size="large" />} title={WORDS.label.overview} subtitle={placesWords(overview.groups.length)} />
        <p className="hx-text">{OVERVIEW.paragraph.intro}</p>
        <p className="hx-text hx-muted">{OVERVIEW.hint.readOnly}</p>
      </div>
    );
  }
  const { node, group } = found;
  const places = placesOf(index, node.id);
  return (
    <div data-details-node={node.id}>
      <DetailsHead tile={<Tile name={KIND_ICON[node.kind]} size="large" />} title={node.name} subtitle={kindWords(node.kind, node.toolKind)} />
      {node.summary === '' ? null : <p className="hx-text">{node.summary}</p>}
      {node.sharedWith.length > 0 || node.runsCode === true ? (
        <ul className="hxo-tags" aria-label={OVERVIEW.label.selectedPart}>
          {node.sharedWith.length > 0 ? <li className="hxo-tag" data-shared="">{OVERVIEW.label.shared}. {alsoInWords(node.sharedWith.length)}</li> : null}
          {node.runsCode === true ? <li className="hxo-tag" data-runs-code="">{OVERVIEW.label.runsCode}</li> : null}
        </ul>
      ) : null}
      <section className="hx-block" aria-labelledby="hxo-place-h">
        <h3 className="hx-h3" id="hxo-place-h">{OVERVIEW.label.place}</h3>
        <ul className="hx-box-list"><PlaceRow group={group} place={place} /></ul>
      </section>
      {places.length > 1 ? (
        <section className="hx-block" aria-labelledby="hxo-also-h">
          <h3 className="hx-h3" id="hxo-also-h">{OVERVIEW.label.alsoFoundIn}</h3>
          <ul className="hx-box-list">{places.slice(1).map(g => <PlaceRow key={g.id} group={g} place={place} />)}</ul>
        </section>
      ) : null}
      <Related title={OVERVIEW.label.uses} ids={index.uses(node.id)} index={index} onSelect={onSelect} id="hxo-uses-h" />
      <Related title={OVERVIEW.label.usedBy} ids={index.usedBy(node.id)} index={index} onSelect={onSelect} id="hxo-usedby-h" />
      <p className="hx-text hx-muted">{OVERVIEW.hint.readOnly}</p>
    </div>
  );
}
