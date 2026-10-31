/**
 * S11, Version history. Every change the preview made, newest first and grouped by day. Each row says what changed, then the time, the person, the computer and what it wrote. "Undo" puts back what the change
 * replaced (`store.undo`). The change stays in the list, marked "Undone", and the undo is a new row. A row that is itself an undo cannot be undone.
 * Only the newest change of one install or one harness can be undone: an older row has Undo off, with "Undo the newer change first" beside it. An undo that cannot apply says why in a note.
 */
import type { ReactElement } from 'react';
import { undoBlocker } from '../../../shared/harness/store.js';
import { entryMeta, groupByDay } from '../../../shared/harness/time.js';
import type { HistoryEntry } from '../../../shared/harness/types.js';
import { Screen } from '../Screen.js';
import { useHarnessState, useHarnessStore } from '../session.js';
import { useUi } from '../ui.js';
import { undoNow } from '../undo-note.js';
import { HButton, StateDot } from '../parts/controls.js';
import { HIcon } from '../icons.js';
import { WORDS } from '../words.js';
import { FLOW, undoName } from '../words-flow.js';
import './history.css';

function Row({ entry, held, onUndo }: { entry: HistoryEntry; held: boolean; onUndo(): void }): ReactElement {
  const whyId = `hxh-why-${entry.id}`;
  return (
    <li className="hx-row hxh-row" tabIndex={-1} data-history={entry.id} data-undone={entry.undone ? '' : undefined}>
      <span className="hx-tile" aria-hidden="true"><HIcon name="clock" size={20} /></span>
      <div className="hx-row-text">
        <span className="hxh-text">{entry.text}</span>
        <span className="hx-row-meta">{entryMeta(entry)}</span>
        {held && !entry.undone ? <span className="hx-row-meta hxh-why" id={whyId}>{FLOW.hint.undoFirst}</span> : null}
      </div>
      {entry.undone ? <StateDot tone="quiet" className="hx-row-state">{FLOW.label.undone}</StateDot>
        : entry.undo === null ? null : <span className="hx-row-action"><HButton aria-label={undoName(entry.text)} aria-describedby={held ? whyId : undefined} disabled={held} onClick={onUndo}>{WORDS.label.undo}</HButton></span>}
    </li>
  );
}

export function History(): ReactElement {
  const state = useHarnessState(), store = useHarnessStore(), ui = useUi();
  const undo = (id: string): void => {
    undoNow(store, ui, id);
    // The button that was pressed is replaced by "Undone", so the focus goes to the row that holds it.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-history="${id}"]`)?.focus({ preventScroll: true }));
  };
  return (
    <Screen slot="history" title={WORDS.label.versionHistory}>
      <p className="kit-hint hx-hint">{FLOW.hint.historyHint}</p>
      <div className="hxh-days">
        {groupByDay(state.history).map(group => (
          <section key={group.day} className="hxh-day" aria-label={group.day}>
            <h2 className="hxh-day-head">{group.day}</h2>
            <ul className="hxh-list" aria-label={`${FLOW.label.historyList}: ${group.day}`}>
              {group.entries.map(entry => <Row key={entry.id} entry={entry} held={undoBlocker(state, entry.id) !== null} onUndo={() => undo(entry.id)} />)}
            </ul>
          </section>
        ))}
      </div>
    </Screen>
  );
}
